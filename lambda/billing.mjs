/**
 * billing.mjs — Gift.Seen Credits ledger core (Monetisation Phase 2).
 *
 * SERVER-AUTHORITATIVE by construction:
 *   - creditAccounts/{uid}   materialized balance (a cache the ledger rebuilds)
 *   - creditLedger/{entryId} append-only, immutable; THE ENTRY ID IS THE
 *     IDEMPOTENCY KEY (deterministic ids make double-charging structurally
 *     impossible: retries collide on tx.create and the caller re-returns the
 *     original outcome).
 *
 * LOCKED product rules implemented here:
 *   - 100 Credits = AU$1 (no purchase exists in Phase 2 — paid stays 0)
 *   - weekly Free Credits TOP UP TO 200 (never accumulate; paid untouched)
 *   - consumption order: Free first, Paid second, recorded per-entry
 *   - simple_gift_publish = 20 Credits · gift_tag_publish = 50 Credits —
 *     the ONLY chargeable products; prices live HERE, never in a request body
 *   - Mind.Seen is public-benefit EXEMPT: nothing in /mind may reach
 *     chargeCredits, and this module FAILS CLOSED (no deduction) for any
 *     product code not in the registry or any mind-typed subject.
 *
 * Weekly top-up is LAZY (no cron/scheduler exists in this stack, deliberately):
 * every balance read and every charge evaluates the current ISO week
 * (UTC, server clock — client time is never trusted) inside the same
 * transaction, keyed `topup_{uid}_{weekKey}` so racing Lambdas cannot
 * double-grant.
 *
 * Deletion classification: creditAccounts + creditLedger are RETAINED
 * financial/audit records — accountDeletion.mjs must never touch them.
 */

export const CREDIT_ACCOUNTS = "creditAccounts";
export const CREDIT_LEDGER = "creditLedger";
export const BILLING_SCHEMA_VERSION = 1;

export const WEEKLY_FREE_CREDITS = 200;

/**
 * The chargeable-product registry — the ONLY authority on what may cost
 * Credits and how much. Unknown product codes FAIL CLOSED (no deduction, no
 * default price). Mind.Seen is exempt by NEVER appearing here; `subjectType`
 * 'mind' is additionally refused outright in chargeCredits.
 */
export const CHARGEABLE_PRODUCTS = {
  simple_gift_publish: { unitPrice: 20, subjectType: "gift" },
  // Gift.Tag digital publication (LOCKED 2026-09-04: 50 Credits ≙ AU$0.50).
  // Trusted classification stays the SERVER-MINTED tagPublishAuth grant
  // (gift.mjs) — no client field ever selects this product or its price.
  gift_tag_publish: { unitPrice: 50, subjectType: "gift" },

  // Official PREPRINTED unique-QR Gift.Tag (founder-locked 2026-09-05): ONE
  // physical card = ONE 100-Credit digital activation for its LIFETIME —
  // content publication rides free inside this flow (never separately), and
  // after activation every scan/view/quick-reply/reopen is 0. Classification
  // derives from the tag document's own type (tag.mjs) — no client field
  // ever selects this product or the cheaper self-print path.
  preprinted_gift_tag_activation: { unitPrice: 100, subjectType: "tag" },

  // --- Phase 3 (LOCKED 2026-09-04) -----------------------------------------
  // 轻松相聚: 20 Credits per successfully PUBLISHED gathering — flat, never
  // per person/invitation. Classification comes from the SEALED occasion →
  // events/{id}.type (validateOccasion contract), never a bare client string;
  // the deterministic ledger key `cas_{eventId}` makes the whole gathering
  // cost exactly 20 once, however many invitations or scanners follow.
  // COMMERCIAL MODEL UPDATE (founder-locked 2026-09-05): one published
  // gathering = 100 flat — commercially aligned with a shared event
  // invitation; never per participant. Existing gatherings keep their
  // historical ledger entries (cas_{eventId} dedup — no retro-charging).
  casual_gathering_publish: { unitPrice: 100, subjectType: "event" },
  // 私人活动 (wedding/birthday) & 商务活动: 100 Credits per INDEPENDENT
  // INVITATION successfully issued (owner correction: per invitation record,
  // NEVER multiplied by party size / RSVP counts / attendance). Organizer
  // pays; guests open, RSVP and interact free.
  private_event_invitation: { unitPrice: 100, subjectType: "invitation" },
  business_event_invitation: { unitPrice: 100, subjectType: "invitation" },
  // 现场互动: the organizer buys PARTICIPANT CAPACITY before use (additive,
  // idempotent); participants join/answer/message free within capacity. One
  // human (participantIdHash) consumes at most one seat per capability.
  live_draw_capacity: { unitPrice: 100, subjectType: "live" },
  live_guess_capacity: { unitPrice: 100, subjectType: "live" },
  live_guestbook_capacity: { unitPrice: 50, subjectType: "live" },
};

