/**
 * push.mjs — Gift.Seen push notification foundation (FCM Phase 1).
 *
 * SCOPE (founder-locked): Quick Reply notifications ONLY. The type enum
 * reserves the future surfaces, but nothing else may send in this phase.
 *
 * TOKEN SYSTEM — deliberately REUSED, not duplicated: the ecosystem already
 * registers FCM device tokens in users/{uid}.fcmTokens (the Seen app's
 * usePushNotifications hook writes [{token, platform, updatedAt}] under the
 * owner-only Firestore rule — the write is bound to the verified caller UID
 * by the rules themselves). One identity across products means a Gift.Seen
 * sender who carries the Seen app is reachable TODAY with zero migration.
 * This module only READS that registry and prunes dead tokens from it.
 *
 * DELIVERY CONTRACT:
 *   · push fires ONLY after the Quick Reply transaction committed
 *     (duplicate:false) — never on refusals, never on retries;
 *   · push is best-effort: no failure here may disturb the saved reply;
 *   · ONE logical notification per reply, forever — pushEvents/{id} with the
 *     deterministic id quick_reply_{replyId} absorbs any retry/race (multiple
 *     DEVICES of the one owner are fan-out, not duplication);
 *   · the payload NEVER carries the reply text (lock screens are public);
 *     the signature is a sanitized display label, never verified identity;
 *   · nothing here touches Credits — no billing import exists in this file.
 */

export const PUSH_EVENTS_COLLECTION = "pushEvents";
export const USERS_COLLECTION = "users";

import { createHash } from "node:crypto";
const sha16 = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 16);

/**
 * Notification type registry. IMPLEMENTED: quick_reply, rsvp_received. The
 * rest are reserved names so later phases extend this enum instead of
 * inventing parallel systems.
 */
export const PUSH_TYPES = Object.freeze([
  "quick_reply",     // Phase 1
  "rsvp_received",   // Phase 2
  "tag_contact",     // Phase 3 (Seen.Tag pet/luggage/car contact)
  // reserved for later phases (design-only, no senders exist):
  "live_capacity_full",
  "live_guestbook_message",
  "event_update",
]);

/** Where a tapped notification should land the SENDER (web fallback route —
 *  the sent-gifts library, where the reply list lives). Native deep linking
 *  is a later phase; the Seen app currently logs taps without routing. */
const PUSH_LINK_BASE = process.env.PUSH_LINK_BASE_URL || "https://gift.beingseenmatters.com";

const plog = (event, fields = {}) => {
  try {
    console.log(`[push] ${event}`, JSON.stringify(fields));
  } catch {
    console.log(`[push] ${event}`);
  }
};

/** Lock-screen-safe copy (founder §4): concise, no reply body, signature as
 *  a display label only. Language comes from the gift's sealed occasion when
 *  it has one; otherwise zh (the product's primary audience). */
export function quickReplyPushCopy({ signature = null, language = "zh" } = {}) {
  const sig = typeof signature === "string" && signature.trim() ? signature.trim() : null;
  if (language === "en") {
    return {
      title: "You received a reply",
      body: sig ? `${sig} replied to your Gift.` : "Someone replied to your Gift.",
    };
  }
  return {
    title: "收到一条回复",
    body: sig ? `${sig}回复了你送出的心意。` : "有人回复了你送出的心意。",
  };
}

export const PUSH_TOKEN_MAX = 20;

/**
 * POST /push/register — Gift.Seen native device registration (Phase 1
 * correction §1/§2). The SERVER binds the submitted token to the VERIFIED
 * caller UID — a client can never register a token onto someone else — and
 * stamps `app:"giftseen"` so app-identity targeting can prefer Gift.Seen
 * devices. Entries live in the SHARED users/{uid}.fcmTokens registry next to
 * legacy Seen-app entries (which lack `app`); same-token re-registration
 * updates in place, and the list is capped keeping the newest.
 */
