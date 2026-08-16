/**
 * Seen — Gift Opening Media foundation (Wedding V1, Phase 3B-1).
 *
 * One private S3 bucket; THIS Lambda is the only trusted gateway for the
 * media lifecycle (matching the giftMessages posture: clients never touch
 * storage directly). The client speaks only in opaque `assetId`s — bucket
 * names, key structure, and presigned URLs are server concerns, so delivery
 * can later move behind CloudFront or a China-specific layer without touching
 * sealed Gift schema.
 *
 * Lifecycle: upload → staging/{uid}/{assetId} (sender-owned, 2-day lifecycle
 * cleanup) → sealed at gift/create → sealed/{tokenHash}/{assetId} (immutable
 * with the gift) → short-lived presigned GET minted ONLY by a successful
 * retrieve (so heart_key media is unobtainable before unlock, by
 * construction) → best-effort deletion on revoke; bucket lifecycle is the
 * fallback, not the mechanism.
 *
 * Content Boundary note (recorded, not implemented): the future Pre-Seal
 * Gate evaluates the final distributable payload INCLUDING media — it slots
 * in at finalize time, when the bytes are server-accessible. Text-only
 * policy evaluation is not sufficient once photo/audio exist.
 *
 * DI style like gift.mjs: pure validation + handlers taking a `store`
 * dependency; `makeS3MediaStore` is the real implementation.
 */

import crypto from "node:crypto";

// --- Contract constants -------------------------------------------------------

export const MEDIA_TYPES = ["photo", "audio"];
/** V1 canonical photo storage type — exactly one. */
export const PHOTO_CONTENT_TYPES = ["image/jpeg"];
/**
 * V1 audio set sized to real MediaRecorder output (3B-3 does runtime
 * capability detection — never "Safari = X, Android = Y" assumptions).
 * The ACTUAL approved contentType is persisted with the asset.
 */
export const AUDIO_CONTENT_TYPES = ["audio/mp4", "audio/aac", "audio/webm"];
export const MEDIA_MAX_BYTES = 2 * 1024 * 1024; // hard stored cap, both types
export const MEDIA_MIN_BYTES = 1024; // reject obviously-junk payloads
export const AUDIO_MAX_DURATION_MS = 60_000;
/** Presigned GET lifetime — Founder-approved 15 minutes (not 1 hour). */
export const MEDIA_URL_TTL_SECONDS = 15 * 60;

export const STAGING_PREFIX = "staging";
export const SEALED_PREFIX = "sealed";

// --- Validation helpers ---------------------------------------------------------

function contentTypesFor(type) {
  return type === "photo" ? PHOTO_CONTENT_TYPES : AUDIO_CONTENT_TYPES;
}

/**
 * Magic-byte sniffing — filenames/extensions are never trusted (§5), and the
 * backend never assumes a client conversion succeeded (§13): a photo upload
 * must BE a decodable JPEG stream, not merely claim image/jpeg.
 */
export function sniffMediaBytes(bytes, contentType) {
  if (!bytes || bytes.length < 12) return false;
  const b = bytes;
  if (contentType === "image/jpeg") {
    return b[0] === 0xff && b[1] === 0xd8 && b[2] === 0xff;
  }
  if (contentType === "audio/mp4") {
    return b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70; // 'ftyp'
  }
  if (contentType === "audio/aac") {
    const ftyp = b[4] === 0x66 && b[5] === 0x74 && b[6] === 0x79 && b[7] === 0x70;
    const adts = b[0] === 0xff && (b[1] & 0xf0) === 0xf0;
    return ftyp || adts;
  }
  if (contentType === "audio/webm") {
    return b[0] === 0x1a && b[1] === 0x45 && b[2] === 0xdf && b[3] === 0xa3; // EBML
  }
  return false;
}

/** Unguessable opaque asset identity (128-bit, like the gift token). */
export function generateAssetId() {
  return crypto.randomBytes(16).toString("base64url");
}

