/**
 * Gift.Seen Wedding Day — on-site backend foundation (Phase WD-1).
 *
 * One shared on_site experience per Wedding Event (Founder AA-1/AA-5): a
 * Gift-role record in the gift collection with contextRole:"on_site" —
 * inheriting the token/tokenHash/KMS-recovery/revoke primitives — plus the
 * one-to-many Guestbook and the Lucky Draw participation FOUNDATION.
 * Authoritative winner selection is deliberately NOT here (WD-3).
 *
 * Security invariants:
 *   1. Guest capability = possession of the unguessable shared on_site token.
 *      It permits: view experience, submit blessing, claim/recover OWN Lucky
 *      Code. It never lists other blessings, entrants, or winner state.
 *   2. Participant identity is anonymous: a server-minted random token the
 *      client holds; the server stores ONLY its SHA-256. No account, no
 *      phone, no fingerprinting.
 *   3. Sender endpoints verify Event ownership on every touched record
 *      (never construction alone). Guest endpoints never inherit sender
 *      authorization semantics (Founder AA-9).
 *   4. Lottery-scoped records (entrants, draw doc) carry expireAt =
 *      cutoffAt + 3h (WD-3 moves it to completedAt + 3h on completion) and
 *      are read-gated at expiry; physical deletion may lag via Firestore
 *      TTL (Founder AA-2 — copy must never promise second-exact purge).
 *      Guestbook records NEVER carry the lottery expiry: blessings follow
 *      the Wedding Event lifecycle direction (AA-4/§23).
 */

import crypto from "node:crypto";
import { EVENT_COLLECTION } from "./event.mjs";
import { finalizePresentation } from "./giftMedia.mjs";
import { WEDDING_MUSIC_THEMES } from "./occasion.mjs";

// --- Config / constants ----------------------------------------------------
export const ONSITE_CONTEXT_ROLE = "on_site";
export const GUESTBOOK_COLLECTION = "eventGuestbook";
export const ENTRANT_COLLECTION = "eventDrawEntrants";
export const DRAW_COLLECTION = "eventDraw";
export const LIVE_SESSION_COLLECTION = "liveSessions";
export const BLESSING_MAX_LEN = 200; // Founder AA-4, existing .length convention
export const DISPLAY_NAME_MAX_LEN = 20;
// Live Guestbook abuse control: one held anonymous identity may leave at most
// this many messages per event (prevents obvious flooding without registration).
export const GUESTBOOK_MAX_PER_PARTICIPANT = 5;
export const PRIZE_LABEL_MAX_LEN = 40;
export const LOTTERY_LINGER_MS = 3 * 60 * 60 * 1000; // Founder AA-2
const ONSITE_MESSAGE_MAX_LEN = 2000; // couple's Wedding Day message — gift convention
const ONSITE_TTL_MS = 365 * 24 * 60 * 60 * 1000; // record parity with gifts
const DRAW_STATUSES = ["draft", "open", "locked", "drawing", "completed"]; // AA-3
export const PRIZE_COUNT_MAX = 50; // max winners per tier

/**
 * Lucky Draw MODES (Founder, 2026-08-20): Lucky Draw is a FAMILY; the modes
 * differ ONLY in (a) participant draw-identity allocation and (b) reveal
 * ceremony. The winner engine (eligibility → frozen pool → server-authoritative
 * random winner → transaction persistence → one-person-one-prize → idempotent
 * recovery) is SHARED and mode-agnostic — drawWinner never reads `mode`.
 *   lucky_number — one six-digit identity, instant reveal (V1, implemented).
 *   lucky_ball   — six unique numbers 01–30, sequential ball reveal. RESERVED:
 *                  presentation only, NOT a probability/number-matching lottery.
 *                  Identity allocation + animation are NOT implemented here.
 */
export const LUCKY_DRAW_MODES = ["lucky_number", "lucky_ball"];
export const IMPLEMENTED_LUCKY_DRAW_MODES = ["lucky_number", "lucky_ball"];

// --- Small primitives (kept module-local; event.mjs-style independence) ----
const sha256Hex = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const mintToken = () => crypto.randomBytes(16).toString("base64url");

/** Six digits, leading zeros preserved — the Heart Key CSPRNG pattern. */
export const formatLuckyCode = (n) => String(n).padStart(6, "0");

/**
 * Mint a lucky code unique within the Event pool. Injectable RNG for tests;
 * production always uses crypto.randomInt (never client/browser randomness).
 */
export function pickUniqueLuckyCode(existingCodes, rand = crypto.randomInt) {
  for (let i = 0; i < 8; i += 1) {
    const code = formatLuckyCode(rand(0, 1_000_000));
    if (!existingCodes.has(code)) return code;
  }
  return null; // pool ≤ hundreds vs 1e6 — practically unreachable
}

// --- Lucky Ball identity (mode: lucky_ball) --------------------------------
// A Lucky Ball participant's identity is SIX unique integers 1–30. This is a
// *presentation* identity only — the winner is still selected by the shared
// engine over `luckyCode`, never derived from these numbers (not a lottery).
export const LUCKY_BALL_COUNT = 6;
export const LUCKY_BALL_MAX = 30;

/** Two-digit display, e.g. 3 → "03". */
export const formatLuckyBall = (n) => String(n).padStart(2, "0");

/**
 * Six distinct integers 1–30, returned in a STABLE random reveal order (the
 * order the balls emerge in the ceremony). The canonical identity is the
 * sorted set; reveal order is this array as stored. Injectable RNG for tests.
 */
export function drawLuckyBalls(rand = crypto.randomInt) {
  const bag = Array.from({ length: LUCKY_BALL_MAX }, (_, i) => i + 1);
  const picks = [];
  for (let i = 0; i < LUCKY_BALL_COUNT; i += 1) {
    picks.push(bag.splice(rand(0, bag.length), 1)[0]);
  }
  return picks;
}

/** Order-independent signature of a ball set — used to keep sets unique. */
export const ballSignature = (balls) => [...balls].sort((a, b) => a - b).join("-");

/**
 * A ball set unique among existing participants. The set space is
 * C(30,6)=593,775; venue events run to hundreds, so a fresh draw almost never
 * collides and a dozen tries is ample. null only if the (tiny) space filled.
 */
export function pickUniqueLuckyBalls(existingSignatures, rand = crypto.randomInt) {
  for (let i = 0; i < 12; i += 1) {
    const balls = drawLuckyBalls(rand);
    if (!existingSignatures.has(ballSignature(balls))) return balls;
  }
  return null;
}

/**
 * Content boundary for guest blessings. V1 mirrors the structural-only gift
 * message boundary (gift.mjs moderateGiftMessage); both are the reserved
 * hook for the global Content Boundary Gate LLM pass. Private-storage risk
 * tier — future Live Wall public display gates SEPARATELY (§V, consent).
 */
async function moderateBlessing(text) {
  if (!text || !text.trim()) return { ok: false, reason: "empty" };
  return { ok: true };
}

const readGate = (doc, now) =>
  doc && typeof doc.expireAt === "number" && now > doc.expireAt ? null : doc;

/** Window phase for guests — internal state names never leak pre-open. */
function drawPhase(draw, now) {
  if (now < draw.startAt) return "before";
  if (now < draw.cutoffAt) return "open";
  return "closed";
}

// --- Shared lookups --------------------------------------------------------
async function ownedWeddingEvent({ db, decoded, eventId }) {
  if (!decoded?.uid) return { res: { status: 401, body: { error: "unauthorized" } } };
  if (!eventId) return { res: { status: 400, body: { error: "invalid_request" } } };
  const snap = await db.collection(EVENT_COLLECTION).doc(eventId).get();
  if (!snap.exists) return { res: { status: 404, body: { error: "event_not_found" } } };
  const ev = snap.data();
  if (ev.senderUid !== decoded.uid) return { res: { status: 403, body: { error: "forbidden" } } };
  if (ev.type !== "wedding") return { res: { status: 409, body: { error: "wedding_only" } } };
  return { ev };
}

/**
 * Ownership for a DRAW SESSION (Live Interaction extraction, 2026-08-20).
 * The draw engine is keyed by an opaque SESSION KEY (the `eventId` param name
 * is kept for zero-churn — it equals the real Event id for a linked Wedding
 * and an `ls_…` id for a standalone Live Session). Winner transaction and all
 * draw docs are untouched: a Wedding-linked session uses sessionId===eventId,
 * so existing records are already correctly keyed and no migration runs.
 * Resolves a generic LiveSession doc first, then falls back to the LEGACY
 * Wedding Event (exact prior behaviour). Draw fns only read `owned.res`.
 */
