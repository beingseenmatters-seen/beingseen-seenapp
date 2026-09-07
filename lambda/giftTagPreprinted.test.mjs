/**
 * Official PREPRINTED unique-QR Gift.Tag (founder-locked 2026-09-05), through
 * the REAL handlers (provision/export/scan → grant → free pending publish →
 * 100-Credit atomic activation → bound reveal).
 *
 * LOCKED invariants under test:
 *   · ONE physical card = max ONE activation = max ONE 100 = max ONE Gift,
 *     for the card's LIFETIME (withdrawn Gift leaves it consumed).
 *   · the customer never pays 50 + 100: preprinted publication is 0 here and
 *     the pending record is publicly UNUSABLE until activation binds it.
 *   · self-print Gift.Tag stays a separate 50-Credit product; no client
 *     field can select the cheaper path (grants are server-derived).
 *   · pet/car/luggage lifecycles and the admin plane are untouched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeDb } from "./billing.test.mjs";
import { CREDIT_ACCOUNTS, CREDIT_LEDGER, CHARGEABLE_PRODUCTS } from "./billing.mjs";
import { handleTagManage, handleTagScan, TAG_COLLECTION, TAG_TYPES } from "./tag.mjs";
import { createGift, retrieveGift, mintTagPublishGrant, GIFT_COLLECTION } from "./gift.mjs";

const ADMIN = { uid: "admin-1", master_admin: true };
const USER = { uid: "sender-1" };
const OTHER = { uid: "sender-2" };
const NOW = Date.UTC(2026, 8, 5, 12, 0, 0);
const PUB = "https://gift.beingseenmatters.com";

const fakeShare = () => ({
  seal: async (t, ctx) => `S|${ctx}|${t}`,
  open: async (sealed, ctx) => {
    const [tag, c, t] = String(sealed).split("|");
    if (tag !== "S" || c !== ctx) throw new Error("context_mismatch");
    return t;
  },
});

const seedAccount = (db, uid, { free = 200, paid = 0 } = {}) =>
  db._store.set(`${CREDIT_ACCOUNTS}/${uid}`, {
    schemaVersion: 1, free, paid, freeTopUpAt: NOW, createdAt: NOW, updatedAt: NOW, version: 1,
  });
const charges = (db, uid) =>
  [...db._store.entries()].filter(([k]) => k.startsWith(`${CREDIT_LEDGER}/charge_gift_${uid}_`)).map(([, v]) => v);
const account = (db, uid) => db._store.get(`${CREDIT_ACCOUNTS}/${uid}`);

const M = (db, body, decoded = ADMIN) =>
  handleTagManage({ db, decoded, body, share: fakeShare(), publicBaseUrl: PUB, scanBaseUrl: PUB, now: NOW });
const S = (db, body) => handleTagScan({ db, body, share: fakeShare(), publicBaseUrl: PUB, now: NOW });

/** Full customer journey up to (not including) activation. */
async function provisionOne(db) {
  const r = await M(db, { action: "provision", type: "gift", count: 1 });
  assert.equal(r.status, 200);
  return { code: r.body.tags[0].code, tagId: r.body.tags[0].tagId, batchId: r.body.batchId };
}
async function pendingGiftFor(db, code, decoded = USER, opts = {}) {
  const g = await mintTagPublishGrant({ db, decoded, body: { tagCode: code }, now: NOW });
  assert.equal(g.status, 200);
  assert.equal(g.body.preprinted, true);
  const res = await createGift({
    db, decoded, now: NOW, share: fakeShare(),
    body: {
      message: "这份心意随卡送到你手上。", accessMode: opts.accessMode ?? "direct",
      ...(opts.retrievalKey ? { retrievalKey: opts.retrievalKey } : {}),
      idempotencyKey: opts.idem ?? `ppub${decoded.uid.slice(-1)}0000000001`,
      tagPublishGrant: g.body.grant,
    },
  });
  assert.equal(res.status, 200);
  return { token: res.body.token, giftId: res.body.token ? hash64(db, res.body.token) : null };
}
// The publish response has the raw token; the record id is its sha256 — find
// it in the store instead of re-hashing (keeps the test free of crypto).
function hash64(db, token) {
  for (const [k, v] of db._store.entries()) {
    if (k.startsWith(`${GIFT_COLLECTION}/`) && v.senderUid && !v.eventId) {
      // token never stored; match via sealed copy (S|<hash>|<token>).
      if (String(v.shareTokenSealed ?? "").endsWith(`|${token}`)) return k.split("/")[1];
    }
  }
  throw new Error("gift record not found for token");
}

