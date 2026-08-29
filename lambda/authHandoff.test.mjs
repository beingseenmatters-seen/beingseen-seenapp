import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createHandoff,
  inspectHandoff,
  redeemHandoff,
  generateHandoffCode,
  isValidCodeFormat,
  sha256Hex,
  HANDOFF_COLLECTION,
  HANDOFF_TTL_MS,
  HANDOFF_MAX_INSPECTS,
} from "./authHandoff.mjs";

// --- In-memory Firestore stub with naive serialized transactions -----------
function makeFakeDb() {
  const store = new Map(); // `${collection}/${id}` -> data object
  function docRef(name, id) {
    const key = `${name}/${id}`;
    return {
      id,
      _key: key,
      get: async () => snapOf(key),
      set: async (v) => void store.set(key, { ...v }),
      update: async (patch) => void store.set(key, { ...store.get(key), ...patch }),
      delete: async () => void store.delete(key),
    };
  }
  function snapOf(key) {
    const d = store.get(key);
    return { exists: d !== undefined, data: () => (d === undefined ? undefined : { ...d }) };
  }
  return {
    _store: store,
    collection(name) {
      return { doc: (id) => docRef(name, id) };
    },
    async runTransaction(fn) {
      // Single-threaded tests: serialized transaction is faithful enough.
      const tx = {
        get: async (ref) => snapOf(ref._key),
        set: (ref, v) => void store.set(ref._key, { ...v }),
        update: (ref, patch) => void store.set(ref._key, { ...store.get(ref._key), ...patch }),
        delete: (ref) => void store.delete(ref._key),
      };
      return fn(tx);
    },
  };
}

function makeFakeAuthAdmin(users = {}) {
  return {
    async getUser(uid) {
      if (!users[uid]) {
        const err = new Error("no user");
        err.code = "auth/user-not-found";
        throw err;
      }
      return users[uid];
    },
    async createCustomToken(uid) {
      return `ct_${uid}`;
    },
  };
}

const NOW = 1_800_000_000_000;
const UID_A = "uid_matters_A";
const UID_B = "uid_gift_B";

async function makeLiveCode(db, { uid = UID_A, aud = "seen", now = NOW } = {}) {
  const res = await createHandoff({ db, decoded: { uid }, body: { aud }, origin: undefined, now });
  assert.equal(res.status, 200);
  return res.body.code;
}

// --- create -----------------------------------------------------------------

test("create: happy path returns 43-char base64url code, 45s expiry", async () => {
  const db = makeFakeDb();
  const res = await createHandoff({ db, decoded: { uid: UID_A }, body: { aud: "seen" }, now: NOW });
  assert.equal(res.status, 200);
  assert.ok(isValidCodeFormat(res.body.code));
  assert.equal(res.body.expiresIn, 45);
});

test("create: stores minimal record — uid/aud/state/expiry only, NO email", async () => {
  const db = makeFakeDb();
  const res = await createHandoff({ db, decoded: { uid: UID_A }, body: { aud: "gift" }, now: NOW });
  const doc = db._store.get(`${HANDOFF_COLLECTION}/${sha256Hex(res.body.code)}`);
  assert.deepEqual(Object.keys(doc).sort(), [
    "aud", "createdAt", "expiresAtMs", "inspects", "schemaVersion", "state", "uid",
  ]);
  assert.equal(doc.uid, UID_A);
  assert.equal(doc.aud, "gift");
  assert.equal(doc.state, "live");
  assert.equal(doc.expiresAtMs, NOW + HANDOFF_TTL_MS);
  assert.ok(!("email" in doc));
  assert.ok(!("incomingEmail" in doc));
});

test("create: raw code is never stored (doc id is sha256)", async () => {
  const db = makeFakeDb();
  const res = await createHandoff({ db, decoded: { uid: UID_A }, body: { aud: "seen" }, now: NOW });
  const serialized = JSON.stringify([...db._store.entries()]);
  assert.ok(!serialized.includes(res.body.code));
});

