/**
 * Credits ledger core (Monetisation Phase 2).
 *
 * Proves the LOCKED product rules at the module boundary: weekly top-up-TO-200
 * (never accumulate, paid untouched, race-safe), Free-then-Paid consumption
 * with per-entry split accounting, deterministic-ID idempotency (one charge,
 * ever, per intended publication), fail-closed product registry (Mind.Seen and
 * anything unknown can never deduct), and hard atomicity (a failed domain
 * write charges nothing; a failed charge publishes nothing).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  FREE_PRODUCTS,
  getBalance,
  balanceHandler,
  chargeCredits,
  weekKey,
  nextWeekStartMs,
  CHARGEABLE_PRODUCTS,
  CREDIT_ACCOUNTS,
  CREDIT_LEDGER,
  WEEKLY_FREE_CREDITS,
} from "./billing.mjs";

const clone = (v) => (v === undefined ? v : JSON.parse(JSON.stringify(v)));

function throwAE() {
  const e = new Error("6 ALREADY_EXISTS");
  e.code = 6;
  throw e;
}

export function makeFakeDb() {
  const store = new Map();
  const hooks = { failCreatePrefix: null, midTx: null };
  const snap = (path) => ({
    exists: store.has(path),
    id: path.split("/").pop(),
    data: () => clone(store.get(path)),
  });
  const doc = (path) => ({
    _key: path,
    id: path.split("/").pop(),
    get: async () => snap(path),
    set: async (v, opts) => {
      store.set(path, opts?.merge ? { ...store.get(path), ...clone(v) } : clone(v));
    },
    create: async (v) => {
      if (store.has(path)) throwAE();
      store.set(path, clone(v));
    },
    update: async (v) => {
      store.set(path, { ...store.get(path), ...clone(v) });
    },
    delete: async () => void store.delete(path),
  });
  const collection = (name) => ({
    doc: (id) => doc(`${name}/${id}`),
    where: (field, _op, value) => ({
      get: async () => ({
        docs: [...store.entries()]
          .filter(([k, v]) => k.startsWith(`${name}/`) && v[field] === value)
          .map(([k, v]) => ({ id: k.split("/").pop(), data: () => clone(v) })),
      }),
    }),
  });
  const runTransaction = async (fn) => {
    // Real Firestore semantics: optimistic concurrency. Every read records
    // the document version; at commit, if ANY read document changed (e.g. a
    // concurrent "winner" committed via the _midTx hook), the transaction is
    // ABORTED and the closure re-runs against the new state — exactly how a
    // race loser comes to observe a consumed single-use authorization.
    for (let attempt = 0; attempt < 5; attempt++) {
      const writes = [];
      const reads = new Map();
      const versionOf = (key) => (store.has(key) ? JSON.stringify(store.get(key)) : "~absent~");
      const tx = {
        get: async (ref) => {
          reads.set(ref._key, versionOf(ref._key));
          return snap(ref._key);
        },
        create: (ref, v) => void writes.push({ op: "create", key: ref._key, v: clone(v) }),
        set: (ref, v, opts) =>
          void writes.push({ op: "set", key: ref._key, v: clone(v), merge: !!opts?.merge }),
        update: (ref, v) => void writes.push({ op: "update", key: ref._key, v: clone(v) }),
      };
      const out = await fn(tx);
      if (hooks.midTx) {
        const h = hooks.midTx;
        hooks.midTx = null;
        h(); // a concurrent "winner" commits between our read phase and commit
      }
      let conflict = false;
      for (const [k, v] of reads) {
        if (versionOf(k) !== v) {
          conflict = true;
          break;
        }
      }
      if (conflict) continue; // ABORTED → closure re-runs on fresh state
      // Commit: validate first (all-or-nothing), then apply.
      for (const w of writes) {
        if (hooks.failCreatePrefix && w.op === "create" && w.key.startsWith(hooks.failCreatePrefix)) {
          hooks.failCreatePrefix = null;
          throw new Error("injected_commit_failure");
        }
        if (w.op === "create" && store.has(w.key)) throwAE();
      }
      for (const w of writes) {
        if (w.op === "set" && w.merge) store.set(w.key, { ...store.get(w.key), ...w.v });
        else if (w.op === "update") store.set(w.key, { ...store.get(w.key), ...w.v });
        else store.set(w.key, w.v);
      }
      return out;
    }
    const err = new Error("10 ABORTED: too much contention");
    err.code = 10;
    throw err;
  };
  return {
    collection,
    runTransaction,
    _store: store,
    _failNextCreate: (prefix) => (hooks.failCreatePrefix = prefix),
    _midTx: (fn) => (hooks.midTx = fn),
  };
}

const ledgerDocs = (db) => [...db._store.keys()].filter((k) => k.startsWith(`${CREDIT_LEDGER}/`));
const NOW = Date.UTC(2026, 8, 3, 12, 0, 0); // Thu 2026-09-03
const LAST_WEEK = NOW - 7 * 24 * 60 * 60 * 1000;

// ---- registry lock ---------------------------------------------------------

test("registry: the LOCKED product/price table (Phase 2 + Phase 3), nothing else", () => {
  assert.deepEqual(Object.keys(CHARGEABLE_PRODUCTS).sort(), [
    "business_event_invitation",
    "casual_gathering_publish",
    "gift_tag_publish",
    "live_draw_capacity",
    "live_guess_capacity",
    "live_guestbook_capacity",
    "preprinted_gift_tag_activation",
    "private_event_invitation",
    "simple_gift_publish",
  ]);
  // Phase 2 prices UNCHANGED.
  assert.equal(CHARGEABLE_PRODUCTS.simple_gift_publish.unitPrice, 20);
  assert.equal(CHARGEABLE_PRODUCTS.gift_tag_publish.unitPrice, 50);
  // Official preprinted Gift.Tag (2026-09-05): 100 one-time activation —
  // a SEPARATE product from the 50-Credit self-print publication.
  assert.equal(CHARGEABLE_PRODUCTS.preprinted_gift_tag_activation.unitPrice, 100);
  // Phase 3 LOCKED prices (2026-09-04): 100/independent invitation (never
  // multiplied by party size), 100 FLAT per casual gathering (2026-09-05), capacity seats
  // 100/100/50. AU$1 = 100 Credits equivalence documented, never stored.
  assert.equal(CHARGEABLE_PRODUCTS.private_event_invitation.unitPrice, 100);
  assert.equal(CHARGEABLE_PRODUCTS.business_event_invitation.unitPrice, 100);
  assert.equal(CHARGEABLE_PRODUCTS.casual_gathering_publish.unitPrice, 100); // 2026-09-05: 20→100, aligned with shared invitations
  assert.equal(CHARGEABLE_PRODUCTS.live_draw_capacity.unitPrice, 100);
  assert.equal(CHARGEABLE_PRODUCTS.live_guess_capacity.unitPrice, 100);
  assert.equal(CHARGEABLE_PRODUCTS.live_guestbook_capacity.unitPrice, 50);
});

test("registry: quick_reply and mind_seen are LOCKED-FREE (0), never chargeable", async () => {
  assert.equal(FREE_PRODUCTS.quick_reply.unitPrice, 0);
  assert.equal(FREE_PRODUCTS.mind_seen.unitPrice, 0);
  const db = makeFakeDb();
  for (const product of ["quick_reply", "mind_seen"]) {
    const res = await chargeCredits({
      db, uid: "u1", product, idempotencyKey: "keyFREE00001", domainWrites: [], now: NOW,
    });
    assert.equal(res.ok, false);
    assert.equal(res.error, "unchargeable_product");
  }
});

test("registry: gift_tag_publish charges exactly 50 through the standard path", async () => {
  const db = makeFakeDb();
  const res = await chargeCredits({
    db, uid: "u1", product: "gift_tag_publish",
    idempotencyKey: "keyTAG000001", subjectId: "g1",
    domainWrites: [], now: NOW,
  });
  assert.equal(res.ok, true);
  assert.deepEqual(res.balances, { free: 150, paid: 0 });
  assert.equal(res.entry.amount, 50);
  assert.equal(res.entry.product, "gift_tag_publish");
});

test("weekKey is UTC-ISO stable and nextWeekStartMs is a Monday boundary", () => {
  assert.equal(weekKey(NOW), "2026-W36");
  const next = nextWeekStartMs(NOW);
  assert.equal(new Date(next).getUTCDay(), 1);
  assert.ok(next > NOW && next - NOW < 7 * 24 * 3600 * 1000);
});

// ---- A. weekly free credits ------------------------------------------------

test("A: first account is created with exactly 200 free and one topup entry", async () => {
  const db = makeFakeDb();
  const bal = await getBalance({ db, uid: "u1", now: NOW });
  assert.deepEqual({ free: bal.free, paid: bal.paid, total: bal.total }, { free: 200, paid: 0, total: 200 });
  const acc = db._store.get(`${CREDIT_ACCOUNTS}/u1`);
  assert.equal(acc.free, 200);
  assert.equal(acc.paid, 0);
  assert.deepEqual(ledgerDocs(db), [`${CREDIT_LEDGER}/topup_u1_2026-W36`]);
  const entry = db._store.get(`${CREDIT_LEDGER}/topup_u1_2026-W36`);
  assert.equal(entry.type, "free_topup");
  assert.equal(entry.freeDelta, 200);
  assert.equal(entry.paidDelta, 0);
});

for (const [freeBefore, expectDelta] of [
  [0, 200],
  [40, 160],
  [175, 25],
  [200, 0],
]) {
  test(`A: weekly refresh tops ${freeBefore} → 200 (delta ${expectDelta}), paid untouched`, async () => {
    const db = makeFakeDb();
    db._store.set(`${CREDIT_ACCOUNTS}/u1`, {
      schemaVersion: 1, free: freeBefore, paid: 1234,
      freeTopUpAt: LAST_WEEK, createdAt: LAST_WEEK, updatedAt: LAST_WEEK, version: 3,
    });
    const bal = await getBalance({ db, uid: "u1", now: NOW });
    assert.equal(bal.free, 200);
    assert.equal(bal.paid, 1234);
    const entries = ledgerDocs(db);
    if (expectDelta === 0) {
      assert.equal(entries.length, 0, "a zero-delta week writes no ledger noise");
    } else {
      assert.equal(entries.length, 1);
      const e = db._store.get(entries[0]);
      assert.equal(e.freeDelta, expectDelta);
      assert.equal(e.paidDelta, 0);
      assert.equal(e.balancesAfter.paid, 1234);
    }
  });
}

test("A: same week never grants twice (idempotent by topup_{uid}_{week})", async () => {
  const db = makeFakeDb();
  await getBalance({ db, uid: "u1", now: NOW });
  db._store.get(`${CREDIT_ACCOUNTS}/u1`).free = 50; // simulate spend
  const bal = await getBalance({ db, uid: "u1", now: NOW + 3600_000 });
  assert.equal(bal.free, 50, "no mid-week re-topup");
  assert.equal(ledgerDocs(db).length, 1);
});

test("A: two RACING top-ups do not double-grant (loser recovers idempotently)", async () => {
  const db = makeFakeDb();
  db._store.set(`${CREDIT_ACCOUNTS}/u1`, {
    schemaVersion: 1, free: 40, paid: 500,
    freeTopUpAt: LAST_WEEK, createdAt: LAST_WEEK, updatedAt: LAST_WEEK, version: 1,
  });
  // The "winner" commits the same week's top-up between our read and commit.
  db._midTx(() => {
    db._store.set(`${CREDIT_ACCOUNTS}/u1`, {
      schemaVersion: 1, free: 200, paid: 500,
      freeTopUpAt: NOW - 1000, createdAt: LAST_WEEK, updatedAt: NOW - 1000, version: 2,
    });
    db._store.set(`${CREDIT_LEDGER}/topup_u1_2026-W36`, {
      type: "free_topup", freeDelta: 160, paidDelta: 0,
    });
  });
  const bal = await getBalance({ db, uid: "u1", now: NOW });
  assert.equal(bal.free, 200);
  assert.equal(bal.paid, 500);
  assert.equal(ledgerDocs(db).length, 1, "exactly one grant for the week");
  assert.equal(db._store.get(`${CREDIT_LEDGER}/topup_u1_2026-W36`).freeDelta, 160);
});

test("balanceHandler: 401 without uid; payload shape with uid", async () => {
  const db = makeFakeDb();
  assert.equal((await balanceHandler({ db, decoded: null })).status, 401);
  const res = await balanceHandler({ db, decoded: { uid: "u1" }, now: NOW });
  assert.equal(res.status, 200);
  // `spendable` (Payment Phase 2): differs from total only while a provider
  // reversal holds paid below zero — the debt never hides the weekly Free.
  assert.deepEqual(Object.keys(res.body).sort(), ["free", "nextFreeRefreshAt", "paid", "spendable", "total", "weekKey"]);
  assert.equal(res.body.spendable, res.body.total);
});

// ---- B. consumption order --------------------------------------------------

async function charge(db, uid, key, extra = {}) {
  const giftRef = db.collection("giftMessages").doc(`gift-${key}`);
  return await chargeCredits({
    db, uid, product: "simple_gift_publish", idempotencyKey: key,
    subjectId: `gift-${key}`,
    domainWrites: [{ kind: "create", ref: giftRef, data: { senderUid: uid } }],
    now: NOW, ...extra,
  });
}

test("B: 200 free / 0 paid → publish → 180 / 0, split recorded (20 free, 0 paid)", async () => {
  const db = makeFakeDb();
  const res = await charge(db, "u1", "keyAAAA0001");
  assert.equal(res.ok, true);
  assert.deepEqual(res.balances, { free: 180, paid: 0 });
  const entry = db._store.get(`${CREDIT_LEDGER}/charge_gift_u1_keyAAAA0001`);
  assert.equal(entry.type, "charge");
  assert.equal(entry.amount, 20);
  assert.equal(entry.freeDelta, -20);
  assert.equal(entry.paidDelta, 0);
  assert.equal(entry.unitPrice, 20);
  assert.ok(db._store.has("giftMessages/gift-keyAAAA0001"), "gift committed with charge");
});

test("B: 10 free + 100 paid → publish → 0 / 90, mixed split recorded (10+10)", async () => {
  const db = makeFakeDb();
  db._store.set(`${CREDIT_ACCOUNTS}/u1`, {
    schemaVersion: 1, free: 10, paid: 100,
    freeTopUpAt: NOW - 1000, createdAt: NOW - 1000, updatedAt: NOW - 1000, version: 1,
  });
  const res = await charge(db, "u1", "keyAAAA0002");
  assert.deepEqual(res.balances, { free: 0, paid: 90 });
  const entry = db._store.get(`${CREDIT_LEDGER}/charge_gift_u1_keyAAAA0002`);
  assert.equal(entry.freeDelta, -10);
  assert.equal(entry.paidDelta, -10);
});

test("B: insufficient total → no charge, no gift, no writes at all", async () => {
  const db = makeFakeDb();
  db._store.set(`${CREDIT_ACCOUNTS}/u1`, {
    schemaVersion: 1, free: 5, paid: 10,
    freeTopUpAt: NOW - 1000, createdAt: NOW - 1000, updatedAt: NOW - 1000, version: 1,
  });
  const before = new Map(db._store);
  const res = await charge(db, "u1", "keyAAAA0003");
  assert.equal(res.ok, false);
  assert.equal(res.error, "insufficient_credits");
  assert.equal(res.free, 5);
  assert.equal(res.paid, 10);
  assert.equal(res.needed, 20);
  assert.deepEqual([...db._store.keys()].sort(), [...before.keys()].sort());
});

test("B: insufficient check runs AFTER weekly top-up (40 stale free still publishes)", async () => {
  const db = makeFakeDb();
  db._store.set(`${CREDIT_ACCOUNTS}/u1`, {
    schemaVersion: 1, free: 4, paid: 0,
    freeTopUpAt: LAST_WEEK, createdAt: LAST_WEEK, updatedAt: LAST_WEEK, version: 1,
  });
  const res = await charge(db, "u1", "keyAAAA0004");
  assert.equal(res.ok, true);
  assert.deepEqual(res.balances, { free: 180, paid: 0 });
});

// ---- C. idempotency --------------------------------------------------------

test("C: same idempotency key twice → ONE gift, ONE charge, original entry echoed", async () => {
  const db = makeFakeDb();
  const first = await charge(db, "u1", "keySAME00001");
  assert.equal(first.duplicate, false);
  const again = await charge(db, "u1", "keySAME00001");
  assert.equal(again.ok, true);
  assert.equal(again.duplicate, true);
  assert.equal(again.entry.meta.tokenHash ?? again.entry.subjectId, first.entry.subjectId);
  assert.equal(ledgerDocs(db).filter((k) => k.includes("charge_")).length, 1);
  assert.equal(db._store.get(`${CREDIT_ACCOUNTS}/u1`).free, 180, "balance charged exactly once");
});

test("C: different keys are different intended publications → two charges", async () => {
  const db = makeFakeDb();
  await charge(db, "u1", "keyDIFF00001");
  await charge(db, "u1", "keyDIFF00002");
  assert.equal(db._store.get(`${CREDIT_ACCOUNTS}/u1`).free, 160);
});

test("C: malformed / missing idempotency key fails closed (no charge)", async () => {
  const db = makeFakeDb();
  for (const bad of [undefined, null, "", "short", "x".repeat(65), "has spaces!"]) {
    const res = await chargeCredits({
      db, uid: "u1", product: "simple_gift_publish", idempotencyKey: bad,
      domainWrites: [], now: NOW,
    });
    assert.equal(res.ok, false);
    assert.equal(res.error, "invalid_idempotency_key");
  }
  assert.equal(ledgerDocs(db).length, 0);
});

test("C: concurrent identical requests — race loser returns the winner's entry", async () => {
  const db = makeFakeDb();
  db._store.set(`${CREDIT_ACCOUNTS}/u1`, {
    schemaVersion: 1, free: 200, paid: 0,
    freeTopUpAt: NOW - 1000, createdAt: NOW - 1000, updatedAt: NOW - 1000, version: 1,
  });
  db._midTx(() => {
    // winner commits the SAME charge between loser's read and commit
    db._store.set(`${CREDIT_LEDGER}/charge_gift_u1_keyRACE00001`, {
      type: "charge", amount: 20, subjectId: "gift-w", meta: { tokenHash: "gift-w" },
    });
    db._store.set(`${CREDIT_ACCOUNTS}/u1`, {
      schemaVersion: 1, free: 180, paid: 0,
      freeTopUpAt: NOW - 1000, createdAt: NOW - 1000, updatedAt: NOW, version: 2,
    });
    db._store.set("giftMessages/gift-w", { senderUid: "u1" });
  });
  const res = await charge(db, "u1", "keyRACE00001");
  assert.equal(res.ok, true);
  assert.equal(res.duplicate, true);
  assert.equal(res.entry.subjectId, "gift-w");
  assert.equal(db._store.get(`${CREDIT_ACCOUNTS}/u1`).free, 180, "charged once, not twice");
});

// ---- D. atomicity ----------------------------------------------------------

test("D: gift-write commit failure → NO charge, NO account change, NO gift", async () => {
  const db = makeFakeDb();
  await getBalance({ db, uid: "u1", now: NOW });
  db._failNextCreate("giftMessages/");
  await assert.rejects(() => charge(db, "u1", "keyFAIL00001"));
  assert.equal(db._store.get(`${CREDIT_ACCOUNTS}/u1`).free, 200);
  assert.ok(!db._store.has(`${CREDIT_LEDGER}/charge_gift_u1_keyFAIL00001`));
  assert.ok(!db._store.has("giftMessages/gift-keyFAIL00001"));
});

test("D: ledger commit failure → NO gift", async () => {
  const db = makeFakeDb();
  await getBalance({ db, uid: "u1", now: NOW });
  db._failNextCreate(`${CREDIT_LEDGER}/charge_gift_u1_keyFAIL00002`);
  await assert.rejects(() => charge(db, "u1", "keyFAIL00002"));
  assert.ok(!db._store.has("giftMessages/gift-keyFAIL00002"));
  assert.equal(db._store.get(`${CREDIT_ACCOUNTS}/u1`).free, 200);
});

// ---- E. Mind.Seen / registry fail-closed -----------------------------------

test("E: unknown product codes fail closed — no default price, no deduction", async () => {
  const db = makeFakeDb();
  await getBalance({ db, uid: "u1", now: NOW });
  for (const product of ["mind_publish", "mind", "event_guest", "anything", undefined]) {
    const res = await chargeCredits({
      db, uid: "u1", product, idempotencyKey: "keyMIND00001", domainWrites: [], now: NOW,
    });
    assert.equal(res.ok, false);
    assert.equal(res.error, "unchargeable_product");
  }
  assert.equal(db._store.get(`${CREDIT_ACCOUNTS}/u1`).free, 200, "nothing deducted");
  assert.equal(ledgerDocs(db).filter((k) => k.includes("charge_")).length, 0);
});
