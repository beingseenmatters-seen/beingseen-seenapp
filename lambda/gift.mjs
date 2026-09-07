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
import {
  chargeCredits as billingChargeCredits,
  getBalance as billingGetBalance,
  CHARGEABLE_PRODUCTS,
  IDEMPOTENCY_KEY_RE,
} from "./billing.mjs";
import { validateOccasion, WEDDING_MUSIC_THEMES } from "./occasion.mjs";
// FCM Phase 1: Quick Reply owner notification — best-effort, post-commit only.
import { sendQuickReplyPush } from "./push.mjs";
import { submitSharedRsvpForRecord, readSharedResponse } from "./sharedRsvp.mjs";
import {
  normalizeRecipientLabel,
  validateRsvpCounts,
  validateRsvpDietary,
  validateRsvpMessage,
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

// --- Billing publication idempotency (Monetisation Phase 2) ----------------
// SECURITY DECISION (product-owner directive): idempotency must NEVER weaken
// credential entropy. Gift tokens, Heart Keys and salts stay fully RANDOM on
// every attempt. What is deterministic is only the mapping
//     (uid, idempotencyKey) → the one committed publication
// via a tiny intent record written in the SAME transaction as the gift.
// A retry finds the intent, loads the original record, and recovers the
// original credentials through the existing KMS seal (shareTokenSealed for
// the token; retrievalKeySealed — same KMS key, context "#rk" — for a
// GENERATED Heart Key). Nothing secret is ever stored in plaintext, and a
// UUID never becomes key material.

export const GIFT_PUBLISH_INTENTS_COLLECTION = "giftPublishIntents";

// QUICK REPLY (locked product correction, 2026-09-03): a recipient reply is
// a lightweight acknowledgment ATTACHED to the original Gift — it is NOT
// another Gift, mints no QR, needs no account, costs 0 Credits, and never
// routes through Compose. Authorization is SERVER-ISSUED at the one trusted
// boundary that proves recipient-ness (a successful /gift/retrieve: raw-token
// possession plus the six-digit key for heart_key gifts). A client-supplied
// replyToGiftId or any other client field is NEVER sufficient — /gift/create
// has no reply exemption at all, so no reply path can publish a Gift free.
export const REPLY_AUTH_COLLECTION = "replyAuth";
export const REPLY_AUTH_TTL_MS = 90 * 24 * 60 * 60 * 1000;
export const GIFT_REPLIES_COLLECTION = "giftReplies";
/** Per SOURCE GIFT: max valid Quick Replies (LOCKED product rule — a light
 * post-gift connection, not a chat). Server-authoritative count. */
export const REPLY_QUOTA_COLLECTION = "replyQuota";
export const REPLY_FREE_MAX = 5;
export const QUICK_REPLY_MAX_LEN = 500;
export const QUICK_REPLY_SIGNATURE_MAX_LEN = 40;

/**
 * Quick Reply signature — recipient-provided DISPLAY TEXT ONLY (署名，选填).
 * Never identity: it has no effect on authorization, billing, grants, reply
 * counting, or any security decision. Sanitized to one bounded line; blank
 * is valid and renders as the generic 收件人 / Recipient label client-side.
 */
export function sanitizeReplySignature(raw) {
  if (typeof raw !== "string") return null;
  const cleaned = raw
    .replace(/[\u0000-\u001f\u007f]/g, " ") // control chars → space
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, QUICK_REPLY_SIGNATURE_MAX_LEN)
    .trim();
  return cleaned === "" ? null : cleaned;
}

