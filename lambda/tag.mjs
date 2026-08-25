/**
 * Seen.Tag — ONE authoritative Tag engine (Car / Pet / Luggage share it).
 *
 * A Tag is a physical object → public QR → anonymous scanner → controlled
 * contact → authenticated owner. Its central promise: the scanner reaches the
 * owner WITHOUT the owner exposing their phone number, email, address, or
 * account identity. The scanner needs no account; the owner does.
 *
 * Seen.Tag is its OWN domain object — it is not a Gift and not an Event. It
 * reuses the proven primitives (sha256 token hashing, KMS token sealing, the
 * anonymous-submission abuse-control shape) but keeps its own collections and
 * doors. A single engine + a type/reason registry means new Tag types are added
 * to the registry, never as a second engine.
 *
 * Two doors:
 *   POST /tag/manage  — owner-authenticated (Firebase uid); create/list/detail/
 *                       update/pause/reactivate/contacts, plus the
 *                       pre-manufactured lifecycle (provision → activate) and
 *                       missing-mode / inbox-read actions. Verifies ownerUid on
 *                       every touched record (activate binds it atomically).
 *   POST /tag/scan    — PUBLIC (app-key only, no login); op:resolve reads the
 *                       public contact surface, op:contact submits one message.
 *                       It can NEVER mutate a Tag's configuration or read owner
 *                       data — a scanner possessing the URL gets contact, nothing
 *                       more.
 *
 * Two birth paths, one record shape:
 *   self-print       — the owner creates the Tag in-app (status active from
 *                      birth) and prints the QR themselves.
 *   pre-manufactured — a printed QR exists FIRST (status "unactivated", no
 *                      owner). Scanning it invites activation; an authenticated
 *                      user claims it ATOMICALLY (transaction — two racers can
 *                      never both win) and then fills the profile.
 */
import crypto from "node:crypto";

export const TAG_COLLECTION = "tags";
export const TAG_CONTACT_COLLECTION = "tagContacts";
export const TAG_CONTACT_PHOTO_COLLECTION = "tagContactPhotos";
export const TAG_EVENT_COLLECTION = "tagEvents";
/** Atomic code-uniqueness reservations: doc id = publicQrHash, created with
 *  create() so two concurrent provisions can never both claim one code. */
export const TAG_CODE_COLLECTION = "tagCodes";
/** Minimal manufacturing-traceability entity (one per provision call). */
export const TAG_BATCH_COLLECTION = "tagBatches";

const sha256Hex = (s) => crypto.createHash("sha256").update(String(s)).digest("hex");
const mintToken = () => crypto.randomBytes(18).toString("base64url"); // ~24 chars, unguessable
const mintTagId = () => `tg_${crypto.randomBytes(12).toString("base64url")}`;
const mintBatchId = () => `tb_${crypto.randomBytes(9).toString("base64url")}`;
// Printed claim codes: unambiguous uppercase alphabet (no 0/O/1/I/L), 10 chars
// ≈ 48 bits — non-sequential and impractical to guess online.
const PRINT_ALPHABET = "ABCDEFGHJKMNPQRSTUVWXYZ23456789";
const mintPrintCode = () => Array.from(crypto.randomBytes(10), (b) => PRINT_ALPHABET[b % PRINT_ALPHABET.length]).join("");

// --- Type + reason registry — the ONE place a new Tag type is declared -------
// `active:false` types are reserved: their schema/reasons exist so the engine
// never has to change, but they cannot be created until turned on.
export const TAG_TYPES = {
  car:     { active: true, reasons: ["blocking", "lights_on", "window_open", "anomaly", "access", "other"] },
  pet:     { active: true, reasons: ["found", "safe_with_me", "seen_nearby", "injured", "danger", "other"] },
  luggage: { active: true, reasons: ["found", "safe_with_me", "seen_here", "handed_to_staff", "other"] },
};
/** Types that support the owner-declared MISSING state (spec: car does not). */
export const MISSING_CAPABLE_TYPES = ["pet", "luggage"];
/** Further future concepts — data only, never rendered, never creatable yet. */
export const RESERVED_TAG_TYPES = ["key", "bag", "bike", "item"];
export const PET_TYPES = ["dog", "cat", "other"];

const DISPLAY_LABEL_MAX = 60;
const OWNER_MESSAGE_MAX = 300;
const DETAILS_MAX = 200;
const PHONE_MAX = 32;
const PET_NAME_MAX = 40;
const LUGGAGE_NAME_MAX = 60;
const LUGGAGE_DESC_MAX = 200;
const COLOUR_MAX = 40;
const REG_HINT_MAX = 16;
const SCAN_EVENT_THROTTLE_MS = 60 * 60 * 1000; // TAG_SCANNED at most 1/hour/tag
const SAFETY_NOTE_MAX = 200;
const LOCATION_MAX = 200;   // scanner "where I saw/found it"
const HANDED_TO_MAX = 120;  // luggage Lost & Found / staff desk
const CONTACTS_PER_SCANNER_MAX = 5;      // per Tag, per held scanner identity
const CONTACT_COOLDOWN_MS = 30 * 1000;   // rapid-repeat guard (per scanner / per IP)
const CONTACTS_LIST_MAX = 50;            // owner sees the most recent N
const PROVISION_BATCH_MAX = 50;          // codes minted per provision call
const PHOTO_DATAURL_MAX = 200_000;       // ~150KB binary — collar-tag scale, not albums
const TAG_STATUSES = ["unactivated", "active", "missing", "paused"];

