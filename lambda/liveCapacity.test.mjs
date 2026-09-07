/**
 * Phase 3 — Live Interaction participant-capacity billing, through the REAL
 * session/draw/guestbook/quiz handlers plus the REAL Credits core.
 *
 * LOCKED semantics under test:
 *   · organizer BUYS capacity (draw 100 · guess/quiz 100 · guestbook 50 per
 *     seat) BEFORE use; purchases are additive and idempotent;
 *   · one HUMAN (participantIdHash) consumes at most ONE seat per capability
 *     — messages/answers/retries are free within the seat;
 *   · capacity_full is a stable, calm refusal with ZERO writes — guests never
 *     see Credits;
 *   · legacy sessions (created before Phase 3, no billingRequired stamp) stay
 *     exactly as free as they shipped;
 *   · guestbook P0 human-approval moderation is untouched by billing.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createLiveSession,
  handleSenderLive,
} from "./liveSession.mjs";
import {
  claimLuckyCode,
  submitBlessing,
  quizGuestAnswer,
  quizGuestState,
  guestbookDisplay,
  GUESTBOOK_COLLECTION,
  ENTRANT_COLLECTION,
  LIVE_SESSION_COLLECTION,
} from "./onsite.mjs";
import {
  LIVE_CAPACITY_COLLECTION,
  LIVE_SEAT_COLLECTION,
  capacityDocId,
} from "./liveCapacity.mjs";
import { CREDIT_ACCOUNTS, CREDIT_LEDGER, WEEKLY_FREE_CREDITS } from "./billing.mjs";

const OWNER = { uid: "host-1" };
const OTHER = { uid: "host-2" };
const NOW = Date.UTC(2026, 8, 4, 12, 0, 0);
const GIFT_COLLECTION = "giftMessages";

const fakeShare = () => ({ seal: async (t) => `sealed:${t}`, open: async (x) => String(x).replace(/^sealed:/, "") });

/** Fake db with REAL create semantics (ALREADY_EXISTS) inside transactions. */
function makeFakeDb() {
  const store = new Map();
  const doc = (path) => ({
    _key: path,
    get: async () => ({ exists: store.has(path), data: () => store.get(path), id: path.split("/").pop() }),
    set: async (v) => { store.set(path, { ...v }); },
    update: async (v) => { store.set(path, { ...store.get(path), ...v }); },
    create: async (v) => {
      if (store.has(path)) { const e = new Error("ALREADY_EXISTS"); e.code = 6; throw e; }
      store.set(path, { ...v });
    },
    delete: async () => { store.delete(path); },
  });
  const collection = (name) => ({
    doc: (id) => doc(`${name}/${id}`),
    where: (field, _op, value) => ({
      get: async () => ({ docs: [...store.entries()].filter(([k, v]) => k.startsWith(`${name}/`) && v[field] === value).map(([k, v]) => ({ id: k.split("/").pop(), data: () => v })) }),
    }),
    get: async () => ({ docs: [...store.entries()].filter(([k]) => k.startsWith(`${name}/`)).map(([k, v]) => ({ id: k.split("/").pop(), data: () => v })) }),
  });
  return {
    _store: store,
    collection,
    runTransaction: async (fn) =>
      fn({
        get: async (ref) => ref.get(),
        set: (ref, v) => void store.set(ref._key, { ...v }),
        update: (ref, v) => void store.set(ref._key, { ...store.get(ref._key), ...v }),
        create: (ref, v) => {
          if (store.has(ref._key)) { const e = new Error("ALREADY_EXISTS"); e.code = 6; throw e; }
          store.set(ref._key, { ...v });
        },
      }),
  };
}

const seedAccount = (db, uid, { free = WEEKLY_FREE_CREDITS, paid = 0 } = {}) =>
  db._store.set(`${CREDIT_ACCOUNTS}/${uid}`, {
    schemaVersion: 1, free, paid, freeTopUpAt: NOW, createdAt: NOW, updatedAt: NOW, version: 1,
  });
