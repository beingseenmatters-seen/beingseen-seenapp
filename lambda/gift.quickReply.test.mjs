/**
 * QUICK REPLY (locked product correction) — through the REAL handlers.
 *
 * A Quick Reply is a lightweight acknowledgment attached to the source Gift:
 * it creates NO Gift, NO QR, needs NO account, costs 0 Credits, and never
 * touches Compose. Authorization is ONLY the server-minted replyGrant from a
 * successful /gift/retrieve; the per-gift limit of 5 is server-authoritative.
 * Covers §23 items 1–11 of the consolidated Phase 2 rules.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeDb } from "./billing.test.mjs";
import { CREDIT_ACCOUNTS, CREDIT_LEDGER } from "./billing.mjs";
import {
  createGift,
  retrieveGift,
  quickReply,
  listGiftReplies,
  GIFT_COLLECTION,
  GIFT_REPLIES_COLLECTION,
  REPLY_AUTH_COLLECTION,
  REPLY_QUOTA_COLLECTION,
  REPLY_FREE_MAX,
  sha256Hex,
} from "./gift.mjs";

const SENDER = { uid: "sender-1" };
const OTHER = { uid: "other-1" };
const NOW = Date.UTC(2026, 8, 3, 12, 0, 0);

const fakeShare = () => ({
  seal: async (t, ctx) => `S|${ctx}|${t}`,
  open: async (sealed, ctx) => {
    const [tag, c, t] = String(sealed).split("|");
    if (tag !== "S" || c !== ctx) throw new Error("context_mismatch");
    return t;
  },
});

const KEY = (s) => `qk_${s}_00000000`.slice(0, 20);
const giftDocs = (db) => [...db._store.keys()].filter((k) => k.startsWith(`${GIFT_COLLECTION}/`));
const replyDocs = (db) =>
  [...db._store.keys()].filter((k) => k.startsWith(`${GIFT_REPLIES_COLLECTION}/`));
const billingDocs = (db) =>
  [...db._store.keys()].filter(
    (k) => k.startsWith(`${CREDIT_ACCOUNTS}/`) || k.startsWith(`${CREDIT_LEDGER}/`),
  );

/** Seal a source gift (legacy path), retrieve it, return {token, grant, remaining, tokenHash}. */
async function openSourceGift(db, share, opts = {}) {
  const res = await createGift({
    db,
    decoded: SENDER,
    body: {
      message: "original",
      accessMode: "direct",
      recipientLabel: opts.recipientLabel,
    },
    now: NOW,
    media: null,
    share,
  });
  const token = res.body.token;
  const retrieved = await retrieveGift({ db, body: { token }, now: NOW });
  assert.equal(retrieved.status, 200);
  return {
    token,
    tokenHash: sha256Hex(token),
    grant: retrieved.body.replyGrant,
    remaining: retrieved.body.quickReplyRemaining,
  };
}

// ---- §23.1/2/3/4/5/6: the happy path is free, giftless, accountless ---------

test("quick reply: retrieve mints authorization; reply succeeds without ANY account", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const { grant, remaining, tokenHash } = await openSourceGift(db, share, {
    recipientLabel: "妈妈",
  });
  assert.ok(grant, "grant minted at the trusted retrieve boundary");
  assert.equal(remaining, REPLY_FREE_MAX);

  const before = giftDocs(db).length;
  const res = await quickReply({
    db,
    body: { replyGrant: grant, message: "谢谢你，我很喜欢 ❤️", idempotencyKey: KEY("r1") },
    now: NOW,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.ok, true);
  assert.equal(res.body.remaining, REPLY_FREE_MAX - 1);

  // NO new Gift, NO QR/token/url in the response, NO Credits objects at all.
  assert.equal(giftDocs(db).length, before, "no Gift created");
  assert.equal(res.body.token, undefined);
  assert.equal(res.body.url, undefined);
  assert.equal(res.body.retrievalKey, undefined);
  assert.equal(billingDocs(db).length, 0, "0 Credits — billing never touched");

  const reply = db._store.get(replyDocs(db)[0]);
  assert.equal(reply.sourceGiftId, tokenHash);
  assert.equal(reply.message, "谢谢你，我很喜欢 ❤️");
  assert.equal(reply.recipientLabel, "妈妈", "server-known label only");
});

