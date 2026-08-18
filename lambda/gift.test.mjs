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

test("createGift has NO daily ceiling (4.5-B3: entitlement is Credits' job, not a quota's)", async () => {
  // A real Wedding legitimately creates 100+ recipient-specific Invitations
  // in one session. The 21st/next-batch create must never 429 on a product
  // quota; security protections (auth, key cooldowns) are separate concerns.
  const db = makeFakeDb();
  for (let i = 0; i < 25; i++) {
    const r = await createGift({ db, decoded: AUTHOR, body: { message: `m${i}` }, now: 5000 });
    assert.equal(r.status, 200, `create #${i + 1} must succeed`);
  }
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

// --- Structured Occasion (Wedding V1) ---------------------------------------

function weddingOccasion(overrides = {}) {
  return {
    type: "wedding",
    version: 1,
    couple: { partner1: "冯志俊", partner2: "吴姗姗" },
    date: "2026-10-01",
    time: { start: "17:00" },
    venue: { displayName: "临平温德姆大酒店" },
    inviter: "姚科奇全家",
    audienceType: "elders",
    ...overrides,
  };
}

test("occasion: createGift seals validated wedding facts; retrieve returns them on both access paths", async () => {
  const db = makeFakeDb();
  const direct = await createGift({
    db,
    decoded: AUTHOR,
    body: { message: "婚礼邀请正文", accessMode: "direct", occasion: weddingOccasion() },
    now: 1000,
  });
  assert.equal(direct.status, 200);
  const rec = db._store.get(`${GIFT_COLLECTION}/${sha256Hex(direct.body.token)}`);
  assert.equal(rec.occasion.type, "wedding");
  assert.equal(rec.occasion.version, 1);
  assert.equal(rec.occasion.couple.partner1, "冯志俊");
  assert.equal(rec.occasion.venue.formattedAddress, null); // normalized optional

  const opened = await retrieveGift({ db, body: { token: direct.body.token }, now: 2000 });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.occasion.venue.displayName, "临平温德姆大酒店");
  assert.equal(opened.body.occasion.time.start, "17:00");

  const keyed = await createGift({
    db,
    decoded: AUTHOR,
    body: { message: "正文", retrievalKey: "080216", occasion: weddingOccasion() },
    now: 1000,
  });
  const unlocked = await retrieveGift({ db, body: { token: keyed.body.token, key: "080216" }, now: 2000 });
  assert.equal(unlocked.status, 200);
  assert.equal(unlocked.body.occasion.inviter, "姚科奇全家");
});

test("occasion: malformed wedding data is rejected clearly, never silently dropped", async () => {
  const db = makeFakeDb();
  const cases = [
    [weddingOccasion({ type: "birthday" }), "type"],
    // v2 is the CULTURAL contract version: still refused here, because it
    // must declare a culture. An unsupported version is refused as before.
    [weddingOccasion({ version: 2 }), "culture"],
    [weddingOccasion({ version: 9 }), "version"],
    // The deployment-order invariant, enforced at the seal door: a Western
    // culture on v1 must never be accepted (an older backend would have
    // silently dropped it and sealed a Chinese Wedding).
    [weddingOccasion({ version: 1, culture: "western" }), "version"],
    [weddingOccasion({ date: "2026-13-01" }), "date"],
    [weddingOccasion({ couple: { partner1: "只有一位" } }), "couple.partner2"],
    [weddingOccasion({ venue: { displayName: "" } }), "venue.displayName"],
    [weddingOccasion({ audienceType: "vip" }), "audienceType"],
    ["wedding", "occasion"],
  ];
  for (const [occasion, field] of cases) {
    const res = await createGift({ db, decoded: AUTHOR, body: { message: "hi", occasion }, now: 1000 });
    assert.equal(res.status, 400, `expected 400 for ${field}`);
    assert.equal(res.body.error, "invalid_occasion");
    assert.equal(res.body.field, field);
  }
  // Nothing was written for any rejected create.
  assert.equal(db._store.size, 0);
});

test("occasion: personalContext is never part of the sealed record even if a client sends it", async () => {
  const db = makeFakeDb();
  const res = await createGift({
    db,
    decoded: AUTHOR,
    body: {
      message: "正文",
      accessMode: "direct",
      personalContext: "TA 是看着孩子长大的长辈",
      occasion: { ...weddingOccasion(), personalContext: "TA 是看着孩子长大的长辈" },
    },
    now: 1000,
  });
  assert.equal(res.status, 200);
  const rec = db._store.get(`${GIFT_COLLECTION}/${sha256Hex(res.body.token)}`);
  assert.equal(rec.personalContext, undefined);
  assert.equal(rec.occasion.personalContext, undefined);
  const opened = await retrieveGift({ db, body: { token: res.body.token }, now: 2000 });
  assert.equal(JSON.stringify(opened.body).includes("长辈"), false);
});

test("occasion: ordinary gifts keep an identical record shape (no occasion key) and retrieve occasion:null", async () => {
  const db = makeFakeDb();
  const plain = await createGift({ db, decoded: AUTHOR, body: { message: "生日快乐", retrievalKey: "080216" }, now: 1000 });
  const rec = db._store.get(`${GIFT_COLLECTION}/${sha256Hex(plain.body.token)}`);
  assert.equal("occasion" in rec, false);
  assert.deepEqual(Object.keys(rec).sort(), [
    "accessMode", "cooldownTier", "createdAt", "expiresAt", "failedAttempts",
    "keyHash", "keySalt", "lockedUntil", "message", "redeemedAt", "region",
    "revoked", "schemaVersion", "senderName", "senderUid", "tone",
  ]);
  const opened = await retrieveGift({ db, body: { token: plain.body.token, key: "080216" }, now: 2000 });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.occasion, null);
});

