/**
 * Wedding Event / Sender Library backend foundation (Phase 4.5-A).
 *
 * Approved model: Wedding Event → recipient-specific Invitations → one RSVP
 * per Invitation. The Event is the smallest possible anchor — identity +
 * facts + owner. Deliberately NOT stored here:
 *   · no embedded invitation arrays (invitations point at the event),
 *   · no aggregate totals (always DERIVED from invitations — one authority),
 *   · no on_site / post_event payloads yet (future contexts reference the
 *     same eventId with their own artifacts; nothing to migrate later).
 *
 * An Invitation is NOT a new collection: it is the existing Gift record plus
 * optional { eventId, recipientLabel }. Everything already built — token
 * possession, direct/heart_key, presentation, retrieve, revoke, hardening —
 * is inherited untouched. Ordinary gifts and pre-4.5 standalone Wedding
 * gifts never carry these fields and behave exactly as before.
 *
 * Sender authorization rule (every function here): verified Firebase uid,
 * and senderUid === decoded.uid on each touched record. Recipient tokens can
 * never reach these code paths (routes require Authorization), and no
 * response ever includes key material or sealed share credentials.
 */
import crypto from "node:crypto";

export const EVENT_COLLECTION = "events";
export const EVENT_SCHEMA_VERSION = 1;
export const RECIPIENT_LABEL_MAX = 40;
/** Wedding V1 per-household RSVP caps (Founder: 20, not 50). */
export const RSVP_COUNT_MAX = 20;
/** Library page size — a personal sender library, not an admin console. */
export const LIBRARY_LIMIT = 200;

export function generateEventId() {
  return crypto.randomBytes(16).toString("base64url");
}

/** Sender-authored household display identity (张先生全家) — never a contact record. */
export function normalizeRecipientLabel(raw) {
  if (typeof raw !== "string") return { ok: false, error: "invalid_recipient_label" };
  const label = raw.trim();
  if (!label) return { ok: false, error: "invalid_recipient_label" };
  if (label.length > RECIPIENT_LABEL_MAX) {
    return { ok: false, error: "invalid_recipient_label", field: "length" };
  }
  return { ok: true, label };
}

/**
 * RSVP count contract (backend layer; recipient UI arrives in 4.5-B).
 *   accepted + counts: integers ≥ 0, adult ≤ 20, child ≤ 20, 1 ≤ sum ≤ 20.
 *   declined: counts resolve to 0/0 (explicit non-zero counts are rejected).
 *   Legacy calls without counts stay valid: accepted stores no count fields
 *   (never fabricated), declined stores the resolved zeros.
 */
export function validateRsvpCounts(status, body) {
  const rawAdult = body?.adultCount;
  const rawChild = body?.childCount;
  const provided = rawAdult !== undefined || rawChild !== undefined;

  if (!provided) {
    return { ok: true, counts: status === "declined" ? { adultCount: 0, childCount: 0 } : null };
  }
  if (!Number.isInteger(rawAdult) || !Number.isInteger(rawChild)) {
    return { ok: false, error: "invalid_rsvp_counts", field: "type" };
  }
  if (rawAdult < 0 || rawChild < 0) {
    return { ok: false, error: "invalid_rsvp_counts", field: "negative" };
  }
  if (status === "declined") {
    if (rawAdult !== 0 || rawChild !== 0) {
      return { ok: false, error: "invalid_rsvp_counts", field: "declined_nonzero" };
    }
    return { ok: true, counts: { adultCount: 0, childCount: 0 } };
  }
  if (rawAdult > RSVP_COUNT_MAX || rawChild > RSVP_COUNT_MAX) {
    return { ok: false, error: "invalid_rsvp_counts", field: "max" };
  }
  const total = rawAdult + rawChild;
  if (total < 1) return { ok: false, error: "invalid_rsvp_counts", field: "min_total" };
  if (total > RSVP_COUNT_MAX) return { ok: false, error: "invalid_rsvp_counts", field: "max_total" };
  return { ok: true, counts: { adultCount: rawAdult, childCount: rawChild } };
}

/**
 * Resolve the Event an event-based create belongs to. Two intents:
 *   eventCreate: true → silently create the Wedding Event from the sealed
 *     occasion facts (Founder §3: the sender is making a wedding invitation,
 *     never "creating an Event record"). Returns created: true so the caller
 *     can compensate if the seal ultimately fails.
 *   eventId: "…" → attach to the caller's OWN active wedding event.
 */
