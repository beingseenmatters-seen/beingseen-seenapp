/**
 * Seen — Relationship Expression / QR Gift (feat/expression-gift-v1)
 *
 * Server-side of the Gift loop: create → (QR carries opaque token URL) →
 * retrieve with the 六位心意钥匙. GLOBAL-only V1, Firestore via Admin SDK.
 *
 * Security invariants (Founder-approved amendments):
 *   1. The raw 128-bit opaque token is NEVER persisted. Firestore keys the
 *      record by tokenHash = SHA-256(token). Retrieve hashes the request token
 *      and looks up by hash. The raw token lives only in the QR URL.
 *   2. Failed retrieval attempts NEVER permanently lock a Gift. They apply
 *      escalating *temporary* cooldowns only. Only the sender may revoke.
 *   3. The retrieval key (心意钥匙) is a six-digit numeric SECOND secret; the
 *      opaque token is the primary entropy. No token-only retrieval path.
 *
 * All message handling goes through the `giftCrypto` boundary so a future
 * retrieval-key-derived encryption model can be introduced without changing
 * handlers or client contracts. V1 keeps messages server-readable (identity
 * seal) — this module does not claim Seen cannot technically read content.
 */

import crypto from "node:crypto";

// --- Config ---------------------------------------------------------------
export const GIFT_PUBLIC_BASE_URL =
  process.env.GIFT_PUBLIC_BASE_URL || "https://app.beingseenmatters.com";
export const GIFT_COLLECTION = "giftMessages";
export const GIFT_SCHEMA_VERSION = 1;

const MESSAGE_MAX_LEN = 2000;
const DEFAULT_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year
const CREATE_CAP_PER_DAY = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

// Escalating temporary cooldowns. A cooldown is applied every LOCK_EVERY
// cumulative failed attempts; the tier index selects the duration. Beyond the
// last tier the longest duration repeats — access ALWAYS returns after the
// cooldown; a Gift is never permanently destroyed by bad guesses.
const LOCK_EVERY = 5;
const COOLDOWN_TIERS_MS = [
  15 * 60 * 1000, //  1st lock (after 5 fails)  → 15 minutes
  60 * 60 * 1000, //  2nd lock (after 10 fails) →  1 hour
  24 * 60 * 60 * 1000, // 3rd+ lock (after 15+) → 24 hours
];

// --- Primitives -----------------------------------------------------------

export function sha256Hex(input) {
  return crypto.createHash("sha256").update(String(input)).digest("hex");
}

/** ~128-bit opaque bearer token for the public QR URL. */
export function generateToken() {
  return crypto.randomBytes(16).toString("base64url");
}

/** Six-digit numeric 心意钥匙 (second secret). */
export function generateRetrievalKey() {
  return String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
}

function normalizeKey(key) {
  return String(key ?? "").replace(/[\s-]/g, "");
}

/**
 * giftCrypto — the single upgrade boundary for key hashing and message
 * seal/open. V1: scrypt-hashed key + identity message seal (server-readable).
 * To make Seen technically unable to read content later, change `seal`/`open`
 * to derive an encryption key from the retrieval key here — handlers and the
 * client contract stay identical.
 */
export const giftCrypto = {
  hashKey(key, salt = crypto.randomBytes(16).toString("hex")) {
    const hash = crypto.scryptSync(String(key), salt, 64).toString("hex");
    return { salt, hash };
  },
  verifyKey(key, salt, expectedHash) {
    if (!salt || !expectedHash) return false;
    const actual = crypto.scryptSync(String(key), salt, 64).toString("hex");
    const a = Buffer.from(actual, "hex");
    const b = Buffer.from(expectedHash, "hex");
    return a.length === b.length && crypto.timingSafeEqual(a, b);
  },
  seal(plaintext) {
    // V1: server-readable. Reserved for retrieval-key-derived encryption.
    return { message: String(plaintext) };
  },
  open(record) {
    return record.message;
  },
};

/**
 * Content moderation boundary. V1 does structural validation only; reserved
 * for an LLM moderation pass (same OpenAI path used elsewhere) before GA.
 */
export async function moderateGiftMessage(message) {
  if (!message || !message.trim()) return { ok: false, reason: "empty" };
  return { ok: true };
}

// --- Handlers -------------------------------------------------------------

