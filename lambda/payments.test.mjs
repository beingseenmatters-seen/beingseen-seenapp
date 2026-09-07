/**
 * Payment Phase 2 — unified real-money payment core, proven with SIMULATED
 * verified purchases only (the controlled `test_fixture` mechanism plus
 * stripe/apple/google-shaped fixtures). ZERO provider connectivity.
 *
 * LOCKED rules under test:
 *   · grant quantity comes ONLY from PURCHASABLE_PRODUCTS (full pack, never
 *     net-of-commission, never client-supplied);
 *   · one provider transaction = one grant, under any duplication/concurrency;
 *   · provider-enforced reversal is append-only, touches ONLY Paid
 *     (freeDelta structurally 0), may drive paid NEGATIVE (the debt);
 *   · debt blocks Paid spending only — weekly Free stays usable and future
 *     purchases clear debt by plain addition;
 *   · unknown/ambiguous purchases are HELD: diagnosable, worth zero;
 *   · Σledger deltas always equal the materialized account balances.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { makeFakeDb } from "./billing.test.mjs";
import {
  chargeCredits,
  getBalance,
  adminTestGrantPhase3,
  spendableCredits,
  CREDIT_ACCOUNTS,
  CREDIT_LEDGER,
} from "./billing.mjs";
import {
  PURCHASABLE_PRODUCTS,
  PAYMENT_PURCHASES,
  PAYMENT_PROVIDERS,
  normalizeVerifiedPurchase,
  purchaseIdFor,
  reversalIdFor,
  grantVerifiedCreditPurchase,
  applyProviderReversal,
  recordHeldPurchase,
  getPurchaseStatus,
  listUserPurchases,
} from "./payments.mjs";

const A = { uid: "buyer-1" };
const NOW = Date.UTC(2026, 8, 3, 12, 0, 0); // Thu 2026-09-03
const WEEK_LATER = NOW + 7 * 24 * 60 * 60 * 1000;

const account = (db, uid = A.uid) => db._store.get(`${CREDIT_ACCOUNTS}/${uid}`);
const ledgerEntries = (db) => [...db._store.entries()].filter(([k]) => k.startsWith(`${CREDIT_LEDGER}/`)).map(([k, v]) => ({ id: k, ...v }));
const purchaseDocs = (db) => [...db._store.entries()].filter(([k]) => k.startsWith(`${PAYMENT_PURCHASES}/`)).map(([k, v]) => ({ id: k, ...v }));
const seed = (db, { free = 0, paid = 0 } = {}, uid = A.uid) =>
  db._store.set(`${CREDIT_ACCOUNTS}/${uid}`, {
    schemaVersion: 1, free, paid, freeTopUpAt: NOW, createdAt: NOW, updatedAt: NOW, version: 1,
  });

/** The NON-PUBLIC test adapter: builds normalized verified purchases the way
 *  a real adapter would — through the one validating constructor. */
const fixture = (over = {}) =>
  normalizeVerifiedPurchase({
    provider: "test_fixture",
    providerTransactionId: "tx-1",
    providerProductId: "fixture.credits.500",
    internalProduct: "credits_500",
    uid: A.uid,
    purchaseType: "credit_pack",
    currency: "AUD",
    grossAmountMinor: 500,
    purchasedAt: NOW,
    environment: "test",
    verificationRef: "fixture",
    ...over,
  });

const grant = (db, purchase, now = NOW) =>
  grantVerifiedCreditPurchase({ db, purchase, expectedEnvironment: "test", now });
const reverse = (db, over = {}, now = NOW) =>
  applyProviderReversal({
    db,
    provider: "test_fixture",
    providerTransactionId: "tx-1",
    providerReversalRef: "rev-1",
    expectedEnvironment: "test",
    now,
    ...over,
  });

// ---- catalog ---------------------------------------------------------------

test("catalog: five Credits packs grant exactly their pack; annual Tag services reserved but inactive", () => {
  assert.deepEqual(
    Object.fromEntries(
      Object.entries(PURCHASABLE_PRODUCTS)
        .filter(([, s]) => s.purchaseType === "credit_pack")
        .map(([k, s]) => [k, s.grantPaidCredits]),
    ),
    { credits_500: 500, credits_1000: 1000, credits_2000: 2000, credits_5000: 5000, credits_10000: 10000 },
  );
  for (const k of ["pet_annual", "car_annual", "luggage_annual"]) {
    assert.equal(PURCHASABLE_PRODUCTS[k].purchaseType, "tag_annual_service");
    assert.equal(PURCHASABLE_PRODUCTS[k].active, false);
    assert.equal(PURCHASABLE_PRODUCTS[k].grantPaidCredits, undefined, "entitlements are never Credits");
  }
  assert.deepEqual([...PAYMENT_PROVIDERS], ["stripe", "apple", "google", "test_fixture"]);
});

