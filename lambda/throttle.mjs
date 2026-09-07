/**
 * throttle.mjs — transactional sliding-window rate limiting for ANONYMOUS,
 * cost-bearing endpoints (Phase 2 security hardening).
 *
 * Pattern copied from the proven authHandoff.mjs per-UID limiter: one doc per
 * (bucket, caller), minute + hour windows, mutated inside a Firestore
 * transaction so concurrent Lambdas cannot both pass a full window.
 *
 * Scope discipline:
 *   - This is SECURITY rate limiting (abuse/cost protection), never a product
 *     usage quota — the founder's recorded position (gift.mjs "Development
 *     quota REMOVED") stands: entitlement (Credits) and security limits are
 *     separate concerns. Limits here are generous for a human, tight for a
 *     script.
 *   - Applied to UNAUTHENTICATED callers only. A verified Firebase UID skips
 *     the IP window entirely (signed-in users are attributable and already
 *     govern their own doors).
 *   - FAIL OPEN: if the throttle read/write itself errors, the request is
 *     allowed and the error logged — availability of the live product beats
 *     strictness of the limiter.
 *
 * Storage: apiThrottle/{sha256(bucket:key)} →
 *   { bucket, minuteStart, minuteCount, hourStart, hourCount, updatedAt }
 * Docs are tiny, self-resetting by window arithmetic, and carry no PII —
 * the caller key (IP) is stored only as part of the hashed doc id.
 */

import crypto from "node:crypto";

export const THROTTLE_COLLECTION = "apiThrottle";

/** Per-bucket limits — generous for humans, hostile to scripts. */
export const THROTTLE_BUCKETS = {
  // Gift.Seen legacy free-text drafting (the one anonymous AI door the
  // product deliberately keeps pre-auth — protect it, don't gate it).
  express_draft_anon: { minuteMax: 10, hourMax: 60 },
  // Seen app Reflect send — many legitimate users can share a NAT IP, so the
  // hour window is wide; the minute window still stops tight loops.
  reflect_send_anon: { minuteMax: 20, hourMax: 240 },
  reflect_extract_anon: { minuteMax: 10, hourMax: 60 },
  voice_transcribe_anon: { minuteMax: 6, hourMax: 40 },
  moment_caption_anon: { minuteMax: 10, hourMax: 60 },
  // Quick Reply door (anonymous, grant-guarded): generous for a human
  // acknowledging a gift, hostile to scripted spam.
  quick_reply_anon: { minuteMax: 6, hourMax: 40 },
  // Gift.Tag publish-grant minting (per UID, authenticated): Gift.Tag digital
  // publication is FREE by locked product rule, so the mint is the security
  // boundary — generous for a human printing several tags in a sitting,
  // hostile to a free-publishing farm. SECURITY bound, not a product price.
  tag_grant_mint: { minuteMax: 3, hourMax: 12 },
};

export function throttleDocId(bucket, key) {
  return crypto.createHash("sha256").update(`${bucket}:${key}`).digest("hex");
}

/**
 * Check-and-count one request. Returns { allowed, retryAfterMs? }.
 * `key` is the caller identity (source IP for anonymous traffic).
 */
export async function allowRequest({ db, bucket, key, now = Date.now() }) {
  const limits = THROTTLE_BUCKETS[bucket];
  if (!limits) return { allowed: true }; // unknown bucket: never block traffic
  if (!key) return { allowed: true }; // no caller identity available: fail open
  const ref = db.collection(THROTTLE_COLLECTION).doc(throttleDocId(bucket, key));
  try {
    // Fail-open FAST: a wedged/unreachable Firestore must never add seconds
    // of latency to a live AI request — the window check races a hard cap.
    return await withTimeout(runWindowTransaction(db, ref, bucket, limits, now), 1500);
  } catch (err) {
    console.error(`[throttle] ${bucket} check failed (allowing):`, err?.message);
    return { allowed: true };
  }
}

function withTimeout(promise, ms) {
  let timer;
  return Promise.race([
    promise.finally(() => clearTimeout(timer)),
    new Promise((_resolve, reject) => {
      timer = setTimeout(() => reject(new Error("throttle_timeout")), ms);
      if (typeof timer.unref === "function") timer.unref();
    }),
  ]);
}

function runWindowTransaction(db, ref, bucket, limits, now) {
  return db.runTransaction(async (tx) => {
      const snap = await tx.get(ref);
      const d = snap.exists ? snap.data() : {};
      const minuteStart = d.minuteStart && now - d.minuteStart < 60_000 ? d.minuteStart : now;
      const hourStart = d.hourStart && now - d.hourStart < 3_600_000 ? d.hourStart : now;
      const minuteCount = minuteStart === d.minuteStart ? (d.minuteCount ?? 0) : 0;
      const hourCount = hourStart === d.hourStart ? (d.hourCount ?? 0) : 0;
      if (minuteCount >= limits.minuteMax) {
        return { allowed: false, retryAfterMs: minuteStart + 60_000 - now };
      }
      if (hourCount >= limits.hourMax) {
        return { allowed: false, retryAfterMs: hourStart + 3_600_000 - now };
      }
      tx.set(ref, {
        bucket,
        minuteStart,
        minuteCount: minuteCount + 1,
        hourStart,
        hourCount: hourCount + 1,
        updatedAt: now,
      });
      return { allowed: true };
  });
}

/** Standard 429 body for a refused request. */
export function throttledResponse(check) {
  return {
    status: 429,
    body: {
      error: "rate_limited",
      retryAfterMs: Math.max(0, check.retryAfterMs ?? 0),
    },
  };
}
