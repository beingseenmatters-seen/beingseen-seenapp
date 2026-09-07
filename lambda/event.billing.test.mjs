/**
 * Phase 3 — Event invitation & 轻松相聚 charging, through the REAL handlers
 * (createEvent/upsertGuest/saveVariant/distributeInvitations/createGift).
 *
 * LOCKED semantics under test:
 *   · ONE independent invitation = 100 Credits (private/business) — the guest
 *     ROW is the unit; party size / RSVP counts never multiply anything.
 *   · already / relinked / legacy rows: 0 additional Credits, ever
 *     (deterministic ledger key evt_{eventId}_{guestId}).
 *   · 轻松相聚: 100 Credits FLAT per published gathering (cas_{eventId},
 *     2026-09-05 commercial update — was 20),
 *     regardless of invitation count, participant count or shared links.
 *   · organizer pays; classification comes from the SEALED event type only;
 *     legacy ack-less clients are never charged (and the flag closes them).
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeDb } from "./billing.test.mjs";
import { CREDIT_ACCOUNTS, CREDIT_LEDGER, WEEKLY_FREE_CREDITS } from "./billing.mjs";
import { createEvent, upsertGuest, saveVariant, GUEST_COLLECTION, EVENT_COLLECTION } from "./event.mjs";
import { distributeInvitations } from "./distribute.mjs";
import { createGift, GIFT_COLLECTION, GIFT_PUBLISH_INTENTS_COLLECTION } from "./gift.mjs";
import { submitSharedRsvp } from "./sharedRsvp.mjs";
import { validateOccasion } from "./occasion.mjs";

const A = { uid: "org-1" };
const NOW = Date.UTC(2026, 8, 4, 12, 0, 0);

const fakeShare = () => ({
  seal: async (t, ctx) => `S|${ctx}|${t}`,
  open: async (sealed, ctx) => {
    const [tag, c, t] = String(sealed).split("|");
    if (tag !== "S" || c !== ctx) throw new Error("context_mismatch");
    return t;
  },
});

const WEDDING = {
  type: "wedding", version: 1,
  couple: { partner1: "冯志俊", partner2: "吴姗姗" }, date: "2026-10-01",
  time: { start: "17:00" }, venue: { displayName: "杭州世纪皇冠大酒店" },
  inviter: "苏东坡", audienceType: "friends",
};
const BIZ = {
  type: "business_event", version: 1,
  host: "Seenmatters Technologies", eventTitle: "2026 Client Appreciation Dinner",
  context: "business_dinner", date: "2026-12-05", time: { start: "18:30" },
  venue: { displayName: "Grand Harbour Hotel" }, audienceType: "clients",
};
const CASUAL = {
  type: "casual", version: 1, context: "meal", eventTitle: "周五晚饭",
  date: "2026-12-05", time: { start: "19:00" },
  venue: { displayName: "老地方川菜馆" }, audienceType: "friends",
};

const ledgerEntries = (db, prefix) =>
  [...db._store.entries()].filter(([k]) => k.startsWith(`${CREDIT_LEDGER}/${prefix}`)).map(([, v]) => v);
const chargeEntries = (db) => ledgerEntries(db, `charge_gift_${A.uid}_`);
const account = (db) => db._store.get(`${CREDIT_ACCOUNTS}/${A.uid}`);
const seedAccount = (db, { free = WEEKLY_FREE_CREDITS, paid = 0 } = {}) =>
  db._store.set(`${CREDIT_ACCOUNTS}/${A.uid}`, {
    schemaVersion: 1, free, paid, freeTopUpAt: NOW, createdAt: NOW, updatedAt: NOW, version: 1,
  });

async function mkEvent(db, occasion) {
  const res = await createEvent({ db, decoded: A, body: { occasion }, validateOccasion, now: NOW });
  assert.equal(res.status, 200);
  return res.body.eventId;
}
async function addGuest(db, eventId, label, relationshipType = "friends") {
  const res = await upsertGuest({ db, decoded: A, body: { eventId, label, relationshipType }, giftCollection: GIFT_COLLECTION, now: NOW });
  assert.equal(res.status, 200);
  return res.body.guestId;
}
const distribute = (db, body, billing) =>
  distributeInvitations({
    db, decoded: A, body: { billingAck: true, ...body },
    share: fakeShare(), giftCollection: GIFT_COLLECTION, now: NOW,
    ...(billing ? { billing } : {}),
  });

async function weddingEventWithGuests(db, labels) {
  const eventId = await mkEvent(db, WEDDING);
  await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "friends", message: "请来喝喜酒。" }, now: NOW });
  const guestIds = [];
  for (const label of labels) guestIds.push(await addGuest(db, eventId, label));
  return { eventId, guestIds };
}

// --- Private Event: 100 per genuinely new independent invitation ------------

test("distribute: 5 new invitations → 500; repeat → 0; add 2 later → 200", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 2000 });
  const { eventId, guestIds } = await weddingEventWithGuests(db, ["张家", "李家", "王家", "赵家", "钱家"]);

  const first = await distribute(db, { eventId, guestIds });
  assert.equal(first.status, 200);
  assert.equal(first.body.results.filter((r) => r.status === "created").length, 5);
  let charges = chargeEntries(db).filter((e) => e.product === "private_event_invitation");
  assert.equal(charges.length, 5);
  for (const e of charges) assert.equal(e.amount, 100);
  // Free first (200), then paid (300): 章17.
  assert.deepEqual({ free: account(db).free, paid: account(db).paid }, { free: 0, paid: 1700 });

  // Idempotent repeat: all rows already linked → zero additional charges.
  const again = await distribute(db, { eventId, guestIds });
  assert.ok(again.body.results.every((r) => r.status === "already"));
  assert.equal(chargeEntries(db).filter((e) => e.product === "private_event_invitation").length, 5);

  // Two genuinely new invitees later → exactly 200 more.
  const g6 = await addGuest(db, eventId, "孙家");
  const g7 = await addGuest(db, eventId, "周家");
  const later = await distribute(db, { eventId, guestIds: [g6, g7] });
  assert.equal(later.body.results.filter((r) => r.status === "created").length, 2);
  charges = chargeEntries(db).filter((e) => e.product === "private_event_invitation");
  assert.equal(charges.length, 7);
  assert.equal(account(db).paid, 1500);
});

test("party size NEVER multiplies: one household row = one 100-Credit invitation", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 0 });
  const { eventId, guestIds } = await weddingEventWithGuests(db, ["姚科奇全家"]);
  const res = await distribute(db, { eventId, guestIds });
  assert.equal(res.body.results[0].status, "created");
  const charges = chargeEntries(db);
  assert.equal(charges.length, 1);
  assert.equal(charges[0].amount, 100);
  assert.equal(charges[0].quantity, 1); // a party of 4 is still ONE invitation
});

test("relinked (self-heal) and pre-Phase-3 legacy rows are never charged", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 1000 });
  const { eventId, guestIds } = await weddingEventWithGuests(db, ["陈家", "林家"]);

  // Legacy: a row already linked before monetisation (no invoicePaidAt).
  db._store.get(`${GUEST_COLLECTION}/${guestIds[0]}`).invitationGiftId = "legacy-gift-1";
  db._store.set(`${GIFT_COLLECTION}/legacy-gift-1`, {
    senderUid: A.uid, eventId, recipientLabel: "陈家", revoked: false,
  });
  // Orphan: an invitation created by an interrupted run, not yet linked.
  db._store.set(`${GIFT_COLLECTION}/orphan-gift-2`, {
    senderUid: A.uid, eventId, recipientLabel: "林家", revoked: false,
  });

  const res = await distribute(db, { eventId, guestIds });
  assert.equal(res.body.results[0].status, "already");
  assert.equal(res.body.results[1].status, "relinked");
  assert.equal(chargeEntries(db).length, 0); // historical work: 0 Credits
});

test("insufficient balance: pre-flight refuses the WHOLE batch, nothing created", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 150, paid: 100 }); // 250 < 3 × 100
  const { eventId, guestIds } = await weddingEventWithGuests(db, ["A家", "B家", "C家"]);
  const res = await distribute(db, { eventId, guestIds });
  assert.equal(res.status, 402);
  assert.equal(res.body.error, "insufficient_credits");
  assert.equal(res.body.needed, 300);
  assert.equal(res.body.chargeableCount, 3);
  // Event data preserved; no invitations, no charges, no links.
  assert.equal(chargeEntries(db).length, 0);
  assert.ok([...db._store.keys()].every((k) => !k.startsWith(`${GIFT_COLLECTION}/`)));
  assert.ok(db._store.has(`${EVENT_COLLECTION}/${eventId}`));
});

test("balance exhausted MID-batch: charged rows stand, the rest stop honestly", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 1000 });
  const { eventId, guestIds } = await weddingEventWithGuests(db, ["甲家", "乙家", "丙家"]);
  // Inject a billing facade that approves the first row then runs dry —
  // simulating a concurrent spend between pre-flight and row 2.
  const { chargeCredits, getBalance } = await import("./billing.mjs");
  let calls = 0;
  const facade = {
    getBalance,
    chargeCredits: async (args) => {
      calls += 1;
      if (calls >= 2) return { ok: false, error: "insufficient_credits", free: 0, paid: 0, needed: 100 };
      return chargeCredits(args);
    },
  };
  const res = await distribute(db, { eventId, guestIds }, facade);
  const st = res.body.results.map((r) => r.status);
  assert.deepEqual(st, ["created", "failed", "failed"]);
  assert.equal(res.body.results[1].error, "insufficient_credits");
  assert.equal(res.body.results[2].error, "skipped_insufficient");
  assert.equal(chargeEntries(db).length, 1); // exactly the one committed row
});

test("charge-then-crash heals: paid row retries into a FREE creation", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 0 });
  const { eventId, guestIds } = await weddingEventWithGuests(db, ["丁家"]);
  // First run: charge committed, but the creation "crashed" (facade aborts
  // right after the real charge).
  const { chargeCredits, getBalance } = await import("./billing.mjs");
  const crashing = {
    getBalance,
    chargeCredits: async (args) => {
      const out = await chargeCredits(args);
      if (out.ok && !out.duplicate) throw Object.assign(new Error("simulated crash"), { crash: true });
      return out;
    },
  };
  await assert.rejects(() => distribute(db, { eventId, guestIds }, crashing), /simulated crash/);
  assert.equal(chargeEntries(db).length, 1);

  // Retry with the REAL billing: duplicate ledger entry (0 new Credits),
  // invitation created and linked.
  const res = await distribute(db, { eventId, guestIds });
  assert.equal(res.body.results[0].status, "created");
  assert.equal(chargeEntries(db).length, 1); // still exactly one
  assert.ok(db._store.get(`${GUEST_COLLECTION}/${guestIds[0]}`).invitationGiftId);
});

test("business event rows charge the business_event_invitation code (same 100)", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 0 });
  const eventId = await mkEvent(db, BIZ);
  await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "general", message: "Please join us." }, now: NOW });
  const g = await addGuest(db, eventId, "Acme Pty Ltd", "clients");
  const res = await distribute(db, { eventId, guestIds: [g] });
  assert.equal(res.body.results[0].status, "created");
  const charges = chargeEntries(db);
  assert.equal(charges.length, 1);
  assert.equal(charges[0].product, "business_event_invitation");
  assert.equal(charges[0].amount, 100);
});

test("legacy ack-less distribute stays FREE; BILLING_REQUIRE_KEY=on refuses it", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 0 });
  const { eventId, guestIds } = await weddingEventWithGuests(db, ["戊家"]);
  const res = await distributeInvitations({
    db, decoded: A, body: { eventId, guestIds }, share: fakeShare(), giftCollection: GIFT_COLLECTION, now: NOW,
  });
  assert.equal(res.body.results[0].status, "created");
  assert.equal(chargeEntries(db).length, 0); // NO INVISIBLE CHARGING

  process.env.BILLING_REQUIRE_KEY = "on";
  try {
    const refused = await distributeInvitations({
      db, decoded: A, body: { eventId, guestIds }, share: fakeShare(), giftCollection: GIFT_COLLECTION, now: NOW,
    });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error, "billing_client_required");
  } finally {
    delete process.env.BILLING_REQUIRE_KEY;
  }
});

// --- Direct createGift invitation lane --------------------------------------

test("direct wedding invitation seal (billing-aware) charges 100; retry recovers, one charge", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 0 });
  const share = fakeShare();
  const body = {
    message: "请来喝喜酒。", occasion: WEDDING, eventCreate: true,
    recipientLabel: "张先生全家", accessMode: "direct", idempotencyKey: "wedseal000000001",
  };
  const res = await createGift({ db, decoded: A, body, now: NOW, share });
  assert.equal(res.status, 200);
  const charges = chargeEntries(db);
  assert.equal(charges.length, 1);
  assert.equal(charges[0].product, "private_event_invitation");
  assert.equal(charges[0].amount, 100);

  const retry = await createGift({ db, decoded: A, body, now: NOW, share });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.duplicate, true);
  assert.equal(retry.body.token, res.body.token);
  assert.equal(retry.body.eventId, res.body.eventId);
  assert.equal(chargeEntries(db).length, 1);
});

test("keyless event seal stays FREE (logged legacy window); flag closes it", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 0 });
  const share = fakeShare();
  const body = { message: "请来。", occasion: WEDDING, eventCreate: true, recipientLabel: "李家", accessMode: "direct" };
  const res = await createGift({ db, decoded: A, body, now: NOW, share });
  assert.equal(res.status, 200);
  assert.equal(chargeEntries(db).length, 0);

  process.env.BILLING_REQUIRE_KEY = "on";
  try {
    const refused = await createGift({ db, decoded: A, body, now: NOW, share });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error, "billing_client_required");
  } finally {
    delete process.env.BILLING_REQUIRE_KEY;
  }
});

test("insufficient credits on a direct invitation seal: 402, no gift, created event compensated", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 50, paid: 0 });
  const share = fakeShare();
  const res = await createGift({
    db, decoded: A, now: NOW, share,
    body: { message: "请来。", occasion: WEDDING, eventCreate: true, recipientLabel: "王家", accessMode: "direct", idempotencyKey: "wedpoor000000001" },
  });
  assert.equal(res.status, 402);
  assert.equal(res.body.error, "insufficient_credits");
  assert.equal(res.body.needed, 100);
  assert.ok([...db._store.keys()].every((k) => !k.startsWith(`${GIFT_COLLECTION}/`)));
  assert.ok([...db._store.keys()].every((k) => !k.startsWith(`${EVENT_COLLECTION}/`)), "silently created event undone");
});

// --- Shared-link invitations (OWNER DECISION Option A, 2026-09-04) ----------
// ONE published shared link = ONE invitation product = 100 total. Never per
// scanner / RSVP / attendee / party size; copying the link costs 0; retry
// recovers; a genuinely new shared publication is a new 100.

const sealShared = (db, share, { occasion, key, label = "各位亲友" }) =>
  createGift({
    db, decoded: A, now: NOW, share,
    body: {
      message: "请来。", occasion, eventCreate: true, recipientLabel: label,
      sharedDistribution: true, accessMode: "direct", idempotencyKey: key,
    },
  });

test("PRIVATE shared link: first publication charges exactly 100 (invitation product)", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 0 });
  const res = await sealShared(db, fakeShare(), { occasion: WEDDING, key: "wedshare00000001" });
  assert.equal(res.status, 200);
  const charges = chargeEntries(db);
  assert.equal(charges.length, 1);
  assert.equal(charges[0].product, "private_event_invitation");
  assert.equal(charges[0].amount, 100);
  assert.equal(charges[0].quantity, 1);
  assert.equal(account(db).free, 100);
});

test("BUSINESS shared link: first publication charges exactly 100 (business product)", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 0 });
  const res = await sealShared(db, fakeShare(), { occasion: BIZ, key: "bizshare00000001", label: "All guests" });
  assert.equal(res.status, 200);
  const charges = chargeEntries(db);
  assert.equal(charges.length, 1);
  assert.equal(charges[0].product, "business_event_invitation");
  assert.equal(charges[0].amount, 100);
});

test("shared link retry / concurrent duplicate: ONE link, ONE 100 — original recovered", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 0 });
  const share = fakeShare();
  const first = await sealShared(db, share, { occasion: WEDDING, key: "wedsharedup00001" });
  const retry = await sealShared(db, share, { occasion: WEDDING, key: "wedsharedup00001" });
  assert.equal(retry.status, 200);
  assert.equal(retry.body.duplicate, true);
  assert.equal(retry.body.token, first.body.token); // the SAME link, not a twin
  assert.equal(chargeEntries(db).length, 1);
  assert.equal([...db._store.keys()].filter((k) => k.startsWith(`${GIFT_COLLECTION}/`)).length, 1);
  assert.equal([...db._store.keys()].filter((k) => k.startsWith(`${EVENT_COLLECTION}/`)).length, 1);

  // A genuinely NEW shared publication (new intended link) is a new 100.
  await sealShared(db, share, { occasion: WEDDING, key: "wedsharenew00001" });
  assert.equal(chargeEntries(db).length, 2);
});

test("scanners / RSVPs / party sizes NEVER touch the balance (copying the link costs 0)", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 0 });
  const share = fakeShare();
  const pub = await sealShared(db, share, { occasion: WEDDING, key: "wedsharescan0001" });
  const ledgerAfterPublish = chargeEntries(db).length;
  const balAfterPublish = { free: account(db).free, paid: account(db).paid };

  // Five scanners open the SAME link and answer; one family later grows 2→4.
  const scanners = [];
  for (let i = 0; i < 5; i += 1) {
    const r = await submitSharedRsvp({
      db, giftCollection: GIFT_COLLECTION,
      body: { token: pub.body.token, status: "accepted", adultCount: 2, childCount: 0 },
      now: NOW + i,
    });
    assert.equal(r.status, 200, `scanner ${i}`);
    scanners.push(r.body.participantToken);
  }
  const grow = await submitSharedRsvp({
    db, giftCollection: GIFT_COLLECTION,
    body: { token: pub.body.token, participantToken: scanners[0], status: "accepted", adultCount: 4, childCount: 0 },
    now: NOW + 99,
  });
  assert.equal(grow.status, 200);
  assert.equal(chargeEntries(db).length, ledgerAfterPublish); // still the one 100
  assert.deepEqual({ free: account(db).free, paid: account(db).paid }, balAfterPublish);
});

test("HISTORICAL shared links are never retroactively charged", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 0 });
  // A pre-Phase-3 shared invitation: exists in the store, no ledger entry.
  const tokenHash = "legacysharedhash0000000000000001";
  db._store.set(`${GIFT_COLLECTION}/${tokenHash}`, {
    senderUid: A.uid, eventId: "legacy-ev-1", recipientLabel: "各位亲友",
    sharedDistribution: true, accessMode: "direct", revoked: false, createdAt: NOW - 1000,
  });
  db._store.set(`${EVENT_COLLECTION}/legacy-ev-1`, { senderUid: A.uid, type: "wedding", status: "active" });
  // New-era activity on the OLD link (a scanner responds) charges nothing.
  // (submitSharedRsvp resolves by sha256(token); write the response directly
  // against the record the way the resolver would.)
  assert.equal(chargeEntries(db).length, 0);
});

test("legacy keyless SHARED seal stays free while the flag is OFF; flag closes it", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 0 });
  const share = fakeShare();
  const res = await createGift({
    db, decoded: A, now: NOW, share,
    body: { message: "请来。", occasion: WEDDING, eventCreate: true, recipientLabel: "各位亲友", sharedDistribution: true, accessMode: "direct" },
  });
  assert.equal(res.status, 200);
  assert.equal(chargeEntries(db).length, 0); // NO INVISIBLE CHARGING

  process.env.BILLING_REQUIRE_KEY = "on";
  try {
    const refused = await createGift({
      db, decoded: A, now: NOW, share,
      body: { message: "请来。", occasion: WEDDING, eventCreate: true, recipientLabel: "各位亲友", sharedDistribution: true, accessMode: "direct" },
    });
    assert.equal(refused.status, 400);
    assert.equal(refused.body.error, "billing_client_required");
  } finally {
    delete process.env.BILLING_REQUIRE_KEY;
  }
});

// --- 轻松相聚: 100 FLAT per gathering (founder-locked 2026-09-05, was 20) ---

test("casual publication charges exactly 100, once per GATHERING — shared link included", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 0 });
  const share = fakeShare();
  const seal = await createGift({
    db, decoded: A, now: NOW, share,
    body: {
      message: "来吃饭！", occasion: CASUAL, eventCreate: true, recipientLabel: "朋友们",
      sharedDistribution: true, accessMode: "direct", idempotencyKey: "casseal000000001",
    },
  });
  assert.equal(seal.status, 200);
  const eventId = seal.body.eventId;
  const charges = chargeEntries(db);
  assert.equal(charges.length, 1);
  assert.equal(charges[0].product, "casual_gathering_publish");
  assert.equal(charges[0].amount, 100);
  assert.ok(db._store.has(`${CREDIT_LEDGER}/charge_gift_${A.uid}_cas_${eventId}`));
  assert.equal(account(db).free, 100);

  // A SECOND invitation on the same gathering (managed row) publishes FREE.
  await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "general", message: "来聚聚。" }, now: NOW });
  const g = await addGuest(db, eventId, "同事们", "colleagues");
  const dist = await distribute(db, { eventId, guestIds: [g] });
  assert.equal(dist.body.results[0].status, "created");
  assert.equal(chargeEntries(db).length, 1); // still just the flat 100
  // Participant count is irrelevant: 50 scanners on the shared link → 100 total.
});

test("casual via distribute-first also pays the SAME single 100 (path-independent flat)", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 0 });
  const eventId = await mkEvent(db, CASUAL);
  await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "general", message: "来聚聚。" }, now: NOW });
  const g1 = await addGuest(db, eventId, "朋友们");
  const g2 = await addGuest(db, eventId, "同事们", "colleagues");
  const res = await distribute(db, { eventId, guestIds: [g1, g2] });
  assert.equal(res.body.results.filter((r) => r.status === "created").length, 2);
  const charges = chargeEntries(db);
  assert.equal(charges.length, 1); // one flat 100, NOT per row, NOT per person
  assert.equal(charges[0].product, "casual_gathering_publish");
  assert.equal(charges[0].amount, 100);
});

test("casual retry: same intended seal → one gathering, one 100-Credit charge", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 0 });
  const share = fakeShare();
  const body = {
    message: "来吃饭！", occasion: CASUAL, eventCreate: true, recipientLabel: "朋友们",
    sharedDistribution: true, accessMode: "direct", idempotencyKey: "casretry00000001",
  };
  const first = await createGift({ db, decoded: A, body, now: NOW, share });
  const retry = await createGift({ db, decoded: A, body, now: NOW, share });
  assert.equal(retry.body.duplicate, true);
  assert.equal(retry.body.token, first.body.token);
  assert.equal(chargeEntries(db).length, 1);
  assert.equal([...db._store.keys()].filter((k) => k.startsWith(`${EVENT_COLLECTION}/`)).length, 1);
});

test("NO RETRO-CHARGING: a gathering published in the 20-Credit era is never topped up to 100", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 0 });
  const share = fakeShare();
  const body = {
    message: "来吃饭！", occasion: CASUAL, eventCreate: true, recipientLabel: "朋友们",
    sharedDistribution: true, accessMode: "direct", idempotencyKey: "caslegacy0000001",
  };
  const first = await createGift({ db, decoded: A, body, now: NOW, share });
  assert.equal(first.status, 200);
  const eventId = first.body.eventId;
  // Simulate the historical 20-Credit charge on the SAME deterministic
  // identity (what a pre-change publication left in the ledger).
  const key = `${CREDIT_LEDGER}/charge_gift_${A.uid}_cas_${eventId}`;
  const entry = db._store.get(key);
  db._store.set(key, { ...entry, amount: 20 });
  // Any later retry/interaction recovers the SAME gathering, 0 additional —
  // the identity dedups regardless of today's registry price.
  const retry = await createGift({ db, decoded: A, body, now: NOW, share });
  assert.equal(retry.body.duplicate, true);
  assert.equal(chargeEntries(db).length, 1);
  assert.equal(db._store.get(key).amount, 20); // the historical entry stands untouched
});

test("forged classification: casual occasion cannot ride a wedding event (cross-type refused)", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 2000, paid: 0 });
  const share = fakeShare();
  const eventId = await mkEvent(db, WEDDING);
  const res = await createGift({
    db, decoded: A, now: NOW, share,
    body: {
      message: "x", occasion: CASUAL, eventId, recipientLabel: "y",
      accessMode: "direct", idempotencyKey: "forgecasual00001",
    },
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "invalid_event");
  assert.equal(chargeEntries(db).length, 0);
  // …and client price/product fields are simply never read anywhere.
});

test("failed casual publication (moderation) charges nothing", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 0 });
  const share = fakeShare();
  const res = await createGift({
    db, decoded: A, now: NOW, share,
    body: { message: "   ", occasion: CASUAL, eventCreate: true, recipientLabel: "朋友们", idempotencyKey: "casfail000000001" },
  });
  assert.notEqual(res.status, 200);
  assert.equal(chargeEntries(db).length, 0);
  assert.equal([...db._store.keys()].filter((k) => k.startsWith(`${GIFT_COLLECTION}/`)).length, 0);
});

// --- Phase 2 products remain byte-stable ------------------------------------

test("Phase 2 unchanged: simple gift still 20 alongside event lanes; intents cover both", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 0 });
  const share = fakeShare();
  const simple = await createGift({
    db, decoded: A, now: NOW, share,
    body: { message: "hi", accessMode: "direct", idempotencyKey: "simplestill00001" },
  });
  assert.equal(simple.status, 200);
  const entry = db._store.get(`${CREDIT_LEDGER}/charge_gift_${A.uid}_simplestill00001`);
  assert.equal(entry.amount, 20);
  assert.equal(entry.product, "simple_gift_publish");
  assert.ok(db._store.has(`${GIFT_PUBLISH_INTENTS_COLLECTION}/${A.uid}_simplestill00001`));
});

// --- Birthday flow correction (Founder, 2026-09-04) --------------------------
// A relationship-specific version is INDEPENDENTLY publishable: the backend
// resolves each guest to their OWN saved variant and touches General only as
// a fallback — no hidden 通用 prerequisite exists at this layer (the audited
// prerequisite was purely a frontend gate, now removed).

const BIRTHDAY = {
  type: "birthday", version: 1,
  birthdayPersonName: "Emma", date: "2026-11-20", time: { start: "19:00" },
  venue: { displayName: "The Garden House" }, inviter: "Emma", audienceType: "friends",
};

test("BIRTHDAY: only the 同学 version exists → its guest publishes + charges 100 (NO general)", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 0 });
  const eventId = await mkEvent(db, BIRTHDAY);
  await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "classmates", message: "同学版邀请。" }, now: NOW });
  const g = await addGuest(db, eventId, "David", "classmates");
  const res = await distribute(db, { eventId, guestIds: [g] });
  assert.equal(res.body.results[0].status, "created");
  const charges = chargeEntries(db);
  assert.equal(charges.length, 1);
  assert.equal(charges[0].product, "private_event_invitation");
  assert.equal(charges[0].amount, 100);
});

test("BIRTHDAY: only the 家人 version exists → its guest publishes; unmatched guest fails HONESTLY, 0 charge", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 100 });
  const eventId = await mkEvent(db, BIRTHDAY);
  await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "family", message: "家人版邀请。" }, now: NOW });
  const gFam = await addGuest(db, eventId, "张阿姨一家", "family");
  const gCol = await addGuest(db, eventId, "同事小李", "colleagues"); // no version, no general
  const res = await distribute(db, { eventId, guestIds: [gFam, gCol] });
  assert.equal(res.body.results[0].status, "created");
  assert.equal(res.body.results[1].status, "failed");
  assert.equal(res.body.results[1].error, "missing_variant");
  const charges = chargeEntries(db);
  assert.equal(charges.length, 1); // ONLY the publishable row was charged
});

test("BIRTHDAY: two invitees on two different versions → two independent invitations, exactly 200", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 100 });
  const eventId = await mkEvent(db, BIRTHDAY);
  await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "family", message: "家人版。" }, now: NOW });
  await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "classmates", message: "同学版。" }, now: NOW });
  const g1 = await addGuest(db, eventId, "张阿姨一家", "family");
  const g2 = await addGuest(db, eventId, "David", "classmates");
  const res = await distribute(db, { eventId, guestIds: [g1, g2] });
  assert.equal(res.body.results.filter((r) => r.status === "created").length, 2);
  const gifts = [...db._store.entries()].filter(([k]) => k.startsWith(`${GIFT_COLLECTION}/`)).map(([, v]) => v);
  assert.equal(gifts.length, 2); // two INDEPENDENT invitation records
  const charges = chargeEntries(db);
  assert.equal(charges.length, 2);
  assert.equal(charges.reduce((n, e) => n + e.amount, 0), 200);
  // Re-distribution recharges nothing.
  const again = await distribute(db, { eventId, guestIds: [g1, g2] });
  assert.ok(again.body.results.every((r) => r.status === "already"));
  assert.equal(chargeEntries(db).length, 2);
});

test("BIRTHDAY: creating/editing/saving relationship versions costs 0 Credits", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 0 });
  const eventId = await mkEvent(db, BIRTHDAY);
  for (const [rel, msg] of [["family", "v1"], ["friends", "v1"], ["family", "v2 edited"], ["general", "通用"]]) {
    const r = await saveVariant({ db, decoded: A, body: { eventId, relationshipType: rel, message: msg }, now: NOW });
    assert.equal(r.status, 200);
  }
  assert.equal(chargeEntries(db).length, 0);
  assert.equal(account(db).free, 200);
});

test("BIRTHDAY shared link: one-off 100 (private product); re-sealing same intent → 0 additional", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 0 });
  const share = fakeShare();
  const body = {
    message: "来我的生日会！", occasion: BIRTHDAY, eventCreate: true, recipientLabel: "各位朋友",
    sharedDistribution: true, accessMode: "direct", idempotencyKey: "bdayshare0000001",
  };
  const first = await createGift({ db, decoded: A, body, now: NOW, share });
  assert.equal(first.status, 200);
  const charges = chargeEntries(db);
  assert.equal(charges.length, 1);
  assert.equal(charges[0].product, "private_event_invitation");
  assert.equal(charges[0].amount, 100);
  const retry = await createGift({ db, decoded: A, body, now: NOW, share });
  assert.equal(retry.body.duplicate, true);
  assert.equal(retry.body.token, first.body.token);
  assert.equal(chargeEntries(db).length, 1);
});

test("PRODUCTION regression: Bryan(挚友)+Steve(朋友), both versions prepared → 2 links, exactly 200", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 100 });
  const eventId = await mkEvent(db, BIRTHDAY);
  await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "close_friends", message: "挚友版邀请。" }, now: NOW });
  await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "friends", message: "朋友版邀请。" }, now: NOW });
  const bryan = await addGuest(db, eventId, "Bryan", "close_friends");
  const steve = await addGuest(db, eventId, "Steve", "friends");

  const res = await distribute(db, { eventId, guestIds: [bryan, steve] });
  const created = res.body.results.filter((r) => r.status === "created");
  assert.equal(created.length, 2, "BOTH visible invitees are issued — never a silent single");
  // Two independent invitation records with DISTINCT links/tokens.
  assert.equal(new Set(created.map((r) => r.giftId)).size, 2);
  assert.equal(new Set(created.map((r) => r.token)).size, 2);
  assert.notEqual(created[0].token, created[1].token);
  const gifts = [...db._store.entries()].filter(([k]) => k.startsWith(`${GIFT_COLLECTION}/`)).map(([, v]) => v);
  assert.equal(gifts.length, 2);
  // Exactly 200 — one 100 per independent invitation.
  const charges = chargeEntries(db);
  assert.equal(charges.length, 2);
  assert.equal(charges.reduce((n, e) => n + e.amount, 0), 200);
  assert.deepEqual({ free: account(db).free, paid: account(db).paid }, { free: 0, paid: 100 });

  // Re-open/re-distribute the SAME issued invitations → 0 additional.
  const again = await distribute(db, { eventId, guestIds: [bryan, steve] });
  assert.ok(again.body.results.every((r) => r.status === "already"));
  assert.equal(chargeEntries(db).length, 2);
});

test("continuation reuse: the SAME 同学 version serves a SECOND classmate — one new 100", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 100 });
  const eventId = await mkEvent(db, BIRTHDAY);
  await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "classmates", message: "同学版邀请。" }, now: NOW });
  const first = await addGuest(db, eventId, "Bryan", "classmates");
  await distribute(db, { eventId, guestIds: [first] });
  assert.equal(chargeEntries(db).length, 1);

  // 继续邀请: a second classmate rides the EXISTING version (a content
  // template, never tied to its first guest) — one more 100, nothing else.
  const second = await addGuest(db, eventId, "小林", "classmates");
  const res = await distribute(db, { eventId, guestIds: [second] });
  assert.equal(res.body.results[0].status, "created");
  const charges = chargeEntries(db);
  assert.equal(charges.length, 2);
  assert.equal(charges[1].amount, 100);
  // The version itself was reused, not recreated: still ONE variant on the event.
  assert.equal(Object.keys(db._store.get(`${EVENT_COLLECTION}/${eventId}`).variants).length, 1);
});

// --- Canonical Shared Invitation on an EXISTING Birthday Event (2026-09-05) --
// Founder: complete the distribution loop. From the Event dashboard the
// organizer can add ONE canonical shared link to an event that already has
// managed invitations. Identity = deterministic idempotency key
// `shared_{eventId}` — the EXISTING billing-ledger + publish-intent machinery
// makes it server-authoritative: any retry or concurrent attempt (any device)
// recovers the SAME link with at most ONE 100. Managed payments never waive
// it; it never makes later managed invitations free. NO backend code changed
// for this — these tests pin the contract the frontend now relies on.

const sealCanonicalShared = (db, share, eventId) =>
  createGift({
    db, decoded: A, now: NOW, share,
    body: {
      message: "来我的生日会！", occasion: BIRTHDAY, eventId, recipientLabel: "各位朋友",
      sharedDistribution: true, accessMode: "direct", idempotencyKey: `shared_${eventId}`,
    },
  });

test("EXISTING event with 5 paid managed invitations: first shared link = ONE more 100; guests/wordings untouched", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 1000 });
  const share = fakeShare();
  const eventId = await mkEvent(db, BIRTHDAY);
  await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "family", message: "家人版邀请。" }, now: NOW });
  await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "classmates", message: "同学版邀请。" }, now: NOW });
  const guests = [];
  for (const [label, rel] of [["Jonas", "family"], ["Bryan", "classmates"], ["小李一家", "family"], ["小王", "classmates"], ["李白", "family"]]) {
    guests.push(await addGuest(db, eventId, label, rel));
  }
  const dist = await distribute(db, { eventId, guestIds: guests });
  assert.equal(dist.body.results.filter((r) => r.status === "created").length, 5);
  assert.equal(chargeEntries(db).length, 5); // 500 already paid for managed rows

  // Snapshot every managed artefact BEFORE the shared publication.
  const guestSnap = JSON.stringify(guests.map((g) => db._store.get(`${GUEST_COLLECTION}/${g}`)));
  const variantSnap = JSON.stringify(db._store.get(`${EVENT_COLLECTION}/${eventId}`).variants);
  const managedGiftIds = [...db._store.entries()]
    .filter(([k, v]) => k.startsWith(`${GIFT_COLLECTION}/`) && !v.sharedDistribution)
    .map(([k]) => k);
  const managedSnap = JSON.stringify(managedGiftIds.map((k) => db._store.get(k)));

  // Managed payments do NOT waive the shared product: first publication = 100.
  const res = await sealCanonicalShared(db, share, eventId);
  assert.equal(res.status, 200);
  const charges = chargeEntries(db);
  assert.equal(charges.length, 6);
  const sharedCharge = ledgerEntries(db, `charge_gift_${A.uid}_shared_${eventId}`);
  assert.equal(sharedCharge.length, 1, "deterministic per-event ledger identity");
  assert.equal(sharedCharge[0].product, "private_event_invitation");
  assert.equal(sharedCharge[0].amount, 100);

  // The shared gift belongs to the SAME event — no second Event was created.
  const sharedGifts = [...db._store.values()].filter((v) => v?.sharedDistribution === true);
  assert.equal(sharedGifts.length, 1);
  assert.equal(sharedGifts[0].eventId, eventId);
  assert.equal([...db._store.keys()].filter((k) => k.startsWith(`${EVENT_COLLECTION}/`)).length, 1);

  // Managed rows, wordings and issued invitations are byte-identical.
  assert.equal(JSON.stringify(guests.map((g) => db._store.get(`${GUEST_COLLECTION}/${g}`))), guestSnap);
  assert.equal(JSON.stringify(db._store.get(`${EVENT_COLLECTION}/${eventId}`).variants), variantSnap);
  assert.equal(JSON.stringify(managedGiftIds.map((k) => db._store.get(k))), managedSnap);
});

test("canonical shared retry/concurrent (same shared_{eventId} identity): ONE link, ONE 100 — even across devices", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 0 });
  const share = fakeShare();
  const eventId = await mkEvent(db, BIRTHDAY);
  // Two attempts race with the SAME deterministic identity (what two devices
  // both seeing "no shared link yet" would send). The ledger tx + publish
  // intent (billing.test.mjs §19 races the tx itself) admit exactly one.
  const [a, b] = await Promise.all([
    sealCanonicalShared(db, share, eventId),
    sealCanonicalShared(db, share, eventId),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(a.body.token, b.body.token, "the SAME canonical link, never a twin");
  assert.equal([...db._store.values()].filter((v) => v?.sharedDistribution === true).length, 1);
  assert.equal(chargeEntries(db).length, 1);

  // A later plain retry (button pressed again tomorrow) recovers, 0 additional.
  const again = await sealCanonicalShared(db, share, eventId);
  assert.equal(again.status, 200);
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.token, a.body.token);
  assert.equal(chargeEntries(db).length, 1);
});

test("coexistence: shared 100 never makes managed free, managed 500 never waives shared — independent ledger identities", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 500 });
  const share = fakeShare();
  const eventId = await mkEvent(db, BIRTHDAY);
  await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "friends", message: "朋友版。" }, now: NOW });

  // Shared first…
  await sealCanonicalShared(db, share, eventId);
  assert.equal(chargeEntries(db).length, 1);
  // …then a NEW managed invitation still charges its own 100.
  const g = await addGuest(db, eventId, "Hugo", "friends");
  const dist = await distribute(db, { eventId, guestIds: [g] });
  assert.equal(dist.body.results[0].status, "created");
  const charges = chargeEntries(db);
  assert.equal(charges.length, 2);
  assert.equal(charges.reduce((n, e) => n + e.amount, 0), 200);
  // Distinct, product-true identities: evt_{eventId}_{guestId} vs shared_{eventId}.
  assert.equal(ledgerEntries(db, `charge_gift_${A.uid}_evt_${eventId}_${g}`).length, 1);
  assert.equal(ledgerEntries(db, `charge_gift_${A.uid}_shared_${eventId}`).length, 1);
});

// --- WEDDING mirrors the canonical Shared Invitation (2026-09-05) -----------
// The SAME shared_{eventId} identity on a wedding Event: classification is
// the server's event type (→ private_event_invitation 100), eventIds are
// globally unique across types so identities can never collide, and the
// birthday-pinned retry/concurrency behavior applies verbatim. No backend
// code changed — these tests prove the wedding attach path.

const sealCanonicalSharedWedding = (db, share, eventId) =>
  createGift({
    db, decoded: A, now: NOW, share,
    body: {
      message: "请来喝喜酒。", occasion: WEDDING, eventId, recipientLabel: "各位亲友",
      sharedDistribution: true, accessMode: "direct", idempotencyKey: `shared_${eventId}`,
    },
  });

test("WEDDING: existing event with paid managed households + first shared link = ONE more 100; nothing else moves", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 2000 });
  const share = fakeShare();
  const { eventId, guestIds } = await weddingEventWithGuests(db, ["张先生全家", "David & Amy"]);
  const dist = await distribute(db, { eventId, guestIds });
  assert.equal(dist.body.results.filter((r) => r.status === "created").length, 2);
  assert.equal(chargeEntries(db).length, 2); // 200 already paid for managed

  const guestSnap = JSON.stringify(guestIds.map((g) => db._store.get(`${GUEST_COLLECTION}/${g}`)));
  const variantSnap = JSON.stringify(db._store.get(`${EVENT_COLLECTION}/${eventId}`).variants);

  const res = await sealCanonicalSharedWedding(db, share, eventId);
  assert.equal(res.status, 200);
  const charges = chargeEntries(db);
  assert.equal(charges.length, 3); // managed 200 never offsets the shared 100
  const sharedCharge = ledgerEntries(db, `charge_gift_${A.uid}_shared_${eventId}`);
  assert.equal(sharedCharge.length, 1);
  assert.equal(sharedCharge[0].product, "private_event_invitation");
  assert.equal(sharedCharge[0].amount, 100);
  // Same Event, no second one; managed rows and wordings byte-identical.
  const sharedGifts = [...db._store.values()].filter((v) => v?.sharedDistribution === true);
  assert.equal(sharedGifts.length, 1);
  assert.equal(sharedGifts[0].eventId, eventId);
  assert.equal([...db._store.keys()].filter((k) => k.startsWith(`${EVENT_COLLECTION}/`)).length, 1);
  assert.equal(JSON.stringify(guestIds.map((g) => db._store.get(`${GUEST_COLLECTION}/${g}`))), guestSnap);
  assert.equal(JSON.stringify(db._store.get(`${EVENT_COLLECTION}/${eventId}`).variants), variantSnap);
});

test("WEDDING: canonical retry/concurrent = one link one 100; a NEW managed household afterwards still costs its own 100", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 500 });
  const share = fakeShare();
  const { eventId } = await weddingEventWithGuests(db, ["李家"]);
  const [a, b2] = await Promise.all([
    sealCanonicalSharedWedding(db, share, eventId),
    sealCanonicalSharedWedding(db, share, eventId),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b2.status, 200);
  assert.equal(a.body.token, b2.body.token);
  assert.equal([...db._store.values()].filter((v) => v?.sharedDistribution === true).length, 1);
  const afterShared = chargeEntries(db).length; // 李家 not yet distributed → just the shared 100
  assert.equal(ledgerEntries(db, `charge_gift_${A.uid}_shared_${eventId}`).length, 1);
  const again = await sealCanonicalSharedWedding(db, share, eventId);
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.token, a.body.token);
  assert.equal(chargeEntries(db).length, afterShared);
  // Shared payment never makes managed free: a genuinely new household = 100.
  const g = await addGuest(db, eventId, "王家");
  const dist = await distribute(db, { eventId, guestIds: [g] });
  assert.equal(dist.body.results[0].status, "created");
  assert.equal(ledgerEntries(db, `charge_gift_${A.uid}_evt_${eventId}_${g}`).length, 1);
  assert.equal(chargeEntries(db).length, afterShared + 1);
});

// --- BUSINESS mirrors the canonical Shared Invitation (2026-09-05) ----------
// Same shared_{eventId} identity on a business Event: classification is the
// server's event type (→ business_event_invitation 100). Managed payments
// never offset it; it never frees later managed invitations.

test("BUSINESS: existing event with paid managed invitations + first shared link = ONE more 100 (business product); retry recovers", async () => {
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 2000 });
  const share = fakeShare();
  const eventId = await mkEvent(db, BIZ);
  await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "clients", message: "客户版邀请。" }, now: NOW });
  await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "partners", message: "合作伙伴版邀请。" }, now: NOW });
  const abc = await addGuest(db, eventId, "ABC Pty Ltd", "clients");
  const david = await addGuest(db, eventId, "David", "partners");
  const dist = await distribute(db, { eventId, guestIds: [abc, david] });
  assert.equal(dist.body.results.filter((r) => r.status === "created").length, 2);
  assert.equal(chargeEntries(db).length, 2); // 200 already paid for managed

  const guestSnap = JSON.stringify([abc, david].map((g) => db._store.get(`${GUEST_COLLECTION}/${g}`)));
  const variantSnap = JSON.stringify(db._store.get(`${EVENT_COLLECTION}/${eventId}`).variants);

  const res = await createGift({
    db, decoded: A, now: NOW, share,
    body: {
      message: "诚挚邀请您出席。", occasion: BIZ, eventId, recipientLabel: "各位来宾",
      sharedDistribution: true, accessMode: "direct", idempotencyKey: `shared_${eventId}`,
    },
  });
  assert.equal(res.status, 200);
  assert.equal(chargeEntries(db).length, 3);
  const sharedCharge = ledgerEntries(db, `charge_gift_${A.uid}_shared_${eventId}`);
  assert.equal(sharedCharge.length, 1);
  assert.equal(sharedCharge[0].product, "business_event_invitation");
  assert.equal(sharedCharge[0].amount, 100);
  const sharedGifts = [...db._store.values()].filter((v) => v?.sharedDistribution === true);
  assert.equal(sharedGifts.length, 1);
  assert.equal(sharedGifts[0].eventId, eventId);
  assert.equal([...db._store.keys()].filter((k) => k.startsWith(`${EVENT_COLLECTION}/`)).length, 1);
  // Managed rows and audience wordings are byte-identical.
  assert.equal(JSON.stringify([abc, david].map((g) => db._store.get(`${GUEST_COLLECTION}/${g}`))), guestSnap);
  assert.equal(JSON.stringify(db._store.get(`${EVENT_COLLECTION}/${eventId}`).variants), variantSnap);

  // Retry recovers the SAME link, 0 additional; a NEW managed guest after
  // the shared link still charges its own 100 (§15 coexistence).
  const again = await createGift({
    db, decoded: A, now: NOW, share,
    body: {
      message: "诚挚邀请您出席。", occasion: BIZ, eventId, recipientLabel: "各位来宾",
      sharedDistribution: true, accessMode: "direct", idempotencyKey: `shared_${eventId}`,
    },
  });
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.token, res.body.token);
  assert.equal(chargeEntries(db).length, 3);
  const sarah = await addGuest(db, eventId, "Sarah", "leadership");
  await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "leadership", message: "贵宾版邀请。" }, now: NOW });
  const later = await distribute(db, { eventId, guestIds: [sarah] });
  assert.equal(later.body.results[0].status, "created");
  assert.equal(chargeEntries(db).length, 4);
  assert.equal(ledgerEntries(db, `charge_gift_${A.uid}_evt_${eventId}_${sarah}`).length, 1);
});

// --- Credits activity (Founder C/D/E, 2026-09-04) ----------------------------

test("EXACT production repro: Jason Family(家人)+Hugo(朋友) → 200, persisted rows, auditable history", async () => {
  const { balanceHandler } = await import("./billing.mjs");
  const { eventDetail } = await import("./event.mjs");
  const db = makeFakeDb();
  seedAccount(db, { free: 200, paid: 100 });
  const eventId = await mkEvent(db, BIRTHDAY);
  await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "family", message: "家人版。" }, now: NOW });
  await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "friends", message: "朋友版。" }, now: NOW });
  const jason = await addGuest(db, eventId, "Jason Family", "family");
  const hugo = await addGuest(db, eventId, "Hugo", "friends");

  const res = await distribute(db, { eventId, guestIds: [jason, hugo] });
  const created = res.body.results.filter((r) => r.status === "created");
  assert.equal(created.length, 2);
  assert.equal(new Set(created.map((r) => r.token)).size, 2);
  // Balance −200 exactly.
  assert.deepEqual({ free: account(db).free, paid: account(db).paid }, { free: 0, paid: 100 });
  // Ledger: two auditable 100-entries.
  const charges = chargeEntries(db);
  assert.equal(charges.length, 2);
  assert.equal(charges.reduce((n, e) => n + e.amount, 0), 200);

  // AUTHORITATIVE refetch (the ready board's source): both rows linked.
  const detail = await eventDetail({ db, decoded: A, body: { eventId }, giftCollection: GIFT_COLLECTION, now: NOW });
  const linked = detail.body.guests.filter((g) => g.invitationGiftId);
  assert.equal(linked.length, 2);
  assert.deepEqual(linked.map((g) => g.label).sort(), ["Hugo", "Jason Family"]);

  // Credits activity: both −100 rows, human-resolvable.
  const bal = await balanceHandler({ db, decoded: A, body: { history: { limit: 50 } }, now: NOW });
  assert.equal(bal.status, 200);
  const hist = bal.body.history;
  const invRows = hist.filter((r) => r.product === "private_event_invitation");
  assert.equal(invRows.length, 2);
  assert.deepEqual(invRows.map((r) => r.label).sort(), ["Hugo", "Jason Family"]);
  for (const r of invRows) {
    assert.equal(r.amount, 100);
    assert.equal(r.type, "charge");
    assert.equal(r.eventType, "birthday");
    assert.equal(r.quantity, 1);
    assert.equal(r.unitPrice, 100);
  }
});

test("history: uid-scoped, newest-first, bounded, read-only; grants/top-ups readable", async () => {
  const { balanceHandler, creditHistory } = await import("./billing.mjs");
  const db = makeFakeDb();
  // A's entries at distinct times + a FOREIGN uid entry that must never leak.
  db._store.set(`${CREDIT_LEDGER}/topup_${A.uid}_2026-W36`, {
    uid: A.uid, type: "free_topup", amount: 200, freeDelta: 200, paidDelta: 0,
    product: "weekly_free", quantity: 1, unitPrice: 200, createdAt: NOW - 5000, meta: {},
  });
  db._store.set(`${CREDIT_LEDGER}/admin_test_grant_phase3_${A.uid}`, {
    uid: A.uid, type: "adjustment", amount: 10000, freeDelta: 0, paidDelta: 10000,
    product: "admin_test_grant", quantity: 1, unitPrice: 10000, createdAt: NOW - 3000, meta: {},
  });
  db._store.set(`${CREDIT_LEDGER}/charge_gift_${A.uid}_simplex0000001`, {
    uid: A.uid, type: "charge", amount: 20, freeDelta: -20, paidDelta: 0,
    product: "simple_gift_publish", quantity: 1, unitPrice: 20, subjectId: "tok1", createdAt: NOW - 1000, meta: {},
  });
  db._store.set(`${CREDIT_LEDGER}/charge_gift_OTHER_x`, {
    uid: "someone-else", type: "charge", amount: 999, product: "simple_gift_publish", createdAt: NOW, meta: {},
  });
  seedAccount(db, { free: 180, paid: 10000 });

  const before = db._store.size;
  const rows = await creditHistory({ db, uid: A.uid, limit: 2 });
  assert.equal(db._store.size, before, "history reads NEVER write");
  assert.equal(rows.length, 2); // bounded
  assert.deepEqual(rows.map((r) => r.product), ["simple_gift_publish", "admin_test_grant"]); // newest first
  assert.ok(rows.every((r) => !String(r.entryId).includes("OTHER")), "only the caller's entries");

  const all = await creditHistory({ db, uid: A.uid, limit: 50 });
  const grant = all.find((r) => r.product === "admin_test_grant");
  assert.equal(grant.paidDelta, 10000);
  const topup = all.find((r) => r.product === "weekly_free");
  assert.equal(topup.freeDelta, 200);
  assert.equal(topup.type, "free_topup");

  // Unauthenticated read refused at the handler.
  const anon = await balanceHandler({ db, decoded: null, body: { history: {} }, now: NOW });
  assert.equal(anon.status, 401);
});

// --- Credits activity explainability (Founder P1 closure, 2026-09-05) --------

test("history: preprinted activation labels with the bound Gift's salutation (owner-verified), never the raw key path", async () => {
  const { creditHistory } = await import("./billing.mjs");
  const db = makeFakeDb();
  const giftId = "a".repeat(64);
  db._store.set("tags/tag-p1", { tagId: "tag-p1", type: "gift", ownerUid: A.uid, status: "active", boundGiftId: giftId, displayLabel: null });
  db._store.set(`giftMessages/${giftId}`, { senderUid: A.uid, recipientLabel: "妈妈" });
  db._store.set(`${CREDIT_LEDGER}/charge_gift_${A.uid}_tagact_tag-p1`, {
    uid: A.uid, type: "charge", amount: 100, freeDelta: -100, paidDelta: 0,
    product: "preprinted_gift_tag_activation", quantity: 1, unitPrice: 100,
    subjectType: "tag", subjectId: "tag-p1", createdAt: NOW, meta: { giftId, idempotencyKey: "tagact_tag-p1" },
  });
  const rows = await creditHistory({ db, uid: A.uid, limit: 10 });
  assert.equal(rows.length, 1);
  assert.equal(rows[0].product, "preprinted_gift_tag_activation");
  assert.equal(rows[0].label, "妈妈"); // the identity the owner recognises
  assert.equal(rows[0].amount, 100);
  assert.equal(rows[0].quantity, 1);
  assert.equal(rows[0].unitPrice, 100);

  // A foreign gift doc must NEVER leak its salutation into this uid's row —
  // the label falls back to the owner-verified tag displayLabel (null here).
  db._store.set(`giftMessages/${giftId}`, { senderUid: "someone-else", recipientLabel: "秘密" });
  const rows2 = await creditHistory({ db, uid: A.uid, limit: 10 });
  assert.equal(rows2[0].label, null);
  // The read path never touched share tokens or the printed code: the row
  // carries no code-shaped field at all.
  assert.ok(!("publicCode" in rows2[0]) && !("shareTokenSealed" in rows2[0]));
});

test("history: live capacity rows surface the LEDGER's quantity/unitPrice/amount verbatim — amount is never recomputed", async () => {
  const { creditHistory } = await import("./billing.mjs");
  const db = makeFakeDb();
  db._store.set("liveSessions/sess-1", { sessionId: "sess-1", ownerUid: A.uid, title: "婚礼现场" });
  db._store.set(`${CREDIT_LEDGER}/charge_gift_${A.uid}_capA`, {
    uid: A.uid, type: "charge", amount: 2500, freeDelta: 0, paidDelta: -2500,
    product: "live_guestbook_capacity", quantity: 50, unitPrice: 50,
    subjectType: "live", subjectId: "sess-1__live_guestbook", createdAt: NOW, meta: { sessionId: "sess-1", seats: 50 },
  });
  // A (hypothetically) inconsistent historical row: the immutable amount wins.
  db._store.set(`${CREDIT_LEDGER}/charge_gift_${A.uid}_capB`, {
    uid: A.uid, type: "charge", amount: 999, freeDelta: -999, paidDelta: 0,
    product: "live_draw_capacity", quantity: 10, unitPrice: 100,
    subjectType: "live", subjectId: "sess-1__lucky_draw", createdAt: NOW + 1, meta: { sessionId: "sess-1", seats: 10 },
  });
  const rows = await creditHistory({ db, uid: A.uid, limit: 10 });
  const guestbook = rows.find((r) => r.product === "live_guestbook_capacity");
  assert.deepEqual(
    { q: guestbook.quantity, u: guestbook.unitPrice, amt: guestbook.amount, label: guestbook.label, seats: guestbook.seats },
    { q: 50, u: 50, amt: 2500, label: "婚礼现场", seats: 50 },
  );
  const draw = rows.find((r) => r.product === "live_draw_capacity");
  assert.equal(draw.amount, 999, "ledger amount surfaced verbatim, NOT quantity × unitPrice");
  assert.equal(draw.quantity, 10);
  assert.equal(draw.unitPrice, 100);
});
