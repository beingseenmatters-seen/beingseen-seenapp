/**
 * payments.mjs — Gift.Seen unified real-money payment core (Payment Phase 2).
 *
 * ONE provider-neutral grant path for every future adapter (Stripe web,
 * Apple StoreKit, Google Play Billing): the adapter verifies the provider's
 * own proof, builds a NORMALIZED VERIFIED PURCHASE via
 * `normalizeVerifiedPurchase`, and hands it to the central grant. Nothing in
 * this module talks to a provider, and nothing here is HTTP-routable in this
 * phase — index.mjs deliberately does not import it yet.
 *
 * TRUST BOUNDARY (owner-locked):
 *   - The client NEVER increases Paid Credits. There is no route shaped like
 *     POST /billing/grant {uid, credits} and there must never be one.
 *   - `grantVerifiedCreditPurchase` accepts ONLY objects minted by
 *     `normalizeVerifiedPurchase` (module-private WeakSet brand): a handler
 *     cannot hand-craft a passing object from request data — it would have
 *     to run the validator deliberately, which no route does.
 *   - Grant quantity comes from PURCHASABLE_PRODUCTS alone. Client/provider
 *     net revenue, commissions and price fields never change the grant: the
 *     500-Credit pack grants exactly 500, on every provider.
 *
 * ACCOUNTING (owner-locked):
 *   - creditLedger stays the immutable accounting truth; the purchase entry
 *     and the provider_clawback entry are append-only rows using the SAME
 *     ledgerEntry schema billing.mjs reserved for this day
 *     (provider/providerRef/reversesEntryId/status).
 *   - paymentPurchases/{id} is the small MUTABLE lifecycle record
 *     (verified→granted→reversed, or held) — never a wallet balance.
 *   - Gift.Seen offers NO voluntary refunds. `applyProviderReversal` exists
 *     only for VERIFIED provider-enforced reversals (Apple/Google/Stripe
 *     refund·revoke·chargeback). A reversal only ever touches Paid:
 *     freeDelta is structurally 0. Paid MAY go negative — the negative
 *     balance IS the debt; billing.mjs spendableCredits blocks Paid spending
 *     (never Free) until later purchases clear it by plain addition.
 *
 * Money amounts are integer MINOR units (cents) — no floats anywhere.
 * No raw card data, CVV or provider secrets are ever accepted or stored:
 * `normalizeVerifiedPurchase` whitelists fields, so unknown ones drop.
 */
import { createHash } from "node:crypto";
import {
  CREDIT_LEDGER,
  readAccountWithTopUp,
  applyWrites,
  ledgerEntry,
  isAlreadyExists,
} from "./billing.mjs";

export const PAYMENT_PURCHASES = "paymentPurchases";
export const PAYMENT_SCHEMA_VERSION = 1;

/**
 * The purchasable-product catalog — the ONLY authority on what a verified
 * real-money purchase grants. Separate from CHARGEABLE_PRODUCTS (consumption)
 * on purpose: buying and spending are different registries with different
 * invariants. Unknown products FAIL CLOSED (held, no value).
 *
 * Commercial anchor (owner-locked): AU$1 = 100 Paid Credits; Paid Credits
 * never expire, are non-transferable and non-redeemable for cash.
 */
export const PURCHASABLE_PRODUCTS = {
  credits_500: { purchaseType: "credit_pack", grantPaidCredits: 500 },
  credits_1000: { purchaseType: "credit_pack", grantPaidCredits: 1000 },
  credits_2000: { purchaseType: "credit_pack", grantPaidCredits: 2000 },
  credits_5000: { purchaseType: "credit_pack", grantPaidCredits: 5000 },
  credits_10000: { purchaseType: "credit_pack", grantPaidCredits: 10000 },
  // Annual Tag services (Pet AU$59 / Car AU$39 / Luggage AU$29 per year) —
  // ENTITLEMENT products, reserved. Phase 2 defines them so provider product
  // IDs can be mapped durably, but grants REFUSE them (entitlement_not_active)
  // until the tagServiceEntitlements phase is approved. Never Credits.
  pet_annual: { purchaseType: "tag_annual_service", serviceType: "pet", active: false },
  car_annual: { purchaseType: "tag_annual_service", serviceType: "car", active: false },
  luggage_annual: { purchaseType: "tag_annual_service", serviceType: "luggage", active: false },
};