test("occasion: legacy records (sealed before the field existed) retrieve exactly as before", async () => {
  const db = makeFakeDb();
  const { salt, hash } = giftCrypto.hashKey("080216");
  db._store.set(`${GIFT_COLLECTION}/${sha256Hex("legacy-token")}`, {
    schemaVersion: 1,
    senderUid: "author-1",
    senderName: null,
    tone: null,
    message: "旧的心意",
    keySalt: salt,
    keyHash: hash,
    region: "GLOBAL",
    createdAt: 500,
    expiresAt: 999999999,
    redeemedAt: null,
    revoked: false,
    failedAttempts: 0,
    lockedUntil: null,
    cooldownTier: 0,
  });
  const opened = await retrieveGift({ db, body: { token: "legacy-token", key: "080216" }, now: 2000 });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.message, "旧的心意");
  assert.equal(opened.body.occasion, null);
});

// --- RSVP hardening (Phase 1) ------------------------------------------------

test("rsvp hardening: wrong keys increment the shared failure counter and trip the retrieve-style cooldown", async () => {
  const db = makeFakeDb();
  const gift = await createGift({ db, decoded: AUTHOR, body: { message: "invite", retrievalKey: "080216" }, now: 1000 });
  const token = gift.body.token;
  const recKey = `${GIFT_COLLECTION}/${sha256Hex(token)}`;

  for (let i = 1; i <= 4; i += 1) {
    const res = await rsvpGift({ db, body: { token, key: "111112", status: "accepted" }, now: 1000 + i });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, "invalid_key");
    assert.equal(res.body.attemptsRemaining, 5 - i);
    assert.equal(db._store.get(recKey).failedAttempts, i);
  }
  // 5th wrong attempt → 423 with a lock, same tier ladder as retrieve.
  const locked = await rsvpGift({ db, body: { token, key: "111112", status: "accepted" }, now: 2000 });
  assert.equal(locked.status, 423);
  assert.equal(locked.body.error, "locked");
  assert.equal(locked.body.lockedUntil, 2000 + 15 * 60 * 1000);
  assert.equal(db._store.get(recKey).failedAttempts, 5);

  // While locked, BOTH doors refuse — even with the correct key.
  const duringLockRsvp = await rsvpGift({ db, body: { token, key: "080216", status: "accepted" }, now: 3000 });
  assert.equal(duringLockRsvp.status, 423);
  const duringLockRetrieve = await retrieveGift({ db, body: { token, key: "080216" }, now: 3000 });
  assert.equal(duringLockRetrieve.status, 423);

  // After the cooldown, the correct key works and resets the counters.
  const after = 2000 + 15 * 60 * 1000 + 1;
  const ok = await rsvpGift({ db, body: { token, key: "080216", status: "accepted" }, now: after });
  assert.equal(ok.status, 200);
  const rec = db._store.get(recKey);
  assert.equal(rec.failedAttempts, 0);
  assert.equal(rec.lockedUntil, null);
  assert.equal(rec.cooldownTier, 0);
  assert.equal(rec.rsvpStatus, "accepted");
});

test("rsvp hardening: rsvp and retrieve share ONE counter (guesses cannot be split across doors)", async () => {
  const db = makeFakeDb();
  const gift = await createGift({ db, decoded: AUTHOR, body: { message: "invite", retrievalKey: "080216" }, now: 1000 });
  const token = gift.body.token;

  // 3 wrong guesses at retrieve + 2 at rsvp = lock on the 5th cumulative.
  for (let i = 0; i < 3; i += 1) {
    const r = await retrieveGift({ db, body: { token, key: "111112" }, now: 1100 + i });
    assert.equal(r.status, 401);
  }
  const fourth = await rsvpGift({ db, body: { token, key: "111112", status: "declined" }, now: 1200 });
  assert.equal(fourth.status, 401);
  assert.equal(fourth.body.attemptsRemaining, 1);
  const fifth = await rsvpGift({ db, body: { token, key: "111112", status: "declined" }, now: 1300 });
  assert.equal(fifth.status, 423);
});

test("rsvp hardening: empty key on a heart_key gift is a plain 401 without burning an attempt", async () => {
  const db = makeFakeDb();
  const gift = await createGift({ db, decoded: AUTHOR, body: { message: "invite", retrievalKey: "080216" }, now: 1000 });
  const res = await rsvpGift({ db, body: { token: gift.body.token, status: "accepted" }, now: 2000 });
  assert.equal(res.status, 401);
  assert.equal(res.body.error, "invalid_key");
  assert.equal(db._store.get(`${GIFT_COLLECTION}/${sha256Hex(gift.body.token)}`).failedAttempts, 0);
});

test("rsvp hardening: direct gifts are untouched and repeated valid changes still work", async () => {
  const db = makeFakeDb();
  const direct = await createGift({ db, decoded: AUTHOR, body: { message: "来", accessMode: "direct" }, now: 1000 });
  const a = await rsvpGift({ db, body: { token: direct.body.token, status: "accepted" }, now: 2000 });
  assert.equal(a.status, 200);
  const b = await rsvpGift({ db, body: { token: direct.body.token, status: "declined" }, now: 3000 });
  assert.equal(b.status, 200);
  assert.equal(db._store.get(`${GIFT_COLLECTION}/${sha256Hex(direct.body.token)}`).rsvpStatus, "declined");

  const keyed = await createGift({ db, decoded: AUTHOR, body: { message: "invite", retrievalKey: "080216" }, now: 1000 });
  const first = await rsvpGift({ db, body: { token: keyed.body.token, key: "080216", status: "accepted" }, now: 2000 });
  assert.equal(first.status, 200);
  const changed = await rsvpGift({ db, body: { token: keyed.body.token, key: "080216", status: "declined" }, now: 3000 });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.rsvpStatus, "declined");
});