/**
 * Operations that are LOCKED-FREE by product rule (not merely "unknown"):
 * they never reach chargeCredits at all — listed so the registry documents
 * every billing outcome. Mind.Seen is public-benefit exempt; a Quick Reply
 * is an acknowledgment attached to a gift, never a publication.
 */
export const FREE_PRODUCTS = {
  quick_reply: { unitPrice: 0 },
  mind_seen: { unitPrice: 0 },
};

export const IDEMPOTENCY_KEY_RE = /^[A-Za-z0-9_-]{8,64}$/;

/**
 * Spendable Credits (Payment Phase 2, owner-locked debt rule): a VERIFIED
 * provider reversal (Apple/Google/Stripe refund·revoke·chargeback) may drive
 * `paid` NEGATIVE — the negative balance IS the unrecovered debt, on the
 * ledger itself, never in a second bookkeeping system. Debt blocks PAID
 * spending only: weekly Free Credits stay fully usable, so spendability is
 * free + max(0, paid) — never free + paid. Future legitimate purchases clear
 * debt by plain addition before any Paid Credit becomes spendable again.
 */
export function spendableCredits({ free = 0, paid = 0 } = {}) {
  return free + Math.max(0, paid);
}

// --- Week arithmetic (UTC ISO-8601 weeks; server clock only) ---------------

