/**
 * Photo Story V1 — multi-photo presentation contract tests.
 * Covers the §16 backend rows: counts 0/1/2/5, 6-rejected, order, atomic
 * compensation, legacy compatibility, whole-set reuse + security, voice
 * coexistence, mint skip-on-failure.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  finalizePresentation,
  mintPresentation,
  sealedAssetIds,
  readPresentation,
  uploadGiftMedia,
  PHOTO_STORY_MAX,
} from "./giftMedia.mjs";
import { createGift, retrieveGift, GIFT_COLLECTION } from "./gift.mjs";
import { EVENT_COLLECTION } from "./event.mjs";

const AUTHOR = { uid: "author-1" };
const OTHER = { uid: "other-2" };

function makeMediaStore() {
  const objects = new Map();
  const store = {
    _objects: objects,
    failCopyOn: null, // assetId → inject promote failure
    failPresignOn: null,
    async putStaging({ uid, assetId, bytes, contentType, metadata }) {
      const meta = Object.fromEntries(Object.entries(metadata || {}).map(([k, v]) => [k.toLowerCase(), v]));
      objects.set(`staging/${uid}/${assetId}`, { bytes, contentType, metadata: meta });
    },
    async headStaging({ uid, assetId }) {
      const o = objects.get(`staging/${uid}/${assetId}`);
      return o ? { bytes: o.bytes.length, contentType: o.contentType, metadata: o.metadata } : null;
    },
    async copyToSealed({ uid, assetId, tokenHash }) {
      if (store.failCopyOn === assetId) throw new Error("injected copy failure");
      const o = objects.get(`staging/${uid}/${assetId}`);
      if (!o) throw new Error("missing source");
      objects.set(`sealed/${tokenHash}/${assetId}`, o);
    },
    async copySealedToSealed({ srcTokenHash, assetId, destTokenHash }) {
      const o = objects.get(`sealed/${srcTokenHash}/${assetId}`);
      if (!o) throw new Error("missing sealed source");
      objects.set(`sealed/${destTokenHash}/${assetId}`, o);
    },
    async deleteStaging({ uid, assetId }) {
      objects.delete(`staging/${uid}/${assetId}`);
    },
    async deleteSealed({ tokenHash, assetId }) {
      objects.delete(`sealed/${tokenHash}/${assetId}`);
    },
    async presignSealedGet({ tokenHash, assetId }) {
      if (store.failPresignOn === assetId) throw new Error("injected presign failure");
      return `https://media.example/sealed/${tokenHash}/${assetId}?sig=t`;
    },
  };
  return store;
}

async function stagePhoto(media, uid = AUTHOR.uid) {
  const bytes = Buffer.alloc(4096, 0x20);
  bytes[0] = 0xff; bytes[1] = 0xd8; bytes[2] = 0xff; // JPEG magic
  const res = await uploadGiftMedia({
    store: media,
    decoded: { uid },
    body: { type: "photo", contentType: "image/jpeg", data: bytes.toString("base64") },
  });
  assert.equal(res.status, 200);
  return res.body.assetId;
}

const seal = (media, presentation, extra = {}) =>
  finalizePresentation({
    store: media,
    decoded: AUTHOR,
    presentation,
    tokenHash: extra.tokenHash ?? "tok-main",
    allowedMusicThemes: ["wedding_warm_piano_v1"],
    resolveReuse: extra.resolveReuse ?? null,
  });

test("0 photos → null presentation; 1 staged photo keeps legacy single-photo shape", async () => {
  const media = makeMediaStore();
  assert.equal((await seal(media, null)).presentation, null);
  const a = await stagePhoto(media);
  const one = await seal(media, { photo: { assetId: a } });
  assert.ok(one.ok);
  assert.equal(one.presentation.photo.assetId, a);
  assert.equal(one.presentation.photos, undefined); // legacy write shape untouched
  // …but the canonical READ normalizes to a one-item story
  assert.equal(readPresentation({ presentation: one.presentation }).photos.length, 1);
});

test("2 and 5 photos seal ordered; photo mirror = first; 6 rejected; bad entry labeled", async () => {
  const media = makeMediaStore();
  const ids = [];
  for (let i = 0; i < 5; i += 1) ids.push(await stagePhoto(media));
  const two = await seal(media, { photos: [{ assetId: ids[0] }, { assetId: ids[1] }] }, { tokenHash: "tok-two" });
  assert.ok(two.ok);
  assert.deepEqual(two.presentation.photos.map((f) => f.assetId), [ids[0], ids[1]]);
  assert.equal(two.presentation.photo.assetId, ids[0]); // compat mirror

  // stagings are one-shot by design (promoted → deleted) — stage a fresh set
  const ids5 = [];
  for (let i = 0; i < 5; i += 1) ids5.push(await stagePhoto(media));
  const five = await seal(media, { photos: ids5.map((assetId) => ({ assetId })) }, { tokenHash: "tok-five" });
  assert.ok(five.ok);
  assert.deepEqual(five.presentation.photos.map((f) => f.assetId), ids5); // ORDER preserved
  for (const id of ids5) assert.ok(media._objects.has(`sealed/tok-five/${id}`));
  assert.equal(sealedAssetIds({ presentation: five.presentation }).length, 5);

  const six = await seal(media, { photos: Array.from({ length: PHOTO_STORY_MAX + 1 }, () => ({ assetId: ids5[0] })) });
  assert.equal(six.ok, false);
  assert.equal(six.status, 400);
  const bad = await seal(media, { photos: [{ assetId: ids[2] }, { nope: true }] });
  assert.equal(bad.body.field, "presentation.photos[1]");
  // photos and legacy photo are mutually exclusive
  const both = await seal(media, { photos: [{ assetId: ids[2] }], photo: { assetId: ids[3] } });
  assert.equal(both.ok, false);
});

test("atomic sealing: failure on photo 3 compensates sealed copies, keeps stagings", async () => {
  const media = makeMediaStore();
  const ids = [await stagePhoto(media), await stagePhoto(media), await stagePhoto(media)];
  media.failCopyOn = ids[2];
  const res = await seal(media, { photos: ids.map((assetId) => ({ assetId })) }, { tokenHash: "tok-atomic" });
  assert.equal(res.ok, false);
  assert.equal(res.status, 502);
  // no partially sealed gift material remains…
  for (const id of ids) assert.equal(media._objects.has(`sealed/tok-atomic/${id}`), false);
  // …and every staging survives for retry
  for (const id of ids) assert.ok(media._objects.has(`staging/${AUTHOR.uid}/${id}`));
});

test("voice + 5-photo story coexist; each independent", async () => {
  const media = makeMediaStore();
  const ids = [];
  for (let i = 0; i < 5; i += 1) ids.push(await stagePhoto(media));
  const voiceBytes = Buffer.alloc(4096, 0x11);
  voiceBytes[4] = 0x66; voiceBytes[5] = 0x74; voiceBytes[6] = 0x79; voiceBytes[7] = 0x70; // ftyp
  const vres = await uploadGiftMedia({
    store: media,
    decoded: AUTHOR,
    body: { type: "audio", contentType: "audio/mp4", data: voiceBytes.toString("base64"), durationMs: 9000 },
  });
  assert.equal(vres.status, 200);
  const sealed = await seal(media, {
    photos: ids.map((assetId) => ({ assetId })),
    voice: { assetId: vres.body.assetId },
    musicThemeId: "wedding_warm_piano_v1",
  }, { tokenHash: "tok-mix" });
  assert.ok(sealed.ok);
  assert.equal(sealed.presentation.photos.length, 5);
  assert.equal(sealed.presentation.voice.assetId, vres.body.assetId);
  assert.equal(sealed.presentation.musicThemeId, "wedding_warm_piano_v1");
  assert.equal(sealedAssetIds({ presentation: sealed.presentation }).length, 6);
});

test("mint: per-photo presign, ONE failure skips that photo only; legacy photo = first minted", async () => {
  const media = makeMediaStore();
  const ids = [await stagePhoto(media), await stagePhoto(media), await stagePhoto(media)];
  const sealed = await seal(media, { photos: ids.map((assetId) => ({ assetId })) }, { tokenHash: "tok-mint" });
  media.failPresignOn = ids[1];
  const minted = await mintPresentation({ store: media, rec: { presentation: sealed.presentation }, tokenHash: "tok-mint" });
  assert.equal(minted.photos.length, 2); // middle photo skipped, story continues
  assert.ok(minted.photos[0].url.includes(ids[0]));
  assert.ok(minted.photos[1].url.includes(ids[2]));
  assert.equal(minted.photo.url, minted.photos[0].url);
  // all presigns failing → no photos field at all (degrade to voice/invitation)
  media.failPresignOn = null;
  const legacyOnly = await mintPresentation({
    store: media,
    rec: { presentation: { v: 1, photo: sealed.presentation.photos[0] } },
    tokenHash: "tok-mint",
  });
  assert.equal(legacyOnly.photos.length, 1); // old record reads as 1-photo story
});

test("whole-set same-Event reuse inherits ordered story; cross-account refused (createGift path)", async () => {
  const media = makeMediaStore();
  const db = (function makeDb() {
    const store = new Map();
    return {
      _store: store,
      collection: (name) => ({
        doc: (id) => ({
          get: async () => ({ exists: store.has(`${name}/${id}`), data: () => store.get(`${name}/${id}`) }),
          set: async (v) => void store.set(`${name}/${id}`, { ...v }),
          update: async (p) => void store.set(`${name}/${id}`, { ...store.get(`${name}/${id}`), ...p }),
          delete: async () => void store.delete(`${name}/${id}`),
        }),
        where: () => ({ where: () => ({ get: async () => ({ docs: [] }) }), get: async () => ({ docs: [] }) }),
      }),
    };
  })();
  await db.collection(EVENT_COLLECTION).doc("ev-1").set({ type: "wedding", senderUid: AUTHOR.uid, occasion: { type: "wedding" }, status: "active", createdAt: 1 });
  const ids = [await stagePhoto(media), await stagePhoto(media), await stagePhoto(media)];
  const share = { seal: async (t, h) => `s:${h}` };
  const OCC = { type: "wedding", version: 1, couple: { partner1: "甲", partner2: "乙" }, date: "2026-10-01", time: { start: "17:00" }, venue: { displayName: "酒店" }, inviter: "甲 与 乙", audienceType: "friends" };
  const src = await createGift({
    db, decoded: AUTHOR, media, share,
    body: { message: "请柬", occasion: OCC, eventId: "ev-1", recipientLabel: "张家", presentation: { photos: ids.map((assetId) => ({ assetId })) } },
    now: 1000,
  });
  assert.equal(src.status, 200);
  const reused = await createGift({
    db, decoded: AUTHOR, media, share,
    body: { message: "第二份", occasion: OCC, eventId: "ev-1", recipientLabel: "李家", presentation: { photos: { fromGiftId: src.body.giftId } } },
    now: 2000,
  });
  assert.equal(reused.status, 200);
  const rec = db._store.get(`${GIFT_COLLECTION}/${reused.body.giftId}`);
  assert.deepEqual(rec.presentation.photos.map((f) => f.assetId), ids); // order inherited
  for (const id of ids) assert.ok(media._objects.has(`sealed/${reused.body.giftId}/${id}`));
  // recipient of the reused gift sees the full story
  const got = await retrieveGift({ db, body: { token: reused.body.token }, media, now: 3000 });
  assert.equal(got.body.presentation.photos.length, 3);
  // cross-account whole-set reuse refused
  await db.collection(EVENT_COLLECTION).doc("ev-2").set({ type: "wedding", senderUid: OTHER.uid, occasion: { type: "wedding" }, status: "active", createdAt: 1 });
  const stolen = await createGift({
    db, decoded: OTHER, media, share,
    body: { message: "x", occasion: OCC, eventId: "ev-2", recipientLabel: "王家", presentation: { photos: { fromGiftId: src.body.giftId } } },
    now: 4000,
  });
  assert.equal(stolen.status, 403);
});