test("rsvp hardening: legacy records (no accessMode) still RSVP with the correct key", async () => {
  const db = makeFakeDb();
  const { salt, hash } = giftCrypto.hashKey("080216");
  db._store.set(`${GIFT_COLLECTION}/${sha256Hex("legacy-token")}`, {
    schemaVersion: 1, senderUid: "author-1", senderName: null, tone: null,
    message: "旧邀请", keySalt: salt, keyHash: hash, region: "GLOBAL",
    createdAt: 500, expiresAt: 999999999, redeemedAt: null, revoked: false,
    failedAttempts: 0, lockedUntil: null, cooldownTier: 0,
  });
  const ok = await rsvpGift({ db, body: { token: "legacy-token", key: "080216", status: "accepted" }, now: 2000 });
  assert.equal(ok.status, 200);
  const wrong = await rsvpGift({ db, body: { token: "legacy-token", key: "111112", status: "accepted" }, now: 3000 });
  assert.equal(wrong.status, 401);
  assert.equal(db._store.get(`${GIFT_COLLECTION}/${sha256Hex("legacy-token")}`).failedAttempts, 1);
});

test("invitation access policy: occasion gifts default to direct; explicit heart_key still honored; ordinary default unchanged", async () => {
  const db = makeFakeDb();

  // Occasion + no accessMode → direct (effortless by default), no key material.
  const invite = await createGift({ db, decoded: AUTHOR, body: { message: "正文", occasion: weddingOccasion() }, now: 1000 });
  assert.equal(invite.status, 200);
  assert.equal(invite.body.accessMode, "direct");
  assert.equal(invite.body.retrievalKey, null);
  const invRec = db._store.get(`${GIFT_COLLECTION}/${sha256Hex(invite.body.token)}`);
  assert.equal(invRec.accessMode, "direct");
  assert.equal(invRec.keyHash, null);
  const opened = await retrieveGift({ db, body: { token: invite.body.token }, now: 2000 });
  assert.equal(opened.status, 200);

  // Occasion + explicit heart_key → private invitation, fully supported.
  const priv = await createGift({
    db, decoded: AUTHOR,
    body: { message: "正文", accessMode: "heart_key", retrievalKey: "080216", occasion: weddingOccasion() },
    now: 1000,
  });
  assert.equal(priv.status, 200);
  assert.equal(priv.body.accessMode, "heart_key");
  assert.equal(priv.body.retrievalKey, "080216");
  const probe = await retrieveGift({ db, body: { token: priv.body.token }, now: 2000 });
  assert.equal(probe.status, 401);
  assert.equal(probe.body.error, "key_required");

  // Ordinary gift + no accessMode → heart_key, exactly as before.
  const plain = await createGift({ db, decoded: AUTHOR, body: { message: "生日快乐" }, now: 1000 });
  assert.equal(plain.body.accessMode, "heart_key");
  assert.ok(plain.body.retrievalKey);
});

// --- Opening Media (Phase 3B-1) ----------------------------------------------