// Gift.Tag digital publication is FREE (LOCKED product rule) — 0 Free,
// 0 Paid. The trusted classification is a SERVER-MINTED one-time grant:
// no client field (type/context/flags) can ever make a publication free.
// Grants are uid-bound, single-use, short-lived, and minting is throttled
// per uid (a security bound against a free-publishing farm, not a price).
export const TAG_PUBLISH_AUTH_COLLECTION = "tagPublishAuth";
// The Seen.Tag inventory collection (tag.mjs owns it; the literal is repeated
// here instead of imported so the module graph stays acyclic — tag.mjs
// imports THIS module for the activation lane).
const TAG_COLLECTION_FOR_GRANTS = "tags";
export const TAG_PUBLISH_AUTH_TTL_MS = 30 * 60 * 1000;

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
export async function createGift({
  db,
  decoded,
  body,
  now = Date.now(),
  media = null,
  share = null,
  billing = { chargeCredits: billingChargeCredits, getBalance: billingGetBalance },
  // Phase 3: "auto" (default) classifies and charges event publications here;
  // "exempt" is passed ONLY by server-internal callers (distribute.mjs) that
  // own the charge themselves. Never derived from the request body.
  eventBilling = "auto",
}) {
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
    const res = validateOccasion(body.occasion);
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
  } else if (
    body?.recipientLabel !== undefined &&
    body?.recipientLabel !== null &&
    String(body.recipientLabel).trim() !== ""
  ) {
    // Ordinary gifts carry an OPTIONAL salutation (TA 的称呼) — the recipient's
    // name/pet-name the sender addressed the message to. Same normalizer, same
    // ≤40 cap as the Event label; absent/empty simply means no salutation
    // (never an error, never a blank rendered). Event semantics above are
    // untouched: there the label stays REQUIRED.
    const lab = normalizeRecipientLabel(body.recipientLabel);
    if (!lab.ok) return { status: 400, body: { error: lab.error, field: lab.field } };
    recipientLabel = lab.label;
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

  // --- Billing classification (Monetisation Phase 2) -----------------------
  // The SERVER derives the billing product from operation context alone —
  // nothing in the request body (price, product, flags) is ever trusted for
  // money. Chargeable = an ordinary Simple Gift publication from a
  // billing-aware client (valid idempotencyKey present) WITHOUT server-issued
  // reply authorization. Explicitly NOT charged in Phase 2:
  //   - occasion/event invitations   (event charging is a later phase)
  //   - server-authorized replies    (LOCKED: replying is FREE — proven by a
  //     grant minted at /gift/retrieve, never by client-sent replyToGiftId)
  //   - legacy clients w/o a key     (deployed bundles must not be charged
  //     invisibly — the charge requires a client that SHOWED the price; this
  //     window is logged, and BILLING_REQUIRE_KEY=on closes it once every
  //     surface ships billing UI)
  // A PRESENT-but-malformed key is a hard 400, never a silent free ride.
  let billingKey = null;
  if (body?.idempotencyKey !== undefined && body?.idempotencyKey !== null) {
    if (typeof body.idempotencyKey !== "string" || !IDEMPOTENCY_KEY_RE.test(body.idempotencyKey)) {
      return { status: 400, body: { error: "invalid_idempotency_key" } };
    }
    billingKey = body.idempotencyKey;
  }
  const simpleShape = !wantsEvent && !occasion;

  // Retry short-circuit — MUST run before reply-grant validation: a retry of
  // a committed reply arrives with its grant already consumed, and must get
  // the original outcome, not invalid_reply. The intent record — written
  // atomically WITH the gift — maps (uid, idempotencyKey) to the original
  // tokenHash; the original credentials are recovered from their KMS seals.
  // Never a duplicate error, never a second gift, never a second charge, and
  // credential entropy is untouched (tokens stay random).
  if (billingKey && (simpleShape || wantsEvent)) {
    const intentSnap = await db
      .collection(GIFT_PUBLISH_INTENTS_COLLECTION)
      .doc(`${decoded.uid}_${billingKey}`)
      .get();
    if (intentSnap.exists) {
      return await recoverPublishedGift({
        db,
        share,
        uid: decoded.uid,
        tokenHash: intentSnap.data().tokenHash,
        providedKey: normalizeKey(body?.retrievalKey) || null,
      });
    }
  }


  // NO reply lane exists here (Quick Reply correction): replies live on the
  // dedicated /gift/reply endpoint and never create a Gift. Any client-sent
  // replyGrant / replyToGiftId / source field on THIS endpoint is ignored —
  // the publication stays a normal chargeable publish. No bypass path.

  // Server-minted Gift.Tag publish authorization (free lane, LOCKED 0-Credit
  // rule). A forged/expired/foreign grant is refused outright (no publish,
  // no charge); a bare client claim ("type":"tag" etc.) is simply ignored —
  // the publication stays chargeable. Mutually exclusive with the reply lane.
  let tagAuthRef = null;
  let isTagPublish = false;
  // PREPRINTED lane (2026-09-05): a grant bound to an official unactivated
  // gift-type Tag publishes for 0 HERE — the record is born pendingTagBind
  // (publicly unusable) and the single 100-Credit charge happens at the
  // atomic activation in tag.mjs. Derived from the GRANT DOC the server
  // minted, never from any client field.
  let preprintedTagId = null;
  const tagGrantRaw =
    typeof body?.tagPublishGrant === "string" && body.tagPublishGrant.trim() !== ""
      ? body.tagPublishGrant.trim()
      : null;
  if (billingKey && simpleShape && tagGrantRaw) {
    tagAuthRef = db.collection(TAG_PUBLISH_AUTH_COLLECTION).doc(sha256Hex(tagGrantRaw));
    const tagSnap = await tagAuthRef.get();
    const auth = tagSnap.exists ? tagSnap.data() : null;
    if (
      !auth ||
      auth.uid !== decoded.uid ||
      (auth.expiresAt && now > auth.expiresAt) ||
      (auth.usesRemaining ?? 0) < 1
    ) {
      return { status: 400, body: { error: "invalid_tag_grant" } };
    }
    isTagPublish = true;
    preprintedTagId = typeof auth.preprintedTagId === "string" && auth.preprintedTagId ? auth.preprintedTagId : null;
  }

  // LOCKED price change (2026-09-04): Gift.Tag publication is CHARGEABLE at
  // 50 Credits. The grant still decides CLASSIFICATION (which product), and
  // the server registry alone decides the price. The preprinted flavor is
  // the ONE exception: its publication is uncharged because its commercial
  // outcome is the 100-Credit activation (billing.mjs registry).
  const billedProduct = isTagPublish ? "gift_tag_publish" : "simple_gift_publish";
  const chargeable = Boolean(billingKey) && simpleShape && !preprintedTagId;

  // --- Phase 3: event publication classification (server state ONLY) -------
  // The trusted boundary is the event TYPE: sealed by validateOccasion at
  // create, stored on events/{id}, cross-type attach refused (event.mjs). A
  // client cannot relabel a Wedding as 轻松相聚 without actually GETTING a
  // casual gathering — the type drives the whole recipient experience.
  //   wedding | birthday   → private_event_invitation   (100 / invitation)
  //   business_event       → business_event_invitation  (100 / invitation)
  //   casual               → casual_gathering_publish   (20 FLAT per
  //     gathering: the deterministic ledger key cas_{eventId} charges the
  //     FIRST publication and every later invitation/share rides it free)
  // Shared-link invitations (OWNER DECISION 2026-09-04, Option A): ONE
  // successfully published shared link = ONE independent invitation product
  // = 100 Credits total — never per scanner, per RSVP, per attendee or per
  // party size, and repeated copying of the same published link costs 0.
  // The lower effective cost of a widely shared link vs managed rows is
  // INTENTIONAL (different products), so shared seals ride the SAME
  // invitation lane below: charge + gift + intent atomic, retry recovers the
  // original, a genuinely NEW shared publication is a new 100.
  // Per-row managed distribution is charged by distribute.mjs itself
  // (eventBilling === "exempt" here).
  const EVENT_PRODUCT_BY_TYPE = {
    wedding: "private_event_invitation",
    birthday: "private_event_invitation",
    business_event: "business_event_invitation",
  };
  const eventProduct =
    eventBilling === "auto" && wantsEvent
      ? occasion?.type === "casual"
        ? "casual_gathering_publish"
        : EVENT_PRODUCT_BY_TYPE[occasion?.type] ?? null
      : null;
  const chargeableEvent = Boolean(billingKey) && eventProduct !== null;

  // Controlled rollout gate: once every deployed surface ships billing UI,
  // BILLING_REQUIRE_KEY=on turns keyless chargeable publishes into an
  // explicit client-upgrade error instead of a silent free path. NO INVISIBLE
  // CHARGING: an ack-less/keyless client is never billed — and logged.
  if (!billingKey && simpleShape) {
    if (process.env.BILLING_REQUIRE_KEY === "on") {
      return { status: 400, body: { error: "billing_client_required" } };
    }
    console.warn(`[billing] legacy keyless simple publish uid=${decoded.uid}`);
  }
  if (!billingKey && eventBilling === "auto" && wantsEvent) {
    if (process.env.BILLING_REQUIRE_KEY === "on") {
      return { status: 400, body: { error: "billing_client_required" } };
    }
    console.warn(`[billing] legacy keyless event publish uid=${decoded.uid} type=${occasion?.type}`);
  }

  const token = generateToken();
  const tokenHash = sha256Hex(token);

  // Cheap authoritative pre-check BEFORE any share-seal or media finalize, so
  // an insufficient balance never consumes staged assets. The binding check
  // still happens inside the charge transaction (this one only saves work).
  if (chargeable || chargeableEvent) {
    const unitPrice = CHARGEABLE_PRODUCTS[chargeable ? billedProduct : eventProduct].unitPrice;
    const bal = await billing.getBalance({ db, uid: decoded.uid, now });
    if (bal.total < unitPrice) {
      return {
        status: 402,
        body: {
          error: "insufficient_credits",
          free: bal.free,
          paid: bal.paid,
          needed: unitPrice,
        },
      };
    }
  }

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
  let retrievalKeySealed = null;
  if (share) {
    // Every NEW gift gets a recoverable credential while the feature is
    // configured (the future 我发出的心意 lists ordinary gifts too);
    // event-based creates REQUIRE it (checked above).
    try {
      shareTokenSealed = await share.seal(token, tokenHash);
      // Billing-aware publications additionally seal a GENERATED Heart Key
      // (context-bound "#rk") so an idempotent retry can return the ORIGINAL
      // six-digit key. The key itself remains crypto-random; a sender-chosen
      // custom key is never stored (the client resends it on retry).
      if (billingKey && (simpleShape || wantsEvent) && accessMode === "heart_key" && !normalizeKey(body?.retrievalKey)) {
        try {
          retrievalKeySealed = await share.seal(retrievalKey, `${tokenHash}#rk`);
        } catch (err) {
          console.warn("[gift] heart-key seal failed (retry recovery degraded):", err?.message);
          retrievalKeySealed = null;
        }
      }
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
    // Rich presentation (photo story / voice / music) rides the ONE proven
    // pipeline. It was originally occasion-only; a self-print Gift.Tag is an
    // ORDINARY gift that ALSO carries rich presentation, so an occasion is no
    // longer required — finalizePresentation applies the identical validation
    // and limits either way, and an occasion-less gift creates no Event. Same-
    // Event reuse (fromGiftId) still needs an event, so a standalone gift may
    // carry only freshly-uploaded assets (resolveReuse stays null when eventId
    // is null); music still comes from the same server-side allowlist.
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

  // FCM Phase 1 correction (§4): the sender's ACTIVE Gift.Seen UI language,
  // captured at seal time, later drives notification copy for this gift.
  // Whitelisted zh|en; absent on legacy gifts (push falls back to the sealed
  // occasion language, else zh — documented, deterministic, never geography).
  const notifyLanguage =
    body?.notifyLanguage === "en" || body?.notifyLanguage === "zh" ? body.notifyLanguage : null;

  const record = {
    schemaVersion: GIFT_SCHEMA_VERSION,
    senderUid: decoded.uid,
    senderName,
    tone,
    ...(notifyLanguage ? { notifyLanguage } : {}),
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
    // recipientLabel: with an Event it is the household identity (required);
    // on an ordinary gift it is the optional salutation (TA 的称呼).
    ...(eventId ? { eventId, recipientLabel } : recipientLabel ? { recipientLabel } : {}),
    // §12 (4.5-C): a direct-share invitation is one LINK, not one household —
    // its RSVP must never masquerade as household attendance statistics.
    ...(eventId && body?.sharedDistribution === true ? { sharedDistribution: true } : {}),
    // SERVER-derived classification (never a client field) — records which
    // lane produced this publication.
    ...(isTagPublish ? { productContext: preprintedTagId ? "gift_tag_preprinted" : "gift_tag" } : {}),
    // Preprinted publications are UNUSABLE until the 100-Credit activation
    // binds them to their physical Tag (retrieve refuses pendingTagBind) —
    // the free publication here can never stand alone.
    ...(preprintedTagId ? { pendingTagBind: true, pendingTagId: preprintedTagId } : {}),
    // Sender-only recoverable credential (KMS-sealed, context-bound to this
    // record). The raw token itself is still NEVER written to Firestore.
    ...(shareTokenSealed ? { shareTokenSealed } : {}),
    // Billing-retry recoverable copy of a GENERATED Heart Key (KMS-sealed,
    // context "#rk"). Plaintext keys are still never persisted.
    ...(retrievalKeySealed ? { retrievalKeySealed } : {}),
  };

  // Doc id = tokenHash. The raw token is never written to Firestore.
  const giftRef = db.collection(GIFT_COLLECTION).doc(tokenHash);
  const intentRef =
    billingKey && (simpleShape || wantsEvent)
      ? db.collection(GIFT_PUBLISH_INTENTS_COLLECTION).doc(`${decoded.uid}_${billingKey}`)
      : null;
  const intentDoc = intentRef
    ? {
        uid: decoded.uid,
        tokenHash,
        kind: isTagPublish
          ? "gift_tag"
          : wantsEvent
            ? occasion?.type === "casual"
              ? "casual"
              : "invitation"
            : "simple",
        createdAt: now,
      }
    : null;
  const compensateMedia = async (reason) => {
    for (const assetId of sealedAssetIds(record)) {
      await deleteSealedMedia({ store: media, tokenHash, assetId, reason });
    }
  };
  let chargedBalances = null;
  let casualPaidElsewhere = false;
  if (chargeable || chargeableEvent) {
    const productToCharge = chargeable ? billedProduct : eventProduct;
    // 轻松相聚 is FLAT: the ledger key is the GATHERING (cas_{eventId}), so
    // exactly one 20-Credit entry can ever exist per casual event — the first
    // successful publication pays it, every later invitation/share observes
    // the duplicate and publishes free. Invitation products keep the client
    // idempotency key: one intended seal → one 100-Credit charge.
    const chargeIdemKey =
      productToCharge === "casual_gathering_publish" ? `cas_${eventId}` : billingKey;
    // Atomic charge + publish: the 20-Credit ledger entry, the balance
    // update, the Gift record AND the idempotency intent commit in ONE
    // Firestore transaction — "charged but unpublished" and "published but
    // uncharged" are both structurally impossible. Price/product authority
    // lives in billing.mjs; nothing from the request body is trusted for
    // money.
    const res = await billing.chargeCredits({
      db,
      uid: decoded.uid,
      product: productToCharge,
      idempotencyKey: chargeIdemKey,
      subjectId: tokenHash,
      domainWrites: [
        { kind: "create", ref: giftRef, data: record },
        { kind: "create", ref: intentRef, data: intentDoc },
      ],
      // Gift.Tag single-use enforcement (LOCKED invariant: one grant → at
      // most ONE publication → at most ONE 50-Credit charge): the grant is
      // re-verified and consumed INSIDE the charge transaction. Two racing
      // requests — same or different idempotency keys, tabs, or Lambdas —
      // serialize here: the loser retries, observes usesRemaining 0, and is
      // refused with zero writes (unless its OWN ledger entry exists, i.e.
      // the same intended publication — then it recovers the original).
      guard: isTagPublish
        ? async (tx) => {
            const authSnap = await tx.get(tagAuthRef);
            const a = authSnap.exists ? authSnap.data() : null;
            if (
              !a ||
              a.uid !== decoded.uid ||
              (a.expiresAt && now > a.expiresAt) ||
              (a.usesRemaining ?? 0) < 1
            ) {
              return { ok: false, error: "invalid_tag_grant" };
            }
            return {
              ok: true,
              writes: [
                {
                  kind: "update",
                  ref: tagAuthRef,
                  data: { usesRemaining: (a.usesRemaining ?? 1) - 1, usedAt: now },
                },
              ],
            };
          }
        : null,
      meta: { tokenHash, ...(eventId ? { eventId } : {}) },
      now,
    });
    if (!res.ok) {
      await compensateMedia("charge_refused");
      await compensateEvent("charge_refused");
      if (res.error === "insufficient_credits") {
        return {
          status: 402,
          body: {
            error: "insufficient_credits",
            free: res.free,
            paid: res.paid,
            needed: res.needed,
          },
        };
      }
      return { status: 400, body: { error: res.error ?? "billing_failed" } };
    }
    if (res.duplicate) {
      if (productToCharge === "casual_gathering_publish") {
        // The GATHERING is already paid (first publication won the flat
        // charge). THIS is a different invitation on the same casual event —
        // publish it with no further charge via the uncharged atomic path.
        casualPaidElsewhere = true;
      } else {
        // A concurrent identical request already committed (charged exactly
        // once). THIS invocation's random credentials belong to no record —
        // recover and return the ORIGINAL publication. An event this very
        // call silently created belongs to no publication either — undo it.
        await compensateMedia("duplicate_publish");
        await compensateEvent("duplicate_publish");
        return await recoverPublishedGift({
          db,
          share,
          uid: decoded.uid,
          tokenHash: res.entry?.meta?.tokenHash,
          providedKey: normalizeKey(body?.retrievalKey) || null,
        });
      }
    } else {
      chargedBalances = res.balances ?? null;
    }
  }
  if (!(chargeable || chargeableEvent) || casualPaidElsewhere) {
    try {
      if (intentRef) {
        // Billing-aware but uncharged shapes (today: the preprinted Gift.Tag
        // pending publication): keep intent + gift atomic so retry recovery
        // always works — and consume the single-use grant INSIDE the same
        // transaction, so two racing publications on one grant serialize to
        // exactly one record (the loser re-observes usesRemaining 0).
        await db.runTransaction(async (tx) => {
          if (preprintedTagId && tagAuthRef) {
            const authSnap = await tx.get(tagAuthRef);
            const a = authSnap.exists ? authSnap.data() : null;
            if (!a || a.uid !== decoded.uid || (a.expiresAt && now > a.expiresAt) || (a.usesRemaining ?? 0) < 1) {
              const e = new Error("invalid_tag_grant");
              e.code = "invalid_tag_grant";
              throw e;
            }
            tx.update(tagAuthRef, { usesRemaining: (a.usesRemaining ?? 1) - 1, usedAt: now });
          }
          tx.create(intentRef, intentDoc);
          tx.create(giftRef, record);
        });
      } else {
        await giftRef.set(record);
      }
    } catch (err) {
      if (err?.code === "invalid_tag_grant") {
        await compensateMedia("grant_consumed");
        return { status: 400, body: { error: "invalid_tag_grant" } };
      }
      // Never strand sealed media objects behind a record that failed to
      // exist — compensate every promoted role, then surface the failure.
      await compensateMedia("create_failed");
      await compensateEvent("record_write_failed");
      throw err;
    }
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
      // Preprinted Gift.Tag: the composer needs the record id to run the
      // 100-Credit activation that binds this pending publication to its card.
      ...(preprintedTagId ? { giftId: tokenHash, pendingTagBind: true } : {}),
      // Billing-aware clients receive the post-charge balance so the UI can
      // confirm without a second round-trip. Display-only, never authority.
      ...(chargedBalances ? { balances: chargedBalances } : {}),
    },
  };
}

/**
 * Rebuild the ORIGINAL outcome of an already-committed billing-aware
 * publication (idempotent retry / race loser). Credentials are recovered
 * from their KMS seals — never from plaintext storage, never re-generated:
 *   token       ← shareTokenSealed  (context: tokenHash)
 *   Heart Key   ← retrievalKeySealed (context: `${tokenHash}#rk`), or the
 *                 sender's own custom key resent in the retry body.
 * If the seal layer is unavailable the retry gets an HONEST
 * 409 already_published (the gift exists, was charged at most once, and is
 * recoverable via 我发出的心意), never a second publication.
 */
async function recoverPublishedGift({ db, share, uid, tokenHash, providedKey = null }) {
  if (typeof tokenHash !== "string" || !tokenHash) {
    return { status: 409, body: { error: "already_published" } };
  }
  const snap = await db.collection(GIFT_COLLECTION).doc(tokenHash).get();
  if (!snap.exists) return { status: 409, body: { error: "already_published" } };
  const rec = snap.data();
  if (rec.senderUid !== uid) return { status: 409, body: { error: "idempotency_conflict" } };
  if (!share || !rec.shareTokenSealed) {
    return { status: 409, body: { error: "already_published" } };
  }
  let token;
  try {
    token = await share.open(rec.shareTokenSealed, tokenHash);
  } catch (err) {
    console.error("[gift] retry token recovery failed:", err?.message);
    return { status: 409, body: { error: "already_published" } };
  }
  let retrievalKey = null;
  if (rec.accessMode === "heart_key") {
    if (rec.retrievalKeySealed) {
      try {
        retrievalKey = await share.open(rec.retrievalKeySealed, `${tokenHash}#rk`);
      } catch (err) {
        console.warn("[gift] retry heart-key recovery failed:", err?.message);
        retrievalKey = providedKey;
      }
    } else {
      retrievalKey = providedKey; // sender-chosen custom key, resent by client
    }
  }
  return {
    status: 200,
    body: {
      token,
      url: `${GIFT_PUBLIC_BASE_URL}/s/${token}`,
      retrievalKey,
      accessMode: rec.accessMode,
      // Event retries keep composing: the original linkage rides back too.
      ...(rec.eventId ? { eventId: rec.eventId, giftId: tokenHash } : {}),
      duplicate: true,
    },
  };
}


/**
 * POST /gift/reply — the QUICK REPLY door (app-key only; recipients need no
 * account). A Quick Reply is a lightweight acknowledgment ATTACHED to the
 * source Gift: no Gift record, no QR, no Credits, no Compose.
 *
 * Authorization: the server-issued replyGrant minted by a successful
 * /gift/retrieve — client-sent ids are never proof. Limits (LOCKED): max 5
 * valid replies per SOURCE GIFT, counted server-side in replyQuota/{giftId};
 * the 6th is refused gracefully with remaining=0. Idempotent: the reply doc
 * id derives from (sourceGiftId, idempotencyKey), so a retried send never
 * duplicates. Message sealing follows the gift model (server-readable V1).
 */
export async function quickReply({ db, body, now = Date.now(), messaging = null }) {
  const grantRaw =
    typeof body?.replyGrant === "string" && body.replyGrant.trim() !== ""
      ? body.replyGrant.trim()
      : null;
  if (!grantRaw) return { status: 401, body: { error: "invalid_reply_auth" } };
  const idem = typeof body?.idempotencyKey === "string" ? body.idempotencyKey : "";
  if (!IDEMPOTENCY_KEY_RE.test(idem)) {
    return { status: 400, body: { error: "invalid_idempotency_key" } };
  }
  const message = typeof body?.message === "string" ? body.message.trim() : "";
  if (!message) return { status: 400, body: { error: "invalid_message" } };
  if (message.length > QUICK_REPLY_MAX_LEN) {
    return { status: 400, body: { error: "message_too_long" } };
  }
  const moderation = await moderateGiftMessage(message);
  if (!moderation.ok) {
    return { status: 422, body: { error: "moderation_blocked", detail: moderation.reason } };
  }
  const signature = sanitizeReplySignature(body?.signature);

  const authRef = db.collection(REPLY_AUTH_COLLECTION).doc(sha256Hex(grantRaw));
  const authSnap = await authRef.get();
  const auth = authSnap.exists ? authSnap.data() : null;
  // NOTE: usesRemaining is NOT checked here — the transaction orders the
  // graceful per-gift limit (409 reply_limit) ahead of grant exhaustion so a
  // sixth attempt reads as "limit reached", never as a confusing auth error.
  if (!auth || (auth.expiresAt && now > auth.expiresAt) || typeof auth.sourceGiftId !== "string") {
    return { status: 401, body: { error: "invalid_reply_auth" } };
  }
  const sourceGiftId = auth.sourceGiftId;
  const srcSnap = await db.collection(GIFT_COLLECTION).doc(sourceGiftId).get();
  if (!srcSnap.exists) return { status: 404, body: { error: "not_found" } };
  const rec = srcSnap.data();
  // A preprinted Gift.Tag publication is INVISIBLE until its 100-Credit
  // activation binds it to the physical Tag (founder §1, 2026-09-05) — the
  // free pending record answers not_found on every public door.
  if (rec.pendingTagBind === true) return { status: 404, body: { error: "not_found" } };
  if (rec.revoked) return { status: 410, body: { error: "revoked" } };
  if (rec.expiresAt && now > rec.expiresAt) return { status: 410, body: { error: "expired" } };
  if (rec.sharedDistribution === true || rec.contextRole === "on_site") {
    // Shared links and on-site records keep their own response flows
    // (per-scanner RSVP, blessings) — Quick Reply is the 1:1 gift channel.
    return { status: 400, body: { error: "reply_unavailable" } };
  }

  const replyRef = db
    .collection(GIFT_REPLIES_COLLECTION)
    .doc(sha256Hex(`qr:${sourceGiftId}:${idem}`));
  const quotaRef = db.collection(REPLY_QUOTA_COLLECTION).doc(sourceGiftId);

  try {
    const result = await db.runTransaction(async (tx) => {
      const dup = await tx.get(replyRef);
      const quota = await tx.get(quotaRef);
      const count = quota.exists ? (quota.data().count ?? 0) : 0;
      if (dup.exists) {
        // Retried send: the original outcome, never a duplicate reply.
        return {
          status: 200,
          body: { ok: true, duplicate: true, remaining: Math.max(0, REPLY_FREE_MAX - count) },
        };
      }
      if (count >= REPLY_FREE_MAX) {
        return {
          status: 409,
          body: { error: "reply_limit", remaining: 0 },
        };
      }
      const authNow = await tx.get(authRef);
      const a = authNow.exists ? authNow.data() : null;
      if (!a || (a.usesRemaining ?? 0) < 1 || (a.expiresAt && now > a.expiresAt)) {
        return { status: 401, body: { error: "invalid_reply_auth" } };
      }
      tx.create(replyRef, {
        schemaVersion: 1,
        sourceGiftId,
        ...giftCrypto.seal(message), // { message } in V1 — same boundary as gifts
        // Recipient-typed display signature (bounded, sanitized, OPTIONAL) —
        // display text only, never verified identity, never authority.
        signature,
        // Server-known label (the salutation the SENDER wrote on the
        // original gift) kept for context. Never an invented identity.
        recipientLabel: rec.recipientLabel ?? null,
        createdAt: now,
        status: "active",
      });
      tx.set(
        quotaRef,
        {
          sourceGiftId,
          count: count + 1,
          updatedAt: now,
          ...(quota.exists ? {} : { createdAt: now }),
        },
        { merge: true },
      );
      tx.update(authRef, { usesRemaining: (a.usesRemaining ?? 1) - 1, usedAt: now });
      return {
        status: 200,
        body: { ok: true, duplicate: false, remaining: Math.max(0, REPLY_FREE_MAX - (count + 1)) },
      };
    });
    // FCM Phase 1 (founder-locked): notify the gift OWNER — only after the
    // reply transaction actually committed, only for a NEW reply (duplicate
    // retries collapse in the push module's own event identity too), and
    // strictly best-effort: sendQuickReplyPush never throws, so the saved
    // reply's response is untouchable. Awaited deliberately — a detached
    // promise would be frozen with the Lambda and the send silently lost.
    if (result.status === 200 && result.body?.ok === true && result.body?.duplicate === false) {
      await sendQuickReplyPush({
        db,
        messaging,
        ownerUid: rec.senderUid ?? null,
        giftId: sourceGiftId,
        replyId: replyRef.id,
        signature,
        // Stored seal-time language first; legacy gifts fall back to the
        // sealed occasion's language, else zh (deterministic, documented).
        language:
          rec.notifyLanguage === "en" || rec.notifyLanguage === "zh"
            ? rec.notifyLanguage
            : rec.occasion?.language === "en"
              ? "en"
              : "zh",
        now,
      });
    }
    return result;
  } catch (err) {
    if (err?.code === 6 || /ALREADY_EXISTS/i.test(String(err?.message ?? ""))) {
      // Race of an identical retried send — the reply exists exactly once.
      const quota = await quotaRef.get();
      const count = quota.exists ? (quota.data().count ?? 0) : 0;
      return {
        status: 200,
        body: { ok: true, duplicate: true, remaining: Math.max(0, REPLY_FREE_MAX - count) },
      };
    }
    throw err;
  }
}

/**
 * Sender-side Quick Reply list — rides the existing authenticated
 * /sender/gift/share door (action:"replies"; API Gateway is per-route). Only
 * the gift's own sender may read. Chronological, at most REPLY_FREE_MAX rows
 * — deliberately a simple list, never a chat surface.
 */
export async function listGiftReplies({ db, decoded, body, now = Date.now() }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };
  const giftId = typeof body?.giftId === "string" ? body.giftId.trim() : "";
  if (!/^[a-f0-9]{64}$/i.test(giftId)) {
    return { status: 400, body: { error: "invalid_request" } };
  }
  const srcSnap = await db.collection(GIFT_COLLECTION).doc(giftId.toLowerCase()).get();
  if (!srcSnap.exists) return { status: 404, body: { error: "not_found" } };
  if (srcSnap.data().senderUid !== decoded.uid) {
    return { status: 403, body: { error: "forbidden" } };
  }
  const snap = await db
    .collection(GIFT_REPLIES_COLLECTION)
    .where("sourceGiftId", "==", giftId.toLowerCase())
    .get();
  const replies = snap.docs
    .filter((d) => d.data().status === "active")
    .sort((a, b) => (a.data().createdAt ?? 0) - (b.data().createdAt ?? 0))
    .map((d) => {
      const r = d.data();
      return {
        // Deterministic reply id (= the push's replyId) so a deep-linked
        // notification can highlight the exact newly arrived reply.
        replyId: d.id,
        message: giftCrypto.open(r),
        signature: r.signature ?? null,
        recipientLabel: r.recipientLabel ?? null,
        createdAt: r.createdAt ?? null,
      };
    });
  const quota = await db.collection(REPLY_QUOTA_COLLECTION).doc(giftId.toLowerCase()).get();
  const count = quota.exists ? (quota.data().count ?? 0) : 0;
  return {
    status: 200,
    body: { replies, remaining: Math.max(0, REPLY_FREE_MAX - count) },
  };
}

