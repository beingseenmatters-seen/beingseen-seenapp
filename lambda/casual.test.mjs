/**
 * Casual Gathering V1 (轻松相聚) — the engine's LIGHTEST Occasion.
 *
 * Properties under test: casual is stored as ITS OWN Event type over the same
 * rails (never a Wedding), carries the smallest facts contract (context +
 * title + when + where, three optional lines), keeps the one-tap RSVP
 * contract (参加/这次不行 — TWO choices; 'maybe' was removed 2026-08-27 and is
 * refused everywhere, while LEGACY stored maybes stay readable and count 0),
 * and reuses distribution's general-wording fallback like Birthday/Business.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGift, retrieveGift, rsvpGift, GIFT_COLLECTION } from "./gift.mjs";
import { createEvent, eventDetail, upsertGuest, saveVariant } from "./event.mjs";
import { distributeInvitations } from "./distribute.mjs";
import { sharedResponsesForEvent } from "./sharedRsvp.mjs";
import {
  validateCasualFacts,
  validateOccasion,
  audiencesForEventType,
  variantKeysForEventType,
  CASUAL_CONTEXTS,
  CASUAL_AUDIENCES,
  WEDDING_AUDIENCES,
  INVITATION_EVENT_TYPES,
} from "./occasion.mjs";

const A = { uid: "host-1" };
const fakeShare = () => ({ seal: async (t) => `sealed:${t}`, open: async (x) => String(x).replace(/^sealed:/, "") });

function cFacts(overrides = {}) {
  return {
    context: "meal",
    eventTitle: "周五晚饭",
    date: "2026-12-05",
    time: { start: "19:00" },
    venue: { displayName: "老地方川菜馆" },
    audienceType: "friends",
    ...overrides,
  };
}
const cOccasion = (extra = {}) => ({ type: "casual", version: 1, ...cFacts(), ...extra });

function makeFakeDb() {
  const store = new Map();
  const doc = (path) => ({
    get: async () => ({ exists: store.has(path), data: () => store.get(path), id: path.split("/").pop() }),
    set: async (v) => { store.set(path, v); },
    update: async (v) => { store.set(path, { ...store.get(path), ...v }); },
    delete: async () => { store.delete(path); },
  });
  const collection = (name) => ({
    doc: (id) => doc(`${name}/${id}`),
    where: (field, _op, value) => ({
      get: async () => ({
        docs: [...store.entries()].filter(([k, v]) => k.startsWith(`${name}/`) && v[field] === value)
          .map(([k, v]) => ({ id: k.split("/").pop(), data: () => v })),
      }),
    }),
    get: async () => ({
      docs: [...store.entries()].filter(([k]) => k.startsWith(`${name}/`))
        .map(([k, v]) => ({ id: k.split("/").pop(), data: () => v })),
    }),
  });
  return { collection, _store: store };
}

// --- Facts: the smallest contract --------------------------------------------

test("casual facts: minimal contract accepted, canonicalised with null optionals", () => {
  const res = validateCasualFacts(cFacts());
  assert.equal(res.ok, true);
  assert.deepEqual(res.facts, {
    context: "meal", eventTitle: "周五晚饭", date: "2026-12-05",
    time: { start: "19:00", end: null },
    venue: { displayName: "老地方川菜馆", formattedAddress: null },
    inviter: null, note: null, audienceType: "friends",
  });
  // No Wedding/Business field survives into the canonical shape.
  for (const k of ["couple", "culture", "dressCode", "materials", "rsvpDeadline", "registryUrl", "host", "birthdayPersonName"]) {
    assert.equal(k in res.facts, false, `${k} must not exist on casual facts`);
  }
});

test("casual facts: required fields + vocabulary enforced", () => {
  assert.equal(validateCasualFacts(cFacts({ context: "banquet" })).field, "context");
  assert.equal(validateCasualFacts(cFacts({ eventTitle: "" })).field, "eventTitle");
  assert.equal(validateCasualFacts(cFacts({ date: "2026-13-40" })).field, "date");
  assert.equal(validateCasualFacts(cFacts({ time: { start: "25:00" } })).field, "time.start");
  assert.equal(validateCasualFacts(cFacts({ venue: {} })).field, "venue.displayName");
  // Wedding audience vocabulary refused; casual's own accepted.
  assert.equal(validateCasualFacts(cFacts({ audienceType: "elders" })).field, "audienceType");
  assert.equal(validateCasualFacts(cFacts({ audienceType: "colleagues" })).ok, true);
  // Optional note is capped (300).
  assert.equal(validateCasualFacts(cFacts({ note: "x".repeat(301) })).field, "note");
  assert.equal(validateCasualFacts(cFacts({ note: "地铁2号线C口出" })).facts.note, "地铁2号线C口出");
  // All three contexts are valid.
  for (const c of CASUAL_CONTEXTS) assert.equal(validateCasualFacts(cFacts({ context: c })).ok, true, c);
});

test("vocabularies stay apart; casual is a first-class invitation event type", () => {
  assert.deepEqual(audiencesForEventType("casual"), CASUAL_AUDIENCES);
  assert.notDeepEqual(audiencesForEventType("casual"), WEDDING_AUDIENCES);
  assert.equal(variantKeysForEventType("casual").includes("general"), true);
  assert.equal(INVITATION_EVENT_TYPES.includes("casual"), true);
});

test("fail-closed: unknown casual version refused at the seal door", () => {
  assert.equal(validateOccasion(cOccasion({ version: 2 })).ok, false);
  assert.equal(validateOccasion(cOccasion()).ok, true);
  assert.equal(validateOccasion(cOccasion()).occasion.type, "casual");
});

// --- Seal → Event → open -----------------------------------------------------

test("a casual seal creates an Event stored as type 'casual'; occasion round-trips", async () => {
  const db = makeFakeDb();
  const res = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "来吃饭！", occasion: cOccasion(), eventCreate: true, recipientLabel: "朋友们" },
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.accessMode, "direct"); // occasion default — effortless open
  const ev = db._store.get(`events/${res.body.eventId}`);
  assert.equal(ev.type, "casual");
  assert.equal(ev.occasion.context, "meal");

  const opened = await retrieveGift({ db, body: { token: res.body.token }, now: 2000 });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.occasion.type, "casual");
  assert.equal(opened.body.occasion.eventTitle, "周五晚饭");
  assert.equal(opened.body.occasion.venue.displayName, "老地方川菜馆");
  assert.equal(opened.body.recipientLabel, "朋友们");
});

// --- RSVP: canonical binary held --------------------------------------------

test("Casual RSVP: 参加/这次不行 — TWO choices, one tap, no counts, no dietary", async () => {
  const db = makeFakeDb();
  const g = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "喝一杯?", occasion: cOccasion({ context: "drinks" }), eventCreate: true, recipientLabel: "同事们" },
  });
  const eventId = g.body.eventId;

  // 参加 — a bare one-tap accept: no counts sent, none stored, group counted.
  const yes = await rsvpGift({ db, body: { token: g.body.token, key: "", status: "accepted" } });
  assert.equal(yes.status, 200);
  const rec = [...db._store.values()].find((v) => v.rsvpStatus);
  assert.equal(rec.rsvpStatus, "accepted");
  assert.equal(rec.rsvpAdultCount, null);
  let detail = await eventDetail({ db, decoded: A, body: { eventId }, giftCollection: GIFT_COLLECTION, sharedResponses: sharedResponsesForEvent });
  assert.equal(detail.body.event.type, "casual");
  assert.equal(detail.body.aggregate.acceptedGroups, 1);
  assert.equal(detail.body.aggregate.attendingTotal, 1); // CASUAL RULE: 1 accepted = 1 attendee

  // 这次不行 — decline zeroes.
  const no = await rsvpGift({ db, body: { token: g.body.token, key: "", status: "declined" } });
  assert.equal(no.status, 200);
  detail = await eventDetail({ db, decoded: A, body: { eventId }, giftCollection: GIFT_COLLECTION, sharedResponses: sharedResponsesForEvent });
  assert.equal(detail.body.aggregate.declinedGroups, 1);
  assert.equal(detail.body.aggregate.attendingTotal, 0);
});

test("'maybe' is refused EVERYWHERE — the binary contract is universal again", async () => {
  const db = makeFakeDb();
  // An ordinary gift (no occasion) refuses maybe — as always.
  const plain = await createGift({ db, decoded: A, body: { message: "hi", accessMode: "direct" } });
  const r1 = await rsvpGift({ db, body: { token: plain.body.token, key: "", status: "maybe" } });
  assert.equal(r1.status, 400);
  // A CASUAL gift now refuses it too (Founder, 2026-08-27) — no new maybe
  // can be written by anyone; legacy stored ones are covered below.
  const cg = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "聚!", occasion: cOccasion(), eventCreate: true, recipientLabel: "朋友们" },
  });
  const r2 = await rsvpGift({ db, body: { token: cg.body.token, key: "", status: "maybe" } });
  assert.equal(r2.status, 400);
  // And a shared casual link refuses it at the per-scanner door as well.
  const shared = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "聚!", occasion: cOccasion(), eventCreate: true, recipientLabel: "群聊", sharedDistribution: true, accessMode: "direct" },
  });
  const r3 = await rsvpGift({ db, body: { token: shared.body.token, key: "", status: "maybe" } });
  assert.equal(r3.status, 400);
});

// --- Distribution: general fallback (the distribute.mjs type-literal fix) ----

test("distribution: a casual guest without a saved variant falls back to the general wording", async () => {
  const db = makeFakeDb();
  const ev = await createEvent({ db, decoded: A, body: { occasion: cOccasion({ context: "get_together" }) }, validateOccasion });
  assert.equal(ev.status, 200);
  const eventId = ev.body.eventId;

  // Wedding vocabulary refused on a casual Event's guests; casual accepted.
  const bad = await upsertGuest({ db, decoded: A, body: { eventId, label: "老王", relationshipType: "elders" }, giftCollection: GIFT_COLLECTION });
  assert.equal(bad.status, 400);
  const guest = await upsertGuest({ db, decoded: A, body: { eventId, label: "老王", relationshipType: "friends" }, giftCollection: GIFT_COLLECTION });
  assert.equal(guest.status, 200);

  // Only the GENERAL wording is saved — the friends guest must fall back to it.
  const v = await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "general", message: "找个时间聚一聚吧。周六下午，老地方。" }, giftCollection: GIFT_COLLECTION });
  assert.equal(v.status, 200);

  const dist = await distributeInvitations({
    db, decoded: A, share: fakeShare(), giftCollection: GIFT_COLLECTION,
    body: { eventId, guestIds: [guest.body.guestId] },
  });
  assert.equal(dist.status, 200);
  assert.equal(dist.body.results[0].status, "created");
});

// --- Music: existing allowlist serves casual with zero backend change --------

test("a casual gift may carry an allowlisted music theme (no new backend gate)", async () => {
  const db = makeFakeDb();
  const res = await createGift({
    db, decoded: A, share: fakeShare(), media: {},
    body: {
      message: "举杯!", occasion: cOccasion({ context: "drinks" }), eventCreate: true, recipientLabel: "朋友们",
      presentation: { musicThemeId: "wedding_warm_piano_v1" },
    },
  });
  assert.equal(res.status, 200);
  const rec = db._store.get(`${GIFT_COLLECTION}/${[...db._store.keys()].find((k) => k.startsWith(`${GIFT_COLLECTION}/`))?.split("/").pop()}`);
  assert.equal(rec.presentation.musicThemeId, "wedding_warm_piano_v1");
});

// --- CASUAL ATTENDANCE RULE: one ACCEPTED response = 1 attendee --------------

/** One casual Event with a shared link; returns { db, eventId, token }. */
async function casualSharedEvent(context = "get_together") {
  const db = makeFakeDb();
  const g = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "聚!", occasion: cOccasion({ context }), eventCreate: true,
            recipientLabel: "群聊", sharedDistribution: true, accessMode: "direct" },
  });
  return { db, eventId: g.body.eventId, token: g.body.token };
}
const casualDetail = (db, eventId) =>
  eventDetail({ db, decoded: A, body: { eventId }, giftCollection: GIFT_COLLECTION, sharedResponses: sharedResponsesForEvent });

