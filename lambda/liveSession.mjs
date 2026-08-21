/**
 * Seen — Live Interaction: the LiveSession authoritative object (V1).
 *
 * Live Interaction OWNS Lucky Draw (Founder, 2026-08-20). A LiveSession is a
 * first-class sender-owned object — NOT a Gift, NOT an Invitation. Its
 * participation QR resolves to the SESSION, never to a Wedding Invitation, so
 * a host who never used Seen.Events can still run a draw.
 *
 *   Standalone: Home → Live Interaction → Lucky Draw → creates a session with
 *               a fresh `ls_…` id and its own participation QR. No Event, no
 *               Guest List, no Invitation history required.
 *   Linked:     a Seen.Events Event opens a session with sessionId === eventId,
 *               so the existing draw/entrant/on_site records are already keyed
 *               correctly (zero migration) and Wedding Day keeps working.
 *
 * The Lucky Draw ENGINE (configureDraw / drawWinner / claimLuckyCode …) lives
 * in onsite.mjs and is UNCHANGED — one winner engine, keyed by the opaque
 * session key. This module only owns the session object + the standalone
 * participation surface, and delegates every draw operation to that engine.
 */

import crypto from "node:crypto";
import { EVENT_COLLECTION } from "./event.mjs";
import { finalizePresentation } from "./giftMedia.mjs";
import {
  LIVE_SESSION_COLLECTION,
  ONSITE_CONTEXT_ROLE,
  DRAW_COLLECTION,
  configureDraw,
  openDraw,
  lockDraw,
  listEntrants,
  drawWinner,
  guestbookInbox,
  guestbookModerate,
  guestbookDisplay,
  quizConfigure,
  quizControl,
  quizOwnerState,
} from "./onsite.mjs";

const sha256Hex = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const mintToken = () => crypto.randomBytes(16).toString("base64url");
const mintSessionId = () => `ls_${crypto.randomBytes(12).toString("base64url")}`;

const TITLE_MAX = 80;
const HOST_LABEL_MAX = 80;
const SESSION_MESSAGE_MAX = 2000;
const SESSION_TTL_MS = 365 * 24 * 60 * 60 * 1000;
// V1 capabilities. A standalone session carries the ONE capability the host
// chose at create; a linked Wedding carries both (an Event supports draw AND
// guestbook). Quiz is still RESERVED.
export const LIVE_CAPABILITIES = ["lucky_draw"];
export const ALL_LIVE_CAPABILITIES = ["lucky_draw", "live_guestbook", "live_quiz"];
const capabilityFor = (raw) =>
  raw === "live_guestbook" ? ["live_guestbook"] : raw === "live_quiz" ? ["live_quiz"] : ["lucky_draw"];
export const LIVE_SKINS = ["neutral", "wedding"];

const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/**
 * POST /sender/live (action:"create") — create a Live Session.
 *   standalone: { title, hostLabel? }         → fresh ls_ id + participation QR
 *   linked:     { eventId }                    → sessionId === eventId, wedding skin
 * Idempotent for the linked case (re-opening returns the existing session).
 */
