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
 *   2. Failed key attempts (retrieve AND rsvp — one shared counter) NEVER
 *      permanently lock a Gift. They apply escalating *temporary* cooldowns
 *      only. Only the sender may revoke.
 *   3. The retrieval key (心意钥匙) is a six-digit numeric SECOND secret; the
 *      opaque token is the primary entropy. No token-only retrieval path.
 *
 * All message handling goes through the `giftCrypto` boundary so a future
 * retrieval-key-derived encryption model can be introduced without changing
 * handlers or client contracts. V1 keeps messages server-readable (identity
 * seal) — this module does not claim Seen cannot technically read content.
 */

import crypto from "node:crypto";
import { validateWeddingOccasion, WEDDING_MUSIC_THEMES } from "./occasion.mjs";
import {
  normalizeRecipientLabel,
  validateRsvpCounts,
  ensureEvent,
  deleteCreatedEvent,
} from "./event.mjs";
import { onsiteRetrieveExtras } from "./onsite.mjs";
import {
  finalizePresentation,
  mintPresentation,
  sealedAssetIds,
  deleteSealedMedia,
} from "./giftMedia.mjs";

// --- Config ---------------------------------------------------------------
export const GIFT_PUBLIC_BASE_URL =
  process.env.GIFT_PUBLIC_BASE_URL || "https://app.beingseenmatters.com";
export const GIFT_COLLECTION = "giftMessages";
export const GIFT_SCHEMA_VERSION = 1;

const MESSAGE_MAX_LEN = 2000;
const DEFAULT_TTL_MS = 365 * 24 * 60 * 60 * 1000; // 1 year
// Development quota REMOVED (Founder, 4.5-B3 supplement): product usage
// entitlement (future weekly free allowance + Credits) and security rate
// limiting are separate concerns — a paid sender with sufficient Credits is
// never blocked by an arbitrary daily ceiling, and a real Wedding may
// legitimately create 100-300+ recipient-specific Invitations in one
// session. Security protections (auth, Heart Key attempt cooldowns, request
// validation, infrastructure-level abuse protection) are untouched. The
// ≤20-guest distribute chunk is an internal API size, never a user quota.

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

/**
 * Reject obvious/weak six-digit keys: non-6-digit, all-same-digit, or a
 * straight ascending/descending run (covers 000000, 111111, 999999, 123456,
 * 654321, 012345, 987654, …). Applies to both generated and custom keys.
 */
export function isWeakKey(key) {
  if (!/^\d{6}$/.test(key)) return true;
  if (/^(\d)\1{5}$/.test(key)) return true;
  if ("0123456789".includes(key)) return true;
  if ("9876543210".includes(key)) return true;
  return false;
}