test("casual attendance: 0 responses → expected 0", async () => {
  const { db, eventId } = await casualSharedEvent();
  const d = await casualDetail(db, eventId);
  assert.equal(d.body.aggregate.attendingTotal, 0);
  assert.equal(d.body.sharedAggregate.replies, 0);
});

test("casual attendance: 1 and 2 attending → expected 1 and 2 (self-reported shared)", async () => {
  const { db, eventId, token } = await casualSharedEvent();
  await rsvpGift({ db, body: { token, key: "", status: "accepted" } });
  let d = await casualDetail(db, eventId);
  assert.equal(d.body.aggregate.attendingTotal, 1);
  assert.equal(d.body.sharedAggregate.attendingTotal, 1);

  await rsvpGift({ db, body: { token, key: "", status: "accepted" } }); // second scanner (new identity)
  d = await casualDetail(db, eventId);
  assert.equal(d.body.aggregate.attendingTotal, 2);       // ← the production case: 2 replies, 2 attending
  assert.equal(d.body.sharedAggregate.replies, 2);
  assert.equal(d.body.sharedAggregate.attendingTotal, 2);
});

test("casual attendance: 2 attending + 1 declined → expected 2, for ALL THREE contexts", async () => {
  for (const context of ["get_together", "meal", "drinks"]) {
    const { db, eventId, token } = await casualSharedEvent(context);
    for (const s of ["accepted", "accepted", "declined"]) {
      const r = await rsvpGift({ db, body: { token, key: "", status: s } });
      assert.equal(r.status, 200, context);
    }
    const d = await casualDetail(db, eventId);
    assert.equal(d.body.aggregate.attendingTotal, 2, context); // deterministic: accepted=1 each, declined=0
    assert.equal(d.body.sharedAggregate.replies, 3, context);
    assert.equal(d.body.sharedAggregate.accepted, 2, context);
    assert.equal(d.body.sharedAggregate.declined, 1, context);
  }
});