async function ownedDrawSession({ db, decoded, eventId }) {
  if (!decoded?.uid) return { res: { status: 401, body: { error: "unauthorized" } } };
  if (!eventId) return { res: { status: 400, body: { error: "invalid_request" } } };
  const lsSnap = await db.collection(LIVE_SESSION_COLLECTION).doc(eventId).get();
  if (lsSnap.exists) {
    const ls = lsSnap.data();
    if (ls.ownerUid !== decoded.uid) return { res: { status: 403, body: { error: "forbidden" } } };
    return { session: ls };
  }
  return ownedWeddingEvent({ db, decoded, eventId });
}

/**
 * Find the Event's on_site record. Single-field query (eventId is already
 * indexed) + in-code role filter — deliberately NO composite index needed
 * (deploy-topology lesson: composite indexes gate deploys).
 */
async function findOnsite({ db, giftCollection, eventId }) {
  const snap = await db.collection(giftCollection).where("eventId", "==", eventId).get();
  const rows = (snap.docs ?? [])
    .map((d) => ({ id: d.id, rec: d.data() }))
    .filter(({ rec }) => rec.contextRole === ONSITE_CONTEXT_ROLE);
  return rows.find(({ rec }) => !rec.revoked) ?? rows[0] ?? null;
}

/** Resolve an ACTIVE on_site record from a guest token. */
async function onsiteByToken({ db, giftCollection, token, now }) {
  if (!token) return { res: { status: 400, body: { error: "invalid_request" } } };
  const tokenHash = sha256Hex(token);
  const snap = await db.collection(giftCollection).doc(tokenHash).get();
  // A non-on_site gift token must never acquire on-site capabilities — the
  // shared-QR surface answers not_found rather than leaking record class.
  if (!snap.exists) return { res: { status: 404, body: { error: "not_found" } } };
  const rec = snap.data();
  if (rec.contextRole !== ONSITE_CONTEXT_ROLE)
    return { res: { status: 404, body: { error: "not_found" } } };
  if (rec.revoked) return { res: { status: 410, body: { error: "revoked" } } };
  if (rec.expiresAt && now > rec.expiresAt)
    return { res: { status: 410, body: { error: "expired" } } };
  return { rec, tokenHash };
}

const entrantDocId = (eventId, participantIdHash) => `${eventId}__${participantIdHash}`;

async function eventEntrants({ db, eventId, now }) {
  const snap = await db.collection(ENTRANT_COLLECTION).where("eventId", "==", eventId).get();
  return (snap.docs ?? [])
    .map((d) => ({ id: d.id, e: d.data() }))
    .filter(({ e }) => readGate(e, now));
}

// --- Sender: on_site record ------------------------------------------------

/** POST /sender/onsite/create — one active on_site per Event (idempotent). */
export async function createOnsite({
  db,
  decoded,
  body,
  share = null,
  media = null,
  giftCollection,
  publicBaseUrl,
  now = Date.now(),
}) {
  const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  const owned = await ownedWeddingEvent({ db, decoded, eventId });
  if (owned.res) return owned.res;

  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return { status: 400, body: { error: "invalid_message" } };
  if (message.length > ONSITE_MESSAGE_MAX_LEN)
    return { status: 400, body: { error: "message_too_long" } };

  const existing = await findOnsite({ db, giftCollection, eventId });
  if (existing && !existing.rec.revoked) {
    // The raw token is never stored — recover the share URL via the
    // existing /sender/gift/share capability with this giftId.
    return {
      status: 200,
      body: { existing: true, giftId: existing.id, eventId, createdAt: existing.rec.createdAt },
    };
  }

  // A managed shared record the sender could never re-share would be a
  // handle-less QR — share crypto is REQUIRED (invitation-create rule).
  if (!share) return { status: 503, body: { error: "share_unavailable" } };

  const token = mintToken();
  const tokenHash = sha256Hex(token);
  let shareTokenSealed;
  try {
    shareTokenSealed = await share.seal(token, tokenHash);
  } catch (err) {
    console.error("[onsite] share seal failed:", err?.message);
    return { status: 503, body: { error: "share_seal_failed" } };
  }

  // Wedding Day presentation (WD-2): reuse the Event's sealed photo/voice by
  // product-level reference — the createGift 继续邀请 rules verbatim (same
  // sender, same Event, never revoked, role must exist). No re-upload is
  // ever required; staged assetId uploads remain equally valid.
  let presentation = null;
  if (body?.presentation !== undefined && body?.presentation !== null) {
    const resolveReuse = async (fromGiftId, role) => {
      const field = `presentation.${role}`;
      const invalid = { ok: false, status: 400, body: { error: "invalid_media", field } };
      if (typeof fromGiftId !== "string" || !fromGiftId.trim()) return invalid;
      const srcSnap = await db.collection(giftCollection).doc(fromGiftId.trim()).get();
      if (!srcSnap.exists) return invalid;
      const src = srcSnap.data();
      if (src.senderUid !== decoded.uid) {
        return { ok: false, status: 403, body: { error: "forbidden" } };
      }
      if (src.eventId !== eventId || src.revoked) return invalid;
      // Photo Story whole-set reuse (same-Event, same-sender, live source).
      if (role === "photos") {
        const frags =
          src.presentation?.photos ?? (src.presentation?.photo ? [src.presentation.photo] : []);
        if (frags.length === 0 || frags.some((f) => !f?.assetId)) return invalid;
        return { ok: true, srcTokenHash: fromGiftId.trim(), fragments: frags.map((f) => ({ ...f })) };
      }
      const fragment =
        role === "photo"
          ? (src.presentation?.photo ?? src.presentation?.photos?.[0])
          : src.presentation?.[role];
      if (!fragment?.assetId) return invalid;
      return { ok: true, srcTokenHash: fromGiftId.trim(), fragment: { ...fragment } };
    };
    const fin = await finalizePresentation({
      store: media,
      decoded,
      presentation: body.presentation,
      tokenHash,
      allowedMusicThemes: WEDDING_MUSIC_THEMES,
      resolveReuse,
    });
    if (!fin.ok) return { status: fin.status, body: fin.body };
    presentation = fin.presentation;
  }

  const record = {
    schemaVersion: 1,
    senderUid: decoded.uid,
    contextRole: ONSITE_CONTEXT_ROLE,
    eventId,
    accessMode: "direct", // shared venue QR opens on possession — no key ever
    message,
    region: "GLOBAL",
    createdAt: now,
    expiresAt: now + ONSITE_TTL_MS,
    redeemedAt: null,
    revoked: false,
    failedAttempts: 0,
    lockedUntil: null,
    cooldownTier: 0,
    // Wedding identity inheritance (WD-2 §3): guests must land in the same
    // Wedding world — couple/date render from the Event's sealed facts.
    ...(owned.ev.occasion ? { occasion: owned.ev.occasion } : {}),
    ...(presentation ? { presentation } : {}),
    shareTokenSealed,
  };
  await db.collection(giftCollection).doc(tokenHash).set(record);

  return {
    status: 200,
    body: {
      existing: false,
      token,
      url: `${publicBaseUrl}/s/${token}`,
      giftId: tokenHash,
      eventId,
    },
  };
}

/** POST /sender/onsite/detail — on_site state + guestbook count + draw state. */
export async function onsiteDetail({ db, decoded, body, giftCollection, now = Date.now() }) {
  const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  const owned = await ownedWeddingEvent({ db, decoded, eventId });
  if (owned.res) return owned.res;

  const found = await findOnsite({ db, giftCollection, eventId });
  const gbSnap = await db.collection(GUESTBOOK_COLLECTION).where("eventId", "==", eventId).get();
  const guestbookCount = (gbSnap.docs ?? [])
    .map((d) => d.data())
    .filter((g) => g.senderUid === decoded.uid && g.status === "active").length;

  const drawSnap = await db.collection(DRAW_COLLECTION).doc(eventId).get();
  const draw = drawSnap.exists ? readGate(drawSnap.data(), now) : null;
  const entrantCount = draw ? (await eventEntrants({ db, eventId, now })).length : 0;

  return {
    status: 200,
    body: {
      onsite: found
        ? {
            giftId: found.id,
            createdAt: found.rec.createdAt,
            revoked: found.rec.revoked === true,
            message: found.rec.message,
          }
        : null,
      guestbookCount,
      draw: draw
        ? {
            enabled: draw.enabled === true,
            status: draw.status,
            startAt: draw.startAt,
            cutoffAt: draw.cutoffAt,
            prizes: draw.prizes,
            entrantCount,
            batchId: draw.batchId ?? null,
            lockedAt: draw.lockedAt ?? null,
            winners: Array.isArray(draw.winners) ? draw.winners : [],
          }
        : null,
    },
  };
}