function makeMediaStore() {
  const objects = new Map();
  const store = {
    _objects: objects,
    failCopy: false,
    failPresign: false,
    async putStaging({ uid, assetId, bytes, contentType, metadata }) {
      // Mirror real S3: user-metadata keys come back LOWERCASED.
      const meta = Object.fromEntries(Object.entries(metadata || {}).map(([k, v]) => [k.toLowerCase(), v]));
      objects.set(`staging/${uid}/${assetId}`, { bytes, contentType, metadata: meta });
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
    async deleteStaging({ uid, assetId }) { objects.delete(`staging/${uid}/${assetId}`); },
    async deleteSealed({ tokenHash, assetId }) { objects.delete(`sealed/${tokenHash}/${assetId}`); },
    async presignSealedGet({ tokenHash, assetId }) {
      if (store.failPresign) throw new Error("injected presign failure");
      return `https://media.example/sealed/${tokenHash}/${assetId}?sig=test`;
    },
  };
  return store;
}

async function stageTestPhoto(media, uid = AUTHOR.uid) {
  const bytes = Buffer.alloc(2048, 0x20);
  bytes[0] = 0xff; bytes[1] = 0xd8; bytes[2] = 0xff;
  const { uploadGiftMedia } = await import("./giftMedia.mjs");
  const res = await uploadGiftMedia({
    store: media, decoded: { uid },
    body: { type: "photo", contentType: "image/jpeg", data: bytes.toString("base64") },
  });
  if (res.status !== 200) throw new Error("stage failed");
  return res.body.assetId;
}

test("media: wedding gift seals a staged photo immutably; staging is promoted", async () => {
  const db = makeFakeDb();
  const media = makeMediaStore();
  const assetId = await stageTestPhoto(media);
  const res = await createGift({
    db, decoded: AUTHOR, media,
    body: { message: "正文", occasion: weddingOccasion(), openingMedia: { type: "photo", assetId } },
    now: 1000,
  });
  assert.equal(res.status, 200);
  const rec = db._store.get(`${GIFT_COLLECTION}/${sha256Hex(res.body.token)}`);
  // 3C-1: legacy openingMedia INPUT normalizes into the canonical role-aware
  // presentation record; openingMedia is never written to new records.
  assert.equal("openingMedia" in rec, false);
  assert.deepEqual(rec.presentation, {
    v: 1,
    photo: { assetId, contentType: "image/jpeg", bytes: 2048 },
  });
  assert.ok(media._objects.has(`sealed/${sha256Hex(res.body.token)}/${assetId}`));
  assert.equal([...media._objects.keys()].some((k) => k.startsWith("staging/")), false);

  // Immutable: RSVP and reopen never touch presentation.
  await rsvpGift({ db, body: { token: res.body.token, status: "accepted" }, now: 2000 });
  assert.deepEqual(db._store.get(`${GIFT_COLLECTION}/${sha256Hex(res.body.token)}`).presentation, {
    v: 1,
    photo: { assetId, contentType: "image/jpeg", bytes: 2048 },
  });
});

test("media: requires an occasion, rejects foreign/nonexistent assets, never writes a corrupt record", async () => {
  const db = makeFakeDb();
  const media = makeMediaStore();
  const assetId = await stageTestPhoto(media);

  const noOccasion = await createGift({
    db, decoded: AUTHOR, media,
    body: { message: "hi", openingMedia: { type: "photo", assetId } }, now: 1000,
  });
  assert.equal(noOccasion.status, 400);
  assert.equal(noOccasion.body.field, "occasion");

  const foreignId = await stageTestPhoto(media, "someone-else");
  const foreign = await createGift({
    db, decoded: AUTHOR, media,
    body: { message: "hi", occasion: weddingOccasion(), openingMedia: { type: "photo", assetId: foreignId } }, now: 1000,
  });
  assert.equal(foreign.status, 400);
  assert.equal(foreign.body.error, "invalid_media");

  media.failCopy = true;
  const copyFail = await createGift({
    db, decoded: AUTHOR, media,
    body: { message: "hi", occasion: weddingOccasion(), openingMedia: { type: "photo", assetId } }, now: 1000,
  });
  assert.equal(copyFail.status, 502);
  assert.equal(copyFail.body.error, "media_seal_failed");
  assert.equal(db._store.size, 0); // no gift record ever written on any failure
});

test("media: Firestore write failure compensates by deleting the sealed object", async () => {
  const media = makeMediaStore();
  const assetId = await stageTestPhoto(media);
  const failingDb = {
    collection: () => ({
      doc: () => ({ set: async () => { throw new Error("firestore down"); } }),
      where: () => ({ where: () => ({ get: async () => ({ size: 0, docs: [] }) }) }),
    }),
  };
  await assert.rejects(() =>
    createGift({
      db: failingDb, decoded: AUTHOR, media,
      body: { message: "hi", occasion: weddingOccasion(), openingMedia: { type: "photo", assetId } }, now: 1000,
    }),
  );
  assert.equal([...media._objects.keys()].some((k) => k.startsWith("sealed/")), false);
});

test("media: direct retrieve returns a short-lived descriptor exposing no storage identity", async () => {
  const db = makeFakeDb();
  const media = makeMediaStore();
  const assetId = await stageTestPhoto(media);
  const gift = await createGift({
    db, decoded: AUTHOR, media,
    body: { message: "正文", occasion: weddingOccasion(), openingMedia: { type: "photo", assetId } }, now: 1000,
  });
  const opened = await retrieveGift({ db, media, body: { token: gift.body.token }, now: 2000 });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.openingMedia.type, "photo");
  assert.equal(opened.body.openingMedia.contentType, "image/jpeg");
  assert.ok(opened.body.openingMedia.url.includes("sig=test"));
  const raw = JSON.stringify(opened.body);
  assert.equal(raw.includes("assetId"), false);
  assert.equal(raw.includes(AUTHOR.uid), false);
  assert.equal(raw.includes("bucket"), false);
});

test("media: heart_key gift reveals no media before unlock; unlock mints it", async () => {
  const db = makeFakeDb();
  const media = makeMediaStore();
  const assetId = await stageTestPhoto(media);
  const gift = await createGift({
    db, decoded: AUTHOR, media,
    body: { message: "正文", accessMode: "heart_key", retrievalKey: "080216", occasion: weddingOccasion(), openingMedia: { type: "photo", assetId } },
    now: 1000,
  });
  const probe = await retrieveGift({ db, media, body: { token: gift.body.token }, now: 2000 });
  assert.equal(probe.status, 401);
  assert.equal(JSON.stringify(probe.body).includes("media.example"), false);
  const wrong = await retrieveGift({ db, media, body: { token: gift.body.token, key: "111112" }, now: 2100 });
  assert.equal(wrong.status, 401);
  assert.equal(JSON.stringify(wrong.body).includes("media.example"), false);
  const ok = await retrieveGift({ db, media, body: { token: gift.body.token, key: "080216" }, now: 2200 });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.openingMedia.url.includes("sig=test"));
});

test("media: revoked and expired gifts mint nothing; revoke deletes the sealed object", async () => {
  const db = makeFakeDb();
  const media = makeMediaStore();
  const assetId = await stageTestPhoto(media);
  const gift = await createGift({
    db, decoded: AUTHOR, media,
    body: { message: "正文", occasion: weddingOccasion(), openingMedia: { type: "photo", assetId } }, now: 1000,
  });
  const tokenHash = sha256Hex(gift.body.token);
  assert.ok(media._objects.has(`sealed/${tokenHash}/${assetId}`));

  const rev = await revokeGift({ db, decoded: AUTHOR, media, body: { token: gift.body.token } });
  assert.equal(rev.status, 200);
  assert.equal(media._objects.has(`sealed/${tokenHash}/${assetId}`), false);
  const after = await retrieveGift({ db, media, body: { token: gift.body.token }, now: 3000 });
  assert.equal(after.status, 410);

  // Expired: record present, past expiresAt → 410, no descriptor anywhere.
  const g2 = await createGift({
    db, decoded: AUTHOR, media,
    body: { message: "e", occasion: weddingOccasion(), openingMedia: { type: "photo", assetId: await stageTestPhoto(media) } },
    now: 1000,
  });
  const k2 = `${GIFT_COLLECTION}/${sha256Hex(g2.body.token)}`;
  const rec2 = db._store.get(k2);
  rec2.expiresAt = 1500;
  db._store.set(k2, rec2);
  const expired = await retrieveGift({ db, media, body: { token: g2.body.token }, now: 2000 });
  assert.equal(expired.status, 410);
  assert.equal(JSON.stringify(expired.body).includes("media.example"), false);
});