// Master Admin authority = Firebase custom claim `master_admin: true`,
// attached to a UID (never a string comparison at request time).
//
// TEMPORARY BOOTSTRAP — REMOVE AFTER CLAIMS ARE LIVE: because no role system
// existed before this phase, the founder's verified email may still (a) act as
// master admin and (b) grant the first claims. Once the intended admin account
// carries the claim, delete this list and the fallback below.
export const PROVISION_ADMIN_EMAILS = ["beingseenmatters@gmail.com"];

/** Claim check (server-side, on the verified token) with the temporary
 *  bootstrap fallback. UI checks are cosmetic; THIS is the gate. */
function isMasterAdmin(decoded) {
  if (decoded?.master_admin === true) return true;
  const email = typeof decoded?.email === "string" ? decoded.email.toLowerCase() : "";
  return decoded?.email_verified === true && PROVISION_ADMIN_EMAILS.includes(email); // TEMPORARY BOOTSTRAP
}

/**
 * grant_master_admin — one-time/tightly-restricted: grants `master_admin: true`
 * to the Firebase UID resolved from the target email (or the caller when no
 * email is given). Callable only by an existing master admin or the bootstrap
 * list. The claim lands on the UID; alias addresses that have never signed in
 * do not resolve (getUserByEmail fails) — the returned uid+email report which
 * real account received it.
 */
async function grantMasterAdmin({ auth, decoded, body }) {
  if (!isMasterAdmin(decoded)) return { status: 403, body: { error: "forbidden" } };
  if (!auth) return { status: 503, body: { error: "auth_unavailable" } };
  const targetEmail = clean(body?.email, 120).toLowerCase() || (decoded.email ?? "").toLowerCase();
  if (!targetEmail) return { status: 400, body: { error: "invalid_request", field: "email" } };
  let user;
  try {
    user = await auth.getUserByEmail(targetEmail);
  } catch (err) {
    return { status: 404, body: { error: "user_not_found", email: targetEmail } };
  }
  try {
    await auth.setCustomUserClaims(user.uid, { ...(user.customClaims ?? {}), master_admin: true });
  } catch (err) {
    console.error("[tag] grant claim failed:", err?.message);
    return { status: 503, body: { error: "claim_set_failed" } };
  }
  return { status: 200, body: { ok: true, uid: user.uid, email: user.email ?? targetEmail } };
}

// Default owner-facing PUBLIC message per type/locale (owner may edit it).
export const DEFAULT_OWNER_MESSAGE = {
  car: {
    zh: "给您造成麻烦，敬请谅解。收到消息后，我会尽快挪车。",
    en: "Sorry for the inconvenience. Once I receive your message, I’ll move the vehicle as soon as I can.",
  },
  pet: {
    zh: "谢谢你发现了它。请通过这里告诉我它现在在哪里，我会尽快联系你。",
    en: "Thank you for finding my pet. Please let me know where it is and I’ll get back to you as soon as I can.",
  },
  luggage: {
    zh: "谢谢你发现我的行李。请告诉我它现在在哪里，我会尽快联系你。",
    en: "Thank you for finding my luggage. Please let me know where it is and I’ll get back to you as soon as I can.",
  },
};

// Finder permissions — owner-controlled switches over the anonymous surface.
// Defaults are open (the Tag exists to be contacted); each is server-enforced.
const DEFAULT_PERMISSIONS = { allowMessages: true, allowLocation: true, allowPhoto: true };
function buildPermissions(raw, existing = DEFAULT_PERMISSIONS) {
  const out = { ...DEFAULT_PERMISSIONS, ...existing };
  if (raw && typeof raw === "object") {
    for (const k of Object.keys(DEFAULT_PERMISSIONS)) {
      if (typeof raw[k] === "boolean") out[k] = raw[k];
    }
  }
  return out;
}

/**
 * Uploaded photos (owner's pet portrait, finder's sighting photo) are inlined
 * data-URLs, client-downscaled, and validated here: declared MIME must be an
 * image, size bounded, and the decoded bytes must MATCH the declared format's
 * magic numbers (a renamed .html cannot pass).
 */
function validPhotoDataUrl(v) {
  if (typeof v !== "string" || v.length > PHOTO_DATAURL_MAX) return null;
  const m = /^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+=*)$/.exec(v);
  if (!m) return null;
  let head;
  try { head = Buffer.from(m[2].slice(0, 24), "base64"); } catch { return null; }
  const ok =
    (m[1] === "jpeg" && head[0] === 0xff && head[1] === 0xd8) ||
    (m[1] === "png" && head[0] === 0x89 && head[1] === 0x50 && head[2] === 0x4e && head[3] === 0x47) ||
    (m[1] === "webp" && head[0] === 0x52 && head[1] === 0x49 && head[2] === 0x46 && head[3] === 0x46);
  return ok ? v : null;
}

/**
 * Validated type-specific PUBLIC profile facts (schema discipline: ONE Tag, a
 * common shape + a small validated `profile`). Pet and Luggage carry public
 * structured facts the finder should see (name/photo, pet safety note, luggage
 * colour+description). Car carries NONE publicly — its private vehicle facts
 * live in ownerProfile below, and its public voice is only the ownerMessage.
 */
function buildProfile(type, raw) {
  if (type === "pet") {
    return {
      name: clean(raw?.name, PET_NAME_MAX) || null,
      petType: PET_TYPES.includes(raw?.petType) ? raw.petType : "other",
      safetyNote: cleanText(raw?.safetyNote, SAFETY_NOTE_MAX) || null,
      photo: validPhotoDataUrl(raw?.photo) || null,
    };
  }
  if (type === "luggage") {
    return {
      name: clean(raw?.name, LUGGAGE_NAME_MAX) || null,
      colour: clean(raw?.colour, COLOUR_MAX) || null,
      description: cleanText(raw?.description, LUGGAGE_DESC_MAX) || null,
      photo: validPhotoDataUrl(raw?.photo) || null,
    };
  }
  return {}; // car — no public structured profile (a car never introduces itself)
}

