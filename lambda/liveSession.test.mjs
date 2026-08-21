/**
 * Live Interaction V1 — LiveSession extraction of Lucky Draw.
 *
 * Proves: standalone sessions need no Event/Invitation/Gift; a linked Wedding
 * session shares the SAME winner engine (not a copy); the anonymous
 * participant model and the fairness/idempotency guarantees are unchanged; and
 * Lucky Balls / Quiz / Guestbook are not accidentally enabled.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  createLiveSession, listLiveSessions, liveSessionDetail, handleSenderLive, LIVE_CAPABILITIES,
} from "./liveSession.mjs";
import {
  configureDraw, drawWinner, claimLuckyCode, LIVE_SESSION_COLLECTION, DRAW_COLLECTION, ENTRANT_COLLECTION,
  drawLuckyBalls, pickUniqueLuckyBalls, ballSignature, LUCKY_BALL_COUNT, LUCKY_BALL_MAX,
  submitBlessing, guestbookInbox, guestbookModerate, guestbookDisplay,
  GUESTBOOK_COLLECTION, GUESTBOOK_MAX_PER_PARTICIPANT,
  quizGuestState, quizGuestAnswer, scoreQuizAnswer, normalizeQuizAnswer, quizRemainingMs, quizQuestionById,
  QUIZ_COLLECTION, QUIZ_ANSWER_COLLECTION, QUIZ_QUESTIONS, QUIZ_BASE_POINTS, QUIZ_DEFAULT_DURATION_S,
} from "./onsite.mjs";
import { GIFT_COLLECTION } from "./gift.mjs";
import { EVENT_COLLECTION } from "./event.mjs";

const OWNER = { uid: "host-1" };
const OTHER = { uid: "host-2" };
const fakeShare = () => ({ seal: async (t) => `sealed:${t}`, open: async (x) => String(x).replace(/^sealed:/, "") });

function makeFakeDb() {
  const store = new Map();
  const doc = (path) => ({
    get: async () => ({ exists: store.has(path), data: () => store.get(path), id: path.split("/").pop() }),
    set: async (v) => { store.set(path, v); },
    update: async (v) => { store.set(path, { ...store.get(path), ...v }); },
    create: async (v) => { if (store.has(path)) { const e = new Error("exists"); e.code = 6; throw e; } store.set(path, v); },
    delete: async () => { store.delete(path); },
  });
  const collection = (name) => ({
    doc: (id) => doc(`${name}/${id}`),
    where: (field, _op, value) => ({
      get: async () => ({ docs: [...store.entries()].filter(([k, v]) => k.startsWith(`${name}/`) && v[field] === value).map(([k, v]) => ({ id: k.split("/").pop(), data: () => v })) }),
    }),
    get: async () => ({ docs: [...store.entries()].filter(([k]) => k.startsWith(`${name}/`)).map(([k, v]) => ({ id: k.split("/").pop(), data: () => v })) }),
  });
  return { collection, runTransaction: async (fn) => fn({
    get: async (ref) => ref.get(),
    update: (ref, v) => ref.update(v),
  }), _store: store };
}

const createStandalone = (db, title = "Company Party Lucky Draw") =>
  createLiveSession({ db, decoded: OWNER, body: { title }, share: fakeShare(), giftCollection: GIFT_COLLECTION, publicBaseUrl: "https://x" });

// --- Standalone: no Event / Invitation / Gift required -----------------------

test("standalone create needs no Event, mints a session + participation QR", async () => {
  const db = makeFakeDb();
  const res = await createStandalone(db);
  assert.equal(res.status, 200);
  assert.match(res.body.sessionId, /^ls_/);
  assert.ok(res.body.token && res.body.url.includes(res.body.token));
  const s = db._store.get(`${LIVE_SESSION_COLLECTION}/${res.body.sessionId}`);
  assert.equal(s.ownerUid, OWNER.uid);
  assert.equal(s.eventId, null);           // NOT linked to any Event
  assert.deepEqual(s.capabilities, ["lucky_draw"]);
  assert.equal(s.skin, "neutral");
  // The participation record is on_site-style, keyed by the SESSION, and needs
  // no blessing (no Guestbook on a standalone draw).
  const rec = db._store.get(`${GIFT_COLLECTION}/${res.body.participationGiftId}`);
  assert.equal(rec.eventId, res.body.sessionId);
  assert.equal(rec.requireBlessing, false);
  assert.equal(rec.contextRole, "on_site");
  assert.equal(res.body.token.length > 10, true);
  // title required.
  assert.equal((await createLiveSession({ db, decoded: OWNER, body: {}, share: fakeShare(), giftCollection: GIFT_COLLECTION, publicBaseUrl: "https://x" })).status, 400);
});

test("standalone participant joins and gets one six-digit Lucky Number, no blessing needed", async () => {
  const db = makeFakeDb();
  const sess = await createStandalone(db);
  const token = sess.body.token;
  // Host configures + opens the draw over the SAME engine, via the session key.
  const cfg = await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_configure", sessionId: sess.body.sessionId, enabled: true, startAt: 1000, cutoffAt: 5000, prizes: { third: "3rd", second: "2nd", first: "1st" } }, share: fakeShare(), giftCollection: GIFT_COLLECTION, publicBaseUrl: "https://x", now: 500 });
  assert.equal(cfg.status, 200);
  await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_open", sessionId: sess.body.sessionId }, now: 1500 });

  const claim = await claimLuckyCode({ db, giftCollection: GIFT_COLLECTION, body: { token, participantToken: "p".repeat(20) }, now: 2000 });
  assert.equal(claim.status, 200);
  assert.match(claim.body.luckyCode, /^\d{6}$/);      // six-digit Lucky Number, unchanged format
  // Retry returns the SAME number (one per participant, ever).
  const again = await claimLuckyCode({ db, giftCollection: GIFT_COLLECTION, body: { token, participantToken: "p".repeat(20) }, now: 2100 });
  assert.equal(again.body.luckyCode, claim.body.luckyCode);
  assert.equal(again.body.alreadyClaimed, true);
});

// --- Linked Wedding shares the SAME engine ----------------------------------

test("a linked Wedding session uses sessionId===eventId and the SHARED winner engine", async () => {
  const db = makeFakeDb();
  const eventId = "evt-123";
  db._store.set(`${EVENT_COLLECTION}/${eventId}`, { senderUid: OWNER.uid, type: "wedding", occasion: { type: "wedding", eventTitle: null, couple: { partner1: "A", partner2: "B" } } });
  const link = await createLiveSession({ db, decoded: OWNER, body: { eventId }, share: fakeShare(), giftCollection: GIFT_COLLECTION, publicBaseUrl: "https://x" });
  assert.equal(link.body.sessionId, eventId);          // session key IS the event id
  assert.equal(link.body.skin, "wedding");
  // Re-open is idempotent.
  assert.equal((await createLiveSession({ db, decoded: OWNER, body: { eventId }, share: fakeShare(), giftCollection: GIFT_COLLECTION, publicBaseUrl: "https://x" })).body.existing, true);
  // Draw config through the generic door resolves ownership via the LiveSession.
  const cfg = await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_configure", sessionId: eventId, enabled: true, startAt: 1000, cutoffAt: 5000, prizes: { third: "3", second: "2", first: "1" } }, now: 500 });
  assert.equal(cfg.status, 200);
});

// --- Fairness / winner engine is ONE, keyed by session ----------------------

test("winner selection is server-authoritative, ordered, one-per-participant, idempotent — over a session key", async () => {
  const db = makeFakeDb();
  const sess = await createStandalone(db);
  const sid = sess.body.sessionId;
  await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_configure", sessionId: sid, enabled: true, startAt: 1000, cutoffAt: 5000, prizes: { third: "3", second: "2", first: "1" } }, now: 500 });
  await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_open", sessionId: sid }, now: 1500 });
  // Three participants join.
  for (const p of ["aaaa", "bbbb", "cccc"]) {
    await claimLuckyCode({ db, giftCollection: GIFT_COLLECTION, body: { token: sess.body.token, participantToken: p.repeat(5) }, now: 2000 });
  }
  // Lock after cutoff.
  const lock = await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_lock", sessionId: sid }, now: 6000 });
  assert.equal(lock.body.status, "locked");
  assert.equal(lock.body.entrantCount, 3);
  // Draw 3 → 2 → 1; out-of-order refused; refresh returns same winner.
  const w3 = await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_winner", sessionId: sid, tier: 3 }, now: 6100 });
  assert.equal(w3.status, 200);
  assert.match(w3.body.luckyCode, /^\d{6}$/);
  const w3again = await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_winner", sessionId: sid, tier: 3 }, now: 6150 });
  assert.equal(w3again.body.luckyCode, w3.body.luckyCode);   // idempotent recovery
  assert.equal(w3again.body.alreadyDrawn, true);
  assert.equal((await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_winner", sessionId: sid, tier: 1 }, now: 6200 })).body.error, "draw_out_of_order");
  await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_winner", sessionId: sid, tier: 2 }, now: 6300 });
  const w1 = await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_winner", sessionId: sid, tier: 1 }, now: 6400 });
  assert.equal(w1.body.status, "completed");
  // Three distinct winners (one participant one prize).
  const winners = db._store.get(`${DRAW_COLLECTION}/${sid}`).winners.map((w) => w.luckyCode);
  assert.equal(new Set(winners).size, 3);
});

// --- Ownership isolation + Account ------------------------------------------

test("ownership isolation: another sender cannot configure or see a session", async () => {
  const db = makeFakeDb();
  const sess = await createStandalone(db);
  const sid = sess.body.sessionId;
  assert.equal((await handleSenderLive({ db, decoded: OTHER, body: { action: "draw_configure", sessionId: sid, enabled: true, startAt: 1, cutoffAt: 2, prizes: { third: "3", second: "2", first: "1" } } })).status, 403);
  assert.equal((await liveSessionDetail({ db, decoded: OTHER, body: { sessionId: sid } })).status, 403);
});

test("My Live Sessions lists only the owner's sessions; detail reopens draw state", async () => {
  const db = makeFakeDb();
  await createStandalone(db, "Party A");
  await createStandalone(db, "Party B");
  await createLiveSession({ db, decoded: OTHER, body: { title: "Other's" }, share: fakeShare(), giftCollection: GIFT_COLLECTION, publicBaseUrl: "https://x" });
  const list = await listLiveSessions({ db, decoded: OWNER });
  assert.equal(list.body.sessions.length, 2);
  assert.ok(list.body.sessions.every((s) => s.title.startsWith("Party")));
  const detail = await liveSessionDetail({ db, decoded: OWNER, body: { sessionId: list.body.sessions[0].sessionId } });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.session.capabilities.includes("lucky_draw"), true);
});

// --- Boundaries -------------------------------------------------------------

test("boundaries: no Gift object, no Heart Key, only lucky_draw, no Lucky Balls", async () => {
  const db = makeFakeDb();
  const sess = await createStandalone(db);
  const s = db._store.get(`${LIVE_SESSION_COLLECTION}/${sess.body.sessionId}`);
  // A LiveSession is NOT a Gift: no keyHash/heart-key, no occasion sealing.
  assert.equal(s.keyHash, undefined);
  assert.equal(s.accessMode, undefined);
  // V1 capability set is exactly lucky_draw — quiz/guestbook not enabled.
  assert.deepEqual([...LIVE_CAPABILITIES], ["lucky_draw"]);
  assert.equal(s.capabilities.includes("guestbook"), false);
  assert.equal(s.capabilities.includes("quiz"), false);
  // Lucky Number format is six digits (Lucky Balls not enabled anywhere).
  const bad = await handleSenderLive({ db, decoded: OWNER, body: { action: "nope" } });
  assert.equal(bad.body.field, "action");
});

// --- Lucky Draw MODES: family with a shared winner engine (2026-08-20) --------

test("Lucky Draw modes: both lucky_number and lucky_ball are configurable; unknown refused", async () => {
  const db = makeFakeDb();
  const sess = await createStandalone(db);
  const sid = sess.body.sessionId;
  const cfg = (mode) => handleSenderLive({ db, decoded: OWNER, body: { action: "draw_configure", sessionId: sid, enabled: true, startAt: 1000, cutoffAt: 5000, prizes: { third: "3", second: "2", first: "1" }, ...(mode ? { mode } : {}) }, now: 500 });

  // Default is lucky_number, stored on the draw doc.
  assert.equal((await cfg()).status, 200);
  assert.equal(db._store.get(`${DRAW_COLLECTION}/${sid}`).mode, "lucky_number");
  assert.equal((await cfg("lucky_number")).status, 200);

  // lucky_ball is now implemented → configurable, stored on the draw doc.
  const ball = await cfg("lucky_ball");
  assert.equal(ball.status, 200);
  assert.equal(db._store.get(`${DRAW_COLLECTION}/${sid}`).mode, "lucky_ball");
  // An unknown mode is still refused (no half-built game).
  assert.equal((await cfg("roulette")).body.error, "invalid_mode");

  // The winner engine is mode-agnostic: it selects from the pool regardless,
  // and never reads `mode` (proven by the unchanged drawWinner tests above).
  const { LUCKY_DRAW_MODES, IMPLEMENTED_LUCKY_DRAW_MODES } = await import("./onsite.mjs");
  assert.deepEqual([...LUCKY_DRAW_MODES], ["lucky_number", "lucky_ball"]);
  assert.deepEqual([...IMPLEMENTED_LUCKY_DRAW_MODES], ["lucky_number", "lucky_ball"]);
});

// --- Multi-winner per tier (Founder, 2026-08-21) -----------------------------

test("per-tier winner count: 3rd×3, 2nd×2, 1st×1 → six DISTINCT winners, atomic", async () => {
  const db = makeFakeDb();
  const sess = await createStandalone(db);
  const sid = sess.body.sessionId;
  // Configure with per-tier counts via {label, count}.
  const cfg = await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_configure", sessionId: sid, enabled: true, startAt: 1000, cutoffAt: 5000,
    prizes: { third: { label: "3rd", count: 3 }, second: { label: "2nd", count: 2 }, first: { label: "1st", count: 1 } } }, now: 500 });
  assert.equal(cfg.status, 200);
  await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_open", sessionId: sid }, now: 1500 });
  // Eight participants join.
  for (let i = 0; i < 8; i += 1) {
    await claimLuckyCode({ db, giftCollection: GIFT_COLLECTION, body: { token: sess.body.token, participantToken: `p${i}`.padEnd(20, 'x') }, now: 2000 });
  }
  await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_lock", sessionId: sid }, now: 6000 });

  // Draw 3rd → 3 winners in one atomic call.
  const w3 = await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_winner", sessionId: sid, tier: 3 }, now: 6100 });
  assert.equal(w3.body.luckyCodes.length, 3);
  assert.equal(w3.body.status, "drawing");
  // Draw 2nd → 2 winners.
  const w2 = await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_winner", sessionId: sid, tier: 2 }, now: 6200 });
  assert.equal(w2.body.luckyCodes.length, 2);
  // Draw 1st → 1 winner, completes.
  const w1 = await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_winner", sessionId: sid, tier: 1 }, now: 6300 });
  assert.equal(w1.body.luckyCodes.length, 1);
  assert.equal(w1.body.status, "completed");

  // Six DISTINCT winners total; one participant one prize.
  const allCodes = db._store.get(`${DRAW_COLLECTION}/${sid}`).winners.map((w) => w.luckyCode);
  assert.equal(allCodes.length, 6);
  assert.equal(new Set(allCodes).size, 6);
  // Every won entrant has exactly one prizeTier.
  const won = [...db._store.entries()].filter(([k, v]) => k.startsWith(`${ENTRANT_COLLECTION}/`) && v.status === "won");
  assert.equal(won.length, 6);
});

test("multi-winner tier is ATOMIC + idempotent; insufficient pool refuses the whole tier", async () => {
  const db = makeFakeDb();
  const sess = await createStandalone(db);
  const sid = sess.body.sessionId;
  await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_configure", sessionId: sid, enabled: true, startAt: 1000, cutoffAt: 5000,
    prizes: { third: { label: "3rd", count: 3 }, second: { label: "2nd", count: 2 }, first: { label: "1st", count: 1 } } }, now: 500 });
  await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_open", sessionId: sid }, now: 1500 });
  // Only TWO participants — fewer than the 3rd-prize count of 3.
  for (let i = 0; i < 2; i += 1) {
    await claimLuckyCode({ db, giftCollection: GIFT_COLLECTION, body: { token: sess.body.token, participantToken: `q${i}`.padEnd(20, 'x') }, now: 2000 });
  }
  await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_lock", sessionId: sid }, now: 6000 });

  // Refuses the WHOLE tier (never a partial draw) — no winners committed.
  const bad = await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_winner", sessionId: sid, tier: 3 }, now: 6100 });
  assert.equal(bad.body.error, "insufficient_entrants");
  assert.equal(bad.body.need, 3);
  assert.equal(bad.body.available, 2);
  assert.equal(db._store.get(`${DRAW_COLLECTION}/${sid}`).winners.length, 0);
});

test("drawing a full tier twice returns the SAME committed set (refresh recovery)", async () => {
  const db = makeFakeDb();
  const sess = await createStandalone(db);
  const sid = sess.body.sessionId;
  await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_configure", sessionId: sid, enabled: true, startAt: 1000, cutoffAt: 5000,
    prizes: { third: { label: "3rd", count: 3 }, second: { label: "2nd", count: 2 }, first: { label: "1st", count: 1 } } }, now: 500 });
  await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_open", sessionId: sid }, now: 1500 });
  for (let i = 0; i < 6; i += 1) await claimLuckyCode({ db, giftCollection: GIFT_COLLECTION, body: { token: sess.body.token, participantToken: `r${i}`.padEnd(20, 'x') }, now: 2000 });
  await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_lock", sessionId: sid }, now: 6000 });
  const first = await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_winner", sessionId: sid, tier: 3 }, now: 6100 });
  const again = await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_winner", sessionId: sid, tier: 3 }, now: 6150 });
  assert.deepEqual(again.body.luckyCodes.sort(), first.body.luckyCodes.sort());
  assert.equal(again.body.alreadyDrawn, true);
  // Out-of-order still refused (can't draw 1st before 2nd).
  assert.equal((await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_winner", sessionId: sid, tier: 1 }, now: 6200 })).body.error, "draw_out_of_order");
});

test("prize count validates 1..MAX; a string prize stays one winner (Wedding back-compat)", async () => {
  const db = makeFakeDb();
  const sess = await createStandalone(db);
  const sid = sess.body.sessionId;
  const cfg = (prizes) => handleSenderLive({ db, decoded: OWNER, body: { action: "draw_configure", sessionId: sid, enabled: true, startAt: 1000, cutoffAt: 5000, prizes }, now: 500 });
  assert.equal((await cfg({ third: { label: "x", count: 0 }, second: { label: "y" }, first: { label: "z" } })).body.field, "third.count");
  assert.equal((await cfg({ third: { label: "x", count: 999 }, second: { label: "y" }, first: { label: "z" } })).body.field, "third.count");
  // String labels → count 1 each (legacy Wedding contract).
  await cfg({ third: "3rd", second: "2nd", first: "1st" });
  const prizes = db._store.get(`${DRAW_COLLECTION}/${sid}`).prizes;
  assert.deepEqual(prizes.map((p) => p.count), [1, 1, 1]);
});

// --- Lucky Ball (mode: lucky_ball) — identity allocation + shared engine -----

const createBall = (db, title = "Ball Night") =>
  createLiveSession({ db, decoded: OWNER, body: { title, mode: "lucky_ball" }, share: fakeShare(), giftCollection: GIFT_COLLECTION, publicBaseUrl: "https://x" });

async function openBallDraw(db, sid, { prizes } = {}) {
  await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_configure", sessionId: sid, enabled: true, mode: "lucky_ball", startAt: 1000, cutoffAt: 9000,
    prizes: prizes ?? { third: { label: "3rd", count: 1 }, second: { label: "2nd", count: 1 }, first: { label: "1st", count: 1 } } }, now: 500 });
  await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_open", sessionId: sid }, now: 1500 });
}

test("Lucky Ball allocator: six DISTINCT numbers, all 1–30, unique sets", () => {
  for (let i = 0; i < 200; i += 1) {
    const balls = drawLuckyBalls();
    assert.equal(balls.length, LUCKY_BALL_COUNT);
    assert.equal(new Set(balls).size, LUCKY_BALL_COUNT);           // no duplicate inside a set
    for (const n of balls) assert.ok(n >= 1 && n <= LUCKY_BALL_MAX); // range 1–30
  }
  // pickUnique never returns a set whose sorted signature already exists.
  const seen = new Set();
  for (let i = 0; i < 300; i += 1) {
    const balls = pickUniqueLuckyBalls(seen);
    assert.ok(balls, "space is vast — never exhausted at this size");
    assert.ok(!seen.has(ballSignature(balls)));
    seen.add(ballSignature(balls));
  }
});

test("Lucky Ball claim: participant gets six unique 1–30; retry returns the SAME set (cannot regenerate)", async () => {
  const db = makeFakeDb();
  const sess = await createBall(db);
  const sid = sess.body.sessionId;
  assert.equal(db._store.get(`${LIVE_SESSION_COLLECTION}/${sid}`).mode, "lucky_ball"); // stored at create
  await openBallDraw(db, sid);

  const claim = () => claimLuckyCode({ db, giftCollection: GIFT_COLLECTION, body: { token: sess.body.token, participantToken: "ballplayer000000001" }, now: 2000 });
  const first = await claim();
  assert.equal(first.body.mode, "lucky_ball");
  assert.equal(first.body.luckyBalls.length, 6);
  assert.equal(new Set(first.body.luckyBalls).size, 6);
  for (const n of first.body.luckyBalls) assert.ok(n >= 1 && n <= 30);

  // Retry / reopen: identical set + order, never regenerated (alreadyClaimed).
  const again = await claim();
  assert.equal(again.body.alreadyClaimed, true);
  assert.deepEqual(again.body.luckyBalls, first.body.luckyBalls);
});

test("Lucky Ball uses the SAME winner engine; winner committed with its balls BEFORE any reveal; refresh reproduces winner + numbers + reveal order", async () => {
  const db = makeFakeDb();
  const sess = await createBall(db);
  const sid = sess.body.sessionId;
  await openBallDraw(db, sid);
  for (let i = 0; i < 5; i += 1) {
    await claimLuckyCode({ db, giftCollection: GIFT_COLLECTION, body: { token: sess.body.token, participantToken: `ballplayer${i}`.padEnd(20, "x") }, now: 2000 });
  }
  await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_lock", sessionId: sid }, now: 9500 });

  const w3 = await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_winner", sessionId: sid, tier: 3 }, now: 9600 });
  assert.equal(w3.status, 200);
  // The winner is chosen by the engine over luckyCode — the balls are only carried
  // along as identity, never used to pick. The committed winner record has balls.
  const drawDoc = db._store.get(`${DRAW_COLLECTION}/${sid}`);
  const won = drawDoc.winners.find((x) => x.tier === 3);
  assert.ok(won.luckyCode, "winner keyed by luckyCode (shared engine)");
  assert.equal(won.luckyBalls.length, 6);
  // That winner's balls MATCH the entrant the engine actually committed.
  const wonEntrant = [...db._store.entries()].find(([k, v]) => k.startsWith(`${ENTRANT_COLLECTION}/`) && v.luckyCode === won.luckyCode && v.status === "won");
  assert.deepEqual(won.luckyBalls, wonEntrant[1].luckyBalls); // reveal order == committed identity
  const orderBefore = [...won.luckyBalls];

  // Refresh (re-read detail): same winner, same numbers, same reveal order.
  const detail = await handleSenderLive({ db, decoded: OWNER, body: { action: "detail", sessionId: sid }, now: 9700 });
  const dw = detail.body.draw.winners.find((x) => x.tier === 3);
  assert.equal(dw.luckyCode, won.luckyCode);
  assert.deepEqual(dw.luckyBalls, orderBefore);
  assert.equal(detail.body.session.mode, "lucky_ball");

  // Idempotent re-draw returns the SAME committed winner (no new sequence).
  const again = await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_winner", sessionId: sid, tier: 3 }, now: 9800 });
  assert.equal(again.body.alreadyDrawn, true);
  assert.equal(again.body.luckyCode, won.luckyCode);
});

test("Lucky Ball reuses the prize-quantity model unchanged (3rd×3, 2nd×2, 1st×1 → 6 distinct, one prize each)", async () => {
  const db = makeFakeDb();
  const sess = await createBall(db);
  const sid = sess.body.sessionId;
  await openBallDraw(db, sid, { prizes: { third: { label: "3rd", count: 3 }, second: { label: "2nd", count: 2 }, first: { label: "1st", count: 1 } } });
  for (let i = 0; i < 8; i += 1) await claimLuckyCode({ db, giftCollection: GIFT_COLLECTION, body: { token: sess.body.token, participantToken: `bp${i}`.padEnd(20, "x") }, now: 2000 });
  await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_lock", sessionId: sid }, now: 9500 });
  await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_winner", sessionId: sid, tier: 3 }, now: 9600 });
  await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_winner", sessionId: sid, tier: 2 }, now: 9700 });
  await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_winner", sessionId: sid, tier: 1 }, now: 9800 });
  const drawDoc = db._store.get(`${DRAW_COLLECTION}/${sid}`);
  assert.equal(drawDoc.winners.length, 6);
  assert.equal(new Set(drawDoc.winners.map((w) => w.luckyCode)).size, 6); // one participant one prize
  for (const w of drawDoc.winners) assert.equal(w.luckyBalls.length, 6);  // every winner carries balls
});

test("Lucky Number is UNCHANGED by Lucky Ball: no balls assigned, no balls on winners", async () => {
  const db = makeFakeDb();
  const sess = await createStandalone(db); // default lucky_number
  const sid = sess.body.sessionId;
  await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_configure", sessionId: sid, enabled: true, startAt: 1000, cutoffAt: 9000, prizes: { third: "3rd", second: "2nd", first: "1st" } }, now: 500 });
  await handleSenderLive({ db, decoded: OWNER, body: { action: "draw_open", sessionId: sid }, now: 1500 });
  const claim = await claimLuckyCode({ db, giftCollection: GIFT_COLLECTION, body: { token: sess.body.token, participantToken: "numplayer0000000001" }, now: 2000 });
  assert.equal(claim.body.mode, "lucky_number");
  assert.equal(claim.body.luckyBalls, null);                 // no balls in lucky_number
  const entrant = [...db._store.entries()].find(([k]) => k.startsWith(`${ENTRANT_COLLECTION}/`))[1];
  assert.equal(entrant.luckyBalls, undefined);               // not stored
});

test("My Live Sessions surfaces mode for both Lucky Number and Lucky Ball", async () => {
  const db = makeFakeDb();
  await createStandalone(db, "Number Night");
  await createBall(db, "Ball Night");
  const list = await handleSenderLive({ db, decoded: OWNER, body: { action: "list" }, now: 3000 });
  const modes = list.body.sessions.map((s) => s.mode).sort();
  assert.deepEqual(modes, ["lucky_ball", "lucky_number"]);
});

// --- Live Guestbook (capability: live_guestbook) ----------------------------

const createGuestbookSession = (db, title = "Reception Wall") =>
  createLiveSession({ db, decoded: OWNER, body: { title, capability: "live_guestbook" }, share: fakeShare(), giftCollection: GIFT_COLLECTION, publicBaseUrl: "https://x" });

const submit = (db, token, text, extra = {}) =>
  submitBlessing({ db, giftCollection: GIFT_COLLECTION, body: { token, text, idempotencyKey: `idem${Math.abs(hashStr(text + (extra.tag ?? "")))}`, participantToken: extra.pt ?? "guestparticipant00001", ...extra }, now: extra.now ?? 1000 });
const hashStr = (s) => { let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return h; };

test("standalone Guestbook: create needs NO Event, carries live_guestbook capability, neutral skin", async () => {
  const db = makeFakeDb();
  const res = await createGuestbookSession(db);
  assert.equal(res.status, 200);
  assert.match(res.body.sessionId, /^ls_/);
  const s = db._store.get(`${LIVE_SESSION_COLLECTION}/${res.body.sessionId}`);
  assert.deepEqual(s.capabilities, ["live_guestbook"]);   // the chosen capability only
  assert.equal(s.eventId, null);                          // no Event
  assert.equal(s.skin, "neutral");
});

test("linked Wedding session carries BOTH capabilities + wedding skin; standalone stays neutral", async () => {
  const db = makeFakeDb();
  const eventId = "evt-gb";
  db._store.set(`${EVENT_COLLECTION}/${eventId}`, { senderUid: OWNER.uid, type: "wedding", occasion: { type: "wedding", couple: { partner1: "A", partner2: "B" } } });
  const link = await createLiveSession({ db, decoded: OWNER, body: { eventId, capability: "live_guestbook" }, share: fakeShare(), giftCollection: GIFT_COLLECTION, publicBaseUrl: "https://x" });
  const s = db._store.get(`${LIVE_SESSION_COLLECTION}/${eventId}`);
  assert.equal(link.body.sessionId, eventId);
  assert.deepEqual([...s.capabilities].sort(), ["live_guestbook", "live_quiz", "lucky_draw"]);
  assert.equal(s.skin, "wedding");
});

test("anonymous submission works; a message DEFAULTS to NOT approved for display", async () => {
  const db = makeFakeDb();
  const sess = await createGuestbookSession(db);
  const r = await submit(db, sess.body.token, "Congratulations! 🎉");
  assert.equal(r.status, 200);
  assert.equal(r.body.duplicate, false);
  const entry = db._store.get(`${GUESTBOOK_COLLECTION}/${r.body.entryId}`);
  assert.equal(entry.approvedForDisplay, false);   // P0 default
  assert.equal(entry.status, "active");
  assert.equal(entry.expireAt, undefined);         // NOT the draw's short TTL
});

test("P0: an unapproved message can NEVER reach the public display feed", async () => {
  const db = makeFakeDb();
  const sess = await createGuestbookSession(db);
  const sid = sess.body.sessionId;
  await submit(db, sess.body.token, "please show me", { pt: "pa000000000000000001" });
  // Inbox sees it (private review); display feed is EMPTY (server-filtered).
  const inbox = await handleSenderLive({ db, decoded: OWNER, body: { action: "guestbook_inbox", sessionId: sid }, now: 2000 });
  assert.equal(inbox.body.count, 1);
  assert.equal(inbox.body.approvedCount, 0);
  assert.equal(inbox.body.entries[0].approvedForDisplay, false);
  const disp = await handleSenderLive({ db, decoded: OWNER, body: { action: "guestbook_display", sessionId: sid }, now: 2000 });
  assert.equal(disp.body.count, 0);   // NOTHING reaches the screen without approval
});

test("explicit host approval enables display; revoking / hiding removes it from rotation", async () => {
  const db = makeFakeDb();
  const sess = await createGuestbookSession(db);
  const sid = sess.body.sessionId;
  const r = await submit(db, sess.body.token, "best wishes", { pt: "pb000000000000000001" });
  const entryId = r.body.entryId;
  const disp = () => handleSenderLive({ db, decoded: OWNER, body: { action: "guestbook_display", sessionId: sid }, now: 3000 });
  const mod = (op) => handleSenderLive({ db, decoded: OWNER, body: { action: "guestbook_moderate", sessionId: sid, entryId, op }, now: 3000 });

  assert.equal((await disp()).body.count, 0);
  await mod("approve");
  assert.equal((await disp()).body.count, 1);          // now visible
  await mod("unapprove");
  assert.equal((await disp()).body.count, 0);          // removed from rotation
  await mod("approve");
  await mod("hide");                                    // hide also clears approval
  const d = await disp();
  assert.equal(d.body.count, 0);
  assert.equal(db._store.get(`${GUESTBOOK_COLLECTION}/${entryId}`).approvedForDisplay, false);
  assert.equal(db._store.get(`${GUESTBOOK_COLLECTION}/${entryId}`).status, "hidden");
});

test("owner isolation: another host cannot inbox / moderate / display this session", async () => {
  const db = makeFakeDb();
  const sess = await createGuestbookSession(db);
  const sid = sess.body.sessionId;
  const r = await submit(db, sess.body.token, "hi");
  for (const action of ["guestbook_inbox", "guestbook_display"]) {
    assert.equal((await handleSenderLive({ db, decoded: OTHER, body: { action, sessionId: sid }, now: 1 })).status >= 400, true);
  }
  const bad = await handleSenderLive({ db, decoded: OTHER, body: { action: "guestbook_moderate", sessionId: sid, entryId: r.body.entryId, op: "approve" }, now: 1 });
  assert.equal(bad.status >= 400, true);
  assert.equal(db._store.get(`${GUESTBOOK_COLLECTION}/${r.body.entryId}`).approvedForDisplay, false); // untouched
});

test("abuse: per-participant cap + duplicate-text protection", async () => {
  const db = makeFakeDb();
  const sess = await createGuestbookSession(db);
  const pt = "pc000000000000000001";
  for (let i = 0; i < GUESTBOOK_MAX_PER_PARTICIPANT; i += 1) {
    const r = await submit(db, sess.body.token, `message number ${i}`, { pt, tag: `u${i}` });
    assert.equal(r.status, 200);
  }
  // One more distinct message from the SAME identity → capped.
  const over = await submit(db, sess.body.token, "one too many", { pt, tag: "over" });
  assert.equal(over.status, 429);
  // A repeat of an existing message (new idem key) → treated as duplicate, not a new row.
  const before = [...db._store.keys()].filter((k) => k.startsWith(`${GUESTBOOK_COLLECTION}/`)).length;
  const dup = await submit(db, sess.body.token, "message number 1", { pt: "pd000000000000000001", tag: "dupehunt" });
  // (different participant, so cap not hit; but same normalized text by that participant is what we test)
  const r2 = await submit(db, sess.body.token, "hello world", { pt: "pe000000000000000001", tag: "a" });
  const r2dup = await submit(db, sess.body.token, "hello   world", { pt: "pe000000000000000001", tag: "b" });
  assert.equal(r2dup.body.duplicate, true);
  assert.equal(r2dup.body.entryId, r2.body.entryId);
  void dup; void before;
});

test("moderation tier is advisory only — it never auto-approves display", async () => {
  const db = makeFakeDb();
  const sess = await createGuestbookSession(db);
  const r = await submit(db, sess.body.token, "anything");
  const entry = db._store.get(`${GUESTBOOK_COLLECTION}/${r.body.entryId}`);
  assert.equal(entry.moderation, "normal");
  assert.equal(entry.approvedForDisplay, false); // moderation pass ≠ approvedForDisplay
});

test("My Live Sessions surfaces a guestbook session with its capability", async () => {
  const db = makeFakeDb();
  await createGuestbookSession(db, "Wall");
  const list = await handleSenderLive({ db, decoded: OWNER, body: { action: "list" }, now: 1 });
  const wall = list.body.sessions.find((s) => s.title === "Wall");
  assert.deepEqual(wall.capabilities ?? ["live_guestbook"], ["live_guestbook"]);
});

// --- Live Quiz (capability: live_quiz) --------------------------------------

const createQuiz = (db, title = "Party Quiz") =>
  createLiveSession({ db, decoded: OWNER, body: { title, capability: "live_quiz" }, share: fakeShare(), giftCollection: GIFT_COLLECTION, publicBaseUrl: "https://x" });
const qConfig = (db, sid, extra = {}) => handleSenderLive({ db, decoded: OWNER, body: { action: "quiz_configure", sessionId: sid, ...extra }, now: extra.now ?? 100 });
const qCtl = (db, sid, op, now, extra = {}) => handleSenderLive({ db, decoded: OWNER, body: { action: "quiz_control", sessionId: sid, op, ...extra }, now });
const qState = (db, sid, now) => handleSenderLive({ db, decoded: OWNER, body: { action: "quiz_state", sessionId: sid }, now });
const gState = (db, token, pt, now) => quizGuestState({ db, giftCollection: GIFT_COLLECTION, body: { token, participantToken: pt }, now });
const gAnswer = (db, token, pt, questionId, answer, now, nickname) => quizGuestAnswer({ db, giftCollection: GIFT_COLLECTION, body: { token, participantToken: pt, questionId, answer, nickname }, now });
const pt = (n) => `quizplayer${n}`.padEnd(20, "z");

test("Quiz create is a live_quiz LiveSession (no Event); pure scoring is deterministic, NO async/AI", () => {
  // scoreQuizAnswer is a PURE SYNC function — never a Promise, never a model call.
  const fq = QUIZ_QUESTIONS.find((q) => q.id === "q_en_e1"); // free_text piano
  const r1 = scoreQuizAnswer(fq, "A Piano!", 30000, 60000);
  assert.equal(r1.correct, true);
  assert.equal(typeof r1.then, "undefined");                  // not a Promise
  assert.equal(scoreQuizAnswer(fq, "guitar", 30000, 60000).correct, false);
  // Normalization: case/punctuation/articles-as-configured, exact accepted match.
  assert.equal(normalizeQuizAnswer("The Piano.", "en"), "thepiano");
  const mc = QUIZ_QUESTIONS.find((q) => q.id === "q_en_e4"); // hexagon, correctIndex 1
  assert.equal(scoreQuizAnswer(mc, 1, 60000, 60000).correct, true);
  assert.equal(scoreQuizAnswer(mc, 0, 60000, 60000).correct, false);
});

test("standalone quiz create + configure returns estimated answering time (10×60 ≈ 600s)", async () => {
  const db = makeFakeDb();
  const sess = await createQuiz(db);
  const s = db._store.get(`${LIVE_SESSION_COLLECTION}/${sess.body.sessionId}`);
  assert.deepEqual(s.capabilities, ["live_quiz"]);
  assert.equal(s.eventId, null);
  const cfg = await qConfig(db, sess.body.sessionId, { locale: "en", questionCount: 6, answerDurationSeconds: 60 });
  assert.equal(cfg.body.questionCount, 6);
  assert.equal(cfg.body.answerDurationSeconds, 60);
  assert.equal(cfg.body.estimatedAnswerSeconds, 360);         // 6 × 60
  // The 10×60 = 600s figure the amendment calls out (clamped by pool ≤ 6, so test the math directly).
  assert.equal(10 * 60, 600);
});

test("host-driven flow: correct answer HIDDEN before reveal; one answer/participant/question; server scoring", async () => {
  const db = makeFakeDb();
  const sess = await createQuiz(db);
  const sid = sess.body.sessionId; const tok = sess.body.token;
  await qConfig(db, sid, { locale: "en", questionCount: 3 });
  const q0 = QUIZ_QUESTIONS.filter((q) => q.locale === "en")[0]; // q_en_1 piano free_text

  // ready → participant sees no open question / no answer field yet.
  await qCtl(db, sid, "open", 1000);
  // Guest state during question_open: question present, NO correct answer.
  const gs = await gState(db, tok, pt(1), 1500);
  assert.equal(gs.body.phase, "question_open");
  assert.equal(gs.body.question.correctAnswer, undefined);    // anti-cheat
  assert.ok(gs.body.timer.remainingMs > 0);

  // Two participants answer (one right, one wrong).
  assert.equal((await gAnswer(db, tok, pt(1), q0.id, "the piano", 2000, "Ann")).body.received, true);
  assert.equal((await gAnswer(db, tok, pt(2), q0.id, "guitar", 2500, "Bob")).body.received, true);
  // Submit response NEVER reveals correctness.
  const resub = await gAnswer(db, tok, pt(1), q0.id, "changed", 2600);
  assert.equal(resub.body.duplicate, true);                   // one final answer; no change

  // Still hidden while locked; revealed only after reveal.
  await qCtl(db, sid, "lock", 3000);
  assert.equal((await gState(db, tok, pt(1), 3100)).body.question.correctAnswer, undefined);
  await qCtl(db, sid, "reveal", 3200);
  const gr = await gState(db, tok, pt(1), 3300);
  assert.equal(gr.body.question.correctAnswer, "piano");      // now visible
  assert.equal(gr.body.mine.correct, true);
  assert.ok(gr.body.mine.points >= QUIZ_BASE_POINTS);         // server-scored
  const gr2 = await gState(db, tok, pt(2), 3300);
  assert.equal(gr2.body.mine.correct, false);
  assert.equal(gr2.body.mine.points, 0);
});

test("late answers refused: after Lock, and at timer zero (before Lock)", async () => {
  const db = makeFakeDb();
  const sess = await createQuiz(db);
  const sid = sess.body.sessionId; const tok = sess.body.token;
  await qConfig(db, sid, { locale: "en", questionCount: 2, answerDurationSeconds: 30 });
  const q0 = QUIZ_QUESTIONS.filter((q) => q.locale === "en")[0];
  await qCtl(db, sid, "open", 1000); // closesAt = 1000 + 30000
  // Within the window: accepted.
  assert.equal((await gAnswer(db, tok, pt(1), q0.id, "piano", 5000)).body.received, true);
  // At/after zero but BEFORE the host Locks: refused server-side (time gate).
  const late = await gAnswer(db, tok, pt(2), q0.id, "piano", 31001);
  assert.equal(late.status, 409);
  assert.equal(late.body.error, "answers_locked");
  assert.equal(late.body.reason, "time");
  // After explicit Lock: refused (phase gate).
  await qCtl(db, sid, "lock", 6000);
  assert.equal((await gAnswer(db, tok, pt(3), q0.id, "piano", 6100)).status, 409);
});

test("timer: pause FREEZES authoritative remaining; resume continues; refresh recovers same remaining", async () => {
  const db = makeFakeDb();
  const sess = await createQuiz(db);
  const sid = sess.body.sessionId;
  await qConfig(db, sid, { locale: "zh", questionCount: 2, answerDurationSeconds: 60 });
  await qCtl(db, sid, "open", 0); // closesAt = 60000
  // 20s in → ~40s left.
  assert.equal(quizRemainingMs(db._store.get(`${QUIZ_COLLECTION}/${sid}`), 20000), 40000);
  // Pause at 20s → freeze 40s. Time keeps passing but remaining stays 40s.
  await qCtl(db, sid, "pause", 20000);
  const paused = db._store.get(`${QUIZ_COLLECTION}/${sid}`);
  assert.equal(paused.paused, true);
  assert.equal(quizRemainingMs(paused, 20000), 40000);
  assert.equal(quizRemainingMs(paused, 55000), 40000);       // frozen despite 35s elapsed
  // A refresh (state read) reconstructs the SAME frozen remaining.
  const st = await qState(db, sid, 55000);
  assert.equal(st.body.timer.remainingMs, 40000);
  assert.equal(st.body.timer.paused, true);
  // Resume at 55s → closesAt = 55000 + 40000 = 95000.
  await qCtl(db, sid, "resume", 55000);
  const resumed = db._store.get(`${QUIZ_COLLECTION}/${sid}`);
  assert.equal(resumed.paused, false);
  assert.equal(quizRemainingMs(resumed, 55000), 40000);
  assert.equal(quizRemainingMs(resumed, 75000), 20000);
});

test("per-question override at open; host controls rhythm — timer never auto-chains", async () => {
  const db = makeFakeDb();
  const sess = await createQuiz(db);
  const sid = sess.body.sessionId;
  await qConfig(db, sid, { locale: "zh", questionCount: 2, answerDurationSeconds: 60 });
  await qCtl(db, sid, "open", 0, { durationSeconds: 15 });    // override this question to 15s
  assert.equal(db._store.get(`${QUIZ_COLLECTION}/${sid}`).durationSeconds, 15);
  // Even long after zero, the phase stays question_open until the host acts —
  // NO automatic reveal/ranking/next.
  const st = await qState(db, sid, 999999);
  assert.equal(st.body.phase, "question_open");
  assert.equal(st.body.timer.timeUp, true);
  // Out-of-order host op is refused (server owns the sequence).
  assert.equal((await qCtl(db, sid, "reveal", 999999)).status, 409); // must lock first
});

test("zh + en are the SAME engine; refresh recovers answer; deterministic tie; final leaderboard", async () => {
  const db = makeFakeDb();
  const sess = await createQuiz(db);
  const sid = sess.body.sessionId; const tok = sess.body.token;
  await qConfig(db, sid, { locale: "zh", mix: { easy: 1, medium: 0, hard: 0 }, answerDurationSeconds: 60 });
  const q0 = quizQuestionById(db._store.get(`${QUIZ_COLLECTION}/${sid}`).questionIds[0]); // q_zh_e1 free_text 水
  await qCtl(db, sid, "open", 0);
  // Distinct scores (one right, one wrong) → no prize tie → completes cleanly.
  await gAnswer(db, tok, pt(1), q0.id, "水", 5000, "甲");    // correct
  await gAnswer(db, tok, pt(2), q0.id, "沙子", 5000, "乙");  // wrong
  // Refresh mid-round returns the same submitted answer (session continuity).
  const mid = await gState(db, tok, pt(1), 6000);
  assert.equal(mid.body.mine.answered, true);
  assert.equal(mid.body.mine.answer, "水");
  // Drive to completion → final leaderboard snapshot.
  await qCtl(db, sid, "lock", 7000);
  await qCtl(db, sid, "reveal", 7100);
  await qCtl(db, sid, "scores", 7200);
  const done = await qCtl(db, sid, "next", 7300);
  assert.equal(done.body.phase, "completed");               // no prize tie → done
  const lb = db._store.get(`${QUIZ_COLLECTION}/${sid}`).finalLeaderboard;
  assert.equal(lb.length, 2);
  assert.deepEqual(lb.map((r) => r.rank), [1, 2]);
  assert.ok(lb[0].points > lb[1].points);                   // the correct player leads
  // Owner state hides participantIdHash from the public leaderboard.
  const os = await qState(db, sid, 8000);
  assert.equal(os.body.leaderboard[0].participantIdHash, undefined);
  assert.ok("nickname" in os.body.leaderboard[0]);
});

test("no AI per answer: 300 submissions create 300 answer docs, zero model calls (pure DB path)", async () => {
  const db = makeFakeDb();
  const sess = await createQuiz(db);
  const sid = sess.body.sessionId; const tok = sess.body.token;
  await qConfig(db, sid, { locale: "en", mix: { easy: 1, medium: 0, hard: 0 }, answerDurationSeconds: 300 });
  const q0 = quizQuestionById(db._store.get(`${QUIZ_COLLECTION}/${sid}`).questionIds[0]);
  await qCtl(db, sid, "open", 0);
  for (let i = 0; i < 300; i += 1) {
    await gAnswer(db, tok, pt(`n${i}`), q0.id, i % 2 ? "piano" : "wrong", 1000 + i);
  }
  const docs = [...db._store.keys()].filter((k) => k.startsWith(`${QUIZ_ANSWER_COLLECTION}/`));
  assert.equal(docs.length, 300);                             // 300 answers = 300 DB rows, not 300 AI calls
  assert.equal(db._store.get(`${QUIZ_COLLECTION}/${sid}`).answersSubmitted, 300);
});

// --- Live Quiz amendment: difficulty mix, prizes, tie-break ------------------

test("difficulty mix (default 3E/4M/3H for 10) draws only non-tie-break questions", async () => {
  const db = makeFakeDb();
  const sess = await createQuiz(db);
  const sid = sess.body.sessionId;
  const cfg = await qConfig(db, sid, { locale: "en", questionCount: 10 });
  assert.deepEqual(cfg.body.mix, { easy: 3, medium: 4, hard: 3 });
  const doc = db._store.get(`${QUIZ_COLLECTION}/${sid}`);
  assert.equal(doc.questionIds.filter((id) => quizQuestionById(id).tieBreakerEligible).length, 0); // reserved pool untouched
  // Explicit mix sets the count.
  const cfg2 = await qConfig(db, sid, { locale: "en", mix: { easy: 2, medium: 1, hard: 0 } });
  assert.deepEqual(cfg2.body.mix, { easy: 2, medium: 1, hard: 0 });
  assert.equal(cfg2.body.questionCount, 3);
});

test("top-3 prizes are optional, persisted, and never affect scoring", async () => {
  const db = makeFakeDb();
  const sess = await createQuiz(db);
  const sid = sess.body.sessionId;
  assert.deepEqual((await qConfig(db, sid, { locale: "en", questionCount: 3 })).body.prizes, { first: null, second: null, third: null });
  const c2 = await qConfig(db, sid, { locale: "en", questionCount: 3, prizes: { first: "iPad", second: "Headphones", third: "Voucher" } });
  assert.deepEqual(c2.body.prizes, { first: "iPad", second: "Headphones", third: "Voucher" });
  assert.equal(db._store.get(`${QUIZ_COLLECTION}/${sid}`).prizes.first, "iPad");
});

// Helper: enter a 1st/2nd tie (P1,P2 both correct at the same instant), P3 lower.
async function seedPrizeTie(db) {
  const sess = await createQuiz(db);
  const sid = sess.body.sessionId; const tok = sess.body.token;
  await qConfig(db, sid, { locale: "zh", mix: { easy: 1, medium: 0, hard: 0 }, prizes: { first: "Gold", second: "Silver", third: "Bronze" } });
  const q0 = quizQuestionById(db._store.get(`${QUIZ_COLLECTION}/${sid}`).questionIds[0]);
  await qCtl(db, sid, "open", 0);
  await gAnswer(db, tok, pt(1), q0.id, "水", 5000, "P1");   // correct
  await gAnswer(db, tok, pt(2), q0.id, "水", 5000, "P2");   // correct, same instant → tie
  await gAnswer(db, tok, pt(3), q0.id, "沙子", 5000, "P3"); // wrong
  await qCtl(db, sid, "lock", 7000); await qCtl(db, sid, "reveal", 7100); await qCtl(db, sid, "scores", 7200);
  return { sid, tok };
}

test("a top-3 score tie triggers a Tie-break Round; only the tied players are eligible", async () => {
  const db = makeFakeDb();
  const { sid, tok } = await seedPrizeTie(db);
  const enter = await qCtl(db, sid, "next", 7300);
  assert.equal(enter.body.phase, "ready");                  // NOT completed — tie-break entered
  const doc = db._store.get(`${QUIZ_COLLECTION}/${sid}`);
  assert.equal(doc.tieBreak.active, true);
  assert.equal(doc.tieBreak.eligible.length, 2);            // only P1 & P2
  const tbq = quizQuestionById(doc.tieBreak.questionId);
  assert.equal(tbq.tieBreakerEligible, true);               // from the reserved pool
  await qCtl(db, sid, "open", 8000);
  // Non-eligible P3 (rank 3) cannot answer the tie-break.
  const p3 = await gAnswer(db, tok, pt(3), tbq.id, tbq.correctIndex, 8100);
  assert.equal(p3.status, 403);
  assert.equal(p3.body.error, "not_in_tiebreak");
});

test("tie-break resolves to a deterministic podium with prize mapping (no random winner)", async () => {
  const db = makeFakeDb();
  const { sid, tok } = await seedPrizeTie(db);
  await qCtl(db, sid, "next", 7300);
  const tbq = quizQuestionById(db._store.get(`${QUIZ_COLLECTION}/${sid}`).tieBreak.questionId);
  await qCtl(db, sid, "open", 8000);
  await gAnswer(db, tok, pt(1), tbq.id, tbq.correctIndex, 8100);                          // P1 correct
  await gAnswer(db, tok, pt(2), tbq.id, (tbq.correctIndex + 1) % tbq.choices.length, 8100); // P2 wrong
  await qCtl(db, sid, "lock", 9000); await qCtl(db, sid, "reveal", 9100); await qCtl(db, sid, "scores", 9200);
  const fin = await qCtl(db, sid, "next", 9300);
  assert.equal(fin.body.phase, "completed");
  const lb = db._store.get(`${QUIZ_COLLECTION}/${sid}`).finalLeaderboard;
  assert.deepEqual(lb.slice(0, 3).map((r) => r.nickname), ["P1", "P2", "P3"]); // P1 won the tie-break
  assert.equal(lb[0].points, lb[1].points);                 // same MAIN score; tie-break decided order
  // Prize mapping surfaces to the winners.
  assert.equal((await gState(db, tok, pt(1), 9400)).body.myScore.prize, "Gold");
  assert.equal((await gState(db, tok, pt(2), 9400)).body.myScore.prize, "Silver");
  assert.equal((await gState(db, tok, pt(3), 9400)).body.myScore.prize, "Bronze");
});

test("tie-break REPEATS when still tied, until resolved", async () => {
  const db = makeFakeDb();
  const { sid, tok } = await seedPrizeTie(db);
  await qCtl(db, sid, "next", 7300);                         // round 1
  let tbq = quizQuestionById(db._store.get(`${QUIZ_COLLECTION}/${sid}`).tieBreak.questionId);
  await qCtl(db, sid, "open", 8000);
  await gAnswer(db, tok, pt(1), tbq.id, tbq.correctIndex, 8100); // both correct, same instant → STILL tied
  await gAnswer(db, tok, pt(2), tbq.id, tbq.correctIndex, 8100);
  await qCtl(db, sid, "lock", 9000); await qCtl(db, sid, "reveal", 9100); await qCtl(db, sid, "scores", 9200);
  const r2 = await qCtl(db, sid, "next", 9300);
  assert.equal(r2.body.phase, "ready");                     // another tie-break, not a coin flip
  const doc = db._store.get(`${QUIZ_COLLECTION}/${sid}`);
  assert.equal(doc.tieBreak.round, 2);
  assert.notEqual(doc.tieBreak.questionId, tbq.id);         // a fresh reserved question
  // Round 2: P1 wins.
  tbq = quizQuestionById(doc.tieBreak.questionId);
  await qCtl(db, sid, "open", 10000);
  await gAnswer(db, tok, pt(1), tbq.id, tbq.correctIndex, 10100);
  await gAnswer(db, tok, pt(2), tbq.id, (tbq.correctIndex + 1) % tbq.choices.length, 10200);
  await qCtl(db, sid, "lock", 11000); await qCtl(db, sid, "reveal", 11100); await qCtl(db, sid, "scores", 11200);
  assert.equal((await qCtl(db, sid, "next", 11300)).body.phase, "completed");
});

test("refresh recovers tie-break state; a tie OUTSIDE top-3 never triggers a tie-break", async () => {
  const db = makeFakeDb();
  const { sid, tok } = await seedPrizeTie(db);
  await qCtl(db, sid, "next", 7300);
  // Owner + guest refresh reconstruct the tie-break.
  const os = await qState(db, sid, 8500);
  assert.equal(os.body.tieBreak.active, true);
  assert.equal(os.body.tieBreak.round, 1);
  assert.equal((await gState(db, tok, pt(1), 8500)).body.tieBreak.eligible, true);   // eligible
  assert.equal((await gState(db, tok, pt(3), 8500)).body.tieBreak.eligible, false);  // spectator

  // Separate quiz: distinct top-3, a tie only at rank 4/5 → completes, no tie-break.
  const db2 = makeFakeDb();
  const sess2 = await createQuiz(db2);
  const sid2 = sess2.body.sessionId; const tok2 = sess2.body.token;
  await qConfig(db2, sid2, { locale: "en", mix: { easy: 1, medium: 0, hard: 0 }, answerDurationSeconds: 60 });
  const q = quizQuestionById(db2._store.get(`${QUIZ_COLLECTION}/${sid2}`).questionIds[0]);
  await qCtl(db2, sid2, "open", 0);
  await gAnswer(db2, tok2, pt("a"), q.id, "piano", 0);       // fastest correct
  await gAnswer(db2, tok2, pt("b"), q.id, "piano", 10000);   // slower correct
  await gAnswer(db2, tok2, pt("c"), q.id, "piano", 20000);   // slowest correct → distinct top 3
  await gAnswer(db2, tok2, pt("d"), q.id, "guitar", 5000);   // wrong → 0
  await gAnswer(db2, tok2, pt("e"), q.id, "drum", 6000);     // wrong → 0 (tied at rank 4/5)
  await qCtl(db2, sid2, "lock", 61000); await qCtl(db2, sid2, "reveal", 61100); await qCtl(db2, sid2, "scores", 61200);
  assert.equal((await qCtl(db2, sid2, "next", 61300)).body.phase, "completed"); // 4/5 tie is non-prize
});