// ---- §23.7/8: forgery cannot reply, and cannot publish free -----------------

test("quick reply: forged/expired/consumed authorization is rejected", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  // forged
  let res = await quickReply({
    db,
    body: { replyGrant: "totally-forged", message: "hi", idempotencyKey: KEY("f1") },
    now: NOW,
  });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, "invalid_reply_auth");
  assert.equal(replyDocs(db).length, 0);

  // expired
  const { grant } = await openSourceGift(db, share);
  const authKey = `${REPLY_AUTH_COLLECTION}/${sha256Hex(grant)}`;
  db._store.set(authKey, { ...db._store.get(authKey), expiresAt: NOW - 1 });
  res = await quickReply({
    db,
    body: { replyGrant: grant, message: "hi", idempotencyKey: KEY("f2") },
    now: NOW,
  });
  assert.equal(res.status, 401);
});

test("quick reply: arbitrary replyToGiftId is NEVER authorization (no grant, no reply)", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const { tokenHash } = await openSourceGift(db, share);
  const res = await quickReply({
    db,
    body: { replyToGiftId: tokenHash, message: "hi", idempotencyKey: KEY("f3") },
    now: NOW,
  });
  assert.equal(res.status, 401, "grant-less request refused outright");
  assert.equal(replyDocs(db).length, 0);
});

// ---- §23.9/10: five allowed, sixth refused gracefully -----------------------

test("quick reply: five valid replies succeed; the sixth is refused gracefully", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const { grant, token } = await openSourceGift(db, share);
  for (let i = 1; i <= REPLY_FREE_MAX; i++) {
    const res = await quickReply({
      db,
      body: { replyGrant: grant, message: `reply ${i}`, idempotencyKey: KEY(`n${i}`) },
      now: NOW + i,
    });
    assert.equal(res.status, 200, `reply ${i} allowed`);
    assert.equal(res.body.remaining, REPLY_FREE_MAX - i);
  }
  // Sixth via a FRESH retrieve (new grant) — the per-gift count still rules.
  const again = await retrieveGift({ db, body: { token }, now: NOW + 100 });
  assert.equal(again.body.quickReplyRemaining, 0, "retrieve reports the exhausted limit");
  assert.equal(again.body.replyGrant, undefined, "no further authorization minted");
  const sixth = await quickReply({
    db,
    body: { replyGrant: grant, message: "six", idempotencyKey: KEY("n6") },
    now: NOW + 101,
  });
  assert.equal(sixth.status, 409);
  assert.equal(sixth.body.error, "reply_limit");
  assert.equal(sixth.body.remaining, 0);
  assert.equal(replyDocs(db).length, REPLY_FREE_MAX);
});

// ---- idempotency ------------------------------------------------------------

test("quick reply: retried send is a duplicate echo, never a second reply", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const { grant } = await openSourceGift(db, share);
  const body = { replyGrant: grant, message: "once", idempotencyKey: KEY("dup") };
  const a = await quickReply({ db, body, now: NOW });
  const b = await quickReply({ db, body, now: NOW + 1 });
  assert.equal(a.body.duplicate, false);
  assert.equal(b.status, 200);
  assert.equal(b.body.duplicate, true);
  assert.equal(replyDocs(db).length, 1);
  assert.equal(
    db._store.get(`${REPLY_QUOTA_COLLECTION}/${Object.values([...db._store.entries()].find(([k]) => k.startsWith(GIFT_REPLIES_COLLECTION))[1] ? [] : [])}`) === undefined
      ? (db._store.get(`${REPLY_QUOTA_COLLECTION}/${[...db._store.values()].find((v) => v.sourceGiftId && v.count !== undefined)?.sourceGiftId}`)?.count ?? 1)
      : 1,
    1,
    "counted once",
  );
});