/**
 * PRIVATE owner-side profile (car only): which vehicle this tag lives on.
 * Never enters the public resolve payload — a scanner learns NOTHING about
 * the car beyond the owner's chosen message. Registration is a short HINT,
 * and even that stays owner-only in V1.
 */
function buildOwnerProfile(type, raw) {
  if (type !== "car") return {};
  return {
    name: clean(raw?.name, DISPLAY_LABEL_MAX) || null,
    make: clean(raw?.make, COLOUR_MAX) || null,
    model: clean(raw?.model, COLOUR_MAX) || null,
    colour: clean(raw?.colour, COLOUR_MAX) || null,
    registrationHint: clean(raw?.registrationHint, REG_HINT_MAX) || null,
  };
}

const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");
const localeOf = (v) => (v === "en" ? "en" : "zh");
/** Strip control chars, collapse whitespace, bound length. */
function cleanText(v, max) {
  if (typeof v !== "string") return "";
  let out = "";
  for (const ch of v) { const c = ch.codePointAt(0); out += (c < 0x20 || c === 0x7f) ? " " : ch; }
  return out.replace(/\s+/g, " ").trim().slice(0, max);
}
const PHONE_OK = /^[0-9+()\-\s]{4,32}$/;              // digits + separators only
const IDEM_OK = /^[A-Za-z0-9_-]{8,64}$/;
const SCANNER_TOKEN_OK = /^[A-Za-z0-9_-]{16,64}$/;
const CUSTOM_CODE_OK = /^[A-Z0-9]{6,24}$/;            // provision custom codes (e.g. TESTPET001)

/** Latitude/longitude pair — both present, numeric, in range; else null. */
function validLatLng(lat, lng) {
  const la = typeof lat === "number" ? lat : NaN;
  const ln = typeof lng === "number" ? lng : NaN;
  if (!Number.isFinite(la) || !Number.isFinite(ln)) return null;
  if (la < -90 || la > 90 || ln < -180 || ln > 180) return null;
  return { lat: Math.round(la * 1e6) / 1e6, lng: Math.round(ln * 1e6) / 1e6 };
}

// ---------------------------------------------------------------------------
// Tag events — the notification spine. Every meaningful transition writes one
// event with per-channel delivery state. Today WEB_INBOX is the only channel
// (the web inbox reads contacts directly, so an event is born delivered);
// APNs / FCM / email later mean adding a channel entry + a dispatcher — the
// Tag business logic never talks to a provider.
// ---------------------------------------------------------------------------
async function emitTagEvent(db, { eventType, tagId, recipientUid, data = {}, now }) {
  try {
    const eventId = `evt_${crypto.randomBytes(9).toString("base64url")}`;
    await db.collection(TAG_EVENT_COLLECTION).doc(eventId).set({
      schemaVersion: 1,
      eventId,
      eventType,               // TAG_ACTIVATED | TAG_MESSAGE_SENT | TAG_LOCATION_SHARED | TAG_MARKED_MISSING | TAG_MARKED_FOUND
      tagId,
      recipientUid: recipientUid ?? null,
      data,                    // small, channel-agnostic payload (petName, contactId, …)
      createdAt: now,
      delivery: { webInbox: { status: "delivered", at: now } },
    });
  } catch (err) {
    // Events must NEVER break the user-facing operation.
    console.warn("[tag] event emit failed:", eventType, err?.message);
  }
}

// ---------------------------------------------------------------------------
// Owner plane (authenticated) — every op verifies ownerUid === decoded.uid.
// ---------------------------------------------------------------------------
async function ownedTag({ db, decoded, tagId }) {
  if (!decoded?.uid) return { res: { status: 401, body: { error: "unauthorized" } } };
  const id = clean(tagId, 64);
  if (!id) return { res: { status: 400, body: { error: "invalid_request", field: "tagId" } } };
  const snap = await db.collection(TAG_COLLECTION).doc(id).get();
  if (!snap.exists) return { res: { status: 404, body: { error: "tag_not_found" } } };
  const tag = snap.data();
  if (tag.ownerUid !== decoded.uid) return { res: { status: 403, body: { error: "forbidden" } } };
  return { tag, id };
}

const ownerTagView = (t) => ({
  tagId: t.tagId, type: t.type, status: t.status,
  displayLabel: t.displayLabel ?? null, ownerMessage: t.ownerMessage,
  profile: t.profile ?? {}, ownerProfile: t.ownerProfile ?? {},
  permissions: buildPermissions(null, t.permissions),
  createdAt: t.createdAt, activatedAt: t.activatedAt ?? null, missingSince: t.missingSince ?? null,
});

