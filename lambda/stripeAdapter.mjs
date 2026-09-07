/**
 * stripeAdapter.mjs — Stripe provider adapter (Payment Phase 3, TEST MODE).
 *
 * Responsibilities ONLY (no wallet math lives here — payments.mjs owns it):
 *   · create a Checkout Session for an AUTHENTICATED uid + catalog product;
 *   · verify webhook signatures over the RAW request body;
 *   · normalize verified Stripe events → payments.mjs grant/reversal.
 *
 * Trust model:
 *   · /billing/checkout is app-key + Firebase-authenticated; the client sends
 *     ONLY an internalProduct name. Price, amount, currency, uid binding are
 *     all resolved server-side (Stripe Price by durable lookup_key
 *     `giftseen_{product}_aud`; metadata.uid = the verified caller).
 *   · /billing/webhook/stripe carries NO app key (Stripe cannot send one).
 *     Its entire boundary is the HMAC signature (timestamp-tolerant,
 *     timing-safe) + environment separation: this TEST adapter refuses
 *     livemode events even if a secret were ever shared.
 *   · The success redirect is INFORMATIONAL — nothing here grants from it.
 *
 * Stripe REST is called directly over fetch (form-encoded, pinned API
 * version) — no SDK dependency in the Lambda bundle; `fetchImpl` injection
 * keeps every path fixture-testable offline.
 */
import { createHmac, timingSafeEqual } from "node:crypto";
import {
  PURCHASABLE_PRODUCTS,
  normalizeVerifiedPurchase,
  grantVerifiedCreditPurchase,
  applyProviderReversal,
  recordHeldPurchase,
  findPurchaseByProviderRef,
} from "./payments.mjs";

const STRIPE_API = "https://api.stripe.com/v1";
const STRIPE_API_VERSION = "2024-06-20"; // pinned — behavior never drifts under us
export const STRIPE_SIGNATURE_TOLERANCE_SEC = 300; // Stripe's documented default

const slog = (event, fields = {}) => {
  try {
    console.log(`[payment] ${event}`, JSON.stringify(fields));
  } catch {
    console.log(`[payment] ${event}`);
  }
};

/** Durable lookup key per internal product — prices may change, names never. */
export function stripeLookupKeyFor(internalProduct) {
  return `giftseen_${internalProduct}_aud`;
}

async function stripeCall({ config, fetchImpl, method, path, form = null }) {
  const res = await fetchImpl(`${STRIPE_API}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${config.secretKey}`,
      "Stripe-Version": STRIPE_API_VERSION,
      ...(form ? { "Content-Type": "application/x-www-form-urlencoded" } : {}),
    },
    ...(form ? { body: form.toString() } : {}),
  });
  const body = await res.json().catch(() => ({}));
  return { ok: res.ok, status: res.status, body };
}

/**
 * POST /billing/checkout — create a Stripe TEST Checkout Session.
 * The client's ONLY input is `internalProduct`; everything financial is
 * resolved here. Returns {status, body} handler-shape.
 */