test("media: revoke delete failure never un-revokes the gift", async () => {
  const db = makeFakeDb();
  const media = makeMediaStore();
  const assetId = await stageTestPhoto(media);
  const gift = await createGift({
    db, decoded: AUTHOR, media,
    body: { message: "正文", occasion: weddingOccasion(), openingMedia: { type: "photo", assetId } }, now: 1000,
  });
  media.deleteSealed = async () => { throw new Error("injected"); };
  const rev = await revokeGift({ db, decoded: AUTHOR, media, body: { token: gift.body.token } });
  assert.equal(rev.status, 200);
  const after = await retrieveGift({ db, media, body: { token: gift.body.token }, now: 3000 });
  assert.equal(after.status, 410);
});

test("media: presign failure degrades to null media without failing the gift", async () => {
  const db = makeFakeDb();
  const media = makeMediaStore();
  const assetId = await stageTestPhoto(media);
  const gift = await createGift({
    db, decoded: AUTHOR, media,
    body: { message: "正文", occasion: weddingOccasion(), openingMedia: { type: "photo", assetId } }, now: 1000,
  });
  media.failPresign = true;
  const opened = await retrieveGift({ db, media, body: { token: gift.body.token }, now: 2000 });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.openingMedia, null);
  assert.equal(opened.body.message, "正文");
});

test("media: ordinary gifts and media-less wedding gifts are unchanged (openingMedia null, no record key)", async () => {
  const db = makeFakeDb();
  const media = makeMediaStore();
  const plain = await createGift({ db, decoded: AUTHOR, media, body: { message: "生日快乐", accessMode: "direct" }, now: 1000 });
  const rec = db._store.get(`${GIFT_COLLECTION}/${sha256Hex(plain.body.token)}`);
  assert.equal("openingMedia" in rec, false);
  const opened = await retrieveGift({ db, media, body: { token: plain.body.token }, now: 2000 });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.openingMedia, null);

  const wed = await createGift({ db, decoded: AUTHOR, media, body: { message: "正文", occasion: weddingOccasion() }, now: 1000 });
  const wrec = db._store.get(`${GIFT_COLLECTION}/${sha256Hex(wed.body.token)}`);
  assert.equal("openingMedia" in wrec, false);
  const wopen = await retrieveGift({ db, media, body: { token: wed.body.token }, now: 2000 });
  assert.equal(wopen.body.openingMedia, null);

  // No store configured at all (env absent) — everything still works.
  const noStore = await retrieveGift({ db, body: { token: plain.body.token }, now: 2500 });
  assert.equal(noStore.status, 200);
  assert.equal(noStore.body.openingMedia, null);
});

// --- Invitation Presentation contract (Phase 3C-1) ----------------------------

async function stageTestVoice(media, uid = AUTHOR.uid, durationMs = 12000) {
  const bytes = Buffer.alloc(2048, 0x20);
  bytes[4] = 0x66; bytes[5] = 0x74; bytes[6] = 0x79; bytes[7] = 0x70; // ftyp
  const { uploadGiftMedia } = await import("./giftMedia.mjs");
  const res = await uploadGiftMedia({
    store: media, decoded: { uid },
    body: { type: "audio", contentType: "audio/mp4", data: bytes.toString("base64"), durationMs },
  });
  if (res.status !== 200) throw new Error("stage voice failed");
  return res.body.assetId;
}

test("presentation: photo only / voice only / both / neither seal to the canonical record", async () => {
  const db = makeFakeDb();
  const media = makeMediaStore();

  const photoId = await stageTestPhoto(media);
  const pOnly = await createGift({ db, decoded: AUTHOR, media, now: 1000,
    body: { message: "p", occasion: weddingOccasion(), presentation: { photo: { assetId: photoId } } } });
  assert.equal(pOnly.status, 200);
  const pRec = db._store.get(`${GIFT_COLLECTION}/${sha256Hex(pOnly.body.token)}`);
  assert.deepEqual(Object.keys(pRec.presentation).sort(), ["photo", "v"]);

  const voiceId = await stageTestVoice(media);
  const vOnly = await createGift({ db, decoded: AUTHOR, media, now: 1000,
    body: { message: "v", occasion: weddingOccasion(), presentation: { voice: { assetId: voiceId } } } });
  assert.equal(vOnly.status, 200);
  const vRec = db._store.get(`${GIFT_COLLECTION}/${sha256Hex(vOnly.body.token)}`);
  assert.deepEqual(vRec.presentation.voice, { assetId: voiceId, contentType: "audio/mp4", bytes: 2048, durationMs: 12000 });

  const photo2 = await stageTestPhoto(media);
  const voice2 = await stageTestVoice(media);
  const both = await createGift({ db, decoded: AUTHOR, media, now: 1000,
    body: { message: "pv", occasion: weddingOccasion(),
      presentation: { photo: { assetId: photo2 }, voice: { assetId: voice2 } } } });
  assert.equal(both.status, 200);
  const bRec = db._store.get(`${GIFT_COLLECTION}/${sha256Hex(both.body.token)}`);
  assert.ok(bRec.presentation.photo && bRec.presentation.voice);
  const th = sha256Hex(both.body.token);
  assert.ok(media._objects.has(`sealed/${th}/${photo2}`) && media._objects.has(`sealed/${th}/${voice2}`));

  const none = await createGift({ db, decoded: AUTHOR, media, now: 1000,
    body: { message: "n", occasion: weddingOccasion(), presentation: {} } });
  assert.equal(none.status, 200);
  assert.equal("presentation" in db._store.get(`${GIFT_COLLECTION}/${sha256Hex(none.body.token)}`), false);
});

