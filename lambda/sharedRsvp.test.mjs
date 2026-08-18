/**
 * Shared-link RSVP — one response per SCANNER.
 *
 * The property under test throughout: a direct-share link is ONE record
 * forwarded to many people, so a second scanner must never see, overwrite or
 * be locked out by the first scanner's answer.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGift, GIFT_COLLECTION } from "./gift.mjs";
import { eventDetail } from "./event.mjs";
import {
  submitSharedRsvp,
  mySharedRsvp,
  sharedResponsesForEvent,
  SHARED_RSVP_COLLECTION,
} from "./sharedRsvp.mjs";

const A = { uid: "author-1" };
const FACTS = {
  type: "wedding", version: 2,
  couple: { partner1: "Emma", partner2: "James" },
  date: "2026-10-01", time: { start: "16:00" },
  venue: { displayName: "Hedsor House" },
  inviter: "Emma and James", audienceType: "friends", culture: "western",
};
const fakeShare = () => ({
  seal: async (t) => `sealed:${t}`,
  open: async (s) => String(s).replace(/^sealed:/, ""),
});

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
        docs: [...store.entries()]
          .filter(([k, v]) => k.startsWith(`${name}/`) && v[field] === value)
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

async function sharedInvitation(db) {
  const res = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "Join us", occasion: FACTS, eventCreate: true,
            recipientLabel: "Our guests", sharedDistribution: true, accessMode: "direct" },
  });
  assert.equal(res.status, 200);
  return res.body;
}

test("two scanners keep INDEPENDENT responses — no first-answer-wins", async () => {
  const db = makeFakeDb();
  const inv = await sharedInvitation(db);

  const a = await submitSharedRsvp({ db, giftCollection: GIFT_COLLECTION,
    body: { token: inv.token, status: "accepted", adultCount: 3, childCount: 0 } });
  assert.equal(a.status, 200);
  assert.ok(a.body.participantToken, "a first-time scanner is minted an identity");
  assert.equal(a.body.response.adultCount, 3);

  // A SECOND scanner arrives with no token of their own.
  const b = await submitSharedRsvp({ db, giftCollection: GIFT_COLLECTION,
    body: { token: inv.token, status: "accepted", adultCount: 2, childCount: 0 } });
  assert.equal(b.status, 200);
  assert.notEqual(b.body.participantToken, a.body.participantToken);
  assert.equal(b.body.response.adultCount, 2);

  // Neither overwrote the other.
  const mineA = await mySharedRsvp({ db, giftCollection: GIFT_COLLECTION,
    body: { token: inv.token, participantToken: a.body.participantToken } });
  const mineB = await mySharedRsvp({ db, giftCollection: GIFT_COLLECTION,
    body: { token: inv.token, participantToken: b.body.participantToken } });
  assert.equal(mineA.body.response.adultCount, 3);
  assert.equal(mineB.body.response.adultCount, 2);
  assert.equal([...db._store.keys()].filter((k) => k.startsWith(SHARED_RSVP_COLLECTION)).length, 2);
});

test("re-submitting UPDATES that scanner's own response, never adds one", async () => {
  const db = makeFakeDb();
  const inv = await sharedInvitation(db);
  const first = await submitSharedRsvp({ db, giftCollection: GIFT_COLLECTION,
    body: { token: inv.token, status: "accepted", adultCount: 4, childCount: 0, dietaryRequirements: "Peanut" } });
  const pt = first.body.participantToken;

  const changed = await submitSharedRsvp({ db, giftCollection: GIFT_COLLECTION,
    body: { token: inv.token, participantToken: pt, status: "declined" } });
  assert.equal(changed.status, 200);
  assert.equal(changed.body.participantToken, undefined, "an existing scanner is not re-minted");

  const rows = [...db._store.keys()].filter((k) => k.startsWith(SHARED_RSVP_COLLECTION));
  assert.equal(rows.length, 1, "a changed mind is an update, never a second head-count");
  const mine = await mySharedRsvp({ db, giftCollection: GIFT_COLLECTION,
    body: { token: inv.token, participantToken: pt } });
  assert.equal(mine.body.response.status, "declined");
  assert.equal(mine.body.response.adultCount, 0);
  // Dietary survives an RSVP change, as on a household record.
  assert.equal(mine.body.response.dietaryRequirements, "Peanut");
});

test("a scanner can add a message without disturbing their attendance", async () => {
  const db = makeFakeDb();
  const inv = await sharedInvitation(db);
  const r = await submitSharedRsvp({ db, giftCollection: GIFT_COLLECTION,
    body: { token: inv.token, status: "accepted", adultCount: 2, childCount: 0 } });
  const pt = r.body.participantToken;

  const msg = await submitSharedRsvp({ db, giftCollection: GIFT_COLLECTION,
    body: { token: inv.token, participantToken: pt, recipientMessage: "  Congratulations!  " } });
  assert.equal(msg.status, 200);
  assert.equal(msg.body.response.recipientMessage, "Congratulations!");
  assert.equal(msg.body.response.adultCount, 2);
  assert.equal(msg.body.response.status, "accepted");

  // A message with no prior answer has nothing to attach to.
  const orphan = await submitSharedRsvp({ db, giftCollection: GIFT_COLLECTION,
    body: { token: inv.token, recipientMessage: "hello" } });
  assert.equal(orphan.status, 409);
  assert.equal(orphan.body.error, "no_response_yet");
});

test("a scanner only ever sees their OWN response", async () => {
  const db = makeFakeDb();
  const inv = await sharedInvitation(db);
  const a = await submitSharedRsvp({ db, giftCollection: GIFT_COLLECTION,
    body: { token: inv.token, status: "accepted", adultCount: 5, childCount: 0, recipientMessage: "private note" } });

  // A stranger with no identity sees nothing — not the other scanner's answer.
  const stranger = await mySharedRsvp({ db, giftCollection: GIFT_COLLECTION,
    body: { token: inv.token, participantToken: "z".repeat(24) } });
  assert.equal(stranger.status, 200);
  assert.equal(stranger.body.response, null);

  // Malformed identities are refused outright.
  for (const bad of ["", "short", "!!!!!!!!!!!!!!!!!!!!"]) {
    const res = await mySharedRsvp({ db, giftCollection: GIFT_COLLECTION,
      body: { token: inv.token, participantToken: bad } });
    assert.equal(res.status, 400);
  }
  assert.equal(a.body.response.recipientMessage, "private note");
});

test("MANAGED household invitations are refused here — they answer on their own record", async () => {
  const db = makeFakeDb();
  const managed = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "Join us", occasion: FACTS, eventCreate: true,
            recipientLabel: "The Smith Family", accessMode: "direct" },
  });
  const res = await submitSharedRsvp({ db, giftCollection: GIFT_COLLECTION,
    body: { token: managed.body.token, status: "accepted", adultCount: 2, childCount: 0 } });
  assert.equal(res.status, 409);
  assert.equal(res.body.error, "not_shared");

  const unknown = await submitSharedRsvp({ db, giftCollection: GIFT_COLLECTION,
    body: { token: "not-a-real-token", status: "accepted" } });
  assert.equal(unknown.status, 404);
});

test("shared replies reach the host, counted SEPARATELY from households (§12)", async () => {
  const db = makeFakeDb();
  const shared = await sharedInvitation(db);
  const eventId = shared.eventId;

  // A managed household on the same Event.
  const household = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "Join us", occasion: FACTS, eventId,
            recipientLabel: "The Smith Family", accessMode: "direct" },
  });
  const { rsvpGift } = await import("./gift.mjs");
  await rsvpGift({ db, body: { token: household.body.token, status: "accepted", adultCount: 2, childCount: 1 } });

  // Three people scan the shared link.
  for (const n of [3, 2]) {
    await submitSharedRsvp({ db, giftCollection: GIFT_COLLECTION,
      body: { token: shared.token, status: "accepted", adultCount: n, childCount: 0 } });
  }
  await submitSharedRsvp({ db, giftCollection: GIFT_COLLECTION,
    body: { token: shared.token, status: "declined" } });

  const detail = await eventDetail({
    db, decoded: A, body: { eventId }, giftCollection: GIFT_COLLECTION,
    sharedResponses: sharedResponsesForEvent,
  });
  assert.equal(detail.status, 200);

  // Household statistics speak only for households — unchanged by §12.
  assert.equal(detail.body.aggregate.attendingTotal, 3);
  assert.equal(detail.body.aggregate.acceptedGroups, 1);

  // Shared replies are real, and live in their own bucket.
  assert.equal(detail.body.sharedAggregate.replies, 3);
  assert.equal(detail.body.sharedAggregate.accepted, 2);
  assert.equal(detail.body.sharedAggregate.declined, 1);
  assert.equal(detail.body.sharedAggregate.attendingTotal, 5);
  assert.equal(detail.body.sharedResponses.length, 3);
});

test("a revoked shared invitation accepts no further replies", async () => {
  const db = makeFakeDb();
  const inv = await sharedInvitation(db);
  const { revokeGift } = await import("./gift.mjs");
  await revokeGift({ db, decoded: A, body: { token: inv.token } });
  const res = await submitSharedRsvp({ db, giftCollection: GIFT_COLLECTION,
    body: { token: inv.token, status: "accepted", adultCount: 1, childCount: 0 } });
  assert.equal(res.status, 410);
});