// --- provisioning / export ---------------------------------------------------

test("provision GIFT batch: 18-char high-entropy codes (~89 bits), atomic uniqueness, export validates", async () => {
  const db = makeFakeDb();
  const r = await M(db, { action: "provision", type: "gift", count: 5 });
  assert.equal(r.status, 200);
  assert.equal(r.body.tags.length, 5);
  const codes = r.body.tags.map((t) => t.code);
  for (const c of codes) {
    assert.equal(c.length, 18, "preprinted Gift.Tag codes are 18 chars");
    assert.match(c, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{18}$/, "unambiguous print alphabet");
  }
  assert.equal(new Set(codes).size, 5, "all codes distinct");
  // Personal-tag codes stay 10 chars — backward compatible, no migration.
  const pet = await M(db, { action: "provision", type: "pet", count: 1 });
  assert.equal(pet.body.tags[0].code.length, 10);
  // Factory export works for the gift batch and carries the canonical rows.
  const exp = await M(db, { action: "export_batch", batchId: r.body.batchId });
  assert.equal(exp.status, 200);
  assert.equal(exp.body.rows.length, 5);
  assert.equal(exp.body.rows[0].tagType, "GIFT");
  assert.ok(exp.body.rows.every((row) => row.qrUrl === `${PUB}/t/${row.publicTagId}`));
});

test("non-master-admin provisioning is rejected; the admin plane is claim-only", async () => {
  const db = makeFakeDb();
  const r = await M(db, { action: "provision", type: "gift", count: 1 }, USER);
  assert.equal(r.status, 403);
});

// --- scan states -------------------------------------------------------------

test("unused official card scans to the activation intro; a fake QR resolves not_found", async () => {
  const db = makeFakeDb();
  const { code } = await provisionOne(db);
  const r = await S(db, { op: "resolve", token: code });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { status: "unactivated", type: "gift" });
  // Visually perfect counterfeit with a code the server never minted:
  assert.equal((await S(db, { op: "resolve", token: "FAKEFAKEFAKEFAKE22" })).status, 404);
});

// --- the one commercial transaction ------------------------------------------

test("first activation: publication free + activation exactly 100 — never 50+100; retrieve gated until bound", async () => {
  const db = makeFakeDb();
  seedAccount(db, USER.uid, { free: 200, paid: 0 });
  const { code, tagId } = await provisionOne(db);
  const { token, giftId } = await pendingGiftFor(db, code);

  // The free pending publication is publicly UNUSABLE (no standalone free gift).
  assert.equal(charges(db, USER.uid).length, 0, "publication itself charged nothing");
  assert.equal((await retrieveGift({ db, body: { token }, now: NOW })).status, 404);

  const act = await M(db, { action: "gift_activate", token: code, giftId }, USER);
  assert.equal(act.status, 200);
  assert.equal(act.body.charged, true);
  const led = charges(db, USER.uid);
  assert.equal(led.length, 1, "exactly ONE charge for the whole journey");
  assert.equal(led[0].product, "preprinted_gift_tag_activation");
  assert.equal(led[0].amount, 100);
  assert.equal(account(db, USER.uid).free, 100);
  assert.ok(db._store.has(`${CREDIT_LEDGER}/charge_gift_${USER.uid}_tagact_${tagId}`), "deterministic per-card identity");

  // Tag bound + consumed; gift live.
  const tag = db._store.get(`${TAG_COLLECTION}/${tagId}`);
  assert.equal(tag.status, "active");
  assert.equal(tag.ownerUid, USER.uid);
  assert.equal(tag.boundGiftId, giftId);
  assert.equal(db._store.get(`${GIFT_COLLECTION}/${giftId}`).pendingTagBind, false);

  // Activated card scans open the bound Gift; scan + retrieve charge 0.
  const scan = await S(db, { op: "resolve", token: code });
  assert.equal(scan.body.status, "gift_bound");
  assert.equal(scan.body.giftToken, token);
  assert.equal((await retrieveGift({ db, body: { token }, now: NOW })).status, 200);
  assert.equal(charges(db, USER.uid).length, 1, "scans and opens stay free");
});

