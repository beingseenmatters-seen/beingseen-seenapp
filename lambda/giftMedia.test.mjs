import { test } from "node:test";
import assert from "node:assert/strict";
import {
  sniffMediaBytes,
  generateAssetId,
  uploadGiftMedia,
  finalizeOpeningMedia,
  deleteSealedMedia,
  mintOpeningMedia,
  MEDIA_MAX_BYTES,
  MEDIA_URL_TTL_SECONDS,
} from "./giftMedia.mjs";

// --- Fake store (in-memory; mirrors the S3 store interface) -----------------
export function makeFakeMediaStore() {
  const objects = new Map();
  const store = {
    _objects: objects,
    failCopy: false,
    failPresign: false,
    async putStaging({ uid, assetId, bytes, contentType, metadata }) {
      objects.set(`staging/${uid}/${assetId}`, { bytes, contentType, metadata });
    },
    async headStaging({ uid, assetId }) {
      const o = objects.get(`staging/${uid}/${assetId}`);
      return o ? { bytes: o.bytes.length, contentType: o.contentType, metadata: o.metadata } : null;
    },
    async copyToSealed({ uid, assetId, tokenHash }) {
      if (store.failCopy) throw new Error("injected copy failure");
      const o = objects.get(`staging/${uid}/${assetId}`);
      if (!o) throw new Error("missing source");
      objects.set(`sealed/${tokenHash}/${assetId}`, o);
    },
    async deleteStaging({ uid, assetId }) {
      objects.delete(`staging/${uid}/${assetId}`);
    },
    async deleteSealed({ tokenHash, assetId }) {
      objects.delete(`sealed/${tokenHash}/${assetId}`);
    },
    async presignSealedGet({ tokenHash, assetId }) {
      if (store.failPresign) throw new Error("injected presign failure");
      return `https://media.example/sealed/${tokenHash}/${assetId}?sig=test&ttl=${MEDIA_URL_TTL_SECONDS}`;
    },
  };
  return store;
}

const SENDER = { uid: "sender-A" };

export function jpegBytes(size = 2048) {
  const b = Buffer.alloc(size, 0x20);
  b[0] = 0xff; b[1] = 0xd8; b[2] = 0xff; b[3] = 0xe0;
  return b;
}
export function m4aBytes(size = 2048) {
  const b = Buffer.alloc(size, 0x20);
  b[4] = 0x66; b[5] = 0x74; b[6] = 0x79; b[7] = 0x70; // ftyp
  return b;
}
function webmBytes(size = 2048) {
  const b = Buffer.alloc(size, 0x20);
  b[0] = 0x1a; b[1] = 0x45; b[2] = 0xdf; b[3] = 0xa3;
  return b;
}
function pngBytes(size = 2048) {
  const b = Buffer.alloc(size, 0x20);
  b[0] = 0x89; b[1] = 0x50; b[2] = 0x4e; b[3] = 0x47;
  return b;
}

export async function stagePhoto(store, uid = SENDER.uid) {
  const res = await uploadGiftMedia({
    store,
    decoded: { uid },
    body: { type: "photo", contentType: "image/jpeg", data: jpegBytes().toString("base64") },
  });
  assert.equal(res.status, 200);
  return res.body;
}

// --- Sniffing -----------------------------------------------------------------

test("magic bytes: accepts genuine formats, rejects imposters", () => {
  assert.equal(sniffMediaBytes(jpegBytes(), "image/jpeg"), true);
  assert.equal(sniffMediaBytes(m4aBytes(), "audio/mp4"), true);
  assert.equal(sniffMediaBytes(m4aBytes(), "audio/aac"), true);
  assert.equal(sniffMediaBytes(webmBytes(), "audio/webm"), true);
  assert.equal(sniffMediaBytes(pngBytes(), "image/jpeg"), false); // PNG claiming JPEG
  assert.equal(sniffMediaBytes(jpegBytes(), "audio/mp4"), false);
  assert.equal(sniffMediaBytes(Buffer.alloc(4), "image/jpeg"), false);
});