/** Six-digit numeric 心意钥匙 (second secret); never a weak value. */
export function generateRetrievalKey() {
  let key;
  do {
    key = String(crypto.randomInt(0, 1_000_000)).padStart(6, "0");
  } while (isWeakKey(key));
  return key;
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
export async function createGift({ db, decoded, body, now = Date.now(), media = null, share = null }) {
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

  // Structured Occasion (Wedding V1): optional, validated, immutable once
  // sealed. Facts persist as first-class data — never only inside AI prose,
  // and never carrying presentation/QR identity (those are separate layers
  // derived later from occasion.type). Absent for ordinary Expression gifts,
  // whose record shape stays identical. Malformed occasion data is REJECTED,
  // never silently dropped.
  let occasion = null;
  if (body?.occasion !== undefined && body?.occasion !== null) {
    const res = validateWeddingOccasion(body.occasion);
    if (!res.ok) {
      return { status: 400, body: { error: "invalid_occasion", field: res.field } };
    }
    occasion = res.occasion;
  }

  // Event linkage (Phase 4.5-A): a recipient-specific Invitation belongs to
  // a Wedding Event. Two intents — eventCreate (first seal silently creates
  // the Event from these facts) or eventId (attach to the sender's own
  // active event). Both REQUIRE occasion facts, a recipientLabel (household
  // display identity, sender-authored), and a configured share crypto —
  // an Event invitation the sender could never re-share would be a managed
  // record with no handle, so its absence fails EXPLICITLY, never silently.
  // Ordinary gifts and standalone Wedding gifts never enter this block.
  const wantsEvent = body?.eventCreate === true || typeof body?.eventId === "string";
  let recipientLabel = null;
  if (wantsEvent) {
    if (!occasion) return { status: 400, body: { error: "invalid_event", field: "occasion" } };
    if (!share) return { status: 503, body: { error: "share_unavailable" } };
    const lab = normalizeRecipientLabel(body?.recipientLabel);
    if (!lab.ok) return { status: 400, body: { error: lab.error, field: lab.field } };
    recipientLabel = lab.label;
  } else if (body?.recipientLabel !== undefined) {
    // A label without an event has no meaning — reject rather than drop.
    return { status: 400, body: { error: "invalid_recipient_label", field: "event" } };
  }

  // Access mode (sealing-time, immutable): 'heart_key' keeps the six-digit
  // challenge; 'direct' lets the recipient open with the link alone — the
  // ~128-bit token stays the possession credential. Stored EXPLICITLY.
  // Defaults (Founder-approved Invitation access policy): ordinary gifts
  // default to 'heart_key' (unchanged, what all legacy clients get);
  // Invitation-type gifts (occasion present) default to 'direct' — effortless
  // by default, private by choice. An explicit accessMode always wins, so
  // 私密邀请 (heart_key) remains fully supported for invitations.
  const accessMode =
    body?.accessMode === "direct"
      ? "direct"
      : body?.accessMode === "heart_key"
        ? "heart_key"
        : occasion
          ? "direct"
          : "heart_key";

  // Heart Key: use a sender-chosen custom key when provided, else generate one.
  // A custom key is stored/hashed EXACTLY like a generated key (no difference);
  // weak values are refused server-side regardless of client validation.
  // Direct gifts have NO key at all (nothing to manage, share, or hash).
  let retrievalKey = null;
  let keySalt = null;
  let keyHash = null;
  if (accessMode === "heart_key") {
    const provided = normalizeKey(body?.retrievalKey);
    if (provided) {
      if (isWeakKey(provided)) return { status: 400, body: { error: "weak_key" } };
      retrievalKey = provided;
    } else {
      retrievalKey = generateRetrievalKey();
    }
    ({ salt: keySalt, hash: keyHash } = giftCrypto.hashKey(retrievalKey));
  }

  const token = generateToken();
  const tokenHash = sha256Hex(token);

  // Resolve/create the Event, then seal the sender-recoverable share
  // credential. Order matters for atomicity: everything expensive that can
  // fail AFTER an event exists must compensate the event we created (never
  // an attached pre-existing one) so a failed first seal leaves no orphan.
  let eventId = null;
  let eventCreated = false;
  let shareTokenSealed = null;
  if (wantsEvent) {
    const ev = await ensureEvent({ db, decoded, body, occasion, now });
    if (!ev.ok) return ev.res;
    eventId = ev.eventId;
    eventCreated = ev.created;
  }
  const compensateEvent = async (reason) => {
    if (eventCreated) await deleteCreatedEvent({ db, eventId, reason });
  };
  if (share) {
    // Every NEW gift gets a recoverable credential while the feature is
    // configured (the future 我发出的心意 lists ordinary gifts too);
    // event-based creates REQUIRE it (checked above).
    try {
      shareTokenSealed = await share.seal(token, tokenHash);
    } catch (err) {
      console.error("[gift] share seal failed:", err?.message);
      if (wantsEvent) {
        await compensateEvent("share_seal_failed");
        return { status: 503, body: { error: "share_seal_failed" } };
      }
      shareTokenSealed = null; // ordinary gifts keep sealing (recovery is additive there)
    }
  }

  // Invitation Presentation (Phase 3C-1): role-aware {photo?, voice?,
  // musicThemeId?}, occasion gifts only. Dual-INPUT during the transition —
  // the legacy single `openingMedia` body normalizes into the same contract
  // (photo→photo role, audio→voice role) so already-deployed clients keep
  // sealing correctly. New records persist ONLY `presentation`. All roles
  // finalize atomically before the record write: any failure compensates
  // promoted copies and KEEPS stagings, so no partial gift can exist and the
  // sender can retry without re-uploading.
  let presentationInput = body?.presentation;
  if ((presentationInput === undefined || presentationInput === null) && body?.openingMedia) {
    const om = body.openingMedia;
    if (om?.type === "photo") presentationInput = { photo: { assetId: om.assetId } };
    else if (om?.type === "audio") presentationInput = { voice: { assetId: om.assetId } };
    else return { status: 400, body: { error: "invalid_media", field: "type" } };
  }
  let presentation = null;
  if (presentationInput !== undefined && presentationInput !== null) {
    if (!occasion) {
      return { status: 400, body: { error: "invalid_media", field: "occasion" } };
    }
    // Presentation reuse across the SAME Event (4.5-B): 继续邀请 carries the
    // Wedding photo/voice forward by product-level reference (fromGiftId) —
    // never S3 keys, never cross-sender, never cross-event, never from a
    // revoked source (its media objects are already best-effort deleted).
    // The fragment (bytes/contentType/durationMs) is inherited verbatim from
    // the source's own validated seal.
    const resolveReuse =
      eventId === null
        ? null
        : async (fromGiftId, role) => {
            const field = `presentation.${role}`;
            const invalid = { ok: false, status: 400, body: { error: "invalid_media", field } };
            if (typeof fromGiftId !== "string" || !fromGiftId.trim()) return invalid;
            const srcSnap = await db.collection(GIFT_COLLECTION).doc(fromGiftId.trim()).get();
            if (!srcSnap.exists) return invalid;
            const src = srcSnap.data();
            if (src.senderUid !== decoded.uid) {
              return { ok: false, status: 403, body: { error: "forbidden" } };
            }
            if (src.eventId !== eventId || src.revoked) return invalid;
            // Photo Story whole-set reuse: role 'photos' inherits the
            // source's ORDERED story (new array or legacy single photo).
            if (role === "photos") {
              const frags =
                src.presentation?.photos ??
                (src.presentation?.photo ? [src.presentation.photo] : []);
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
      presentation: presentationInput,
      tokenHash,
      allowedMusicThemes: WEDDING_MUSIC_THEMES,
      resolveReuse,
    });
    if (!fin.ok) {
      // Presentation failed after a possible silent Event create — undo it.
      await compensateEvent("presentation_failed");
      return { status: fin.status, body: fin.body };
    }
    presentation = fin.presentation;
  }

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
    accessMode,
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
    ...(occasion ? { occasion } : {}),
    ...(presentation ? { presentation } : {}),
    ...(eventId ? { eventId, recipientLabel } : {}),
    // §12 (4.5-C): a direct-share invitation is one LINK, not one household —
    // its RSVP must never masquerade as household attendance statistics.
    ...(eventId && body?.sharedDistribution === true ? { sharedDistribution: true } : {}),
    // Sender-only recoverable credential (KMS-sealed, context-bound to this
    // record). The raw token itself is still NEVER written to Firestore.
    ...(shareTokenSealed ? { shareTokenSealed } : {}),
  };

  // Doc id = tokenHash. The raw token is never written to Firestore.
  try {
    await db.collection(GIFT_COLLECTION).doc(tokenHash).set(record);
  } catch (err) {
    // Never strand sealed media objects behind a record that failed to
    // exist — compensate every promoted role, then surface the failure.
    for (const assetId of sealedAssetIds(record)) {
      await deleteSealedMedia({ store: media, tokenHash, assetId, reason: "create_failed" });
    }
    await compensateEvent("record_write_failed");
    throw err;
  }

  return {
    status: 200,
    body: {
      token,
      url: `${GIFT_PUBLIC_BASE_URL}/s/${token}`,
      retrievalKey,
      accessMode,
      // The composer keeps these to attach subsequent household invitations
      // to the same silently-created Wedding Event, and to carry the sealed
      // presentation forward by reference (giftId = the sender-API record
      // id; opaque, never a secret).
      ...(eventId ? { eventId, giftId: tokenHash } : {}),
    },
  };
}