const ASSET_ID_RE = /^[A-Za-z0-9_-]{20,24}$/;

// --- Upload -------------------------------------------------------------------

/**
 * POST /gift/media/upload — authenticated sender only. Base64 JSON transport
 * (Founder-approved for the small V1 caps; the cap is a product limit, never
 * raised just because transport permits).
 *
 * body: { type: "photo"|"audio", contentType, data: <base64>, durationMs? }
 * 200 → { assetId, type, contentType, bytes, durationMs }
 */
export async function uploadGiftMedia({ store, decoded, body, now = Date.now() }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };
  if (!store) return { status: 503, body: { error: "media_unavailable" } };

  const type = MEDIA_TYPES.includes(body?.type) ? body.type : null;
  if (!type) return { status: 400, body: { error: "invalid_media", field: "type" } };

  const contentType = typeof body?.contentType === "string" ? body.contentType.trim().toLowerCase() : "";
  if (!contentTypesFor(type).includes(contentType)) {
    return { status: 400, body: { error: "invalid_media", field: "contentType" } };
  }

  let durationMs = null;
  if (type === "audio") {
    durationMs = Number(body?.durationMs);
    if (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > AUDIO_MAX_DURATION_MS) {
      return { status: 400, body: { error: "invalid_media", field: "durationMs" } };
    }
    durationMs = Math.round(durationMs);
  } else if (body?.durationMs !== undefined && body?.durationMs !== null) {
    return { status: 400, body: { error: "invalid_media", field: "durationMs" } };
  }

  if (typeof body?.data !== "string" || !body.data) {
    return { status: 400, body: { error: "invalid_media", field: "data" } };
  }
  let bytes;
  try {
    bytes = Buffer.from(body.data, "base64");
  } catch {
    return { status: 400, body: { error: "invalid_media", field: "data" } };
  }
  if (bytes.length < MEDIA_MIN_BYTES) {
    return { status: 400, body: { error: "invalid_media", field: "data" } };
  }
  if (bytes.length > MEDIA_MAX_BYTES) {
    return { status: 400, body: { error: "media_too_large" } };
  }
  if (!sniffMediaBytes(bytes, contentType)) {
    return { status: 400, body: { error: "invalid_media", field: "data" } };
  }

  const assetId = generateAssetId();
  try {
    await store.putStaging({
      uid: decoded.uid,
      assetId,
      bytes,
      contentType,
      // S3 lowercases user-metadata keys — write them lowercase so the
      // stored form IS the contract (read side stays case-tolerant).
      metadata: {
        uid: decoded.uid,
        type,
        bytes: String(bytes.length),
        ...(durationMs ? { durationms: String(durationMs) } : {}),
        uploadedat: String(now),
      },
    });
  } catch (e) {
    console.error("[giftMedia] staging put failed:", e?.message);
    return { status: 502, body: { error: "media_upload_failed" } };
  }

  // Log sizes/ids only — never URLs, never content.
  console.log(`[giftMedia] staged ${type} asset ${assetId.slice(0, 8)}… (${bytes.length}B) for uid ${decoded.uid.slice(0, 8)}…`);
  return { status: 200, body: { assetId, type, contentType, bytes: bytes.length, durationMs } };
}

// --- Presentation contract (Phase 3C-1) --------------------------------------

/**
 * Role-aware Invitation Presentation contract. Three INDEPENDENT roles:
 *   photo — sender-owned private visual opening (staged type 'photo')
 *   voice — sender-owned private personal voice  (staged type 'audio')
 *   musicThemeId — Gift.Seen-owned shared atmosphere; never a sender asset,
 *     never stored in the private bucket, validated against the occasion's
 *     server-side allowlist of genuinely available, rights-cleared themes.
 * Deliberately NOT a generic media[] — role semantics are the product model.
 */
export const PRESENTATION_VERSION = 1;

/** Which staged upload type each presentation role must carry. */
const ROLE_EXPECTED_TYPE = { photo: "photo", voice: "audio" };

