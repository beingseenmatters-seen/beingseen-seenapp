// ---------------------------------------------------------------------------
// MATTERS cross-product SSO — one-time handoff codes (Phase 1, Rev.2 design).
//
// One identity, separate private rooms: this module moves ONLY identity
// (a Firebase custom token for an existing UID) between MATTERS web origins.
// It never reads or writes any product data.
//
// Transport is a URL FRAGMENT (#sso=<code>) — the code never reaches any
// server or CDN log; it is presented back to us only in POST bodies.
//
// Lifecycle:  create (www, ID-token-authenticated)
//          →  redeem (destination, app-key; no local user)          — consumes
//          |  inspect (destination, LOCAL user's ID token required)
//             ├─ same account   → consumed atomically ("discarded")
//             └─ different acct → { sameAccount:false, incomingEmail } only;
//                                 the incoming UID never leaves the server.
//
// Consumption is an atomic state transition (live → consumed|discarded) inside
// a Firestore transaction; tombstones remain until TTL purge so a replay can
// be answered with an explicit `code_used` rather than `not_found`.
//
// Logging discipline: NEVER log a raw code or a custom token — only
// sha256(code) prefixes and outcomes.
// ---------------------------------------------------------------------------

import crypto from "node:crypto";

export const HANDOFF_COLLECTION = "authHandoff";
export const HANDOFF_LIMITS_COLLECTION = "authHandoffLimits";
export const HANDOFF_IP_LIMITS_COLLECTION = "authHandoffIpLimits";
export const HANDOFF_SCHEMA_VERSION = 1;

/** V1 TTL — frozen at 45s by Founder decision. */
export const HANDOFF_TTL_MS = 45_000;
export const HANDOFF_MAX_INSPECTS = 5;

/** All audiences known to the architecture ('moments' reserved). */
export const HANDOFF_KNOWN_AUDIENCES = ["seen", "gift", "moments"];

/** Audiences enabled for production create. Moments requires a Founder decision. */
export function enabledCreateAudiences() {
  const raw = process.env.HANDOFF_CREATE_AUDIENCES || "seen,gift";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

/** Genuine MATTERS origins. Dev origins only via explicit env opt-in. */
export const HANDOFF_WWW_ORIGINS = [
  "https://www.beingseenmatters.com",
  "https://beingseenmatters.com",
];
export const HANDOFF_AUD_ORIGINS = {
  seen: ["https://app.beingseenmatters.com"],
  gift: ["https://gift.beingseenmatters.com"],
  moments: ["https://moments.beingseenmatters.com"],
};
function devOrigins() {
  const raw = process.env.HANDOFF_DEV_ORIGINS || "";
  return raw.split(",").map((s) => s.trim()).filter(Boolean);
}

export function sha256Hex(input) {
  return crypto.createHash("sha256").update(input).digest("hex");
}

export function generateHandoffCode() {
  // 256-bit, base64url, 43 chars — unguessable.
  return crypto.randomBytes(32).toString("base64url");
}

export function isValidCodeFormat(code) {
  return typeof code === "string" && /^[A-Za-z0-9_-]{43}$/.test(code);
}

function codeHashPrefix(code) {
  return sha256Hex(code).slice(0, 8);
}

/** All MATTERS origins allowed on handoff CORS (for the preflight/echo). */
export function allHandoffOrigins() {
  return [
    ...HANDOFF_WWW_ORIGINS,
    ...Object.values(HANDOFF_AUD_ORIGINS).flat(),
    ...devOrigins(),
  ];
}

function originAllowedForCreate(origin) {
  if (!origin) return true; // non-browser callers: app key still required
  return [...HANDOFF_WWW_ORIGINS, ...devOrigins()].includes(origin);
}

function originAllowedForAud(origin, aud) {
  if (!origin) return true;
  const allowed = [...(HANDOFF_AUD_ORIGINS[aud] || []), ...devOrigins()];
  return allowed.includes(origin);
}

// --- per-UID create rate limit (6/min, 30/hour) ----------------------------
const CREATE_MINUTE_MAX = 6;
const CREATE_HOUR_MAX = 30;

async function checkCreateRateLimit(db, uid, now) {
  const ref = db.collection(HANDOFF_LIMITS_COLLECTION).doc(uid);
  return db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() : {};
    const minuteStart = d.minuteStart && now - d.minuteStart < 60_000 ? d.minuteStart : now;
    const minuteCount = minuteStart === d.minuteStart ? (d.minuteCount || 0) : 0;
    const hourStart = d.hourStart && now - d.hourStart < 3_600_000 ? d.hourStart : now;
    const hourCount = hourStart === d.hourStart ? (d.hourCount || 0) : 0;
    if (minuteCount >= CREATE_MINUTE_MAX || hourCount >= CREATE_HOUR_MAX) {
      return false;
    }
    tx.set(ref, {
      minuteStart,
      minuteCount: minuteCount + 1,
      hourStart,
      hourCount: hourCount + 1,
      updatedAt: now,
    });
    return true;
  });
}

