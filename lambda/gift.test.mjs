import { test } from "node:test";
import assert from "node:assert/strict";
import {
  giftCrypto,
  sha256Hex,
  generateToken,
  generateRetrievalKey,
  createGift,
  retrieveGift,
  revokeGift,
  GIFT_COLLECTION,
} from "./gift.mjs";

// --- Minimal in-memory Firestore stub -------------------------------------
function makeFakeDb() {
  const store = new Map(); // `${collection}/${id}` -> data object
  function makeQuery(name, conds) {
    return {
      where: (field, op, val) => makeQuery(name, [...conds, { field, op, val }]),
      get: async () => {
        const docs = [...store.entries()]
          .filter(([k]) => k.startsWith(`${name}/`))
          .map(([, v]) => v)
          .filter((v) => conds.every((c) => matchCond(v, c)));
        return { size: docs.length, docs: docs.map((d) => ({ data: () => d })) };
      },
    };
  }
  return {
    _store: store,
    collection(name) {
      return {
        doc: (id) => ({
          id,
          get: async () => {
            const d = store.get(`${name}/${id}`);
            return { exists: d !== undefined, data: () => d };
          },
          set: async (v) => void store.set(`${name}/${id}`, { ...v }),
          update: async (patch) =>
            void store.set(`${name}/${id}`, { ...store.get(`${name}/${id}`), ...patch }),
        }),
        where: (field, op, val) => makeQuery(name, [{ field, op, val }]),
      };
    },
  };
}
function matchCond(v, c) {
  const x = v[c.field];
  if (c.op === "==") return x === c.val;
  if (c.op === ">=") return x >= c.val;
  return false;
}

const AUTHOR = { uid: "author-1" };

// --- Crypto primitives ----------------------------------------------------
test("scrypt key hash verifies correct key and rejects wrong key", () => {
  const { salt, hash } = giftCrypto.hashKey("482731");
  assert.equal(giftCrypto.verifyKey("482731", salt, hash), true);
  assert.equal(giftCrypto.verifyKey("482732", salt, hash), false);
  assert.notEqual(hash, "482731"); // key never stored raw
});

test("generateRetrievalKey is six numeric digits", () => {
  for (let i = 0; i < 50; i++) {
    assert.match(generateRetrievalKey(), /^\d{6}$/);
  }
});

test("sha256Hex is deterministic and token is high-entropy", () => {
  const t = generateToken();
  assert.equal(sha256Hex(t), sha256Hex(t));
  assert.ok(t.length >= 20);
  assert.notEqual(generateToken(), generateToken());
});

// --- createGift -----------------------------------------------------------
test("createGift stores under tokenHash and never persists the raw token", async () => {
  const db = makeFakeDb();
  const res = await createGift({ db, decoded: AUTHOR, body: { message: "想你了" }, now: 1000 });
  assert.equal(res.status, 200);
  assert.match(res.body.retrievalKey, /^\d{6}$/);
  assert.equal(res.body.url, `https://app.beingseenmatters.com/s/${res.body.token}`);

  const keys = [...db._store.keys()];
  assert.equal(keys.length, 1);
  // Doc id is the hash, not the raw token.
  assert.equal(keys[0], `${GIFT_COLLECTION}/${sha256Hex(res.body.token)}`);
  assert.notEqual(keys[0], `${GIFT_COLLECTION}/${res.body.token}`);

  const rec = db._store.get(keys[0]);
  assert.equal(rec.token, undefined); // no raw token field anywhere
  assert.equal(rec.message, "想你了"); // V1 server-readable
  assert.equal(rec.retrievalKey, undefined); // no raw key field
  assert.ok(rec.keyHash && rec.keySalt);
});

test("createGift rejects unauthenticated and empty message", async () => {
  const db = makeFakeDb();
  assert.equal((await createGift({ db, decoded: null, body: { message: "hi" } })).status, 401);
  assert.equal((await createGift({ db, decoded: AUTHOR, body: { message: "  " } })).status, 400);
});

test("createGift enforces the per-uid daily cap", async () => {
  const db = makeFakeDb();
  for (let i = 0; i < 20; i++) {
    const r = await createGift({ db, decoded: AUTHOR, body: { message: `m${i}` }, now: 5000 });
    assert.equal(r.status, 200);
  }
  const capped = await createGift({ db, decoded: AUTHOR, body: { message: "one too many" }, now: 5000 });
  assert.equal(capped.status, 429);
});

// --- retrieveGift ---------------------------------------------------------
async function seedGift(db, message = "这句话只想说给你听", now = 1000) {
  const res = await createGift({ db, decoded: AUTHOR, body: { message, senderName: "小林" }, now });
  return res.body; // { token, url, retrievalKey }
}

test("retrieveGift returns the message for token + correct key and sets redeemedAt", async () => {
  const db = makeFakeDb();
  const gift = await seedGift(db);
  const r = await retrieveGift({ db, body: { token: gift.token, key: gift.retrievalKey }, now: 2000 });
  assert.equal(r.status, 200);
  assert.equal(r.body.message, "这句话只想说给你听");
  assert.equal(r.body.senderName, "小林");
  assert.equal(r.body.redeemedAt, 2000);

  // Re-viewable by key; redeemedAt stays the first-open time.
  const again = await retrieveGift({ db, body: { token: gift.token, key: gift.retrievalKey }, now: 9999 });
  assert.equal(again.status, 200);
  assert.equal(again.body.redeemedAt, 2000);
});