test("assetId is opaque and unguessable-length", () => {
  const id = generateAssetId();
  assert.match(id, /^[A-Za-z0-9_-]{20,24}$/);
  assert.notEqual(generateAssetId(), id);
});

// --- Upload ---------------------------------------------------------------------

test("upload requires auth and a configured store", async () => {
  const store = makeFakeMediaStore();
  const noAuth = await uploadGiftMedia({ store, decoded: null, body: {} });
  assert.equal(noAuth.status, 401);
  const noStore = await uploadGiftMedia({ store: null, decoded: SENDER, body: { type: "photo", contentType: "image/jpeg", data: jpegBytes().toString("base64") } });
  assert.equal(noStore.status, 503);
  assert.equal(noStore.body.error, "media_unavailable");
});

test("upload validates type, contentType, size, duration and magic bytes", async () => {
  const store = makeFakeMediaStore();
  const cases = [
    [{ type: "video", contentType: "video/mp4", data: m4aBytes().toString("base64") }, "type"],
    [{ type: "photo", contentType: "image/png", data: pngBytes().toString("base64") }, "contentType"],
    [{ type: "photo", contentType: "image/jpeg", data: jpegBytes().toString("base64"), durationMs: 5 }, "durationMs"],
    [{ type: "audio", contentType: "audio/mp4", data: m4aBytes().toString("base64") }, "durationMs"],
    [{ type: "audio", contentType: "audio/mp4", data: m4aBytes().toString("base64"), durationMs: 61_000 }, "durationMs"],
    [{ type: "photo", contentType: "image/jpeg" }, "data"],
    [{ type: "photo", contentType: "image/jpeg", data: jpegBytes(512).toString("base64") }, "data"], // under min
    [{ type: "photo", contentType: "image/jpeg", data: pngBytes().toString("base64") }, "data"], // magic mismatch
  ];
  for (const [body, field] of cases) {
    const res = await uploadGiftMedia({ store, decoded: SENDER, body });
    assert.equal(res.status, 400, `expected 400 for ${field}`);
    assert.equal(res.body.error, "invalid_media");
    assert.equal(res.body.field, field);
  }
  const big = await uploadGiftMedia({
    store,
    decoded: SENDER,
    body: { type: "photo", contentType: "image/jpeg", data: jpegBytes(MEDIA_MAX_BYTES + 1).toString("base64") },
  });
  assert.equal(big.status, 400);
  assert.equal(big.body.error, "media_too_large");
  assert.equal(store._objects.size, 0); // nothing staged by any rejection
});

test("upload stages a valid photo and audio under the sender's namespace", async () => {
  const store = makeFakeMediaStore();
  const photo = await stagePhoto(store);
  assert.ok(store._objects.has(`staging/${SENDER.uid}/${photo.assetId}`));
  assert.equal(photo.type, "photo");
  assert.equal(photo.contentType, "image/jpeg");
  assert.equal(photo.durationMs, null);

  const audio = await uploadGiftMedia({
    store,
    decoded: SENDER,
    body: { type: "audio", contentType: "audio/webm", data: webmBytes().toString("base64"), durationMs: 12_345.6 },
  });
  assert.equal(audio.status, 200);
  assert.equal(audio.body.durationMs, 12_346); // rounded
  const staged = store._objects.get(`staging/${SENDER.uid}/${audio.body.assetId}`);
  assert.equal(staged.metadata.type, "audio");
  assert.equal(staged.metadata.durationMs, "12346");
});

// --- Finalize -----------------------------------------------------------------------

test("finalize promotes the sender's own asset and removes staging", async () => {
  const store = makeFakeMediaStore();
  const { assetId } = await stagePhoto(store);
  const fin = await finalizeOpeningMedia({ store, decoded: SENDER, openingMedia: { type: "photo", assetId }, tokenHash: "tok-hash" });
  assert.equal(fin.ok, true);
  assert.deepEqual(fin.media, { type: "photo", assetId, contentType: "image/jpeg", bytes: 2048 });
  assert.ok(store._objects.has(`sealed/tok-hash/${assetId}`));
  assert.ok(!store._objects.has(`staging/${SENDER.uid}/${assetId}`));
});