export async function createLiveSession({
  db, decoded, body, share = null, media = null, giftCollection, publicBaseUrl, now = Date.now(),
}) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };

  const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";

  // --- Linked mode: an existing owned Event opens a session (sessionId=eventId).
  if (eventId) {
    const evSnap = await db.collection(EVENT_COLLECTION).doc(eventId).get();
    if (!evSnap.exists) return { status: 404, body: { error: "event_not_found" } };
    const ev = evSnap.data();
    if (ev.senderUid !== decoded.uid) return { status: 403, body: { error: "forbidden" } };

    const ref = db.collection(LIVE_SESSION_COLLECTION).doc(eventId);
    const existing = await ref.get();
    if (existing.exists) {
      return { status: 200, body: { existing: true, sessionId: eventId, eventId } };
    }
    const title = clean(ev.occasion?.eventTitle, TITLE_MAX) || clean(body?.title, TITLE_MAX) || "Live";
    const session = {
      schemaVersion: 1,
      sessionId: eventId,
      ownerUid: decoded.uid,
      eventId,
      title,
      hostLabel: clean(body?.hostLabel, HOST_LABEL_MAX) || null,
      // A linked Event supports BOTH the draw and the guestbook.
      capabilities: ALL_LIVE_CAPABILITIES,
      // Linked sessions may inherit their Event's presentation identity; the
      // engines never branch on it — skin is display-only.
      skin: ev.type === "wedding" ? "wedding" : "neutral",
      occasion: ev.occasion ?? null,
      status: "active",
      createdAt: now,
      updatedAt: now,
    };
    await ref.set(session);
    return { status: 200, body: { existing: false, sessionId: eventId, eventId, skin: session.skin } };
  }

  // --- Standalone mode: no Event, no Invitation. Mint an id + participation QR.
  const title = clean(body?.title, TITLE_MAX);
  if (!title) return { status: 400, body: { error: "invalid_request", field: "title" } };
  if (!share) return { status: 503, body: { error: "share_unavailable" } };
  const hostLabel = clean(body?.hostLabel, HOST_LABEL_MAX) || null;
  const message = clean(body?.message, SESSION_MESSAGE_MAX) || title;

  const sessionId = mintSessionId();

  // Participation QR — an on_site-style record (reuses the token/tokenHash/
  // revoke primitives) keyed by the SESSION, not a Wedding Event. It carries
  // requireBlessing:false: a standalone Lucky Draw has no Guestbook gate.
  const token = mintToken();
  const tokenHash = sha256Hex(token);
  let shareTokenSealed;
  try {
    shareTokenSealed = await share.seal(token, tokenHash);
  } catch (err) {
    console.error("[live] share seal failed:", err?.message);
    return { status: 503, body: { error: "share_seal_failed" } };
  }

  let presentation = null;
  if (body?.presentation !== undefined && body?.presentation !== null) {
    const fin = await finalizePresentation({
      store: media, decoded, presentation: body.presentation, tokenHash,
      allowedMusicThemes: [], resolveReuse: async () => ({ ok: false, status: 400, body: { error: "invalid_media" } }),
    });
    if (!fin.ok) return { status: fin.status, body: fin.body };
    presentation = fin.presentation;
  }

  // Lucky Draw mode is the user's choice at create (Lucky Number vs Lucky Ball).
  // The host control reads it back and configures the draw with it; the shared
  // winner engine is identical for both — mode only steers identity + ceremony.
  const mode = body?.mode === "lucky_ball" ? "lucky_ball" : "lucky_number";

  const session = {
    schemaVersion: 1,
    sessionId,
    ownerUid: decoded.uid,
    eventId: null,
    title,
    hostLabel,
    mode,
    // Standalone: the capability the host chose (Lucky Draw OR Live Guestbook).
    capabilities: capabilityFor(body?.capability),
    skin: "neutral",
    participationGiftId: tokenHash,
    status: "active",
    createdAt: now,
    updatedAt: now,
  };
  await db.collection(LIVE_SESSION_COLLECTION).doc(sessionId).set(session);

  const record = {
    schemaVersion: 1,
    senderUid: decoded.uid,
    contextRole: ONSITE_CONTEXT_ROLE,
    // The session key lives in `eventId` (opaque) so the shared engine + guest
    // doors resolve it exactly as they do for a Wedding.
    eventId: sessionId,
    sessionId,
    requireBlessing: false, // standalone Lucky Draw: token possession is eligibility
    skin: "neutral",
    accessMode: "direct",
    message,
    region: "GLOBAL",
    createdAt: now,
    expiresAt: now + SESSION_TTL_MS,
    redeemedAt: null,
    revoked: false,
    failedAttempts: 0,
    lockedUntil: null,
    cooldownTier: 0,
    ...(presentation ? { presentation } : {}),
    shareTokenSealed,
  };
  await db.collection(giftCollection).doc(tokenHash).set(record);

  return {
    status: 200,
    body: {
      existing: false,
      sessionId,
      token,
      url: `${publicBaseUrl}/s/${token}`,
      participationGiftId: tokenHash,
      skin: "neutral",
    },
  };
}

/** POST /sender/live (action:"list") — My Live Sessions, newest first. */
export async function listLiveSessions({ db, decoded, now = Date.now() }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };
  const snap = await db.collection(LIVE_SESSION_COLLECTION).where("ownerUid", "==", decoded.uid).get();
  const sessions = (snap.docs ?? [])
    .map((d) => d.data())
    .map((s) => ({
      sessionId: s.sessionId,
      title: s.title,
      hostLabel: s.hostLabel ?? null,
      eventId: s.eventId ?? null,
      mode: s.mode ?? "lucky_number",
      skin: s.skin ?? "neutral",
      status: s.status ?? "active",
      createdAt: s.createdAt,
    }))
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0));
  return { status: 200, body: { sessions } };
}