async function createTag({ db, decoded, body, share, publicBaseUrl, now }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };
  const type = clean(body?.type, 16);
  if (!TAG_TYPES[type]) return { status: 400, body: { error: "invalid_type" } };
  if (!TAG_TYPES[type].active) return { status: 403, body: { error: "type_not_available", type } };
  if (!share) return { status: 503, body: { error: "share_unavailable" } };

  const locale = localeOf(body?.locale);
  const displayLabel = clean(body?.displayLabel, DISPLAY_LABEL_MAX) || null;
  const ownerMessage = cleanText(body?.ownerMessage, OWNER_MESSAGE_MAX) || DEFAULT_OWNER_MESSAGE[type]?.[locale] || "";
  const profile = buildProfile(type, body?.profile);
  const ownerProfile = buildOwnerProfile(type, body?.ownerProfile);
  const permissions = buildPermissions(body?.permissions);

  const token = mintToken();
  const publicQrHash = sha256Hex(token);
  let shareTokenSealed;
  try {
    shareTokenSealed = await share.seal(token, publicQrHash);
  } catch (err) {
    console.error("[tag] share seal failed:", err?.message);
    return { status: 503, body: { error: "share_seal_failed" } };
  }

  const tagId = mintTagId();
  const tag = {
    schemaVersion: 1,
    tagId,
    ownerUid: decoded.uid,
    type,
    status: "active",
    publicQrHash,          // sha256(token) — the public resolution key
    shareTokenSealed,      // KMS-sealed token so the owner can reprint the QR
    displayLabel,          // PRIVATE — owner management only, never public
    ownerMessage,          // PUBLIC — shown to the scanner first
    profile,               // PUBLIC type-specific facts (pet/luggage)
    ownerProfile,          // PRIVATE type-specific facts (car) — never public
    permissions,           // finder-permission switches (server-enforced)
    meta: {},              // reserved
    createdAt: now,
    activatedAt: now,      // self-print Tags are born active
    updatedAt: now,
  };
  await db.collection(TAG_COLLECTION).doc(tagId).set(tag);
  return {
    status: 200,
    body: { tagId, type, status: "active", displayLabel, ownerMessage, profile, permissions, token, url: `${publicBaseUrl}/t/${token}` },
  };
}

/**
 * Pre-manufactured provisioning (admin only) — mints UNACTIVATED Tags whose
 * printed code IS the public token (`/t/TESTPET001`). No owner yet; activation
 * binds one atomically. Custom codes let us seed known test tags.
 */
async function provisionTags({ db, decoded, body, share, publicBaseUrl, now }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };
  if (!isMasterAdmin(decoded)) return { status: 403, body: { error: "forbidden" } };
  const type = clean(body?.type, 16);
  if (!TAG_TYPES[type]) return { status: 400, body: { error: "invalid_type" } };
  if (!TAG_TYPES[type].active) return { status: 403, body: { error: "type_not_available", type } };
  if (!share) return { status: 503, body: { error: "share_unavailable" } };

  const customCode = body?.code !== undefined && body?.code !== null && String(body.code).trim() !== ""
    ? String(body.code).trim().toUpperCase() : null;
  if (customCode && !CUSTOM_CODE_OK.test(customCode)) return { status: 400, body: { error: "invalid_code" } };
  const count = customCode ? 1 : Math.min(Math.max(Number(body?.count) || 1, 1), PROVISION_BATCH_MAX);
  const batchId = mintBatchId();
  const notes = cleanText(body?.notes, 200) || null;

  const minted = [];
  for (let i = 0; i < count; i += 1) {
    const code = customCode ?? mintPrintCode();
    const publicQrHash = sha256Hex(code);
    // Legacy guard: tags minted before the reservation ledger existed (and
    // self-print tags) hold no reservation doc — a query still finds them.
    const dupSnap = await db.collection(TAG_COLLECTION).where("publicQrHash", "==", publicQrHash).get();
    const dup = (dupSnap.docs ?? [])[0];
    if (dup) {
      const d = dup.data();
      if (customCode && d.status === "unactivated") {
        minted.push({ code, tagId: d.tagId, url: `${publicBaseUrl}/t/${code}`, existing: true });
        continue;
      }
      if (customCode) return { status: 409, body: { error: "code_taken" } };
      i -= 1; continue; // random collision (astronomically rare) — re-mint
    }
    // ATOMIC uniqueness: reserve the code with create() on a deterministic doc
    // id (the public QR hash). Two concurrent provisions of one code can never
    // both succeed — the loser's create() throws ALREADY_EXISTS and fails clean.
    const tagId = mintTagId();
    const reservationRef = db.collection(TAG_CODE_COLLECTION).doc(publicQrHash);
    try {
      await reservationRef.create({ tagId, batchId, createdAt: now });
    } catch (err) {
      if (customCode) return { status: 409, body: { error: "code_taken" } };
      i -= 1; continue; // random code lost a race — re-mint another
    }
    let shareTokenSealed;
    try {
      shareTokenSealed = await share.seal(code, publicQrHash);
    } catch (err) {
      console.error("[tag] provision seal failed:", err?.message);
      try { await reservationRef.delete(); } catch { /* orphan guard */ }
      return { status: 503, body: { error: "share_seal_failed" } };
    }
    await db.collection(TAG_COLLECTION).doc(tagId).set({
      schemaVersion: 1,
      tagId,
      ownerUid: null,          // unclaimed — activation binds the owner
      type,
      status: "unactivated",
      publicQrHash,
      shareTokenSealed,
      displayLabel: null,
      ownerMessage: "",        // filled with the locale default at activation
      profile: {},
      ownerProfile: {},
      permissions: buildPermissions(null),
      provision: { by: decoded.uid, at: now, batchId },
      meta: {},
      createdAt: now,
      updatedAt: now,
    });
    minted.push({ code, tagId, url: `${publicBaseUrl}/t/${code}`, existing: false });
  }
  // Minimal batch record — factory traceability foundation. Only written when
  // this call actually created inventory.
  const created = minted.filter((m) => !m.existing).length;
  if (created > 0) {
    await db.collection(TAG_BATCH_COLLECTION).doc(batchId).set({
      schemaVersion: 1, batchId, type, quantity: created,
      createdBy: decoded.uid, createdAt: now,
      status: "generated", exportedAt: null, notes,
    });
  }
  return { status: 200, body: { type, batchId: created > 0 ? batchId : null, status: "unactivated", tags: minted } };
}

