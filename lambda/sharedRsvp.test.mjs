/**
 * Shared-link RSVP — one response per SCANNER.
 *
 * The property under test throughout: a direct-share link is ONE record
 * forwarded to many people, so a second scanner must never see, overwrite or
 * be locked out by the first scanner's answer.
 */
import { test } from "node:test";
import crypto from "node:crypto";
import assert from "node:assert/strict";
import { createGift, GIFT_COLLECTION } from "./gift.mjs";
import { eventDetail } from "./event.mjs";
import { rsvpGift, retrieveGift } from "./gift.mjs";
import {
  submitSharedRsvp,
  readSharedResponse,
  sharedResponsesForEvent,
  SHARED_RSVP_COLLECTION,
} from "./sharedRsvp.mjs";

// The feature rides on the EXISTING routes, so `mine` is a read helper rather
// than an endpoint: /gift/retrieve surfaces it when a scanner presents their id.
const sha256Hex = (x) => crypto.createHash("sha256").update(String(x)).digest("hex");
const mySharedRsvp = async ({ db, giftCollection, body }) => {
  const pt = body?.participantToken ?? "";
  if (!/^[A-Za-z0-9_-]{16,64}$/.test(pt)) return { status: 400, body: { error: "invalid_participant" } };
  const response = await readSharedResponse({
    db, tokenHash: sha256Hex(body.token), participantToken: pt,
  });
  return { status: 200, body: { ok: true, response } };
};

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

test("Event attendance COMBINES channels; sources stay separately visible", async () => {
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

  // FOUNDER RULE (2026-08-19): the Event's expected attendance includes both
  // channels — 3 managed (2 adults + 1 child) + 5 shared (3 + 2 adults) = 8.
  assert.equal(detail.body.aggregate.attendingTotal, 8);
  assert.equal(detail.body.aggregate.adultTotal, 7);
  assert.equal(detail.body.aggregate.childTotal, 1);

  // The sources are never merged: the managed breakdown and household group
  // counts still speak only for households (§12 lives on one level down)…
  assert.deepEqual(detail.body.aggregate.managed, { adultTotal: 2, childTotal: 1, attendingTotal: 3 });
  assert.equal(detail.body.aggregate.acceptedGroups, 1);

  // …and shared replies keep their own bucket, now with the adult/child split.
  assert.equal(detail.body.sharedAggregate.replies, 3);
  assert.equal(detail.body.sharedAggregate.accepted, 2);
  assert.equal(detail.body.sharedAggregate.declined, 1);
  assert.equal(detail.body.sharedAggregate.adultTotal, 5);
  assert.equal(detail.body.sharedAggregate.childTotal, 0);
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


// --- The feature rides on the EXISTING routes (no API Gateway change) -------

test("/gift/rsvp delegates a shared link to the per-scanner response", async () => {
  const db = makeFakeDb();
  const inv = await sharedInvitation(db);

  // Exactly what the client sends to the ordinary RSVP door.
  const a = await rsvpGift({ db, body: { token: inv.token, key: "", status: "accepted", adultCount: 3, childCount: 0 } });
  assert.equal(a.status, 200);
  assert.ok(a.body.participantToken, "a first-time scanner is minted an identity");
  assert.equal(a.body.response.adultCount, 3);

  // A second scanner through the SAME door keeps their own answer.
  const b = await rsvpGift({ db, body: { token: inv.token, key: "", status: "accepted", adultCount: 1, childCount: 0 } });
  assert.notEqual(b.body.participantToken, a.body.participantToken);
  assert.equal([...db._store.keys()].filter((k) => k.startsWith(SHARED_RSVP_COLLECTION)).length, 2);

  // The invitation record itself never acquired an RSVP.
  const rec = [...db._store.entries()].find(([k]) => k.startsWith(`${GIFT_COLLECTION}/`))[1];
  assert.equal(rec.rsvpStatus ?? null, null);
});

test("/gift/retrieve returns THIS scanner's own answer, and only theirs", async () => {
  const db = makeFakeDb();
  const inv = await sharedInvitation(db);
  const a = await rsvpGift({ db, body: { token: inv.token, key: "", status: "accepted", adultCount: 4, childCount: 0 } });
  const pt = a.body.participantToken;

  const mine = await retrieveGift({ db, body: { token: inv.token, participantToken: pt } });
  assert.equal(mine.status, 200);
  assert.equal(mine.body.sharedResponse.adultCount, 4);

  // Someone else's device, and a device with no identity yet, see nothing.
  const other = await retrieveGift({ db, body: { token: inv.token, participantToken: "y".repeat(24) } });
  assert.equal(other.body.sharedResponse, null);
  const fresh = await retrieveGift({ db, body: { token: inv.token } });
  assert.equal(fresh.body.sharedResponse, null);
});

test("a MANAGED household still answers on its own record, untouched", async () => {
  const db = makeFakeDb();
  const managed = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "Join us", occasion: FACTS, eventCreate: true,
            recipientLabel: "The Smith Family", accessMode: "direct" },
  });
  const r = await rsvpGift({ db, body: { token: managed.body.token, key: "", status: "accepted", adultCount: 2, childCount: 1 } });
  assert.equal(r.status, 200);
  assert.equal(r.body.rsvpAdultCount, 2);
  assert.equal(r.body.participantToken, undefined, "no scanner identity for a household");
  assert.equal([...db._store.keys()].filter((k) => k.startsWith(SHARED_RSVP_COLLECTION)).length, 0);

  const opened = await retrieveGift({ db, body: { token: managed.body.token } });
  assert.equal(opened.body.rsvpAdultCount, 2);
  assert.equal(opened.body.sharedResponse, null);
});