/**
 * Shared failed-key escalation — the ONE security model for every door that
 * verifies the 心意钥匙 (retrieve and rsvp share the same per-gift counters,
 * so guesses cannot be laundered through whichever endpoint is cheaper).
 * Returns the Firestore field updates plus the response facts.
 */
function registerFailedKeyAttempt(rec, now, tokenHash, door) {
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
      `[gift] repeated failed ${door} on ${tokenHash.slice(0, 8)}… attempts=${failedAttempts} tier=${cooldownTier}`,
    );
  }

  return {
    updates: { failedAttempts, lockedUntil, cooldownTier },
    locked,
    lockedUntil,
    attemptsRemaining: LOCK_EVERY - (failedAttempts % LOCK_EVERY),
  };
}

/** POST /gift/retrieve — app-key only (recipient may have no Seen account). */
export async function retrieveGift({ db, body, now = Date.now(), media = null }) {
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

  // Access mode: EXPLICIT field; every legacy record (no field) is heart_key —
  // all previously sealed gifts keep today's behavior exactly.
  const accessMode = rec.accessMode === "direct" ? "direct" : "heart_key";

  if (accessMode === "direct") {
    // Possession of the unguessable token IS the credential: skip only the
    // key challenge. Revoke/expiry/not-found above remain fully in force.
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
        rsvpStatus: rec.rsvpStatus ?? null,
        rsvpAt: rec.rsvpAt ?? null,
        // Household counts (4.5-A) — the recipient's OWN previous answer,
        // echoed so 更改答复 can prefill. Never other households' data.
        rsvpAdultCount: rec.rsvpAdultCount ?? null,
        rsvpChildCount: rec.rsvpChildCount ?? null,
        // 致 张先生全家 (Founder V2): the household label is presentation
        // personalisation, revealed ONLY on successful access — never on
        // probes, wrong keys, locks, or any error path.
        recipientLabel: rec.recipientLabel ?? null,
        sharedDistribution: rec.sharedDistribution === true,
        accessMode,
        occasion: rec.occasion ?? null,
        // Wedding Day (WD-1): the shared on_site record additionally carries
        // its guest-safe draw window; every other gift spreads nothing.
        ...(await onsiteRetrieveExtras({ db, rec, now })),
        // Role-aware presentation, minted only on successful access; each
        // role degrades independently and never blocks the invitation. The
        // legacy openingMedia shape is SYNTHESIZED from the photo role so
        // already-cached production bundles keep rendering photo gifts.
        ...(await presentationResponse({ store: media, rec, tokenHash })),
      },
    };
  }

  // heart_key: a keyless probe (the client asking "which mode?") is answered
  // WITHOUT burning an attempt — real guesses always carry a non-empty key.
  if (key.length === 0) {
    return { status: 401, body: { error: "key_required" } };
  }

  const ok = giftCrypto.verifyKey(key, rec.keySalt, rec.keyHash);

  if (!ok) {
    const fail = registerFailedKeyAttempt(rec, now, tokenHash, "retrieval");
    await ref.update(fail.updates);

    if (fail.locked) {
      return { status: 423, body: { error: "locked", lockedUntil: fail.lockedUntil, attemptsRemaining: 0 } };
    }
    return {
      status: 401,
      body: { error: "invalid_key", attemptsRemaining: fail.attemptsRemaining },
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
      // Invitation RSVP state, when one has been recorded (null otherwise) —
      // lets a reopened invitation show the answer already given.
      rsvpStatus: rec.rsvpStatus ?? null,
      rsvpAt: rec.rsvpAt ?? null,
      rsvpAdultCount: rec.rsvpAdultCount ?? null,
      rsvpChildCount: rec.rsvpChildCount ?? null,
      recipientLabel: rec.recipientLabel ?? null,
      sharedDistribution: rec.sharedDistribution === true,
      accessMode,
      // Structured Occasion facts (Wedding V1) — first-class data, returned
      // only after successful access. null for every gift sealed without one.
      occasion: rec.occasion ?? null,
      ...(await onsiteRetrieveExtras({ db, rec, now })),
      // Minted only AFTER the Heart Key verified above — private roles are
      // structurally unobtainable before unlock (photo AND voice).
      ...(await presentationResponse({ store: media, rec, tokenHash })),
    },
  };
}

