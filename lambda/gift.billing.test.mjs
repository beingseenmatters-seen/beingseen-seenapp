/**
 * Simple Gift 20-Credit publication — integration through the REAL
 * createGift/retrieveGift handlers (Monetisation Phase 2).
 *
 * Proves the four product-owner-directed facts:
 *   A. a free reply is granted ONLY by server-issued authorization minted at
 *      /gift/retrieve — forged/arbitrary replyToGiftId NEVER bypasses billing;
 *   B. retry returns the ORIGINAL gift while credentials stay crypto-random
 *      (recovered from KMS seals, never derived from the idempotency key);
 *   C. charge + gift + intent commit atomically;
 *   D. a committed publish whose response was lost is returned VERBATIM on
 *      retry — no second gift, no second charge, no dead-end duplicate error.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeDb } from "./billing.test.mjs";
import { CREDIT_ACCOUNTS, CREDIT_LEDGER } from "./billing.mjs";
import {
  createGift,
  retrieveGift,
  mintTagPublishGrant,
  TAG_PUBLISH_AUTH_COLLECTION,
  GIFT_COLLECTION,
  GIFT_PUBLISH_INTENTS_COLLECTION,
  sha256Hex,
} from "./gift.mjs";

const SENDER = { uid: "sender-1" };
const RECIPIENT = { uid: "recipient-1" };
const NOW = Date.UTC(2026, 8, 3, 12, 0, 0);

/** Context-checking KMS stand-in: same contract as makeKmsShareCrypto. */
const fakeShare = () => ({
  seal: async (t, ctx) => `S|${ctx}|${t}`,
  open: async (sealed, ctx) => {
    const [tag, c, t] = String(sealed).split("|");
    if (tag !== "S" || c !== ctx) throw new Error("context_mismatch");
    return t;
  },
});

const KEY = (s) => `key_${s}_00000000`.slice(0, 20);
const giftDocs = (db) => [...db._store.keys()].filter((k) => k.startsWith(`${GIFT_COLLECTION}/`));
const chargeDocs = (db) =>
  [...db._store.keys()].filter((k) => k.startsWith(`${CREDIT_LEDGER}/charge_`));

async function publish(db, share, decoded, body) {
  return await createGift({ db, decoded, body, now: NOW, media: null, share });
}

// ---- charge + publish (atomic, priced server-side) -------------------------

test("publish: billing-aware simple gift charges 20 and returns balances", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const res = await publish(db, share, SENDER, {
    message: "hello",
    accessMode: "direct",
    idempotencyKey: KEY("pub1"),
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.balances, { free: 180, paid: 0 });
  assert.equal(giftDocs(db).length, 1);
  assert.equal(chargeDocs(db).length, 1);
  assert.ok(db._store.has(`${GIFT_PUBLISH_INTENTS_COLLECTION}/${SENDER.uid}_${KEY("pub1")}`));
  const entry = db._store.get(`${CREDIT_LEDGER}/charge_gift_${SENDER.uid}_${KEY("pub1")}`);
  assert.equal(entry.amount, 20);
  assert.equal(entry.meta.tokenHash, giftDocs(db)[0].split("/").pop());
  // client-sent price/product fields can never matter — they aren't read.
});

test("publish: token is NOT derived from the idempotency key (entropy preserved)", async () => {
  const dbA = makeFakeDb();
  const dbB = makeFakeDb();
  const share = fakeShare();
  const a = await publish(dbA, share, SENDER, { message: "m", accessMode: "direct", idempotencyKey: KEY("ent") });
  const b = await publish(dbB, share, SENDER, { message: "m", accessMode: "direct", idempotencyKey: KEY("ent") });
  assert.notEqual(a.body.token, b.body.token, "same uid+key on fresh state → different random tokens");
});

test("publish: heart_key gift seals a recoverable key copy, key stays random", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const res = await publish(db, share, SENDER, {
    message: "hello",
    accessMode: "heart_key",
    idempotencyKey: KEY("hk1"),
  });
  assert.match(res.body.retrievalKey, /^\d{6}$/);
  const rec = db._store.get(giftDocs(db)[0]);
  const tokenHash = giftDocs(db)[0].split("/").pop();
  assert.ok(rec.retrievalKeySealed, "generated Heart Key sealed for retry recovery");
  assert.equal(await share.open(rec.retrievalKeySealed, `${tokenHash}#rk`), res.body.retrievalKey);
  // Outside the sealed fields (whose plaintext embedding is a FAKE-KMS
  // artifact — real KMS returns opaque ciphertext), nothing may leak.
  const { shareTokenSealed: _s, retrievalKeySealed: _k, ...plain } = rec;
  assert.ok(!JSON.stringify(plain).includes(res.body.retrievalKey), "plaintext key never persisted");
  assert.ok(!JSON.stringify(plain).includes(res.body.token), "raw token never persisted");
});