test("create: unauthenticated → 401", async () => {
  const db = makeFakeDb();
  const res = await createHandoff({ db, decoded: null, body: { aud: "seen" }, now: NOW });
  assert.equal(res.status, 401);
});

test("create: unknown aud → 400 invalid_aud", async () => {
  const db = makeFakeDb();
  const res = await createHandoff({ db, decoded: { uid: UID_A }, body: { aud: "evil" }, now: NOW });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "invalid_aud");
});

test("create: moments ENABLED (Founder decision 2026-08-23) → code minted", async () => {
  const db = makeFakeDb();
  const res = await createHandoff({ db, decoded: { uid: UID_A }, body: { aud: "moments" }, now: NOW });
  assert.equal(res.status, 200);
  assert.ok(res.body.code);
});

test("create: an env override can still disable moments", async () => {
  process.env.HANDOFF_CREATE_AUDIENCES = "seen,gift";
  try {
    const db = makeFakeDb();
    const res = await createHandoff({ db, decoded: { uid: UID_A }, body: { aud: "moments" }, now: NOW });
    assert.equal(res.status, 403);
    assert.equal(res.body.error, "aud_not_enabled");
  } finally {
    delete process.env.HANDOFF_CREATE_AUDIENCES;
  }
});

test("create: browser origin must be a MATTERS www origin", async () => {
  const db = makeFakeDb();
  const bad = await createHandoff({ db, decoded: { uid: UID_A }, body: { aud: "seen" }, origin: "https://evil.example.com", now: NOW });
  assert.equal(bad.status, 403);
  assert.equal(bad.body.error, "origin_mismatch");
  const good = await createHandoff({ db, decoded: { uid: UID_A }, body: { aud: "seen" }, origin: "https://www.beingseenmatters.com", now: NOW });
  assert.equal(good.status, 200);
});

test("create: per-UID rate limit — 7th in the same minute → 429", async () => {
  const db = makeFakeDb();
  for (let i = 0; i < 6; i++) {
    const r = await createHandoff({ db, decoded: { uid: UID_A }, body: { aud: "seen" }, now: NOW + i });
    assert.equal(r.status, 200, `create #${i + 1}`);
  }
  const blocked = await createHandoff({ db, decoded: { uid: UID_A }, body: { aud: "seen" }, now: NOW + 10 });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error, "rate_limited");
  // A different UID is unaffected.
  const other = await createHandoff({ db, decoded: { uid: UID_B }, body: { aud: "seen" }, now: NOW + 11 });
  assert.equal(other.status, 200);
});

// --- redeem -----------------------------------------------------------------

test("redeem: no-local-user happy path mints custom token for stored UID and consumes", async () => {
  const db = makeFakeDb();
  const authAdmin = makeFakeAuthAdmin();
  const code = await makeLiveCode(db, { uid: UID_A, aud: "seen" });
  const res = await redeemHandoff({ db, authAdmin, body: { code, aud: "seen" }, now: NOW + 1000 });
  assert.equal(res.status, 200);
  assert.equal(res.body.customToken, `ct_${UID_A}`);
  const doc = db._store.get(`${HANDOFF_COLLECTION}/${sha256Hex(code)}`);
  assert.equal(doc.state, "consumed");
});

test("redeem: replay of consumed code → 410 code_used", async () => {
  const db = makeFakeDb();
  const authAdmin = makeFakeAuthAdmin();
  const code = await makeLiveCode(db);
  const first = await redeemHandoff({ db, authAdmin, body: { code, aud: "seen" }, now: NOW + 1000 });
  assert.equal(first.status, 200);
  const replay = await redeemHandoff({ db, authAdmin, body: { code, aud: "seen" }, now: NOW + 2000 });
  assert.equal(replay.status, 410);
  assert.equal(replay.body.error, "code_used");
  assert.ok(!replay.body.customToken);
});

test("redeem: expired code → 410 code_expired, no token", async () => {
  const db = makeFakeDb();
  const authAdmin = makeFakeAuthAdmin();
  const code = await makeLiveCode(db);
  const res = await redeemHandoff({ db, authAdmin, body: { code, aud: "seen" }, now: NOW + HANDOFF_TTL_MS + 1 });
  assert.equal(res.status, 410);
  assert.equal(res.body.error, "code_expired");
});

