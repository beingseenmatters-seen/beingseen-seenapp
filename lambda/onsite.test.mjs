/**
 * Phase WD-1 — Wedding Day on-site foundation tests.
 * Fake Firestore mirrors the real API surface used (query docs with ids,
 * create() that refuses to overwrite); fake share crypto mirrors KMS
 * context binding. Founder AA decisions are asserted, not assumed.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGift, retrieveGift, rsvpGift, GIFT_COLLECTION } from "./gift.mjs";
import { EVENT_COLLECTION, senderLibrary, eventDetail } from "./event.mjs";
import {
  listEntrants,
  drawWinner,
  GUESTBOOK_COLLECTION,
  ENTRANT_COLLECTION,
  DRAW_COLLECTION,
  BLESSING_MAX_LEN,
  DISPLAY_NAME_MAX_LEN,
  LOTTERY_LINGER_MS,
  formatLuckyCode,
  pickUniqueLuckyCode,
  createOnsite,
  onsiteDetail,
  listGuestbook,
  configureDraw,
  openDraw,
  lockDraw,
  submitBlessing,
  claimLuckyCode,
} from "./onsite.mjs";

// --- Fakes -------------------------------------------------------------------
function makeFakeDb({ raceOn = null } = {}) {
  const store = new Map();
  let txConflictsLeft = 0;
  const db = {
    _store: store,
    /** Simulate Admin SDK retry-on-conflict: fn re-runs until no conflict. */
    _injectTxConflicts(n2) { txConflictsLeft = n2; },
    async runTransaction(fn) {
      for (;;) {
        const writes = [];
        const tx = {
          get: async (refOrQuery) => (refOrQuery._key !== undefined
            ? { exists: store.has(refOrQuery._key), data: () => store.get(refOrQuery._key) }
            : refOrQuery.get()),
          update: (ref, patch) => void writes.push(() => store.set(ref._key, { ...store.get(ref._key), ...patch })),
          set: (ref, v) => void writes.push(() => store.set(ref._key, { ...v })),
        };
        const out = await fn(tx);
        if (txConflictsLeft > 0) { txConflictsLeft -= 1; continue; } // discard writes, retry fn
        writes.forEach((w) => w());
        return out;
      }
    },
    collection(name) {
      const makeQuery = (conds) => ({
        where: (field, op, val) => makeQuery([...conds, { field, val }]),
        get: async () => {
          const docs = [...store.entries()]
            .filter(([k]) => k.startsWith(`${name}/`))
            .filter(([, v]) => conds.every((c) => v[c.field] === c.val))
            .map(([k, v]) => ({ id: k.slice(name.length + 1), data: () => v }));
          return { size: docs.length, docs };
        },
      });
      return {
        doc: (id) => ({
          id,
          _key: `${name}/${id}`,
          get: async () => {
            const d = store.get(`${name}/${id}`);
            return { exists: d !== undefined, data: () => d };
          },
          set: async (v) => void store.set(`${name}/${id}`, { ...v }),
          create: async (v) => {
            // Firestore create(): fails when the doc exists. raceOn simulates
            // a concurrent writer landing between the handler's get and create.
            if (raceOn === name && !store.has(`${name}/${id}`)) {
              store.set(`${name}/${id}`, { ...v, luckyCode: "111222", raced: true });
              const err = new Error("ALREADY_EXISTS");
              err.code = 6;
              throw err;
            }
            if (store.has(`${name}/${id}`)) {
              const err = new Error("ALREADY_EXISTS");
              err.code = 6;
              throw err;
            }
            store.set(`${name}/${id}`, { ...v });
          },
          update: async (patch) =>
            void store.set(`${name}/${id}`, { ...store.get(`${name}/${id}`), ...patch }),
          delete: async () => void store.delete(`${name}/${id}`),
        }),
        where: (field, op, val) => makeQuery([{ field, val }]),
      };
    },
  };
  return db;
}

const fakeShare = () => ({
  seal: async (t, h) => `sealed:${Buffer.from(String(t)).toString("base64")}@${h}`,
  open: async (s, h) => {
    const m = /^sealed:(.+)@(.+)$/.exec(String(s));
    if (!m || m[2] !== h) throw new Error("encryption context mismatch");
    return Buffer.from(m[1], "base64").toString();
  },
});
const brokenShare = {
  seal: async () => {
    throw new Error("kms unavailable");
  },
};

const OWNER = { uid: "host-1" };
const STRANGER = { uid: "intruder-9" };
const T0 = 1_800_000_000_000;
const START = T0 + 60_000;
const CUTOFF = T0 + 3_600_000;

async function seedWedding(db, { uid = OWNER.uid, eventId = "ev-wed-1", type = "wedding" } = {}) {
  await db.collection(EVENT_COLLECTION).doc(eventId).set({
    schemaVersion: 1,
    type,
    senderUid: uid,
    occasion: { type, couple: { partner1: "冯志俊", partner2: "吴姗姗" } },
    createdAt: T0 - 1000,
    status: "active",
  });
  return eventId;
}