const chargeEntries = (db, uid = OWNER.uid) =>
  [...db._store.entries()].filter(([k]) => k.startsWith(`${CREDIT_LEDGER}/charge_gift_${uid}_`)).map(([, v]) => v);
const account = (db, uid = OWNER.uid) => db._store.get(`${CREDIT_ACCOUNTS}/${uid}`);
const seatDocs = (db) => [...db._store.keys()].filter((k) => k.startsWith(`${LIVE_SEAT_COLLECTION}/`));

const createSession = (db, { capability = "lucky_draw", ack = true, decoded = OWNER } = {}) =>
  createLiveSession({
    db, decoded, body: { title: "Party", capability, ...(ack ? { billingAck: true } : {}) },
    share: fakeShare(), giftCollection: GIFT_COLLECTION, publicBaseUrl: "https://x", now: NOW,
  });
const door = (db, body, decoded = OWNER, now = NOW) => handleSenderLive({ db, decoded, body, share: fakeShare(), giftCollection: GIFT_COLLECTION, publicBaseUrl: "https://x", now });
const buy = (db, sessionId, capability, seats, key, decoded = OWNER) =>
  door(db, { action: "capacity_purchase", sessionId, capability, seats, idempotencyKey: key }, decoded);
const drawWindow = { startAt: NOW - 1000, cutoffAt: NOW + 3_600_000 };
const configureAndOpenDraw = async (db, sessionId) => {
  const cfg = await door(db, { action: "draw_configure", sessionId, enabled: true, ...drawWindow, prizes: { third: "c", second: "b", first: "a" } });
  assert.equal(cfg.status, 200);
  return door(db, { action: "draw_open", sessionId });
};
const pt = (n) => `participant${n}`.padEnd(20, "x");
const claim = (db, token, n) => claimLuckyCode({ db, body: { token, participantToken: pt(n) }, giftCollection: GIFT_COLLECTION, now: NOW });
const bless = (db, token, n, text, idem) =>
  submitBlessing({ db, body: { token, participantToken: pt(n), text, idempotencyKey: idem, displayName: `客${n}` }, giftCollection: GIFT_COLLECTION, now: NOW });

// --- Purchases ---------------------------------------------------------------

test("purchase: draw 20 seats → 2000; guestbook 20 → 1000; quiz/guess 20 → 2000", async () => {
  for (const [capability, seats, expect] of [["lucky_draw", 20, 2000], ["live_guestbook", 20, 1000], ["live_quiz", 20, 2000]]) {
    const db = makeFakeDb();
    seedAccount(db, OWNER.uid, { free: 200, paid: 5000 });
    const sess = await createSession(db, { capability });
    const res = await buy(db, sess.body.sessionId, capability, seats, `buy${capability}00001`.slice(0, 20));
    assert.equal(res.status, 200);
    assert.equal(res.body.purchased, seats);
    assert.equal(res.body.used, 0);
    const entries = chargeEntries(db);
    assert.equal(entries.length, 1);
    assert.equal(entries[0].amount, expect);
    assert.equal(entries[0].quantity, seats);
  }
});

test("purchase is IDEMPOTENT (same key) and ADDITIVE (new key charges only added seats)", async () => {
  const db = makeFakeDb();
  seedAccount(db, OWNER.uid, { free: 200, paid: 5000 });
  const sess = await createSession(db);
  const sid = sess.body.sessionId;

  const first = await buy(db, sid, "lucky_draw", 20, "drawbuy000000001");
  assert.equal(first.body.purchased, 20);
  const retry = await buy(db, sid, "lucky_draw", 20, "drawbuy000000001");
  assert.equal(retry.body.duplicate, true);
  assert.equal(retry.body.purchased, 20); // NOT 40 — the guard never re-ran
  assert.equal(chargeEntries(db).length, 1);

  const add = await buy(db, sid, "lucky_draw", 10, "drawbuy000000002");
  assert.equal(add.body.purchased, 30);
  const entries = chargeEntries(db);
  assert.equal(entries.length, 2);
  assert.equal(entries[1].amount, 1000); // only the ADDED 10 × 100
  assert.deepEqual({ free: account(db).free, paid: account(db).paid }, { free: 0, paid: 2200 });
});

