/**
 * Phase 4.5-B3 — Guest List / variants / batch distribution tests.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGift, retrieveGift, GIFT_COLLECTION } from "./gift.mjs";
import {
  EVENT_COLLECTION,
  GUEST_COLLECTION,
  createEvent,
  upsertGuest,
  removeGuest,
  saveVariant,
  eventDetail,
  maskPhone,
} from "./event.mjs";
import { validateWeddingOccasion } from "./occasion.mjs";
import { distributeInvitations } from "./distribute.mjs";

function makeFakeDb() {
  const store = new Map();
  const matchCond = (v, c) => (c.op === "==" ? v[c.field] === c.val : c.op === ">=" ? v[c.field] >= c.val : false);
  function makeQuery(name, conds) {
    return {
      where: (f, o, v) => makeQuery(name, [...conds, { field: f, op: o, val: v }]),
      get: async () => {
        const docs = [...store.entries()]
          .filter(([k]) => k.startsWith(`${name}/`))
          .filter(([, v]) => conds.every((c) => matchCond(v, c)))
          .map(([k, v]) => ({ id: k.slice(name.length + 1), data: () => v }));
        return { size: docs.length, docs };
      },
    };
  }
  return {
    _store: store,
    collection(name) {
      return {
        doc: (id) => ({
          id,
          get: async () => ({ exists: store.get(`${name}/${id}`) !== undefined, data: () => store.get(`${name}/${id}`) }),
          set: async (v) => void store.set(`${name}/${id}`, { ...v }),
          update: async (p) => void store.set(`${name}/${id}`, { ...store.get(`${name}/${id}`), ...p }),
          delete: async () => void store.delete(`${name}/${id}`),
        }),
        where: (f, o, v) => makeQuery(name, [{ field: f, op: o, val: v }]),
      };
    },
  };
}
const fakeShare = () => ({
  seal: async (t, h) => `sealed:${Buffer.from(String(t)).toString("base64")}@${h}`,
  open: async (s, h) => {
    const m = /^sealed:(.+)@(.+)$/.exec(String(s));
    if (!m || m[2] !== h) throw new Error("ctx");
    return Buffer.from(m[1], "base64").toString();
  },
});
function makeMedia() {
  const objects = new Map();
  return {
    _objects: objects,
    async putStaging({ uid, assetId, bytes, contentType, metadata }) {
      const meta = Object.fromEntries(Object.entries(metadata || {}).map(([k, v]) => [k.toLowerCase(), v]));
      objects.set(`staging/${uid}/${assetId}`, { bytes, contentType, metadata: meta });
    },
    async headStaging({ uid, assetId }) {
      const o = objects.get(`staging/${uid}/${assetId}`);
      return o ? { bytes: o.bytes.length, contentType: o.contentType, metadata: o.metadata } : null;
    },
    async copyToSealed({ uid, assetId, tokenHash }) {
      const o = objects.get(`staging/${uid}/${assetId}`);
      if (!o) throw new Error("missing");
      objects.set(`sealed/${tokenHash}/${assetId}`, o);
    },
    async copySealedToSealed({ srcTokenHash, assetId, destTokenHash }) {
      const o = objects.get(`sealed/${srcTokenHash}/${assetId}`);
      if (!o) throw new Error("missing sealed");
      objects.set(`sealed/${destTokenHash}/${assetId}`, o);
    },
    async deleteStaging({ uid, assetId }) { objects.delete(`staging/${uid}/${assetId}`); },
    async deleteSealed({ tokenHash, assetId }) { objects.delete(`sealed/${tokenHash}/${assetId}`); },
    async presignSealedGet({ tokenHash, assetId }) { return `https://m.example/sealed/${tokenHash}/${assetId}`; },
  };
}
async function stagePhoto(media, uid) {
  const bytes = Buffer.alloc(2048, 0x20);
  bytes[0] = 0xff; bytes[1] = 0xd8; bytes[2] = 0xff;
  const { uploadGiftMedia } = await import("./giftMedia.mjs");
  const r = await uploadGiftMedia({ store: media, decoded: { uid }, body: { type: "photo", contentType: "image/jpeg", data: bytes.toString("base64") } });
  return r.body.assetId;
}

const A = { uid: "sender-a" };
const B = { uid: "sender-b" };
const FACTS = {
  type: "wedding", version: 1,
  couple: { partner1: "冯志俊", partner2: "吴姗姗" }, date: "2026-10-01",
  time: { start: "17:00" }, venue: { displayName: "杭州世纪皇冠大酒店" },
  inviter: "苏东坡", audienceType: "friends",
};
const mkEvent = async (db, who = A) =>
  (await createEvent({ db, decoded: who, body: { occasion: FACTS }, validateOccasion: validateWeddingOccasion })).body.eventId;
const addGuest = async (db, eventId, label, relationshipType, extra = {}, who = A) =>
  (await upsertGuest({ db, decoded: who, body: { eventId, label, relationshipType, ...extra }, giftCollection: GIFT_COLLECTION })).body.guestId;

test("guest CRUD: validation, phone masking, sealed freeze, remove rules", async () => {
  const db = makeFakeDb();
  const eventId = await mkEvent(db);
  const bad = await upsertGuest({ db, decoded: A, body: { eventId, label: "张先生全家", relationshipType: "boss" }, giftCollection: GIFT_COLLECTION });
  assert.equal(bad.body.error, "invalid_relationship");
  const badPhone = await upsertGuest({ db, decoded: A, body: { eventId, label: "张先生全家", relationshipType: "elders", phone: "abc" }, giftCollection: GIFT_COLLECTION });
  assert.equal(badPhone.body.error, "invalid_phone");
  const g = await addGuest(db, eventId, "张先生全家", "elders", { phone: "13812341234" });
  assert.equal(maskPhone("13812341234"), "138****1234");
  const other = await upsertGuest({ db, decoded: B, body: { eventId, label: "x", relationshipType: "elders" }, giftCollection: GIFT_COLLECTION });
  assert.equal(other.status, 403);
  // frozen after invitation link
  db._store.get(`${GUEST_COLLECTION}/${g}`).invitationGiftId = "fakegift";
  const freeze = await upsertGuest({ db, decoded: A, body: { eventId, guestId: g, label: "改名", relationshipType: "elders" }, giftCollection: GIFT_COLLECTION });
  assert.equal(freeze.status, 409);
  const phoneOk = await upsertGuest({ db, decoded: A, body: { eventId, guestId: g, label: "张先生全家", relationshipType: "elders", phone: "13900001111" }, giftCollection: GIFT_COLLECTION });
  assert.equal(phoneOk.status, 200); // phone stays editable
  const rm = await removeGuest({ db, decoded: A, body: { guestId: g } });
  assert.equal(rm.status, 409); // sealed rows can't be removed
});

test("variants: vocabulary + length validation, persist at event scope", async () => {
  const db = makeFakeDb();
  const eventId = await mkEvent(db);
  assert.equal((await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "nope", message: "x" } })).body.error, "invalid_relationship");
  assert.equal((await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "elders", message: "" } })).body.error, "invalid_message");
  const first = await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "elders", message: "长辈版文案" } });
  assert.equal(first.body.existed, false);
  const again = await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "elders", message: "长辈版文案（改）" } });
  assert.equal(again.body.existed, true);
  const ev = db._store.get(`${EVENT_COLLECTION}/${eventId}`);
  assert.equal(ev.variants.elders.message, "长辈版文案（改）");
});

test("distribute: variants map rows, presentation bootstraps staged→fromGiftId, links written", async () => {
  const db = makeFakeDb();
  const media = makeMedia();
  const share = fakeShare();
  const eventId = await mkEvent(db);
  await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "elders", message: "长辈版" } });
  await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "friends", message: "朋友版" } });
  const g1 = await addGuest(db, eventId, "张先生全家", "elders");
  const g2 = await addGuest(db, eventId, "王老师一家", "elders");
  const g3 = await addGuest(db, eventId, "李女士", "friends");
  const g4 = await addGuest(db, eventId, "陈总", "clients_vip"); // no variant saved

  const staged = { photo: { assetId: await stagePhoto(media, A.uid) } };
  const r = await distributeInvitations({
    db, decoded: A, media, share, giftCollection: GIFT_COLLECTION,
    body: { eventId, guestIds: [g1, g2, g3, g4], stagedPresentation: staged, musicThemeId: null },
  });
  assert.equal(r.status, 200);
  const by = Object.fromEntries(r.body.results.map((x) => [x.guestId, x]));
  assert.equal(by[g1].status, "created");
  assert.equal(by[g2].status, "created");
  assert.equal(by[g3].status, "created");
  assert.equal(by[g4].status, "failed");
  assert.equal(by[g4].error, "missing_variant");
  // messages by relationship; audienceType per row
  const rec1 = db._store.get(`${GIFT_COLLECTION}/${by[g1].giftId}`);
  const rec3 = db._store.get(`${GIFT_COLLECTION}/${by[g3].giftId}`);
  assert.equal(rec1.message, "长辈版");
  assert.equal(rec3.message, "朋友版");
  assert.equal(rec1.occasion.audienceType, "elders");
  assert.equal(rec3.occasion.audienceType, "friends");
  assert.equal(rec1.recipientLabel, "张先生全家");
  // presentation: row1 consumed staging; rows 2-3 copied from row1
  const assetId = staged.photo.assetId;
  assert.ok(media._objects.has(`sealed/${by[g1].giftId}/${assetId}`));
  assert.ok(media._objects.has(`sealed/${by[g2].giftId}/${assetId}`));
  assert.ok(media._objects.has(`sealed/${by[g3].giftId}/${assetId}`));
  assert.equal([...media._objects.keys()].filter((k) => k.startsWith("staging/")).length, 0);
  assert.equal(r.body.sourceGiftId, by[g1].giftId);
  // links written — idempotency anchors
  assert.equal(db._store.get(`${GUEST_COLLECTION}/${g1}`).invitationGiftId, by[g1].giftId);

  // retry: everything already → no duplicates
  const again = await distributeInvitations({
    db, decoded: A, media, share, giftCollection: GIFT_COLLECTION,
    body: { eventId, guestIds: [g1, g2, g3], sourceGiftId: r.body.sourceGiftId },
  });
  assert.deepEqual(again.body.results.map((x) => x.status), ["already", "already", "already"]);
  const invs = [...db._store.keys()].filter((k) => k.startsWith(`${GIFT_COLLECTION}/`));
  assert.equal(invs.length, 3);
});

test("distribute: self-heal relinks same-label unclaimed invitation instead of duplicating", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const eventId = await mkEvent(db);
  await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "elders", message: "长辈版" } });
  // an earlier interrupted run created the invitation but never linked it
  const orphan = await createGift({ db, decoded: A, share, body: { message: "长辈版", occasion: FACTS, eventId, recipientLabel: "赵家" } });
  const g = await addGuest(db, eventId, "赵家", "elders");
  const r = await distributeInvitations({
    db, decoded: A, share, giftCollection: GIFT_COLLECTION,
    body: { eventId, guestIds: [g] },
  });
  assert.equal(r.body.results[0].status, "relinked");
  assert.equal(r.body.results[0].giftId, orphan.body.giftId);
  assert.equal([...db._store.keys()].filter((k) => k.startsWith(`${GIFT_COLLECTION}/`)).length, 1);
});

test("distribute: batch cap, ownership, event status guards", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const eventId = await mkEvent(db);
  const cap = await distributeInvitations({
    db, decoded: A, share, giftCollection: GIFT_COLLECTION,
    body: { eventId, guestIds: Array.from({ length: 21 }, (_, i) => `g${i}`) },
  });
  assert.equal(cap.body.error, "batch_too_large");
  const otherEvent = await mkEvent(db, B);
  const gB = await addGuest(db, otherEvent, "别家", "elders", {}, B);
  const cross = await distributeInvitations({
    db, decoded: A, share, giftCollection: GIFT_COLLECTION,
    body: { eventId: otherEvent, guestIds: [gB] },
  });
  assert.equal(cross.status, 403);
});

test("event detail: guests with tiers + masked phone + variants; phone never full", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const eventId = await mkEvent(db);
  await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "elders", message: "长辈版" } });
  const g1 = await addGuest(db, eventId, "张先生全家", "elders", { phone: "13812341234" });
  const g2 = await addGuest(db, eventId, "李女士", "friends", { phone: "13987654321" });
  const r = await distributeInvitations({ db, decoded: A, share, giftCollection: GIFT_COLLECTION, body: { eventId, guestIds: [g1] } });
  const { rsvpGift } = await import("./gift.mjs");
  const inv = r.body.results[0];
  await rsvpGift({ db, body: { token: inv.token, status: "accepted", adultCount: 2, childCount: 1 } });
  const det = await eventDetail({ db, decoded: A, body: { eventId }, giftCollection: GIFT_COLLECTION });
  const s = JSON.stringify(det.body);
  assert.equal(s.includes("13812341234"), false); // full phone NEVER leaves
  assert.equal(s.includes("13987654321"), false);
  const gz = Object.fromEntries(det.body.guests.map((g) => [g.guestId, g]));
  assert.equal(gz[g1].phoneMasked, "138****1234");
  assert.equal(gz[g1].tier, "accepted");
  assert.equal(gz[g2].tier, "unsent");
  assert.equal(det.body.event.variants.elders.message, "长辈版");
});

test("recipient path: distributed invitation opens with variant + label; retrieve leak-free", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const eventId = await mkEvent(db);
  await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "elders", message: "长辈版文案" } });
  const g = await addGuest(db, eventId, "张先生全家", "elders", { phone: "13812341234" });
  const r = await distributeInvitations({ db, decoded: A, share, giftCollection: GIFT_COLLECTION, body: { eventId, guestIds: [g] } });
  const ret = await retrieveGift({ db, body: { token: r.body.results[0].token } });
  assert.equal(ret.status, 200);
  assert.equal(ret.body.message, "长辈版文案");
  assert.equal(ret.body.recipientLabel, "张先生全家");
  assert.equal(ret.body.occasion.audienceType, "elders");
  assert.equal(JSON.stringify(ret.body).includes("138"), false); // phone never recipient-visible
});
