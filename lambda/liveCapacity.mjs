/**
 * liveCapacity.mjs — Live Interaction participant-capacity billing (Phase 3).
 *
 * LOCKED commercial model (2026-09-04): the ORGANIZER buys participant
 * capacity per capability BEFORE the capability is used; participants join,
 * answer and message FREE within that capacity. Prices live ONLY in the
 * billing registry (live_draw_capacity 100 · live_guess_capacity 100 ·
 * live_guestbook_capacity 50). No bundles in V1 — each capability owns its
 * own pool.
 *
 * State:
 *   liveCapacity/{sessionId}__{capability}
 *     { purchased, used, ownerUid, … } — purchased grows by owner purchases
 *     (additive, already-bought seats are never recharged); used grows by
 *     seat consumption.
 *   liveSeats/{sessionId}__{capability}__{participantIdHash}
 *     one doc per HUMAN per capability — the deterministic id makes seat
 *     consumption idempotent by construction: repeated actions (three
 *     guestbook messages, a retried claim, a second quiz answer) can never
 *     take a second seat.
 *
 * Enforcement applies ONLY to sessions that carry billingRequired:true
 * (stamped at creation by a billing-aware client). Sessions created before
 * Phase 3 activation have no marker and stay free — billing is never
 * retroactive (Founder §20).
 *
 * Concurrency (tagPublishAuth lesson): capacity state participates in the
 * SAME Firestore transaction as the record it authorizes — the purchase
 * guard runs inside the charge transaction, and seat consumption commits
 * atomically with the entrant/answer/message create. Two racing claimants of
 * the last seat serialize on the capacity doc: the loser retries, re-reads
 * used === purchased, and gets capacity_full with zero writes.
 */
import { chargeCredits, IDEMPOTENCY_KEY_RE } from "./billing.mjs";
import { LIVE_SESSION_COLLECTION } from "./onsite.mjs";

export const LIVE_CAPACITY_COLLECTION = "liveCapacity";
export const LIVE_SEAT_COLLECTION = "liveSeats";
export const LIVE_CAPACITY_MAX_SEATS_PER_PURCHASE = 1000;

/** Capability → billing product (registry is the ONLY price authority). */
export const CAPACITY_PRODUCT_BY_CAPABILITY = {
  lucky_draw: "live_draw_capacity",
  live_quiz: "live_guess_capacity",
  live_guestbook: "live_guestbook_capacity",
};

export const capacityDocId = (sessionId, capability) => `${sessionId}__${capability}`;
export const seatDocId = (sessionId, capability, participantIdHash) =>
  `${sessionId}__${capability}__${participantIdHash}`;

/**
 * Does this session enforce purchased capacity? True only for sessions a
 * billing-aware client created (billingRequired stamped at create). Absent
 * doc or absent flag → legacy/free (never retroactive).
 */
export async function capacityRequired({ db, sessionId }) {
  if (!sessionId) return false;
  const snap = await db.collection(LIVE_SESSION_COLLECTION).doc(sessionId).get();
  return snap.exists && snap.data()?.billingRequired === true;
}

/**
 * POST /sender/live action:"capacity_purchase" — owner buys seats.
 * Server-authoritative: price = registry[capability] × seats; idempotent via
 * the client idempotencyKey (a retry returns the ORIGINAL purchase, never a
 * second charge or a second increment — the purchase guard is skipped on the
 * duplicate path by construction). Additive: a later purchase with a NEW key
 * charges only the added seats.
 */