/** POST /gift/create — requires a verified Firebase ID token (author). */
export async function createGift({ db, decoded, body, now = Date.now() }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };

  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return { status: 400, body: { error: "invalid_message" } };
  if (message.length > MESSAGE_MAX_LEN) {
    return { status: 400, body: { error: "message_too_long" } };
  }

  const moderation = await moderateGiftMessage(message);
  if (!moderation.ok) {
    return { status: 422, body: { error: "moderation_blocked", detail: moderation.reason } };
  }

  // Per-uid daily creation cap.
  const since = now - DAY_MS;
  const recent = await db
    .collection(GIFT_COLLECTION)
    .where("senderUid", "==", decoded.uid)
    .where("createdAt", ">=", since)
    .get();
  const recentCount = typeof recent.size === "number" ? recent.size : recent.docs?.length ?? 0;
  if (recentCount >= CREATE_CAP_PER_DAY) {
    return { status: 429, body: { error: "rate_limited" } };
  }

  const token = generateToken();
  const tokenHash = sha256Hex(token);
  const retrievalKey = generateRetrievalKey();
  const { salt: keySalt, hash: keyHash } = giftCrypto.hashKey(retrievalKey);

  const senderName =
    typeof body?.senderName === "string" && body.senderName.trim()
      ? body.senderName.trim().slice(0, 40)
      : null;
  const tone =
    typeof body?.tone === "string" && body.tone.trim() ? body.tone.trim().slice(0, 24) : null;

  const record = {
    schemaVersion: GIFT_SCHEMA_VERSION,
    senderUid: decoded.uid,
    senderName,
    tone,
    ...giftCrypto.seal(message), // { message } in V1
    keySalt,
    keyHash,
    region: "GLOBAL",
    createdAt: now,
    expiresAt: now + DEFAULT_TTL_MS,
    redeemedAt: null,
    revoked: false,
    failedAttempts: 0,
    lockedUntil: null,
    cooldownTier: 0,
  };

  // Doc id = tokenHash. The raw token is never written to Firestore.
  await db.collection(GIFT_COLLECTION).doc(tokenHash).set(record);

  return {
    status: 200,
    body: { token, url: `${GIFT_PUBLIC_BASE_URL}/s/${token}`, retrievalKey },
  };
}

/** POST /gift/retrieve — app-key only (recipient may have no Seen account). */
export async function retrieveGift({ db, body, now = Date.now() }) {
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const key = normalizeKey(body?.key);
  if (!token) return { status: 400, body: { error: "invalid_request" } };

  const tokenHash = sha256Hex(token);
  const ref = db.collection(GIFT_COLLECTION).doc(tokenHash);
  const snap = await ref.get();
  if (!snap.exists) return { status: 404, body: { error: "not_found" } };

  const rec = snap.data();
  if (rec.revoked) return { status: 410, body: { error: "revoked" } };
  if (rec.expiresAt && now > rec.expiresAt) return { status: 410, body: { error: "expired" } };
  if (rec.lockedUntil && now < rec.lockedUntil) {
    return { status: 423, body: { error: "locked", lockedUntil: rec.lockedUntil } };
  }

  const ok = key.length > 0 && giftCrypto.verifyKey(key, rec.keySalt, rec.keyHash);

  if (!ok) {
    const failedAttempts = (rec.failedAttempts || 0) + 1;
    let lockedUntil = null;
    let cooldownTier = rec.cooldownTier || 0;
    let locked = false;

    if (failedAttempts % LOCK_EVERY === 0) {
      const tierIndex = Math.min(
        Math.floor(failedAttempts / LOCK_EVERY) - 1,
        COOLDOWN_TIERS_MS.length - 1,
      );
      lockedUntil = now + COOLDOWN_TIERS_MS[tierIndex];
      cooldownTier = tierIndex + 1;
      locked = true;
      // Reserved: emit an abuse/security event or sender notification here.
      console.warn(
        `[gift] repeated failed retrieval on ${tokenHash.slice(0, 8)}… attempts=${failedAttempts} tier=${cooldownTier}`,
      );
    }

    await ref.update({ failedAttempts, lockedUntil, cooldownTier });

    if (locked) {
      return { status: 423, body: { error: "locked", lockedUntil, attemptsRemaining: 0 } };
    }
    return {
      status: 401,
      body: { error: "invalid_key", attemptsRemaining: LOCK_EVERY - (failedAttempts % LOCK_EVERY) },
    };
  }

  // Success — reset counters; set redeemedAt on first open (keepsake-friendly:
  // stays re-viewable by key thereafter).
  const redeemedAt = rec.redeemedAt || now;
  await ref.update({ failedAttempts: 0, lockedUntil: null, cooldownTier: 0, redeemedAt });

  return {
    status: 200,
    body: {
      message: giftCrypto.open(rec),
      senderName: rec.senderName ?? null,
      tone: rec.tone ?? null,
      createdAt: rec.createdAt,
      redeemedAt,
    },
  };
}

/** POST /gift/revoke — sender-only. The only way a Gift becomes inaccessible. */
export async function revokeGift({ db, decoded, body }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const tokenHash = token
    ? sha256Hex(token)
    : typeof body?.tokenHash === "string"
      ? body.tokenHash
      : "";
  if (!tokenHash) return { status: 400, body: { error: "invalid_request" } };

  const ref = db.collection(GIFT_COLLECTION).doc(tokenHash);
  const snap = await ref.get();
  if (!snap.exists) return { status: 404, body: { error: "not_found" } };
  const rec = snap.data();
  if (rec.senderUid !== decoded.uid) return { status: 403, body: { error: "forbidden" } };

  await ref.update({ revoked: true });
  return { status: 200, body: { ok: true } };
}