// ---- normalized verified purchase / trust boundary -------------------------

test("normalize: validates strictly, whitelists fields (card data cannot even be stored), freezes", () => {
  assert.throws(() => normalizeVerifiedPurchase({ ...fixtureFields(), provider: "paypal" }), /invalid_verified_purchase:provider/);
  assert.throws(() => normalizeVerifiedPurchase({ ...fixtureFields(), uid: "" }), /invalid_verified_purchase:uid/);
  assert.throws(() => normalizeVerifiedPurchase({ ...fixtureFields(), currency: "aud" }), /invalid_verified_purchase:currency/);
  assert.throws(() => normalizeVerifiedPurchase({ ...fixtureFields(), grossAmountMinor: 5.5 }), /invalid_verified_purchase:grossAmountMinor/);
  assert.throws(() => normalizeVerifiedPurchase({ ...fixtureFields(), environment: "prod" }), /invalid_verified_purchase:environment/);
  const p = normalizeVerifiedPurchase({ ...fixtureFields(), cardNumber: "4111111111111111", cvv: "123", status: "refunded" });
  assert.equal(p.cardNumber, undefined);
  assert.equal(p.cvv, undefined);
  assert.equal(p.status, "verified", "status is forced — an adapter cannot mint anything else");
  assert.ok(Object.isFrozen(p));
  function fixtureFields() {
    return {
      provider: "test_fixture", providerTransactionId: "tx-n", providerProductId: "x",
      internalProduct: "credits_500", uid: A.uid, purchaseType: "credit_pack",
      currency: "AUD", grossAmountMinor: 500, purchasedAt: NOW, environment: "test",
    };
  }
});

test("trust boundary: hand-crafted objects (even byte-identical clones) can never grant", async () => {
  const db = makeFakeDb();
  const real = fixture();
  const forged = JSON.parse(JSON.stringify(real)); // same fields, no brand
  const res = await grant(db, forged);
  assert.deepEqual(res, { ok: false, error: "untrusted_purchase" });
  const res2 = await grant(db, { uid: A.uid, internalProduct: "credits_10000", amount: 999999 });
  assert.equal(res2.error, "untrusted_purchase");
  assert.equal(db._store.size, 0, "zero writes of any kind");
});

test("trust boundary: HTTP can reach ONLY the read view + adapter — never the grant/reversal functions", () => {
  const src = readFileSync(new URL("./index.mjs", import.meta.url), "utf8");
  // Phase 3: the ONLY payments.mjs symbol index imports is the safe read view.
  assert.ok(src.includes('import { listUserPurchases } from "./payments.mjs";'));
  assert.ok(!src.includes("grantVerifiedCreditPurchase"), "grant is never HTTP-wired");
  assert.ok(!src.includes("applyProviderReversal"), "reversal is never HTTP-wired");
  assert.ok(!src.includes("normalizeVerifiedPurchase"), "no route may normalize request data");
  assert.ok(!src.includes("/billing/grant"), "the forbidden route shape must not exist");
  // The webhook is the ONLY pre-app-key path, and it takes the RAW body.
  const gateIdx = src.indexOf("App identifier check (X-Seen-App-Key)");
  const hookIdx = src.indexOf('"/billing/webhook/stripe/test"');
  assert.ok(hookIdx > 0 && gateIdx > hookIdx, "webhook branch must sit BEFORE the app-key gate");
  assert.ok(src.includes("event.isBase64Encoded"), "raw-body base64 handling present for signature verification");
  // Checkout + history stay BEHIND the gate (normal official-frontend contract).
  const checkoutIdx = src.indexOf('path === "/billing/checkout"');
  const purchasesIdx = src.indexOf('path === "/billing/purchases"');
  assert.ok(checkoutIdx > gateIdx && purchasesIdx > gateIdx, "checkout/history require the app-key gate");
});