export const PAYMENT_PROVIDERS = Object.freeze(["stripe", "apple", "google", "test_fixture"]);
export const PAYMENT_ENVIRONMENTS = Object.freeze(["test", "sandbox", "production"]);

// --- Deterministic identities ----------------------------------------------

const sha40 = (s) => createHash("sha256").update(String(s)).digest("hex").slice(0, 40);

/**
 * ONE provider transaction = ONE purchase identity, forever. Hashing keeps
 * raw provider tokens (notably Google purchase tokens) out of Firestore doc
 * IDs while staying deterministic — the same event delivered ten times lands
 * on the same doc and the same ledger entry id.
 */
export function purchaseIdFor({ provider, providerTransactionId }) {
  return `purchase_${provider}_${sha40(`${provider}|${providerTransactionId}`)}`;
}

/** ONE provider reversal event = ONE clawback identity (refund/dispute id). */
export function reversalIdFor({ provider, providerReversalRef }) {
  return `reversal_${provider}_${sha40(`${provider}|${providerReversalRef}`)}`;
}

// --- Normalized verified purchase (the ONLY grantable object) ---------------

/** Module-private brand: only normalizeVerifiedPurchase mints members. */
const TRUSTED = new WeakSet();

const okStr = (v, max) => typeof v === "string" && v.length > 0 && v.length <= max;
const optStr = (v, max) => v === null || v === undefined || okStr(v, max);

/**
 * Validate + freeze a provider-neutral verified purchase. Fields are
 * WHITELISTED — anything else (card numbers, CVV, raw JWS bodies, secrets)
 * is dropped by construction. Throws `invalid_verified_purchase:<field>` so
 * a mis-built adapter fails loudly, long before money logic.
 *
 * `status` is forced to "verified": an adapter may only call this AFTER its
 * provider proof actually verified.
 */
export function normalizeVerifiedPurchase(fields = {}) {
  const bad = (f) => {
    throw new Error(`invalid_verified_purchase:${f}`);
  };
  if (!PAYMENT_PROVIDERS.includes(fields.provider)) bad("provider");
  if (!okStr(fields.providerTransactionId, 512)) bad("providerTransactionId");
  if (!optStr(fields.providerOriginalTransactionId, 512)) bad("providerOriginalTransactionId");
  if (!okStr(fields.providerProductId, 256)) bad("providerProductId");
  if (!okStr(fields.internalProduct, 64)) bad("internalProduct");
  if (!okStr(fields.uid, 128)) bad("uid");
  if (fields.purchaseType !== "credit_pack" && fields.purchaseType !== "tag_annual_service") bad("purchaseType");
  if (!/^[A-Z]{3}$/.test(String(fields.currency ?? ""))) bad("currency");
  if (!Number.isInteger(fields.grossAmountMinor) || fields.grossAmountMinor < 0) bad("grossAmountMinor");
  if (!Number.isInteger(fields.purchasedAt) || fields.purchasedAt <= 0) bad("purchasedAt");
  if (!PAYMENT_ENVIRONMENTS.includes(fields.environment)) bad("environment");
  if (!optStr(fields.verificationRef, 512)) bad("verificationRef");
  let meta = {};
  if (fields.meta !== undefined && fields.meta !== null) {
    if (typeof fields.meta !== "object" || Array.isArray(fields.meta)) bad("meta");
    meta = { ...fields.meta };
    if (JSON.stringify(meta).length > 2000) bad("meta");
  }
  const purchase = Object.freeze({
    provider: fields.provider,
    providerTransactionId: fields.providerTransactionId,
    providerOriginalTransactionId: fields.providerOriginalTransactionId ?? null,
    providerProductId: fields.providerProductId,
    internalProduct: fields.internalProduct,
    uid: fields.uid,
    purchaseType: fields.purchaseType,
    currency: fields.currency,
    grossAmountMinor: fields.grossAmountMinor,
    purchasedAt: fields.purchasedAt,
    environment: fields.environment,
    status: "verified",
    verificationRef: fields.verificationRef ?? null,
    meta,
  });
  TRUSTED.add(purchase);
  return purchase;
}