test("purchase guards: non-owner 403, wrong capability 400, bad seats 400, insufficient 402", async () => {
  const db = makeFakeDb();
  seedAccount(db, OWNER.uid, { free: 100, paid: 0 });
  seedAccount(db, OTHER.uid, { free: 200, paid: 100000 });
  const sess = await createSession(db, { capability: "live_guestbook" });
  const sid = sess.body.sessionId;
  assert.equal((await buy(db, sid, "live_guestbook", 5, "gbother000000001", OTHER)).status, 403);
  assert.equal((await buy(db, sid, "lucky_draw", 5, "gbwrongcap000001")).status, 400); // session has no draw capability
  assert.equal((await buy(db, sid, "live_guestbook", 0, "gbzero0000000001")).status, 400);
  assert.equal((await buy(db, sid, "live_guestbook", 1001, "gbtoomany0000001")).status, 400);
  const poor = await buy(db, sid, "live_guestbook", 5, "gbpoor0000000001"); // 250 > 100
  assert.equal(poor.status, 402);
  assert.equal(poor.body.error, "insufficient_credits");
  assert.equal(chargeEntries(db).length, 0);
  assert.ok(!db._store.has(`${LIVE_CAPACITY_COLLECTION}/${capacityDocId(sid, "live_guestbook")}`));
});

// --- Draw seats --------------------------------------------------------------

test("draw: capacity_required blocks open at 0 seats; purchase unblocks; N+1th claimant gets capacity_full", async () => {
  const db = makeFakeDb();
  seedAccount(db, OWNER.uid, { free: 200, paid: 0 });
  const sess = await createSession(db);
  const sid = sess.body.sessionId;
  const token = sess.body.token;

  const cfg = await door(db, { action: "draw_configure", sessionId: sid, enabled: true, ...drawWindow, prizes: { third: "c", second: "b", first: "a" } });
  assert.equal(cfg.status, 200);
  const blocked = await door(db, { action: "draw_open", sessionId: sid });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, "capacity_required");

  assert.equal((await buy(db, sid, "lucky_draw", 2, "drawseats0000001")).status, 200);
  assert.equal((await door(db, { action: "draw_open", sessionId: sid })).status, 200);

  assert.equal((await claim(db, token, 1)).status, 200);
  assert.equal((await claim(db, token, 2)).status, 200);
  const third = await claim(db, token, 3);
  assert.equal(third.status, 409);
  assert.equal(third.body.error, "capacity_full"); // stable, calm, no Credits talk
  // No entrant row, no seat row for the refused participant.
  assert.equal([...db._store.keys()].filter((k) => k.startsWith(`${ENTRANT_COLLECTION}/`)).length, 2);
  assert.equal(seatDocs(db).length, 2);
});

test("draw: SAME participant re-claim consumes ONE seat total (idempotent identity)", async () => {
  const db = makeFakeDb();
  seedAccount(db, OWNER.uid, { free: 200, paid: 0 });
  const sess = await createSession(db);
  const sid = sess.body.sessionId;
  await buy(db, sid, "lucky_draw", 1, "drawone000000001");
  await configureAndOpenDraw(db, sid);
  const a = await claim(db, sess.body.token, 7);
  const b = await claim(db, sess.body.token, 7);
  assert.equal(b.body.alreadyClaimed, true);
  assert.equal(b.body.luckyCode, a.body.luckyCode);
  const cap = db._store.get(`${LIVE_CAPACITY_COLLECTION}/${capacityDocId(sid, "lucky_draw")}`);
  assert.equal(cap.used, 1);
});