test("Heart Key mode: same 100, key still guards the reveal", async () => {
  const db = makeFakeDb();
  seedAccount(db, USER.uid, { free: 200, paid: 0 });
  const { code } = await provisionOne(db);
  const { token, giftId } = await pendingGiftFor(db, code, USER, { accessMode: "heart_key", retrievalKey: "394857", idem: "pphk000000000001" });
  const act = await M(db, { action: "gift_activate", token: code, giftId }, USER);
  assert.equal(act.status, 200);
  assert.equal(charges(db, USER.uid)[0].amount, 100);
  const wrong = await retrieveGift({ db, body: { token, key: "111111" }, now: NOW });
  assert.notEqual(wrong.status, 200);
  assert.equal((await retrieveGift({ db, body: { token, key: "394857" }, now: NOW })).status, 200);
});

test("retry + concurrent same-user activation: ONE charge, ONE binding (deterministic tagact identity)", async () => {
  const db = makeFakeDb();
  seedAccount(db, USER.uid, { free: 500, paid: 0 });
  const { code, tagId } = await provisionOne(db);
  const { giftId } = await pendingGiftFor(db, code);
  const [a, b] = await Promise.all([
    M(db, { action: "gift_activate", token: code, giftId }, USER),
    M(db, { action: "gift_activate", token: code, giftId }, USER),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(charges(db, USER.uid).length, 1);
  assert.equal(account(db, USER.uid).free, 400);
  const again = await M(db, { action: "gift_activate", token: code, giftId }, USER);
  assert.equal(again.status, 200); // idempotent echo for the winner
  assert.equal(charges(db, USER.uid).length, 1);
  assert.equal(db._store.get(`${TAG_COLLECTION}/${tagId}`).boundGiftId, giftId);
});

test("different-user race on one card: exactly one wins; the loser pays 0 and binds nothing", async () => {
  const db = makeFakeDb();
  seedAccount(db, USER.uid, { free: 200, paid: 0 });
  seedAccount(db, OTHER.uid, { free: 200, paid: 0 });
  const { code, tagId } = await provisionOne(db);
  const a = await pendingGiftFor(db, code, USER, { idem: "ppraceA000000001" });
  const b = await pendingGiftFor(db, code, OTHER, { idem: "ppraceB000000001" });
  const [ra, rb] = await Promise.all([
    M(db, { action: "gift_activate", token: code, giftId: a.giftId }, USER),
    M(db, { action: "gift_activate", token: code, giftId: b.giftId }, OTHER),
  ]);
  const results = [ra, rb];
  assert.equal(results.filter((r) => r.status === 200).length, 1, "exactly one winner");
  assert.equal(results.filter((r) => r.status === 409 && r.body.error === "already_activated").length, 1);
  const totalCharges = charges(db, USER.uid).length + charges(db, OTHER.uid).length;
  assert.equal(totalCharges, 1, "the loser was never charged");
  const tag = db._store.get(`${TAG_COLLECTION}/${tagId}`);
  assert.ok([a.giftId, b.giftId].includes(tag.boundGiftId));
  // The loser's pending gift stays publicly dead (never a free publication).
  const loser = ra.status === 200 ? b : a;
  assert.equal((await retrieveGift({ db, body: { token: loser.token }, now: NOW })).status, 404);
});

test("insufficient balance refuses activation with zero writes; the card stays activatable", async () => {
  const db = makeFakeDb();
  seedAccount(db, USER.uid, { free: 50, paid: 0 });
  const { code, tagId } = await provisionOne(db);
  const { giftId } = await pendingGiftFor(db, code);
  const act = await M(db, { action: "gift_activate", token: code, giftId }, USER);
  assert.equal(act.status, 402);
  assert.equal(act.body.needed, 100);
  assert.equal(charges(db, USER.uid).length, 0);
  assert.equal(db._store.get(`${TAG_COLLECTION}/${tagId}`).status, "unactivated");
});

// --- consumed forever --------------------------------------------------------

test("an activated card can NEVER be activated again — not by another user, not by its owner with a new gift", async () => {
  const db = makeFakeDb();
  seedAccount(db, USER.uid, { free: 500, paid: 0 });
  seedAccount(db, OTHER.uid, { free: 500, paid: 0 });
  const { code } = await provisionOne(db);
  const first = await pendingGiftFor(db, code, USER, { idem: "ppfirst000000001" });
  await M(db, { action: "gift_activate", token: code, giftId: first.giftId }, USER);

  // Another user cannot even mint a preprinted grant against it any more.
  const g2 = await mintTagPublishGrant({ db, decoded: OTHER, body: { tagCode: code }, now: NOW });
  assert.equal(g2.status, 409);

  // The owner trying to rebind a fresh gift is refused too (no reset).
  const own2 = await mintTagPublishGrant({ db, decoded: USER, body: { tagCode: code }, now: NOW });
  assert.equal(own2.status, 409);
  assert.equal(charges(db, USER.uid).length, 1);
});

test("withdrawn Gift leaves the card CONSUMED: honest unavailable scan, never back to inventory", async () => {
  const db = makeFakeDb();
  seedAccount(db, USER.uid, { free: 200, paid: 0 });
  const { code, tagId } = await provisionOne(db);
  const { giftId } = await pendingGiftFor(db, code);
  await M(db, { action: "gift_activate", token: code, giftId }, USER);
  // Sender withdraws the Gift.
  db._store.set(`${GIFT_COLLECTION}/${giftId}`, { ...db._store.get(`${GIFT_COLLECTION}/${giftId}`), revoked: true });
  const scan = await S(db, { op: "resolve", token: code });
  assert.equal(scan.body.status, "gift_withdrawn");
  const tag = db._store.get(`${TAG_COLLECTION}/${tagId}`);
  assert.equal(tag.status, "active"); // consumed — NOT unactivated inventory
  assert.equal(tag.boundGiftId, giftId);
  // And a new activation attempt against it still refuses.
  assert.equal((await mintTagPublishGrant({ db, decoded: USER, body: { tagCode: code }, now: NOW })).status, 409);
});

// --- product separation ------------------------------------------------------

test("self-generated Gift.Tag stays its own 50-Credit product; client fields cannot pick the cheaper path", async () => {
  const db = makeFakeDb();
  seedAccount(db, USER.uid, { free: 200, paid: 0 });
  // A grant WITHOUT an official card = the normal self-print lane.
  const g = await mintTagPublishGrant({ db, decoded: USER, body: { preprinted: true, official: true }, now: NOW });
  assert.equal(g.status, 200);
  assert.equal(g.body.preprinted, undefined); // client claims meant nothing
  const res = await createGift({
    db, decoded: USER, now: NOW, share: fakeShare(),
    body: {
      message: "自打印标签。", accessMode: "direct", idempotencyKey: "selfgen500000001",
      tagPublishGrant: g.body.grant, type: "preprinted", product: "preprinted_gift_tag_activation", credits: 0,
    },
  });
  assert.equal(res.status, 200);
  const led = charges(db, USER.uid);
  assert.equal(led.length, 1);
  assert.equal(led[0].product, "gift_tag_publish");
  assert.equal(led[0].amount, 50);
  // A forged tagCode that is NOT an official gift card mints nothing preprinted.
  assert.equal((await mintTagPublishGrant({ db, decoded: USER, body: { tagCode: "NOSUCHCARD12345678" }, now: NOW })).status, 404);
});

test("the generic free personal-tag claim refuses gift cards (wrong_flow) — no unpaid side door", async () => {
  const db = makeFakeDb();
  const { code } = await provisionOne(db);
  const r = await M(db, { action: "activate", token: code }, USER);
  assert.equal(r.status, 400);
  assert.equal(r.body.error, "wrong_flow");
});

test("pet/car/luggage remain untouched: registry has no annual fee, personal activation stays free", async () => {
  const db = makeFakeDb();
  // Annual AU$ services never entered the Credits registry.
  for (const p of Object.keys(CHARGEABLE_PRODUCTS)) {
    assert.ok(!/^(pet|car|luggage)/.test(p), p);
  }
  assert.deepEqual(Object.keys(TAG_TYPES).sort(), ["car", "gift", "luggage", "pet"]);
  // A pet card still activates through the free personal claim.
  const prov = await M(db, { action: "provision", type: "pet", count: 1 });
  const act = await M(db, { action: "activate", token: prov.body.tags[0].code }, USER);
  assert.equal(act.status, 200);
  assert.equal(charges(db, USER.uid).length, 0);
});