async function seedOnsite(db, { eventId = "ev-wed-1", message = "谢谢你今天真的来到这里。" } = {}) {
  const res = await createOnsite({
    db,
    decoded: OWNER,
    body: { eventId, message },
    share: fakeShare(),
    giftCollection: GIFT_COLLECTION,
    publicBaseUrl: "https://gift.example",
    now: T0,
  });
  assert.equal(res.status, 200);
  return res.body;
}

async function seedDraw(db, { eventId = "ev-wed-1", open = true, enabled = true } = {}) {
  const cfg = await configureDraw({
    db,
    decoded: OWNER,
    body: {
      eventId,
      enabled,
      startAt: START,
      cutoffAt: CUTOFF,
      prizes: { third: "红包 ¥100", second: "AirPods", first: "酒店住宿券" },
    },
    now: T0,
  });
  assert.equal(cfg.status, 200);
  if (open) assert.equal((await openDraw({ db, decoded: OWNER, body: { eventId }, now: T0 })).status, 200);
}

const bless = (db, onsite, over = {}) =>
  submitBlessing({
    db,
    body: {
      token: onsite.token,
      text: "百年好合，新婚快乐！",
      idempotencyKey: over.idempotencyKey ?? `idem-${Math.floor(Math.random() * 1e9)}-key`,
      ...over,
    },
    giftCollection: GIFT_COLLECTION,
    now: over.now ?? T0 + 120_000,
  });

// --- on_site record ----------------------------------------------------------

test("one on_site record per Event — second create returns the same record", async () => {
  const db = makeFakeDb();
  await seedWedding(db);
  const a = await seedOnsite(db);
  assert.equal(a.existing, false);
  assert.ok(a.token && a.url.includes(`/s/${a.token}`));
  const b = await createOnsite({
    db,
    decoded: OWNER,
    body: { eventId: "ev-wed-1", message: "另一段话" },
    share: fakeShare(),
    giftCollection: GIFT_COLLECTION,
    publicBaseUrl: "https://gift.example",
    now: T0 + 1,
  });
  assert.equal(b.status, 200);
  assert.equal(b.body.existing, true);
  assert.equal(b.body.giftId, a.giftId);
  assert.equal(b.body.token, undefined); // raw token is never re-issuable
});

test("wrong sender forbidden; non-Wedding Event rejected; share required", async () => {
  const db = makeFakeDb();
  await seedWedding(db);
  await seedWedding(db, { eventId: "ev-bday", type: "birthday" });
  const forbidden = await createOnsite({
    db,
    decoded: STRANGER,
    body: { eventId: "ev-wed-1", message: "hi" },
    share: fakeShare(),
    giftCollection: GIFT_COLLECTION,
    publicBaseUrl: "x",
    now: T0,
  });
  assert.equal(forbidden.status, 403);
  const nonWedding = await createOnsite({
    db,
    decoded: OWNER,
    body: { eventId: "ev-bday", message: "hi" },
    share: fakeShare(),
    giftCollection: GIFT_COLLECTION,
    publicBaseUrl: "x",
    now: T0,
  });
  assert.equal(nonWedding.status, 409);
  assert.equal(nonWedding.body.error, "wedding_only");
  const noShare = await createOnsite({
    db,
    decoded: OWNER,
    body: { eventId: "ev-wed-1", message: "hi" },
    share: null,
    giftCollection: GIFT_COLLECTION,
    publicBaseUrl: "x",
    now: T0,
  });
  assert.equal(noShare.status, 503);
  const sealFail = await createOnsite({
    db,
    decoded: OWNER,
    body: { eventId: "ev-wed-1", message: "hi" },
    share: brokenShare,
    giftCollection: GIFT_COLLECTION,
    publicBaseUrl: "x",
    now: T0,
  });
  assert.equal(sealFail.status, 503);
});

test("public token opens the active on_site; revoked on_site rejected", async () => {
  const db = makeFakeDb();
  await seedWedding(db);
  const onsite = await seedOnsite(db);
  const open = await retrieveGift({ db, body: { token: onsite.token }, now: T0 + 10 });
  assert.equal(open.status, 200);
  assert.equal(open.body.contextRole, "on_site");
  // Wedding identity inherited from the Event (WD-2 §3)
  assert.equal(open.body.occasion?.couple?.partner1, "冯志俊");
  assert.equal(open.body.message, "谢谢你今天真的来到这里。");
  assert.equal(open.body.onSite.draw, null); // no draw configured yet
  // revoke → guest paths answer honestly
  await db.collection(GIFT_COLLECTION).doc(onsite.giftId).update({ revoked: true });
  assert.equal((await retrieveGift({ db, body: { token: onsite.token }, now: T0 + 20 })).status, 410);
  const blessRevoked = await bless(db, onsite);
  assert.equal(blessRevoked.status, 410);
  // a revoked on_site does not block creating a fresh one (new venue QR)
  const again = await createOnsite({
    db,
    decoded: OWNER,
    body: { eventId: "ev-wed-1", message: "新的一段话" },
    share: fakeShare(),
    giftCollection: GIFT_COLLECTION,
    publicBaseUrl: "https://gift.example",
    now: T0 + 30,
  });
  assert.equal(again.body.existing, false);
  assert.notEqual(again.body.giftId, onsite.giftId);
});