test("finalize rejects foreign, nonexistent, and mismatched assets", async () => {
  const store = makeFakeMediaStore();
  const { assetId } = await stagePhoto(store, "sender-B"); // someone ELSE's asset
  const foreign = await finalizeOpeningMedia({ store, decoded: SENDER, openingMedia: { type: "photo", assetId }, tokenHash: "t" });
  assert.equal(foreign.ok, false);
  assert.equal(foreign.status, 400);
  assert.equal(foreign.body.field, "assetId"); // unreachable by construction

  const missing = await finalizeOpeningMedia({ store, decoded: SENDER, openingMedia: { type: "photo", assetId: generateAssetId() }, tokenHash: "t" });
  assert.equal(missing.ok, false);
  assert.equal(missing.body.field, "assetId");

  const mine = await stagePhoto(store);
  const wrongType = await finalizeOpeningMedia({ store, decoded: SENDER, openingMedia: { type: "audio", assetId: mine.assetId }, tokenHash: "t" });
  assert.equal(wrongType.ok, false);
  assert.equal(wrongType.body.field, "type");

  const badId = await finalizeOpeningMedia({ store, decoded: SENDER, openingMedia: { type: "photo", assetId: "../../etc" }, tokenHash: "t" });
  assert.equal(badId.ok, false);
  assert.equal(badId.body.field, "assetId");
});

test("finalize copy failure is loud and leaves no sealed object", async () => {
  const store = makeFakeMediaStore();
  const { assetId } = await stagePhoto(store);
  store.failCopy = true;
  const fin = await finalizeOpeningMedia({ store, decoded: SENDER, openingMedia: { type: "photo", assetId }, tokenHash: "t" });
  assert.equal(fin.ok, false);
  assert.equal(fin.status, 502);
  assert.equal(fin.body.error, "media_seal_failed");
  assert.equal([...store._objects.keys()].some((k) => k.startsWith("sealed/")), false);
});

// --- Mint ------------------------------------------------------------------------------

test("mint returns a short-lived descriptor without exposing storage identity", async () => {
  const store = makeFakeMediaStore();
  const rec = { openingMedia: { type: "audio", assetId: "abc123abc123abc123abc1", contentType: "audio/mp4", bytes: 2000, durationMs: 9000 } };
  const d = await mintOpeningMedia({ store, rec, tokenHash: "tok" });
  assert.equal(d.type, "audio");
  assert.equal(d.contentType, "audio/mp4");
  assert.equal(d.durationMs, 9000);
  assert.ok(d.url.includes("sig=test"));
  assert.equal("assetId" in d, false);
  assert.equal("bytes" in d, false);
});

test("mint degrades to null on absence or presign failure — never throws", async () => {
  const store = makeFakeMediaStore();
  assert.equal(await mintOpeningMedia({ store, rec: {}, tokenHash: "t" }), null);
  assert.equal(await mintOpeningMedia({ store: null, rec: { openingMedia: { assetId: "x".repeat(22) } }, tokenHash: "t" }), null);
  store.failPresign = true;
  const rec = { openingMedia: { type: "photo", assetId: "x".repeat(22), contentType: "image/jpeg", bytes: 2000 } };
  assert.equal(await mintOpeningMedia({ store, rec, tokenHash: "t" }), null);
});

test("deleteSealedMedia is best-effort and reports outcome", async () => {
  const store = makeFakeMediaStore();
  store._objects.set("sealed/t/aaaaaaaaaaaaaaaaaaaaaa", { bytes: Buffer.alloc(1), contentType: "image/jpeg", metadata: {} });
  assert.equal(await deleteSealedMedia({ store, tokenHash: "t", assetId: "aaaaaaaaaaaaaaaaaaaaaa" }), true);
  assert.equal(store._objects.size, 0);
  store.deleteSealed = async () => { throw new Error("injected"); };
  assert.equal(await deleteSealedMedia({ store, tokenHash: "t", assetId: "aaaaaaaaaaaaaaaaaaaaaa" }), false);
  assert.equal(await deleteSealedMedia({ store: null, tokenHash: "t", assetId: "a" }), false);
});