export async function registerPushToken({ db, decoded, body, now = Date.now() }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token || token.length > 512) return { status: 400, body: { error: "invalid_token" } };
  const platform =
    body?.platform === "ios" || body?.platform === "android" || body?.platform === "web"
      ? body.platform
      : "ios";
  const ref = db.collection(USERS_COLLECTION).doc(decoded.uid);
  const snap = await ref.get();
  const existing = (snap.exists ? snap.data().fcmTokens : null) ?? [];
  const rest = existing.filter((t) => t?.token !== token);
  const fcmTokens = [...rest, { token, platform, app: "giftseen", updatedAt: now }].slice(-PUSH_TOKEN_MAX);
  await ref.set({ fcmTokens }, { merge: true });
  plog("push_token_registered", { uid: decoded.uid, platform, app: "giftseen", total: fcmTokens.length });
  return { status: 200, body: { ok: true } };
}

/**
 * POST /push/unregister — logout releases ONLY the submitted device token
 * from the caller's own registry. Every other entry — the user's other
 * Gift.Seen devices AND legacy Seen-app tokens — stays untouched.
 */
export async function unregisterPushToken({ db, decoded, body, now = Date.now() }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  if (!token) return { status: 400, body: { error: "invalid_token" } };
  const ref = db.collection(USERS_COLLECTION).doc(decoded.uid);
  const snap = await ref.get();
  if (!snap.exists) return { status: 200, body: { ok: true, removed: false } };
  const existing = snap.data().fcmTokens ?? [];
  const fcmTokens = existing.filter((t) => t?.token !== token);
  if (fcmTokens.length !== existing.length) {
    await ref.set({ fcmTokens }, { merge: true });
    plog("push_token_removed", { uid: decoded.uid, reason: "logout" });
    return { status: 200, body: { ok: true, removed: true } };
  }
  return { status: 200, body: { ok: true, removed: false } };
}

/** FCM permanent-token failures → prune; anything else is transient. */
function isPermanentTokenError(err) {
  const code = String(err?.errorInfo?.code ?? err?.code ?? "");
  return (
    code.includes("registration-token-not-registered") ||
    code.includes("invalid-registration-token") ||
    code.includes("invalid-argument")
  );
}

/**
 * Send the Quick Reply notification to the gift OWNER's registered devices.
 * Fire-and-forget by design: returns a summary, never throws.
 *
 * Idempotency: pushEvents/{quick_reply_{replyId}} is created FIRST with
 * .create() — a concurrent or retried call collides (ALREADY_EXISTS) and
 * sends nothing. replyId is the reply document's own deterministic identity,
 * so a client retry of the same reply can never mint a second event.
 */
export async function sendQuickReplyPush({
  db,
  messaging,
  ownerUid,
  giftId,
  replyId,
  signature = null,
  language = "zh",
  now = Date.now(),
}) {
  try {
    if (!db || !ownerUid || !replyId) return { ok: false, skipped: "missing_context" };
    const eventId = `quick_reply_${replyId}`;
    const eventRef = db.collection(PUSH_EVENTS_COLLECTION).doc(eventId);
    const event = {
      schemaVersion: 1,
      type: "quick_reply",
      ownerUid,
      subjectGiftId: giftId ?? null,
      replyId,
      status: "created",
      deviceCount: 0,
      failureCount: 0,
      createdAt: now,
      sentAt: null,
    };
    try {
      await eventRef.create(event);
    } catch (err) {
      if (err?.code === 6 || /ALREADY_EXISTS/i.test(String(err?.message ?? ""))) {
        plog("quick_reply_push_duplicate", { eventId });
        return { ok: true, duplicate: true, eventId };
      }
      throw err;
    }
    plog("quick_reply_push_created", { eventId, ownerUid });

    const copy = quickReplyPushCopy({ signature, language });
    return await deliverToOwnerDevices({
      db, messaging, ownerUid, eventRef, eventId, sentLog: "quick_reply_push_sent", now,
      buildMessage: (token) => ({
        token,
        notification: { title: copy.title, body: copy.body },
        apns: { payload: { aps: { sound: "default" } } },
        android: { notification: { sound: "default" } },
        // Structured fields are the authority for native tap routing; `url`
        // is the web fallback deep link. Both land the sender on the EXACT
        // replied gift's reply list (never the recipient reveal). The reply
        // TEXT is never here (lock screens are public).
        data: {
          type: "quick_reply",
          giftId: String(giftId ?? ""),
          replyId: String(replyId),
          url: `${PUSH_LINK_BASE}/library?gift=${encodeURIComponent(String(giftId ?? ""))}&view=replies&reply=${encodeURIComponent(String(replyId))}`,
        },
      }),
    });
  } catch (err) {
    // Best-effort by contract: the reply is already saved; never rethrow.
    plog("push_send_failed", { reason: String(err?.message ?? "unknown") });
    return { ok: false, error: "push_send_failed" };
  }
}

