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
      metadata: {
        uid: decoded.uid,
        type,
        bytes: String(bytes.length),
        ...(durationMs ? { durationMs: String(durationMs) } : {}),
        uploadedAt: String(now),
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
  const durationMs = meta.durationMs ? Number(meta.durationMs) : null;
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