test("on_site token can never RSVP; ordinary-gift token gains no on-site powers", async () => {
  const db = makeFakeDb();
  await seedWedding(db);
  const onsite = await seedOnsite(db);
  const rsvp = await rsvpGift({ db, body: { token: onsite.token, status: "accepted", adultCount: 1, childCount: 0 }, now: T0 });
  assert.equal(rsvp.status, 409);
  assert.equal(rsvp.body.error, "rsvp_not_applicable");
  // an ordinary direct gift token must not submit blessings
  const gift = await createGift({
    db,
    decoded: OWNER,
    body: { message: "普通心意", accessMode: "direct" },
    now: T0,
  });
  const blocked = await submitBlessing({
    db,
    body: { token: gift.body.token, text: "祝福", idempotencyKey: "abcdefgh" },
    giftCollection: GIFT_COLLECTION,
    now: T0,
  });
  assert.equal(blocked.status, 404);
});

// --- Guestbook ---------------------------------------------------------------

test("blessing accepted; 200-char boundary; displayName limits; idempotency key required", async () => {
  const db = makeFakeDb();
  await seedWedding(db);
  const onsite = await seedOnsite(db);

  const ok = await bless(db, onsite, { displayName: "表哥 阿俊", idempotencyKey: "key-0001-aa" });
  assert.equal(ok.status, 200);
  assert.equal(ok.body.duplicate, false);
  assert.ok(/^[A-Za-z0-9_-]{16,}$/.test(ok.body.participantToken));

  const exact = await bless(db, onsite, { text: "囍".repeat(BLESSING_MAX_LEN) });
  assert.equal(exact.status, 200);
  const over = await bless(db, onsite, { text: "囍".repeat(BLESSING_MAX_LEN + 1) });
  assert.equal(over.status, 400);
  assert.equal(over.body.error, "blessing_too_long");

  const nameOk = await bless(db, onsite, { displayName: "名".repeat(DISPLAY_NAME_MAX_LEN) });
  assert.equal(nameOk.status, 200);
  const nameOver = await bless(db, onsite, { displayName: "名".repeat(DISPLAY_NAME_MAX_LEN + 1) });
  assert.equal(nameOver.status, 400);
  assert.equal(nameOver.body.error, "display_name_too_long");

  const badIdem = await bless(db, onsite, { idempotencyKey: "short" });
  assert.equal(badIdem.status, 400);
  assert.equal(badIdem.body.error, "invalid_idempotency_key");
});

test("repeated blessing submission (same idempotencyKey) never duplicates — even token-less retry", async () => {
  const db = makeFakeDb();
  await seedWedding(db);
  const onsite = await seedOnsite(db);
  const first = await bless(db, onsite, { idempotencyKey: "retry-key-01" });
  assert.equal(first.body.duplicate, false);
  // retry WITH the participant token
  const again = await bless(db, onsite, {
    idempotencyKey: "retry-key-01",
    participantToken: first.body.participantToken,
  });
  assert.equal(again.body.duplicate, true);
  assert.equal(again.body.entryId, first.body.entryId);
  // retry WITHOUT the token (client crashed before storing the response)
  const blind = await bless(db, onsite, { idempotencyKey: "retry-key-01" });
  assert.equal(blind.body.duplicate, true);
  assert.equal(blind.body.entryId, first.body.entryId);
  const all = await db.collection(GUESTBOOK_COLLECTION).where("eventId", "==", "ev-wed-1").get();
  assert.equal(all.size, 1);
});

test("same participant may submit multiple blessings; sender lists them; guest cannot", async () => {
  const db = makeFakeDb();
  await seedWedding(db);
  const onsite = await seedOnsite(db);
  const a = await bless(db, onsite, { idempotencyKey: "multi-key-1" });
  const b = await bless(db, onsite, {
    idempotencyKey: "multi-key-2",
    participantToken: a.body.participantToken,
    text: "永结同心！",
  });
  assert.equal(b.body.duplicate, false);
  const rows = [...db._store.entries()].filter(([k]) => k.startsWith(`${GUESTBOOK_COLLECTION}/`));
  assert.equal(rows.length, 2);
  assert.equal(new Set(rows.map(([, v]) => v.participantIdHash)).size, 1);

  const listed = await listGuestbook({ db, decoded: OWNER, body: { eventId: "ev-wed-1" }, now: T0 });
  assert.equal(listed.status, 200);
  assert.equal(listed.body.count, 2);
  // rows carry NO participant material
  for (const row of listed.body.entries) {
    assert.equal(row.participantIdHash, undefined);
    assert.equal(row.luckyCode, undefined); // Guestbook ≠ Lottery, ever (§4)
    assert.ok(row.text && typeof row.createdAt === "number");
  }
  // guests/strangers cannot list
  assert.equal((await listGuestbook({ db, decoded: null, body: { eventId: "ev-wed-1" } })).status, 401);
  assert.equal((await listGuestbook({ db, decoded: STRANGER, body: { eventId: "ev-wed-1" } })).status, 403);
});

// --- Lucky Code --------------------------------------------------------------