test("presentation: music theme allowlist boundary — approved ids seal, unknown ids reject", async () => {
  const db = makeFakeDb();
  const media = makeMediaStore();
  // Rights-verified themes (2026-08-15) are allowlisted and seal verbatim.
  const ok = await createGift({ db, decoded: AUTHOR, media, now: 1000,
    body: { message: "m", occasion: weddingOccasion(), presentation: { musicThemeId: "wedding_warm_piano_v1" } } });
  assert.equal(ok.status, 200);
  assert.equal(db._store.get(`${GIFT_COLLECTION}/${sha256Hex(ok.body.token)}`).presentation.musicThemeId, "wedding_warm_piano_v1");
  // Unknown/unapproved ids remain rejected — fake themes are never sealable.
  const rejected = await createGift({ db, decoded: AUTHOR, media, now: 1000,
    body: { message: "m", occasion: weddingOccasion(), presentation: { musicThemeId: "wedding_warm_piano_v99" } } });
  assert.equal(rejected.status, 400);
  assert.equal(rejected.body.error, "invalid_presentation");
  assert.equal(rejected.body.field, "musicThemeId");

  // The mechanics accept an allowlisted id (DI through finalizePresentation).
  const { finalizePresentation } = await import("./giftMedia.mjs");
  const fin = await finalizePresentation({
    store: media, decoded: AUTHOR, tokenHash: "t",
    presentation: { musicThemeId: "wedding_warm_piano_v1" },
    allowedMusicThemes: ["wedding_warm_piano_v1"],
  });
  assert.equal(fin.ok, true);
  assert.deepEqual(fin.presentation, { v: 1, musicThemeId: "wedding_warm_piano_v1" });
});

test("presentation: role/type mismatches and foreign assets are rejected per-field", async () => {
  const db = makeFakeDb();
  const media = makeMediaStore();
  const photoId = await stageTestPhoto(media);
  const voiceId = await stageTestVoice(media);
  const foreignPhoto = await stageTestPhoto(media, "someone-else");
  const foreignVoice = await stageTestVoice(media, "someone-else");

  const cases = [
    [{ photo: { assetId: voiceId } }, "presentation.photo"],   // audio in photo role
    [{ voice: { assetId: photoId } }, "presentation.voice"],   // photo in voice role
    [{ photo: { assetId: foreignPhoto } }, "presentation.photo"],
    [{ voice: { assetId: foreignVoice } }, "presentation.voice"],
    [{ photo: { assetId: "nope" } }, "presentation.photo"],
  ];
  for (const [presentation, field] of cases) {
    const res = await createGift({ db, decoded: AUTHOR, media, now: 1000,
      body: { message: "x", occasion: weddingOccasion(), presentation } });
    assert.equal(res.status, 400, `expected 400 for ${field}`);
    assert.equal(res.body.field, field);
  }
  assert.equal(db._store.size, 0);
});

test("presentation: atomicity — second-role failure compensates the first and KEEPS stagings", async () => {
  const db = makeFakeDb();
  const media = makeMediaStore();
  const photoId = await stageTestPhoto(media);
  const voiceId = await stageTestVoice(media);
  // photo copies fine; voice copy fails
  const realCopy = media.copyToSealed.bind(media);
  media.copyToSealed = async (args) => {
    if (args.assetId === voiceId) throw new Error("injected voice copy failure");
    return realCopy(args);
  };
  const res = await createGift({ db, decoded: AUTHOR, media, now: 1000,
    body: { message: "x", occasion: weddingOccasion(),
      presentation: { photo: { assetId: photoId }, voice: { assetId: voiceId } } } });
  assert.equal(res.status, 502);
  assert.equal(res.body.error, "media_seal_failed");
  assert.equal(db._store.size, 0); // no partial gift
  assert.equal([...media._objects.keys()].some((k) => k.startsWith("sealed/")), false); // photo compensated
  // stagings KEPT — sender can retry the seal without re-uploading
  assert.ok(media._objects.has(`staging/${AUTHOR.uid}/${photoId}`));
  assert.ok(media._objects.has(`staging/${AUTHOR.uid}/${voiceId}`));
});

test("presentation: Firestore failure after both promotions compensates BOTH sealed assets", async () => {
  const media = makeMediaStore();
  const photoId = await stageTestPhoto(media);
  const voiceId = await stageTestVoice(media);
  const failingDb = {
    collection: () => ({
      doc: () => ({ set: async () => { throw new Error("firestore down"); } }),
      where: () => ({ where: () => ({ get: async () => ({ size: 0, docs: [] }) }) }),
    }),
  };
  await assert.rejects(() => createGift({ db: failingDb, decoded: AUTHOR, media, now: 1000,
    body: { message: "x", occasion: weddingOccasion(),
      presentation: { photo: { assetId: photoId }, voice: { assetId: voiceId } } } }));
  assert.equal([...media._objects.keys()].some((k) => k.startsWith("sealed/")), false);
});