/**
 * Activation — an authenticated user claims an UNACTIVATED pre-manufactured
 * Tag by its public token. ATOMIC: the status check and the owner bind happen
 * in one transaction, so two simultaneous claims can never both succeed.
 * Idempotent for the winner (re-activating your own tag echoes success).
 */
async function activateTag({ db, decoded, body, now }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };
  const token = clean(body?.token, 128);
  if (!token) return { status: 400, body: { error: "invalid_request", field: "token" } };
  const locale = localeOf(body?.locale);

  const snap = await db.collection(TAG_COLLECTION).where("publicQrHash", "==", sha256Hex(token)).get();
  const doc = (snap.docs ?? [])[0];
  if (!doc) return { status: 404, body: { error: "not_found" } };
  const id = doc.data().tagId;
  const ref = db.collection(TAG_COLLECTION).doc(id);

  let outcome;
  try {
    await db.runTransaction(async (tx) => {
      const cur = await tx.get(ref);
      if (!cur.exists) { outcome = { status: 404, body: { error: "not_found" } }; return; }
      const t = cur.data();
      if (t.status !== "unactivated" || t.ownerUid) {
        outcome = t.ownerUid === decoded.uid
          ? { status: 200, body: { tagId: t.tagId, type: t.type, status: t.status, already: true } }
          : { status: 409, body: { error: "already_activated" } };
        return;
      }
      tx.update(ref, {
        ownerUid: decoded.uid,
        status: "active",
        ownerMessage: t.ownerMessage || DEFAULT_OWNER_MESSAGE[t.type]?.[locale] || "",
        activatedAt: now,
        updatedAt: now,
      });
      outcome = { status: 200, body: { tagId: t.tagId, type: t.type, status: "active", already: false } };
    });
  } catch (err) {
    console.error("[tag] activate tx failed:", err?.message);
    return { status: 409, body: { error: "conflict" } };
  }
  if (outcome?.status === 200 && outcome.body.already === false) {
    await emitTagEvent(db, { eventType: "TAG_ACTIVATED", tagId: id, recipientUid: decoded.uid, data: { type: outcome.body.type }, now });
  }
  return outcome;
}

async function listTags({ db, decoded, now }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };
  const snap = await db.collection(TAG_COLLECTION).where("ownerUid", "==", decoded.uid).get();
  const tags = (snap.docs ?? [])
    .map((d) => d.data())
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .map((t) => ({ tagId: t.tagId, type: t.type, status: t.status, displayLabel: t.displayLabel ?? null, ownerMessage: t.ownerMessage, profile: t.profile ?? {}, createdAt: t.createdAt }));
  return { status: 200, body: { tags } };
}

async function detailTag({ db, decoded, body, share, publicBaseUrl }) {
  const owned = await ownedTag({ db, decoded, tagId: body?.tagId });
  if (owned.res) return owned.res;
  const { tag } = owned;
  // Recover the printable QR URL on demand (KMS decrypt) — the token is never
  // stored in the clear, so a durable QR survives without a plaintext secret.
  let url = null;
  try {
    if (share && tag.shareTokenSealed) {
      const token = await share.open(tag.shareTokenSealed, tag.publicQrHash);
      url = `${publicBaseUrl}/t/${token}`;
    }
  } catch (err) {
    console.warn("[tag] token recover failed:", err?.message);
  }
  return { status: 200, body: { ...ownerTagView(tag), updatedAt: tag.updatedAt, url } };
}

async function updateTag({ db, decoded, body, now }) {
  const owned = await ownedTag({ db, decoded, tagId: body?.tagId });
  if (owned.res) return owned.res;
  const patch = { updatedAt: now };
  if (body?.displayLabel !== undefined) patch.displayLabel = clean(body.displayLabel, DISPLAY_LABEL_MAX) || null;
  if (body?.ownerMessage !== undefined) {
    const msg = cleanText(body.ownerMessage, OWNER_MESSAGE_MAX);
    if (!msg) return { status: 400, body: { error: "invalid_message" } };
    patch.ownerMessage = msg;
  }
  // Type-specific PUBLIC profile edits (pet, luggage). Merged over the existing
  // profile then re-validated. Car has no public profile to edit.
  if (body?.profile !== undefined && (owned.tag.type === "pet" || owned.tag.type === "luggage")) {
    if (body.profile?.photo !== undefined && body.profile.photo !== null && !validPhotoDataUrl(body.profile.photo)) {
      return { status: 400, body: { error: "invalid_photo" } };
    }
    patch.profile = buildProfile(owned.tag.type, { ...(owned.tag.profile ?? {}), ...body.profile });
  }
  // PRIVATE owner profile edits (car vehicle facts) — merged, never public.
  if (body?.ownerProfile !== undefined && owned.tag.type === "car") {
    patch.ownerProfile = buildOwnerProfile("car", { ...(owned.tag.ownerProfile ?? {}), ...body.ownerProfile });
    // Mirror the vehicle name into the private displayLabel so owner-side
    // listings name the tag without a payload change.
    if (patch.ownerProfile.name && body?.displayLabel === undefined) patch.displayLabel = patch.ownerProfile.name;
  }
  // Same mirror for the luggage name (its profile is public; the label is not).
  if (patch.profile?.name && owned.tag.type === "luggage" && body?.displayLabel === undefined) {
    patch.displayLabel = patch.profile.name;
  }
  // Finder-permission switches (any type) — merged over existing, booleans only.
  if (body?.permissions !== undefined) {
    patch.permissions = buildPermissions(body.permissions, owned.tag.permissions);
  }
  await db.collection(TAG_COLLECTION).doc(owned.id).update(patch);
  const t = { ...owned.tag, ...patch };
  return { status: 200, body: { tagId: t.tagId, displayLabel: t.displayLabel ?? null, ownerMessage: t.ownerMessage, profile: t.profile ?? {}, ownerProfile: t.ownerProfile ?? {}, permissions: buildPermissions(null, t.permissions) } };
}