test("LEGACY 'maybe' records: kept, readable, and counted 0 — never deleted", async () => {
  const { db, eventId, token } = await casualSharedEvent();
  await rsvpGift({ db, body: { token, key: "", status: "accepted" } });
  // A response stored while 'maybe' briefly existed (2026-08-23 → 08-27).
  // Seeded directly — the API refuses new ones — exactly as it sits in prod.
  const giftDocId = [...db._store.keys()].find((k) => k.startsWith(`${GIFT_COLLECTION}/`)).split("/").pop();
  db._store.set(`sharedRsvp/${giftDocId}_legacymaybe`, {
    schemaVersion: 1, giftId: giftDocId, eventId, participantIdHash: "legacymaybe",
    status: "maybe", adultCount: null, childCount: null,
    createdAt: 1000, updatedAt: 1000, expiresAt: null,
  });
  const d = await casualDetail(db, eventId);
  assert.equal(d.body.sharedAggregate.replies, 2);        // still visible in the record list…
  assert.equal(d.body.aggregate.attendingTotal, 1);       // …but NEVER expected attendance
  assert.equal(d.body.sharedAggregate.accepted, 1);
  const legacy = d.body.sharedResponses.find((r) => r.status === "maybe");
  assert.ok(legacy);                                      // readable in old records
});