// --- per-IP failure cooldown for redeem/inspect probing --------------------
// Counts only probing signals (malformed / unknown code). Legitimate-user
// errors (expired, already used, aud mismatch) are not punished.
const IP_FAIL_WINDOW_MS = 10 * 60_000;
const IP_FAIL_MAX = 10;
const IP_LOCK_MS = 15 * 60_000;

async function ipCooldownActive(db, sourceIp, now) {
  if (!sourceIp) return false;
  const ref = db.collection(HANDOFF_IP_LIMITS_COLLECTION).doc(sha256Hex(sourceIp));
  const snap = await ref.get();
  if (!snap.exists) return false;
  const d = snap.data();
  return Boolean(d.lockedUntil && now < d.lockedUntil);
}

async function recordIpFailure(db, sourceIp, now) {
  if (!sourceIp) return;
  const ref = db.collection(HANDOFF_IP_LIMITS_COLLECTION).doc(sha256Hex(sourceIp));
  await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    const d = snap.exists ? snap.data() : {};
    const windowStart = d.windowStart && now - d.windowStart < IP_FAIL_WINDOW_MS ? d.windowStart : now;
    const failures = (windowStart === d.windowStart ? (d.failures || 0) : 0) + 1;
    const lockedUntil = failures >= IP_FAIL_MAX ? now + IP_LOCK_MS : d.lockedUntil || null;
    tx.set(ref, { windowStart, failures, lockedUntil, updatedAt: now });
  });
}

// ---------------------------------------------------------------------------
// POST /auth/handoff/create — www only; requires verified Firebase ID token.
// ---------------------------------------------------------------------------
export async function createHandoff({ db, decoded, body, origin, now = Date.now(), makeExpireTimestamp = null }) {
  if (!decoded || !decoded.uid) {
    return { status: 401, body: { error: "unauthorized" } };
  }
  const aud = body?.aud;
  if (!HANDOFF_KNOWN_AUDIENCES.includes(aud)) {
    return { status: 400, body: { error: "invalid_aud" } };
  }
  if (!enabledCreateAudiences().includes(aud)) {
    return { status: 403, body: { error: "aud_not_enabled" } };
  }
  if (!originAllowedForCreate(origin)) {
    return { status: 403, body: { error: "origin_mismatch" } };
  }

  const allowed = await checkCreateRateLimit(db, decoded.uid, now);
  if (!allowed) {
    console.warn(`[Handoff] create rate-limited uid=${decoded.uid}`);
    return { status: 429, body: { error: "rate_limited" } };
  }

  const code = generateHandoffCode();
  const hash = sha256Hex(code);
  const record = {
    schemaVersion: HANDOFF_SCHEMA_VERSION,
    uid: decoded.uid,
    aud,
    createdAt: now,
    expiresAtMs: now + HANDOFF_TTL_MS,
    state: "live",
    inspects: 0,
  };
  // NO email, NO display name, NO IP — data minimization is frozen design.
  if (makeExpireTimestamp) {
    // Firestore Timestamp twin of expiresAtMs, so a console TTL policy can purge tombstones.
    record.expireAt = makeExpireTimestamp(record.expiresAtMs);
  }
  await db.collection(HANDOFF_COLLECTION).doc(hash).set(record);
  console.log(`[Handoff] create ok aud=${aud} codeHash=${hash.slice(0, 8)}`);
  return { status: 200, body: { code, expiresIn: HANDOFF_TTL_MS / 1000 } };
}