// ---- credit pack grants ----------------------------------------------------

test("every pack grants its exact Paid amount; Free untouched; ledger row exact", async () => {
  for (const [product, expected] of [
    ["credits_500", 500], ["credits_1000", 1000], ["credits_2000", 2000],
    ["credits_5000", 5000], ["credits_10000", 10000],
  ]) {
    const db = makeFakeDb();
    seed(db, { free: 200, paid: 0 });
    const res = await grant(db, fixture({ providerTransactionId: `tx-${product}`, internalProduct: product, grossAmountMinor: expected }));
    assert.equal(res.ok, true);
    assert.equal(res.duplicate, false);
    assert.equal(res.grantedCredits, expected);
    assert.deepEqual({ free: account(db).free, paid: account(db).paid }, { free: 200, paid: expected });
    const rows = ledgerEntries(db);
    assert.equal(rows.length, 1);
    const e = rows[0];
    assert.equal(e.type, "purchase");
    assert.equal(e.product, product);
    assert.equal(e.freeDelta, 0);
    assert.equal(e.paidDelta, expected);
    assert.equal(e.amount, expected);
    assert.equal(e.quantity, 1);
    assert.equal(e.unitPrice, expected);
    assert.equal(e.provider, "test_fixture");
    assert.equal(e.status, "posted");
    assert.deepEqual(e.balancesAfter, { free: 200, paid: expected });
    assert.equal(e.meta.grossAmountMinor, expected);
    const doc = purchaseDocs(db)[0];
    assert.equal(doc.status, "granted");
    assert.equal(doc.grantedCredits, expected);
    assert.equal(doc.ledgerEntryId, res.purchaseId);
  }
});

test("provider-neutral: stripe/apple/google-shaped fixtures grant identically into ONE balance", async () => {
  const db = makeFakeDb();
  seed(db, { free: 0, paid: 0 });
  for (const provider of ["stripe", "apple", "google"]) {
    const res = await grant(db, fixture({ provider, providerTransactionId: `${provider}-tx`, internalProduct: "credits_1000", grossAmountMinor: 1000 }));
    assert.equal(res.ok, true);
  }
  assert.equal(account(db).paid, 3000, "cross-provider purchases land in the same paid balance");
  assert.deepEqual(ledgerEntries(db).map((e) => e.provider).sort(), ["apple", "google", "stripe"]);
});

test("grant is based on the PACK, never on provider net revenue", async () => {
  const db = makeFakeDb();
  seed(db);
  // Adapter reports gross 500 minor units; commission is nowhere in the model
  // and grant math never reads grossAmountMinor.
  const res = await grant(db, fixture({ grossAmountMinor: 350 /* hypothetical odd net — still irrelevant */ }));
  assert.equal(res.grantedCredits, 500);
  assert.equal(account(db).paid, 500);
});

test("fresh account: purchase initializes via the normal account rules (weekly Free seeded, then paid)", async () => {
  const db = makeFakeDb();
  const res = await grant(db, fixture());
  assert.equal(res.ok, true);
  assert.deepEqual({ free: account(db).free, paid: account(db).paid }, { free: 200, paid: 500 });
  const types = ledgerEntries(db).map((e) => e.type).sort();
  assert.deepEqual(types, ["free_topup", "purchase"]);
});

test("account with current weekly Free: purchase does not alter free or freeTopUpAt", async () => {
  const db = makeFakeDb();
  seed(db, { free: 137, paid: 10 });
  await grant(db, fixture());
  assert.equal(account(db).free, 137);
  assert.equal(account(db).freeTopUpAt, NOW);
  assert.equal(account(db).paid, 510);
});

// ---- duplicates / concurrency ---------------------------------------------

test("same verified purchase ×10: ONE grant, stable duplicate result", async () => {
  const db = makeFakeDb();
  seed(db);
  const p = fixture();
  const first = await grant(db, p);
  assert.equal(first.duplicate, false);
  for (let i = 0; i < 9; i++) {
    const res = await grant(db, p);
    assert.equal(res.ok, true);
    assert.equal(res.duplicate, true);
    assert.equal(res.grantedCredits, 500);
  }
  assert.equal(account(db).paid, 500);
  assert.equal(ledgerEntries(db).length, 1);
  assert.equal(purchaseDocs(db).length, 1);
});