/**
 * Legacy adapter (dual-read): a record sealed with the 3B-era single
 * `openingMedia` reads as the equivalent presentation. photo→photo,
 * audio→voice. Old records are never rewritten.
 */
export function adaptLegacyOpeningMedia(om) {
  if (!om || !om.assetId) return null;
  if (om.type === "photo") {
    return {
      v: PRESENTATION_VERSION,
      photo: { assetId: om.assetId, contentType: om.contentType, bytes: om.bytes },
    };
  }
  if (om.type === "audio") {
    return {
      v: PRESENTATION_VERSION,
      voice: {
        assetId: om.assetId,
        contentType: om.contentType,
        bytes: om.bytes,
        ...(om.durationMs ? { durationMs: om.durationMs } : {}),
      },
    };
  }
  return null;
}

/** Canonical read: new field first, legacy adapted second. */
export function readPresentation(rec) {
  return rec?.presentation ?? adaptLegacyOpeningMedia(rec?.openingMedia) ?? null;
}

// --- Sealing ---------------------------------------------------------------------

/**
 * Validate + promote a staged asset while sealing a gift. Called by
 * createGift BEFORE the record write, so a failed promotion never leaves a
 * corrupt gift. The staging key is derived from the AUTHENTICATED sender's
 * uid — a client-supplied key is never accepted, so one sender can never
 * attach another sender's media.
 *
 * Returns { ok:true, media } (the immutable record fragment) or
 * { ok:false, status, body }.
 */
export async function finalizeOpeningMedia({ store, decoded, openingMedia, tokenHash }) {
  if (!store) return { ok: false, status: 503, body: { error: "media_unavailable" } };

  const type = MEDIA_TYPES.includes(openingMedia?.type) ? openingMedia.type : null;
  if (!type) return { ok: false, status: 400, body: { error: "invalid_media", field: "type" } };
  const assetId = typeof openingMedia?.assetId === "string" ? openingMedia.assetId : "";
  if (!ASSET_ID_RE.test(assetId)) {
    return { ok: false, status: 400, body: { error: "invalid_media", field: "assetId" } };
  }

  let head;
  try {
    head = await store.headStaging({ uid: decoded.uid, assetId });
  } catch (e) {
    console.error("[giftMedia] staging head failed:", e?.message);
    return { ok: false, status: 502, body: { error: "media_seal_failed" } };
  }
  if (!head) return { ok: false, status: 400, body: { error: "invalid_media", field: "assetId" } };

  // Re-validate everything from the SERVER-side object, not client claims.
  const meta = head.metadata || {};
  const bytes = Number(meta.bytes ?? head.bytes ?? NaN);
  const contentType = String(head.contentType || "").toLowerCase();
  const rawDuration = meta.durationms ?? meta.durationMs;
  const durationMs = rawDuration ? Number(rawDuration) : null;
  if (meta.type !== type) return { ok: false, status: 400, body: { error: "invalid_media", field: "type" } };
  if (!contentTypesFor(type).includes(contentType)) {
    return { ok: false, status: 400, body: { error: "invalid_media", field: "contentType" } };
  }
  if (!Number.isFinite(bytes) || bytes > MEDIA_MAX_BYTES || bytes < MEDIA_MIN_BYTES) {
    return { ok: false, status: 400, body: { error: "invalid_media", field: "data" } };
  }
  if (type === "audio" && (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > AUDIO_MAX_DURATION_MS)) {
    return { ok: false, status: 400, body: { error: "invalid_media", field: "durationMs" } };
  }

  try {
    await store.copyToSealed({ uid: decoded.uid, assetId, tokenHash });
  } catch (e) {
    console.error("[giftMedia] seal copy failed:", e?.message);
    return { ok: false, status: 502, body: { error: "media_seal_failed" } };
  }
  // Staging removal is best-effort; the 2-day lifecycle is the fallback.
  try {
    await store.deleteStaging({ uid: decoded.uid, assetId });
  } catch (e) {
    console.warn("[giftMedia] staging delete failed (lifecycle will clean):", e?.message);
  }

  return {
    ok: true,
    media: {
      type,
      assetId,
      contentType,
      bytes,
      ...(type === "audio" ? { durationMs } : {}),
    },
  };
}

