/**
 * Payment Phase 3 — Stripe TEST-MODE adapter, proven fully OFFLINE:
 * signature math against the raw body, environment separation (livemode),
 * checkout-session creation via captured fake fetch, webhook grant/refund/
 * dispute flows into the REAL payment core + REAL consumption engine.
 *
 * LOCKED invariants under test:
 *   · the webhook signature over RAW bytes is the route's entire boundary;
 *   · a test endpoint refuses livemode events (and vice versa, by design);
 *   · one Stripe session = one grant, whatever the event/redelivery mix;
 *   · refund/dispute overlaps can never double-claw (cumulative cap);
 *   · the client's only checkout input is internalProduct — price, amount,
 *     currency and uid binding are all server-resolved;
 *   · success redirects grant NOTHING (no such path exists in the adapter).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { makeFakeDb } from "./billing.test.mjs";
import { chargeCredits, getBalance, CREDIT_ACCOUNTS, CREDIT_LEDGER } from "./billing.mjs";
import { PAYMENT_PURCHASES } from "./payments.mjs";
import {
  createCheckoutSession,
  verifyStripeSignature,
  handleStripeWebhook,
  stripeLookupKeyFor,
  STRIPE_SIGNATURE_TOLERANCE_SEC,
} from "./stripeAdapter.mjs";

const UID = "buyer-1";
const NOW = Date.UTC(2026, 8, 5, 12, 0, 0);
const WEEK_LATER = NOW + 7 * 24 * 60 * 60 * 1000;
const CONFIG = {
  secretKey: "sk_test_fixture",
  webhookSecret: "whsec_test_fixture",
  environment: "test",
  checkoutOrigin: "https://gift.beingseenmatters.com",
};

const account = (db, uid = UID) => db._store.get(`${CREDIT_ACCOUNTS}/${uid}`);
const ledgerEntries = (db) => [...db._store.entries()].filter(([k]) => k.startsWith(`${CREDIT_LEDGER}/`)).map(([k, v]) => ({ id: k, ...v }));
const purchaseDocs = (db) => [...db._store.entries()].filter(([k]) => k.startsWith(`${PAYMENT_PURCHASES}/`)).map(([k, v]) => ({ id: k, ...v }));
const seed = (db, { free = 0, paid = 0 } = {}, uid = UID) =>
  db._store.set(`${CREDIT_ACCOUNTS}/${uid}`, {
    schemaVersion: 1, free, paid, freeTopUpAt: NOW, createdAt: NOW, updatedAt: NOW, version: 1,
  });

const sign = (payload, secret = CONFIG.webhookSecret, t = Math.floor(NOW / 1000)) =>
  `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${payload}`, "utf8").digest("hex")}`;

const hook = (db, event, { secret, now = NOW, config = CONFIG } = {}) => {
  const rawBody = JSON.stringify(event);
  return handleStripeWebhook({
    db,
    rawBody,
    signatureHeader: sign(rawBody, secret ?? config.webhookSecret, Math.floor(now / 1000)),
    config,
    now,
  });
};

const completedSession = (over = {}, sessionOver = {}) => ({
  id: over.eventId ?? "evt_1",
  type: over.type ?? "checkout.session.completed",
  livemode: over.livemode ?? false,
  data: {
    object: {
      id: "cs_test_1",
      object: "checkout.session",
      mode: "payment",
      payment_status: "paid",
      amount_total: 500,
      currency: "aud",
      payment_intent: "pi_1",
      client_reference_id: UID,
      created: Math.floor(NOW / 1000),
      metadata: { uid: UID, internalProduct: "credits_500", priceId: "price_1" },
      ...sessionOver,
    },
  },
});
const refundEvent = (over = {}) => ({
  id: over.eventId ?? "evt_r1",
  type: "charge.refunded",
  livemode: false,
  data: { object: { id: "ch_1", object: "charge", amount: 500, amount_refunded: 500, payment_intent: "pi_1", ...over } },
});
const disputeEvent = (over = {}) => ({
  id: over.eventId ?? "evt_d1",
  type: "charge.dispute.created",
  livemode: false,
  data: { object: { id: "dp_1", payment_intent: "pi_1", amount: 500, ...over } },
});

const fakeStripeFetch = ({
  price = { id: "price_1", currency: "aud", unit_amount: 500, lookup_key: "giftseen_credits_500_aud" },
  session = { id: "cs_test_new", url: "https://checkout.stripe.com/c/pay/cs_test_new" },
} = {}) => {
  const calls = [];
  const impl = async (url, opts = {}) => {
    calls.push({ url, opts });
    if (url.includes("/prices")) return { ok: true, status: 200, json: async () => ({ data: price ? [price] : [] }) };
    if (url.endsWith("/checkout/sessions")) return { ok: true, status: 200, json: async () => session };
    return { ok: false, status: 404, json: async () => ({ error: { message: "not found" } }) };
  };
  impl.calls = calls;
  return impl;
};

// ---- signature -------------------------------------------------------------

test("signature: valid passes; wrong secret / tampered body / missing / stale all refuse", () => {
  const payload = JSON.stringify({ hello: "world" });
  const good = verifyStripeSignature({ payload, header: sign(payload), secret: CONFIG.webhookSecret, now: NOW });
  assert.equal(good.ok, true);
  const wrongSecret = verifyStripeSignature({ payload, header: sign(payload, "whsec_other"), secret: CONFIG.webhookSecret, now: NOW });
  assert.equal(wrongSecret.error, "invalid_signature");
  const tampered = verifyStripeSignature({ payload: payload + " ", header: sign(payload), secret: CONFIG.webhookSecret, now: NOW });
  assert.equal(tampered.error, "invalid_signature");
  const missing = verifyStripeSignature({ payload, header: null, secret: CONFIG.webhookSecret, now: NOW });
  assert.equal(missing.error, "missing_signature");
  const staleT = Math.floor(NOW / 1000) - STRIPE_SIGNATURE_TOLERANCE_SEC - 10;
  const stale = verifyStripeSignature({ payload, header: sign(payload, CONFIG.webhookSecret, staleT), secret: CONFIG.webhookSecret, now: NOW });
  assert.equal(stale.error, "stale_timestamp");
  // Secret rotation: several v1 values, one matching → ok.
  const rotated = `${sign(payload, "whsec_old")},v1=${sign(payload).split("v1=")[1]}`;
  assert.equal(verifyStripeSignature({ payload, header: rotated, secret: CONFIG.webhookSecret, now: NOW }).ok, true);
});

test("webhook: unsigned/invalid requests are 400 with ZERO writes; malformed JSON after valid signature is 400", async () => {
  const db = makeFakeDb();
  const raw = JSON.stringify(completedSession());
  const bad = await handleStripeWebhook({ db, rawBody: raw, signatureHeader: "t=1,v1=deadbeef", config: CONFIG, now: NOW });
  assert.equal(bad.status, 400);
  const malformed = "{not json";
  const res = await handleStripeWebhook({ db, rawBody: malformed, signatureHeader: sign(malformed), config: CONFIG, now: NOW });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "malformed_body");
  assert.equal(db._store.size, 0);
});

test("webhook secret unconfigured: fail closed 503, nothing processed", async () => {
  const db = makeFakeDb();
  const res = await handleStripeWebhook({ db, rawBody: "{}", signatureHeader: "t=1,v1=x", config: { ...CONFIG, webhookSecret: null }, now: NOW });
  assert.equal(res.status, 503);
  assert.equal(db._store.size, 0);
});

// ---- environment separation -------------------------------------------------

test("ENVIRONMENT SEPARATION: a livemode event on the TEST endpoint is refused — no grant possible", async () => {
  const db = makeFakeDb();
  const res = await hook(db, completedSession({ livemode: true }));
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "environment_mismatch");
  assert.equal(db._store.size, 0);
});

// ---- purchase grant ---------------------------------------------------------

test("checkout.session.completed (paid): +500 Paid, environment=test, provider=stripe, purchase doc granted", async () => {
  const db = makeFakeDb();
  seed(db, { free: 200, paid: 0 });
  const res = await hook(db, completedSession());
  assert.equal(res.status, 200);
  assert.equal(res.body.granted, true);
  assert.deepEqual({ free: account(db).free, paid: account(db).paid }, { free: 200, paid: 500 });
  const e = ledgerEntries(db)[0];
  assert.equal(e.type, "purchase");
  assert.equal(e.provider, "stripe");
  assert.equal(e.providerRef, "cs_test_1");
  assert.equal(e.freeDelta, 0);
  assert.equal(e.paidDelta, 500);
  assert.equal(e.meta.environment, "test");
  assert.equal(e.meta.grossAmountMinor, 500);
  const doc = purchaseDocs(db)[0];
  assert.equal(doc.status, "granted");
  assert.equal(doc.environment, "test");
  assert.equal(doc.providerOriginalTransactionId, "pi_1");
});

test("duplicate webhook ×3 (and a redelivery under a NEW event id): ONE grant — identity is the session", async () => {
  const db = makeFakeDb();
  seed(db);
  await hook(db, completedSession());
  const again = await hook(db, completedSession());
  assert.equal(again.body.duplicate, true);
  await hook(db, completedSession({ eventId: "evt_redelivery" }));
  // async_payment_succeeded for the SAME session also converges.
  await hook(db, completedSession({ eventId: "evt_async", type: "checkout.session.async_payment_succeeded" }));
  assert.equal(account(db).paid, 500);
  assert.equal(ledgerEntries(db).filter((e) => e.type === "purchase").length, 1);
  assert.equal(purchaseDocs(db).length, 1);
});

test("unpaid / non-payment-mode sessions change nothing", async () => {
  const db = makeFakeDb();
  const unpaid = await hook(db, completedSession({}, { payment_status: "unpaid" }));
  assert.equal(unpaid.body.ignored, "unpaid");
  const sub = await hook(db, completedSession({ eventId: "evt_sub" }, { mode: "subscription" }));
  assert.equal(sub.body.ignored, "not_one_time_payment");
  assert.equal(db._store.size, 0);
});

test("uid missing / client_reference mismatch / unknown product / amount mismatch: HELD, zero value", async () => {
  const db = makeFakeDb();
  const noUid = await hook(db, completedSession({}, { metadata: { internalProduct: "credits_500" } }));
  assert.equal(noUid.body.held, "uid_missing");
  const clash = await hook(db, completedSession({ eventId: "e2" }, { id: "cs_test_2", client_reference_id: "someone-else" }));
  assert.equal(clash.body.held, "uid_missing");
  const badProduct = await hook(db, completedSession({ eventId: "e3" }, { id: "cs_test_3", metadata: { uid: UID, internalProduct: "credits_999" } }));
  assert.equal(badProduct.body.held, "unknown_product");
  const badAmount = await hook(db, completedSession({ eventId: "e4" }, { id: "cs_test_4", amount_total: 400 }));
  assert.equal(badAmount.body.held, "amount_mismatch");
  const badCurrency = await hook(db, completedSession({ eventId: "e5" }, { id: "cs_test_5", currency: "usd" }));
  assert.equal(badCurrency.body.held, "amount_mismatch");
  assert.equal(ledgerEntries(db).length, 0, "no ledger rows at all");
  assert.equal(account(db), undefined, "no balance touch");
  assert.ok(purchaseDocs(db).every((d) => d.status === "held" && d.grantedCredits === 0));
});

// ---- refunds / disputes -----------------------------------------------------

test("full refund: verified clawback −500; Free unchanged; purchase doc reversed; replay is duplicate", async () => {
  const db = makeFakeDb();
  seed(db, { free: 200, paid: 0 });
  await hook(db, completedSession());
  const r = await hook(db, refundEvent());
  assert.equal(r.status, 200);
  assert.equal(r.body.reversed, true);
  assert.deepEqual({ free: account(db).free, paid: account(db).paid }, { free: 200, paid: 0 });
  const claw = ledgerEntries(db).find((e) => e.type === "provider_clawback");
  assert.equal(claw.paidDelta, -500);
  assert.equal(claw.freeDelta, 0);
  assert.equal(purchaseDocs(db)[0].status, "reversed");
  const again = await hook(db, refundEvent({ eventId: "evt_r2" }));
  assert.equal(account(db).paid, 0);
  assert.equal(ledgerEntries(db).filter((e) => e.type === "provider_clawback").length, 1);
  assert.equal(again.status, 200);
});

test("cumulative partial refunds: 250 then 500 (cumulative) claw exactly 250 + 250", async () => {
  const db = makeFakeDb();
  seed(db);
  await hook(db, completedSession());
  const p1 = await hook(db, refundEvent({ eventId: "evt_p1", amount_refunded: 250 }));
  assert.equal(p1.body.reversed, true);
  assert.equal(account(db).paid, 250);
  assert.equal(purchaseDocs(db)[0].status, "granted", "partial keeps granted + reversedCredits");
  assert.equal(purchaseDocs(db)[0].reversedCredits, 250);
  const p2 = await hook(db, refundEvent({ eventId: "evt_p2", amount_refunded: 500 }));
  assert.equal(p2.body.reversed, true);
  assert.equal(account(db).paid, 0);
  assert.equal(purchaseDocs(db)[0].status, "reversed");
  assert.equal(purchaseDocs(db)[0].reversedCredits, 500);
});

test("refund + dispute OVERLAP can never double-claw (cumulative cap): dispute after full refund is a no-op", async () => {
  const db = makeFakeDb();
  seed(db);
  await hook(db, completedSession());
  await hook(db, refundEvent());
  assert.equal(account(db).paid, 0);
  const d = await hook(db, disputeEvent());
  assert.equal(d.status, 200);
  assert.equal(account(db).paid, 0, "no second reversal");
  assert.equal(ledgerEntries(db).filter((e) => e.type === "provider_clawback").length, 1);
});

test("dispute alone claws the full remaining grant", async () => {
  const db = makeFakeDb();
  seed(db);
  await hook(db, completedSession());
  const d = await hook(db, disputeEvent());
  assert.equal(d.body.reversed, true);
  assert.equal(account(db).paid, 0);
});

test("refund for an unmatched payment: acknowledged, zero writes", async () => {
  const db = makeFakeDb();
  const r = await hook(db, refundEvent({ payment_intent: "pi_unknown" }));
  assert.equal(r.status, 200);
  assert.equal(r.body.ignored, "unmatched_purchase");
  assert.equal(db._store.size, 0);
});

test("REFUND-AFTER-SPEND E2E: buy 2000, spend 1500, refund → paid −1500; Free usable; next purchase offsets", async () => {
  const db = makeFakeDb();
  seed(db, { free: 0, paid: 0 });
  await hook(db, completedSession({}, {
    id: "cs_test_2000", payment_intent: "pi_2000", amount_total: 2000,
    metadata: { uid: UID, internalProduct: "credits_2000", priceId: "price_2000" },
  }));
  assert.equal(account(db).paid, 2000);
  const spend = await chargeCredits({ db, uid: UID, product: "private_event_invitation", idempotencyKey: "stripe_e2e_spend", quantity: 15, now: NOW });
  assert.equal(spend.ok, true);
  assert.equal(account(db).paid, 500);
  await hook(db, refundEvent({ eventId: "evt_big_r", id: "ch_2000", amount: 2000, amount_refunded: 2000, payment_intent: "pi_2000" }));
  assert.deepEqual({ free: account(db).free, paid: account(db).paid }, { free: 0, paid: -1500 });
  // Weekly Free still arrives and is spendable; Paid debt blocks Paid spending.
  const bal = await getBalance({ db, uid: UID, now: WEEK_LATER });
  assert.deepEqual({ free: bal.free, paid: bal.paid, spendable: bal.spendable }, { free: 200, paid: -1500, spendable: 200 });
  const freeOk = await chargeCredits({ db, uid: UID, product: "private_event_invitation", idempotencyKey: "stripe_e2e_free", quantity: 1, now: WEEK_LATER });
  assert.equal(freeOk.ok, true);
  const blocked = await chargeCredits({ db, uid: UID, product: "private_event_invitation", idempotencyKey: "stripe_e2e_blocked", quantity: 2, now: WEEK_LATER });
  assert.equal(blocked.error, "insufficient_credits");
  // A new legitimate purchase first offsets the debt.
  await hook(db, completedSession({ eventId: "evt_heal" }, {
    id: "cs_test_heal", payment_intent: "pi_heal", amount_total: 500,
    metadata: { uid: UID, internalProduct: "credits_500", priceId: "price_1" },
  }), { now: WEEK_LATER });
  assert.equal(account(db).paid, -1000);
});

test("transient grant failure → 500 (Stripe retries); the retry grants exactly once", async () => {
  const db = makeFakeDb();
  seed(db);
  db._failNextCreate(`${CREDIT_LEDGER}/purchase_`);
  const first = await hook(db, completedSession());
  assert.equal(first.status, 500);
  assert.equal(first.body.error, "processing_failure");
  assert.equal(account(db).paid, 0);
  assert.equal(purchaseDocs(db).length, 0);
  const retry = await hook(db, completedSession());
  assert.equal(retry.status, 200);
  assert.equal(account(db).paid, 500);
  assert.equal(ledgerEntries(db).filter((e) => e.type === "purchase").length, 1);
});

// ---- checkout session creation ---------------------------------------------

test("checkout: server resolves the price by DURABLE lookup key and binds the verified uid — client sends only internalProduct", async () => {
  const fetchImpl = fakeStripeFetch();
  const res = await createCheckoutSession({ uid: UID, internalProduct: "credits_500", config: CONFIG, fetchImpl, now: NOW });
  assert.equal(res.status, 200);
  assert.equal(res.body.sessionId, "cs_test_new");
  assert.ok(res.body.url.startsWith("https://checkout.stripe.com/"));
  const priceCall = fetchImpl.calls[0];
  assert.ok(priceCall.url.includes(encodeURIComponent(stripeLookupKeyFor("credits_500"))));
  const form = fetchImpl.calls[1].opts.body;
  assert.ok(form.includes("mode=payment"));
  assert.ok(form.includes("line_items%5B0%5D%5Bprice%5D=price_1"));
  assert.ok(form.includes("line_items%5B0%5D%5Bquantity%5D=1"));
  assert.ok(form.includes(`client_reference_id=${UID}`));
  assert.ok(form.includes(`metadata%5Buid%5D=${UID}`));
  assert.ok(form.includes("metadata%5BinternalProduct%5D=credits_500"));
  assert.ok(form.includes("metadata%5BpriceId%5D=price_1"));
  // Success page is informational; cancel returns safely.
  assert.ok(decodeURIComponent(form).includes("/account?payment=processing&session={CHECKOUT_SESSION_ID}"));
  assert.ok(decodeURIComponent(form).includes("/account?payment=cancelled"));
  // The client could not have supplied an amount even if it tried: the form
  // carries NO amount fields — only the server-resolved price id.
  assert.ok(!form.includes("unit_amount") && !form.includes("amount="));
});

test("checkout fail-closed: unknown product 400; missing price 503; drifted price 503; no secret 503", async () => {
  const none = await createCheckoutSession({ uid: UID, internalProduct: "credits_999", config: CONFIG, fetchImpl: fakeStripeFetch(), now: NOW });
  assert.equal(none.status, 400);
  const entitlement = await createCheckoutSession({ uid: UID, internalProduct: "pet_annual", config: CONFIG, fetchImpl: fakeStripeFetch(), now: NOW });
  assert.equal(entitlement.status, 400, "annual entitlements are not purchasable in this phase");
  const missing = await createCheckoutSession({ uid: UID, internalProduct: "credits_500", config: CONFIG, fetchImpl: fakeStripeFetch({ price: null }), now: NOW });
  assert.equal(missing.status, 503);
  assert.equal(missing.body.error, "price_not_configured");
  const drifted = await createCheckoutSession({ uid: UID, internalProduct: "credits_500", config: CONFIG, fetchImpl: fakeStripeFetch({ price: { id: "p", currency: "aud", unit_amount: 499 } }), now: NOW });
  assert.equal(drifted.status, 503);
  assert.equal(drifted.body.error, "price_mismatch");
  const usd = await createCheckoutSession({ uid: UID, internalProduct: "credits_500", config: CONFIG, fetchImpl: fakeStripeFetch({ price: { id: "p", currency: "usd", unit_amount: 500 } }), now: NOW });
  assert.equal(usd.status, 503);
  const noKey = await createCheckoutSession({ uid: UID, internalProduct: "credits_500", config: { ...CONFIG, secretKey: null }, fetchImpl: fakeStripeFetch(), now: NOW });
  assert.equal(noKey.status, 503);
  assert.equal(noKey.body.error, "payments_unavailable");
  const anon = await createCheckoutSession({ uid: null, internalProduct: "credits_500", config: CONFIG, fetchImpl: fakeStripeFetch(), now: NOW });
  assert.equal(anon.status, 401);
});

// ---- adapter purity ---------------------------------------------------------

test("adapter contains NO wallet math — ledger/account writes live only in payments.mjs", () => {
  const src = readFileSync(new URL("./stripeAdapter.mjs", import.meta.url), "utf8");
  assert.ok(!src.includes("creditAccounts") && !src.includes("CREDIT_ACCOUNTS"));
  assert.ok(!src.includes("CREDIT_LEDGER") && !src.includes("freeDelta") && !src.includes("paidDelta"));
  assert.ok(!src.includes("runTransaction"), "no transactions in the adapter");
});