test("CONCURRENT same purchase: real transaction retry semantics, exactly one grant", async () => {
  const db = makeFakeDb();
  seed(db);
  const p = fixture();
  const [r1, r2] = await Promise.all([grant(db, p), grant(db, p)]);
  assert.equal([r1, r2].filter((r) => r.ok && !r.duplicate).length, 1);
  assert.equal([r1, r2].filter((r) => r.ok && r.duplicate).length, 1);
  assert.equal(account(db).paid, 500);
  assert.equal(ledgerEntries(db).length, 1);
});

test("different legitimate transactions both grant", async () => {
  const db = makeFakeDb();
  seed(db);
  await grant(db, fixture({ providerTransactionId: "tx-a" }));
  await grant(db, fixture({ providerTransactionId: "tx-b" }));
  assert.equal(account(db).paid, 1000);
  assert.equal(ledgerEntries(db).length, 2);
  assert.equal(purchaseDocs(db).length, 2);
});

// ---- held states -----------------------------------------------------------

test("unknown internal product: HELD — diagnosable, zero value, idempotent", async () => {
  const db = makeFakeDb();
  const p = fixture({ internalProduct: "credits_999" });
  const res = await grant(db, p);
  assert.deepEqual({ ok: res.ok, error: res.error, held: res.held }, { ok: false, error: "unknown_product", held: true });
  const docs = purchaseDocs(db);
  assert.equal(docs.length, 1);
  assert.equal(docs[0].status, "held");
  assert.equal(docs[0].holdReason, "unknown_product");
  assert.equal(docs[0].grantedCredits, 0);
  assert.equal(ledgerEntries(db).length, 0, "no ledger row for held");
  assert.equal(account(db), undefined, "no account touch");
  await grant(db, p); // duplicate bad event
  assert.equal(purchaseDocs(db).length, 1);
});

test("environment mismatch: HELD, no grant; a held purchase stays held on grant retry", async () => {
  const db = makeFakeDb();
  const p = fixture({ environment: "sandbox" });
  const res = await grant(db, p); // expectedEnvironment "test"
  assert.equal(res.error, "environment_mismatch");
  assert.equal(res.held, true);
  assert.equal(ledgerEntries(db).length, 0);
  // Even a now-"valid" retry of the same transaction id cannot silently
  // un-hold: triage is explicit, never automatic.
  const retry = await grant(db, fixture({}));
  assert.equal(retry.ok, false);
  assert.equal(retry.error, "held");
  assert.equal(account(db), undefined);
});

test("entitlement products refuse grant in Phase 2 (reserved, not active)", async () => {
  const db = makeFakeDb();
  const res = await grant(db, fixture({ internalProduct: "pet_annual", purchaseType: "tag_annual_service", grossAmountMinor: 5900 }));
  assert.equal(res.error, "entitlement_not_active");
  assert.equal(res.held, true);
  assert.equal(ledgerEntries(db).length, 0);
});

test("uid mismatch fixture (adapter cannot bind): recordHeldPurchase — no grant, diagnosable", async () => {
  const db = makeFakeDb();
  const res = await recordHeldPurchase({
    db, provider: "test_fixture", providerTransactionId: "tx-orphan", reason: "uid_mismatch", now: NOW,
  });
  assert.equal(res.held, true);
  const doc = purchaseDocs(db)[0];
  assert.equal(doc.uid, null);
  assert.equal(doc.holdReason, "uid_mismatch");
  assert.equal(doc.grantedCredits, 0);
  assert.equal(ledgerEntries(db).length, 0);
});

// ---- provider clawback ------------------------------------------------------

test("full reversal: +500 then −500; append-only; original entry untouched; Free untouched", async () => {
  const db = makeFakeDb();
  seed(db, { free: 200, paid: 0 });
  const g = await grant(db, fixture());
  const before = JSON.stringify(db._store.get(`${CREDIT_LEDGER}/${g.entryId}`));
  const r = await reverse(db);
  assert.equal(r.ok, true);
  assert.equal(r.creditsReversed, 500);
  assert.deepEqual({ free: account(db).free, paid: account(db).paid }, { free: 200, paid: 0 });
  assert.equal(JSON.stringify(db._store.get(`${CREDIT_LEDGER}/${g.entryId}`)), before, "original purchase entry is byte-identical");
  const claw = ledgerEntries(db).find((e) => e.type === "provider_clawback");
  assert.equal(claw.freeDelta, 0);
  assert.equal(claw.paidDelta, -500);
  assert.equal(claw.reversesEntryId, g.entryId);
  assert.equal(claw.provider, "test_fixture");
  assert.equal(claw.status, "posted");
  const doc = purchaseDocs(db)[0];
  assert.equal(doc.status, "reversed");
  assert.equal(doc.reversedCredits, 500);
});