test("legacy session (no billingRequired) claims free forever — billing is never retroactive", async () => {
  const db = makeFakeDb();
  const sess = await createSession(db, { ack: false }); // legacy ack-less create
  const sid = sess.body.sessionId;
  assert.notEqual(db._store.get(`${LIVE_SESSION_COLLECTION}/${sid}`).billingRequired, true);
  await configureAndOpenDraw(db, sid); // opens WITHOUT capacity_required
  for (let i = 1; i <= 5; i += 1) assert.equal((await claim(db, sess.body.token, i)).status, 200);
  assert.equal(seatDocs(db).length, 0);
  assert.equal(chargeEntries(db).length, 0);
});

test("BILLING_REQUIRE_KEY=on refuses ack-less session creation (controlled window close)", async () => {
  const db = makeFakeDb();
  process.env.BILLING_REQUIRE_KEY = "on";
  try {
    const res = await createSession(db, { ack: false });
    assert.equal(res.status, 400);
    assert.equal(res.body.error, "billing_client_required");
  } finally {
    delete process.env.BILLING_REQUIRE_KEY;
  }
});

// --- Guestbook seats ---------------------------------------------------------

test("guestbook: one participant, three messages → ONE seat; messages cost 0; moderation intact", async () => {
  const db = makeFakeDb();
  seedAccount(db, OWNER.uid, { free: 200, paid: 0 });
  const sess = await createSession(db, { capability: "live_guestbook" });
  const sid = sess.body.sessionId;
  await buy(db, sid, "live_guestbook", 2, "gbseats000000001");
  const balanceAfterPurchase = { free: account(db).free, paid: account(db).paid };

  for (const [i, text] of [["m1", "新婚快乐！"], ["m2", "百年好合！"], ["m3", "早生贵子！"]]) {
    const r = await bless(db, sess.body.token, 9, text, `gbmsg000000000${i}`);
    assert.equal(r.status, 200, text);
  }
  const cap = db._store.get(`${LIVE_CAPACITY_COLLECTION}/${capacityDocId(sid, "live_guestbook")}`);
  assert.equal(cap.used, 1); // one HUMAN, one seat — never one per message
  // Messages themselves changed no balance at all.
  assert.deepEqual({ free: account(db).free, paid: account(db).paid }, balanceAfterPurchase);
  // P0 moderation unchanged: nothing reaches the display feed unapproved.
  const msgs = [...db._store.entries()].filter(([k]) => k.startsWith(`${GUESTBOOK_COLLECTION}/`)).map(([, v]) => v);
  assert.equal(msgs.length, 3);
  assert.ok(msgs.every((m) => m.approvedForDisplay === false));
  const feed = await guestbookDisplay({ db, decoded: OWNER, body: { eventId: sid }, now: NOW });
  assert.equal((feed.body.messages ?? []).length, 0);
});

test("guestbook: second participant beyond capacity → capacity_full, message NOT stored", async () => {
  const db = makeFakeDb();
  seedAccount(db, OWNER.uid, { free: 200, paid: 0 });
  const sess = await createSession(db, { capability: "live_guestbook" });
  await buy(db, sess.body.sessionId, "live_guestbook", 1, "gbtight000000001");
  assert.equal((await bless(db, sess.body.token, 1, "第一位", "gbfirst000000001")).status, 200);
  const second = await bless(db, sess.body.token, 2, "第二位", "gbsecond00000001");
  assert.equal(second.status, 409);
  assert.equal(second.body.error, "capacity_full");
  const msgs = [...db._store.keys()].filter((k) => k.startsWith(`${GUESTBOOK_COLLECTION}/`));
  assert.equal(msgs.length, 1);
});

// --- Quiz (猜一猜) seats ------------------------------------------------------