// --- Observability (ids and hashes only — never tokens/JWS/secrets) ---------

function plog(event, fields = {}) {
  try {
    console.log(`[payment] ${event}`, JSON.stringify(fields));
  } catch {
    console.log(`[payment] ${event}`);
  }
}

// --- paymentPurchases document shape ----------------------------------------

function purchaseDoc(purchase, purchaseId, now, extra = {}) {
  return {
    schemaVersion: PAYMENT_SCHEMA_VERSION,
    purchaseId,
    uid: purchase.uid ?? null,
    provider: purchase.provider ?? null,
    providerTransactionId: purchase.providerTransactionId ?? null,
    providerOriginalTransactionId: purchase.providerOriginalTransactionId ?? null,
    providerProductId: purchase.providerProductId ?? null,
    internalProduct: purchase.internalProduct ?? null,
    purchaseType: purchase.purchaseType ?? null,
    currency: purchase.currency ?? null,
    grossAmountMinor: purchase.grossAmountMinor ?? null,
    environment: purchase.environment ?? null,
    status: "verified",
    holdReason: null,
    grantedCredits: 0,
    reversedCredits: 0,
    ledgerEntryId: null,
    purchasedAt: purchase.purchasedAt ?? null,
    grantedAt: null,
    reversedAt: null,
    createdAt: now,
    updatedAt: now,
    meta: purchase.meta ?? {},
    ...extra,
  };
}

/**
 * Idempotently record a purchase that must NOT grant value: UID unresolvable,
 * unknown product, environment mismatch, verification ambiguity. Diagnosable
 * forever (deterministic id), worth zero Credits, no ledger row. Also the
 * door future adapters use when they cannot even normalize (uid_mismatch).
 */
export async function recordHeldPurchase({
  db,
  provider,
  providerTransactionId,
  uid = null,
  reason,
  details = {},
  now = Date.now(),
}) {
  if (!PAYMENT_PROVIDERS.includes(provider) || !okStr(providerTransactionId, 512) || !okStr(reason, 64)) {
    return { ok: false, error: "invalid_hold" };
  }
  const purchaseId = purchaseIdFor({ provider, providerTransactionId });
  const ref = db.collection(PAYMENT_PURCHASES).doc(purchaseId);
  const doc = purchaseDoc(
    { provider, providerTransactionId, uid, meta: { ...details } },
    purchaseId,
    now,
    { status: "held", holdReason: reason },
  );
  try {
    await ref.create(doc);
    plog("purchase_held", { purchaseId, provider, reason });
    return { ok: true, held: true, purchaseId, existing: false };
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
    const snap = await ref.get();
    const existing = snap.exists ? snap.data() : null;
    return { ok: true, held: existing?.status === "held", purchaseId, existing: true, status: existing?.status ?? null };
  }
}

// --- Central grant -----------------------------------------------------------

/**
 * Convert ONE verified purchase into ONE Paid Credits grant, atomically:
 * ledger purchase entry + paid increment + paymentPurchases status=granted
 * commit together or not at all. Free is untouched except the normal lazy
 * weekly top-up that every wallet transaction applies. Duplicates (same
 * provider transaction, any count, any concurrency) converge on the original
 * grant via the deterministic entry id + tx.create.
 */