export async function createCheckoutSession({
  uid,
  internalProduct,
  config,
  fetchImpl = fetch,
  now = Date.now(),
}) {
  if (!uid) return { status: 401, body: { error: "unauthorized" } };
  if (!config?.secretKey) {
    console.error("[payment] stripe secret key not configured — refusing checkout");
    return { status: 503, body: { error: "payments_unavailable" } };
  }
  const spec = PURCHASABLE_PRODUCTS[internalProduct];
  if (!spec || spec.purchaseType !== "credit_pack" || !Number.isInteger(spec.grantPaidCredits)) {
    return { status: 400, body: { error: "unknown_product" } };
  }

  // Resolve the ACTIVE test price by its durable lookup key — the server
  // catalog stays authoritative; a client can never submit a price or amount.
  const lookupKey = stripeLookupKeyFor(internalProduct);
  const priceRes = await stripeCall({
    config,
    fetchImpl,
    method: "GET",
    path: `/prices?lookup_keys[]=${encodeURIComponent(lookupKey)}&active=true&limit=1`,
  });
  const price = priceRes.ok ? priceRes.body?.data?.[0] : null;
  if (!price) {
    slog("stripe_unknown_price", { internalProduct, lookupKey });
    return { status: 503, body: { error: "price_not_configured" } };
  }
  // Plausibility lock: our AUD minor units EQUAL the pack's Credits
  // (AU$5 = 500c = 500 Credits). A drifted/mis-set price refuses fail-closed.
  if (price.currency !== "aud" || price.unit_amount !== spec.grantPaidCredits) {
    slog("stripe_unknown_price", { internalProduct, priceId: price.id, reason: "price_mismatch" });
    return { status: 503, body: { error: "price_mismatch" } };
  }

  const origin = config.checkoutOrigin;
  const form = new URLSearchParams();
  form.set("mode", "payment");
  form.set("line_items[0][price]", price.id);
  form.set("line_items[0][quantity]", "1");
  // Success page is informational ONLY — the grant happens exclusively in the
  // signed webhook. {CHECKOUT_SESSION_ID} is Stripe's own template token.
  form.set("success_url", `${origin}/account?payment=processing&session={CHECKOUT_SESSION_ID}`);
  form.set("cancel_url", `${origin}/account?payment=cancelled`);
  form.set("client_reference_id", uid);
  form.set("metadata[uid]", uid);
  form.set("metadata[internalProduct]", internalProduct);
  form.set("metadata[priceId]", price.id);

  const sessRes = await stripeCall({ config, fetchImpl, method: "POST", path: "/checkout/sessions", form });
  if (!sessRes.ok || !sessRes.body?.url || !sessRes.body?.id) {
    console.error("[payment] stripe checkout create failed:", sessRes.status, sessRes.body?.error?.message);
    return { status: 502, body: { error: "checkout_failed" } };
  }
  slog("stripe_checkout_created", { uid, internalProduct, sessionId: sessRes.body.id, environment: config.environment });
  return { status: 200, body: { url: sessRes.body.url, sessionId: sessRes.body.id } };
}

// --- Webhook signature (raw body, timing-safe, tolerance-bounded) ----------

/**
 * Verify a `Stripe-Signature` header against the RAW payload string.
 * Scheme: header carries `t=<unix>,v1=<hmac>` (possibly several v1 during
 * secret rotation); expected = HMAC_SHA256(secret, `${t}.${payload}`).
 */
export function verifyStripeSignature({
  payload,
  header,
  secret,
  toleranceSec = STRIPE_SIGNATURE_TOLERANCE_SEC,
  now = Date.now(),
}) {
  if (typeof payload !== "string") return { ok: false, error: "missing_body" };
  if (typeof header !== "string" || header.length === 0) return { ok: false, error: "missing_signature" };
  if (!secret) return { ok: false, error: "not_configured" };
  const parts = Object.create(null);
  const v1s = [];
  for (const piece of header.split(",")) {
    const i = piece.indexOf("=");
    if (i <= 0) continue;
    const k = piece.slice(0, i).trim();
    const v = piece.slice(i + 1).trim();
    if (k === "v1") v1s.push(v);
    else parts[k] = v;
  }
  const t = Number(parts.t);
  if (!Number.isInteger(t) || v1s.length === 0) return { ok: false, error: "invalid_signature" };
  if (Math.abs(now / 1000 - t) > toleranceSec) return { ok: false, error: "stale_timestamp" };
  const expected = createHmac("sha256", secret).update(`${t}.${payload}`, "utf8").digest("hex");
  const expBuf = Buffer.from(expected, "utf8");
  const match = v1s.some((v) => {
    const got = Buffer.from(String(v), "utf8");
    return got.length === expBuf.length && timingSafeEqual(got, expBuf);
  });
  return match ? { ok: true, timestamp: t } : { ok: false, error: "invalid_signature" };
}

// --- Webhook handler ---------------------------------------------------------

/**
 * POST /billing/webhook/stripe — the ONLY place Stripe events become money.
 * Returns handler-shape {status, body}: 2xx for processed/duplicate/ignored
 * (so Stripe stops retrying), 400 for anything unverifiable, 500 only for a
 * transient processing failure (so Stripe DOES retry it).
 */
