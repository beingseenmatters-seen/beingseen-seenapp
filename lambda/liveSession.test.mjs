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

test("Lucky Draw modes: lucky_number is the V1 mode; lucky_ball is reserved, not configurable", async () => {
  const db = makeFakeDb();
  const sess = await createStandalone(db);
  const sid = sess.body.sessionId;
  const cfg = (mode) => handleSenderLive({ db, decoded: OWNER, body: { action: "draw_configure", sessionId: sid, enabled: true, startAt: 1000, cutoffAt: 5000, prizes: { third: "3", second: "2", first: "1" }, ...(mode ? { mode } : {}) }, now: 500 });

  // Default is lucky_number, stored on the draw doc.
  assert.equal((await cfg()).status, 200);
  assert.equal(db._store.get(`${DRAW_COLLECTION}/${sid}`).mode, "lucky_number");
  assert.equal((await cfg("lucky_number")).status, 200);

  // lucky_ball is reserved but NOT implemented → refused (no half-built game).
  const ball = await cfg("lucky_ball");
  assert.equal(ball.status, 400);
  assert.equal(ball.body.error, "invalid_mode");
  // An unknown mode is likewise refused.
  assert.equal((await cfg("roulette")).body.error, "invalid_mode");

  // The winner engine is mode-agnostic: it selects from the pool regardless,
  // and never reads `mode` (proven by the unchanged drawWinner tests above).
  const { LUCKY_DRAW_MODES, IMPLEMENTED_LUCKY_DRAW_MODES } = await import("./onsite.mjs");
  assert.deepEqual([...LUCKY_DRAW_MODES], ["lucky_number", "lucky_ball"]);
  assert.deepEqual([...IMPLEMENTED_LUCKY_DRAW_MODES], ["lucky_number"]);
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