/**
 * POST /gift/tag-grant — authenticated. Mints the one-time authorization a
 * Gift.Tag publication presents to publish FREE. Server-authoritative and
 * uid-bound; the caller identity (not any client-declared "type") is what
 * the grant certifies. Throttled per uid at the route (tag_grant_mint).
 */
export async function mintTagPublishGrant({ db, decoded, body = null, now = Date.now() }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };
  // PREPRINTED binding (founder-locked 2026-09-05): when the caller presents
  // an official unactivated gift-type Tag code, the grant is BOUND to that
  // physical Tag — its publication charges 0 here because the ONE commercial
  // outcome (publish + activate + bind) is the 100-Credit activation in
  // tag.mjs. The published record is born pendingTagBind and is UNUSABLE
  // until that activation succeeds, so this can never become a separately
  // usable free Gift publication. Server state decides everything: a bare
  // client claim without a real unactivated official Tag mints the normal
  // self-print grant (50-Credit product), never the preprinted one.
  let preprinted = null;
  const tagCodeRaw = typeof body?.tagCode === "string" ? body.tagCode.trim() : "";
  if (tagCodeRaw) {
    const tagSnap = await db
      .collection(TAG_COLLECTION_FOR_GRANTS)
      .where("publicQrHash", "==", sha256Hex(tagCodeRaw))
      .get();
    const tagDoc = (tagSnap.docs ?? [])[0]?.data() ?? null;
    if (!tagDoc || tagDoc.type !== "gift") {
      return { status: 404, body: { error: "tag_not_found" } };
    }
    if (tagDoc.status !== "unactivated" || tagDoc.ownerUid) {
      return { status: 409, body: { error: "already_activated" } };
    }
    preprinted = { preprintedTagId: tagDoc.tagId };
  }
  const grant = generateToken();
  await db.collection(TAG_PUBLISH_AUTH_COLLECTION).doc(sha256Hex(grant)).set({
    uid: decoded.uid,
    createdAt: now,
    expiresAt: now + TAG_PUBLISH_AUTH_TTL_MS,
    usesRemaining: 1,
    ...(preprinted ?? {}),
  });
  return { status: 200, body: { grant, expiresAt: now + TAG_PUBLISH_AUTH_TTL_MS, ...(preprinted ? { preprinted: true } : {}) } };
}