/** pause/reactivate (existing) + missing-mode transitions, all owner-gated. */
async function setTagStatus({ db, decoded, body, status, now }) {
  const owned = await ownedTag({ db, decoded, tagId: body?.tagId });
  if (owned.res) return owned.res;
  const cur = owned.tag.status;
  if (cur === status) return { status: 200, body: { tagId: owned.id, status } }; // idempotent echo
  // Guard rails: missing only from active; found only from missing. Pause is
  // allowed from active or missing (a paused tag always reactivates to active).
  if (status === "missing" && !MISSING_CAPABLE_TYPES.includes(owned.tag.type)) {
    return { status: 409, body: { error: "missing_not_supported", type: owned.tag.type } };
  }
  if (status === "missing" && cur !== "active") return { status: 409, body: { error: "invalid_transition", from: cur } };
  if (status === "active" && body?.__fromFound && cur !== "missing") return { status: 409, body: { error: "invalid_transition", from: cur } };
  const patch = { status, updatedAt: now };
  if (status === "missing") patch.missingSince = now;
  if (status === "active" || status === "paused") patch.missingSince = null;
  await db.collection(TAG_COLLECTION).doc(owned.id).update(patch);
  if (status === "missing") {
    await emitTagEvent(db, { eventType: "TAG_MARKED_MISSING", tagId: owned.id, recipientUid: decoded.uid, data: { petName: owned.tag.profile?.name ?? null }, now });
  } else if (body?.__fromFound) {
    await emitTagEvent(db, { eventType: "TAG_MARKED_FOUND", tagId: owned.id, recipientUid: decoded.uid, data: { petName: owned.tag.profile?.name ?? null }, now });
  }
  return { status: 200, body: { tagId: owned.id, status } };
}

async function listContacts({ db, decoded, body, now }) {
  const owned = await ownedTag({ db, decoded, tagId: body?.tagId });
  if (owned.res) return owned.res;
  const snap = await db.collection(TAG_CONTACT_COLLECTION).where("tagId", "==", owned.id).get();
  const contacts = (snap.docs ?? [])
    .map((d) => d.data())
    .filter((c) => c.ownerUid === decoded.uid) // defence in depth
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, CONTACTS_LIST_MAX)
    // Owner sees the message content + optional callback — NEVER the scanner's
    // technical identity (token/IP hashes stay server-side).
    .map((c) => ({
      contactId: c.contactId, reason: c.reason, details: c.details ?? null,
      location: c.location ?? null, handedTo: c.handedTo ?? null, callbackPhone: c.callbackPhone ?? null,
      finderLat: typeof c.finderLat === "number" ? c.finderLat : null,
      finderLng: typeof c.finderLng === "number" ? c.finderLng : null,
      hasPhoto: c.hasPhoto === true,
      read: c.read === true, readAt: c.readAt ?? null,
      createdAt: c.createdAt,
    }));
  return { status: 200, body: { contacts, count: contacts.length } };
}

/** Owner marks one inbox message read (or unread again). */
async function markContactRead({ db, decoded, body, now }) {
  const owned = await ownedTag({ db, decoded, tagId: body?.tagId });
  if (owned.res) return owned.res;
  const contactId = clean(body?.contactId, 128);
  if (!contactId) return { status: 400, body: { error: "invalid_request", field: "contactId" } };
  const ref = db.collection(TAG_CONTACT_COLLECTION).doc(contactId);
  const snap = await ref.get();
  if (!snap.exists) return { status: 404, body: { error: "contact_not_found" } };
  const c = snap.data();
  if (c.tagId !== owned.id || c.ownerUid !== decoded.uid) return { status: 403, body: { error: "forbidden" } };
  const read = body?.read !== false;
  await ref.update({ read, readAt: read ? now : null });
  return { status: 200, body: { contactId, read } };
}

/** Owner fetches the finder's photo for one contact (stored out-of-row so the
 *  rate-limit scans over contacts stay light). */
async function contactPhoto({ db, decoded, body }) {
  const owned = await ownedTag({ db, decoded, tagId: body?.tagId });
  if (owned.res) return owned.res;
  const contactId = clean(body?.contactId, 128);
  if (!contactId) return { status: 400, body: { error: "invalid_request", field: "contactId" } };
  const snap = await db.collection(TAG_CONTACT_PHOTO_COLLECTION).doc(contactId).get();
  if (!snap.exists) return { status: 404, body: { error: "photo_not_found" } };
  const p = snap.data();
  if (p.tagId !== owned.id || p.ownerUid !== decoded.uid) return { status: 403, body: { error: "forbidden" } };
  return { status: 200, body: { contactId, photo: p.photo } };
}