export async function purchaseLiveCapacity({ db, decoded, body, now = Date.now() }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
  const capability = typeof body?.capability === "string" ? body.capability.trim() : "";
  const product = CAPACITY_PRODUCT_BY_CAPABILITY[capability];
  if (!sessionId || !product) {
    return { status: 400, body: { error: "invalid_request", field: sessionId ? "capability" : "sessionId" } };
  }
  const seats = body?.seats;
  if (!Number.isInteger(seats) || seats < 1 || seats > LIVE_CAPACITY_MAX_SEATS_PER_PURCHASE) {
    return { status: 400, body: { error: "invalid_request", field: "seats" } };
  }
  const idem = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!IDEMPOTENCY_KEY_RE.test(idem)) {
    return { status: 400, body: { error: "invalid_idempotency_key" } };
  }

  const sessSnap = await db.collection(LIVE_SESSION_COLLECTION).doc(sessionId).get();
  if (!sessSnap.exists) return { status: 404, body: { error: "session_not_found" } };
  const session = sessSnap.data();
  if (session.ownerUid !== decoded.uid) return { status: 403, body: { error: "forbidden" } };
  if (session.status !== "active") return { status: 409, body: { error: "session_ended" } };
  if (!Array.isArray(session.capabilities) || !session.capabilities.includes(capability)) {
    return { status: 400, body: { error: "invalid_request", field: "capability" } };
  }

  const capRef = db.collection(LIVE_CAPACITY_COLLECTION).doc(capacityDocId(sessionId, capability));
  const res = await chargeCredits({
    db,
    uid: decoded.uid,
    product,
    idempotencyKey: idem,
    quantity: seats,
    subjectId: capacityDocId(sessionId, capability),
    // The capacity increment is the purchase's domain effect and rides the
    // SAME transaction as the ledger entry: charged-without-seats and
    // seats-without-charge are both structurally impossible.
    guard: async (tx) => {
      const snap = await tx.get(capRef);
      const cur = snap.exists ? snap.data() : null;
      if (cur && cur.ownerUid !== decoded.uid) return { ok: false, error: "forbidden" };
      const doc = {
        schemaVersion: 1,
        sessionId,
        capability,
        ownerUid: decoded.uid,
        purchased: (cur?.purchased ?? 0) + seats,
        used: cur?.used ?? 0,
        createdAt: cur?.createdAt ?? now,
        updatedAt: now,
      };
      return { ok: true, writes: [{ kind: "set", ref: capRef, data: doc }] };
    },
    meta: { sessionId, capability, seats },
    now,
  });

  if (!res.ok) {
    if (res.error === "insufficient_credits") {
      return {
        status: 402,
        body: { error: "insufficient_credits", free: res.free, paid: res.paid, needed: res.needed },
      };
    }
    return { status: 400, body: { error: res.error ?? "billing_failed" } };
  }

  const after = await capRef.get();
  const cap = after.exists ? after.data() : { purchased: 0, used: 0 };
  return {
    status: 200,
    body: {
      ok: true,
      duplicate: res.duplicate === true,
      sessionId,
      capability,
      purchased: cap.purchased ?? 0,
      used: cap.used ?? 0,
      ...(res.balances ? { balances: res.balances } : {}),
    },
  };
}

/** POST /sender/live action:"capacity_state" — owner reads all pools. */
export async function liveCapacityState({ db, decoded, body }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
  if (!sessionId) return { status: 400, body: { error: "invalid_request", field: "sessionId" } };
  const sessSnap = await db.collection(LIVE_SESSION_COLLECTION).doc(sessionId).get();
  if (!sessSnap.exists) return { status: 404, body: { error: "session_not_found" } };
  const session = sessSnap.data();
  if (session.ownerUid !== decoded.uid) return { status: 403, body: { error: "forbidden" } };

  const capabilities = {};
  for (const capability of Object.keys(CAPACITY_PRODUCT_BY_CAPABILITY)) {
    const snap = await db
      .collection(LIVE_CAPACITY_COLLECTION)
      .doc(capacityDocId(sessionId, capability))
      .get();
    const c = snap.exists ? snap.data() : null;
    capabilities[capability] = { purchased: c?.purchased ?? 0, used: c?.used ?? 0 };
  }
  return {
    status: 200,
    body: { sessionId, billingRequired: session.billingRequired === true, capabilities },
  };
}

/**
 * Transactional seat phase for participant paths. READ step (call during the
 * transaction's read phase):
 *   const seat = await readSeatPhase({ db, tx, sessionId, capability, participantIdHash });
 *   if (!seat.ok) → refuse with { error: "capacity_full" } (zero writes)
 * WRITE step (only after every other read, alongside the participant's own
 * doc create):
 *   applySeatConsume({ tx, seat, now });
 * A participant who already holds a seat consumes nothing (idempotent by the
 * deterministic seat doc id). Callers gate on billingRequired BEFORE using
 * this — legacy sessions never reach it.
 */
export async function readSeatPhase({ db, tx, sessionId, capability, participantIdHash, now = Date.now() }) {
  const seatRef = db
    .collection(LIVE_SEAT_COLLECTION)
    .doc(seatDocId(sessionId, capability, participantIdHash));
  const capRef = db.collection(LIVE_CAPACITY_COLLECTION).doc(capacityDocId(sessionId, capability));
  const [seatSnap, capSnap] = await Promise.all([tx.get(seatRef), tx.get(capRef)]);
  if (seatSnap.exists) return { ok: true, consume: false };
  const cap = capSnap.exists ? capSnap.data() : null;
  const purchased = cap?.purchased ?? 0;
  const used = cap?.used ?? 0;
  if (used >= purchased) return { ok: false, error: "capacity_full" };
  return {
    ok: true,
    consume: true,
    seatRef,
    capRef,
    seatDoc: {
      schemaVersion: 1,
      sessionId,
      capability,
      participantIdHash,
      createdAt: now,
    },
    capUpdate: { used: used + 1, updatedAt: now },
  };
}

export function applySeatConsume({ tx, seat }) {
  if (!seat?.consume) return;
  tx.create(seat.seatRef, seat.seatDoc);
  tx.update(seat.capRef, seat.capUpdate);
}