export async function ensureEvent({ db, decoded, body, occasion, now = Date.now() }) {
  const wantsCreate = body?.eventCreate === true;
  const attachId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  if (wantsCreate && attachId) {
    return { ok: false, res: { status: 400, body: { error: "invalid_event", field: "intent" } } };
  }

  if (wantsCreate) {
    const eventId = generateEventId();
    await db.collection(EVENT_COLLECTION).doc(eventId).set({
      schemaVersion: EVENT_SCHEMA_VERSION,
      type: "wedding",
      senderUid: decoded.uid,
      occasion,
      createdAt: now,
      status: "active",
    });
    return { ok: true, eventId, created: true };
  }

  const snap = await db.collection(EVENT_COLLECTION).doc(attachId).get();
  if (!snap.exists) {
    return { ok: false, res: { status: 404, body: { error: "event_not_found" } } };
  }
  const ev = snap.data();
  if (ev.senderUid !== decoded.uid) {
    return { ok: false, res: { status: 403, body: { error: "forbidden" } } };
  }
  if (ev.type !== "wedding" || ev.status !== "active") {
    return { ok: false, res: { status: 400, body: { error: "invalid_event", field: "status" } } };
  }
  return { ok: true, eventId: attachId, created: false };
}

/** Compensation: remove an event this very call created (never attached ones). */
export async function deleteCreatedEvent({ db, eventId, reason }) {
  try {
    await db.collection(EVENT_COLLECTION).doc(eventId).delete();
  } catch (err) {
    // Orphan events carry no recipient-visible surface; log for manual sweep.
    console.error(`[event] compensation delete failed (${reason}) ${eventId}:`, err?.message);
  }
}

// --- Sender-facing read model ------------------------------------------------

/** RSVP echo shared by library rows and event detail (flat legacy fields in, object out). */
function rsvpOf(rec) {
  if (!rec.rsvpStatus) return null;
  return {
    status: rec.rsvpStatus,
    ...(typeof rec.rsvpAdultCount === "number" ? { adultCount: rec.rsvpAdultCount } : {}),
    ...(typeof rec.rsvpChildCount === "number" ? { childCount: rec.rsvpChildCount } : {}),
    respondedAt: rec.rsvpAt ?? null,
  };
}

/**
 * One sender-safe row per gift. NEVER includes: raw token, keySalt/keyHash,
 * shareTokenSealed, or message plaintext (list rows stay minimal — the
 * sender re-opens content through their own share link).
 */
function libraryRow(id, rec, now) {
  return {
    giftId: id,
    createdAt: rec.createdAt,
    accessMode: rec.accessMode ?? "heart_key",
    revoked: Boolean(rec.revoked),
    expired: typeof rec.expiresAt === "number" ? now > rec.expiresAt : false,
    ...(rec.occasion
      ? {
          occasion: {
            type: rec.occasion.type,
            couple: rec.occasion.couple,
            date: rec.occasion.date,
            venueName: rec.occasion.venue?.displayName ?? null,
          },
        }
      : {}),
    ...(rec.eventId ? { eventId: rec.eventId } : {}),
    ...(rec.recipientLabel ? { recipientLabel: rec.recipientLabel } : {}),
    rsvp: rsvpOf(rec),
    shareRecoverable: Boolean(rec.shareTokenSealed),
  };
}

/**
 * POST /sender/library — everything I sent, newest first: my Events plus my
 * gifts (event invitations AND standalone/ordinary — 单独封存的心意 listed
 * honestly with shareRecoverable:false). Uses the senderUid single-field
 * auto-index; sorting happens in the Lambda so NO new Firestore index is
 * required (personal volumes, capped at LIBRARY_LIMIT).
 */
export async function senderLibrary({ db, decoded, giftCollection, now = Date.now() }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };

  const [giftSnap, eventSnap] = await Promise.all([
    db.collection(giftCollection).where("senderUid", "==", decoded.uid).get(),
    db.collection(EVENT_COLLECTION).where("senderUid", "==", decoded.uid).get(),
  ]);

  const gifts = (giftSnap.docs ?? [])
    .map((d) => libraryRow(d.id, d.data(), now))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, LIBRARY_LIMIT);

  const events = (eventSnap.docs ?? [])
    .map((d) => {
      const ev = d.data();
      return {
        eventId: d.id,
        type: ev.type,
        status: ev.status,
        createdAt: ev.createdAt,
        occasion: {
          couple: ev.occasion?.couple,
          date: ev.occasion?.date,
          venueName: ev.occasion?.venue?.displayName ?? null,
        },
      };
    })
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));

  return { status: 200, body: { events, gifts } };
}