test("casual attendance: changing an answer moves the count BOTH directions, never twice", async () => {
  const { db, eventId, token } = await casualSharedEvent();
  // Attending → Can't make it must DECREMENT (same participant identity).
  const first = await rsvpGift({ db, body: { token, key: "", status: "accepted" } });
  const pt = first.body.participantToken;
  assert.ok(pt);
  let d = await casualDetail(db, eventId);
  assert.equal(d.body.aggregate.attendingTotal, 1);
  await rsvpGift({ db, body: { token, key: "", participantToken: pt, status: "declined" } });
  d = await casualDetail(db, eventId);
  assert.equal(d.body.sharedAggregate.replies, 1);        // one identity, one response
  assert.equal(d.body.aggregate.attendingTotal, 0);       // decremented
  assert.equal(d.body.sharedAggregate.declined, 1);
  // Can't make it → Attending must INCREMENT back.
  await rsvpGift({ db, body: { token, key: "", participantToken: pt, status: "accepted" } });
  d = await casualDetail(db, eventId);
  assert.equal(d.body.aggregate.attendingTotal, 1);
  assert.equal(d.body.sharedAggregate.declined, 0);

  // Managed invitation: accepted → accepted → still exactly 1.
  const managed = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "聚!", occasion: cOccasion({ context: "get_together" }), eventId, recipientLabel: "老王" },
  });
  await rsvpGift({ db, body: { token: managed.body.token, key: "", status: "accepted" } });
  await rsvpGift({ db, body: { token: managed.body.token, key: "", status: "accepted" } });
  d = await casualDetail(db, eventId);
  assert.equal(d.body.aggregate.attendingTotal, 2);       // managed 1 + shared 1
  assert.equal(d.body.aggregate.managed.attendingTotal, 1);
});