/**
 * Build the transition-compatible presentation fields for a successful
 * retrieve: the new role-aware `presentation` plus a legacy `openingMedia`
 * synthesized from the minted photo descriptor (photo-only, matching what
 * every deployed bundle understands). Remove the synthesis once cached
 * pre-3C bundles have aged out.
 */
async function presentationResponse({ store, rec, tokenHash }) {
  const presentation = await mintPresentation({ store, rec, tokenHash });
  return {
    presentation,
    openingMedia: presentation?.photo
      ? { type: "photo", url: presentation.photo.url, contentType: presentation.photo.contentType }
      : null,
  };
}

/**
 * POST /gift/rsvp — app-key only, no account (an Invitation receiver responds
 * without signing in; this is intentional).
 *
 * Security (Phase 1 hardening): this door verifies the same Heart Key as
 * retrieve, so it runs the SAME escalation model — wrong non-empty keys
 * increment the shared per-gift failure counter and trip the same escalating
 * temporary cooldowns. Before this, /gift/rsvp answered wrong keys with an
 * uncounted 401, making it a free brute-force oracle for the six-digit key.
 *
 * Kept behaviors: direct gifts RSVP on token possession alone (no key);
 * an EMPTY key on a heart_key gift is a client fault, not a guess — plain
 * 401 without burning an attempt (mirrors retrieve's keyless probe); a
 * correct key resets the counters (a legitimate guest can never lock
 * themselves out by answering again); responding again replaces the answer,
 * and rsvpAt always reflects the latest response.
 */