/**
 * Validate a staged asset for a ROLE without promoting it. Server-side
 * re-validation from the object, never client claims; role/type mismatch
 * (audio in photo role, photo in voice role) is rejected.
 */
async function validateStagedRole({ store, decoded, role, assetId }) {
  const field = `presentation.${role}`;
  if (!ASSET_ID_RE.test(assetId || "")) {
    return { ok: false, status: 400, body: { error: "invalid_media", field } };
  }
  let head;
  try {
    head = await store.headStaging({ uid: decoded.uid, assetId });
  } catch (e) {
    console.error(`[giftMedia] staging head failed (${role}):`, e?.message);
    return { ok: false, status: 502, body: { error: "media_seal_failed" } };
  }
  if (!head) return { ok: false, status: 400, body: { error: "invalid_media", field } };

  const meta = head.metadata || {};
  const bytes = Number(meta.bytes ?? head.bytes ?? NaN);
  const contentType = String(head.contentType || "").toLowerCase();
  // S3 returns user-metadata keys lowercased; tolerate both forms.
  const rawDuration = meta.durationms ?? meta.durationMs;
  const durationMs = rawDuration ? Number(rawDuration) : null;
  const expectedType = ROLE_EXPECTED_TYPE[role];
  if (meta.type !== expectedType) {
    return { ok: false, status: 400, body: { error: "invalid_media", field } };
  }
  if (!contentTypesFor(expectedType).includes(contentType)) {
    return { ok: false, status: 400, body: { error: "invalid_media", field } };
  }
  if (!Number.isFinite(bytes) || bytes > MEDIA_MAX_BYTES || bytes < MEDIA_MIN_BYTES) {
    return { ok: false, status: 400, body: { error: "invalid_media", field } };
  }
  if (expectedType === "audio" && (!Number.isFinite(durationMs) || durationMs <= 0 || durationMs > AUDIO_MAX_DURATION_MS)) {
    return { ok: false, status: 400, body: { error: "invalid_media", field } };
  }
  return {
    ok: true,
    fragment: {
      assetId,
      contentType,
      bytes,
      ...(expectedType === "audio" ? { durationMs } : {}),
    },
  };
}

/**
 * Finalize the full presentation atomically at seal time.
 *
 * Order: validate EVERY role → copy EVERY role to sealed → only then delete
 * stagings (best-effort). Any copy failure compensates by deleting the
 * sealed copies made so far while KEEPING every staging object — the sender
 * can retry the seal without re-uploading. No partial gift state can exist.
 *
 * Role inputs (Phase 4.5-B): a private role arrives EITHER as a freshly
 * staged upload `{ assetId }` OR as a reuse reference `{ fromGiftId }` —
 * the same Wedding photo/voice carried to another household's Invitation by
 * a server-side sealed→sealed copy (approved: small duplication in exchange
 * for unchanged per-invitation ownership/revocation/lifecycle semantics).
 * `resolveReuse(fromGiftId, role)` is supplied by the caller (gift.mjs owns
 * the db + event-membership checks); absent resolver → reuse is rejected.
 *
 * `allowedMusicThemes` is the occasion's server-side allowlist (empty until
 * genuinely rights-cleared assets exist — fake themes are never sealable).
 *
 * Returns { ok:true, presentation|null } or { ok:false, status, body }.
 */