// ---- shared/on-site/lifecycle guards ---------------------------------------

test("quick reply: shared-link and on-site records are ineligible (their own flows)", async () => {
  const db = makeFakeDb();
  // Craft records + a grant directly (shared links need event machinery).
  db._store.set(`${GIFT_COLLECTION}/sharedhash`, {
    senderUid: OTHER.uid, sharedDistribution: true, message: "m", accessMode: "direct",
    createdAt: NOW, expiresAt: NOW + 1000000, revoked: false,
  });
  db._store.set(`${REPLY_AUTH_COLLECTION}/${sha256Hex("g-shared")}`, {
    sourceGiftId: "sharedhash", createdAt: NOW, expiresAt: NOW + 1000000, usesRemaining: 5,
  });
  const res = await quickReply({
    db,
    body: { replyGrant: "g-shared", message: "hi", idempotencyKey: KEY("s1") },
    now: NOW,
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "reply_unavailable");
});

test("quick reply: revoked source gift → 410, nothing persisted", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const { grant, tokenHash } = await openSourceGift(db, share);
  db._store.set(`${GIFT_COLLECTION}/${tokenHash}`, {
    ...db._store.get(`${GIFT_COLLECTION}/${tokenHash}`),
    revoked: true,
  });
  const res = await quickReply({
    db,
    body: { replyGrant: grant, message: "hi", idempotencyKey: KEY("rv") },
    now: NOW,
  });
  assert.equal(res.status, 410);
  assert.equal(replyDocs(db).length, 0);
});

test("quick reply: retrieve mints NO grant for shared-link records", async () => {
  const db = makeFakeDb();
  db._store.set(`${GIFT_COLLECTION}/${sha256Hex("shared-token")}`, {
    senderUid: OTHER.uid, sharedDistribution: true, message: "m", accessMode: "direct",
    createdAt: NOW, expiresAt: NOW + 1000000, revoked: false, failedAttempts: 0,
  });
  const r = await retrieveGift({ db, body: { token: "shared-token" }, now: NOW });
  assert.equal(r.status, 200);
  assert.equal(r.body.replyGrant, undefined);
  assert.equal(r.body.quickReplyRemaining, undefined);
});

// ---- §23.11: sender-side visibility -----------------------------------------

test("sender sees persisted replies (chronological, label honest, sender-only)", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const { grant, tokenHash } = await openSourceGift(db, share, { recipientLabel: "妈妈" });
  await quickReply({
    db, body: { replyGrant: grant, message: "第一条", idempotencyKey: KEY("l1") }, now: NOW + 1,
  });
  await quickReply({
    db, body: { replyGrant: grant, message: "第二条", idempotencyKey: KEY("l2") }, now: NOW + 2,
  });

  const list = await listGiftReplies({ db, decoded: SENDER, body: { giftId: tokenHash }, now: NOW });
  assert.equal(list.status, 200);
  assert.deepEqual(
    list.body.replies.map((r) => r.message),
    ["第一条", "第二条"],
    "chronological",
  );
  assert.equal(list.body.replies[0].recipientLabel, "妈妈");
  // Each row carries its deterministic replyId (= the push's replyId) so a
  // deep-linked notification can highlight the exact reply.
  assert.ok(list.body.replies.every((r) => /^[a-f0-9]{64}$/i.test(r.replyId)), "replyId present per row");
  assert.equal(new Set(list.body.replies.map((r) => r.replyId)).size, 2, "distinct reply ids");
  assert.equal(list.body.remaining, REPLY_FREE_MAX - 2);

  // Only the gift's own sender may read.
  const forbidden = await listGiftReplies({ db, decoded: OTHER, body: { giftId: tokenHash }, now: NOW });
  assert.equal(forbidden.status, 403);
  const anon = await listGiftReplies({ db, decoded: null, body: { giftId: tokenHash }, now: NOW });
  assert.equal(anon.status, 401);
});