// ---- B/D. retry returns the ORIGINAL outcome -------------------------------

test("retry: same idempotency key → original token/key/url, one gift, one charge", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const body = { message: "hello", accessMode: "heart_key", idempotencyKey: KEY("rt1") };
  const first = await publish(db, share, SENDER, body);
  const again = await publish(db, share, SENDER, body);
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.token, first.body.token, "ORIGINAL token returned");
  assert.equal(again.body.url, first.body.url);
  assert.equal(again.body.retrievalKey, first.body.retrievalKey, "ORIGINAL Heart Key returned");
  assert.equal(giftDocs(db).length, 1, "no second gift");
  assert.equal(chargeDocs(db).length, 1, "no second charge");
  assert.equal(db._store.get(`${CREDIT_ACCOUNTS}/${SENDER.uid}`).free, 180);
});

test("retry: different keys are different publications (two gifts, 160 left)", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  await publish(db, share, SENDER, { message: "a", accessMode: "direct", idempotencyKey: KEY("d1") });
  await publish(db, share, SENDER, { message: "b", accessMode: "direct", idempotencyKey: KEY("d2") });
  assert.equal(giftDocs(db).length, 2);
  assert.equal(db._store.get(`${CREDIT_ACCOUNTS}/${SENDER.uid}`).free, 160);
});

test("retry without KMS share available → honest already_published, never a dup", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const body = { message: "hello", accessMode: "direct", idempotencyKey: KEY("nokms") };
  await publish(db, share, SENDER, body);
  const retry = await createGift({ db, decoded: SENDER, body, now: NOW, media: null, share: null });
  assert.equal(retry.status, 409);
  assert.equal(retry.body.error, "already_published");
  assert.equal(giftDocs(db).length, 1);
  assert.equal(chargeDocs(db).length, 1);
});

// ---- insufficient balance --------------------------------------------------

test("insufficient: publish refused BEFORE any write; balances included", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  db._store.set(`${CREDIT_ACCOUNTS}/${SENDER.uid}`, {
    schemaVersion: 1, free: 5, paid: 10,
    freeTopUpAt: NOW - 1000, createdAt: NOW - 1000, updatedAt: NOW - 1000, version: 1,
  });
  const res = await publish(db, share, SENDER, {
    message: "hello", accessMode: "direct", idempotencyKey: KEY("poor"),
  });
  assert.equal(res.status, 402);
  assert.equal(res.body.error, "insufficient_credits");
  assert.equal(res.body.free, 5);
  assert.equal(res.body.paid, 10);
  assert.equal(res.body.needed, 20);
  assert.equal(giftDocs(db).length, 0);
  assert.equal(chargeDocs(db).length, 0);
});

// ---- A. reply exemption: server-issued authorization ONLY ------------------

async function sealSourceGift(db, share) {
  // The ORIGINAL gift, sealed by another sender via the legacy (keyless) path.
  const res = await publish(db, share, RECIPIENT, { message: "original", accessMode: "direct" });
  return res.body.token;
}

test("A-NEGATIVE: forged/arbitrary replyToGiftId does NOT bypass billing", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const srcToken = await sealSourceGift(db, share);
  const before = chargeDocs(db).length;
  // replyToGiftId alone (even a REAL one) — still charged: 20 deducted.
  const res = await publish(db, share, SENDER, {
    message: "reply-ish", accessMode: "direct",
    idempotencyKey: KEY("forge1"), replyToGiftId: srcToken,
  });
  assert.equal(res.status, 200);
  assert.equal(chargeDocs(db).length, before + 1, "charged — replyToGiftId is never authority");
  assert.equal(db._store.get(`${CREDIT_ACCOUNTS}/${SENDER.uid}`).free, 180);
  // arbitrary garbage replyToGiftId — identical: charged.
  const res2 = await publish(db, share, SENDER, {
    message: "reply-ish", accessMode: "direct",
    idempotencyKey: KEY("forge2"), replyToGiftId: "anything-at-all",
  });
  assert.equal(res2.status, 200);
  assert.equal(db._store.get(`${CREDIT_ACCOUNTS}/${SENDER.uid}`).free, 160);
});