// ---------------------------------------------------------------------------
// POST /auth/handoff/inspect — destination with a LOCAL signed-in user only.
// Requires the LOCAL user's verified ID token. Never returns the incoming UID.
// Same account → consumes the code atomically and returns { sameAccount: true }.
// ---------------------------------------------------------------------------
export async function inspectHandoff({ db, authAdmin, decoded, body, origin, sourceIp, now = Date.now() }) {
  if (!decoded || !decoded.uid) {
    return { status: 401, body: { error: "unauthorized" } };
  }
  const { code, aud } = body || {};
  if (!HANDOFF_KNOWN_AUDIENCES.includes(aud)) {
    return { status: 400, body: { error: "invalid_aud" } };
  }
  if (!originAllowedForAud(origin, aud)) {
    return { status: 403, body: { error: "origin_mismatch" } };
  }
  if (await ipCooldownActive(db, sourceIp, now)) {
    return { status: 429, body: { error: "cooldown" } };
  }
  if (!isValidCodeFormat(code)) {
    await recordIpFailure(db, sourceIp, now);
    return { status: 400, body: { error: "invalid_code" } };
  }

  const ref = db.collection(HANDOFF_COLLECTION).doc(sha256Hex(code));
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { kind: "not_found" };
    const d = snap.data();
    if (d.aud !== aud) return { kind: "aud_mismatch" };
    if (now > d.expiresAtMs) return { kind: "expired" };
    if (d.state !== "live") return { kind: "used" };
    if (d.uid === decoded.uid) {
      // Rev.4: same-account silent path consumes server-side, atomically.
      tx.update(ref, { state: "discarded", discardedAt: now });
      return { kind: "same" };
    }
    if ((d.inspects || 0) >= HANDOFF_MAX_INSPECTS) {
      return { kind: "too_many_inspects" };
    }
    tx.update(ref, { inspects: (d.inspects || 0) + 1 });
    return { kind: "different", incomingUid: d.uid };
  });

  const prefix = codeHashPrefix(code);
  switch (result.kind) {
    case "not_found":
      await recordIpFailure(db, sourceIp, now);
      return { status: 404, body: { error: "not_found" } };
    case "aud_mismatch":
      console.warn(`[Handoff] inspect aud_mismatch codeHash=${prefix}`);
      return { status: 403, body: { error: "aud_mismatch" } };
    case "expired":
      return { status: 410, body: { error: "code_expired" } };
    case "used":
      return { status: 410, body: { error: "code_used" } };
    case "too_many_inspects":
      return { status: 429, body: { error: "too_many_inspects" } };
    case "same":
      console.log(`[Handoff] inspect same-account consume codeHash=${prefix}`);
      return { status: 200, body: { sameAccount: true } };
    case "different": {
      // Email resolved live from Firebase Admin ONLY here (never persisted);
      // disclosed only to an authenticated destination session for the choice UI.
      let incomingEmail = null;
      try {
        const user = await authAdmin.getUser(result.incomingUid);
        incomingEmail = user.email || null;
      } catch (err) {
        console.warn(`[Handoff] inspect getUser failed codeHash=${prefix}:`, err?.code || err?.message);
      }
      console.log(`[Handoff] inspect different-account codeHash=${prefix}`);
      return { status: 200, body: { sameAccount: false, incomingEmail } };
    }
    default:
      return { status: 500, body: { error: "internal" } };
  }
}

// ---------------------------------------------------------------------------
// POST /auth/handoff/redeem — destination, app-key only (the code IS the
// credential). Consumes atomically; mints a custom token for the stored UID.
// ---------------------------------------------------------------------------
export async function redeemHandoff({ db, authAdmin, body, origin, sourceIp, now = Date.now() }) {
  const { code, aud } = body || {};
  if (!HANDOFF_KNOWN_AUDIENCES.includes(aud)) {
    return { status: 400, body: { error: "invalid_aud" } };
  }
  if (!originAllowedForAud(origin, aud)) {
    return { status: 403, body: { error: "origin_mismatch" } };
  }
  if (await ipCooldownActive(db, sourceIp, now)) {
    return { status: 429, body: { error: "cooldown" } };
  }
  if (!isValidCodeFormat(code)) {
    await recordIpFailure(db, sourceIp, now);
    return { status: 400, body: { error: "invalid_code" } };
  }

  const ref = db.collection(HANDOFF_COLLECTION).doc(sha256Hex(code));
  const result = await db.runTransaction(async (tx) => {
    const snap = await tx.get(ref);
    if (!snap.exists) return { kind: "not_found" };
    const d = snap.data();
    if (d.aud !== aud) return { kind: "aud_mismatch" }; // not consumed: likely a client bug, not the holder's fault
    if (now > d.expiresAtMs) return { kind: "expired" };
    if (d.state !== "live") return { kind: "used" };
    tx.update(ref, { state: "consumed", consumedAt: now });
    return { kind: "ok", uid: d.uid };
  });

  const prefix = codeHashPrefix(code);
  switch (result.kind) {
    case "not_found":
      await recordIpFailure(db, sourceIp, now);
      return { status: 404, body: { error: "not_found" } };
    case "aud_mismatch":
      console.warn(`[Handoff] redeem aud_mismatch codeHash=${prefix}`);
      return { status: 403, body: { error: "aud_mismatch" } };
    case "expired":
      return { status: 410, body: { error: "code_expired" } };
    case "used":
      console.warn(`[Handoff] redeem replay rejected codeHash=${prefix}`);
      return { status: 410, body: { error: "code_used" } };
    case "ok": {
      try {
        const customToken = await authAdmin.createCustomToken(result.uid);
        console.log(`[Handoff] redeem ok codeHash=${prefix}`);
        return { status: 200, body: { customToken } };
      } catch (err) {
        // Code is burned but no token was issued — degrade to normal sign-in.
        console.error(`[Handoff] createCustomToken failed codeHash=${prefix}:`, err?.code || err?.message);
        return { status: 500, body: { error: "token_mint_failed" } };
      }
    }
    default:
      return { status: 500, body: { error: "internal" } };
  }
}