test("retrieveGift accepts a spaced key format", async () => {
  const db = makeFakeDb();
  const gift = await seedGift(db);
  const spaced = `${gift.retrievalKey.slice(0, 3)} ${gift.retrievalKey.slice(3)}`;
  const r = await retrieveGift({ db, body: { token: gift.token, key: spaced }, now: 2000 });
  assert.equal(r.status, 200);
});

test("unknown token → 404; no token-only retrieval", async () => {
  const db = makeFakeDb();
  await seedGift(db);
  assert.equal(
    (await retrieveGift({ db, body: { token: "nope", key: "000000" }, now: 2000 })).status,
    404,
  );
  const gift2 = await seedGift(db);
  // Correct token but no/blank key never reveals.
  assert.equal(
    (await retrieveGift({ db, body: { token: gift2.token, key: "" }, now: 2000 })).status,
    401,
  );
});

test("wrong keys escalate to a TEMPORARY cooldown and never permanently lock", async () => {
  const db = makeFakeDb();
  const gift = await seedGift(db);
  const wrong = gift.retrievalKey === "000000" ? "111111" : "000000";

  // 4 wrong guesses → still just invalid_key with decreasing attemptsRemaining.
  for (let i = 1; i <= 4; i++) {
    const r = await retrieveGift({ db, body: { token: gift.token, key: wrong }, now: 100 });
    assert.equal(r.status, 401);
    assert.equal(r.body.attemptsRemaining, 5 - i);
  }
  // 5th wrong guess → 15-minute cooldown.
  const locked = await retrieveGift({ db, body: { token: gift.token, key: wrong }, now: 100 });
  assert.equal(locked.status, 423);
  assert.equal(locked.body.lockedUntil, 100 + 15 * 60 * 1000);

  // During cooldown even the CORRECT key is held off (423), not destroyed.
  const during = await retrieveGift({ db, body: { token: gift.token, key: gift.retrievalKey }, now: 200 });
  assert.equal(during.status, 423);

  // After the cooldown passes, the correct key works again — access returns.
  const after = await retrieveGift({
    db,
    body: { token: gift.token, key: gift.retrievalKey },
    now: 100 + 15 * 60 * 1000 + 1,
  });
  assert.equal(after.status, 200);
  assert.equal(after.body.message, "这句话只想说给你听");
});

test("cooldowns escalate 15m → 1h → 24h and stay temporary", async () => {
  const db = makeFakeDb();
  const gift = await seedGift(db);
  const wrong = "999999" === gift.retrievalKey ? "888888" : "999999";
  const fail = async (n) =>
    (await retrieveGift({ db, body: { token: gift.token, key: wrong }, now: n })).body.lockedUntil;

  let t = 0;
  // 1st lock at 5 fails
  for (let i = 0; i < 4; i++) await retrieveGift({ db, body: { token: gift.token, key: wrong }, now: t });
  assert.equal(await fail(t), t + 15 * 60 * 1000);
  // advance past cooldown, 5 more fails → 1h
  t = t + 15 * 60 * 1000 + 1;
  for (let i = 0; i < 4; i++) await retrieveGift({ db, body: { token: gift.token, key: wrong }, now: t });
  assert.equal(await fail(t), t + 60 * 60 * 1000);
  // advance, 5 more → 24h (top tier repeats, never permanent)
  t = t + 60 * 60 * 1000 + 1;
  for (let i = 0; i < 4; i++) await retrieveGift({ db, body: { token: gift.token, key: wrong }, now: t });
  assert.equal(await fail(t), t + 24 * 60 * 60 * 1000);
});

test("revoked and expired gifts return 410", async () => {
  const db = makeFakeDb();
  const gift = await seedGift(db, "hi", 1000);
  // Expired
  const expired = await retrieveGift({
    db,
    body: { token: gift.token, key: gift.retrievalKey },
    now: 1000 + 400 * 24 * 60 * 60 * 1000,
  });
  assert.equal(expired.status, 410);
  assert.equal(expired.body.error, "expired");
});

// --- revokeGift -----------------------------------------------------------
test("only the sender may revoke; revoke makes the gift 410", async () => {
  const db = makeFakeDb();
  const gift = await seedGift(db);

  const bySomeoneElse = await revokeGift({ db, decoded: { uid: "intruder" }, body: { token: gift.token } });
  assert.equal(bySomeoneElse.status, 403);

  const bySender = await revokeGift({ db, decoded: AUTHOR, body: { token: gift.token } });
  assert.equal(bySender.status, 200);

  const afterRevoke = await retrieveGift({ db, body: { token: gift.token, key: gift.retrievalKey } });
  assert.equal(afterRevoke.status, 410);
  assert.equal(afterRevoke.body.error, "revoked");
});