test("presentation: retrieve mints independent role descriptors; one presign failure never suppresses the other", async () => {
  const db = makeFakeDb();
  const media = makeMediaStore();
  const photoId = await stageTestPhoto(media);
  const voiceId = await stageTestVoice(media);
  const gift = await createGift({ db, decoded: AUTHOR, media, now: 1000,
    body: { message: "正文", occasion: weddingOccasion(),
      presentation: { photo: { assetId: photoId }, voice: { assetId: voiceId } } } });

  const opened = await retrieveGift({ db, media, body: { token: gift.body.token }, now: 2000 });
  assert.equal(opened.status, 200);
  assert.ok(opened.body.presentation.photo.url.includes("sig=test"));
  assert.equal(opened.body.presentation.voice.durationMs, 12000);
  // transition synthesis: legacy openingMedia mirrors the photo role
  assert.equal(opened.body.openingMedia.type, "photo");
  assert.equal(opened.body.openingMedia.url, opened.body.presentation.photo.url);
  const raw = JSON.stringify(opened.body);
  assert.equal(raw.includes("assetId"), false);
  assert.equal(raw.includes(AUTHOR.uid), false);

  // photo presign fails → voice + invitation still fine, openingMedia null
  const realPresign = media.presignSealedGet.bind(media);
  media.presignSealedGet = async (args) => {
    if (args.assetId === photoId) throw new Error("injected photo presign failure");
    return realPresign(args);
  };
  const degraded = await retrieveGift({ db, media, body: { token: gift.body.token }, now: 3000 });
  assert.equal(degraded.status, 200);
  assert.equal(degraded.body.presentation.photo, undefined);
  assert.ok(degraded.body.presentation.voice.url);
  assert.equal(degraded.body.openingMedia, null);
  assert.equal(degraded.body.message, "正文");
});

test("presentation: heart_key leaks neither role before unlock; unlock returns both", async () => {
  const db = makeFakeDb();
  const media = makeMediaStore();
  const photoId = await stageTestPhoto(media);
  const voiceId = await stageTestVoice(media);
  const gift = await createGift({ db, decoded: AUTHOR, media, now: 1000,
    body: { message: "正文", accessMode: "heart_key", retrievalKey: "080216", occasion: weddingOccasion(),
      presentation: { photo: { assetId: photoId }, voice: { assetId: voiceId } } } });
  const probe = await retrieveGift({ db, media, body: { token: gift.body.token }, now: 2000 });
  const wrong = await retrieveGift({ db, media, body: { token: gift.body.token, key: "111112" }, now: 2100 });
  const pre = JSON.stringify(probe.body) + JSON.stringify(wrong.body);
  assert.equal(pre.includes("media.example"), false);
  const ok = await retrieveGift({ db, media, body: { token: gift.body.token, key: "080216" }, now: 2200 });
  assert.ok(ok.body.presentation.photo.url && ok.body.presentation.voice.url);
});

test("presentation: legacy records adapt on read — photo, audio, and none", async () => {
  const db = makeFakeDb();
  const media = makeMediaStore();
  // Simulate 3B-era records exactly as production wrote them.
  media._objects.set("sealed/legacy-photo-hash/photoasset_123456789a", { bytes: Buffer.alloc(9), contentType: "image/jpeg", metadata: {} });
  db._store.set(`${GIFT_COLLECTION}/${sha256Hex("legacy-photo")}`, {
    schemaVersion: 1, senderUid: "author-1", senderName: null, tone: null, accessMode: "direct",
    message: "旧照片婚礼", keySalt: null, keyHash: null, region: "GLOBAL",
    createdAt: 500, expiresAt: 999999999, redeemedAt: null, revoked: false,
    failedAttempts: 0, lockedUntil: null, cooldownTier: 0,
    occasion: weddingOccasion(),
    openingMedia: { type: "photo", assetId: "photoasset_123456789a", contentType: "image/jpeg", bytes: 9 },
  });
  const photo = await retrieveGift({ db, media, body: { token: "legacy-photo" }, now: 2000 });
  assert.equal(photo.status, 200);
  assert.ok(photo.body.presentation.photo.url);
  assert.equal(photo.body.openingMedia.type, "photo"); // old bundles keep working

  db._store.set(`${GIFT_COLLECTION}/${sha256Hex("legacy-audio")}`, {
    ...db._store.get(`${GIFT_COLLECTION}/${sha256Hex("legacy-photo")}`),
    message: "旧音频",
    openingMedia: { type: "audio", assetId: "audioasset_123456789a", contentType: "audio/mp4", bytes: 9, durationMs: 9000 },
  });
  const audio = await retrieveGift({ db, media, body: { token: "legacy-audio" }, now: 2000 });
  assert.equal(audio.body.presentation.voice.durationMs, 9000); // audio → voice role
  assert.equal(audio.body.openingMedia, null); // synthesis is photo-only

  const plain = await createGift({ db, decoded: AUTHOR, media, body: { message: "普通", accessMode: "direct" }, now: 1000 });
  const pr = await retrieveGift({ db, media, body: { token: plain.body.token }, now: 2000 });
  assert.equal(pr.body.presentation, null);
  assert.equal(pr.body.openingMedia, null);
});