export async function handleTagManage({ db, decoded, body, share, publicBaseUrl, auth = null, now = Date.now() }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };
  const action = typeof body?.action === "string" ? body.action : "";
  switch (action) {
    case "create": return createTag({ db, decoded, body, share, publicBaseUrl, now });
    case "provision": return provisionTags({ db, decoded, body, share, publicBaseUrl, now });
    case "grant_master_admin": return grantMasterAdmin({ auth, decoded, body });
    case "activate": return activateTag({ db, decoded, body, now });
    case "list": return listTags({ db, decoded, now });
    case "detail": return detailTag({ db, decoded, body, share, publicBaseUrl });
    case "update": return updateTag({ db, decoded, body, now });
    case "pause": return setTagStatus({ db, decoded, body, status: "paused", now });
    case "reactivate": return setTagStatus({ db, decoded, body, status: "active", now });
    case "mark_missing": return setTagStatus({ db, decoded, body, status: "missing", now });
    case "mark_found": return setTagStatus({ db, decoded, body: { ...body, __fromFound: true }, status: "active", now });
    case "contacts": return listContacts({ db, decoded, body, now });
    case "mark_read": return markContactRead({ db, decoded, body, now });
    case "contact_photo": return contactPhoto({ db, decoded, body });
    default: return { status: 400, body: { error: "invalid_request", field: "action" } };
  }
}

// ---------------------------------------------------------------------------
// Public plane (anonymous scanner) — resolve + one-way contact submission.
// It NEVER returns owner identity and NEVER mutates a Tag's configuration.
// ---------------------------------------------------------------------------
async function tagByToken({ db, token, now }) {
  const t = clean(token, 128);
  if (!t) return { res: { status: 400, body: { error: "invalid_request" } } };
  const hash = sha256Hex(t);
  const snap = await db.collection(TAG_COLLECTION).where("publicQrHash", "==", hash).get();
  const doc = (snap.docs ?? [])[0];
  if (!doc) {
    // Printed claim codes are letters/digits scanned by humans too — accept the
    // uppercase form of a case-mangled entry before giving up.
    const upper = t.toUpperCase();
    if (upper !== t && CUSTOM_CODE_OK.test(upper)) {
      const alt = await db.collection(TAG_COLLECTION).where("publicQrHash", "==", sha256Hex(upper)).get();
      const altDoc = (alt.docs ?? [])[0];
      if (altDoc) return { tag: altDoc.data() };
    }
    return { res: { status: 404, body: { error: "not_found" } } };
  }
  return { tag: doc.data() };
}

/** op:resolve — the public contact surface. Reveals ONLY what each status needs. */
async function resolveTag({ db, body, now }) {
  const found = await tagByToken({ db, token: body?.token, now });
  if (found.res) return found.res;
  const { tag } = found;
  if (tag.status === "paused") {
    // Safe unavailable — no message, no owner data, no profile.
    return { status: 200, body: { status: "paused", type: tag.type } };
  }
  if (tag.status === "unactivated") {
    // Activation invitation — nothing to leak: the tag has no owner yet.
    return { status: 200, body: { status: "unactivated", type: tag.type } };
  }
  // TAG_SCANNED — the owner deserves to know the tag was seen, even if the
  // scanner never submits. Throttled per tag so the PUBLIC endpoint can never
  // be turned into a write hose; failures never break the read.
  try {
    const last = typeof tag.lastScanEventAt === "number" ? tag.lastScanEventAt : null;
    if (last === null || now - last >= SCAN_EVENT_THROTTLE_MS) {
      await db.collection(TAG_COLLECTION).doc(tag.tagId).update({ lastScanEventAt: now });
      await emitTagEvent(db, { eventType: "TAG_SCANNED", tagId: tag.tagId, recipientUid: tag.ownerUid, data: { type: tag.type, status: tag.status }, now });
    }
  } catch (err) {
    console.warn("[tag] scan event skipped:", err?.message);
  }
  // Public profile: only the facts the owner actually set — null fields are
  // stripped, and an all-empty profile is omitted entirely.
  const profileEntries = Object.entries(tag.profile ?? {}).filter(([, v]) => v !== null && v !== undefined);
  const profile = profileEntries.length ? Object.fromEntries(profileEntries) : null;
  const permissions = buildPermissions(null, tag.permissions);
  return {
    status: 200,
    body: {
      status: tag.status, // active | missing
      type: tag.type,
      ownerMessage: tag.ownerMessage,
      reasons: TAG_TYPES[tag.type]?.reasons ?? [],
      permissions,
      ...(profile ? { profile } : {}),
      ...(tag.status === "missing" && tag.missingSince ? { missingSince: tag.missingSince } : {}),
    },
  };
}

/**
 * op:contact — one-way submission from an anonymous scanner. Abuse-controlled:
 * length limits, moderation, idempotency (no duplicate on retry), per-scanner
 * cap, same-content dedup, and a rapid-repeat cooldown by held identity AND by
 * hashed IP. The optional callback phone is stored owner-only and never returned
 * on the public surface or placed in any URL.
 */