test("quiz: first answer takes the seat; later questions ride it; over-capacity refused", async () => {
  const db = makeFakeDb();
  seedAccount(db, OWNER.uid, { free: 200, paid: 0 });
  const sess = await createSession(db, { capability: "live_quiz" });
  const sid = sess.body.sessionId;
  const token = sess.body.token;
  await buy(db, sid, "live_quiz", 1, "quizseat00000001");
  assert.equal((await door(db, { action: "quiz_configure", sessionId: sid, locale: "zh", questionCount: 2, answerDurationSeconds: 60 })).status, 200);
  assert.equal((await door(db, { action: "quiz_control", sessionId: sid, op: "open" }, OWNER, NOW)).status, 200);

  const state = await quizGuestState({ db, giftCollection: GIFT_COLLECTION, body: { token, participantToken: pt(1) }, now: NOW + 1000 });
  const q1 = state.body.question.id;
  const a1 = await quizGuestAnswer({ db, giftCollection: GIFT_COLLECTION, body: { token, participantToken: pt(1), questionId: q1, answer: "答案", nickname: "小明" }, now: NOW + 2000 });
  assert.equal(a1.status, 200);
  const capAfter1 = db._store.get(`${LIVE_CAPACITY_COLLECTION}/${capacityDocId(sid, "live_quiz")}`);
  assert.equal(capAfter1.used, 1);

  // Second participant: no seat left → calm refusal, answer not stored.
  const a2 = await quizGuestAnswer({ db, giftCollection: GIFT_COLLECTION, body: { token, participantToken: pt(2), questionId: q1, answer: "别的", nickname: "小红" }, now: NOW + 3000 });
  assert.equal(a2.status, 409);
  assert.equal(a2.body.error, "capacity_full");

  // Same participant, next question: SAME seat, no extra consumption.
  await door(db, { action: "quiz_control", sessionId: sid, op: "lock" }, OWNER, NOW + 4000);
  await door(db, { action: "quiz_control", sessionId: sid, op: "reveal" }, OWNER, NOW + 5000);
  await door(db, { action: "quiz_control", sessionId: sid, op: "scores" }, OWNER, NOW + 6000);
  assert.equal((await door(db, { action: "quiz_control", sessionId: sid, op: "next" }, OWNER, NOW + 7000)).status, 200);
  assert.equal((await door(db, { action: "quiz_control", sessionId: sid, op: "open" }, OWNER, NOW + 8000)).status, 200);
  const s2 = await quizGuestState({ db, giftCollection: GIFT_COLLECTION, body: { token, participantToken: pt(1) }, now: NOW + 9000 });
  const q2 = s2.body.question.id;
  const a3 = await quizGuestAnswer({ db, giftCollection: GIFT_COLLECTION, body: { token, participantToken: pt(1), questionId: q2, answer: "again", nickname: "小明" }, now: NOW + 10000 });
  assert.equal(a3.status, 200);
  const capAfter3 = db._store.get(`${LIVE_CAPACITY_COLLECTION}/${capacityDocId(sid, "live_quiz")}`);
  assert.equal(capAfter3.used, 1);
});

test("quiz: capacity_required blocks the first question open at 0 seats", async () => {
  const db = makeFakeDb();
  seedAccount(db, OWNER.uid, { free: 200, paid: 0 });
  const sess = await createSession(db, { capability: "live_quiz" });
  const sid = sess.body.sessionId;
  assert.equal((await door(db, { action: "quiz_configure", sessionId: sid, locale: "zh", questionCount: 2, answerDurationSeconds: 60 })).status, 200);
  const blocked = await door(db, { action: "quiz_control", sessionId: sid, op: "open" });
  assert.equal(blocked.status, 409);
  assert.equal(blocked.body.error, "capacity_required");
});

// --- Capacity state (host console) -------------------------------------------

test("capacity_state: owner-only pool overview across capabilities", async () => {
  const db = makeFakeDb();
  seedAccount(db, OWNER.uid, { free: 200, paid: 5000 });
  const sess = await createSession(db, { capability: "live_guestbook" });
  const sid = sess.body.sessionId;
  await buy(db, sid, "live_guestbook", 4, "gbstate000000001");
  await bless(db, sess.body.token, 3, "祝福", "gbstatemsg000001");
  const state = await door(db, { action: "capacity_state", sessionId: sid });
  assert.equal(state.status, 200);
  assert.equal(state.body.billingRequired, true);
  assert.deepEqual(state.body.capabilities.live_guestbook, { purchased: 4, used: 1 });
  assert.equal((await door(db, { action: "capacity_state", sessionId: sid }, OTHER)).status, 403);
});