test("redeem: audience mismatch → 403, code NOT consumed and still redeemable at right aud", async () => {
  const db = makeFakeDb();
  const authAdmin = makeFakeAuthAdmin();
  const code = await makeLiveCode(db, { aud: "seen" });
  const wrong = await redeemHandoff({ db, authAdmin, body: { code, aud: "gift" }, now: NOW + 1000 });
  assert.equal(wrong.status, 403);
  assert.equal(wrong.body.error, "aud_mismatch");
  const right = await redeemHandoff({ db, authAdmin, body: { code, aud: "seen" }, now: NOW + 2000 });
  assert.equal(right.status, 200);
});

test("redeem: unknown code → 404; malformed code → 400 (no db doc created)", async () => {
  const db = makeFakeDb();
  const authAdmin = makeFakeAuthAdmin();
  const unknown = await redeemHandoff({ db, authAdmin, body: { code: generateHandoffCode(), aud: "seen" }, now: NOW });
  assert.equal(unknown.status, 404);
  const malformed = await redeemHandoff({ db, authAdmin, body: { code: "short!bad", aud: "seen" }, now: NOW });
  assert.equal(malformed.status, 400);
  assert.equal(malformed.body.error, "invalid_code");
});

test("redeem: wrong destination origin → 403 origin_mismatch", async () => {
  const db = makeFakeDb();
  const authAdmin = makeFakeAuthAdmin();
  const code = await makeLiveCode(db, { aud: "gift" });
  const res = await redeemHandoff({ db, authAdmin, body: { code, aud: "gift" }, origin: "https://app.beingseenmatters.com", now: NOW + 1 });
  assert.equal(res.status, 403);
  assert.equal(res.body.error, "origin_mismatch");
  const ok = await redeemHandoff({ db, authAdmin, body: { code, aud: "gift" }, origin: "https://gift.beingseenmatters.com", now: NOW + 2 });
  assert.equal(ok.status, 200);
});

test("redeem: per-IP cooldown after repeated unknown-code probing → 429", async () => {
  const db = makeFakeDb();
  const authAdmin = makeFakeAuthAdmin();
  const ip = "203.0.113.7";
  for (let i = 0; i < 10; i++) {
    const r = await redeemHandoff({ db, authAdmin, body: { code: generateHandoffCode(), aud: "seen" }, sourceIp: ip, now: NOW + i });
    assert.equal(r.status, 404, `probe #${i + 1}`);
  }
  const blocked = await redeemHandoff({ db, authAdmin, body: { code: generateHandoffCode(), aud: "seen" }, sourceIp: ip, now: NOW + 100 });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error, "cooldown");
  // Different IP unaffected.
  const other = await redeemHandoff({ db, authAdmin, body: { code: generateHandoffCode(), aud: "seen" }, sourceIp: "198.51.100.9", now: NOW + 101 });
  assert.equal(other.status, 404);
});

// --- inspect ----------------------------------------------------------------

test("inspect: requires local user's ID token → 401 without", async () => {
  const db = makeFakeDb();
  const code = await makeLiveCode(db);
  const res = await inspectHandoff({ db, authAdmin: makeFakeAuthAdmin(), decoded: null, body: { code, aud: "seen" }, now: NOW });
  assert.equal(res.status, 401);
});

test("inspect: same account → { sameAccount: true }, code consumed ATOMICALLY server-side", async () => {
  const db = makeFakeDb();
  const authAdmin = makeFakeAuthAdmin();
  const code = await makeLiveCode(db, { uid: UID_A });
  const res = await inspectHandoff({ db, authAdmin, decoded: { uid: UID_A }, body: { code, aud: "seen" }, now: NOW + 1000 });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { sameAccount: true });
  const doc = db._store.get(`${HANDOFF_COLLECTION}/${sha256Hex(code)}`);
  assert.equal(doc.state, "discarded");
  // The consumed code can no longer be redeemed (replay-safe).
  const redeem = await redeemHandoff({ db, authAdmin, body: { code, aud: "seen" }, now: NOW + 2000 });
  assert.equal(redeem.status, 410);
  assert.equal(redeem.body.error, "code_used");
});