export async function handleStripeWebhook({
  db,
  rawBody,
  signatureHeader,
  config,
  now = Date.now(),
}) {
  if (!config?.webhookSecret) {
    console.error("[payment] stripe webhook secret not configured — refusing");
    return { status: 503, body: { error: "webhook_not_configured" } };
  }
  const sig = verifyStripeSignature({
    payload: rawBody,
    header: signatureHeader,
    secret: config.webhookSecret,
    now,
  });
  if (!sig.ok) {
    slog("stripe_webhook_invalid", { reason: sig.error });
    return { status: 400, body: { error: "invalid_signature" } };
  }
  let event;
  try {
    event = JSON.parse(rawBody);
  } catch {
    slog("stripe_webhook_invalid", { reason: "malformed_body" });
    return { status: 400, body: { error: "malformed_body" } };
  }
  if (!event || typeof event.type !== "string" || !event.data?.object) {
    slog("stripe_webhook_invalid", { reason: "malformed_event" });
    return { status: 400, body: { error: "malformed_event" } };
  }
  slog("stripe_webhook_verified", { type: event.type, eventId: event.id ?? null });

  // ENVIRONMENT SEPARATION (locked): this adapter is the TEST endpoint —
  // config.environment === "test" expects livemode:false. A live event here
  // (or a test event on the future live endpoint) is a configuration fault:
  // refuse loudly, grant nothing.
  const expectLive = config.environment === "production";
  if (event.livemode !== expectLive) {
    slog("stripe_environment_mismatch", { eventLivemode: !!event.livemode, endpointEnvironment: config.environment });
    return { status: 400, body: { error: "environment_mismatch" } };
  }

  try {
    switch (event.type) {
      case "checkout.session.completed":
      case "checkout.session.async_payment_succeeded":
        return await handleCompletedSession({ db, session: event.data.object, event, config, now });
      case "charge.refunded":
        return await handleChargeRefunded({ db, charge: event.data.object, config, now });
      case "charge.dispute.created":
        return await handleDisputeCreated({ db, dispute: event.data.object, config, now });
      default:
        return { status: 200, body: { received: true, ignored: event.type } };
    }
  } catch (err) {
    // Transient failure (e.g. Firestore contention): 500 so Stripe retries —
    // the deterministic purchase identity makes the retry safe.
    console.error("[payment] stripe webhook processing failure:", err?.message);
    return { status: 500, body: { error: "processing_failure" } };
  }
}

async function handleCompletedSession({ db, session, event, config, now }) {
  const s = session;
  if (s.payment_status !== "paid") {
    return { status: 200, body: { received: true, ignored: "unpaid" } };
  }
  if (s.mode !== "payment") {
    return { status: 200, body: { received: true, ignored: "not_one_time_payment" } };
  }
  const uid = s.metadata?.uid || null;
  if (!uid || (s.client_reference_id && s.client_reference_id !== uid)) {
    // Our server writes BOTH at session creation; absence/disagreement means
    // this session was not minted by us → held, zero value.
    slog("stripe_uid_missing", { sessionId: s.id ?? null });
    await recordHeldPurchase({
      db,
      provider: "stripe",
      providerTransactionId: String(s.id ?? `evt_${event.id}`),
      reason: "uid_missing",
      details: { eventId: event.id ?? null },
      now,
    });
    return { status: 200, body: { received: true, held: "uid_missing" } };
  }
  const internalProduct = s.metadata?.internalProduct || null;
  const spec = internalProduct ? PURCHASABLE_PRODUCTS[internalProduct] : null;
  if (!spec || spec.purchaseType !== "credit_pack" || !Number.isInteger(spec.grantPaidCredits)) {
    slog("stripe_unknown_price", { sessionId: s.id ?? null, internalProduct });
    await recordHeldPurchase({
      db,
      provider: "stripe",
      providerTransactionId: String(s.id ?? `evt_${event.id}`),
      uid,
      reason: "unknown_product",
      details: { internalProduct, eventId: event.id ?? null },
      now,
    });
    return { status: 200, body: { received: true, held: "unknown_product" } };
  }
  // Gross plausibility (AUD minor units === pack Credits by our price table).
  if (String(s.currency).toLowerCase() !== "aud" || s.amount_total !== spec.grantPaidCredits) {
    slog("stripe_amount_mismatch", { sessionId: s.id ?? null, internalProduct, amount: s.amount_total ?? null, currency: s.currency ?? null });
    await recordHeldPurchase({
      db,
      provider: "stripe",
      providerTransactionId: String(s.id ?? `evt_${event.id}`),
      uid,
      reason: "amount_mismatch",
      details: { internalProduct, amountTotal: s.amount_total ?? null, currency: s.currency ?? null },
      now,
    });
    return { status: 200, body: { received: true, held: "amount_mismatch" } };
  }

  const purchase = normalizeVerifiedPurchase({
    provider: "stripe",
    providerTransactionId: String(s.id),
    providerOriginalTransactionId: s.payment_intent ? String(s.payment_intent) : null,
    providerProductId: s.metadata?.priceId || stripeLookupKeyFor(internalProduct),
    internalProduct,
    uid,
    purchaseType: "credit_pack",
    currency: "AUD",
    grossAmountMinor: s.amount_total,
    purchasedAt: Number.isInteger(s.created) ? s.created * 1000 : now,
    environment: config.environment,
    verificationRef: event.id ?? null,
    meta: { eventId: event.id ?? null },
  });
  const res = await grantVerifiedCreditPurchase({ db, purchase, expectedEnvironment: config.environment, now });
  if (res.ok && !res.duplicate) {
    slog("stripe_purchase_granted", { purchaseId: res.purchaseId, internalProduct, grantedCredits: res.grantedCredits });
  } else if (res.ok && res.duplicate) {
    slog("stripe_purchase_duplicate", { purchaseId: res.purchaseId });
  }
  return { status: 200, body: { received: true, granted: res.ok, duplicate: res.duplicate ?? false } };
}

