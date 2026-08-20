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
export const PRIZE_LABEL_MAX_LEN = 40;
export const LOTTERY_LINGER_MS = 3 * 60 * 60 * 1000; // Founder AA-2
const ONSITE_MESSAGE_MAX_LEN = 2000; // couple's Wedding Day message — gift convention
const ONSITE_TTL_MS = 365 * 24 * 60 * 60 * 1000; // record parity with gifts
const DRAW_STATUSES = ["draft", "open", "locked", "drawing", "completed"]; // AA-3

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

  const labels = {};
  for (const [field, tier] of [
    ["third", 3],
    ["second", 2],
    ["first", 1],
  ]) {
    const v = typeof body?.prizes?.[field] === "string" ? body.prizes[field].trim() : "";
    if (!v || v.length > PRIZE_LABEL_MAX_LEN)
      return { status: 400, body: { error: "invalid_prize", field } };
    labels[tier] = v;
  }

  const doc = {
    schemaVersion: 1,
    eventId,
    senderUid: decoded.uid,
    enabled: body.enabled,
    status: existing?.status ?? "draft",
    startAt,
    cutoffAt,
    // V1 fixed tiers ×1 each (Founder AA-7); Gift.Seen supplies no prizes.
    prizes: [
      { tier: 3, label: labels[3] },
      { tier: 2, label: labels[2] },
      { tier: 1, label: labels[1] },
    ],
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
 *   · fixed order 三等奖(3) → 二等奖(2) → 一等奖(1), one winner each;
 *   · one participant may win at most one prize (status 'won' excludes);
 *   · a committed tier is FINAL — every replay/refresh/double-click/second
 *     device converges on the same committed luckyCode; no redraw exists;
 *   · fewer eligible entrants than remaining tiers → clear refusal
 *     (insufficient_entrants), never a fabricated or duplicated winner.
 *
 * Implemented as the codebase's first Firestore transaction: reads of the
 * draw doc + eligible entrants and ALL writes happen inside runTransaction,
 * so concurrent host clicks serialize — the loser's retry re-reads state,
 * finds the tier committed, and returns the same winner. randomInt is
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
      const committed = winners.find((w) => w.tier === tier);
      if (committed) {
        // Replay/refresh/double-click/second device — the committed result.
        return {
          status: 200,
          body: { ok: true, tier, luckyCode: committed.luckyCode, alreadyDrawn: true, status: draw.status },
        };
      }
      if (!["locked", "drawing"].includes(draw.status)) {
        return { status: 409, body: { error: "draw_not_locked", status: draw.status } };
      }
      // Fixed ceremony order 3 → 2 → 1: the requested tier must be the next
      // undrawn one (skipping ahead is refused, never silently reordered).
      const drawnTiers = winners.map((w) => w.tier);
      const nextTier = [3, 2, 1].find((t2) => !drawnTiers.includes(t2));
      if (tier !== nextTier) {
        return { status: 409, body: { error: "draw_out_of_order", nextTier } };
      }

      const poolSnap = await tx.get(entrantsQuery);
      const eligible = (poolSnap.docs ?? [])
        .map((d) => ({ id: d.id, e: d.data() }))
        .filter(({ e }) => readGate(e, now))
        .filter(({ e }) => e.status === "eligible");
      if (eligible.length === 0) {
        return { status: 409, body: { error: "insufficient_entrants" } };
      }

      const pick = eligible[crypto.randomInt(eligible.length)];
      const isLast = tier === 1;
      const completedAt = isLast ? now : (draw.completedAt ?? null);
      tx.update(db.collection(ENTRANT_COLLECTION).doc(pick.id), {
        status: "won",
        prizeTier: tier,
        wonAt: now,
        ...(isLast ? { expireAt: now + LOTTERY_LINGER_MS } : {}),
      });
      tx.update(drawRef, {
        winners: [...winners, { tier, luckyCode: pick.e.luckyCode, at: now }],
        status: isLast ? "completed" : "drawing",
        completedAt,
        updatedAt: now,
        // AA-2 re-anchor on completion; until then the cutoff anchor stands.
        ...(isLast ? { expireAt: now + LOTTERY_LINGER_MS } : {}),
      });
      return {
        status: 200,
        body: { ok: true, tier, luckyCode: pick.e.luckyCode, alreadyDrawn: false, status: isLast ? "completed" : "drawing" },
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

  // NO lottery expireAt here — blessings follow the Event lifecycle (§23).
  await ref.set({
    schemaVersion: 1,
    eventId: rec.eventId,
    senderUid: rec.senderUid,
    text,
    displayName,
    participantIdHash,
    allowLiveDisplay: false, // reserved consent flag (§21); default private
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
      body: { ok: true, luckyCode: e.luckyCode, alreadyClaimed: true, cutoffAt: draw.cutoffAt },
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

  const entrant = {
    schemaVersion: 1,
    eventId: rec.eventId,
    senderUid: rec.senderUid,
    participantIdHash,
    luckyCode,
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
        body: { ok: true, luckyCode: e.luckyCode, alreadyClaimed: true, cutoffAt: draw.cutoffAt },
      };
    }
    throw err;
  }
  return {
    status: 200,
    body: { ok: true, luckyCode, alreadyClaimed: false, cutoffAt: draw.cutoffAt },
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