// --- Access-control hardening (closure-audit finding, 2026-08-19) -----------

/**
 * The invariant: EVERY write through /gift/rsvp proves the same credential
 * retrieve demands. The per-scanner delegation used to run before the
 * heart_key check, so a 私密 direct-share link accepted answers from anyone
 * holding the token alone.
 */
async function heartKeySharedInvitation(db) {
  const res = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "Join us", occasion: FACTS, eventCreate: true,
            recipientLabel: "Our guests", sharedDistribution: true, accessMode: "heart_key" },
  });
  assert.equal(res.status, 200);
  assert.ok(res.body.retrievalKey, "heart_key invitation carries a key");
  return res.body;
}

test("a heart_key shared link refuses RSVP writes without the key", async () => {
  const db = makeFakeDb();
  const inv = await heartKeySharedInvitation(db);

  const noKey = await rsvpGift({ db, body: { token: inv.token, key: "", status: "accepted", adultCount: 3, childCount: 0 } });
  assert.equal(noKey.status, 401);
  assert.equal(noKey.body.error, "invalid_key");

  const wrongKey = await rsvpGift({ db, body: { token: inv.token, key: "000000", status: "accepted", adultCount: 3, childCount: 0 } });
  assert.equal(wrongKey.status, 401);
  assert.ok(typeof wrongKey.body.attemptsRemaining === "number", "wrong keys burn attempts, as on retrieve");

  // Message-only writes are gated identically.
  const msg = await rsvpGift({ db, body: { token: inv.token, key: "", recipientMessage: "spam" } });
  assert.equal(msg.status, 401);

  // Nothing was written anywhere.
  assert.equal([...db._store.keys()].filter((k) => k.startsWith(SHARED_RSVP_COLLECTION)).length, 0);
  const rec = [...db._store.values()].find((v) => v.sharedDistribution === true);
  assert.equal(rec.rsvpStatus ?? null, null);
});

test("with the key proven, a heart_key shared link answers per scanner as usual", async () => {
  const db = makeFakeDb();
  const inv = await heartKeySharedInvitation(db);

  // Burn one attempt first, then prove the key — stale counters must clear.
  await rsvpGift({ db, body: { token: inv.token, key: "000000", status: "accepted", adultCount: 1, childCount: 0 } });
  const ok = await rsvpGift({ db, body: { token: inv.token, key: inv.retrievalKey, status: "accepted", adultCount: 2, childCount: 0 } });
  assert.equal(ok.status, 200);
  assert.ok(ok.body.participantToken, "scanner identity minted");
  assert.equal(ok.body.response.adultCount, 2);

  const rec = [...db._store.values()].find((v) => v.sharedDistribution === true);
  assert.equal(rec.failedAttempts, 0);            // counters cleared on proof
  assert.equal(rec.rsvpStatus ?? null, null);      // the answer never touches the record
  assert.equal([...db._store.keys()].filter((k) => k.startsWith(SHARED_RSVP_COLLECTION)).length, 1);
});