// --- FINAL PRODUCT MODEL (founder-locked 2026-09-05) -------------------------
// Presets & bounds, expansion after full, waiting-participant admission,
// concurrent host purchase, and the NO-REFUND commercial rule.

test("presets price math: 10/50/100/200 seats at every capability's locked unit price", async () => {
  for (const [capability, unit] of [["lucky_draw", 100], ["live_quiz", 100], ["live_guestbook", 50]]) {
    for (const seats of [10, 50, 100, 200]) {
      const db = makeFakeDb();
      seedAccount(db, OWNER.uid, { free: 200, paid: 50000 });
      const sess = await createSession(db, { capability });
      const res = await buy(db, sess.body.sessionId, capability, seats, `p${capability.slice(5, 9)}${seats}0000001`.slice(0, 16));
      assert.equal(res.status, 200, `${capability} ${seats}`);
      const entries = chargeEntries(db);
      assert.equal(entries[0].amount, seats * unit);
      assert.equal(entries[0].unitPrice, unit);
    }
  }
});

test("custom bounds: 1 and 1000 accepted; 0, 1001 and non-integers rejected with zero writes", async () => {
  const db = makeFakeDb();
  seedAccount(db, OWNER.uid, { free: 200, paid: 200000 });
  const sess = await createSession(db);
  const sid = sess.body.sessionId;
  assert.equal((await buy(db, sid, "lucky_draw", 1, "custmin000000001")).status, 200);
  assert.equal((await buy(db, sid, "lucky_draw", 1000, "custmax000000001")).status, 200);
  for (const [bad, key] of [[0, "custbad000000001"], [1001, "custbad000000002"], [2.5, "custbad000000003"], ["7", "custbad000000004"]]) {
    const res = await buy(db, sid, "lucky_draw", bad, key);
    assert.equal(res.status, 400, String(bad));
  }
  assert.equal(chargeEntries(db).length, 2); // only the two valid purchases
});

test("concurrent host purchase (two devices, SAME intended purchase): one charge, one increment", async () => {
  const db = makeFakeDb();
  seedAccount(db, OWNER.uid, { free: 200, paid: 5000 });
  const sess = await createSession(db);
  const sid = sess.body.sessionId;
  const [a, b] = await Promise.all([
    buy(db, sid, "lucky_draw", 10, "race000000000001"),
    buy(db, sid, "lucky_draw", 10, "race000000000001"),
  ]);
  assert.equal(a.status, 200);
  assert.equal(b.status, 200);
  assert.equal(chargeEntries(db).length, 1);
  const cap = db._store.get(`${LIVE_CAPACITY_COLLECTION}/${capacityDocId(sid, "lucky_draw")}`);
  assert.equal(cap.purchased, 10); // never 20 from a double-tap
});