test("OWNER-LOCKED debt lifecycle: buy 10000 → spend 8000 → reversal → paid −8000; Free lives on; purchases clear debt", async () => {
  const db = makeFakeDb();
  seed(db, { free: 0, paid: 0 });
  // Purchase +10,000.
  await grant(db, fixture({ providerTransactionId: "tx-big", internalProduct: "credits_10000", grossAmountMinor: 10000 }));
  assert.equal(account(db).paid, 10000);
  // Spend 8,000 through the REAL consumption engine (80 × 100-Credit invitations).
  const spend = await chargeCredits({ db, uid: A.uid, product: "private_event_invitation", idempotencyKey: "debt_spend_8000", quantity: 80, now: NOW });
  assert.equal(spend.ok, true);
  assert.equal(account(db).paid, 2000);
  // Provider force-reverses the entire purchase.
  const r = await reverse(db, { providerTransactionId: "tx-big", providerReversalRef: "rev-big" });
  assert.equal(r.creditsReversed, 10000);
  assert.equal(r.debtEntered, true);
  assert.deepEqual({ free: account(db).free, paid: account(db).paid }, { free: 0, paid: -8000 });
  assert.equal(spendableCredits(account(db)), 0);

  // Weekly top-up still works while paid is negative — and never touches paid.
  const bal = await getBalance({ db, uid: A.uid, now: WEEK_LATER });
  assert.deepEqual({ free: bal.free, paid: bal.paid, spendable: bal.spendable }, { free: 200, paid: -8000, spendable: 200 });

  // Free spending while in debt: allowed (100-Credit charge funded by Free alone).
  const freeSpend = await chargeCredits({ db, uid: A.uid, product: "private_event_invitation", idempotencyKey: "debt_free_spend", quantity: 1, now: WEEK_LATER });
  assert.equal(freeSpend.ok, true);
  assert.deepEqual({ free: account(db).free, paid: account(db).paid }, { free: 100, paid: -8000 });

  // Paid consumption beyond Free while in debt: blocked, zero writes.
  const size = db._store.size;
  const blocked = await chargeCredits({ db, uid: A.uid, product: "private_event_invitation", idempotencyKey: "debt_blocked_200", quantity: 2, now: WEEK_LATER });
  assert.equal(blocked.ok, false);
  assert.equal(blocked.error, "insufficient_credits");
  assert.equal(db._store.size, size, "refusal writes nothing");
  assert.equal(account(db).paid, -8000);

  // +5,000 legitimate purchase: paid −8000 → −3000; Paid spending still blocked.
  const g5a = await grant(db, fixture({ providerTransactionId: "tx-heal-1", internalProduct: "credits_5000", grossAmountMinor: 5000 }), WEEK_LATER);
  assert.equal(g5a.debtCleared, false);
  assert.equal(account(db).paid, -3000);
  const stillBlocked = await chargeCredits({ db, uid: A.uid, product: "private_event_invitation", idempotencyKey: "debt_blocked_again", quantity: 2, now: WEEK_LATER });
  assert.equal(stillBlocked.error, "insufficient_credits");

  // +5,000 again: paid −3000 → +2000, debt cleared; Paid consumption resumes.
  const g5b = await grant(db, fixture({ providerTransactionId: "tx-heal-2", internalProduct: "credits_5000", grossAmountMinor: 5000 }), WEEK_LATER);
  assert.equal(g5b.debtCleared, true);
  assert.equal(account(db).paid, 2000);
  const resumed = await chargeCredits({ db, uid: A.uid, product: "private_event_invitation", idempotencyKey: "debt_resumed_200", quantity: 2, now: WEEK_LATER });
  assert.equal(resumed.ok, true);
  assert.deepEqual({ free: account(db).free, paid: account(db).paid }, { free: 0, paid: 1900 });
});