test("A-NEGATIVE: replyGrant on /gift/create is IGNORED — publication charged normally", async () => {
  // Quick Reply correction: replies never create Gifts, so /gift/create has
  // NO reply lane at all. Any replyGrant here (forged or even real) buys
  // nothing — the publish stays a normal 20-Credit publication.
  const db = makeFakeDb();
  const share = fakeShare();
  const res = await publish(db, share, SENDER, {
    message: "reply-ish", accessMode: "direct",
    idempotencyKey: KEY("badg1"), replyGrant: "totally-forged-grant",
  });
  assert.equal(res.status, 200);
  assert.equal(chargeDocs(db).length, 1, "charged — no free path via replyGrant");
  assert.equal(db._store.get(`${CREDIT_ACCOUNTS}/${SENDER.uid}`).free, 180);
});






// ---- legacy & rollout flag -------------------------------------------------

test("legacy: keyless publish stays free and uncharged (Phase 2 rollout window)", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const res = await publish(db, share, SENDER, { message: "old client", accessMode: "direct" });
  assert.equal(res.status, 200);
  assert.equal(chargeDocs(db).length, 0);
  assert.ok(!db._store.has(`${CREDIT_ACCOUNTS}/${SENDER.uid}`));
});

test("legacy: BILLING_REQUIRE_KEY=on closes the keyless window explicitly", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  process.env.BILLING_REQUIRE_KEY = "on";
  try {
    const res = await publish(db, share, SENDER, { message: "old client", accessMode: "direct" });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "billing_client_required");
    assert.equal(giftDocs(db).length, 0);
  } finally {
    delete process.env.BILLING_REQUIRE_KEY;
  }
});

test("legacy: recipient retrieve + reply RSVP paths remain billing-free", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const srcToken = await sealSourceGift(db, share);
  const r = await retrieveGift({ db, body: { token: srcToken }, now: NOW });
  assert.equal(r.status, 200);
  assert.equal(chargeDocs(db).length, 0, "retrieve never touches billing");
});

// ---- malformed idempotency key ---------------------------------------------

test("publish: present-but-malformed idempotencyKey → 400, never a silent free ride", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const res = await publish(db, share, SENDER, {
    message: "x", accessMode: "direct", idempotencyKey: "nope!",
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "invalid_idempotency_key");
  assert.equal(giftDocs(db).length, 0);
});

// ---- Gift.Tag free publication (LOCKED 0-Credit rule) ----------------------

async function mintTagGrant(db, decoded) {
  const res = await mintTagPublishGrant({ db, decoded, now: NOW });
  return res.body.grant;
}

test("gift.tag: server-minted grant publishes at exactly 50 Credits (180→130)", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  // Spec example: start from 180 free (one simple gift already published).
  await publish(db, share, SENDER, { message: "warmup", accessMode: "direct", idempotencyKey: KEY("w1") });
  const grant = await mintTagGrant(db, SENDER);
  const res = await publish(db, share, SENDER, {
    message: "tag message", accessMode: "heart_key",
    idempotencyKey: KEY("tag1"), tagPublishGrant: grant,
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.balances, { free: 130, paid: 0 }, "180 → 130");
  const entry = db._store.get(`${CREDIT_LEDGER}/charge_gift_${SENDER.uid}_${KEY("tag1")}`);
  assert.equal(entry.amount, 50);
  assert.equal(entry.unitPrice, 50);
  assert.equal(entry.product, "gift_tag_publish", "trusted classification → product");
  const rec = db._store.get(giftDocs(db).find((k) => db._store.get(k).productContext === "gift_tag"));
  assert.ok(rec, "server-derived classification persisted");
  const auth = db._store.get(`${TAG_PUBLISH_AUTH_COLLECTION}/${sha256Hex(grant)}`);
  assert.equal(auth.usesRemaining, 0, "grant consumed atomically with the charge");
});

test("gift.tag: mixed balance 30 free + 100 paid → 0 free + 80 paid", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  db._store.set(`${CREDIT_ACCOUNTS}/${SENDER.uid}`, {
    schemaVersion: 1, free: 30, paid: 100,
    freeTopUpAt: NOW - 1000, createdAt: NOW - 1000, updatedAt: NOW - 1000, version: 1,
  });
  const grant = await mintTagGrant(db, SENDER);
  const res = await publish(db, share, SENDER, {
    message: "tag", accessMode: "direct", idempotencyKey: KEY("tagmix2"), tagPublishGrant: grant,
  });
  assert.deepEqual(res.body.balances, { free: 0, paid: 80 });
  const entry = db._store.get(`${CREDIT_LEDGER}/charge_gift_${SENDER.uid}_${KEY("tagmix2")}`);
  assert.equal(entry.freeDelta, -30);
  assert.equal(entry.paidDelta, -20);
});