test("EXPANSION: 10/10 full → +1 admits the waiting participant; +10 and custom use the same unit price", async () => {
  const db = makeFakeDb();
  seedAccount(db, OWNER.uid, { free: 200, paid: 10000 });
  const sess = await createSession(db);
  const sid = sess.body.sessionId;
  const token = sess.body.token;
  await buy(db, sid, "lucky_draw", 10, "expbase000000001");
  await configureAndOpenDraw(db, sid);
  for (let n = 1; n <= 10; n += 1) assert.equal((await claim(db, token, n)).status, 200, `p${n}`);
  // Participant #11 waits — capacity_full, no draw number, owner balance untouched.
  const before = { free: account(db).free, paid: account(db).paid };
  const p11 = await claim(db, token, 11);
  assert.equal(p11.status, 409);
  assert.equal(p11.body.error, "capacity_full");
  assert.deepEqual({ free: account(db).free, paid: account(db).paid }, before);
  // Owner approves +1 (same unit price, no surcharge) → the SAME participant
  // retries on the SAME QR and atomically claims seat 11.
  const plus1 = await buy(db, sid, "lucky_draw", 1, "expplus100000001");
  assert.equal(plus1.body.purchased, 11);
  assert.equal(chargeEntries(db).at(-1).amount, 100);
  const retry = await claim(db, token, 11);
  assert.equal(retry.status, 200);
  // +10 and a custom 7 keep the unit price too.
  assert.equal((await buy(db, sid, "lucky_draw", 10, "expplus1000000001".slice(0, 16))).body.purchased, 21);
  assert.equal(chargeEntries(db).at(-1).amount, 1000);
  assert.equal((await buy(db, sid, "lucky_draw", 7, "expcustom0000001")).body.purchased, 28);
  assert.equal(chargeEntries(db).at(-1).amount, 700);
});

test("EXPANSION with insufficient Credits: capacity unchanged, waiting participant still out, state preserved", async () => {
  const db = makeFakeDb();
  seedAccount(db, OWNER.uid, { free: 0, paid: 1000 });
  const sess = await createSession(db);
  const sid = sess.body.sessionId;
  const token = sess.body.token;
  await buy(db, sid, "lucky_draw", 10, "poorbase00000001");
  await configureAndOpenDraw(db, sid);
  for (let n = 1; n <= 10; n += 1) await claim(db, token, n);
  const grow = await buy(db, sid, "lucky_draw", 10, "poorgrow00000001");
  assert.equal(grow.status, 402);
  assert.equal(grow.body.error, "insufficient_credits");
  const cap = db._store.get(`${LIVE_CAPACITY_COLLECTION}/${capacityDocId(sid, "lucky_draw")}`);
  assert.equal(cap.purchased, 10);
  assert.equal(cap.used, 10);
  assert.equal((await claim(db, token, 11)).body.error, "capacity_full");
  assert.equal(chargeEntries(db).length, 1); // only the original purchase
});

test("NO REFUND: 50 bought, 37 used, session ends — no reversal entries, no balance restoration", async () => {
  const db = makeFakeDb();
  seedAccount(db, OWNER.uid, { free: 200, paid: 5000 });
  const sess = await createSession(db);
  const sid = sess.body.sessionId;
  const token = sess.body.token;
  await buy(db, sid, "lucky_draw", 50, "norefund00000001");
  const afterPurchase = { free: account(db).free, paid: account(db).paid };
  assert.deepEqual(afterPurchase, { free: 0, paid: 200 }); // 5000 paid for capacity
  await configureAndOpenDraw(db, sid);
  for (let n = 1; n <= 37; n += 1) assert.equal((await claim(db, token, n)).status, 200);
  // The event ends with 13 unused seats.
  db._store.set(`${LIVE_SESSION_COLLECTION}/${sid}`, { ...db._store.get(`${LIVE_SESSION_COLLECTION}/${sid}`), status: "ended" });
  // The organizer bought CAPACITY, not attendance: nothing refunds, nothing
  // settles, nothing restores — the ledger holds exactly the one charge and
  // the balance is untouched by usage or by the session ending.
  const ledger = [...db._store.entries()].filter(([k]) => k.startsWith(`${CREDIT_LEDGER}/`)).map(([, v]) => v);
  assert.equal(ledger.filter((e) => e.type === "charge").length, 1);
  assert.equal(ledger.filter((e) => e.type !== "charge").length, 0); // no reversal/credit entries of any kind
  assert.deepEqual({ free: account(db).free, paid: account(db).paid }, afterPurchase);
  const cap = db._store.get(`${LIVE_CAPACITY_COLLECTION}/${capacityDocId(sid, "lucky_draw")}`);
  assert.equal(cap.purchased, 50);
  assert.equal(cap.used, 37);
});