export async function grantVerifiedCreditPurchase({
  db,
  purchase,
  expectedEnvironment = "production",
  now = Date.now(),
}) {
  if (!purchase || !TRUSTED.has(purchase)) {
    plog("grant_refused_untrusted", {});
    return { ok: false, error: "untrusted_purchase" };
  }
  const purchaseId = purchaseIdFor(purchase);

  // Fail-closed triage → held (no value, diagnosable, idempotent).
  const hold = async (reason) => {
    const h = await recordHeldPurchase({
      db,
      provider: purchase.provider,
      providerTransactionId: purchase.providerTransactionId,
      uid: purchase.uid,
      reason,
      details: { internalProduct: purchase.internalProduct, providerProductId: purchase.providerProductId, environment: purchase.environment },
      now,
    });
    if (h.existing && h.status === "granted") {
      // A granted purchase can never be re-held — surface the conflict.
      return { ok: false, error: "already_granted_conflict", purchaseId };
    }
    return { ok: false, error: reason, held: true, purchaseId };
  };

  if (purchase.environment !== expectedEnvironment) return hold("environment_mismatch");
  const spec = PURCHASABLE_PRODUCTS[purchase.internalProduct];
  if (!spec) return hold("unknown_product");
  if (spec.purchaseType !== purchase.purchaseType) return hold("product_type_mismatch");
  if (purchase.purchaseType !== "credit_pack") return hold("entitlement_not_active");
  if (!Number.isInteger(spec.grantPaidCredits) || spec.grantPaidCredits <= 0) return hold("unknown_product");
  const grant = spec.grantPaidCredits;

  const pRef = db.collection(PAYMENT_PURCHASES).doc(purchaseId);
  const lRef = db.collection(CREDIT_LEDGER).doc(purchaseId);

  const run = () =>
    db.runTransaction(async (tx) => {
      const lSnap = await tx.get(lRef);
      if (lSnap.exists) {
        // Financial truth already stands. Heal the lifecycle doc if a crash
        // window left it missing/behind — no balance write either way.
        const entry = lSnap.data();
        const pSnap = await tx.get(pRef);
        if (!pSnap.exists) {
          tx.set(
            pRef,
            purchaseDoc(purchase, purchaseId, now, {
              status: "granted",
              grantedCredits: entry.paidDelta ?? grant,
              ledgerEntryId: purchaseId,
              grantedAt: entry.createdAt ?? now,
            }),
          );
        }
        return { ok: true, duplicate: true, purchaseId, entryId: purchaseId, grantedCredits: entry.paidDelta ?? grant };
      }
      const pSnap = await tx.get(pRef);
      if (pSnap.exists && pSnap.data().status === "held") {
        // Held stays held — triage is a human/adapter decision, never an
        // automatic re-grant on retry.
        return { ok: false, error: "held", held: true, purchaseId };
      }

      const { account, accRef, writes } = await readAccountWithTopUp({ db, tx, uid: purchase.uid, now });
      const balancesAfter = { free: account.free, paid: account.paid + grant };
      applyWrites(tx, writes); // account create / weekly top-up first, as everywhere
      tx.create(
        lRef,
        ledgerEntry({
          uid: purchase.uid,
          type: "purchase",
          amount: grant,
          freeDelta: 0,
          paidDelta: grant,
          product: purchase.internalProduct,
          quantity: 1,
          unitPrice: grant,
          subjectType: "payment",
          subjectId: purchaseId,
          provider: purchase.provider,
          providerRef: purchase.providerTransactionId,
          balancesAfter,
          createdAt: now,
          meta: {
            currency: purchase.currency,
            grossAmountMinor: purchase.grossAmountMinor,
            environment: purchase.environment,
            purchaseType: purchase.purchaseType,
            providerProductId: purchase.providerProductId,
          },
        }),
      );
      tx.set(
        accRef,
        {
          schemaVersion: account.schemaVersion ?? 1,
          free: balancesAfter.free,
          paid: balancesAfter.paid,
          freeTopUpAt: account.freeTopUpAt,
          createdAt: account.createdAt ?? now,
          updatedAt: now,
          version: (account.version ?? 0) + 1,
        },
        { merge: true },
      );
      tx.set(
        pRef,
        purchaseDoc(purchase, purchaseId, now, {
          status: "granted",
          grantedCredits: grant,
          ledgerEntryId: purchaseId,
          grantedAt: now,
        }),
      );
      return {
        ok: true,
        duplicate: false,
        purchaseId,
        entryId: purchaseId,
        grantedCredits: grant,
        balances: balancesAfter,
        debtCleared: account.paid < 0 && balancesAfter.paid >= 0,
      };
    });

  let res;
  try {
    res = await run();
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
    res = await run(); // loser of a create race re-observes the winner's grant
  }
  if (res.ok && !res.duplicate) {
    plog("purchase_granted", { purchaseId, provider: purchase.provider, internalProduct: purchase.internalProduct, grantedCredits: res.grantedCredits });
    if (res.debtCleared) plog("debt_cleared", { uid: purchase.uid, purchaseId });
  } else if (res.ok && res.duplicate) {
    plog("duplicate_purchase", { purchaseId, provider: purchase.provider });
  }
  return res;
}

// --- Provider-enforced reversal (clawback) ----------------------------------