test("duplicate reversal (sequential AND concurrent): ONE clawback", async () => {
  const db = makeFakeDb();
  seed(db, { free: 0, paid: 0 });
  await grant(db, fixture());
  const r1 = await reverse(db);
  const r2 = await reverse(db);
  assert.equal(r1.duplicate, false);
  assert.equal(r2.duplicate, true);
  assert.equal(account(db).paid, 0);
  const db2 = makeFakeDb();
  seed(db2, { free: 0, paid: 0 });
  await grant(db2, fixture());
  const [c1, c2] = await Promise.all([reverse(db2), reverse(db2)]);
  assert.equal([c1, c2].filter((r) => r.ok && !r.duplicate).length, 1);
  assert.equal(account(db2).paid, 0);
  assert.equal(ledgerEntries(db2).filter((e) => e.type === "provider_clawback").length, 1);
});

test("wrong-purchase reversal rejected; held/never-granted reversal rejected; junk amounts rejected", async () => {
  const db = makeFakeDb();
  seed(db);
  await grant(db, fixture());
  const missing = await reverse(db, { providerTransactionId: "tx-does-not-exist" });
  assert.equal(missing.error, "purchase_not_found");
  await grant(db, fixture({ providerTransactionId: "tx-held", internalProduct: "credits_999" })); // → held
  const heldRev = await reverse(db, { providerTransactionId: "tx-held", providerReversalRef: "rev-h" });
  assert.equal(heldRev.error, "not_granted");
  for (const bad of [0, -5, 2.5]) {
    const r = await reverse(db, { grossRefundedMinor: bad, providerReversalRef: `rev-bad-${bad}` });
    assert.equal(r.error, "invalid_reversal_amount");
  }
  assert.equal(account(db).paid, 500, "nothing above moved money");
});

test("partial reversal: proportional in minor units, Math.round, cumulative-capped at the grant", async () => {
  const db = makeFakeDb();
  seed(db, { free: 0, paid: 0 });
  await grant(db, fixture({ providerTransactionId: "tx-part", internalProduct: "credits_1000", grossAmountMinor: 1000 }));
  // Refund 333 of 1000 minor → round(1000 × 333/1000) = 333 Credits.
  const p1 = await reverse(db, { providerTransactionId: "tx-part", providerReversalRef: "rev-p1", grossRefundedMinor: 333 });
  assert.equal(p1.creditsReversed, 333);
  assert.equal(account(db).paid, 667);
  assert.equal(purchaseDocs(db)[0].status, "granted", "partially reversed stays granted with reversedCredits");
  // Refund 900 more → computed 900 but only 667 remain → capped.
  const p2 = await reverse(db, { providerTransactionId: "tx-part", providerReversalRef: "rev-p2", grossRefundedMinor: 900 });
  assert.equal(p2.creditsReversed, 667);
  assert.equal(account(db).paid, 0);
  assert.equal(purchaseDocs(db)[0].status, "reversed");
  assert.equal(purchaseDocs(db)[0].reversedCredits, 1000);
  // Nothing left to reverse.
  const p3 = await reverse(db, { providerTransactionId: "tx-part", providerReversalRef: "rev-p3", grossRefundedMinor: 100 });
  assert.equal(p3.error, "already_fully_reversed");
});

// ---- atomicity / failure injection -----------------------------------------

test("grant commit failure: NO paid increase, NO granted state; retry after failure succeeds", async () => {
  const db = makeFakeDb();
  seed(db, { free: 200, paid: 0 });
  db._failNextCreate(`${CREDIT_LEDGER}/purchase_`);
  await assert.rejects(() => grant(db, fixture()), /injected_commit_failure/);
  assert.deepEqual({ free: account(db).free, paid: account(db).paid }, { free: 200, paid: 0 });
  assert.equal(ledgerEntries(db).length, 0);
  assert.equal(purchaseDocs(db).length, 0, "purchase can never say granted when the grant failed");
  const retry = await grant(db, fixture());
  assert.equal(retry.ok, true);
  assert.equal(account(db).paid, 500);
});

test("reversal commit failure: original purchase intact, no partial clawback; retry safe", async () => {
  const db = makeFakeDb();
  seed(db, { free: 0, paid: 0 });
  const g = await grant(db, fixture());
  db._failNextCreate(`${CREDIT_LEDGER}/reversal_`);
  await assert.rejects(() => reverse(db), /injected_commit_failure/);
  assert.equal(account(db).paid, 500);
  assert.equal(purchaseDocs(db)[0].status, "granted");
  assert.ok(db._store.has(`${CREDIT_LEDGER}/${g.entryId}`));
  const retry = await reverse(db);
  assert.equal(retry.ok, true);
  assert.equal(account(db).paid, 0);
});