/**
 * Mint Quick Reply authorization at the ONE trusted boundary that proves
 * recipient-ness: a successful retrieve (raw-token possession, plus the
 * six-digit key for heart_key gifts). The grant token goes only into the
 * retrieve response; Firestore stores its sha256. It is the ONLY key to
 * /gift/reply — client-sent ids never are. Multi-use up to the per-gift
 * reply limit (one reveal session can send several acknowledgments); the
 * authoritative cap stays in replyQuota regardless of grant count.
 * Ineligible records (shared links, on-site) mint nothing. Best-effort: a
 * minting failure never blocks the retrieve itself.
 */
async function mintReplyAuth({ db, rec, tokenHash, now }) {
  if (rec.sharedDistribution === true || rec.contextRole === "on_site") {
    return { grant: null, remaining: null };
  }
  try {
    const quota = await db.collection(REPLY_QUOTA_COLLECTION).doc(tokenHash).get();
    const count = quota.exists ? (quota.data().count ?? 0) : 0;
    const remaining = Math.max(0, REPLY_FREE_MAX - count);
    if (remaining === 0) return { grant: null, remaining: 0 };
    const grant = generateToken();
    await db.collection(REPLY_AUTH_COLLECTION).doc(sha256Hex(grant)).set({
      sourceGiftId: tokenHash,
      createdAt: now,
      expiresAt: now + REPLY_AUTH_TTL_MS,
      usesRemaining: REPLY_FREE_MAX,
    });
    return { grant, remaining };
  } catch (err) {
    console.warn("[gift] reply auth mint failed:", err?.message);
    return { grant: null, remaining: null };
  }
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
  // A preprinted Gift.Tag publication is INVISIBLE until its 100-Credit
  // activation binds it to the physical Tag (founder §1, 2026-09-05) — the
  // free pending record answers not_found on every public door.
  if (rec.pendingTagBind === true) return { status: 404, body: { error: "not_found" } };
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
    const replyAuth = await mintReplyAuth({ db, rec, tokenHash, now });
    return {
      status: 200,
      body: {
        ...(replyAuth.grant ? { replyGrant: replyAuth.grant } : {}),
        ...(replyAuth.remaining !== null ? { quickReplyRemaining: replyAuth.remaining } : {}),
        message: giftCrypto.open(rec),
        senderName: rec.senderName ?? null,
        tone: rec.tone ?? null,
        createdAt: rec.createdAt,
        redeemedAt,
        // A shared link's answers live on per-scanner responses; any RSVP
        // fields still on the record are pre-per-scanner legacy and are
        // meaningless to every scanner — never surfaced.
        rsvpStatus: rec.sharedDistribution === true ? null : (rec.rsvpStatus ?? null),
        rsvpAt: rec.sharedDistribution === true ? null : (rec.rsvpAt ?? null),
        // Household counts (4.5-A) — the recipient's OWN previous answer,
        // echoed so 更改答复 can prefill. Never other households' data.
        rsvpAdultCount: rec.sharedDistribution === true ? null : (rec.rsvpAdultCount ?? null),
        rsvpChildCount: rec.sharedDistribution === true ? null : (rec.rsvpChildCount ?? null),
        // The household's own answer, echoed so they can edit it. Never on a
        // shared link — that audience is not one household.
        rsvpDietary: rec.sharedDistribution === true ? null : (rec.rsvpDietary ?? null),
      rsvpMessage: rec.sharedDistribution === true ? null : (rec.rsvpMessage ?? null),
      sharedResponse: await sharedResponseFor(db, rec, tokenHash, body),
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
  const replyAuth = await mintReplyAuth({ db, rec, tokenHash, now });

  return {
    status: 200,
    body: {
      ...(replyAuth.grant ? { replyGrant: replyAuth.grant } : {}),
      ...(replyAuth.remaining !== null ? { quickReplyRemaining: replyAuth.remaining } : {}),
      message: giftCrypto.open(rec),
      senderName: rec.senderName ?? null,
      tone: rec.tone ?? null,
      createdAt: rec.createdAt,
      redeemedAt,
      // Invitation RSVP state, when one has been recorded (null otherwise) —
      // lets a reopened invitation show the answer already given.
      // A shared link's answers live on per-scanner responses; any RSVP
      // fields still on the record are pre-per-scanner legacy and are
      // meaningless to every scanner — never surfaced.
      rsvpStatus: rec.sharedDistribution === true ? null : (rec.rsvpStatus ?? null),
      rsvpAt: rec.sharedDistribution === true ? null : (rec.rsvpAt ?? null),
      rsvpAdultCount: rec.sharedDistribution === true ? null : (rec.rsvpAdultCount ?? null),
      rsvpChildCount: rec.sharedDistribution === true ? null : (rec.rsvpChildCount ?? null),
      rsvpDietary: rec.sharedDistribution === true ? null : (rec.rsvpDietary ?? null),
      rsvpMessage: rec.sharedDistribution === true ? null : (rec.rsvpMessage ?? null),
      sharedResponse: await sharedResponseFor(db, rec, tokenHash, body),
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
/** The scanner's own shared response, or null for a managed invitation. */
async function sharedResponseFor(db, rec, tokenHash, body) {
  if (rec.sharedDistribution !== true) return null;
  return readSharedResponse({ db, tokenHash, participantToken: body?.participantToken });
}

export async function rsvpGift({ db, body, now = Date.now() }) {
  const token = typeof body?.token === "string" ? body.token.trim() : "";
  const key = normalizeKey(body?.key);
  // Canonical binary contract restored (Founder, 2026-08-27): 'maybe' was
  // briefly a casual-only answer and is no longer accepted from ANYONE —
  // legacy stored maybes stay readable but no new one can be written.
  const status =
    body?.status === "accepted" || body?.status === "declined" ? body.status : null;

  // The recipient's message is a DIRECT reply to this Invitation — never a
  // second Gift. It may arrive on its own, with no status, when the guest
  // has already answered and is only adding or editing their words. Writing
  // no status/count fields in that case is what structurally guarantees the
  // frozen rule: editing a message cannot move attendance or aggregates.
  const messageOnly = !status && body?.recipientMessage !== undefined;
  if (!token || (!status && !messageOnly)) {
    return { status: 400, body: { error: "invalid_request" } };
  }

  // RSVP counts contract (Phase 4.5-A backend layer; UI arrives in 4.5-B).
  // Counts are validated wherever provided; declined always resolves to
  // 0/0; legacy count-less accepts remain valid and never fabricate counts.
  const counts = validateRsvpCounts(status, body);
  if (!counts.ok) {
    return { status: 400, body: { error: counts.error, field: counts.field } };
  }
  // Counts are written on EVERY response, including when none were supplied.
  //
  // Previously an accept without counts wrote no count fields at all, which
  // left whatever the record already had. A guest who declined (stored 0/0)
  // and then accepted therefore ended up "Attendance confirmed · 0 attending"
  // — found in founder physical QA. An answer must never inherit the arithmetic
  // of the answer it replaced, so absent counts explicitly CLEAR to null.
  const countFields = counts.counts
    ? { rsvpAdultCount: counts.counts.adultCount, rsvpChildCount: counts.counts.childCount }
    : { rsvpAdultCount: null, rsvpChildCount: null };

  // Dietary note travels with the SAME response — an update, never a second
  // record. ABSENT MEANS UNCHANGED (founder rule): changing an RSVP must not
  // erase a note the guest never touched, and a decline preserves it too. An
  // explicit empty string is what clears it.
  const dietaryProvided = body?.dietaryRequirements !== undefined;
  const dietary = validateRsvpDietary(status, body);
  if (!dietary.ok) return { status: 400, body: { error: dietary.error, field: dietary.field } };
  const dietaryFields = dietaryProvided ? { rsvpDietary: dietary.dietary } : {};

  // Message: absent = unchanged (survives an RSVP change), "" = cleared, text
  // = replaced. One field, so an edit can never duplicate.
  const msg = validateRsvpMessage(body);
  if (!msg.ok) return { status: 400, body: { error: msg.error, field: msg.field } };
  const messageFields =
    msg.message === undefined
      ? {}
      : msg.message === null
        ? { rsvpMessage: null, rsvpMessageAt: null }
        : { rsvpMessage: msg.message, rsvpMessageAt: now };

  // The RSVP half is written ONLY when a status was supplied. On a
  // message-only edit these keys are absent, so attendance, status and every
  // Event aggregate are untouched by construction rather than by care.
  const answerFields = status
    ? { rsvpStatus: status, rsvpAt: now, ...countFields }
    : {};
  const responseFields = { ...answerFields, ...dietaryFields, ...messageFields };

  const rsvpEcho = {
    ok: true,
    ...(status ? { rsvpStatus: status, rsvpAt: now } : {}),
    ...(status && counts.counts ? countFields : {}),
    ...(dietary.dietary ? { dietaryRequirements: dietary.dietary } : {}),
    ...(msg.message ? { recipientMessage: msg.message } : {}),
  };

  const tokenHash = sha256Hex(token);
  const ref = db.collection(GIFT_COLLECTION).doc(tokenHash);
  const snap = await ref.get();
  if (!snap.exists) return { status: 404, body: { error: "not_found" } };

  const rec = snap.data();
  // A preprinted Gift.Tag publication is INVISIBLE until its 100-Credit
  // activation binds it to the physical Tag (founder §1, 2026-09-05) — the
  // free pending record answers not_found on every public door.
  if (rec.pendingTagBind === true) return { status: 404, body: { error: "not_found" } };
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

  // ACCESS CONTROL COMES FIRST (closure-audit finding, 2026-08-19). The
  // per-scanner delegation for shared links used to sit ABOVE this block, so
  // a heart_key direct-share invitation accepted RSVP writes from anyone
  // holding the token alone — the key gated reading, but not answering.
  // Every write through this door now proves the same credential retrieve
  // demands: direct → token possession; heart_key → the key, with the same
  // shared failed-attempt counters and cooldowns as retrieve.
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
  }

  // Credential proven. A direct-share link is ONE record forwarded to many
  // people, so its answer cannot live here: the first scanner would answer
  // for everyone. Delegate to the per-scanner response — same door, different
  // owner. The record itself only sheds any stale failure state; the answer
  // never touches it.
  if (rec.sharedDistribution === true) {
    if (rsvpMode === "heart_key" && (rec.failedAttempts || rec.lockedUntil || rec.cooldownTier)) {
      await ref.update({ failedAttempts: 0, lockedUntil: null, cooldownTier: 0 });
    }
    return submitSharedRsvpForRecord({ db, body, rec, tokenHash, now });
  }

  if (rsvpMode === "heart_key") {
    // Valid key — clear any stale failure state so a legitimate guest who
    // mistyped earlier is never cooled down after proving the key.
    await ref.update({
      failedAttempts: 0,
      lockedUntil: null,
      cooldownTier: 0,
      ...responseFields,
    });
    return { status: 200, body: rsvpEcho };
  }

  await ref.update(responseFields);
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

/**
 * POST /sender/gift/hidden — sender-only Library VISIBILITY, nothing else.
 *
 * `hidden` is operational sender-owned metadata on the gift record — the same
 * doc that already carries `revoked`, but a DIFFERENT and INDEPENDENT field.
 * It is deliberately NOT access state:
 *   · the recipient link/QR stays fully valid (retrieve never reads `hidden`);
 *   · the sealed content, token, presentation and `expiresAt` are untouched;
 *   · it never sets or clears `revoked` — the four states (active/revoked ×
 *     visible/hidden) are all valid and orthogonal.
 * Owner-authorized like revoke (senderUid must match). Idempotent. Absent
 * `hidden` on any pre-existing gift means visible.
 */
export async function setGiftHidden({ db, decoded, body }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };
  const tokenHash =
    typeof body?.giftId === "string" && body.giftId.trim()
      ? body.giftId.trim()
      : typeof body?.tokenHash === "string"
        ? body.tokenHash.trim()
        : "";
  if (!tokenHash) return { status: 400, body: { error: "invalid_request" } };
  if (typeof body?.hidden !== "boolean")
    return { status: 400, body: { error: "invalid_request", field: "hidden" } };

  const ref = db.collection(GIFT_COLLECTION).doc(tokenHash);
  const snap = await ref.get();
  if (!snap.exists) return { status: 404, body: { error: "not_found" } };
  const rec = snap.data();
  if (rec.senderUid !== decoded.uid) return { status: 403, body: { error: "forbidden" } };

  await ref.update({ hidden: body.hidden });
  return { status: 200, body: { ok: true, hidden: body.hidden } };
}
