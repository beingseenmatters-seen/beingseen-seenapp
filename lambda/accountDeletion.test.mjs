/**
 * Product-scoped account deletion — proves the core rule with data:
 * shared login identity, independent product accounts, independent deletion.
 * The handlers cannot even RECEIVE a Firebase Admin auth handle (structural
 * safeguard) — asserted below by signature inspection.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { deleteGiftAccount, deleteMomentAccount } from "./accountDeletion.mjs";
import { handleTagManage, handleTagScan } from "./tag.mjs";

const A = { uid: "user-a" };
const B = { uid: "user-b" };
const ADMIN = { uid: "founder-1", email: "beingseenmatters@gmail.com", email_verified: true, master_admin: true };
const fakeShare = () => ({ seal: async (t) => `sealed:${t}`, open: async (x) => String(x).replace(/^sealed:/, "") });

function makeFakeDb() {
  const store = new Map();
  const doc = (path) => ({
    _key: path,
    get: async () => ({ exists: store.has(path), data: () => store.get(path), id: path.split("/").pop() }),
    create: async (v) => { if (store.has(path)) { const e = new Error("6 ALREADY_EXISTS"); e.code = 6; throw e; } store.set(path, v); },
    set: async (v) => { store.set(path, v); },
    update: async (v) => { store.set(path, { ...store.get(path), ...v }); },
    delete: async () => { store.delete(path); },
  });
  const collection = (name) => ({
    doc: (id) => doc(`${name}/${id}`),
    where: (field, _op, value) => ({
      get: async () => ({ docs: [...store.entries()].filter(([k, v]) => k.startsWith(`${name}/`) && v[field] === value).map(([k, v]) => ({ id: k.slice(name.length + 1), data: () => v })) }),
    }),
    get: async () => ({ docs: [...store.entries()].filter(([k]) => k.startsWith(`${name}/`)).map(([k, v]) => ({ id: k.split("/").pop(), data: () => v })) }),
  });
  const runTransaction = async (fn) => {
    const writes = [];
    const tx = {
      get: async (ref) => ({ exists: store.has(ref._key), data: () => store.get(ref._key) }),
      update: (ref, patch) => void writes.push(() => store.set(ref._key, { ...store.get(ref._key), ...patch })),
      set: (ref, v) => void writes.push(() => store.set(ref._key, { ...v })),
    };
    const out = await fn(tx);
    writes.forEach((w) => w());
    return out;
  };
  return { collection, runTransaction, _store: store };
}

/** Seed one user's full Gift.Seen footprint directly (unit fixture). */
function seedGiftWorld(db, uid, prefix) {
  const S = db._store;
  S.set(`giftMessages/${prefix}-gift`, { senderUid: uid, sealedAssets: [], eventId: null });
  S.set(`sharedRsvp/${prefix}-gift_p1`, { giftId: `${prefix}-gift`, response: "yes" });
  S.set(`events/${prefix}-event`, { senderUid: uid, eventId: `${prefix}-event` });
  S.set(`eventGuests/${prefix}-g1`, { eventId: `${prefix}-event`, label: "阿姨一家" });
  S.set(`eventGuestbook/${prefix}-b1`, { eventId: `${prefix}-event`, text: "祝福" });
  S.set(`eventDrawEntrants/${prefix}-e1`, { eventId: `${prefix}-event`, luckyCode: "888" });
  S.set(`eventDraw/${prefix}-event`, { eventId: `${prefix}-event`, winners: [] });
  S.set(`sharedRsvp/${prefix}-ev_p2`, { eventId: `${prefix}-event`, response: "yes" });
  S.set(`liveSessions/${prefix}-event`, { ownerUid: uid, sessionId: `${prefix}-event` });
  S.set(`tagEvents/${prefix}-evt1`, { recipientUid: uid, eventType: "TAG_MESSAGE_SENT" });
}

const M = (db, body, decoded, now = 1000) => handleTagManage({ db, decoded, body, share: fakeShare(), publicBaseUrl: "https://x", now });
const S = (db, body, now = 1000) => handleTagScan({ db, body, share: fakeShare(), publicBaseUrl: "https://x", sourceIp: "9.9.9.9", now });

test("STRUCTURAL: deletion handlers cannot receive a Firebase Admin auth handle", () => {
  // No `auth` in either signature and no deleteUser anywhere in the module.
  assert.equal(/\bauth\b/.test(String(deleteGiftAccount).slice(0, 200)), false);
  assert.equal(/\bauth\b/.test(String(deleteMomentAccount).slice(0, 200)), false);
  assert.equal(/deleteUser|disableUser/.test(String(deleteGiftAccount) + String(deleteMomentAccount)), false);
});

test("gift deletion removes ONLY the caller's Gift.Seen world — the other user's survives byte-for-byte", async () => {
  const db = makeFakeDb();
  seedGiftWorld(db, A.uid, "a");
  seedGiftWorld(db, B.uid, "b");
  const bBefore = JSON.stringify([...db._store.entries()].filter(([k]) => k.includes("/b-")));
  const media = { calls: [], async deleteSealed() { /* not used by fixture (no assets) */ } };
  const res = await deleteGiftAccount({ db, decoded: A, media, now: 5000 });
  assert.equal(res.status, 200);
  const d = res.body.deleted;
  assert.deepEqual(
    [d.gifts, d.sharedRsvps, d.events, d.eventGuests, d.guestbook, d.drawEntrants, d.draws, d.liveSessions, d.tagEvents],
    [1, 2, 1, 1, 1, 1, 1, 1, 1],
  );
  // A's world is gone…
  assert.equal([...db._store.keys()].filter((k) => k.includes("/a-")).length, 0);
  // …and B's is untouched, byte-for-byte.
  assert.equal(JSON.stringify([...db._store.entries()].filter(([k]) => k.includes("/b-"))), bBefore);
});