/**
 * Apply ONE verified provider-enforced reversal (refund / revoke /
 * chargeback). NOT a customer refund feature — Gift.Seen offers none; only a
 * provider's own verified action reaches here, via a future adapter.
 *
 * Append-only: the original purchase entry is never edited — a new
 * `provider_clawback` row (reversesEntryId → original) subtracts Paid.
 * freeDelta is structurally 0: weekly Free Credits are never reduced because
 * a paid purchase was reversed. Paid may go NEGATIVE (owner-locked debt
 * model); spendability handles the rest in billing.mjs.
 *
 * Partial reversals (Stripe partial refunds): proportional by integer minor
 * units — creditsReversed = round(grantedCredits × refundedMinor ÷
 * grossMinor), cumulative-capped so the sum of clawbacks can never exceed
 * the original grant. Full reversal (grossRefundedMinor omitted/null) claws
 * back everything still unreversed.
 */
export async function applyProviderReversal({
  db,
  provider,
  providerTransactionId,
  providerReversalRef,
  grossRefundedMinor = null,
  expectedEnvironment = "production",
  now = Date.now(),
}) {
  if (!PAYMENT_PROVIDERS.includes(provider)) return { ok: false, error: "invalid_provider" };
  if (!okStr(providerTransactionId, 512)) return { ok: false, error: "invalid_transaction_ref" };
  if (!okStr(providerReversalRef, 512)) return { ok: false, error: "invalid_reversal_ref" };
  if (grossRefundedMinor !== null && (!Number.isInteger(grossRefundedMinor) || grossRefundedMinor <= 0)) {
    return { ok: false, error: "invalid_reversal_amount" };
  }
  const purchaseId = purchaseIdFor({ provider, providerTransactionId });
  const reversalId = reversalIdFor({ provider, providerReversalRef });
  const pRef = db.collection(PAYMENT_PURCHASES).doc(purchaseId);
  const lRef = db.collection(CREDIT_LEDGER).doc(reversalId);

  const run = () =>
    db.runTransaction(async (tx) => {
      const rSnap = await tx.get(lRef);
      if (rSnap.exists) {
        return { ok: true, duplicate: true, purchaseId, reversalId, creditsReversed: rSnap.data().amount ?? 0 };
      }
      const pSnap = await tx.get(pRef);
      if (!pSnap.exists) return { ok: false, error: "purchase_not_found", purchaseId };
      const doc = pSnap.data();
      if (doc.status === "held" || !Number.isInteger(doc.grantedCredits) || doc.grantedCredits <= 0) {
        return { ok: false, error: "not_granted", purchaseId };
      }
      if (doc.environment !== expectedEnvironment) {
        return { ok: false, error: "environment_mismatch", purchaseId };
      }
      const granted = doc.grantedCredits;
      const alreadyReversed = Number.isInteger(doc.reversedCredits) ? doc.reversedCredits : 0;
      const remaining = granted - alreadyReversed;
      if (remaining <= 0) return { ok: false, error: "already_fully_reversed", purchaseId };

      let creditsReversed = remaining;
      if (grossRefundedMinor !== null) {
        const gross = doc.grossAmountMinor;
        if (!Number.isInteger(gross) || gross <= 0) return { ok: false, error: "invalid_reversal_amount", purchaseId };
        const computed = Math.round((granted * grossRefundedMinor) / gross);
        if (computed <= 0) return { ok: false, error: "invalid_reversal_amount", purchaseId };
        creditsReversed = Math.min(remaining, computed);
      }

      const { account, accRef, writes } = await readAccountWithTopUp({ db, tx, uid: doc.uid, now });
      const balancesAfter = { free: account.free, paid: account.paid - creditsReversed };
      applyWrites(tx, writes);
      tx.create(
        lRef,
        ledgerEntry({
          uid: doc.uid,
          type: "provider_clawback",
          amount: creditsReversed,
          freeDelta: 0, // LOCKED: a paid reversal never touches Free
          paidDelta: -creditsReversed,
          product: doc.internalProduct,
          quantity: 1,
          unitPrice: creditsReversed,
          subjectType: "payment",
          subjectId: purchaseId,
          provider,
          providerRef: providerReversalRef,
          reversesEntryId: doc.ledgerEntryId ?? purchaseId,
          balancesAfter,
          createdAt: now,
          meta: {
            mode: grossRefundedMinor === null ? "full" : "partial",
            grossRefundedMinor,
            grantedCredits: granted,
          },
        }),
      );
      tx.set(
        accRef,
        {
          schemaVersion: account.schemaVersion ?? 1,
          free: balancesAfter.free,
          paid: balancesAfter.paid,
          freeTopUpAt: account.freeTopUpAt,
          createdAt: account.createdAt ?? now,
          updatedAt: now,
          version: (account.version ?? 0) + 1,
        },
        { merge: true },
      );
      const cumulative = alreadyReversed + creditsReversed;
      tx.update(pRef, {
        reversedCredits: cumulative,
        status: cumulative >= granted ? "reversed" : "granted",
        reversedAt: now,
        updatedAt: now,
      });
      return {
        ok: true,
        duplicate: false,
        purchaseId,
        reversalId,
        creditsReversed,
        balances: balancesAfter,
        debtEntered: account.paid >= 0 && balancesAfter.paid < 0,
      };
    });

  let res;
  try {
    res = await run();
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
    res = await run();
  }
  if (res.ok && !res.duplicate) {
    plog("provider_clawback", { purchaseId, reversalId, provider, creditsReversed: res.creditsReversed });
    if (res.debtEntered) plog("debt_entered", { purchaseId });
  } else if (res.ok && res.duplicate) {
    plog("duplicate_clawback", { purchaseId, reversalId, provider });
  }
  return res;
}