/** POST /sender/onsite/guestbook — owner-only listing. No participant hashes. */
export async function listGuestbook({ db, decoded, body, now = Date.now() }) {
  const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  const owned = await ownedWeddingEvent({ db, decoded, eventId });
  if (owned.res) return owned.res;

  const snap = await db.collection(GUESTBOOK_COLLECTION).where("eventId", "==", eventId).get();
  const entries = (snap.docs ?? [])
    .map((d) => ({ id: d.id, g: d.data() }))
    .filter(({ g }) => g.senderUid === decoded.uid && g.status === "active")
    .sort((a, b) => (a.g.createdAt ?? 0) - (b.g.createdAt ?? 0))
    .map(({ id, g }) => ({
      entryId: id,
      text: g.text,
      displayName: g.displayName ?? null,
      createdAt: g.createdAt,
    }));
  return { status: 200, body: { entries, count: entries.length } };
}

// --- Live Guestbook: owner inbox + approval + server-filtered display -------
// Keyed by the SESSION (ownedDrawSession resolves a LiveSession, then a legacy
// wedding Event), so the ONE engine serves standalone + linked Wedding alike.

/**
 * Owner inbox — EVERY submitted message with its moderation + display status.
 * This is the private review surface; approval for the public screen is a
 * SEPARATE explicit action (guestbookModerate).
 */
export async function guestbookInbox({ db, decoded, body, now = Date.now() }) {
  const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  const owned = await ownedDrawSession({ db, decoded, eventId });
  if (owned.res) return owned.res;
  const snap = await db.collection(GUESTBOOK_COLLECTION).where("eventId", "==", eventId).get();
  const entries = (snap.docs ?? [])
    .map((d) => ({ id: d.id, g: d.data() }))
    .filter(({ g }) => g.senderUid === decoded.uid && g.status !== "deleted")
    .sort((a, b) => (a.g.createdAt ?? 0) - (b.g.createdAt ?? 0))
    .map(({ id, g }) => ({
      entryId: id,
      text: g.text,
      displayName: g.displayName ?? null,
      createdAt: g.createdAt,
      approvedForDisplay: g.approvedForDisplay === true,
      status: g.status ?? "active",
      moderation: g.moderation ?? "normal",
    }));
  return {
    status: 200,
    body: {
      entries,
      count: entries.length,
      approvedCount: entries.filter((e) => e.approvedForDisplay && e.status === "active").length,
    },
  };
}

/**
 * Owner moderation of ONE message. op ∈ approve | unapprove | hide | unhide.
 * approve is the ONLY thing that lets a message reach the public screen, and it
 * is always a human action here. Removing approval (unapprove / hide) drops it
 * from future rotation immediately. hide also clears approval (belt-and-braces).
 */
export async function guestbookModerate({ db, decoded, body, now = Date.now() }) {
  const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  const entryId = typeof body?.entryId === "string" ? body.entryId.trim() : "";
  const op = typeof body?.op === "string" ? body.op : "";
  if (!entryId) return { status: 400, body: { error: "invalid_request", field: "entryId" } };
  const owned = await ownedDrawSession({ db, decoded, eventId });
  if (owned.res) return owned.res;
  const ref = db.collection(GUESTBOOK_COLLECTION).doc(entryId);
  const snap = await ref.get();
  const g = snap.exists ? snap.data() : null;
  if (!g || g.eventId !== eventId || g.senderUid !== decoded.uid)
    return { status: 404, body: { error: "entry_not_found" } };
  const patch =
    op === "approve" ? { approvedForDisplay: true, approvedAt: now }
    : op === "unapprove" ? { approvedForDisplay: false }
    : op === "hide" ? { status: "hidden", approvedForDisplay: false }
    : op === "unhide" ? { status: "active" } // NOT re-approved — approval must be re-granted
    : null;
  if (!patch) return { status: 400, body: { error: "invalid_request", field: "op" } };
  await ref.update({ ...patch, updatedAt: now });
  return { status: 200, body: { ok: true, entryId, op, approvedForDisplay: patch.approvedForDisplay ?? g.approvedForDisplay === true, status: patch.status ?? g.status ?? "active" } };
}

/**
 * The PUBLIC display feed for the big screen — SERVER-FILTERED to only
 * approved + active messages. This is the P0 guarantee: an unapproved or hidden
 * message can never appear here, regardless of any frontend behaviour.
 */
export async function guestbookDisplay({ db, decoded, body, now = Date.now() }) {
  const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  const owned = await ownedDrawSession({ db, decoded, eventId });
  if (owned.res) return owned.res;
  const snap = await db.collection(GUESTBOOK_COLLECTION).where("eventId", "==", eventId).get();
  const entries = (snap.docs ?? [])
    .map((d) => ({ id: d.id, g: d.data() }))
    .filter(({ g }) => g.senderUid === decoded.uid && g.status === "active" && g.approvedForDisplay === true)
    .sort((a, b) => (a.g.approvedAt ?? a.g.createdAt ?? 0) - (b.g.approvedAt ?? b.g.createdAt ?? 0))
    .map(({ id, g }) => ({ entryId: id, text: g.text, displayName: g.displayName ?? null }));
  return { status: 200, body: { entries, count: entries.length } };
}

// ============================================================================
// Live Quiz (capability: live_quiz) — ONE generic engine; zh + en are CONTENT
// packs, never separate engines. Answer type is per-question (free_text |
// multiple_choice). Scoring is server-authoritative and DETERMINISTIC — there
// is NO model/LLM call per answer, ever (see scoreQuizAnswer / normalize).
// ============================================================================
export const QUIZ_COLLECTION = "eventQuiz";
export const QUIZ_ANSWER_COLLECTION = "eventQuizAnswers";
export const QUIZ_MAX_QUESTIONS = 20;
export const QUIZ_NICKNAME_MAX = 16;
export const QUIZ_ANSWER_MAX_LEN = 80;
export const QUIZ_BASE_POINTS = 100;
export const QUIZ_SPEED_BONUS_MAX = 50;
export const QUIZ_ANSWER_TTL_MS = 7 * 24 * 60 * 60 * 1000; // operational, not permanent
export const QUIZ_PHASES = ["ready", "question_open", "locked", "answer_reveal", "score_reveal", "completed"];
// Host-controlled answer timing (server-authoritative). Presets 15/30/45/60/90.
export const QUIZ_DURATION_PRESETS = [15, 30, 45, 60, 90];
export const QUIZ_DEFAULT_DURATION_S = 60;
export const QUIZ_DURATION_MIN_S = 5;
export const QUIZ_DURATION_MAX_S = 300;

// Curated V1 content — native zh wordplay + native en riddles (NOT translated).
// One unambiguous answer each. Registry is extensible; future packs (Trivia,
// Product Quiz, About Us, Custom) add rows/locales with NO engine change.
export const QUIZ_QUESTIONS = [
  { id: "q_zh_1", locale: "zh", mode: "字谜", answerType: "free_text", difficulty: "easy",
    text: "什么东西越洗越脏？", canonical: "水", variants: ["水", "清水"], explanation: "洗东西的水会越用越脏。" },
  { id: "q_zh_2", locale: "zh", mode: "脑筋急转弯", answerType: "free_text", difficulty: "medium",
    text: "什么车寸步难行？", canonical: "风车", variants: ["风车"], explanation: "风车只会转，不会走。" },
  { id: "q_zh_3", locale: "zh", mode: "趣味谜语", answerType: "free_text", difficulty: "medium",
    text: "身穿绿衣裳，肚里水汪汪，客人来到家，先切它一块。（打一水果）", canonical: "西瓜", variants: ["西瓜"], explanation: "谜底是西瓜。" },
  { id: "q_zh_4", locale: "zh", mode: "脑筋急转弯", answerType: "multiple_choice", difficulty: "easy",
    text: "一年四季都盛开的花是什么花？", choices: ["水仙花", "塑料花", "玫瑰花", "昙花"], correctIndex: 1, explanation: "塑料花不受季节影响。" },
  { id: "q_zh_5", locale: "zh", mode: "字谜", answerType: "multiple_choice", difficulty: "easy",
    text: "“明”字去掉“日”是哪个字？", choices: ["月", "目", "朋", "门"], correctIndex: 0, explanation: "明＝日＋月，去掉日剩月。" },
  { id: "q_zh_6", locale: "zh", mode: "脑筋急转弯", answerType: "free_text", difficulty: "harder",
    text: "什么东西天气越热，它爬得越高？", canonical: "温度", variants: ["温度", "气温"], explanation: "温度计里的温度。" },
  { id: "q_en_1", locale: "en", mode: "riddle", answerType: "free_text", difficulty: "easy",
    text: "What has keys but can't open locks?", canonical: "piano", variants: ["piano", "a piano", "the piano"], explanation: "A piano has keys." },
  { id: "q_en_2", locale: "en", mode: "brain_teaser", answerType: "free_text", difficulty: "easy",
    text: "What gets wetter the more it dries?", canonical: "towel", variants: ["towel", "a towel", "the towel"], explanation: "A towel gets wet as it dries you." },
  { id: "q_en_3", locale: "en", mode: "brain_teaser", answerType: "free_text", difficulty: "easy",
    text: "What has to be broken before you can use it?", canonical: "egg", variants: ["egg", "an egg"], explanation: "You break an egg to use it." },
  { id: "q_en_4", locale: "en", mode: "word_puzzle", answerType: "multiple_choice", difficulty: "medium",
    text: "Which word is always spelled incorrectly?", choices: ["Wrong", "Incorrectly", "Rightly", "Never"], correctIndex: 1, explanation: "\"Incorrectly\" is spelled i-n-c-o-r-r-e-c-t-l-y." },
  { id: "q_en_5", locale: "en", mode: "trivia", answerType: "multiple_choice", difficulty: "easy",
    text: "How many sides does a hexagon have?", choices: ["5", "6", "7", "8"], correctIndex: 1, explanation: "A hexagon has six sides." },
  { id: "q_en_6", locale: "en", mode: "riddle", answerType: "free_text", difficulty: "harder",
    text: "What has a neck but no head?", canonical: "bottle", variants: ["bottle", "a bottle", "the bottle"], explanation: "A bottle has a neck." },
];
const quizPool = (locale) => QUIZ_QUESTIONS.filter((q) => q.locale === locale);
export const quizQuestionById = (id) => QUIZ_QUESTIONS.find((q) => q.id === id) ?? null;
const quizAnswerDocId = (eventId, questionId, hash) => sha256Hex(`qa:${eventId}:${questionId}:${hash}`);