/** ISO-8601 week key, e.g. "2026-W36". UTC-based; never trusts client time. */
export function weekKey(nowMs) {
  const d = new Date(nowMs);
  const target = new Date(Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate()));
  // ISO week: Thursday determines the week-year.
  const day = target.getUTCDay() || 7;
  target.setUTCDate(target.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(target.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((target - yearStart) / 86_400_000 + 1) / 7);
  return `${target.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

/** Start of the NEXT ISO week (UTC Monday 00:00) — for UI "refreshes at". */
export function nextWeekStartMs(nowMs) {
  const d = new Date(nowMs);
  const day = d.getUTCDay() || 7; // Mon=1 … Sun=7
  const next = Date.UTC(d.getUTCFullYear(), d.getUTCMonth(), d.getUTCDate() + (8 - day));
  return next;
}

// --- Internal: lazy top-up evaluated INSIDE a transaction -------------------

/**
 * Read the account inside `tx`, applying account creation and/or the weekly
 * top-up as queued writes. Returns the effective state plus the writes to
 * commit. Never touches `paid`. Idempotent under races: the account create
 * uses tx.create (loser retries and sees the winner's doc) and the top-up
 * ledger entry id is deterministic per (uid, week).
 */
export async function readAccountWithTopUp({ db, tx, uid, now }) {
  // (exported for payments.mjs — the real-money grant/clawback transactions
  // reuse the SAME account read + lazy weekly top-up, so every financial
  // path shares one wallet invariant implementation.)
  const accRef = db.collection(CREDIT_ACCOUNTS).doc(uid);
  const snap = await tx.get(accRef);
  const wk = weekKey(now);
  const topupRef = db.collection(CREDIT_LEDGER).doc(`topup_${uid}_${wk}`);

  if (!snap.exists) {
    // First eligibility: seed free=200 and record the grant.
    const account = {
      schemaVersion: BILLING_SCHEMA_VERSION,
      free: WEEKLY_FREE_CREDITS,
      paid: 0,
      freeTopUpAt: now,
      createdAt: now,
      updatedAt: now,
      version: 1,
    };
    const entry = ledgerEntry({
      uid,
      type: "free_topup",
      amount: WEEKLY_FREE_CREDITS,
      freeDelta: WEEKLY_FREE_CREDITS,
      paidDelta: 0,
      product: "weekly_free",
      quantity: 1,
      unitPrice: WEEKLY_FREE_CREDITS,
      balancesAfter: { free: WEEKLY_FREE_CREDITS, paid: 0 },
      createdAt: now,
      meta: { weekKey: wk, initial: true },
    });
    return {
      accRef,
      account,
      isNew: true,
      writes: [
        { kind: "create", ref: accRef, data: account },
        { kind: "create", ref: topupRef, data: entry },
      ],
    };
  }

  const acc = snap.data();
  const account = {
    ...acc,
    free: Number.isInteger(acc.free) ? acc.free : 0,
    paid: Number.isInteger(acc.paid) ? acc.paid : 0,
  };
  if (weekKey(account.freeTopUpAt ?? 0) === wk) {
    return { accRef, account, isNew: false, writes: [] };
  }

  // New ISO week: top up TO 200 exactly (0→200, 40→200, 175→200, 200→200).
  const freeBefore = Math.min(account.free, WEEKLY_FREE_CREDITS);
  const freeDelta = WEEKLY_FREE_CREDITS - freeBefore;
  const topped = {
    ...account,
    free: WEEKLY_FREE_CREDITS,
    freeTopUpAt: now,
    updatedAt: now,
    version: (account.version ?? 0) + 1,
  };
  const writes = [
    {
      kind: "update",
      ref: accRef,
      data: {
        free: WEEKLY_FREE_CREDITS,
        freeTopUpAt: now,
        updatedAt: now,
        version: topped.version,
      },
    },
  ];
  if (freeDelta > 0) {
    writes.push({
      kind: "create",
      ref: topupRef,
      data: ledgerEntry({
        uid,
        type: "free_topup",
        amount: freeDelta,
        freeDelta,
        paidDelta: 0,
        product: "weekly_free",
        quantity: 1,
        unitPrice: WEEKLY_FREE_CREDITS,
        balancesAfter: { free: WEEKLY_FREE_CREDITS, paid: topped.paid },
        createdAt: now,
        meta: { weekKey: wk, freeBefore },
      }),
    });
  }
  return { accRef, account: topped, isNew: false, writes };
}

export function applyWrites(tx, writes) {
  for (const w of writes) {
    if (w.kind === "create") tx.create(w.ref, w.data);
    else if (w.kind === "update") tx.update(w.ref, w.data);
    else tx.set(w.ref, w.data);
  }
}

/** Immutable ledger entry with every schema field present (nulls explicit).
 *  Exported for payments.mjs so purchase/provider_clawback rows carry the
 *  exact same schema (provider/providerRef/reversesEntryId/status were
 *  reserved here from day one for precisely that). */
export function ledgerEntry(fields) {
  return {
    schemaVersion: BILLING_SCHEMA_VERSION,
    uid: null,
    type: null,
    amount: 0,
    freeDelta: 0,
    paidDelta: 0,
    product: null,
    quantity: 0,
    unitPrice: 0,
    subjectType: null,
    subjectId: null,
    app: "giftseen",
    provider: null,
    providerRef: null,
    reversesEntryId: null,
    status: "posted",
    balancesAfter: null,
    createdAt: 0,
    meta: {},
    ...fields,
  };
}

/**
 * tx.create on an existing doc surfaces ALREADY_EXISTS (gRPC code 6), which
 * the Admin SDK does NOT auto-retry (only contention/ABORTED is). Under a
 * race, the loser of an account-create / weekly-top-up / charge-entry create
 * lands here: one clean re-run then sees the winner's docs and takes the
 * idempotent path. This makes duplicate grants and duplicate charges
 * impossible even across concurrent Lambda invocations.
 */
export function isAlreadyExists(err) {
  return err?.code === 6 || /ALREADY_EXISTS/i.test(String(err?.message ?? ""));
}

// --- Admin maintenance (direct-invoke only; never HTTP-routable) ------------

/**
 * ONE-OFF Phase 3 production-testing grant (owner-directed, 2026-09-04):
 * +10,000 PAID Credits to the Seen Matters admin account. NOT a purchase —
 * ledger type "adjustment", product "admin_test_grant", provider null.
 *
 * Security shape (owner requirements):
 *   - NO parameters: target email, amount and the ledger id are constants
 *     here — there is no email+amount minting surface anywhere;
 *   - the financial identity is the AUTHORITATIVE Firebase UID resolved via
 *     Firebase Auth at execution time, never the email string itself;
 *   - reachable ONLY through a bare direct `lambda invoke` maintenance event
 *     (index.mjs refuses it for anything shaped like an API Gateway request),
 *     so executing it requires AWS IAM lambda:InvokeFunction — admin
 *     credentials — and it is not publicly routable;
 *   - IDEMPOTENT FOREVER by the deterministic ledger id
 *     `admin_test_grant_phase3_{uid}`: a second execution changes nothing
 *     and reports already_applied. It can never grant 20,000.
 *   - Free Credits untouched (the standard weekly top-up read still applies
 *     its normal lazy semantics; paid alone is incremented).
 */
export const ADMIN_TEST_GRANT_EMAIL = "beingseenmatters@gmail.com";
export const ADMIN_TEST_GRANT_AMOUNT = 10_000;

export async function adminTestGrantPhase3({ db, auth, now = Date.now() }) {
  let user;
  try {
    user = await auth.getUserByEmail(ADMIN_TEST_GRANT_EMAIL);
  } catch {
    return { ok: false, error: "target_account_not_found" };
  }
  const uid = user.uid;
  const entryId = `admin_test_grant_phase3_${uid}`;
  const entryRef = db.collection(CREDIT_LEDGER).doc(entryId);

  const run = () => db.runTransaction(async (tx) => {
    const existing = await tx.get(entryRef);
    if (existing.exists) {
      return { ok: true, alreadyApplied: true, uid, entryId, entry: existing.data() };
    }
    const { account, accRef, writes } = await readAccountWithTopUp({ db, tx, uid, now });
    const before = { free: account.free, paid: account.paid };
    const balancesAfter = { free: account.free, paid: account.paid + ADMIN_TEST_GRANT_AMOUNT };
    applyWrites(tx, writes); // account create / weekly top-up first, as everywhere
    const entry = ledgerEntry({
      uid,
      type: "adjustment",
      amount: ADMIN_TEST_GRANT_AMOUNT,
      freeDelta: 0,
      paidDelta: ADMIN_TEST_GRANT_AMOUNT,
      product: "admin_test_grant",
      quantity: 1,
      unitPrice: ADMIN_TEST_GRANT_AMOUNT,
      subjectType: "admin",
      subjectId: uid,
      provider: null,
      providerRef: null,
      balancesAfter,
      createdAt: now,
      meta: { reason: "Phase 3 production testing", oneOff: "admin_test_grant_phase3" },
    });
    tx.create(entryRef, entry);
    tx.set(
      accRef,
      {
        schemaVersion: BILLING_SCHEMA_VERSION,
        free: balancesAfter.free,
        paid: balancesAfter.paid,
        freeTopUpAt: account.freeTopUpAt,
        createdAt: account.createdAt ?? now,
        updatedAt: now,
        version: (account.version ?? 0) + 1,
      },
      { merge: true },
    );
    return { ok: true, alreadyApplied: false, uid, entryId, entry, before, balancesAfter };
  });

  try {
    return await run();
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
    const snap = await entryRef.get();
    if (snap.exists) return { ok: true, alreadyApplied: true, uid, entryId, entry: snap.data() };
    return await run();
  }
}

// --- Public API -------------------------------------------------------------

/**
 * Server-authoritative balance, applying the lazy weekly top-up.
 * Used by POST /billing/balance and safe to call from anywhere.
 */
export async function getBalance({ db, uid, now = Date.now() }) {
  const run = () =>
    db.runTransaction(async (tx) => {
      const { account, writes } = await readAccountWithTopUp({ db, tx, uid, now });
      applyWrites(tx, writes);
      return { free: account.free, paid: account.paid };
    });
  let result;
  try {
    result = await run();
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
    result = await run(); // loser of a create race: winner's state is now readable
  }
  return {
    free: result.free,
    paid: result.paid,
    total: result.free + result.paid,
    // What the account can actually spend right now — differs from `total`
    // only while a provider reversal holds `paid` below zero (debt).
    spendable: spendableCredits(result),
    weekKey: weekKey(now),
    nextFreeRefreshAt: nextWeekStartMs(now),
  };
}

/**
 * Credits activity (Founder, 2026-09-04): the OWNER's own ledger, normalized
 * for display. Read-only and uid-scoped by construction — the query is keyed
 * on the verified uid, nothing here can write, and no other account's entry
 * can be addressed. Newest first, bounded (default 50, max 200).
 *
 * Labels are resolved SERVER-side from the owner's own records (guest label
 * for invitation charges, event title for 轻松相聚, session title for live
 * capacity, the gift's salutation for simple/tag publishes and preprinted
 * activations) — display sugar only; the immutable ledger stays the single
 * accounting truth.
 */
export const HISTORY_DEFAULT_LIMIT = 50;
export const HISTORY_MAX_LIMIT = 200;

export async function creditHistory({ db, uid, limit = HISTORY_DEFAULT_LIMIT }) {
  const n = Math.max(1, Math.min(HISTORY_MAX_LIMIT, Number.isInteger(limit) ? limit : HISTORY_DEFAULT_LIMIT));
  const snap = await db.collection(CREDIT_LEDGER).where("uid", "==", uid).get();
  const entries = (snap.docs ?? [])
    .map((d) => ({ id: d.id, e: d.data() }))
    .sort((a, b) => (b.e.createdAt ?? 0) - (a.e.createdAt ?? 0))
    .slice(0, n);

  // Batched, owner-verified label lookups (≤ limit docs per type).
  const get = async (col, id) => {
    if (!id) return null;
    const doc = await db.collection(col).doc(id).get();
    return doc.exists ? doc.data() : null;
  };
  const rows = [];
  for (const { id, e } of entries) {
    let label = null;
    let eventType = null;
    try {
      if (e.product === "private_event_invitation" || e.product === "business_event_invitation") {
        const g = await get("eventGuests", e.meta?.guestId);
        if (g && g.senderUid === uid) label = g.label ?? null;
        const ev = await get("events", e.meta?.eventId);
        if (ev && ev.senderUid === uid) {
          eventType = ev.type ?? null;
          if (!label) label = ev.occasion?.eventTitle ?? null; // shared-link publish rows
        }
      } else if (e.product === "casual_gathering_publish") {
        const ev = await get("events", e.meta?.eventId ?? e.subjectId);
        if (ev && ev.senderUid === uid) { label = ev.occasion?.eventTitle ?? null; eventType = ev.type ?? null; }
      } else if (typeof e.product === "string" && e.product.startsWith("live_")) {
        const sess = await get("liveSessions", e.meta?.sessionId);
        if (sess && sess.ownerUid === uid) label = sess.title ?? null;
      } else if (e.product === "simple_gift_publish" || e.product === "gift_tag_publish") {
        const g = await get("giftMessages", e.subjectId);
        if (g && g.senderUid === uid) label = g.recipientLabel ?? null;
      } else if (e.product === "preprinted_gift_tag_activation") {
        // The identity that means something to the owner is who the sealed
        // gift is FOR (same as the publish rows). The printed card code stays
        // sealed-at-rest — the read path never opens share tokens.
        const g = await get("giftMessages", e.meta?.giftId);
        if (g && g.senderUid === uid) label = g.recipientLabel ?? null;
        if (!label) {
          const tg = await get("tags", e.subjectId);
          if (tg && tg.ownerUid === uid) label = tg.displayLabel ?? null;
        }
      }
    } catch { /* label resolution is best-effort; the row still renders */ }
    rows.push({
      entryId: id,
      type: e.type ?? null,
      product: e.product ?? null,
      amount: e.amount ?? 0,
      freeDelta: e.freeDelta ?? 0,
      paidDelta: e.paidDelta ?? 0,
      quantity: e.quantity ?? 0,
      unitPrice: e.unitPrice ?? 0,
      subjectType: e.subjectType ?? null,
      subjectId: e.subjectId ?? null,
      createdAt: e.createdAt ?? 0,
      ...(e.meta?.eventId ? { eventId: e.meta.eventId } : {}),
      ...(e.meta?.sessionId ? { sessionId: e.meta.sessionId } : {}),
      ...(e.meta?.seats ? { seats: e.meta.seats } : {}),
      label,
      eventType,
    });
  }
  return rows;
}

/** POST /billing/balance — authenticated, read-only (top-up aside).
 *  Optional `history: { limit? }` in the body additionally returns the
 *  caller's own Credits activity (extends the EXISTING door — no new route,
 *  no new gateway permission). */
export async function balanceHandler({ db, decoded, body = null, now = Date.now() }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };
  const bal = await getBalance({ db, uid: decoded.uid, now });
  if (body?.history) {
    const history = await creditHistory({ db, uid: decoded.uid, limit: body.history.limit });
    return { status: 200, body: { ...bal, history } };
  }
  return { status: 200, body: bal };
}

/**
 * Charge Credits AND commit the domain writes in ONE atomic transaction.
 *
 * `domainWrites`: [{ kind:'create'|'set'|'update', ref, data }] — committed
 * IFF the charge commits (charge-without-publish and publish-without-charge
 * are both structurally impossible).
 *
 * Idempotency: `entryId` (charge_gift_{uid}_{idempotencyKey}) is checked
 * inside the transaction; if it already exists the transaction performs NO
 * writes and the original entry is returned with `duplicate: true` so the
 * caller can rebuild the original success response.
 *
 * Fail-closed rules (no deduction ever):
 *   - product not in CHARGEABLE_PRODUCTS  → unchargeable_product
 *   - subjectType 'mind' (any casing)     → unchargeable_product
 *   - malformed idempotency key           → invalid_idempotency_key
 *   - insufficient balance                → insufficient_credits (no writes)
 */
export async function chargeCredits({
  db,
  uid,
  product,
  idempotencyKey,
  quantity = 1,
  subjectId = null,
  domainWrites = [],
  /**
   * Optional transactional guard: async (tx) → { ok:true, writes:[…] } |
   * { ok:false, error }. Runs INSIDE the charge transaction (read phase),
   * before any balance math; its writes commit atomically with the charge.
   * This is how single-use authorizations (tagPublishAuth) participate in
   * the SAME transaction as the ledger/account/domain records — a racing
   * transaction that consumed the authorization first forces this one to
   * retry, re-observe the consumed state, and refuse with NO writes.
   */
  guard = null,
  meta = {},
  now = Date.now(),
}) {
  const spec = CHARGEABLE_PRODUCTS[product];
  if (!spec) {
    console.error(`[billing] refused: product not chargeable: ${String(product)}`);
    return { ok: false, error: "unchargeable_product" };
  }
  if (String(spec.subjectType).toLowerCase() === "mind") {
    console.error("[billing] refused: mind subjects are public-benefit exempt");
    return { ok: false, error: "unchargeable_product" };
  }
  if (!uid) return { ok: false, error: "unauthorized" };
  if (typeof idempotencyKey !== "string" || !IDEMPOTENCY_KEY_RE.test(idempotencyKey)) {
    return { ok: false, error: "invalid_idempotency_key" };
  }
  if (!Number.isInteger(quantity) || quantity < 1) {
    return { ok: false, error: "invalid_quantity" };
  }

  const price = spec.unitPrice * quantity;
  const entryId = `charge_gift_${uid}_${idempotencyKey}`;
  const entryRef = db.collection(CREDIT_LEDGER).doc(entryId);

  const run = () => db.runTransaction(async (tx) => {
    const existing = await tx.get(entryRef);
    if (existing.exists) {
      // Retry of a completed publication — no writes; caller rebuilds the
      // original outcome from the entry it stored.
      return { ok: true, duplicate: true, entryId, entry: existing.data() };
    }

    let guardWrites = [];
    if (guard) {
      const g = await guard(tx);
      if (!g?.ok) {
        // Authorization refused inside the transaction: NOTHING is written.
        return { ok: false, error: g?.error ?? "unauthorized" };
      }
      guardWrites = g.writes ?? [];
    }

    const { account, accRef, writes } = await readAccountWithTopUp({ db, tx, uid, now });

    if (spendableCredits(account) < price) {
      // Abort with NO writes at all (the queued top-up also stays unwritten;
      // it will be applied by the next read — bounded loss of nothing, since
      // top-up is derived, not accrued).
      //
      // spendableCredits (not free+paid): a negative paid balance is provider
      // -reversal debt — it must never block the weekly Free Credits, and
      // Paid consumption stays refused until purchases clear the debt. When
      // paid < 0 this gate only passes if Free alone covers the price, so
      // the Free-first split below leaves the negative paid untouched
      // (paidConsumed is 0 by arithmetic).
      return {
        ok: false,
        error: "insufficient_credits",
        free: account.free,
        paid: account.paid,
        needed: price,
      };
    }

    const freeConsumed = Math.min(account.free, price);
    const paidConsumed = price - freeConsumed;
    const balancesAfter = {
      free: account.free - freeConsumed,
      paid: account.paid - paidConsumed,
    };

    applyWrites(tx, writes); // account create / weekly top-up first
    applyWrites(tx, guardWrites); // e.g. single-use authorization consumption
    const entry = ledgerEntry({
      uid,
      type: "charge",
      amount: price,
      freeDelta: -freeConsumed,
      paidDelta: -paidConsumed,
      product,
      quantity,
      unitPrice: spec.unitPrice,
      subjectType: spec.subjectType,
      subjectId,
      balancesAfter,
      createdAt: now,
      meta: { ...meta, idempotencyKey },
    });
    tx.create(entryRef, entry);
    const version = (account.version ?? 0) + 1;
    tx.set(
      accRef,
      {
        schemaVersion: BILLING_SCHEMA_VERSION,
        free: balancesAfter.free,
        paid: balancesAfter.paid,
        freeTopUpAt: account.freeTopUpAt,
        createdAt: account.createdAt ?? now,
        updatedAt: now,
        version,
      },
      { merge: true },
    );
    for (const w of domainWrites) {
      if (w.kind === "create") tx.create(w.ref, w.data);
      else if (w.kind === "update") tx.update(w.ref, w.data);
      else tx.set(w.ref, w.data);
    }
    return { ok: true, duplicate: false, entryId, entry, balances: balancesAfter };
  });

  try {
    return await run();
  } catch (err) {
    if (!isAlreadyExists(err)) throw err;
    // Race loser. Two cases: (a) the CHARGE entry was created by a concurrent
    // identical request — return it as the idempotent duplicate outcome;
    // (b) the collision was on the account/top-up docs — one clean re-run
    // takes the idempotent path.
    const snap = await entryRef.get();
    if (snap.exists) return { ok: true, duplicate: true, entryId, entry: snap.data() };
    return await run();
  }
}