test("gift.tag: total < 50 → insufficient_credits, nothing created, grant intact", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  db._store.set(`${CREDIT_ACCOUNTS}/${SENDER.uid}`, {
    schemaVersion: 1, free: 20, paid: 20,
    freeTopUpAt: NOW - 1000, createdAt: NOW - 1000, updatedAt: NOW - 1000, version: 1,
  });
  const grant = await mintTagGrant(db, SENDER);
  const res = await publish(db, share, SENDER, {
    message: "tag", accessMode: "direct", idempotencyKey: KEY("tagpoor"), tagPublishGrant: grant,
  });
  assert.equal(res.status, 402);
  assert.equal(res.body.error, "insufficient_credits");
  assert.equal(res.body.needed, 50);
  assert.equal(res.body.free, 20);
  assert.equal(res.body.paid, 20);
  assert.equal(giftDocs(db).length, 0, "no Gift.Tag created");
  assert.equal(chargeDocs(db).length, 0, "no charge");
  const auth = db._store.get(`${TAG_PUBLISH_AUTH_COLLECTION}/${sha256Hex(grant)}`);
  assert.equal(auth.usesRemaining, 1, "grant untouched — creation state preserved");
});

test("gift.tag: failed commit → no charge, no gift, grant intact", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const grant = await mintTagGrant(db, SENDER);
  db._failNextCreate("giftMessages/");
  await assert.rejects(() => publish(db, share, SENDER, {
    message: "tag", accessMode: "direct", idempotencyKey: KEY("tagfail"), tagPublishGrant: grant,
  }));
  assert.equal(chargeDocs(db).length, 0);
  assert.equal(giftDocs(db).length, 0);
  const auth = db._store.get(`${TAG_PUBLISH_AUTH_COLLECTION}/${sha256Hex(grant)}`);
  assert.equal(auth.usesRemaining, 1, "atomic: grant not consumed on failure");
});

test("gift.tag NEGATIVE: forged type/context/product/price fields have NO billing authority", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const res = await publish(db, share, SENDER, {
    message: "pretend tag", accessMode: "direct",
    idempotencyKey: KEY("tagforge1"),
    type: "tag", context: "tag", productContext: "gift_tag",
    product: "gift_tag_publish", price: 0, credits: 0, amount: 0,
  });
  assert.equal(res.status, 200);
  const entry = db._store.get(`${CREDIT_LEDGER}/charge_gift_${SENDER.uid}_${KEY("tagforge1")}`);
  assert.equal(entry.product, "simple_gift_publish", "classified as ORDINARY publish");
  assert.equal(entry.amount, 20, "charged 20, not 50, not 0");
  assert.equal(db._store.get(`${CREDIT_ACCOUNTS}/${SENDER.uid}`).free, 180);
  const rec = db._store.get(giftDocs(db)[0]);
  assert.equal(rec.productContext, undefined, "forged classification never persisted");
});

test("gift.tag NEGATIVE: forged grant string → 400, no publish, no charge", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const res = await publish(db, share, SENDER, {
    message: "x", accessMode: "direct",
    idempotencyKey: KEY("tagforge2"), tagPublishGrant: "totally-forged",
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "invalid_tag_grant");
  assert.equal(giftDocs(db).length, 0);
  assert.equal(chargeDocs(db).length, 0);
});

test("gift.tag NEGATIVE: another user's grant → 400 (uid-bound)", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const grant = await mintTagGrant(db, RECIPIENT);
  const res = await publish(db, share, SENDER, {
    message: "x", accessMode: "direct",
    idempotencyKey: KEY("tagforge3"), tagPublishGrant: grant,
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "invalid_tag_grant");
});

test("gift.tag NEGATIVE: consumed grant cannot classify a second publication", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const grant = await mintTagGrant(db, SENDER);
  await publish(db, share, SENDER, {
    message: "one", accessMode: "direct", idempotencyKey: KEY("tagc1"), tagPublishGrant: grant,
  });
  const res = await publish(db, share, SENDER, {
    message: "two", accessMode: "direct", idempotencyKey: KEY("tagc2"), tagPublishGrant: grant,
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "invalid_tag_grant");
  assert.equal(giftDocs(db).length, 1);
});

test("gift.tag NEGATIVE: expired grant refused", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const grant = await mintTagGrant(db, SENDER);
  const authKey = `${TAG_PUBLISH_AUTH_COLLECTION}/${sha256Hex(grant)}`;
  db._store.set(authKey, { ...db._store.get(authKey), expiresAt: NOW - 1 });
  const res = await publish(db, share, SENDER, {
    message: "x", accessMode: "direct", idempotencyKey: KEY("tagexp"), tagPublishGrant: grant,
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "invalid_tag_grant");
});