/** Deterministic answer normalization — NO AI. NFKC, trim, strip punctuation,
 *  case-fold (en only), drop spaces. */
export function normalizeQuizAnswer(s, locale) {
  let t = String(s ?? "").normalize("NFKC").trim();
  t = t.replace(/[.,!?;:'"“”‘’。，！？、；：·…—()（）【】\[\]{}\-]/g, "");
  if (locale === "en") t = t.toLowerCase();
  return t.replace(/\s+/g, "");
}
/** The accepted set for a free_text question — canonical + configured variants. */
export function quizAcceptedSet(q) {
  return new Set([q.canonical, ...(q.variants ?? [])].map((a) => normalizeQuizAnswer(a, q.locale)));
}
/** Server-authoritative remaining time for the open question (pause-aware). */
export function quizRemainingMs(q, now) {
  if (!q || q.phase !== "question_open") return 0;
  if (q.paused) return Math.max(0, q.pausedRemainingMs ?? 0);
  return Math.max(0, (q.closesAt ?? now) - now);
}
/** The synchronized timer clients render — remaining derived from server state,
 *  so the Big Screen and every phone show the SAME countdown (pause-frozen). */
const quizTimer = (q, now) => ({
  remainingMs: quizRemainingMs(q, now),
  durationSeconds: q.durationSeconds ?? q.answerDurationSeconds ?? QUIZ_DEFAULT_DURATION_S,
  paused: q.paused === true && q.phase === "question_open",
  timeUp: q.phase === "question_open" && quizRemainingMs(q, now) <= 0,
});

/**
 * Pure, server-authoritative scoring — NO model calls, NO client clocks. The
 * speed bonus is a deterministic fraction of the AUTHORITATIVE remaining time
 * (so it is pause-safe and identical on refresh).
 */
export function scoreQuizAnswer(q, answer, remainingMs, windowMs) {
  let correct;
  if (q.answerType === "multiple_choice") {
    correct = Number.isInteger(answer) && answer === q.correctIndex;
  } else {
    correct = quizAcceptedSet(q).has(normalizeQuizAnswer(answer, q.locale));
  }
  if (!correct) return { correct: false, points: 0 };
  const frac = windowMs > 0 ? Math.max(0, Math.min(1, remainingMs / windowMs)) : 0;
  return { correct: true, points: QUIZ_BASE_POINTS + Math.round(QUIZ_SPEED_BONUS_MAX * frac) };
}
/** A question as seen by clients — the correct answer is present ONLY once revealed. */
function publicQuizQuestion(q, revealed) {
  if (!q) return null;
  const base = { id: q.id, mode: q.mode, answerType: q.answerType, text: q.text, difficulty: q.difficulty };
  if (q.answerType === "multiple_choice") base.choices = q.choices;
  if (revealed) {
    base.correctAnswer = q.answerType === "multiple_choice" ? q.choices[q.correctIndex] : q.canonical;
    if (q.answerType === "multiple_choice") base.correctIndex = q.correctIndex;
    base.explanation = q.explanation ?? null;
  }
  return base;
}
/** Leaderboard from committed answers. Deterministic tie-break: points desc,
 *  then more-correct, then finished-earlier, then hash asc (stable). */
async function quizLeaderboard(db, eventId, now) {
  const snap = await db.collection(QUIZ_ANSWER_COLLECTION).where("sessionId", "==", eventId).get();
  const byP = new Map();
  for (const d of snap.docs ?? []) {
    const a = d.data();
    if (!readGate(a, now)) continue;
    const cur = byP.get(a.participantIdHash) ?? { participantIdHash: a.participantIdHash, nickname: null, points: 0, correct: 0, lastAt: 0 };
    cur.points += a.points ?? 0;
    if (a.correct) cur.correct += 1;
    cur.lastAt = Math.max(cur.lastAt, a.submittedAt ?? 0);
    if (a.nickname) cur.nickname = a.nickname;
    byP.set(a.participantIdHash, cur);
  }
  return [...byP.values()]
    .sort((x, y) => y.points - x.points || y.correct - x.correct || x.lastAt - y.lastAt || (x.participantIdHash < y.participantIdHash ? -1 : 1))
    .map((r, i) => ({ rank: i + 1, participantIdHash: r.participantIdHash, nickname: r.nickname, points: r.points, correct: r.correct }));
}
const publicLeaderboard = (rows) => (rows ?? []).map((r) => ({ rank: r.rank, nickname: r.nickname, points: r.points, correct: r.correct }));

/** Owner: configure the quiz (locale pack + question count). Only before start. */
export async function quizConfigure({ db, decoded, body, now = Date.now() }) {
  const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  const owned = await ownedDrawSession({ db, decoded, eventId });
  if (owned.res) return owned.res;
  const locale = body?.locale === "en" ? "en" : "zh";
  const pool = quizPool(locale);
  let count = Number.isInteger(body?.questionCount) ? body.questionCount : Math.min(5, pool.length);
  count = Math.max(1, Math.min(count, pool.length, QUIZ_MAX_QUESTIONS));
  let duration = Number.isInteger(body?.answerDurationSeconds) ? body.answerDurationSeconds : QUIZ_DEFAULT_DURATION_S;
  duration = Math.max(QUIZ_DURATION_MIN_S, Math.min(duration, QUIZ_DURATION_MAX_S));
  const ref = db.collection(QUIZ_COLLECTION).doc(eventId);
  const existing = (await ref.get()).data();
  if (existing && existing.phase && existing.phase !== "ready")
    return { status: 409, body: { error: "quiz_in_progress", phase: existing.phase } };
  const doc = {
    schemaVersion: 1, sessionId: eventId, eventId, senderUid: decoded.uid, locale,
    questionIds: pool.slice(0, count).map((q) => q.id), questionCount: count,
    answerDurationSeconds: duration, // session default; a question may override at open
    currentIndex: 0, phase: "ready", openedAt: null, durationSeconds: null, closesAt: null,
    paused: false, pausedRemainingMs: null, answersSubmitted: 0,
    finalLeaderboard: null, completedAt: null,
    createdAt: existing?.createdAt ?? now, updatedAt: now,
  };
  await ref.set(doc);
  // "Pure answering time" ≈ questions × duration — NOT total event time (reveals,
  // rankings, host commentary and transitions add more).
  return { status: 200, body: { ok: true, locale, questionCount: count, answerDurationSeconds: duration, estimatedAnswerSeconds: count * duration, phase: "ready" } };
}

/**
 * Owner: drive the round state machine. Host controls the rhythm — the timer
 * only bounds the answer WINDOW; it NEVER auto-chains to reveal/ranking/next.
 * op ∈ open | pause | resume | lock | reveal | scores | next.
 * Pause/resume alter AUTHORITATIVE server timing, not just the visual countdown.
 */
export async function quizControl({ db, decoded, body, now = Date.now() }) {
  const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  const op = typeof body?.op === "string" ? body.op : "";
  const owned = await ownedDrawSession({ db, decoded, eventId });
  if (owned.res) return owned.res;
  const ref = db.collection(QUIZ_COLLECTION).doc(eventId);
  const q = (await ref.get()).data();
  if (!q) return { status: 404, body: { error: "quiz_not_configured" } };
  const total = q.questionIds.length;
  const patch = { updatedAt: now };

  if (op === "pause") {
    if (q.phase !== "question_open" || q.paused) return { status: 409, body: { error: "wrong_phase", phase: q.phase } };
    patch.paused = true; patch.pausedRemainingMs = quizRemainingMs(q, now); // freeze at the authoritative remaining
  } else if (op === "resume") {
    if (q.phase !== "question_open" || !q.paused) return { status: 409, body: { error: "wrong_phase", phase: q.phase } };
    patch.paused = false; patch.closesAt = now + (q.pausedRemainingMs ?? 0); patch.pausedRemainingMs = null; // continue from frozen time
  } else {
    const need = { open: "ready", lock: "question_open", reveal: "locked", scores: "answer_reveal", next: "score_reveal" }[op];
    if (!need) return { status: 400, body: { error: "invalid_request", field: "op" } };
    if (q.phase !== need) return { status: 409, body: { error: "wrong_phase", phase: q.phase, need } };
    if (op === "open") {
      const question = quizQuestionById(q.questionIds[q.currentIndex]);
      let dur = Number.isInteger(body?.durationSeconds) ? body.durationSeconds
        : question?.durationSeconds ?? q.answerDurationSeconds ?? QUIZ_DEFAULT_DURATION_S; // per-question override → session default
      dur = Math.max(QUIZ_DURATION_MIN_S, Math.min(dur, QUIZ_DURATION_MAX_S));
      patch.phase = "question_open"; patch.openedAt = now; patch.durationSeconds = dur;
      patch.closesAt = now + dur * 1000; patch.paused = false; patch.pausedRemainingMs = null;
    } else if (op === "lock") { patch.phase = "locked"; } // "Lock Now" ends the window immediately
    else if (op === "reveal") { patch.phase = "answer_reveal"; }
    else if (op === "scores") { patch.phase = "score_reveal"; }
    else if (op === "next") {
      const nextIndex = q.currentIndex + 1;
      if (nextIndex >= total) {
        patch.phase = "completed"; patch.completedAt = now;
        patch.finalLeaderboard = await quizLeaderboard(db, eventId, now); // snapshot survives answer TTL
      } else { patch.currentIndex = nextIndex; patch.phase = "ready"; patch.openedAt = null; patch.durationSeconds = null; patch.closesAt = null; patch.paused = false; patch.pausedRemainingMs = null; }
    }
  }
  await ref.update(patch);
  return { status: 200, body: { ok: true, op, phase: patch.phase ?? q.phase, currentIndex: patch.currentIndex ?? q.currentIndex } };
}

/** Owner: full state for Host Control + Big Screen. The correct answer is
 *  returned ONLY when the phase is at/after answer_reveal (defensive: the big
 *  screen is projected publicly). */
export async function quizOwnerState({ db, decoded, body, now = Date.now() }) {
  const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  const owned = await ownedDrawSession({ db, decoded, eventId });
  if (owned.res) return owned.res;
  const q = (await db.collection(QUIZ_COLLECTION).doc(eventId).get()).data();
  if (!q) return { status: 200, body: { configured: false } };
  const revealed = ["answer_reveal", "score_reveal", "completed"].includes(q.phase);
  const question = quizQuestionById(q.questionIds[q.currentIndex]);
  const ansSnap = await db.collection(QUIZ_ANSWER_COLLECTION).where("sessionId", "==", eventId).get();
  const answers = (ansSnap.docs ?? []).map((d) => d.data()).filter((a) => readGate(a, now));
  const leaderboard = q.phase === "completed" ? q.finalLeaderboard
    : q.phase === "score_reveal" ? await quizLeaderboard(db, eventId, now) : null;
  return {
    status: 200,
    body: {
      configured: true, phase: q.phase, locale: q.locale,
      questionNumber: q.currentIndex + 1, questionTotal: q.questionIds.length,
      question: publicQuizQuestion(question, revealed),
      timer: quizTimer(q, now),
      answerDurationSeconds: q.answerDurationSeconds ?? QUIZ_DEFAULT_DURATION_S,
      estimatedAnswerSeconds: q.questionIds.length * (q.answerDurationSeconds ?? QUIZ_DEFAULT_DURATION_S),
      answeredThis: answers.filter((a) => a.questionId === question?.id).length,
      participants: new Set(answers.map((a) => a.participantIdHash)).size,
      answersSubmitted: q.answersSubmitted ?? 0,
      leaderboard: publicLeaderboard(leaderboard),
    },
  };
}

/** Guest (/gift/onsite/quiz op:state) — current question WITHOUT the answer
 *  until reveal, plus this participant's own state (their answer; result only
 *  once revealed). */
export async function quizGuestState({ db, body, giftCollection, now = Date.now() }) {
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const found = await onsiteByToken({ db, giftCollection, token, now });
  if (found.res) return found.res;
  const { rec } = found;
  const participantIdHash = typeof body?.participantToken === "string" && /^[A-Za-z0-9_-]{16,64}$/.test(body.participantToken.trim())
    ? sha256Hex(body.participantToken.trim()) : null;
  const q = (await db.collection(QUIZ_COLLECTION).doc(rec.eventId).get()).data();
  if (!q) return { status: 200, body: { configured: false } };
  const revealed = ["answer_reveal", "score_reveal", "completed"].includes(q.phase);
  const question = quizQuestionById(q.questionIds[q.currentIndex]);
  let mine = null;
  if (participantIdHash && question) {
    const aSnap = await db.collection(QUIZ_ANSWER_COLLECTION).doc(quizAnswerDocId(rec.eventId, question.id, participantIdHash)).get();
    if (aSnap.exists) {
      const a = aSnap.data();
      mine = { answered: true, answer: a.answer, ...(revealed ? { correct: a.correct, points: a.points } : {}) };
    } else mine = { answered: false };
  }
  let myScore = null;
  if (participantIdHash && (q.phase === "score_reveal" || q.phase === "completed")) {
    const rows = q.phase === "completed" ? (q.finalLeaderboard ?? []) : await quizLeaderboard(db, rec.eventId, now);
    const row = rows.find((r) => r.participantIdHash === participantIdHash);
    if (row) myScore = { rank: row.rank, points: row.points, correct: row.correct };
  }
  return {
    status: 200,
    body: {
      configured: true, phase: q.phase,
      questionNumber: q.currentIndex + 1, questionTotal: q.questionIds.length,
      question: publicQuizQuestion(question, revealed),
      timer: quizTimer(q, now),
      mine, myScore,
    },
  };
}

/** Guest (/gift/onsite/quiz op:answer) — one final answer per participant per
 *  question, idempotent, phase-gated. Scored deterministically server-side; the
 *  result is WITHHELD from the response (revealed only via state at reveal). */
export async function quizGuestAnswer({ db, body, giftCollection, now = Date.now() }) {
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const found = await onsiteByToken({ db, giftCollection, token, now });
  if (found.res) return found.res;
  const { rec } = found;
  const participantToken = typeof body?.participantToken === "string" ? body.participantToken.trim() : "";
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(participantToken))
    return { status: 400, body: { error: "invalid_participant" } };
  const participantIdHash = sha256Hex(participantToken);
  const questionId = typeof body?.questionId === "string" ? body.questionId.trim() : "";

  const q = (await db.collection(QUIZ_COLLECTION).doc(rec.eventId).get()).data();
  if (!q) return { status: 409, body: { error: "quiz_not_open" } };
  const current = quizQuestionById(q.questionIds[q.currentIndex]);
  if (!current || current.id !== questionId) return { status: 409, body: { error: "wrong_question" } };
  if (q.phase !== "question_open") return { status: 409, body: { error: "answers_locked" } };
  // Server-authoritative timer: at zero, late answers are refused even before the
  // host taps Lock (pause freezes the clock, so a held round still accepts).
  const remainingMs = quizRemainingMs(q, now);
  if (remainingMs <= 0) return { status: 409, body: { error: "answers_locked", reason: "time" } };

  let nickname = null;
  if (body?.nickname !== undefined && body?.nickname !== null) {
    nickname = String(body.nickname).trim().replace(/[ -]/g, "").slice(0, QUIZ_NICKNAME_MAX);
    if (!nickname) nickname = null;
  }
  let answer = body?.answer;
  if (current.answerType === "multiple_choice") {
    if (!Number.isInteger(answer) || answer < 0 || answer >= (current.choices?.length ?? 0))
      return { status: 400, body: { error: "invalid_answer" } };
  } else {
    answer = typeof answer === "string" ? answer.trim() : "";
    if (!answer) return { status: 400, body: { error: "invalid_answer" } };
    if (answer.length > QUIZ_ANSWER_MAX_LEN) return { status: 400, body: { error: "answer_too_long" } };
  }

  const ref = db.collection(QUIZ_ANSWER_COLLECTION).doc(quizAnswerDocId(rec.eventId, questionId, participantIdHash));
  if ((await ref.get()).exists) return { status: 200, body: { ok: true, received: true, duplicate: true } };
  // Deterministic scoring — pure function, NO model call. 5000 answers = 5000
  // cheap DB writes, never 5000 LLM calls. Speed bonus from authoritative remaining.
  const windowMs = (q.durationSeconds ?? QUIZ_DEFAULT_DURATION_S) * 1000;
  const { correct, points } = scoreQuizAnswer(current, answer, remainingMs, windowMs);
  try {
    await ref.create({
      schemaVersion: 1, sessionId: rec.eventId, questionId, participantIdHash, nickname,
      answer, answerType: current.answerType, correct, points, submittedAt: now,
      expireAt: now + QUIZ_ANSWER_TTL_MS, // operational lifecycle
    });
  } catch (err) {
    if ((await ref.get()).exists) return { status: 200, body: { ok: true, received: true, duplicate: true } };
    throw err;
  }
  await db.collection(QUIZ_COLLECTION).doc(rec.eventId).update({ answersSubmitted: (q.answersSubmitted ?? 0) + 1 }).catch(() => {});
  // Correctness is intentionally NOT returned here (anti-cheat).
  return { status: 200, body: { ok: true, received: true, duplicate: false } };
}

// --- Sender: draw configuration / state foundation -------------------------

/** POST /sender/onsite/draw/configure — data contract only; no selection. */
export async function configureDraw({ db, decoded, body, now = Date.now() }) {
  const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  const owned = await ownedDrawSession({ db, decoded, eventId });
  if (owned.res) return owned.res;

  const ref = db.collection(DRAW_COLLECTION).doc(eventId);
  const snap = await ref.get();
  const existing = snap.exists ? snap.data() : null;
  if (existing && ["locked", "drawing", "completed"].includes(existing.status)) {
    return { status: 409, body: { error: "draw_locked" } };
  }

  if (typeof body?.enabled !== "boolean")
    return { status: 400, body: { error: "invalid_request", field: "enabled" } };
  const startAt = body?.startAt;
  const cutoffAt = body?.cutoffAt;
  if (!Number.isInteger(startAt) || !Number.isInteger(cutoffAt) || startAt <= 0 || cutoffAt <= 0)
    return { status: 400, body: { error: "invalid_window", field: "time" } };
  if (!(startAt < cutoffAt))
    return { status: 400, body: { error: "invalid_window", field: "order" } };

  // Per-tier winner COUNT (Founder, 2026-08-20): a tier can award N winners.
  // Back-compat: a string prize is one winner (Wedding legacy). The new Lucky
  // Number frontend sends { label, count }. Count validated 1..MAX; the pool
  // sufficiency check happens authoritatively at DRAW time (pool may be empty
  // at configure time).
  const prizeDefs = [];
  for (const [field, tier] of [
    ["third", 3],
    ["second", 2],
    ["first", 1],
  ]) {
    const raw = body?.prizes?.[field];
    const label = typeof raw === "string" ? raw.trim() : typeof raw?.label === "string" ? raw.label.trim() : "";
    if (!label || label.length > PRIZE_LABEL_MAX_LEN)
      return { status: 400, body: { error: "invalid_prize", field } };
    let count = 1;
    if (raw && typeof raw === "object" && raw.count !== undefined) {
      if (!Number.isInteger(raw.count) || raw.count < 1 || raw.count > PRIZE_COUNT_MAX)
        return { status: 400, body: { error: "invalid_prize", field: `${field}.count` } };
      count = raw.count;
    }
    prizeDefs.push({ tier, label, count });
  }

  // Mode is a reserved seam: default lucky_number; an unimplemented mode
  // (lucky_ball) is refused so no half-built game can be configured. The
  // winner engine is unaffected — mode only steers identity + reveal.
  const mode = body?.mode === undefined || body?.mode === null || body?.mode === ""
    ? "lucky_number"
    : body.mode;
  if (!IMPLEMENTED_LUCKY_DRAW_MODES.includes(mode)) {
    return { status: 400, body: { error: "invalid_mode", field: "mode" } };
  }

  const doc = {
    schemaVersion: 1,
    eventId,
    mode,
    senderUid: decoded.uid,
    enabled: body.enabled,
    status: existing?.status ?? "draft",
    startAt,
    cutoffAt,
    // Tiers 3→2→1, each awarding `count` winners (default 1; Gift.Seen supplies
    // no prizes). One participant still wins at most one prize.
    prizes: prizeDefs,
    winners: existing?.winners ?? [],
    entrantCount: existing?.entrantCount ?? null,
    batchId: existing?.batchId ?? null,
    lockedAt: existing?.lockedAt ?? null,
    completedAt: existing?.completedAt ?? null,
    // AA-2 lifecycle anchor: cutoff+3h now; WD-3 re-anchors to completion.
    expireAt: cutoffAt + LOTTERY_LINGER_MS,
    createdAt: existing?.createdAt ?? now,
    updatedAt: now,
  };
  await ref.set(doc);
  return {
    status: 200,
    body: { ok: true, status: doc.status, startAt, cutoffAt, prizes: doc.prizes, enabled: doc.enabled },
  };
}

/** POST /sender/onsite/draw/open — draft → open (idempotent on open). */
export async function openDraw({ db, decoded, body, now = Date.now() }) {
  const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  const owned = await ownedDrawSession({ db, decoded, eventId });
  if (owned.res) return owned.res;

  const ref = db.collection(DRAW_COLLECTION).doc(eventId);
  const snap = await ref.get();
  if (!snap.exists) return { status: 404, body: { error: "draw_not_found" } };
  const draw = readGate(snap.data(), now);
  if (!draw) return { status: 404, body: { error: "draw_not_found" } };
  if (draw.enabled !== true) return { status: 409, body: { error: "draw_disabled" } };
  if (draw.status === "open") return { status: 200, body: { ok: true, status: "open" } };
  if (draw.status !== "draft") return { status: 409, body: { error: "draw_locked" } };
  await ref.update({ status: "open", updatedAt: now });
  return { status: 200, body: { ok: true, status: "open" } };
}

/**
 * POST /sender/onsite/draw/lock — freeze the entrant pool at/after cutoff.
 * Locking is recovery-idempotent: re-sent locks (and locks arriving after a
 * later state) echo the committed snapshot instead of erroring (§W).
 */
export async function lockDraw({ db, decoded, body, now = Date.now() }) {
  const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  const owned = await ownedDrawSession({ db, decoded, eventId });
  if (owned.res) return owned.res;

  const ref = db.collection(DRAW_COLLECTION).doc(eventId);
  const snap = await ref.get();
  if (!snap.exists) return { status: 404, body: { error: "draw_not_found" } };
  const draw = readGate(snap.data(), now);
  if (!draw) return { status: 404, body: { error: "draw_not_found" } };

  if (["locked", "drawing", "completed"].includes(draw.status)) {
    return {
      status: 200,
      body: {
        ok: true,
        status: draw.status,
        entrantCount: draw.entrantCount,
        batchId: draw.batchId,
        lockedAt: draw.lockedAt,
      },
    };
  }
  if (draw.status !== "open") return { status: 409, body: { error: "draw_not_open" } };
  if (now < draw.cutoffAt)
    return { status: 409, body: { error: "lock_too_early", cutoffAt: draw.cutoffAt } };

  const entrantCount = (await eventEntrants({ db, eventId, now })).length;
  // Short human-readable draw batch reference (§20) — operational handle,
  // zero cryptographic claims.
  const batchId = crypto.randomBytes(3).toString("hex").toUpperCase().slice(0, 5);
  await ref.update({ status: "locked", lockedAt: now, entrantCount, batchId, updatedAt: now });
  return { status: 200, body: { ok: true, status: "locked", entrantCount, batchId, lockedAt: now } };
}

/**
 * POST /sender/onsite/draw/entrants — WD-3A read-only host view.
 *
 * Returns ONLY the six-digit codes (sorted, stable) + counts + lock state:
 * never participant hashes, never blessing text or display names — the
 * Lottery and the Guestbook remain unlinkable by construction (Founder §5,
 * WD-2 cleanup). Guest/public APIs never reach this handler (sender auth).
 *
 * Freeze semantics: the first post-cutoff read performs the lazy `locked`
 * transition (audit §K — host action or lazy on first draw-side read), so
 * the host who opens the list after cutoff sees 名单已锁定 with the frozen
 * snapshot without needing a separate button. Idempotent; re-reads recover
 * the same committed state. The 3-hour lifecycle read-gate stays in force.
 */
export async function listEntrants({ db, decoded, body, now = Date.now() }) {
  const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  const owned = await ownedDrawSession({ db, decoded, eventId });
  if (owned.res) return owned.res;

  const ref = db.collection(DRAW_COLLECTION).doc(eventId);
  const snap = await ref.get();
  if (!snap.exists) return { status: 404, body: { error: "draw_not_found" } };
  let draw = readGate(snap.data(), now);
  if (!draw || draw.enabled !== true) return { status: 404, body: { error: "draw_not_found" } };

  const entrants = await eventEntrants({ db, eventId, now });
  const codes = entrants.map(({ e }) => e.luckyCode).sort();

  // Lazy freeze: cutoff passed while still open → lock now, snapshot count.
  if (draw.status === "open" && now >= draw.cutoffAt) {
    const batchId = crypto.randomBytes(3).toString("hex").toUpperCase().slice(0, 5);
    const patch = {
      status: "locked",
      lockedAt: now,
      entrantCount: codes.length,
      batchId: draw.batchId ?? batchId,
      updatedAt: now,
    };
    await ref.update(patch);
    draw = { ...draw, ...patch };
  }

  const locked = ["locked", "drawing", "completed"].includes(draw.status);
  return {
    status: 200,
    body: {
      codes,
      count: codes.length,
      status: draw.status,
      locked,
      cutoffAt: draw.cutoffAt,
      ...(locked ? { entrantCount: draw.entrantCount ?? codes.length, lockedAt: draw.lockedAt ?? null, batchId: draw.batchId ?? null } : {}),
    },
  };
}

/**
 * POST /sender/onsite/draw/winner — WD-3B server-authoritative selection.
 *
 * Fairness contract (Founder):
 *   · the server selects; the frontend reel is pure ceremony;
 *   · fixed order 三等奖(3) → 二等奖(2) → 一等奖(1); each tier awards its
 *     configured COUNT of winners (default 1) — the tier's winners are drawn
 *     ATOMICALLY in one transaction, so a tier is all-or-nothing;
 *   · one participant may win at most one prize (status 'won' excludes);
 *   · a committed tier is FINAL — every replay/refresh/double-click/second
 *     device converges on the SAME committed set; no redraw exists;
 *   · fewer eligible entrants than the tier's count → clear refusal
 *     (insufficient_entrants), never a fabricated or duplicated winner.
 *
 * Implemented as the codebase's first Firestore transaction: reads of the
 * draw doc + eligible entrants and ALL writes happen inside runTransaction,
 * so concurrent host clicks serialize — the loser's retry re-reads state,
 * finds the tier committed, and returns the same winners. randomInt is
 * crypto-grade server randomness; re-rolls across transaction retries are
 * harmless because exactly one attempt ever commits.
 *
 * Lifecycle (AA-2): completing 一等奖 re-anchors the draw's expireAt to
 * completedAt + 3h inside the transaction; entrant docs are re-anchored
 * best-effort right after commit so codes remain readable exactly as long
 * as the results are.
 */
export async function drawWinner({ db, decoded, body, now = Date.now() }) {
  const eventId = typeof body?.eventId === "string" ? body.eventId.trim() : "";
  const owned = await ownedDrawSession({ db, decoded, eventId });
  if (owned.res) return owned.res;
  const tier = body?.tier;
  if (![3, 2, 1].includes(tier)) return { status: 400, body: { error: "invalid_tier" } };

  const drawRef = db.collection(DRAW_COLLECTION).doc(eventId);
  const entrantsQuery = db.collection(ENTRANT_COLLECTION).where("eventId", "==", eventId);

  let result;
  try {
    result = await db.runTransaction(async (tx) => {
      const drawSnap = await tx.get(drawRef);
      if (!drawSnap.exists) return { status: 404, body: { error: "draw_not_found" } };
      const draw = readGate(drawSnap.data(), now);
      if (!draw || draw.enabled !== true) return { status: 404, body: { error: "draw_not_found" } };

      const winners = Array.isArray(draw.winners) ? draw.winners : [];
      const prizes = Array.isArray(draw.prizes) ? draw.prizes : [];
      const count = prizes.find((p) => p.tier === tier)?.count ?? 1;
      const committedForTier = winners.filter((w) => w.tier === tier);
      if (committedForTier.length >= count) {
        // Replay/refresh/double-click/second device — the SAME committed set.
        const codes = committedForTier.map((w) => w.luckyCode);
        return {
          status: 200,
          body: { ok: true, tier, luckyCode: codes[0], luckyCodes: codes, alreadyDrawn: true, status: draw.status },
        };
      }
      if (!["locked", "drawing"].includes(draw.status)) {
        return { status: 409, body: { error: "draw_not_locked", status: draw.status } };
      }
      // Fixed ceremony order 3 → 2 → 1: the requested tier must be the next
      // one with no committed winners (skipping ahead is refused).
      const drawnTiers = [...new Set(winners.map((w) => w.tier))];
      const nextTier = [3, 2, 1].find((t2) => !drawnTiers.includes(t2));
      if (tier !== nextTier) {
        return { status: 409, body: { error: "draw_out_of_order", nextTier } };
      }

      const poolSnap = await tx.get(entrantsQuery);
      const eligible = (poolSnap.docs ?? [])
        .map((d) => ({ id: d.id, e: d.data() }))
        .filter(({ e }) => readGate(e, now))
        .filter(({ e }) => e.status === "eligible");
      // The tier is atomic: draw ALL `count` winners now, or refuse. Never a
      // partial tier, never a duplicated participant.
      if (eligible.length < count) {
        return { status: 409, body: { error: "insufficient_entrants", need: count, available: eligible.length } };
      }

      // Pick `count` DISTINCT winners (crypto-grade, without replacement).
      const pool = eligible.slice();
      const picks = [];
      for (let i = 0; i < count; i += 1) {
        picks.push(pool.splice(crypto.randomInt(pool.length), 1)[0]);
      }
      const isLast = tier === 1; // 一等奖 is the final tier → completes the draw
      const completedAt = isLast ? now : (draw.completedAt ?? null);
      for (const pk of picks) {
        tx.update(db.collection(ENTRANT_COLLECTION).doc(pk.id), {
          status: "won",
          prizeTier: tier,
          wonAt: now,
          ...(isLast ? { expireAt: now + LOTTERY_LINGER_MS } : {}),
        });
      }
      // The winner record carries the winner's identity so the reveal reproduces
      // it exactly on refresh: luckyCode always; the six balls (stored order = the
      // reveal order) when the entrant has a Lucky Ball identity. Selection above
      // is unchanged — this only records who was already chosen.
      const newWinners = [...winners, ...picks.map((pk) => ({ tier, luckyCode: pk.e.luckyCode, ...(pk.e.luckyBalls ? { luckyBalls: pk.e.luckyBalls } : {}), at: now }))];
      tx.update(drawRef, {
        winners: newWinners,
        status: isLast ? "completed" : "drawing",
        completedAt,
        updatedAt: now,
        // AA-2 re-anchor on completion; until then the cutoff anchor stands.
        ...(isLast ? { expireAt: now + LOTTERY_LINGER_MS } : {}),
      });
      const codes = picks.map((pk) => pk.e.luckyCode);
      return {
        status: 200,
        body: { ok: true, tier, luckyCode: codes[0], luckyCodes: codes, alreadyDrawn: false, status: isLast ? "completed" : "drawing" },
      };
    });
  } catch (err) {
    console.error(`[onsite] draw txn failed ${eventId.slice(0, 8)}…:`, err?.message);
    return { status: 503, body: { error: "draw_failed" } };
  }

  // Completion: extend every entrant's lifecycle to match the results
  // (best-effort outside the txn; the read gate makes stragglers harmless).
  if (result.status === 200 && result.body.status === "completed" && result.body.alreadyDrawn === false) {
    try {
      const snap = await entrantsQuery.get();
      for (const d of snap.docs ?? []) {
        await db.collection(ENTRANT_COLLECTION).doc(d.id).update({ expireAt: now + LOTTERY_LINGER_MS });
      }
    } catch (err) {
      console.error("[onsite] entrant lifecycle re-anchor:", err?.message);
    }
  }
  return result;
}

// --- Guest: blessing + lucky code ------------------------------------------

/**
 * POST /gift/onsite/blessing — anonymous, token-authorized, idempotent.
 * entryId derives from (eventId, idempotencyKey) so a retry after a lost
 * response can NEVER duplicate — even when the retry arrives without the
 * participantToken the original response carried.
 */
export async function submitBlessing({ db, body, giftCollection, now = Date.now() }) {
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const found = await onsiteByToken({ db, giftCollection, token, now });
  if (found.res) return found.res;
  const { rec } = found;

  const text = typeof body?.text === "string" ? body.text.trim() : "";
  if (!text) return { status: 400, body: { error: "invalid_blessing" } };
  if (text.length > BLESSING_MAX_LEN)
    return { status: 400, body: { error: "blessing_too_long" } };
  let displayName = null;
  if (body?.displayName !== undefined && body?.displayName !== null) {
    displayName = String(body.displayName).trim();
    if (!displayName) displayName = null;
    else if (displayName.length > DISPLAY_NAME_MAX_LEN)
      return { status: 400, body: { error: "display_name_too_long" } };
  }
  const idem = typeof body?.idempotencyKey === "string" ? body.idempotencyKey.trim() : "";
  if (!/^[A-Za-z0-9_-]{8,64}$/.test(idem))
    return { status: 400, body: { error: "invalid_idempotency_key" } };

  const moderation = await moderateBlessing(text);
  if (!moderation.ok)
    return { status: 422, body: { error: "moderation_blocked", detail: moderation.reason } };

  // Anonymous participant capability: accept a well-formed presented token,
  // else mint. Raw token returns to the client ONCE; only the hash persists.
  const presented =
    typeof body?.participantToken === "string" &&
    /^[A-Za-z0-9_-]{16,64}$/.test(body.participantToken.trim())
      ? body.participantToken.trim()
      : null;
  const participantToken = presented ?? mintToken();
  const participantIdHash = sha256Hex(participantToken);

  const entryId = sha256Hex(`gb:${rec.eventId}:${idem}`);
  const ref = db.collection(GUESTBOOK_COLLECTION).doc(entryId);
  const existing = await ref.get();
  if (existing.exists) {
    return {
      status: 200,
      body: { ok: true, entryId, duplicate: true, participantToken: presented },
    };
  }

  // Abuse controls (anonymous, no registration): cap messages per held identity
  // and reject a same-text resubmission from that identity. A cleared identity
  // can start over — accepted trade-off for anonymous participation.
  const gbSnap = await db.collection(GUESTBOOK_COLLECTION).where("eventId", "==", rec.eventId).get();
  const mine = (gbSnap.docs ?? [])
    .map((d) => ({ id: d.id, g: d.data() }))
    .filter(({ g }) => g.participantIdHash === participantIdHash && g.status !== "deleted");
  if (mine.length >= GUESTBOOK_MAX_PER_PARTICIPANT)
    return { status: 429, body: { error: "too_many_blessings", limit: GUESTBOOK_MAX_PER_PARTICIPANT } };
  const norm = (s) => String(s ?? "").replace(/\s+/g, " ").trim().toLowerCase();
  const dupe = mine.find(({ g }) => norm(g.text) === norm(text));
  if (dupe) return { status: 200, body: { ok: true, entryId: dupe.id, duplicate: true, participantToken: presented } };

  // NO lottery expireAt here — blessings follow the Event lifecycle (§23).
  await ref.set({
    schemaVersion: 1,
    eventId: rec.eventId,
    senderUid: rec.senderUid,
    text,
    displayName,
    participantIdHash,
    allowLiveDisplay: false, // reserved guest-consent flag (§21); default private
    // P0 PUBLIC-DISPLAY GATE (Founder): a message NEVER reaches the big screen
    // until the host explicitly approves it. Default false; the display feed is
    // server-filtered on this — never on frontend alone.
    approvedForDisplay: false,
    moderation: moderation.tier ?? "normal", // advisory only; never authorizes display
    status: "active",
    createdAt: now,
  });
  return { status: 200, body: { ok: true, entryId, duplicate: false, participantToken } };
}

/**
 * POST /gift/onsite/lucky/claim — at most one active code per participant
 * per Event (AA-4). Idempotent: an existing entrant always gets the SAME
 * code back (also post-cutoff — recovering a lost code is not a new chance);
 * NEW codes only inside [startAt, cutoffAt) while the draw is open.
 */
export async function claimLuckyCode({ db, body, giftCollection, now = Date.now() }) {
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const found = await onsiteByToken({ db, giftCollection, token, now });
  if (found.res) return found.res;
  const { rec } = found;

  const participantToken =
    typeof body?.participantToken === "string" ? body.participantToken.trim() : "";
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(participantToken))
    return { status: 400, body: { error: "invalid_participant" } };
  const participantIdHash = sha256Hex(participantToken);

  const drawSnap = await db.collection(DRAW_COLLECTION).doc(rec.eventId).get();
  const draw = drawSnap.exists ? readGate(drawSnap.data(), now) : null;
  if (!draw || draw.enabled !== true || draw.status !== "open") {
    return { status: 409, body: { error: "draw_not_open" } };
  }

  const entrantRef = db
    .collection(ENTRANT_COLLECTION)
    .doc(entrantDocId(rec.eventId, participantIdHash));
  const existing = await entrantRef.get();
  if (existing.exists && readGate(existing.data(), now)) {
    const e = existing.data();
    return {
      status: 200,
      body: { ok: true, luckyCode: e.luckyCode, luckyBalls: e.luckyBalls ?? null, mode: draw.mode ?? "lucky_number", alreadyClaimed: true, cutoffAt: draw.cutoffAt },
    };
  }

  if (now < draw.startAt)
    return { status: 409, body: { error: "draw_not_started", startAt: draw.startAt } };
  if (now >= draw.cutoffAt) return { status: 409, body: { error: "draw_closed" } };

  // Eligibility gate: a Wedding on_site session couples the lottery to the
  // Guestbook (≥1 blessing first, AA-4). A standalone Live Interaction Lucky
  // Draw has no Guestbook, so its participation record sets
  // requireBlessing:false and eligibility is possession of the QR token alone.
  // Existing Wedding records lack the field → default requires a blessing
  // (behaviour preserved). Single-field query, no composite index.
  if (rec.requireBlessing !== false) {
    const gbSnap = await db
      .collection(GUESTBOOK_COLLECTION)
      .where("participantIdHash", "==", participantIdHash)
      .get();
    const hasBlessing = (gbSnap.docs ?? [])
      .map((d) => d.data())
      .some((g) => g.eventId === rec.eventId && g.status === "active");
    if (!hasBlessing) return { status: 403, body: { error: "not_eligible" } };
  }

  const pool = await eventEntrants({ db, eventId: rec.eventId, now });
  const luckyCode = pickUniqueLuckyCode(new Set(pool.map(({ e }) => e.luckyCode)));
  if (!luckyCode) return { status: 503, body: { error: "code_exhausted" } };

  // Lucky Ball mode ALSO assigns a six-number identity (1–30, unique set). The
  // luckyCode above is still the engine's internal key — the balls are only the
  // participant's presentation identity, never used to pick or match a winner.
  let luckyBalls = null;
  if (draw.mode === "lucky_ball") {
    const sigs = new Set(pool.map(({ e }) => e.luckyBalls).filter(Boolean).map(ballSignature));
    luckyBalls = pickUniqueLuckyBalls(sigs);
    if (!luckyBalls) return { status: 503, body: { error: "balls_exhausted" } };
  }

  const entrant = {
    schemaVersion: 1,
    eventId: rec.eventId,
    senderUid: rec.senderUid,
    participantIdHash,
    luckyCode,
    ...(luckyBalls ? { luckyBalls } : {}),
    status: "eligible",
    prizeTier: null,
    createdAt: now,
    expireAt: draw.cutoffAt + LOTTERY_LINGER_MS, // AA-2 anchor (WD-3 re-anchors)
  };
  try {
    // create() (not set) — a concurrent duplicate claim loses the race and
    // recovers the committed code below: one participant, one chance, ever.
    await entrantRef.create(entrant);
  } catch (err) {
    const raced = await entrantRef.get();
    if (raced.exists) {
      const e = raced.data();
      return {
        status: 200,
        body: { ok: true, luckyCode: e.luckyCode, luckyBalls: e.luckyBalls ?? null, mode: draw.mode ?? "lucky_number", alreadyClaimed: true, cutoffAt: draw.cutoffAt },
      };
    }
    throw err;
  }
  return {
    status: 200,
    body: { ok: true, luckyCode, luckyBalls, mode: draw.mode ?? "lucky_number", alreadyClaimed: false, cutoffAt: draw.cutoffAt },
  };
}

// --- Retrieve integration ---------------------------------------------------

/**
 * Extra payload gift.mjs spreads into a SUCCESSFUL retrieve of an on_site
 * record: the guest-safe draw window. Internal state names (draft/locked/…)
 * never leak — guests see the phase and whether a claim would succeed.
 */
export async function onsiteRetrieveExtras({ db, rec, now = Date.now() }) {
  if (rec?.contextRole !== ONSITE_CONTEXT_ROLE) return {};
  const snap = await db.collection(DRAW_COLLECTION).doc(rec.eventId).get();
  const draw = snap.exists ? readGate(snap.data(), now) : null;
  const visible = draw && draw.enabled === true;
  return {
    contextRole: ONSITE_CONTEXT_ROLE,
    onSite: {
      draw: visible
        ? {
            startAt: draw.startAt,
            cutoffAt: draw.cutoffAt,
            phase: drawPhase(draw, now),
            claimable: draw.status === "open" && drawPhase(draw, now) === "open",
          }
        : null,
    },
  };
}

export const __internal = { DRAW_STATUSES, drawPhase, entrantDocId };