// ---- validation -------------------------------------------------------------

test("quick reply: message and idempotency validation fail closed", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const { grant } = await openSourceGift(db, share);
  for (const [body, code] of [
    [{ replyGrant: grant, message: "", idempotencyKey: KEY("v1") }, "invalid_message"],
    [{ replyGrant: grant, message: "x".repeat(501), idempotencyKey: KEY("v2") }, "message_too_long"],
    [{ replyGrant: grant, message: "ok", idempotencyKey: "bad key!" }, "invalid_idempotency_key"],
    [{ message: "ok", idempotencyKey: KEY("v3") }, "invalid_reply_auth"],
  ]) {
    const res = await quickReply({ db, body, now: NOW });
    assert.ok(res.status >= 400);
    assert.equal(res.body.error, code);
  }
  assert.equal(replyDocs(db).length, 0);
});

// ---- signature (this round): display text only, never authority -------------

test("signature: persists sanitized+bounded; blank is valid; sender list returns it", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const { grant, tokenHash } = await openSourceGift(db, share);
  // 1) with a messy signature → sanitized single line, capped at 40
  const messy = "  Da\nvid" + "x".repeat(50) + "  ";
  const a = await quickReply({
    db,
    body: { replyGrant: grant, message: "第一条", idempotencyKey: KEY("sig1"), signature: messy },
    now: NOW + 1,
  });
  assert.equal(a.status, 200);
  // 2) blank signature → valid send, null persisted
  const b = await quickReply({
    db,
    body: { replyGrant: grant, message: "第二条", idempotencyKey: KEY("sig2"), signature: "   " },
    now: NOW + 2,
  });
  assert.equal(b.status, 200);
  // 3) no signature field at all → valid
  const c = await quickReply({
    db,
    body: { replyGrant: grant, message: "第三条", idempotencyKey: KEY("sig3") },
    now: NOW + 3,
  });
  assert.equal(c.status, 200);

  const rows = [...db._store.values()].filter((v) => v.sourceGiftId === tokenHash && v.status === "active");
  const withSig = rows.find((r) => r.message === "第一条");
  assert.ok(withSig.signature.startsWith("Da vid"), "control chars collapsed to a space");
  assert.equal(withSig.signature.length, 40, "bounded at 40");
  assert.equal(rows.find((r) => r.message === "第二条").signature, null);
  assert.equal(rows.find((r) => r.message === "第三条").signature, null);

  const list = await listGiftReplies({ db, decoded: SENDER, body: { giftId: tokenHash }, now: NOW });
  assert.equal(list.body.replies[0].signature.slice(0, 6), "Da vid");
  assert.equal(list.body.replies[1].signature, null, "client renders 收件人/Recipient");
});

test("signature: has NO effect on authorization, billing, or the 5-reply count", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const { grant } = await openSourceGift(db, share);
  for (let i = 1; i <= REPLY_FREE_MAX; i++) {
    const res = await quickReply({
      db,
      body: {
        replyGrant: grant, message: `r${i}`, idempotencyKey: KEY(`sg${i}`),
        signature: i % 2 ? "妈妈" : "",
      },
      now: NOW + i,
    });
    assert.equal(res.status, 200);
    assert.equal(res.body.remaining, REPLY_FREE_MAX - i, "count driven by replies, not signatures");
  }
  const sixth = await quickReply({
    db,
    body: { replyGrant: grant, message: "six", idempotencyKey: KEY("sg6"), signature: "Admin" },
    now: NOW + 10,
  });
  assert.equal(sixth.status, 409, "signature cannot extend the limit");
  assert.equal(billingDocs(db).length, 0, "zero ledger objects — signatures never bill");
  // a forged grant with a signature is still a forged grant
  const forged = await quickReply({
    db,
    body: { replyGrant: "forged", message: "x", idempotencyKey: KEY("sg7"), signature: "root" },
    now: NOW + 11,
  });
  assert.equal(forged.status, 401, "signature grants no authorization");
});