test("lucky code format: exactly six digits, leading zeros preserved, event-unique", () => {
  assert.equal(formatLuckyCode(42), "000042");
  assert.equal(formatLuckyCode(0), "000000");
  assert.equal(formatLuckyCode(999999), "999999");
  // uniqueness loop retries on collision (injected RNG)
  const seen = new Set(["000007"]);
  let calls = 0;
  const rand = () => {
    calls += 1;
    return calls === 1 ? 7 : 583271;
  };
  assert.equal(pickUniqueLuckyCode(seen, rand), "583271");
  assert.equal(calls, 2);
});

test("claim window: before start no code; open issues one; after cutoff no NEW code but recovery works", async () => {
  const db = makeFakeDb();
  await seedWedding(db);
  const onsite = await seedOnsite(db);
  await seedDraw(db);
  const b1 = await bless(db, onsite, { idempotencyKey: "window-key-1", now: T0 + 1000 });
  const participantToken = b1.body.participantToken;

  const early = await claimLuckyCode({
    db,
    body: { token: onsite.token, participantToken },
    giftCollection: GIFT_COLLECTION,
    now: START - 1,
  });
  assert.equal(early.status, 409);
  assert.equal(early.body.error, "draw_not_started");

  const claimed = await claimLuckyCode({
    db,
    body: { token: onsite.token, participantToken },
    giftCollection: GIFT_COLLECTION,
    now: START + 1000,
  });
  assert.equal(claimed.status, 200);
  assert.match(claimed.body.luckyCode, /^\d{6}$/);
  assert.equal(claimed.body.alreadyClaimed, false);

  // repeated claim → SAME code, no extra chance (idempotent)
  const again = await claimLuckyCode({
    db,
    body: { token: onsite.token, participantToken },
    giftCollection: GIFT_COLLECTION,
    now: START + 2000,
  });
  assert.equal(again.body.alreadyClaimed, true);
  assert.equal(again.body.luckyCode, claimed.body.luckyCode);
  const entrants = await db.collection(ENTRANT_COLLECTION).where("eventId", "==", "ev-wed-1").get();
  assert.equal(entrants.size, 1);

  // post-cutoff: recovery of the existing code still works…
  const recover = await claimLuckyCode({
    db,
    body: { token: onsite.token, participantToken },
    giftCollection: GIFT_COLLECTION,
    now: CUTOFF + 1000,
  });
  assert.equal(recover.status, 200);
  assert.equal(recover.body.luckyCode, claimed.body.luckyCode);
  // …but a NEW participant gets none — while their blessing is still accepted
  const late = await bless(db, onsite, { idempotencyKey: "late-bless-1", now: CUTOFF + 2000 });
  assert.equal(late.status, 200);
  const lateClaim = await claimLuckyCode({
    db,
    body: { token: onsite.token, participantToken: late.body.participantToken },
    giftCollection: GIFT_COLLECTION,
    now: CUTOFF + 3000,
  });
  assert.equal(lateClaim.status, 409);
  assert.equal(lateClaim.body.error, "draw_closed");
});

test("eligibility requires a blessing; draw must exist+enabled+open", async () => {
  const db = makeFakeDb();
  await seedWedding(db);
  const onsite = await seedOnsite(db);
  const noDraw = await claimLuckyCode({
    db,
    body: { token: onsite.token, participantToken: "p".repeat(22) },
    giftCollection: GIFT_COLLECTION,
    now: START + 1,
  });
  assert.equal(noDraw.status, 409);
  assert.equal(noDraw.body.error, "draw_not_open");

  await seedDraw(db, { open: false }); // configured draft, never opened
  const draft = await claimLuckyCode({
    db,
    body: { token: onsite.token, participantToken: "p".repeat(22) },
    giftCollection: GIFT_COLLECTION,
    now: START + 1,
  });
  assert.equal(draft.status, 409);

  await openDraw({ db, decoded: OWNER, body: { eventId: "ev-wed-1" }, now: T0 });
  const noBlessing = await claimLuckyCode({
    db,
    body: { token: onsite.token, participantToken: "p".repeat(22) },
    giftCollection: GIFT_COLLECTION,
    now: START + 1,
  });
  assert.equal(noBlessing.status, 403);
  assert.equal(noBlessing.body.error, "not_eligible");
});

