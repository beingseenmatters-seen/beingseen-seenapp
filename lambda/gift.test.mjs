import { test } from "node:test";
import assert from "node:assert/strict";
import {
  giftCrypto,
  sha256Hex,
  generateToken,
  generateRetrievalKey,
  isWeakKey,
  createGift,
  retrieveGift,
  revokeGift,
  rsvpGift,
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

test("generateRetrievalKey is six numeric digits and never weak", () => {
  for (let i = 0; i < 200; i++) {
    const k = generateRetrievalKey();
    assert.match(k, /^\d{6}$/);
    assert.equal(isWeakKey(k), false);
  }
});

test("isWeakKey rejects obvious values, accepts normal ones", () => {
  for (const w of ["000000", "111111", "222222", "999999", "123456", "654321", "012345", "987654", "12345", "abcdef"]) {
    assert.equal(isWeakKey(w), true, `expected weak: ${w}`);
  }
  for (const ok of ["432540", "080026", "230415", "314159"]) {
    assert.equal(isWeakKey(ok), false, `expected ok: ${ok}`);
  }
});

test("createGift accepts a valid custom Heart Key, stored/hashed identically", async () => {
  const db = makeFakeDb();
  const res = await createGift({
    db,
    decoded: AUTHOR,
    body: { message: "生日快乐", retrievalKey: "080216" },
    now: 1000,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.retrievalKey, "080216"); // echoes the chosen key
  // Stored the same way: keyHash present, raw key absent, retrievable with it.
  const rec = db._store.get(`${GIFT_COLLECTION}/${sha256Hex(res.body.token)}`);
  assert.ok(rec.keyHash && rec.keySalt);
  assert.equal(rec.retrievalKey, undefined);
  const r = await retrieveGift({ db, body: { token: res.body.token, key: "080216" }, now: 2000 });
  assert.equal(r.status, 200);
  assert.equal(r.body.message, "生日快乐");
});

test("createGift accepts a spaced custom key and refuses weak custom keys", async () => {
  const db = makeFakeDb();
  const spaced = await createGift({ db, decoded: AUTHOR, body: { message: "hi", retrievalKey: "314 159" }, now: 1000 });
  assert.equal(spaced.status, 200);
  assert.equal(spaced.body.retrievalKey, "314159");

  for (const weak of ["000000", "123456", "654321", "12345"]) {
    const bad = await createGift({ db, decoded: AUTHOR, body: { message: "hi", retrievalKey: weak }, now: 1000 });
    assert.equal(bad.status, 400, `expected 400 for ${weak}`);
    assert.equal(bad.body.error, "weak_key");
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

// --- Access mode: heart_key | direct (sealing-time, immutable) --------------

test("accessMode: newly created gift defaults to heart_key", async () => {
  const db = makeFakeDb();
  const res = await createGift({ db, decoded: AUTHOR, body: { message: "hi" }, now: 1000 });
  assert.equal(res.status, 200);
  assert.equal(res.body.accessMode, "heart_key");
  assert.ok(res.body.retrievalKey);
  const rec = db._store.get(`${GIFT_COLLECTION}/${sha256Hex(res.body.token)}`);
  assert.equal(rec.accessMode, "heart_key");
  assert.ok(rec.keyHash && rec.keySalt);
});

test("accessMode: explicit heart_key behaves exactly as before (wrong key fails, right key opens)", async () => {
  const db = makeFakeDb();
  const res = await createGift({
    db, decoded: AUTHOR,
    body: { message: "hello", accessMode: "heart_key", retrievalKey: "080216" },
    now: 1000,
  });
  assert.equal(res.body.accessMode, "heart_key");
  const wrong = await retrieveGift({ db, body: { token: res.body.token, key: "111319" }, now: 2000 });
  assert.equal(wrong.status, 401);
  assert.equal(wrong.body.error, "invalid_key");
  const right = await retrieveGift({ db, body: { token: res.body.token, key: "080216" }, now: 3000 });
  assert.equal(right.status, 200);
  assert.equal(right.body.accessMode, "heart_key");
});

test("accessMode: direct gift has no key anywhere and opens without one", async () => {
  const db = makeFakeDb();
  const res = await createGift({
    db, decoded: AUTHOR,
    body: { message: "打开就好", accessMode: "direct" },
    now: 1000,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.accessMode, "direct");
  assert.equal(res.body.retrievalKey, null);
  const rec = db._store.get(`${GIFT_COLLECTION}/${sha256Hex(res.body.token)}`);
  assert.equal(rec.accessMode, "direct");
  assert.equal(rec.keyHash, null);
  assert.equal(rec.keySalt, null);
  const r = await retrieveGift({ db, body: { token: res.body.token }, now: 2000 });
  assert.equal(r.status, 200);
  assert.equal(r.body.message, "打开就好");
  assert.equal(r.body.accessMode, "direct");
  // Re-openable (keepsake) and redeemedAt stamped once.
  const again = await retrieveGift({ db, body: { token: res.body.token }, now: 3000 });
  assert.equal(again.status, 200);
  assert.equal(again.body.redeemedAt, 2000);
});

test("accessMode: keyless probe on a heart_key gift returns key_required WITHOUT burning an attempt", async () => {
  const db = makeFakeDb();
  const res = await createGift({ db, decoded: AUTHOR, body: { message: "x", retrievalKey: "080216" }, now: 1000 });
  const probe = await retrieveGift({ db, body: { token: res.body.token }, now: 1500 });
  assert.equal(probe.status, 401);
  assert.equal(probe.body.error, "key_required");
  const rec = db._store.get(`${GIFT_COLLECTION}/${sha256Hex(res.body.token)}`);
  assert.equal(rec.failedAttempts || 0, 0); // probe is not a guess
  const right = await retrieveGift({ db, body: { token: res.body.token, key: "080216" }, now: 2000 });
  assert.equal(right.status, 200);
});

test("accessMode: legacy record without the field behaves as heart_key", async () => {
  const db = makeFakeDb();
  // Simulate a pre-feature record: build via createGift then strip the field.
  const res = await createGift({ db, decoded: AUTHOR, body: { message: "old", retrievalKey: "080216" }, now: 1000 });
  const k = `${GIFT_COLLECTION}/${sha256Hex(res.body.token)}`;
  const rec = db._store.get(k);
  delete rec.accessMode;
  db._store.set(k, rec);
  const probe = await retrieveGift({ db, body: { token: res.body.token }, now: 1500 });
  assert.equal(probe.body.error, "key_required"); // NOT treated as direct
  const right = await retrieveGift({ db, body: { token: res.body.token, key: "080216" }, now: 2000 });
  assert.equal(right.status, 200);
  assert.equal(right.body.accessMode, "heart_key");
});

test("accessMode: revoked and expired direct gifts stay inaccessible; unknown token 404", async () => {
  const db = makeFakeDb();
  const res = await createGift({ db, decoded: AUTHOR, body: { message: "d", accessMode: "direct" }, now: 1000 });
  await revokeGift({ db, decoded: AUTHOR, body: { token: res.body.token } });
  const revoked = await retrieveGift({ db, body: { token: res.body.token }, now: 2000 });
  assert.equal(revoked.status, 410);
  assert.equal(revoked.body.error, "revoked");

  const res2 = await createGift({ db, decoded: AUTHOR, body: { message: "e", accessMode: "direct" }, now: 1000 });
  const rec2Key = `${GIFT_COLLECTION}/${sha256Hex(res2.body.token)}`;
  const rec2 = db._store.get(rec2Key);
  rec2.expiresAt = 1500;
  db._store.set(rec2Key, rec2);
  const expired = await retrieveGift({ db, body: { token: res2.body.token }, now: 2000 });
  assert.equal(expired.status, 410);
  assert.equal(expired.body.error, "expired");

  const unknown = await retrieveGift({ db, body: { token: "no-such-token" }, now: 2000 });
  assert.equal(unknown.status, 404);
});

test("accessMode: direct invitation RSVPs without a key; heart_key RSVP still requires it", async () => {
  const db = makeFakeDb();
  const direct = await createGift({ db, decoded: AUTHOR, body: { message: "来我的生日会", accessMode: "direct" }, now: 1000 });
  const r1 = await rsvpGift({ db, body: { token: direct.body.token, status: "accepted" }, now: 2000 });
  assert.equal(r1.status, 200);
  assert.equal(r1.body.rsvpStatus, "accepted");
  // Answer visible on reopen, exactly like today.
  const reopen = await retrieveGift({ db, body: { token: direct.body.token }, now: 3000 });
  assert.equal(reopen.body.rsvpStatus, "accepted");

  const keyed = await createGift({ db, decoded: AUTHOR, body: { message: "invite", retrievalKey: "080216" }, now: 1000 });
  const noKey = await rsvpGift({ db, body: { token: keyed.body.token, status: "declined" }, now: 2000 });
  assert.equal(noKey.status, 401);
  const withKey = await rsvpGift({ db, body: { token: keyed.body.token, key: "080216", status: "declined" }, now: 2500 });
  assert.equal(withKey.status, 200);
});