test("inspect: different account → sameAccount:false + incomingEmail, NO uid in response, code stays live", async () => {
  const db = makeFakeDb();
  const authAdmin = makeFakeAuthAdmin({ [UID_A]: { email: "beingseenmatters@gmail.com" } });
  const code = await makeLiveCode(db, { uid: UID_A });
  const res = await inspectHandoff({ db, authAdmin, decoded: { uid: UID_B }, body: { code, aud: "seen" }, now: NOW + 1000 });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { sameAccount: false, incomingEmail: "beingseenmatters@gmail.com" });
  assert.ok(!JSON.stringify(res.body).includes(UID_A), "incoming UID must never be returned");
  const doc = db._store.get(`${HANDOFF_COLLECTION}/${sha256Hex(code)}`);
  assert.equal(doc.state, "live");
  assert.equal(doc.inspects, 1);
  // "Continue as" path still works after inspect:
  const redeem = await redeemHandoff({ db, authAdmin, body: { code, aud: "seen" }, now: NOW + 2000 });
  assert.equal(redeem.status, 200);
  assert.equal(redeem.body.customToken, `ct_${UID_A}`);
});

test("inspect: email resolution failure degrades to incomingEmail: null (still no uid)", async () => {
  const db = makeFakeDb();
  const authAdmin = makeFakeAuthAdmin({}); // getUser throws
  const code = await makeLiveCode(db, { uid: UID_A });
  const res = await inspectHandoff({ db, authAdmin, decoded: { uid: UID_B }, body: { code, aud: "seen" }, now: NOW + 1 });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { sameAccount: false, incomingEmail: null });
});

test("inspect: >5 inspects → 429 too_many_inspects", async () => {
  const db = makeFakeDb();
  const authAdmin = makeFakeAuthAdmin({ [UID_A]: { email: "a@example.com" } });
  const code = await makeLiveCode(db, { uid: UID_A });
  for (let i = 0; i < HANDOFF_MAX_INSPECTS; i++) {
    const r = await inspectHandoff({ db, authAdmin, decoded: { uid: UID_B }, body: { code, aud: "seen" }, now: NOW + i });
    assert.equal(r.status, 200, `inspect #${i + 1}`);
  }
  const blocked = await inspectHandoff({ db, authAdmin, decoded: { uid: UID_B }, body: { code, aud: "seen" }, now: NOW + 50 });
  assert.equal(blocked.status, 429);
  assert.equal(blocked.body.error, "too_many_inspects");
});

test("inspect: expired / used / unknown / aud-mismatch are safe failures", async () => {
  const db = makeFakeDb();
  const authAdmin = makeFakeAuthAdmin();
  const code = await makeLiveCode(db, { uid: UID_A, aud: "seen" });

  const wrongAud = await inspectHandoff({ db, authAdmin, decoded: { uid: UID_B }, body: { code, aud: "gift" }, now: NOW + 1 });
  assert.equal(wrongAud.status, 403);

  const expired = await inspectHandoff({ db, authAdmin, decoded: { uid: UID_B }, body: { code, aud: "seen" }, now: NOW + HANDOFF_TTL_MS + 1 });
  assert.equal(expired.status, 410);
  assert.equal(expired.body.error, "code_expired");

  const unknown = await inspectHandoff({ db, authAdmin, decoded: { uid: UID_B }, body: { code: generateHandoffCode(), aud: "seen" }, now: NOW + 2 });
  assert.equal(unknown.status, 404);

  // Consume via same-account, then inspect again → code_used.
  await inspectHandoff({ db, authAdmin, decoded: { uid: UID_A }, body: { code, aud: "seen" }, now: NOW + 3 });
  const used = await inspectHandoff({ db, authAdmin, decoded: { uid: UID_B }, body: { code, aud: "seen" }, now: NOW + 4 });
  assert.equal(used.status, 410);
  assert.equal(used.body.error, "code_used");
});