/**
 * charge.refunded — fires with CUMULATIVE amount_refunded. Reversal identity
 * is `{chargeId}_refunded_{cumulative}` so each new refund state claws once
 * and redeliveries collapse; payments.mjs's cumulative cap converts the
 * cumulative gross into the correct DELTA and can never exceed the grant —
 * which also makes refund+dispute overlaps structurally double-claw-proof.
 */
async function handleChargeRefunded({ db, charge, config, now }) {
  const pi = charge.payment_intent ? String(charge.payment_intent) : null;
  if (!pi) return { status: 200, body: { received: true, ignored: "no_payment_intent" } };
  const amountRefunded = charge.amount_refunded;
  if (!Number.isInteger(amountRefunded) || amountRefunded <= 0) {
    return { status: 200, body: { received: true, ignored: "no_refund_amount" } };
  }
  const purchase = await findPurchaseByProviderRef({ db, provider: "stripe", providerOriginalTransactionId: pi });
  if (!purchase?.providerTransactionId) {
    slog("stripe_refund_duplicate", { reason: "unmatched_purchase" });
    return { status: 200, body: { received: true, ignored: "unmatched_purchase" } };
  }
  const fullyRefunded = Number.isInteger(charge.amount) ? amountRefunded >= charge.amount : false;
  const res = await applyProviderReversal({
    db,
    provider: "stripe",
    providerTransactionId: purchase.providerTransactionId,
    providerReversalRef: `${charge.id}_refunded_${amountRefunded}`,
    grossRefundedMinor: fullyRefunded ? null : amountRefunded,
    expectedEnvironment: config.environment,
    now,
  });
  if (res.ok && !res.duplicate) {
    slog("stripe_refund_applied", { purchaseId: res.purchaseId, creditsReversed: res.creditsReversed });
  } else if (res.ok && res.duplicate) {
    slog("stripe_refund_duplicate", { purchaseId: res.purchaseId });
  } else if (res.error === "already_fully_reversed") {
    slog("stripe_refund_duplicate", { purchaseId: res.purchaseId, reason: "already_fully_reversed" });
  }
  return { status: 200, body: { received: true, reversed: res.ok, duplicate: res.duplicate ?? false } };
}

/** Dispute funds are withdrawn by the network: claw everything unreversed.
 *  If a refund already clawed it, the cap yields already_fully_reversed. */
async function handleDisputeCreated({ db, dispute, config, now }) {
  const pi = dispute.payment_intent ? String(dispute.payment_intent) : null;
  if (!pi) return { status: 200, body: { received: true, ignored: "no_payment_intent" } };
  const purchase = await findPurchaseByProviderRef({ db, provider: "stripe", providerOriginalTransactionId: pi });
  if (!purchase?.providerTransactionId) {
    return { status: 200, body: { received: true, ignored: "unmatched_purchase" } };
  }
  const res = await applyProviderReversal({
    db,
    provider: "stripe",
    providerTransactionId: purchase.providerTransactionId,
    providerReversalRef: String(dispute.id),
    grossRefundedMinor: null, // full remaining — the network took the funds
    expectedEnvironment: config.environment,
    now,
  });
  if (res.ok && !res.duplicate) {
    slog("stripe_refund_applied", { purchaseId: res.purchaseId, creditsReversed: res.creditsReversed, via: "dispute" });
  } else if (res.error === "already_fully_reversed" || res.duplicate) {
    slog("stripe_refund_duplicate", { purchaseId: res.purchaseId, via: "dispute" });
  }
  return { status: 200, body: { received: true, reversed: res.ok, duplicate: res.duplicate ?? false } };
}