/**
 * POST /sender/live (action:"detail") — one owned session + its draw state,
 * so the host can reopen control / big-screen after closing the browser.
 */
export async function liveSessionDetail({ db, decoded, body, now = Date.now() }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };
  const sessionId = typeof body?.sessionId === "string" ? body.sessionId.trim() : "";
  if (!sessionId) return { status: 400, body: { error: "invalid_request" } };
  const snap = await db.collection(LIVE_SESSION_COLLECTION).doc(sessionId).get();
  if (!snap.exists) return { status: 404, body: { error: "session_not_found" } };
  const s = snap.data();
  if (s.ownerUid !== decoded.uid) return { status: 403, body: { error: "forbidden" } };

  const drawSnap = await db.collection(DRAW_COLLECTION).doc(sessionId).get();
  const draw = drawSnap.exists ? drawSnap.data() : null;
  return {
    status: 200,
    body: {
      session: {
        sessionId: s.sessionId, title: s.title, hostLabel: s.hostLabel ?? null,
        eventId: s.eventId ?? null, mode: s.mode ?? "lucky_number",
        skin: s.skin ?? "neutral", status: s.status ?? "active",
        capabilities: s.capabilities ?? LIVE_CAPABILITIES,
        participationGiftId: s.participationGiftId ?? null,
        createdAt: s.createdAt,
      },
      draw: draw && draw.expireAt && now > draw.expireAt ? null : draw
        ? { status: draw.status, enabled: draw.enabled, mode: draw.mode ?? "lucky_number", startAt: draw.startAt, cutoffAt: draw.cutoffAt, prizes: draw.prizes, winners: draw.winners ?? [], entrantCount: draw.entrantCount ?? null }
        : null,
    },
  };
}

/**
 * The single dispatch for POST /sender/live — ONE gateway route for every
 * sender Live Interaction operation (the gateway is per-route; consolidating
 * keeps the founder's infra to one new route). Draw actions delegate to the
 * SHARED onsite engine with the session key passed as `eventId`.
 */
export async function handleSenderLive({ db, decoded, body, share, media, giftCollection, publicBaseUrl, now = Date.now() }) {
  const action = typeof body?.action === "string" ? body.action : "";
  const withKey = { ...body, eventId: body?.sessionId ?? body?.eventId };
  switch (action) {
    case "create":
      return createLiveSession({ db, decoded, body, share, media, giftCollection, publicBaseUrl, now });
    case "list":
      return listLiveSessions({ db, decoded, now });
    case "detail":
      return liveSessionDetail({ db, decoded, body, now });
    case "draw_configure":
      return configureDraw({ db, decoded, body: withKey, now });
    case "draw_open":
      return openDraw({ db, decoded, body: withKey, now });
    case "draw_lock":
      return lockDraw({ db, decoded, body: withKey, now });
    case "draw_entrants":
      return listEntrants({ db, decoded, body: withKey, now });
    case "draw_winner":
      return drawWinner({ db, decoded, body: withKey, now });
    // Live Guestbook — owner inbox, human approval, and the server-filtered
    // public display feed. Guest submission reuses /gift/onsite/blessing.
    case "guestbook_inbox":
      return guestbookInbox({ db, decoded, body: withKey, now });
    case "guestbook_moderate":
      return guestbookModerate({ db, decoded, body: withKey, now });
    case "guestbook_display":
      return guestbookDisplay({ db, decoded, body: withKey, now });
    // Live Quiz — owner setup, host-driven state machine + timer, and the
    // owner/big-screen state read. Guest answering uses /gift/onsite/quiz.
    case "quiz_configure":
      return quizConfigure({ db, decoded, body: withKey, now });
    case "quiz_control":
      return quizControl({ db, decoded, body: withKey, now });
    case "quiz_state":
      return quizOwnerState({ db, decoded, body: withKey, now });
    default:
      return { status: 400, body: { error: "invalid_request", field: "action" } };
  }
}