export async function finalizePresentation({
  store,
  decoded,
  presentation,
  tokenHash,
  allowedMusicThemes = [],
  resolveReuse = null,
}) {
  if (presentation === undefined || presentation === null) return { ok: true, presentation: null };
  if (typeof presentation !== "object" || Array.isArray(presentation)) {
    return { ok: false, status: 400, body: { error: "invalid_presentation", field: "presentation" } };
  }

  const roles = [];
  for (const role of ["photo", "voice"]) {
    const entry = presentation[role];
    if (entry === undefined || entry === null) continue;
    const field = `presentation.${role}`;
    if (typeof entry !== "object") {
      return { ok: false, status: 400, body: { error: "invalid_media", field } };
    }
    const hasAsset = typeof entry.assetId === "string";
    const hasReuse = typeof entry.fromGiftId === "string";
    if (hasAsset === hasReuse) {
      // exactly one of assetId | fromGiftId — never both, never neither
      return { ok: false, status: 400, body: { error: "invalid_media", field } };
    }
    if (hasReuse && !resolveReuse) {
      return { ok: false, status: 400, body: { error: "invalid_media", field } };
    }
    roles.push(hasAsset ? { role, assetId: entry.assetId } : { role, fromGiftId: entry.fromGiftId });
  }

  let musicThemeId = null;
  if (presentation.musicThemeId !== undefined && presentation.musicThemeId !== null && presentation.musicThemeId !== "") {
    if (typeof presentation.musicThemeId !== "string" || !allowedMusicThemes.includes(presentation.musicThemeId)) {
      return { ok: false, status: 400, body: { error: "invalid_presentation", field: "musicThemeId" } };
    }
    musicThemeId = presentation.musicThemeId;
  }

  if (roles.length === 0 && !musicThemeId) return { ok: true, presentation: null };

  if (roles.length > 0 && !store) {
    return { ok: false, status: 503, body: { error: "media_unavailable" } };
  }

  // Phase 1 — validate everything before touching sealed storage. Staged
  // roles re-validate from the object; reused roles resolve through the
  // caller's ownership/event checks and inherit the source's verified
  // fragment (bytes/contentType/duration were validated at ITS seal).
  const fragments = {};
  const plans = []; // { role, kind: 'staged'|'reuse', assetId, srcTokenHash? }
  for (const r of roles) {
    if (r.assetId) {
      const res = await validateStagedRole({ store, decoded, role: r.role, assetId: r.assetId });
      if (!res.ok) return res;
      fragments[r.role] = res.fragment;
      plans.push({ role: r.role, kind: "staged", assetId: r.assetId });
    } else {
      const res = await resolveReuse(r.fromGiftId, r.role);
      if (!res.ok) return res;
      fragments[r.role] = res.fragment;
      plans.push({
        role: r.role,
        kind: "reuse",
        assetId: res.fragment.assetId,
        srcTokenHash: res.srcTokenHash,
      });
    }
  }

  // Phase 2 — promote all roles; compensate on any failure (stagings kept,
  // source invitations' sealed objects are READ-only and never touched).
  const promoted = [];
  for (const p of plans) {
    try {
      if (p.kind === "staged") {
        await store.copyToSealed({ uid: decoded.uid, assetId: p.assetId, tokenHash });
      } else {
        await store.copySealedToSealed({
          srcTokenHash: p.srcTokenHash,
          assetId: p.assetId,
          destTokenHash: tokenHash,
        });
      }
      promoted.push(p.assetId);
    } catch (e) {
      console.error(`[giftMedia] seal copy failed (${p.role}/${p.kind}):`, e?.message);
      for (const done of promoted) {
        await deleteSealedMedia({ store, tokenHash, assetId: done, reason: "seal_compensation" });
      }
      return { ok: false, status: 502, body: { error: "media_seal_failed" } };
    }
  }

  // Phase 3 — staging cleanup, best-effort only (lifecycle is the fallback).
  // Reused roles have no staging: their source sealed objects live on,
  // untouched, under the SOURCE invitation's own lifecycle.
  for (const p of plans) {
    if (p.kind !== "staged") continue;
    try {
      await store.deleteStaging({ uid: decoded.uid, assetId: p.assetId });
    } catch (e) {
      console.warn(`[giftMedia] staging delete failed (${p.role}; lifecycle will clean):`, e?.message);
    }
  }

  return {
    ok: true,
    presentation: {
      v: PRESENTATION_VERSION,
      ...(fragments.photo ? { photo: fragments.photo } : {}),
      ...(fragments.voice ? { voice: fragments.voice } : {}),
      ...(musicThemeId ? { musicThemeId } : {}),
    },
  };
}