/**
 * SHARED delivery for every notification type: read the OWNER's registered
 * devices, prefer Gift.Seen tokens (all of them fan out — one logical event;
 * legacy Seen tokens are the fallback only when NO Gift.Seen device exists,
 * never both), send the caller-built message (audible default sound), prune
 * permanently dead tokens, and stamp the pushEvents doc. Server-side
 * ownership is the sole targeting authority — nothing recipient-side is ever
 * addressable. Best-effort: callers wrap this and never rethrow.
 */
async function deliverToOwnerDevices({ db, messaging, ownerUid, eventRef, eventId, buildMessage, sentLog, now }) {
  if (!messaging) {
    await eventRef.update({ status: "skipped_no_messaging", sentAt: now });
    plog("push_send_failed", { eventId, reason: "messaging_unavailable" });
    return { ok: false, eventId, skipped: "messaging_unavailable" };
  }
  const userSnap = await db.collection(USERS_COLLECTION).doc(ownerUid).get();
  const tokens = (userSnap.exists ? userSnap.data().fcmTokens : null) ?? [];
  const registered = tokens.filter((t) => t && typeof t.token === "string" && t.token && t.enabled !== false);
  const giftseenDevices = registered.filter((t) => t.app === "giftseen");
  const active = giftseenDevices.length > 0 ? giftseenDevices : registered;
  if (active.length === 0) {
    await eventRef.update({ status: "no_devices", sentAt: now });
    plog(sentLog, { eventId, deviceCount: 0, note: "no_devices" });
    return { ok: true, eventId, deviceCount: 0 };
  }
  const deadTokens = [];
  let sent = 0;
  let failed = 0;
  for (const t of active) {
    try {
      await messaging.send(buildMessage(t.token));
      sent += 1;
    } catch (err) {
      if (isPermanentTokenError(err)) {
        deadTokens.push(t.token);
        plog("push_token_invalidated", { eventId, platform: t.platform ?? null });
      } else {
        failed += 1;
        plog("push_send_partial_failure", { eventId, code: String(err?.errorInfo?.code ?? err?.code ?? "unknown") });
      }
    }
  }
  if (deadTokens.length > 0 && userSnap.exists) {
    try {
      const remaining = (userSnap.data().fcmTokens ?? []).filter((t) => !deadTokens.includes(t?.token));
      await db.collection(USERS_COLLECTION).doc(ownerUid).update({ fcmTokens: remaining });
      plog("push_token_removed", { ownerUid, removed: deadTokens.length });
    } catch {
      plog("push_send_partial_failure", { eventId, code: "token_prune_failed" });
    }
  }
  const status = sent > 0 ? (failed > 0 ? "partial" : "sent") : "failed";
  await eventRef.update({ status, deviceCount: sent, failureCount: failed, sentAt: now });
  plog(sentLog, { eventId, deviceCount: sent, failureCount: failed, invalidated: deadTokens.length });
  return { ok: true, eventId, deviceCount: sent, failureCount: failed };
}

// --- RSVP notifications (FCM Phase 2) ---------------------------------------

/**
 * The canonical RSVP state for meaningful-change detection (founder §7): ONLY
 * the fields that materially affect an organizer's planning — the response
 * and the attendance headcount (adults + children). Deliberately EXCLUDES
 * timestamps, the optional guest message and dietary notes: a message- or
 * dietary-only edit is not an attendance change and must not push (§14).
 */
