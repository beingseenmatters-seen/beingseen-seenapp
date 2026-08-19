/**
 * Shared-link RSVP — one response per SCANNER, not per link.
 *
 * A direct-share invitation is ONE record forwarded to many people. Collecting
 * an RSVP on the invitation record itself would therefore store whatever the
 * first scanner typed and lock everyone after them out — the host would learn
 * one person's answer presented as the answer. This module gives each scanner
 * their own response instead, so a forwarded link can carry real attendance.
 *
 * Identity (mirrors the Wedding Day draw, onsite.mjs):
 *   · the client holds a random participantToken; the server stores ONLY its
 *     SHA-256. No account, no phone, no fingerprinting.
 *   · doc id = `${tokenHash}_${participantIdHash}`, so a participant has
 *     exactly one response per invitation and re-submitting UPDATES it — a
 *     changed mind can never become a second head-count.
 *
 * Boundaries:
 *   · guest capability = possession of the shared invitation token, the same
 *     credential that opened it;
 *   · MANAGED household invitations are refused here — they already own a
 *     per-household RSVP on their own record;
 *   · on_site records are refused — the Wedding Day experience is not an
 *     invitation;
 *   · these responses are aggregated SEPARATELY from households, so §12 holds:
 *     a shared link still never masquerades as household statistics.
 */
import crypto from "node:crypto";
import { validateRsvpCounts, validateRsvpDietary, validateRsvpMessage } from "./event.mjs";

export const SHARED_RSVP_COLLECTION = "sharedRsvp";

const sha256Hex = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const PARTICIPANT_RE = /^[A-Za-z0-9_-]{16,64}$/;

/** Mint a participant identity for a first-time scanner. */
export function mintParticipantToken() {
  return crypto.randomBytes(24).toString("base64url");
}

/**
 * Resolve the shared invitation this response belongs to. Answers 404 for
 * anything that is not an open shared invitation, without leaking which.
 */
export async function sharedInvitationByToken({ db, giftCollection, token, now }) {
  if (!token) return { res: { status: 400, body: { error: "invalid_request" } } };
  const tokenHash = sha256Hex(token);
  const snap = await db.collection(giftCollection).doc(tokenHash).get();
  if (!snap.exists) return { res: { status: 404, body: { error: "not_found" } } };
  const rec = snap.data();
  if (rec.contextRole === "on_site") return { res: { status: 409, body: { error: "rsvp_not_applicable" } } };
  // A managed household answers on its own record, never here.
  if (rec.sharedDistribution !== true) return { res: { status: 409, body: { error: "not_shared" } } };
  if (rec.revoked) return { res: { status: 410, body: { error: "revoked" } } };
  if (rec.expiresAt && now > rec.expiresAt) return { res: { status: 410, body: { error: "expired" } } };
  return { rec, tokenHash };
}

const shape = (d) =>
  d
    ? {
        status: d.status,
        ...(typeof d.adultCount === "number" ? { adultCount: d.adultCount } : {}),
        ...(typeof d.childCount === "number" ? { childCount: d.childCount } : {}),
        ...(d.dietaryRequirements ? { dietaryRequirements: d.dietaryRequirements } : {}),
        ...(d.recipientMessage ? { recipientMessage: d.recipientMessage } : {}),
        respondedAt: d.updatedAt ?? d.createdAt ?? null,
      }
    : null;

/**
 * POST /gift/rsvp/shared — create or update THIS scanner's response.
 *
 * A first-time scanner sends no participantToken and receives a minted one to
 * keep; every later submission carries it and updates the same response.
 * Absent dietary/message mean UNCHANGED, matching the household contract.
 */
export async function submitSharedRsvp({ db, body, giftCollection, now = Date.now() }) {
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const found = await sharedInvitationByToken({ db, giftCollection, token, now });
  if (found.res) return found.res;
  return submitSharedRsvpForRecord({ db, body, rec: found.rec, tokenHash: found.tokenHash, now });
}

/**
 * The same logic, entered from an ALREADY-RESOLVED record.
 *
 * /gift/rsvp delegates here when the invitation is a shared link, so the whole
 * feature rides on the existing route. Deliberate: API Gateway is configured
 * per-route, so a new path would need an infrastructure change — and one door
 * for "answer this invitation" is the better contract anyway.
 */