test("casual attendance: Guest List X + Shared Link Y = Expected (channels reconcile)", async () => {
  const { db, eventId, token } = await casualSharedEvent();
  const managed = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "聚!", occasion: cOccasion({ context: "get_together" }), eventId, recipientLabel: "老李" },
  });
  await rsvpGift({ db, body: { token: managed.body.token, key: "", status: "accepted" } }); // X = 1
  await rsvpGift({ db, body: { token, key: "", status: "accepted" } });                      // Y = 1
  const d = await casualDetail(db, eventId);
  assert.equal(d.body.aggregate.managed.attendingTotal, 1);
  assert.equal(d.body.sharedAggregate.attendingTotal, 1);
  assert.equal(d.body.aggregate.attendingTotal, 2);        // X + Y
  assert.equal(d.body.aggregate.acceptedGroups, 1);        // status summary reconciles
});

test("WEDDING aggregation is untouched by the casual rule (party sizes still sum)", async () => {
  // (Wedding semantics are covered exhaustively in event/birthday suites; this
  // is the explicit guard that the casual override never leaks across types.)
  const db = makeFakeDb();
  const w = await createGift({
    db, decoded: A, share: fakeShare(),
    body: {
      message: "婚礼", eventCreate: true, recipientLabel: "张先生全家", accessMode: "direct",
      occasion: { type: "wedding", version: 1, couple: { partner1: "李雷", partner2: "韩梅梅" }, date: "2026-10-01", time: { start: "18:00" }, venue: { displayName: "华彩厅" }, inviter: "李雷", audienceType: "relatives" },
    },
  });
  await rsvpGift({ db, body: { token: w.body.token, key: "", status: "accepted", adultCount: 2, childCount: 1 } });
  const d = await eventDetail({ db, decoded: A, body: { eventId: w.body.eventId }, giftCollection: GIFT_COLLECTION, sharedResponses: sharedResponsesForEvent });
  assert.equal(d.body.aggregate.attendingTotal, 3); // 2 adults + 1 child — counts, not responses
  assert.equal(d.body.aggregate.adultTotal, 2);
  assert.equal(d.body.aggregate.childTotal, 1);
});