test("shared retrieve never surfaces legacy record-level RSVP fields", async () => {
  const db = makeFakeDb();
  const inv = await sharedInvitation(db);

  // Simulate a record answered under the OLD model (before per-scanner).
  const [key, rec] = [...db._store.entries()].find(([, v]) => v.sharedDistribution === true);
  db._store.set(key, { ...rec, rsvpStatus: "accepted", rsvpAt: 123, rsvpAdultCount: 5, rsvpChildCount: 0 });

  const opened = await retrieveGift({ db, body: { token: inv.token } });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.rsvpStatus, null);       // a stranger's answer is nobody's answer
  assert.equal(opened.body.rsvpAdultCount, null);
  assert.equal(opened.body.rsvpAt, null);

  // A MANAGED record still reports its own RSVP exactly as before.
  const managed = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "hi", occasion: FACTS, eventCreate: true, recipientLabel: "The Smith Family", accessMode: "direct" },
  });
  await rsvpGift({ db, body: { token: managed.body.token, key: "", status: "accepted", adultCount: 2, childCount: 0 } });
  const m = await retrieveGift({ db, body: { token: managed.body.token } });
  assert.equal(m.body.rsvpStatus, "accepted");
  assert.equal(m.body.rsvpAdultCount, 2);
});


test("combined totals track every lifecycle move without double-counting", async () => {
  const db = makeFakeDb();
  const shared = await sharedInvitation(db);
  const eventId = shared.eventId;
  const managed = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "hi", occasion: FACTS, eventId, recipientLabel: "The Smith Family", accessMode: "direct" },
  });
  const detail = async () => {
    const d = await eventDetail({ db, decoded: A, body: { eventId },
      giftCollection: GIFT_COLLECTION, sharedResponses: sharedResponsesForEvent });
    return d.body.aggregate;
  };

  // Managed-only.
  await rsvpGift({ db, body: { token: managed.body.token, key: "", status: "accepted", adultCount: 2, childCount: 1 } });
  let a = await detail();
  assert.deepEqual([a.attendingTotal, a.adultTotal, a.childTotal], [3, 2, 1]);
  assert.equal(a.managed.attendingTotal, 3);

  // + shared scanner → combined.
  const sc = await rsvpGift({ db, body: { token: shared.token, key: "", status: "accepted", adultCount: 4, childCount: 0 } });
  const pt = sc.body.participantToken;
  a = await detail();
  assert.deepEqual([a.attendingTotal, a.adultTotal, a.childTotal], [7, 6, 1]);
  assert.equal(a.managed.attendingTotal, 3);

  // Scanner UPDATES (4 → 2): adjust, never accumulate.
  await rsvpGift({ db, body: { token: shared.token, key: "", participantToken: pt, status: "accepted", adultCount: 2, childCount: 0 } });
  a = await detail();
  assert.equal(a.attendingTotal, 5);

  // Managed household updates (3 → 4): adjust, never accumulate.
  await rsvpGift({ db, body: { token: managed.body.token, key: "", status: "accepted", adultCount: 4, childCount: 0 } });
  a = await detail();
  assert.deepEqual([a.attendingTotal, a.managed.attendingTotal], [6, 4]);

  // Scanner declines: their contribution leaves the total.
  await rsvpGift({ db, body: { token: shared.token, key: "", participantToken: pt, status: "declined" } });
  a = await detail();
  assert.equal(a.attendingTotal, 4);
  assert.equal(a.managed.attendingTotal, 4);

  // Managed declines too: expectation drops to zero.
  await rsvpGift({ db, body: { token: managed.body.token, key: "", status: "declined" } });
  a = await detail();
  assert.equal(a.attendingTotal, 0);

  // Re-accept both, then revoke the SHARED invitation: its responses leave
  // the combined total while the household stands.
  await rsvpGift({ db, body: { token: managed.body.token, key: "", status: "accepted", adultCount: 2, childCount: 0 } });
  await rsvpGift({ db, body: { token: shared.token, key: "", participantToken: pt, status: "accepted", adultCount: 3, childCount: 0 } });
  a = await detail();
  assert.equal(a.attendingTotal, 5);
  const { revokeGift } = await import("./gift.mjs");
  await revokeGift({ db, decoded: A, body: { token: shared.token } });
  a = await detail();
  assert.equal(a.attendingTotal, 2);
  assert.equal(a.managed.attendingTotal, 2);
});