// ---- ledger integrity -------------------------------------------------------

test("Σ ledger deltas === account balances across weekly/charge/admin/purchase/clawback — no off-ledger state", async () => {
  const db = makeFakeDb();
  const auth = { getUserByEmail: async () => ({ uid: A.uid }) };
  // Weekly seed + admin test grant (creates the account through the normal path).
  const adminRes = await adminTestGrantPhase3({ db, auth, now: NOW });
  assert.equal(adminRes.ok, true);
  // Normal consumption.
  const c = await chargeCredits({ db, uid: A.uid, product: "simple_gift_publish", idempotencyKey: "integrity_gift", now: NOW });
  assert.equal(c.ok, true);
  // Real-money purchase and a provider clawback.
  await grant(db, fixture({ providerTransactionId: "tx-int", internalProduct: "credits_500", grossAmountMinor: 500 }));
  await reverse(db, { providerTransactionId: "tx-int", providerReversalRef: "rev-int" });

  const rows = ledgerEntries(db);
  const sumFree = rows.reduce((n, e) => n + (e.freeDelta ?? 0), 0);
  const sumPaid = rows.reduce((n, e) => n + (e.paidDelta ?? 0), 0);
  assert.equal(sumFree, account(db).free, "Σ freeDelta === account.free");
  assert.equal(sumPaid, account(db).paid, "Σ paidDelta === account.paid");
  assert.deepEqual({ free: account(db).free, paid: account(db).paid }, { free: 180, paid: 10000 });
  // And the type census is exactly the expected life.
  assert.deepEqual(rows.map((e) => e.type).sort(), ["adjustment", "charge", "free_topup", "provider_clawback", "purchase"]);
});

// ---- read models ------------------------------------------------------------

test("purchase status + user history: safe fields only (no raw tokens/meta), newest first, own rows only", async () => {
  const db = makeFakeDb();
  seed(db);
  seed(db, { free: 0, paid: 0 }, "other-uid");
  await grant(db, fixture({ providerTransactionId: "tx-h1" }), NOW);
  await grant(db, fixture({ providerTransactionId: "tx-h2", internalProduct: "credits_2000", grossAmountMinor: 2000 }), NOW + 1000);
  await grant(db, fixture({ providerTransactionId: "tx-other", uid: "other-uid" }), NOW + 2000);
  const status = await getPurchaseStatus({ db, provider: "test_fixture", providerTransactionId: "tx-h1" });
  assert.equal(status.status, "granted");
  assert.equal(status.grantedCredits, 500);
  assert.equal(status.providerTransactionId, undefined, "raw provider ref never leaves the module");
  assert.equal(status.meta, undefined, "meta never leaves the module");
  const mine = await listUserPurchases({ db, uid: A.uid });
  assert.equal(mine.length, 2, "only the caller's purchases");
  assert.equal(mine[0].internalProduct, "credits_2000", "newest first");
  assert.ok(mine.every((v) => v.providerTransactionId === undefined));
  assert.equal(await getPurchaseStatus({ db, provider: "test_fixture", providerTransactionId: "nope" }), null);
});

// ---- existing consumption engine regression under the new gate --------------

test("debt gate regression: positive-paid accounts behave byte-identically (free-first split unchanged)", async () => {
  const db = makeFakeDb();
  seed(db, { free: 50, paid: 100 });
  const res = await chargeCredits({ db, uid: A.uid, product: "gift_tag_publish", idempotencyKey: "regress_50_70", quantity: 1, now: NOW });
  assert.equal(res.ok, true);
  const e = ledgerEntries(db)[0];
  assert.deepEqual({ freeDelta: e.freeDelta, paidDelta: e.paidDelta }, { freeDelta: -50, paidDelta: 0 });
  assert.deepEqual({ free: account(db).free, paid: account(db).paid }, { free: 0, paid: 100 });
  const res2 = await chargeCredits({ db, uid: A.uid, product: "simple_gift_publish", idempotencyKey: "regress_paid_20", now: NOW });
  assert.equal(res2.ok, true);
  assert.equal(account(db).paid, 80);
});