// --- Read models -------------------------------------------------------------

/**
 * Find a purchase by its provider's ORIGINAL transaction reference (e.g. a
 * Stripe payment_intent) — reversal events often reference the payment, not
 * the checkout session that is our purchase identity. Internal use by
 * adapters; returns the RAW doc (adapter-side only, never serialized out).
 */
export async function findPurchaseByProviderRef({ db, provider, providerOriginalTransactionId }) {
  if (!okStr(providerOriginalTransactionId, 512)) return null;
  const snap = await db
    .collection(PAYMENT_PURCHASES)
    .where("providerOriginalTransactionId", "==", providerOriginalTransactionId)
    .get();
  const rows = (snap.docs ?? []).map((d) => d.data()).filter((r) => r.provider === provider);
  return rows[0] ?? null;
}

/** Lifecycle status of one purchase (safe fields only; null if unknown). */
export async function getPurchaseStatus({ db, provider, providerTransactionId }) {
  const purchaseId = purchaseIdFor({ provider, providerTransactionId });
  const snap = await db.collection(PAYMENT_PURCHASES).doc(purchaseId).get();
  if (!snap.exists) return null;
  return safePurchaseView(snap.data());
}

/**
 * The caller's OWN payment history, newest first — module-level only in this
 * phase (no HTTP route yet; the Stripe phase wires it into an authenticated
 * read-only door). Never exposes raw provider tokens, signed transactions or
 * secrets: the view is a fixed whitelist.
 */
export async function listUserPurchases({ db, uid, limit = 50 }) {
  const n = Math.max(1, Math.min(200, Number.isInteger(limit) ? limit : 50));
  const snap = await db.collection(PAYMENT_PURCHASES).where("uid", "==", uid).get();
  return (snap.docs ?? [])
    .map((d) => d.data())
    .sort((a, b) => (b.createdAt ?? 0) - (a.createdAt ?? 0))
    .slice(0, n)
    .map(safePurchaseView);
}

function safePurchaseView(d) {
  return {
    purchaseId: d.purchaseId ?? null,
    provider: d.provider ?? null,
    internalProduct: d.internalProduct ?? null,
    purchaseType: d.purchaseType ?? null,
    currency: d.currency ?? null,
    grossAmountMinor: d.grossAmountMinor ?? null,
    environment: d.environment ?? null,
    status: d.status ?? null,
    holdReason: d.holdReason ?? null,
    grantedCredits: d.grantedCredits ?? 0,
    reversedCredits: d.reversedCredits ?? 0,
    purchasedAt: d.purchasedAt ?? null,
    grantedAt: d.grantedAt ?? null,
    reversedAt: d.reversedAt ?? null,
  };
}