test("presentation: revoke attempts deletion of EVERY private role asset (new and legacy records)", async () => {
  const db = makeFakeDb();
  const media = makeMediaStore();
  const photoId = await stageTestPhoto(media);
  const voiceId = await stageTestVoice(media);
  const gift = await createGift({ db, decoded: AUTHOR, media, now: 1000,
    body: { message: "x", occasion: weddingOccasion(),
      presentation: { photo: { assetId: photoId }, voice: { assetId: voiceId } } } });
  const th = sha256Hex(gift.body.token);
  const rev = await revokeGift({ db, decoded: AUTHOR, media, body: { token: gift.body.token } });
  assert.equal(rev.status, 200);
  assert.equal(media._objects.has(`sealed/${th}/${photoId}`), false);
  assert.equal(media._objects.has(`sealed/${th}/${voiceId}`), false);

  // deletion failure never un-revokes
  const photo2 = await stageTestPhoto(media);
  const g2 = await createGift({ db, decoded: AUTHOR, media, now: 1000,
    body: { message: "y", occasion: weddingOccasion(), presentation: { photo: { assetId: photo2 } } } });
  media.deleteSealed = async () => { throw new Error("injected"); };
  const rev2 = await revokeGift({ db, decoded: AUTHOR, media, body: { token: g2.body.token } });
  assert.equal(rev2.status, 200);
  const after = await retrieveGift({ db, media, body: { token: g2.body.token }, now: 3000 });
  assert.equal(after.status, 410);
});


// --- Founder QA: RSVP must never confirm a stale count ----------------------

test("accept after decline never inherits the decline's zero counts", async () => {
  const db = makeFakeDb();
  const g = await createGift({ db, decoded: AUTHOR, body: { message: "hi", occasion: weddingOccasion(), accessMode: "direct" } });
  const token = g.body.token;

  // Decline stores an explicit 0/0.
  await rsvpGift({ db, body: { token, status: "declined" } });
  let rec = [...db._store.values()].find((v) => v.rsvpStatus === "declined");
  assert.equal(rec.rsvpAdultCount, 0);

  // Accepting WITHOUT counts must clear them, not inherit 0/0 — otherwise the
  // guest sees "Attendance confirmed · 0 attending" (founder physical QA).
  const acc = await rsvpGift({ db, body: { token, status: "accepted" } });
  assert.equal(acc.status, 200);
  rec = [...db._store.values()].find((v) => v.rsvpStatus === "accepted");
  assert.equal(typeof rec.rsvpAdultCount === "number", false);
  assert.equal(typeof rec.rsvpChildCount === "number", false);

  // And accepting WITH counts stores exactly those.
  await rsvpGift({ db, body: { token, status: "accepted", adultCount: 3, childCount: 0 } });
  rec = [...db._store.values()].find((v) => v.rsvpStatus === "accepted");
  assert.equal(rec.rsvpAdultCount, 3);
  assert.equal(rec.rsvpChildCount, 0);
});

test("dietary note round-trips, updates in place, and is cleared by removal", async () => {
  const db = makeFakeDb();
  const g = await createGift({ db, decoded: AUTHOR, body: { message: "hi", occasion: weddingOccasion(), accessMode: "direct" } });
  const token = g.body.token;

  const a = await rsvpGift({ db, body: { token, status: "accepted", adultCount: 3, childCount: 0, dietaryRequirements: "  Vegetarian, nut allergy  " } });
  assert.equal(a.status, 200);
  assert.equal(a.body.dietaryRequirements, "Vegetarian, nut allergy");   // trimmed
  let rec = [...db._store.values()].find((v) => v.rsvpStatus === "accepted");
  assert.equal(rec.rsvpDietary, "Vegetarian, nut allergy");

  // An update replaces the note on the SAME response — never a second record.
  const before = [...db._store.values()].filter((v) => v.rsvpStatus).length;
  await rsvpGift({ db, body: { token, status: "accepted", adultCount: 2, childCount: 0, dietaryRequirements: "Gluten-free" } });
  rec = [...db._store.values()].find((v) => v.rsvpStatus === "accepted");
  assert.equal(rec.rsvpDietary, "Gluten-free");
  assert.equal(rec.rsvpAdultCount, 2);
  assert.equal([...db._store.values()].filter((v) => v.rsvpStatus).length, before);

  // Removing the note actually removes it.
  await rsvpGift({ db, body: { token, status: "accepted", adultCount: 2, childCount: 0 } });
  rec = [...db._store.values()].find((v) => v.rsvpStatus === "accepted");
  assert.equal(rec.rsvpDietary, null);
});

test("dietary note is refused on a decline and bounded in length/type", async () => {
  const db = makeFakeDb();
  const g = await createGift({ db, decoded: AUTHOR, body: { message: "hi", occasion: weddingOccasion(), accessMode: "direct" } });
  const token = g.body.token;

  // Nobody is attending, so the question is never asked.
  const dec = await rsvpGift({ db, body: { token, status: "declined", dietaryRequirements: "Vegetarian" } });
  assert.equal(dec.status, 400);
  assert.equal(dec.body.error, "invalid_rsvp_dietary");

  const long = await rsvpGift({ db, body: { token, status: "accepted", dietaryRequirements: "x".repeat(201) } });
  assert.equal(long.status, 400);
  assert.equal(long.body.field, "length");

  const bad = await rsvpGift({ db, body: { token, status: "accepted", dietaryRequirements: { note: "x" } } });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.field, "type");

  // A plain decline still stores the resolved zeros and clears any note.
  const ok = await rsvpGift({ db, body: { token, status: "declined" } });
  assert.equal(ok.status, 200);
  const rec = [...db._store.values()].find((v) => v.rsvpStatus === "declined");
  assert.equal(rec.rsvpAdultCount, 0);
  assert.equal(rec.rsvpDietary, null);
});