test("gift.tag: retry with the same idempotency key → ONE publication, ONE 50-charge", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const grant = await mintTagGrant(db, SENDER);
  const body = {
    message: "tag", accessMode: "heart_key",
    idempotencyKey: KEY("tagrt"), tagPublishGrant: grant,
  };
  const first = await publish(db, share, SENDER, body);
  const again = await publish(db, share, SENDER, body); // grant now consumed
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.token, first.body.token);
  assert.equal(again.body.retrievalKey, first.body.retrievalKey);
  assert.equal(giftDocs(db).length, 1, "one publication");
  assert.equal(chargeDocs(db).length, 1, "one 50-Credit charge, never a second");
  assert.equal(db._store.get(`${CREDIT_ACCOUNTS}/${SENDER.uid}`).free, 150);
});

test("gift.tag: a stray replyGrant is ignored — the grant alone classifies (50 charged)", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const grant = await mintTagGrant(db, SENDER);
  const res = await publish(db, share, SENDER, {
    message: "x", accessMode: "direct",
    idempotencyKey: KEY("tagmix"), tagPublishGrant: grant, replyGrant: "whatever",
  });
  assert.equal(res.status, 200);
  const entry = db._store.get(`${CREDIT_LEDGER}/charge_gift_${SENDER.uid}_${KEY("tagmix")}`);
  assert.equal(entry.product, "gift_tag_publish");
  assert.equal(entry.amount, 50);
});

// ---- LOCKED invariant: ONE tagPublishAuth → max ONE publication, ONE 50 ----

/** Winner's full committed outcome, captured for the race hooks. */
async function commitWinner(db, share, grant, key) {
  const snapshot = () => new Map([...db._store.entries()].map(([k, v]) => [k, JSON.parse(JSON.stringify(v))]));
  const before = snapshot();
  const res = await publish(db, share, SENDER, {
    message: "winner tag", accessMode: "direct", idempotencyKey: key, tagPublishGrant: grant,
  });
  const after = snapshot();
  // roll the store back to BEFORE the winner, and return the delta to replay
  db._store.clear();
  for (const [k, v] of before) db._store.set(k, v);
  const replay = () => {
    for (const [k, v] of after) db._store.set(k, v);
    for (const k of [...db._store.keys()]) if (!after.has(k)) db._store.delete(k);
  };
  return { res, replay };
}

test("CONCURRENCY 1: same grant + SAME key racing → one tag, one 50, loser recovers original", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const grant = await mintTagGrant(db, SENDER);
  const { res: winner, replay } = await commitWinner(db, share, grant, KEY("race1"));
  // The loser is mid-flight: the winner commits between its read and commit.
  db._midTx(replay);
  const loser = await publish(db, share, SENDER, {
    message: "winner tag", accessMode: "direct", idempotencyKey: KEY("race1"), tagPublishGrant: grant,
  });
  assert.equal(loser.status, 200);
  assert.equal(loser.body.duplicate, true, "loser recovers, never re-publishes");
  assert.equal(loser.body.token, winner.body.token, "the ORIGINAL result");
  assert.equal(giftDocs(db).length, 1, "exactly one Gift.Tag");
  assert.equal(chargeDocs(db).length, 1, "exactly one 50-Credit charge");
  assert.equal(db._store.get(`${CREDIT_ACCOUNTS}/${SENDER.uid}`).free, 150, "charged once");
  assert.equal(db._store.get(`${TAG_PUBLISH_AUTH_COLLECTION}/${sha256Hex(grant)}`).usesRemaining, 0);
});

test("CONCURRENCY 2: same grant + DIFFERENT keys racing → one succeeds, one invalid_tag_grant", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const grant = await mintTagGrant(db, SENDER);
  const { replay } = await commitWinner(db, share, grant, KEY("race2a"));
  db._midTx(replay);
  const loser = await publish(db, share, SENDER, {
    message: "second tab", accessMode: "direct", idempotencyKey: KEY("race2b"), tagPublishGrant: grant,
  });
  assert.equal(loser.status, 400, "different intended publication is REFUSED, not silently created");
  assert.equal(loser.body.error, "invalid_tag_grant");
  assert.equal(giftDocs(db).length, 1, "exactly one Gift.Tag exists");
  assert.equal(chargeDocs(db).length, 1, "exactly one 50-Credit ledger charge exists");
  assert.equal(db._store.get(`${CREDIT_ACCOUNTS}/${SENDER.uid}`).free, 150, "no second deduction");
});