/** Every sealed private asset a record owns (new contract or legacy). */
export function sealedAssetIds(rec) {
  const p = readPresentation(rec);
  if (!p) return [];
  return [p.photo?.assetId, p.voice?.assetId].filter(Boolean);
}

/**
 * Mint the recipient presentation for a SUCCESSFUL retrieve. Each private
 * role mints its own independent 15-minute descriptor; one role's minting
 * failure never suppresses the other role, the music theme, or the
 * invitation (§27 failure isolation). musicThemeId is not private media but
 * rides the same post-access response — no partial pre-unlock exposure.
 */
export async function mintPresentation({ store, rec, tokenHash }) {
  const p = readPresentation(rec);
  if (!p) return null;
  const out = {};
  if (p.photo?.assetId && store) {
    try {
      const url = await store.presignSealedGet({
        tokenHash,
        assetId: p.photo.assetId,
        contentType: p.photo.contentType,
        ttlSeconds: MEDIA_URL_TTL_SECONDS,
      });
      out.photo = { url, contentType: p.photo.contentType };
    } catch (e) {
      console.warn("[giftMedia] photo presign failed — role degrades:", e?.message);
    }
  }
  if (p.voice?.assetId && store) {
    try {
      const url = await store.presignSealedGet({
        tokenHash,
        assetId: p.voice.assetId,
        contentType: p.voice.contentType,
        ttlSeconds: MEDIA_URL_TTL_SECONDS,
      });
      out.voice = {
        url,
        contentType: p.voice.contentType,
        ...(p.voice.durationMs ? { durationMs: p.voice.durationMs } : {}),
      };
    } catch (e) {
      console.warn("[giftMedia] voice presign failed — role degrades:", e?.message);
    }
  }
  if (p.musicThemeId) out.musicThemeId = p.musicThemeId;
  return Object.keys(out).length > 0 ? out : null;
}

/** Best-effort compensation/revocation delete of a sealed object. */
export async function deleteSealedMedia({ store, tokenHash, assetId, reason = "revoke" }) {
  if (!store || !assetId) return false;
  try {
    await store.deleteSealed({ tokenHash, assetId });
    console.log(`[giftMedia] sealed asset ${assetId.slice(0, 8)}… deleted (${reason})`);
    return true;
  } catch (e) {
    // The gift stays revoked/failed regardless; lifecycle remains the fallback.
    console.warn(`[giftMedia] sealed delete failed (${reason}):`, e?.message);
    return false;
  }
}

// --- Recipient descriptor ----------------------------------------------------------

/**
 * Mint the short-lived media descriptor for a SUCCESSFUL retrieve. Failure
 * isolation (§17): any minting problem returns null — the invitation itself
 * is never held hostage by decorative media. Never exposes key/bucket/uid;
 * never logs the URL.
 */
export async function mintOpeningMedia({ store, rec, tokenHash }) {
  const om = rec?.openingMedia;
  if (!om || !om.assetId) return null;
  if (!store) return null;
  try {
    const url = await store.presignSealedGet({
      tokenHash,
      assetId: om.assetId,
      contentType: om.contentType,
      ttlSeconds: MEDIA_URL_TTL_SECONDS,
    });
    return {
      type: om.type,
      url,
      contentType: om.contentType,
      ...(om.durationMs ? { durationMs: om.durationMs } : {}),
    };
  } catch (e) {
    console.warn("[giftMedia] presign failed — invitation continues without media:", e?.message);
    return null;
  }
}

// --- Real S3 store -------------------------------------------------------------------

/**
 * Real store, lazily constructed from GIFT_MEDIA_BUCKET. All objects are
 * SSE-encrypted (bucket default) and private; presigned GETs are the only
 * read path and expire in 15 minutes.
 */
