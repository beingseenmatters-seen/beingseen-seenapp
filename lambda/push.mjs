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

/**
 * Notification type registry. IMPLEMENTED: quick_reply. The rest are
 * reserved names so later phases extend this enum instead of inventing
 * parallel systems — they must NOT send in Phase 1.
 */
export const PUSH_TYPES = Object.freeze([
  "quick_reply",
  // reserved for later phases (design-only, no senders exist):
  "rsvp_received",
  "tag_scan_contact",
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

    if (!messaging) {
      await eventRef.update({ status: "skipped_no_messaging", sentAt: now });
      plog("push_send_failed", { eventId, reason: "messaging_unavailable" });
      return { ok: false, eventId, skipped: "messaging_unavailable" };
    }

    // The OWNER's devices only — server-side gift ownership is the sole
    // authority for targeting; nothing recipient-side is ever addressable.
    const userSnap = await db.collection(USERS_COLLECTION).doc(ownerUid).get();
    const tokens = (userSnap.exists ? userSnap.data().fcmTokens : null) ?? [];
    const registered = tokens.filter((t) => t && typeof t.token === "string" && t.token && t.enabled !== false);
    // App-identity targeting (correction §2/§5): this is a Gift.Seen event —
    // notify the owner's Gift.Seen devices (all of them: multi-device fan-out
    // of ONE logical event). ONLY when no Gift.Seen device exists fall back
    // to legacy tokens (pre-`app` Seen registrations) so historical senders
    // keep coverage. Never both families — no cross-app double notification.
    const giftseenDevices = registered.filter((t) => t.app === "giftseen");
    const active = giftseenDevices.length > 0 ? giftseenDevices : registered;
    if (active.length === 0) {
      await eventRef.update({ status: "no_devices", sentAt: now });
      plog("quick_reply_push_sent", { eventId, deviceCount: 0, note: "no_devices" });
      return { ok: true, eventId, deviceCount: 0 };
    }

    const copy = quickReplyPushCopy({ signature, language });
    const deadTokens = [];
    let sent = 0;
    let failed = 0;
    for (const t of active) {
      try {
        await messaging.send({
          token: t.token,
          notification: { title: copy.title, body: copy.body },
          // Audible by default (2026-09-07): a top-level `notification` alone
          // builds an APNs `aps` with NO `sound` key → a silent banner. Ask
          // for the NORMAL default sound explicitly on each platform. This is
          // a standard notification sound — never a critical alert (no
          // entitlement, no `critical`/volume). OS/user settings still win
          // (silent switch, Focus/DND, per-app Sounds off). On Android 8+ the
          // notification CHANNEL governs sound; this message-level value is
          // the fallback where no channel overrides it.
          apns: { payload: { aps: { sound: "default" } } },
          android: { notification: { sound: "default" } },
          // Data values must be strings (FCM contract). The url is a web
          // fallback destination (sender's library, where replies live);
          // native tap-routing consumes it in a later phase.
          // Structured fields are the authority for native tap routing;
          // `url` is the web fallback deep link. Both land the sender on the
          // EXACT replied gift's reply list (never the recipient reveal).
          data: {
            type: "quick_reply",
            giftId: String(giftId ?? ""),
            replyId: String(replyId),
            url: `${PUSH_LINK_BASE}/library?gift=${encodeURIComponent(String(giftId ?? ""))}&view=replies&reply=${encodeURIComponent(String(replyId))}`,
          },
        });
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

    // Prune permanently dead tokens from the SHARED registry (operational
    // data; a best-effort update — a racing registration simply re-adds).
    if (deadTokens.length > 0 && userSnap.exists) {
      try {
        const remaining = (userSnap.data().fcmTokens ?? []).filter((t) => !deadTokens.includes(t?.token));
        await db.collection(USERS_COLLECTION).doc(ownerUid).update({ fcmTokens: remaining });
        plog("push_token_removed", { ownerUid, removed: deadTokens.length });
      } catch (err) {
        plog("push_send_partial_failure", { eventId, code: "token_prune_failed" });
      }
    }

    const status = sent > 0 ? (failed > 0 ? "partial" : "sent") : "failed";
    await eventRef.update({ status, deviceCount: sent, failureCount: failed, sentAt: now });
    plog("quick_reply_push_sent", { eventId, deviceCount: sent, failureCount: failed, invalidated: deadTokens.length });
    return { ok: true, eventId, deviceCount: sent, failureCount: failed };
  } catch (err) {
    // Best-effort by contract: the reply is already saved; never rethrow.
    plog("push_send_failed", { reason: String(err?.message ?? "unknown") });
    return { ok: false, error: "push_send_failed" };
  }
}