export function canonicalRsvpState({ response, adultCount = null, childCount = null }) {
  const r = response === "accepted" || response === "declined" ? response : "none";
  const a = Number.isInteger(adultCount) ? adultCount : "";
  const c = Number.isInteger(childCount) ? childCount : "";
  return `${r}|${a}|${c}`;
}

/** Lock-screen-safe RSVP copy (founder §5): organizer-facing guest/household
 *  label when present, generic otherwise; NEVER phone/email/message/token. */
export function rsvpReceivedPushCopy({ label = null, response, prevResponse = null, partySize = null, language = "zh" }) {
  const safe = typeof label === "string" && label.trim() ? label.trim() : null;
  const sizeUpdate = response === "accepted" && prevResponse === "accepted" && Number.isFinite(partySize);
  if (language === "en") {
    if (sizeUpdate) return { title: "Attendance updated", body: safe ? `${safe} updated their party size to ${partySize}.` : "Someone updated their RSVP." };
    if (response === "declined") return { title: "New RSVP", body: safe ? `${safe} can't attend.` : "Someone responded to your invitation." };
    return { title: "New RSVP", body: safe ? `${safe} is attending.` : "Someone responded to your invitation." };
  }
  if (sizeUpdate) return { title: "出席人数有更新", body: safe ? `${safe} 更新了出席人数：${partySize} 人。` : "有人更新了出席回复。" };
  if (response === "declined") return { title: "收到新的出席回复", body: safe ? `${safe} 无法参加。` : "有人回复了你的邀请。" };
  return { title: "收到新的出席回复", body: safe ? `${safe} 已确认参加。` : "有人回复了你的邀请。" };
}

/**
 * Notify the event ORGANIZER that a guest RSVP'd or made a MEANINGFUL change.
 * Only after the RSVP transaction committed; best-effort (never throws), so a
 * saved RSVP is never disturbed by push failure.
 *
 * ONE logical event per meaningful state: the pushEvents id is
 * rsvp_{sha256(rsvpId | canonicalState)} — an identical re-submission collapses
 * on the deterministic id (no second push), a genuine later change mints a new
 * id (one push). Multiple organizer devices are fan-out of the ONE event.
 * Targeting/sound/dead-token pruning are the shared owner-delivery path.
 */
export async function sendRsvpPush({
  db,
  messaging,
  ownerUid,
  eventId,
  giftId,
  rsvpId,
  prev = { response: null },
  next,
  label = null,
  language = "zh",
  now = Date.now(),
}) {
  try {
    if (!db || !ownerUid || !eventId || !rsvpId || !next) return { ok: false, skipped: "missing_context" };
    const response = next.response;
    if (response !== "accepted" && response !== "declined") return { ok: false, skipped: "no_response" };
    const prevResponse = prev?.response ?? null;
    const adultCount = next.adultCount ?? null;
    const childCount = next.childCount ?? null;
    // ONE logical event per TRANSITION. The identity carries the previous and
    // new canonical states PLUS the previous write's already-persisted
    // timestamp (managed rsvpAt / shared updatedAt — no new field, no
    // transaction). That timestamp is what distinguishes two occurrences of
    // the SAME transition across a full oscillation (accepted→declined→
    // accepted→declined: each A→B commit followed a distinct A commit, so each
    // notifies), while an identical resubmission is still caught upstream by
    // the unchanged-state gate and two concurrent identical submissions share
    // the same prev+timestamp and converge to one push.
    const pushEventId = `rsvp_${sha16(`${rsvpId}|${canonicalRsvpState(prev)}|${canonicalRsvpState(next)}|${prev?.stamp ?? ""}`)}`;
    const eventRef = db.collection(PUSH_EVENTS_COLLECTION).doc(pushEventId);
    const eventDoc = {
      schemaVersion: 1,
      type: "rsvp_received",
      ownerUid,
      subjectGiftId: giftId ?? null,
      eventId,
      rsvpId,
      response,
      status: "created",
      deviceCount: 0,
      failureCount: 0,
      createdAt: now,
      sentAt: null,
    };
    try {
      await eventRef.create(eventDoc);
    } catch (err) {
      if (err?.code === 6 || /ALREADY_EXISTS/i.test(String(err?.message ?? ""))) {
        plog("rsvp_push_duplicate", { eventId: pushEventId });
        return { ok: true, duplicate: true, eventId: pushEventId };
      }
      throw err;
    }
    plog("rsvp_push_created", { eventId: pushEventId, ownerUid, response });

    const partySize =
      response === "accepted" && (Number.isInteger(adultCount) || Number.isInteger(childCount))
        ? (Number.isInteger(adultCount) ? adultCount : 0) + (Number.isInteger(childCount) ? childCount : 0)
        : null;
    const copy = rsvpReceivedPushCopy({ label, response, prevResponse, partySize, language });
    return await deliverToOwnerDevices({
      db, messaging, ownerUid, eventRef, eventId: pushEventId, sentLog: "rsvp_push_sent", now,
      buildMessage: (token) => ({
        token,
        notification: { title: copy.title, body: copy.body },
        apns: { payload: { aps: { sound: "default" } } },
        android: { notification: { sound: "default" } },
        // Structured fields drive native tap routing to the EXACT event
        // dashboard; `url` is the web fallback. No RSVP message / phone /
        // email / access token ever rides the payload.
        data: {
          type: "rsvp_received",
          eventId: String(eventId),
          giftId: String(giftId ?? ""),
          rsvpId: String(rsvpId),
          response: String(response),
          url: `${PUSH_LINK_BASE}/library/event/${encodeURIComponent(String(eventId))}?rsvp=${encodeURIComponent(String(rsvpId))}&guest=${encodeURIComponent(String(giftId ?? ""))}`,
        },
      }),
    });
  } catch (err) {
    plog("rsvp_push_failed", { reason: String(err?.message ?? "unknown") });
    return { ok: false, error: "rsvp_push_failed" };
  }
}