/**
 * POST /sender/event/detail — the Event, its Invitations, and the DERIVED
 * aggregate (single authority: the invitation records themselves).
 * Revoked invitations stay listed (flagged) but never count toward totals.
 */
export async function eventDetail({ db, decoded, body, giftCollection, now = Date.now() }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };
  const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  if (!eventId) return { status: 400, body: { error: "invalid_request" } };

  const snap = await db.collection(EVENT_COLLECTION).doc(eventId).get();
  if (!snap.exists) return { status: 404, body: { error: "event_not_found" } };
  const ev = snap.data();
  if (ev.senderUid !== decoded.uid) return { status: 403, body: { error: "forbidden" } };

  const invSnap = await db.collection(giftCollection).where("eventId", "==", eventId).get();
  const invitations = (invSnap.docs ?? [])
    .map((d) => ({ id: d.id, rec: d.data() }))
    // Defense in depth — an event's invitations are by construction the
    // owner's, but never rely on construction alone.
    .filter(({ rec }) => rec.senderUid === decoded.uid)
    .sort((a, b) => (a.rec.createdAt ?? 0) - (b.rec.createdAt ?? 0));

  const aggregate = {
    adultTotal: 0,
    childTotal: 0,
    attendingTotal: 0,
    acceptedGroups: 0,
    declinedGroups: 0,
    pendingGroups: 0,
  };
  for (const { rec } of invitations) {
    if (rec.revoked) continue; // a withdrawn invitation carries no expectation
    if (rec.rsvpStatus === "accepted") {
      aggregate.acceptedGroups += 1;
      // Sum only counts that actually exist — never fabricate from legacy
      // count-less accepts.
      if (typeof rec.rsvpAdultCount === "number") aggregate.adultTotal += rec.rsvpAdultCount;
      if (typeof rec.rsvpChildCount === "number") aggregate.childTotal += rec.rsvpChildCount;
    } else if (rec.rsvpStatus === "declined") {
      aggregate.declinedGroups += 1;
    } else {
      aggregate.pendingGroups += 1;
    }
  }
  aggregate.attendingTotal = aggregate.adultTotal + aggregate.childTotal;

  return {
    status: 200,
    body: {
      event: {
        eventId,
        type: ev.type,
        status: ev.status,
        createdAt: ev.createdAt,
        occasion: ev.occasion,
      },
      invitations: invitations.map(({ id, rec }) => libraryRow(id, rec, now)),
      aggregate,
    },
  };
}

/**
 * POST /sender/gift/share — the ONLY door that returns a raw share token,
 * and only to the authenticated owner, explicitly, per gift. Old records
 * without a sealed credential are honestly unrecoverable (404) — security
 * is never weakened to conjure their links back.
 */
export async function recoverShare({ db, decoded, body, giftCollection, shareCrypto, now = Date.now() }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };
  const giftId = typeof body?.giftId === "string" ? body.giftId.trim() : "";
  if (!giftId) return { status: 400, body: { error: "invalid_request" } };

  const snap = await db.collection(giftCollection).doc(giftId).get();
  if (!snap.exists) return { status: 404, body: { error: "not_found" } };
  const rec = snap.data();
  if (rec.senderUid !== decoded.uid) return { status: 403, body: { error: "forbidden" } };
  if (rec.revoked) return { status: 410, body: { error: "revoked" } };
  if (typeof rec.expiresAt === "number" && now > rec.expiresAt) {
    return { status: 410, body: { error: "expired" } };
  }
  if (!rec.shareTokenSealed) return { status: 404, body: { error: "share_unrecoverable" } };
  if (!shareCrypto) return { status: 503, body: { error: "share_unavailable" } };

  let token;
  try {
    token = await shareCrypto.open(rec.shareTokenSealed, giftId);
  } catch (err) {
    console.error(`[event] share recover failed ${giftId.slice(0, 8)}…:`, err?.message);
    return { status: 502, body: { error: "share_recover_failed" } };
  }
  return {
    status: 200,
    body: {
      token,
      accessMode: rec.accessMode ?? "heart_key",
      ...(rec.eventId ? { eventId: rec.eventId } : {}),
      ...(rec.recipientLabel ? { recipientLabel: rec.recipientLabel } : {}),
    },
  };
}