export function makeS3MediaStore({ bucket, region }) {
  if (!bucket) return null;
  let clientPromise = null;
  let presignerPromise = null;
  const getClient = () => {
    clientPromise ??= import("@aws-sdk/client-s3").then(
      (m) => new m.S3Client({ region: region || process.env.AWS_REGION || "ap-southeast-2" }),
    );
    return clientPromise;
  };
  const getPresigner = () => {
    presignerPromise ??= import("@aws-sdk/s3-request-presigner");
    return presignerPromise;
  };
  const stagingKey = (uid, assetId) => `${STAGING_PREFIX}/${uid}/${assetId}`;
  const sealedKey = (tokenHash, assetId) => `${SEALED_PREFIX}/${tokenHash}/${assetId}`;

  return {
    async putStaging({ uid, assetId, bytes, contentType, metadata }) {
      const [{ PutObjectCommand }, client] = await Promise.all([import("@aws-sdk/client-s3"), getClient()]);
      await client.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: stagingKey(uid, assetId),
          Body: bytes,
          ContentType: contentType,
          Metadata: metadata,
        }),
      );
    },
    async headStaging({ uid, assetId }) {
      const [{ HeadObjectCommand }, client] = await Promise.all([import("@aws-sdk/client-s3"), getClient()]);
      try {
        const r = await client.send(new HeadObjectCommand({ Bucket: bucket, Key: stagingKey(uid, assetId) }));
        return { bytes: r.ContentLength, contentType: r.ContentType, metadata: r.Metadata || {} };
      } catch (e) {
        if (e?.$metadata?.httpStatusCode === 404 || e?.name === "NotFound") return null;
        throw e;
      }
    },
    async copyToSealed({ uid, assetId, tokenHash }) {
      const [{ CopyObjectCommand }, client] = await Promise.all([import("@aws-sdk/client-s3"), getClient()]);
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: `${bucket}/${encodeURIComponent(stagingKey(uid, assetId))}`,
          Key: sealedKey(tokenHash, assetId),
          MetadataDirective: "COPY",
        }),
      );
    },
    // Phase 4.5-B — carry a Wedding photo/voice to another household's
    // Invitation: sealed→sealed server-side copy. The source object is only
    // READ; the destination gets its own object under its own tokenHash, so
    // per-invitation revocation/lifecycle semantics stay exactly as they are.
    async copySealedToSealed({ srcTokenHash, assetId, destTokenHash }) {
      const [{ CopyObjectCommand }, client] = await Promise.all([import("@aws-sdk/client-s3"), getClient()]);
      await client.send(
        new CopyObjectCommand({
          Bucket: bucket,
          CopySource: `${bucket}/${encodeURIComponent(sealedKey(srcTokenHash, assetId))}`,
          Key: sealedKey(destTokenHash, assetId),
          MetadataDirective: "COPY",
        }),
      );
    },
    async deleteStaging({ uid, assetId }) {
      const [{ DeleteObjectCommand }, client] = await Promise.all([import("@aws-sdk/client-s3"), getClient()]);
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: stagingKey(uid, assetId) }));
    },
    async deleteSealed({ tokenHash, assetId }) {
      const [{ DeleteObjectCommand }, client] = await Promise.all([import("@aws-sdk/client-s3"), getClient()]);
      await client.send(new DeleteObjectCommand({ Bucket: bucket, Key: sealedKey(tokenHash, assetId) }));
    },
    async presignSealedGet({ tokenHash, assetId, ttlSeconds }) {
      const [{ GetObjectCommand }, { getSignedUrl }, client] = await Promise.all([
        import("@aws-sdk/client-s3"),
        getPresigner(),
        getClient(),
      ]);
      return getSignedUrl(client, new GetObjectCommand({ Bucket: bucket, Key: sealedKey(tokenHash, assetId) }), {
        expiresIn: ttlSeconds || MEDIA_URL_TTL_SECONDS,
      });
    },
  };
}