/**
 * Shared meaningful-change gate used by BOTH RSVP paths (managed household in
 * gift.mjs, shared-link responder in sharedRsvp.mjs). Fires sendRsvpPush ONLY
 * when: a status was supplied (never a message-/dietary-only edit, §14), the
 * record is a real event (has eventId) with an organizer UID, it is NOT a
 * casual gathering (§27 audit-only this phase), and the CANONICAL attendance
 * state actually changed. `rec` is the pre-write record (carries the previous
 * state and the occasion). Never throws — a saved RSVP is never disturbed.
 */
export async function maybeSendRsvpPush({ db, messaging, now = Date.now(), rec, ownerUid, giftId, rsvpId, label, prev, next, statusSupplied }) {
  try {
    if (!statusSupplied) return { skipped: "message_only" };
    const eventId = rec?.eventId ?? null;
    if (!eventId || !ownerUid) return { skipped: "not_event" };
    if (rec?.occasion?.type === "casual") return { skipped: "casual" };
    if (canonicalRsvpState(prev) === canonicalRsvpState(next)) {
      plog("rsvp_push_skipped_unchanged", { eventId, rsvpId });
      return { skipped: "unchanged" };
    }
    const language =
      rec.notifyLanguage === "en" || rec.notifyLanguage === "zh"
        ? rec.notifyLanguage
        : rec.occasion?.language === "en"
          ? "en"
          : "zh";
    return await sendRsvpPush({
      db, messaging, ownerUid, eventId, giftId, rsvpId,
      prev, next, label, language, now,
    });
  } catch (err) {
    plog("rsvp_push_failed", { reason: String(err?.message ?? "gate") });
    return { ok: false, error: "rsvp_push_failed" };
  }
}

// --- Seen.Tag contact notifications (FCM Phase 3) ---------------------------

/** Tag types that notify on a meaningful contact. Gift is EXCLUDED — its
 *  recipient response is Quick Reply (never double-notified); the gift contact
 *  door is structurally closed anyway (TAG_TYPES.gift.reasons === []). */
export const TAG_CONTACT_PUSH_TYPES = Object.freeze(["pet", "luggage", "car"]);

/**
 * Lock-screen-safe Tag-contact copy (founder §5-§10): the body says only that
 * contact occurred — NEVER the finder's message, phone, email, coordinates,
 * token or public code. The pet's OWN display name (owner-set) may appear as
 * a concise label; car/luggage stay generic. Never overstates ("found").
 */