test("concurrent duplicate claim loses the race and recovers the committed code", async () => {
  const db = makeFakeDb({ raceOn: ENTRANT_COLLECTION });
  await seedWedding(db);
  const onsite = await seedOnsite(db);
  await seedDraw(db);
  const b = await bless(db, onsite, { idempotencyKey: "race-key-01", now: T0 + 1000 });
  const res = await claimLuckyCode({
    db,
    body: { token: onsite.token, participantToken: b.body.participantToken },
    giftCollection: GIFT_COLLECTION,
    now: START + 1,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.luckyCode, "111222"); // the concurrently-committed code wins
  assert.equal(res.body.alreadyClaimed, true);
});

// --- Draw configuration / state foundation ----------------------------------

test("configure validates window and prizes; lock freezes; reconfigure after lock refused", async () => {
  const db = makeFakeDb();
  await seedWedding(db);
  const onsite = await seedOnsite(db);

  const badOrder = await configureDraw({
    db,
    decoded: OWNER,
    body: { eventId: "ev-wed-1", enabled: true, startAt: CUTOFF, cutoffAt: START, prizes: { third: "a", second: "b", first: "c" } },
    now: T0,
  });
  assert.equal(badOrder.status, 400);
  assert.equal(badOrder.body.error, "invalid_window");
  const noPrize = await configureDraw({
    db,
    decoded: OWNER,
    body: { eventId: "ev-wed-1", enabled: true, startAt: START, cutoffAt: CUTOFF, prizes: { third: "a", second: "b" } },
    now: T0,
  });
  assert.equal(noPrize.status, 400);
  assert.equal(noPrize.body.error, "invalid_prize");

  await seedDraw(db);
  // lock too early
  const early = await lockDraw({ db, decoded: OWNER, body: { eventId: "ev-wed-1" }, now: CUTOFF - 1 });
  assert.equal(early.status, 409);
  assert.equal(early.body.error, "lock_too_early");
  // participants before cutoff
  const b1 = await bless(db, onsite, { idempotencyKey: "lock-key-0001", now: T0 + 1000 });
  await claimLuckyCode({
    db,
    body: { token: onsite.token, participantToken: b1.body.participantToken },
    giftCollection: GIFT_COLLECTION,
    now: START + 5,
  });
  const locked = await lockDraw({ db, decoded: OWNER, body: { eventId: "ev-wed-1" }, now: CUTOFF + 1 });
  assert.equal(locked.status, 200);
  assert.equal(locked.body.entrantCount, 1);
  assert.ok(locked.body.batchId);
  // idempotent relock echoes the committed snapshot
  const relock = await lockDraw({ db, decoded: OWNER, body: { eventId: "ev-wed-1" }, now: CUTOFF + 60_000 });
  assert.equal(relock.status, 200);
  assert.equal(relock.body.batchId, locked.body.batchId);
  // reconfigure refused post-lock
  const reconf = await configureDraw({
    db,
    decoded: OWNER,
    body: { eventId: "ev-wed-1", enabled: true, startAt: START, cutoffAt: CUTOFF + 9, prizes: { third: "a", second: "b", first: "c" } },
    now: CUTOFF + 2,
  });
  assert.equal(reconf.status, 409);
  assert.equal(reconf.body.error, "draw_locked");
  // guest-facing claimable goes false after lock (status no longer open)
  const view = await retrieveGift({ db, body: { token: onsite.token }, now: CUTOFF + 3 });
  assert.equal(view.body.onSite.draw.claimable, false);
});

// --- Lifecycle ---------------------------------------------------------------

test("lottery records carry the 3h expiry; guestbook records never do", async () => {
  const db = makeFakeDb();
  await seedWedding(db);
  const onsite = await seedOnsite(db);
  await seedDraw(db);
  const b = await bless(db, onsite, { idempotencyKey: "ttl-key-0001", now: T0 + 1000 });
  await claimLuckyCode({
    db,
    body: { token: onsite.token, participantToken: b.body.participantToken },
    giftCollection: GIFT_COLLECTION,
    now: START + 1,
  });
  const entrant = [...db._store.entries()].find(([k]) => k.startsWith(`${ENTRANT_COLLECTION}/`))[1];
  assert.equal(entrant.expireAt, CUTOFF + LOTTERY_LINGER_MS);
  const draw = db._store.get(`${DRAW_COLLECTION}/ev-wed-1`);
  assert.equal(draw.expireAt, CUTOFF + LOTTERY_LINGER_MS);
  const gb = [...db._store.entries()].find(([k]) => k.startsWith(`${GUESTBOOK_COLLECTION}/`))[1];
  assert.equal(gb.expireAt, undefined);
  assert.equal(gb.allowLiveDisplay, false);

  // read-gate: past expiry the lottery surface answers as absent/closed
  const after = T0 + 100 * 60 * 60 * 1000;
  const detail = await onsiteDetail({
    db,
    decoded: OWNER,
    body: { eventId: "ev-wed-1" },
    giftCollection: GIFT_COLLECTION,
    now: after,
  });
  assert.equal(detail.body.draw, null);
  assert.equal(detail.body.guestbookCount, 1); // blessings survive the lottery clock
});

// --- Regression: existing systems untouched ---------------------------------

test("ordinary Wedding Invitation/RSVP and Library/EventDetail unchanged around on_site", async () => {
  const db = makeFakeDb();
  const eventId = await seedWedding(db);
  const onsite = await seedOnsite(db);
  // a real recipient-specific invitation on the same event
  const inv = await createGift({
    db,
    decoded: OWNER,
    body: {
      message: "请柬",
      occasion: { type: "wedding", version: 1, couple: { partner1: "冯志俊", partner2: "吴姗姗" }, date: "2026-10-01", time: { start: "17:00" }, venue: { displayName: "杭州世纪皇冠大酒店" }, inviter: "冯志俊 与 吴姗姗", audienceType: "friends" },
      eventId,
      recipientLabel: "张先生全家",
    },
    share: fakeShare(),
    now: T0 + 10,
  });
  assert.equal(inv.status, 200);
  const rsvp = await rsvpGift({
    db,
    body: { token: inv.body.token, status: "accepted", adultCount: 2, childCount: 1 },
    now: T0 + 20,
  });
  assert.equal(rsvp.status, 200);

  const detail = await eventDetail({
    db,
    decoded: OWNER,
    body: { eventId },
    giftCollection: GIFT_COLLECTION,
    now: T0 + 30,
  });
  assert.equal(detail.status, 200);
  // the on_site record appears neither as an invitation row nor in aggregates
  assert.equal(detail.body.invitations.length, 1);
  assert.equal(detail.body.invitations[0].recipientLabel, "张先生全家");
  assert.equal(detail.body.aggregate.acceptedGroups, 1);
  assert.equal(detail.body.aggregate.pendingGroups, 0);
  assert.equal(detail.body.aggregate.adultTotal, 2);

  const lib = await senderLibrary({ db, decoded: OWNER, giftCollection: GIFT_COLLECTION, now: T0 + 40 });
  assert.ok(lib.body.gifts.every((g) => g.giftId !== onsite.giftId));

  // ordinary gift retrieve payload carries no on-site fields
  const gift = await createGift({ db, decoded: OWNER, body: { message: "普通心意", accessMode: "direct" }, now: T0 + 50 });
  const got = await retrieveGift({ db, body: { token: gift.body.token }, now: T0 + 60 });
  assert.equal(got.status, 200);
  assert.equal(got.body.contextRole, undefined);
  assert.equal(got.body.onSite, undefined);
});

// --- WD-2: presentation reuse ------------------------------------------------

test("createOnsite reuses the Event invitation photo via fromGiftId (same-Event rules)", async () => {
  const db = makeFakeDb();
  const eventId = await seedWedding(db);
  // seed a sealed invitation with a photo fragment (source of reuse)
  const srcId = "src-invitation-hash";
  await db.collection(GIFT_COLLECTION).doc(srcId).set({
    schemaVersion: 1,
    senderUid: OWNER.uid,
    eventId,
    revoked: false,
    presentation: { photo: { assetId: "asset-1", contentType: "image/jpeg", bytes: 2048 } },
  });
  const objects = new Map([["sealed/src-invitation-hash/asset-1", { bytes: Buffer.alloc(8) }]]);
  const media = {
    async copySealedToSealed({ srcTokenHash, assetId, destTokenHash }) {
      const o = objects.get(`sealed/${srcTokenHash}/${assetId}`);
      if (!o) throw new Error("missing source object");
      objects.set(`sealed/${destTokenHash}/${assetId}`, o);
    },
    async deleteSealed({ tokenHash, assetId }) {
      objects.delete(`sealed/${tokenHash}/${assetId}`);
    },
    async presignSealedGet({ tokenHash, assetId }) {
      return `https://media.example/sealed/${tokenHash}/${assetId}?sig=test`;
    },
  };
  const res = await createOnsite({
    db,
    decoded: OWNER,
    body: {
      eventId,
      message: "谢谢你今天真的来到这里。",
      presentation: { photo: { fromGiftId: srcId }, musicThemeId: "wedding_warm_piano_v1" },
    },
    share: fakeShare(),
    media,
    giftCollection: GIFT_COLLECTION,
    publicBaseUrl: "https://gift.example",
    now: T0,
  });
  assert.equal(res.status, 200);
  const rec = db._store.get(`${GIFT_COLLECTION}/${res.body.giftId}`);
  assert.equal(rec.presentation.photo.assetId, "asset-1");
  assert.equal(rec.presentation.musicThemeId, "wedding_warm_piano_v1");
  assert.ok(objects.has(`sealed/${res.body.giftId}/asset-1`)); // sealed→sealed copy landed
  // retrieve serves the presentation to guests
  const got = await retrieveGift({ db, body: { token: res.body.token }, media, now: T0 + 5 });
  assert.equal(got.status, 200);
  assert.equal(got.body.contextRole, "on_site");
  assert.ok(got.body.presentation?.photo?.url?.includes(res.body.giftId));
  // cross-sender reuse refused
  await db.collection(GIFT_COLLECTION).doc("foreign-src").set({
    senderUid: STRANGER.uid,
    eventId,
    revoked: false,
    presentation: { photo: { assetId: "x" } },
  });
  await db.collection(GIFT_COLLECTION).doc(res.body.giftId).update({ revoked: true });
  const stolen = await createOnsite({
    db,
    decoded: OWNER,
    body: { eventId, message: "hi", presentation: { photo: { fromGiftId: "foreign-src" } } },
    share: fakeShare(),
    media,
    giftCollection: GIFT_COLLECTION,
    publicBaseUrl: "https://gift.example",
    now: T0 + 10,
  });
  assert.equal(stolen.status, 403);
});

// --- WD-3A: frozen entrant list / host read-only code view -------------------

test("entrants view: sender-only, cross-account forbidden, guest impossible", async () => {
  const db = makeFakeDb();
  await seedWedding(db);
  await seedOnsite(db);
  await seedDraw(db);
  assert.equal((await listEntrants({ db, decoded: null, body: { eventId: "ev-wed-1" }, now: T0 })).status, 401);
  assert.equal((await listEntrants({ db, decoded: STRANGER, body: { eventId: "ev-wed-1" }, now: T0 })).status, 403);
  // guest-facing surfaces never carry the pool: retrieve exposes no codes list
  const onsite = await seedOnsite(db);
  const got = await retrieveGift({ db, body: { token: (await seedOnsite(db)).token ?? onsite.token }, now: T0 });
  assert.equal(JSON.stringify(got.body).includes('"codes"'), false);
});

test("entrants view: live list before cutoff, count === list size, codes only", async () => {
  const db = makeFakeDb();
  await seedWedding(db);
  const onsite = await seedOnsite(db);
  await seedDraw(db);
  for (const key of ["ent-key-0001", "ent-key-0002", "ent-key-0003"]) {
    const bl = await bless(db, onsite, { idempotencyKey: key, now: T0 + 1000 });
    await claimLuckyCode({
      db,
      body: { token: onsite.token, participantToken: bl.body.participantToken },
      giftCollection: GIFT_COLLECTION,
      now: START + 1000,
    });
  }
  const res = await listEntrants({ db, decoded: OWNER, body: { eventId: "ev-wed-1" }, now: START + 2000 });
  assert.equal(res.status, 200);
  assert.equal(res.body.locked, false);
  assert.equal(res.body.status, "open");
  assert.equal(res.body.count, 3);
  assert.equal(res.body.codes.length, res.body.count);
  for (const c of res.body.codes) assert.match(c, /^\d{6}$/);
  // leakage scan: nothing beyond the declared contract, no identity material
  const raw = JSON.stringify(res.body);
  assert.equal(/[0-9a-f]{40,}/.test(raw), false); // no hashes
  assert.equal(raw.includes("participant"), false);
  assert.equal(raw.includes("displayName"), false);
  assert.equal(raw.includes("text"), false);
  // stability on refresh: identical list, identical order
  const again = await listEntrants({ db, decoded: OWNER, body: { eventId: "ev-wed-1" }, now: START + 3000 });
  assert.deepEqual(again.body.codes, res.body.codes);
});

test("entrants view: first post-cutoff read lazily locks — frozen total, idempotent", async () => {
  const db = makeFakeDb();
  await seedWedding(db);
  const onsite = await seedOnsite(db);
  await seedDraw(db);
  const bl = await bless(db, onsite, { idempotencyKey: "frz-key-0001", now: T0 + 1000 });
  await claimLuckyCode({
    db,
    body: { token: onsite.token, participantToken: bl.body.participantToken },
    giftCollection: GIFT_COLLECTION,
    now: START + 1,
  });
  const res = await listEntrants({ db, decoded: OWNER, body: { eventId: "ev-wed-1" }, now: CUTOFF + 1000 });
  assert.equal(res.body.locked, true);
  assert.equal(res.body.status, "locked");
  assert.equal(res.body.entrantCount, 1);
  assert.ok(res.body.batchId);
  // draw doc committed the freeze
  assert.equal(db._store.get(`${DRAW_COLLECTION}/ev-wed-1`).status, "locked");
  // repeat read recovers the SAME committed state (host refresh)
  const again = await listEntrants({ db, decoded: OWNER, body: { eventId: "ev-wed-1" }, now: CUTOFF + 9000 });
  assert.equal(again.body.batchId, res.body.batchId);
  assert.deepEqual(again.body.codes, res.body.codes);
  // post-lock claims stay impossible (existing gate — belt and braces here)
  const late = await bless(db, onsite, { idempotencyKey: "frz-key-0002", now: CUTOFF + 2000 });
  const claim = await claimLuckyCode({
    db,
    body: { token: onsite.token, participantToken: late.body.participantToken },
    giftCollection: GIFT_COLLECTION,
    now: CUTOFF + 3000,
  });
  assert.equal(claim.status, 409);
});

test("entrants view: 3-hour lifecycle keeps codes unreachable after expiry", async () => {
  const db = makeFakeDb();
  await seedWedding(db);
  const onsite = await seedOnsite(db);
  await seedDraw(db);
  const bl = await bless(db, onsite, { idempotencyKey: "ttl-ent-0001", now: T0 + 1000 });
  await claimLuckyCode({
    db,
    body: { token: onsite.token, participantToken: bl.body.participantToken },
    giftCollection: GIFT_COLLECTION,
    now: START + 1,
  });
  const res = await listEntrants({ db, decoded: OWNER, body: { eventId: "ev-wed-1" }, now: CUTOFF + LOTTERY_LINGER_MS + 1 });
  assert.equal(res.status, 404);
});

// --- WD-3B: server-authoritative winner selection ----------------------------

async function seedPool(db, count, { open = true } = {}) {
  const onsite = await seedOnsite(db);
  await seedDraw(db, { open });
  const tokens = [];
  for (let i = 0; i < count; i += 1) {
    const bl = await bless(db, onsite, { idempotencyKey: `pool-key-${String(i).padStart(4, "0")}`, now: T0 + 1000 + i });
    await claimLuckyCode({
      db,
      body: { token: onsite.token, participantToken: bl.body.participantToken },
      giftCollection: GIFT_COLLECTION,
      now: START + 1000 + i,
    });
    tokens.push(bl.body.participantToken);
  }
  return { onsite, tokens };
}
const lock = (db) => lockDraw({ db, decoded: OWNER, body: { eventId: "ev-wed-1" }, now: CUTOFF + 1 });
const draw = (db, tier, now = CUTOFF + 5000) => drawWinner({ db, decoded: OWNER, body: { eventId: "ev-wed-1", tier }, now });

test("draw requires lock; auth boundaries hold", async () => {
  const db = makeFakeDb();
  await seedWedding(db);
  await seedPool(db, 2);
  assert.equal((await draw(db, 3, START + 5000)).status, 409); // still open → not locked
  assert.equal((await draw(db, 3, START + 5000)).body.error, "draw_not_locked");
  await lock(db);
  assert.equal((await drawWinner({ db, decoded: null, body: { eventId: "ev-wed-1", tier: 3 } })).status, 401);
  assert.equal((await drawWinner({ db, decoded: STRANGER, body: { eventId: "ev-wed-1", tier: 3 } })).status, 403);
  assert.equal((await draw(db, 9)).status, 400);
});

test("full ceremony: 3→2→1, exclusion, one prize each, completed state", async () => {
  const db = makeFakeDb();
  await seedWedding(db);
  await seedPool(db, 5);
  await lock(db);
  // order enforced: cannot skip to 一等奖
  const skip = await draw(db, 1);
  assert.equal(skip.status, 409);
  assert.equal(skip.body.error, "draw_out_of_order");
  assert.equal(skip.body.nextTier, 3);

  const third = await draw(db, 3);
  assert.equal(third.status, 200);
  assert.match(third.body.luckyCode, /^\d{6}$/);
  assert.equal(third.body.status, "drawing");
  // repeat same tier → same committed winner, alreadyDrawn
  const replay = await draw(db, 3, CUTOFF + 9000);
  assert.equal(replay.body.luckyCode, third.body.luckyCode);
  assert.equal(replay.body.alreadyDrawn, true);

  const second = await draw(db, 2);
  const first = await draw(db, 1);
  const codes = [third.body.luckyCode, second.body.luckyCode, first.body.luckyCode];
  assert.equal(new Set(codes).size, 3); // one participant, one prize — no repeats
  assert.equal(first.body.status, "completed");

  const drawDoc = db._store.get(`${DRAW_COLLECTION}/ev-wed-1`);
  assert.equal(drawDoc.status, "completed");
  assert.equal(typeof drawDoc.completedAt, "number");
  // AA-2 re-anchor: results (and entrants) live to completedAt + 3h
  assert.equal(drawDoc.expireAt, drawDoc.completedAt + LOTTERY_LINGER_MS);
  const entrants = [...db._store.entries()].filter(([k]) => k.startsWith(`${ENTRANT_COLLECTION}/`));
  assert.equal(entrants.length, 5);
  for (const [, e] of entrants) assert.equal(e.expireAt, drawDoc.completedAt + LOTTERY_LINGER_MS);
  assert.equal(entrants.filter(([, e]) => e.status === "won").length, 3);
  // refresh recovery: detail returns all three committed winners
  const det = await onsiteDetail({ db, decoded: OWNER, body: { eventId: "ev-wed-1" }, giftCollection: GIFT_COLLECTION, now: CUTOFF + 20000 });
  assert.deepEqual(det.body.draw.winners.map((w) => w.luckyCode), codes);
});

test("transaction conflict retries converge on ONE committed winner", async () => {
  const db = makeFakeDb();
  await seedWedding(db);
  await seedPool(db, 4);
  await lock(db);
  db._injectTxConflicts(2); // two aborted attempts before the commit
  const third = await draw(db, 3);
  assert.equal(third.status, 200);
  const wonCount = [...db._store.entries()].filter(([k, v]) => k.startsWith(`${ENTRANT_COLLECTION}/`) && v.status === "won").length;
  assert.equal(wonCount, 1); // aborted attempts left no side effects
  const replay = await draw(db, 3);
  assert.equal(replay.body.luckyCode, third.body.luckyCode);
});

test("insufficient entrants: refused honestly, never duplicated or fabricated", async () => {
  const db = makeFakeDb();
  await seedWedding(db);
  await seedPool(db, 2); // two entrants, three tiers
  await lock(db);
  const third = await draw(db, 3);
  const second = await draw(db, 2);
  assert.notEqual(third.body.luckyCode, second.body.luckyCode);
  const first = await draw(db, 1);
  assert.equal(first.status, 409);
  assert.equal(first.body.error, "insufficient_entrants");
  // state remains drawing (not completed), committed winners untouched
  const drawDoc = db._store.get(`${DRAW_COLLECTION}/ev-wed-1`);
  assert.equal(drawDoc.status, "drawing");
  assert.equal(drawDoc.winners.length, 2);
  // zero-pool case: fresh event with no claims at all
  const db2 = makeFakeDb();
  await seedWedding(db2);
  await seedPool(db2, 0);
  await lockDraw({ db: db2, decoded: OWNER, body: { eventId: "ev-wed-1" }, now: CUTOFF + 1 });
  const none = await drawWinner({ db: db2, decoded: OWNER, body: { eventId: "ev-wed-1", tier: 3 }, now: CUTOFF + 2 });
  assert.equal(none.body.error, "insufficient_entrants");
});