async function submitContact({ db, body, sourceIp, now }) {
  const found = await tagByToken({ db, token: body?.token, now });
  if (found.res) return found.res;
  const { tag } = found;
  // A missing Tag NEEDS messages most of all — active and missing both accept.
  if (tag.status !== "active" && tag.status !== "missing") return { status: 409, body: { error: "unavailable" } };
  const permissions = buildPermissions(null, tag.permissions);
  if (!permissions.allowMessages) return { status: 403, body: { error: "messages_disabled" } };

  const reasons = TAG_TYPES[tag.type]?.reasons ?? [];
  const reason = clean(body?.reason, 32);
  if (!reasons.includes(reason)) return { status: 400, body: { error: "invalid_reason" } };

  const details = cleanText(body?.details, DETAILS_MAX) || null;
  // Pet/Luggage: where the scanner saw/found it (optional, strongly encouraged).
  const location = cleanText(body?.location, LOCATION_MAX) || null;
  // Luggage only: which staff desk / Lost & Found it was handed to.
  const handedTo = tag.type === "luggage" ? (cleanText(body?.handedTo, HANDED_TO_MAX) || null) : null;
  let callbackPhone = null;
  if (body?.callbackPhone !== undefined && body?.callbackPhone !== null && String(body.callbackPhone).trim() !== "") {
    const p = String(body.callbackPhone).trim().slice(0, PHONE_MAX);
    if (!PHONE_OK.test(p)) return { status: 400, body: { error: "invalid_phone" } };
    callbackPhone = p;
  }
  // Precise coordinates — ONLY when the scanner explicitly shared them, ONLY
  // when the owner allows location, and ONLY if they validate as a real pair.
  let coords = null;
  if (permissions.allowLocation && (body?.finderLat !== undefined || body?.finderLng !== undefined)) {
    coords = validLatLng(body?.finderLat, body?.finderLng);
    if (!coords) return { status: 400, body: { error: "invalid_location" } };
  }
  // Finder photo — validated data-URL, owner-permission-gated.
  let photo = null;
  if (body?.photo !== undefined && body?.photo !== null && body?.photo !== "") {
    if (!permissions.allowPhoto) return { status: 403, body: { error: "photo_disabled" } };
    photo = validPhotoDataUrl(body.photo);
    if (!photo) return { status: 400, body: { error: "invalid_photo" } };
  }

  const idem = clean(body?.idempotencyKey, 64);
  if (!IDEM_OK.test(idem)) return { status: 400, body: { error: "invalid_idempotency_key" } };

  const presented = typeof body?.scannerToken === "string" && SCANNER_TOKEN_OK.test(body.scannerToken.trim()) ? body.scannerToken.trim() : null;
  const scannerToken = presented ?? mintToken();
  const scannerIdHash = sha256Hex(scannerToken);
  const ipHash = sourceIp ? sha256Hex(`ip:${sourceIp}`) : null;

  const contactId = sha256Hex(`tc:${tag.tagId}:${idem}`);
  const ref = db.collection(TAG_CONTACT_COLLECTION).doc(contactId);
  if ((await ref.get()).exists) {
    return { status: 200, body: { ok: true, duplicate: true, scannerToken } };
  }

  // Rate limits over this Tag's existing contacts (in-memory filter — a single
  // physical Tag sees few scans; no composite index required). Finder photos
  // live in their own collection so these scans stay light.
  const snap = await db.collection(TAG_CONTACT_COLLECTION).where("tagId", "==", tag.tagId).get();
  const all = (snap.docs ?? []).map((d) => d.data());
  const mine = all.filter((c) => c.scannerIdHash === scannerIdHash);
  // Rapid-repeat cooldown (held identity OR same IP).
  const recentBlock = all.some((c) => (c.scannerIdHash === scannerIdHash || (ipHash && c.ipHash === ipHash)) && typeof c.createdAt === "number" && now - c.createdAt < CONTACT_COOLDOWN_MS);
  if (recentBlock) return { status: 429, body: { error: "cooldown" } };
  if (mine.length >= CONTACTS_PER_SCANNER_MAX) return { status: 429, body: { error: "too_many", limit: CONTACTS_PER_SCANNER_MAX } };
  // Same-content dedup from this identity (reason + details + location).
  const dupe = mine.find((c) => c.reason === reason && (c.details ?? null) === details && (c.location ?? null) === location);
  if (dupe) return { status: 200, body: { ok: true, duplicate: true, contactId: dupe.contactId, scannerToken } };

  if (photo) {
    await db.collection(TAG_CONTACT_PHOTO_COLLECTION).doc(contactId).set({
      schemaVersion: 1, contactId, tagId: tag.tagId, ownerUid: tag.ownerUid, photo, createdAt: now,
    });
  }
  await ref.set({
    schemaVersion: 1,
    contactId,
    tagId: tag.tagId,
    ownerUid: tag.ownerUid,        // owner-scoped so listContacts is isolated
    type: tag.type,
    reason,
    details,
    location,                      // where the scanner saw/found it (pet/luggage)
    handedTo,                      // Lost & Found / staff desk (luggage)
    callbackPhone,                 // PRIVATE — owner-only, never public
    finderLat: coords?.lat ?? null,
    finderLng: coords?.lng ?? null,
    hasPhoto: photo !== null,
    scannerIdHash,                 // rate-limiting only — never shown to owner
    ipHash,                        // rate-limiting only — never shown to owner
    read: false,
    createdAt: now,
  });
  await emitTagEvent(db, {
    eventType: "TAG_MESSAGE_SENT", tagId: tag.tagId, recipientUid: tag.ownerUid,
    data: { contactId, reason, petName: tag.profile?.name ?? null, locationShared: coords !== null, photoShared: photo !== null }, now,
  });
  if (coords) {
    await emitTagEvent(db, { eventType: "TAG_LOCATION_SHARED", tagId: tag.tagId, recipientUid: tag.ownerUid, data: { contactId }, now });
  }
  return { status: 200, body: { ok: true, duplicate: false, scannerToken } };
}

export async function handleTagScan({ db, body, share, publicBaseUrl, sourceIp = null, now = Date.now() }) {
  const op = typeof body?.op === "string" ? body.op : "resolve";
  if (op === "contact") return submitContact({ db, body, sourceIp, now });
  return resolveTag({ db, body, now });
}