export function tagContactPushCopy({ tagType, petName = null, language = "zh" }) {
  const name = tagType === "pet" && typeof petName === "string" && petName.trim() ? petName.trim() : null;
  if (language === "en") {
    if (tagType === "pet") return { title: name ? `Someone contacted you about ${name}` : "Someone contacted you about your pet", body: "Someone used Seen.Pet to contact you. Please check the details." };
    if (tagType === "luggage") return { title: "Someone contacted you about your luggage", body: "Someone used Seen.Luggage to contact you. Please check the details." };
    return { title: "Someone contacted you about your vehicle", body: "Please check the message they left through Seen.Car." };
  }
  if (tagType === "pet") return { title: name ? `有人联系你关于「${name}」` : "有人联系你关于宠物牌", body: "有人通过 Seen.Pet 联系你，请尽快查看。" };
  if (tagType === "luggage") return { title: "有人联系你关于行李牌", body: "有人通过 Seen.Luggage 联系你，请查看详情。" };
  return { title: "有人通过挪车卡联系你", body: "请查看对方留下的信息。" };
}

/**
 * Notify the Tag OWNER that a scanner submitted a MEANINGFUL contact (a QR
 * scan alone never reaches here — see tag.mjs submitContact). Owner UID comes
 * from the tag's own server state; only pet/luggage/car notify. Best-effort,
 * post-commit, never throws. ONE logical event per contact:
 * tag_contact_{contactId} (contactId is already the deterministic per-contact
 * identity, so a retried submission — which never creates a second contact —
 * cannot create a second push). Multi-device fan-out is the shared owner path.
 */
export async function sendTagContactPush({
  db,
  messaging,
  ownerUid,
  tagId,
  tagType,
  contactId,
  petName = null,
  language = "zh",
  now = Date.now(),
}) {
  try {
    if (!db || !ownerUid || !tagId || !contactId) return { ok: false, skipped: "missing_context" };
    if (!TAG_CONTACT_PUSH_TYPES.includes(tagType)) return { ok: false, skipped: "type_excluded" };
    const pushEventId = `tag_contact_${contactId}`;
    const eventRef = db.collection(PUSH_EVENTS_COLLECTION).doc(pushEventId);
    const eventDoc = {
      schemaVersion: 1,
      type: "tag_contact",
      ownerUid,
      subjectTagId: tagId,
      tagType,
      contactId,
      status: "created",
      deviceCount: 0,
      failureCount: 0,
      createdAt: now,
      sentAt: null,
    };
    try {
      await eventRef.create(eventDoc);
    } catch (err) {
      if (err?.code === 6 || /ALREADY_EXISTS/i.test(String(err?.message ?? ""))) {
        plog("tag_contact_push_duplicate", { eventId: pushEventId });
        return { ok: true, duplicate: true, eventId: pushEventId };
      }
      throw err;
    }
    plog("tag_contact_push_created", { eventId: pushEventId, ownerUid, tagId, tagType, contactId });

    const copy = tagContactPushCopy({ tagType, petName, language });
    return await deliverToOwnerDevices({
      db, messaging, ownerUid, eventRef, eventId: pushEventId, sentLog: "tag_contact_push_sent", now,
      buildMessage: (token) => ({
        token,
        notification: { title: copy.title, body: copy.body },
        apns: { payload: { aps: { sound: "default" } } },
        android: { notification: { sound: "default" } },
        // Structured fields drive native tap routing to the EXACT Tag's
        // contact detail; `url` is the web fallback. Only internal ids —
        // NEVER the finder message, phone, email, coordinates or QR code.
        data: {
          type: "tag_contact",
          tagId: String(tagId),
          tagType: String(tagType),
          contactId: String(contactId),
          url: `${PUSH_LINK_BASE}/tag/manage/${encodeURIComponent(String(tagId))}?contact=${encodeURIComponent(String(contactId))}`,
        },
      }),
    });
  } catch (err) {
    plog("tag_contact_push_failed", { reason: String(err?.message ?? "unknown") });
    return { ok: false, error: "tag_contact_push_failed" };
  }
}