test("tags: self-print dies; pre-manufactured DETACHES to a re-activatable factory shell; inbox purged", async () => {
  const db = makeFakeDb();
  // self-print tag (create action = born active, no provision field)
  const sp = await M(db, { action: "create", type: "car", ownerMessage: "请挪车", locale: "zh" }, A);
  // pre-manufactured tag activated by A, with a finder contact + photo
  await M(db, { action: "provision", type: "pet", code: "DELTEST001" }, ADMIN);
  const act = await M(db, { action: "activate", token: "DELTEST001" }, A);
  await M(db, { action: "update", tagId: act.body.tagId, profile: { name: "Coco" } }, A);
  await S(db, { op: "contact", token: "DELTEST001", reason: "found", idempotencyKey: "idem-del-1", scannerToken: "scanner-token-000001", photo: "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==" });
  // B's own tag must survive
  const bTag = await M(db, { action: "create", type: "pet", profile: { name: "旺财" }, locale: "zh" }, B);

  const res = await deleteGiftAccount({ db, decoded: A, media: null, now: 9000 });
  assert.equal(res.body.deleted.tagsDeleted, 1);
  assert.equal(res.body.deleted.tagsDetached, 1);
  assert.equal(res.body.deleted.tagContacts, 1);
  // self-print token now resolves to nothing (honest not-found)
  assert.equal((await S(db, { op: "resolve", token: sp.body.token }, 99999999)).status, 404);
  // pre-manufactured code is back to the unactivated shell — and a NEW owner can claim it
  const shell = await S(db, { op: "resolve", token: "DELTEST001" }, 99999999);
  assert.deepEqual(shell.body, { status: "unactivated", type: "pet" });
  const reclaim = await M(db, { action: "activate", token: "DELTEST001", locale: "zh" }, B, 10000);
  assert.equal(reclaim.status, 200);
  assert.equal(reclaim.body.already, false);
  // no trace of A on the reclaimed tag; contact photo store empty
  const tagDoc = db._store.get(`tags/${act.body.tagId}`);
  assert.equal(JSON.stringify(tagDoc).includes(A.uid), false);
  assert.equal([...db._store.keys()].filter((k) => k.startsWith("tagContactPhotos/")).length, 0);
  // B's tag untouched
  assert.equal(db._store.get(`tags/${bTag.body.tagId}`).ownerUid, B.uid);
});

test("gift deletion purges sealed media through the existing revoke-grade helper", async () => {
  const db = makeFakeDb();
  db._store.set("giftMessages/tok-1", { senderUid: A.uid, presentation: {}, sealedAssets: undefined, openingMedia: null });
  // sealedAssetIds derives from the record shape; emulate one asset via the
  // legacy field it reads (photoAssetId path) — keep it simple: presentation
  // with photos referencing asset ids.
  db._store.set("giftMessages/tok-2", { senderUid: A.uid, presentation: { photos: [{ assetId: "as_1" }] } });
  const calls = [];
  const media = { async deleteSealed({ tokenHash, assetId }) { calls.push(`${tokenHash}:${assetId}`); } };
  const res = await deleteGiftAccount({ db, decoded: A, media, now: 1 });
  assert.equal(res.body.deleted.gifts, 2);
  assert.ok(calls.includes("tok-2:as_1"));
});

test("idempotent + unauthorized + product isolation of the moment handler", async () => {
  const db = makeFakeDb();
  seedGiftWorld(db, A.uid, "a");
  assert.equal((await deleteGiftAccount({ db, decoded: null })).status, 401);
  assert.equal((await deleteMomentAccount({ db, decoded: null })).status, 401);
  const first = await deleteGiftAccount({ db, decoded: A });
  assert.equal(first.body.deleted.gifts, 1);
  const again = await deleteGiftAccount({ db, decoded: A });
  assert.equal(again.status, 200);
  assert.equal(again.body.deleted.gifts, 0); // repeat is a clean no-op
  // Moment deletion touches NOTHING in the store (local-first product).
  seedGiftWorld(db, B.uid, "b");
  const size = db._store.size;
  const m = await deleteMomentAccount({ db, decoded: B });
  assert.equal(m.status, 200);
  assert.equal(m.body.product, "moment");
  assert.equal(db._store.size, size);
});

test("mind* and tagCodes collections are NEVER touched (out of scope / retained ledger)", async () => {
  const db = makeFakeDb();
  db._store.set("mindEntries/m1", { ownerUid: A.uid, text: "..." });
  db._store.set("mindMembers/mm1", { uid: A.uid });
  db._store.set("tagCodes/hashhash", { tagId: "tg_x", batchId: "tb_x", createdAt: 1 });
  db._store.set("tagBatches/tb_x", { batchId: "tb_x", createdBy: A.uid, quantity: 10 });
  await deleteGiftAccount({ db, decoded: A });
  assert.ok(db._store.has("mindEntries/m1"));
  assert.ok(db._store.has("mindMembers/mm1"));
  assert.ok(db._store.has("tagCodes/hashhash"));
  assert.equal(db._store.get("tagBatches/tb_x").createdBy, "deleted-account"); // anonymized, retained
});