export async function submitSharedRsvpForRecord({ db, body, rec, tokenHash, now = Date.now() }) {

  let participantToken =
    typeof body?.participantToken === "string" ? body.participantToken.trim() : "";
  let minted = false;
  if (!participantToken) {
    participantToken = mintParticipantToken();
    minted = true;
  } else if (!PARTICIPANT_RE.test(participantToken)) {
    return { status: 400, body: { error: "invalid_participant" } };
  }
  const participantIdHash = sha256Hex(participantToken);
  const ref = db.collection(SHARED_RSVP_COLLECTION).doc(`${tokenHash}_${participantIdHash}`);
  const prevSnap = await ref.get();
  const prev = prevSnap.exists ? prevSnap.data() : null;

  const status =
    body?.status === "accepted" || body?.status === "declined" ? body.status : null;
  const messageOnly = !status && body?.recipientMessage !== undefined;
  if (!status && !messageOnly) return { status: 400, body: { error: "invalid_request" } };
  if (messageOnly && !prev) return { status: 409, body: { error: "no_response_yet" } };

  const effectiveStatus = status ?? prev.status;
  const counts = validateRsvpCounts(effectiveStatus, body);
  if (!counts.ok) return { status: 400, body: { error: counts.error, field: counts.field } };
  const dietary = validateRsvpDietary(effectiveStatus, body);
  if (!dietary.ok) return { status: 400, body: { error: dietary.error, field: dietary.field } };
  const msg = validateRsvpMessage(body);
  if (!msg.ok) return { status: 400, body: { error: msg.error, field: msg.field } };

  const answer = status
    ? {
        status,
        // Absent counts CLEAR, exactly as on a household record: an answer
        // never inherits the arithmetic of the answer it replaced.
        adultCount: counts.counts ? counts.counts.adultCount : null,
        childCount: counts.counts ? counts.counts.childCount : null,
      }
    : {};
  const next = {
    schemaVersion: 1,
    giftId: tokenHash,
    eventId: rec.eventId ?? null,
    participantIdHash,
    ...(prev ?? {}),
    ...answer,
    ...(body?.dietaryRequirements !== undefined ? { dietaryRequirements: dietary.dietary } : {}),
    ...(msg.message !== undefined ? { recipientMessage: msg.message } : {}),
    createdAt: prev?.createdAt ?? now,
    updatedAt: now,
    // Housekeeping parity with the invitation itself.
    expiresAt: rec.expiresAt ?? null,
  };
  await ref.set(next);

  return {
    status: 200,
    body: {
      ok: true,
      ...(minted ? { participantToken } : {}),
      response: shape(next),
    },
  };
}

/** POST /gift/rsvp/shared/mine — this scanner's own response, for a re-scan. */
export async function readSharedResponse({ db, tokenHash, participantToken }) {
  const pt = typeof participantToken === "string" ? participantToken.trim() : "";
  if (!PARTICIPANT_RE.test(pt)) return null;
  const snap = await db
    .collection(SHARED_RSVP_COLLECTION)
    .doc(`${tokenHash}_${sha256Hex(pt)}`)
    .get();
  return snap.exists ? shape(snap.data()) : null;
}

/**
 * Sender view: every response left through an Event's shared links, kept in
 * its own bucket so household statistics are never inflated by a forwarded
 * link (§12). Returns { responses, aggregate }.
 */
export async function sharedResponsesForEvent({ db, eventId, sharedGiftIds }) {
  if (!eventId || !sharedGiftIds || sharedGiftIds.size === 0) {
    return {
      responses: [],
      aggregate: { replies: 0, adultTotal: 0, childTotal: 0, attendingTotal: 0, accepted: 0, declined: 0 },
    };
  }
  const snap = await db.collection(SHARED_RSVP_COLLECTION).where("eventId", "==", eventId).get();
  const responses = (snap.docs ?? [])
    .map((d) => d.data())
    .filter((d) => sharedGiftIds.has(d.giftId))
    .sort((a, b) => (a.updatedAt ?? 0) - (b.updatedAt ?? 0))
    .map(shape);
  const aggregate = responses.reduce(
    (acc, r) => {
      acc.replies += 1;
      if (r.status === "accepted") {
        acc.accepted += 1;
        acc.adultTotal += r.adultCount ?? 0;
        acc.childTotal += r.childCount ?? 0;
        acc.attendingTotal += (r.adultCount ?? 0) + (r.childCount ?? 0);
      } else if (r.status === "declined") acc.declined += 1;
      return acc;
    },
    { replies: 0, adultTotal: 0, childTotal: 0, attendingTotal: 0, accepted: 0, declined: 0 },
  );
  return { responses, aggregate };
}