export async function rsvpGift({ db, body, now = Date.now() }) {
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const key = normalizeKey(body?.key);
  const status =
    body?.status === "accepted" || body?.status === "declined" ? body.status : null;
  if (!token || !status) return { status: 400, body: { error: "invalid_request" } };

  // RSVP counts contract (Phase 4.5-A backend layer; UI arrives in 4.5-B).
  // Counts are validated wherever provided; declined always resolves to
  // 0/0; legacy count-less accepts remain valid and never fabricate counts.
  const counts = validateRsvpCounts(status, body);
  if (!counts.ok) {
    return { status: 400, body: { error: counts.error, field: counts.field } };
  }
  const countFields = counts.counts
    ? { rsvpAdultCount: counts.counts.adultCount, rsvpChildCount: counts.counts.childCount }
    : {};
  const rsvpEcho = { ok: true, rsvpStatus: status, rsvpAt: now, ...countFields };

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
  // The shared Wedding Day record is NOT an invitation — it must never
  // acquire an RSVP state (household statistics stay invitation-derived).
  if (rec.contextRole === "on_site") {
    return { status: 409, body: { error: "rsvp_not_applicable" } };
  }

  // Same access policy as retrieve: direct gifts RSVP on token possession
  // alone; heart_key (and every legacy record) still proves the key.
  const rsvpMode = rec.accessMode === "direct" ? "direct" : "heart_key";
  if (rsvpMode === "heart_key") {
    if (key.length === 0) {
      return { status: 401, body: { error: "invalid_key" } };
    }
    if (!giftCrypto.verifyKey(key, rec.keySalt, rec.keyHash)) {
      const fail = registerFailedKeyAttempt(rec, now, tokenHash, "rsvp");
      await ref.update(fail.updates);
      if (fail.locked) {
        return { status: 423, body: { error: "locked", lockedUntil: fail.lockedUntil, attemptsRemaining: 0 } };
      }
      return { status: 401, body: { error: "invalid_key", attemptsRemaining: fail.attemptsRemaining } };
    }
    // Valid key — clear any stale failure state so a legitimate guest who
    // mistyped earlier is never cooled down after proving the key.
    await ref.update({
      failedAttempts: 0,
      lockedUntil: null,
      cooldownTier: 0,
      rsvpStatus: status,
      rsvpAt: now,
      ...countFields,
    });
    return { status: 200, body: rsvpEcho };
  }

  await ref.update({ rsvpStatus: status, rsvpAt: now, ...countFields });
  return { status: 200, body: rsvpEcho };
}

/** POST /gift/revoke — sender-only. The only way a Gift becomes inaccessible. */
export async function revokeGift({ db, decoded, body, media = null }) {
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
  // Revocation gate is the record flag above (blocks all future retrieves and
  // therefore all future media URLs). Object deletion is best-effort privacy
  // hygiene for EVERY private presentation asset the record owns (new
  // contract or legacy openingMedia, photo and voice alike): success kills
  // any already-minted URL early; failure leaves the ≤15-minute URL tail +
  // bucket lifecycle as fallback — never un-revokes.
  for (const assetId of sealedAssetIds(rec)) {
    await deleteSealedMedia({ store: media, tokenHash, assetId, reason: "revoke" });
  }
  return { status: 200, body: { ok: true } };
}
