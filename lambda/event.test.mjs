/**
 * Phase 4.5-A — Event / Invitation / RSVP-counts / Sender Library tests.
 * Fake Firestore mirrors the real API surface used (doc ids on query docs,
 * delete for compensation); fake share crypto mirrors KMS context binding.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGift, retrieveGift, rsvpGift, GIFT_COLLECTION } from "./gift.mjs";
import {
  EVENT_COLLECTION,
  RSVP_COUNT_MAX,
  normalizeRecipientLabel,
  validateRsvpCounts,
  senderLibrary,
  eventDetail,
  recoverShare,
} from "./event.mjs";

// --- Fakes -------------------------------------------------------------------
function makeFakeDb({ failSetOn = null } = {}) {
  const store = new Map();
  function matchCond(v, c) {
    const x = v[c.field];
    if (c.op === "==") return x === c.val;
    if (c.op === ">=") return x >= c.val;
    return false;
  }
  function makeQuery(name, conds) {
    return {
      where: (field, op, val) => makeQuery(name, [...conds, { field, op, val }]),
      get: async () => {
        const docs = [...store.entries()]
          .filter(([k]) => k.startsWith(`${name}/`))
          .filter(([, v]) => conds.every((c) => matchCond(v, c)))
          .map(([k, v]) => ({ id: k.slice(name.length + 1), data: () => v }));
        return { size: docs.length, docs };
      },
    };
  }
  return {
    _store: store,
    collection(name) {
      return {
        doc: (id) => ({
          id,
          get: async () => {
            const d = store.get(`${name}/${id}`);
            return { exists: d !== undefined, data: () => d };
          },
          set: async (v) => {
            if (failSetOn === name) throw new Error(`fake ${name} write failure`);
            store.set(`${name}/${id}`, { ...v });
          },
          update: async (patch) =>
            void store.set(`${name}/${id}`, { ...store.get(`${name}/${id}`), ...patch }),
          delete: async () => void store.delete(`${name}/${id}`),
        }),
        where: (field, op, val) => makeQuery(name, [{ field, op, val }]),
      };
    },
  };
}

/** Context-bound fake mirroring the KMS EncryptionContext behavior. */
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
  open: async () => {
    throw new Error("kms unavailable");
  },
};

const A = { uid: "sender-a" };
const B = { uid: "sender-b" };
const FACTS = {
  type: "wedding",
  version: 1,
  couple: { partner1: "冯志俊", partner2: "吴姗姗" },
  date: "2026-10-01",
  time: { start: "17:00" },
  venue: { displayName: "杭州世纪皇冠大酒店", formattedAddress: "杭州西湖区金光大道520号" },
  inviter: "苏东坡",
  audienceType: "friends",
};
const eventCreateBody = (label = "张先生全家", extra = {}) => ({
  message: "诚邀见证",
  occasion: FACTS,
  eventCreate: true,
  recipientLabel: label,
  ...extra,
});
const eventDocs = (db) => [...db._store.entries()].filter(([k]) => k.startsWith(`${EVENT_COLLECTION}/`));

// --- recipientLabel ----------------------------------------------------------
test("recipientLabel: trims, requires content, caps at 40", () => {
  assert.deepEqual(normalizeRecipientLabel("  张先生全家 "), { ok: true, label: "张先生全家" });
  assert.equal(normalizeRecipientLabel("").ok, false);
  assert.equal(normalizeRecipientLabel("   ").ok, false);
  assert.equal(normalizeRecipientLabel(42).ok, false);
  assert.equal(normalizeRecipientLabel("字".repeat(41)).ok, false);
  assert.equal(normalizeRecipientLabel("字".repeat(40)).ok, true);
});

// --- RSVP count contract -----------------------------------------------------
test("rsvp counts: accepted 1/0 valid; 0/0 invalid; caps at 20 each and total", () => {
  assert.deepEqual(validateRsvpCounts("accepted", { adultCount: 1, childCount: 0 }).counts, {
    adultCount: 1,
    childCount: 0,
  });
  assert.equal(validateRsvpCounts("accepted", { adultCount: 0, childCount: 0 }).ok, false);
  assert.equal(validateRsvpCounts("accepted", { adultCount: 21, childCount: 0 }).ok, false);
  assert.equal(validateRsvpCounts("accepted", { adultCount: 0, childCount: 21 }).ok, false);
  assert.equal(validateRsvpCounts("accepted", { adultCount: 10, childCount: 11 }).ok, false);
  assert.equal(validateRsvpCounts("accepted", { adultCount: 10, childCount: 10 }).ok, true);
  assert.equal(RSVP_COUNT_MAX, 20);
});

test("rsvp counts: integers only, no negatives, both fields together", () => {
  assert.equal(validateRsvpCounts("accepted", { adultCount: 1.5, childCount: 0 }).ok, false);
  assert.equal(validateRsvpCounts("accepted", { adultCount: "2", childCount: 0 }).ok, false);
  assert.equal(validateRsvpCounts("accepted", { adultCount: -1, childCount: 2 }).ok, false);
  assert.equal(validateRsvpCounts("accepted", { adultCount: 2 }).ok, false); // child missing
});

test("rsvp counts: declined resolves to 0/0 and rejects non-zero counts", () => {
  assert.deepEqual(validateRsvpCounts("declined", {}).counts, { adultCount: 0, childCount: 0 });
  assert.deepEqual(validateRsvpCounts("declined", { adultCount: 0, childCount: 0 }).counts, {
    adultCount: 0,
    childCount: 0,
  });
  assert.equal(validateRsvpCounts("declined", { adultCount: 1, childCount: 0 }).ok, false);
});

test("rsvp counts: legacy accepted without counts stays valid and fabricates nothing", () => {
  const r = validateRsvpCounts("accepted", {});
  assert.equal(r.ok, true);
  assert.equal(r.counts, null);
});

test("rsvp endpoint stores counts and echoes them; declined writes zeros", async () => {
  const db = makeFakeDb();
  const c = await createGift({ db, decoded: A, body: eventCreateBody(), share: fakeShare() });
  assert.equal(c.status, 200);
  const yes = await rsvpGift({
    db,
    body: { token: c.body.token, status: "accepted", adultCount: 2, childCount: 1 },
  });
  assert.equal(yes.status, 200);
  assert.equal(yes.body.rsvpAdultCount, 2);
  let rec = db._store.get(`${GIFT_COLLECTION}/${[...db._store.keys()].find((k) => k.startsWith(`${GIFT_COLLECTION}/`)).slice(GIFT_COLLECTION.length + 1)}`);
  assert.equal(rec.rsvpAdultCount, 2);
  assert.equal(rec.rsvpChildCount, 1);
  const no = await rsvpGift({ db, body: { token: c.body.token, status: "declined" } });
  assert.equal(no.status, 200);
  rec = [...db._store.values()].find((v) => v.rsvpStatus);
  assert.equal(rec.rsvpStatus, "declined");
  assert.equal(rec.rsvpAdultCount, 0);
  assert.equal(rec.rsvpChildCount, 0);
});

test("rsvp endpoint rejects invalid counts with 400", async () => {
  const db = makeFakeDb();
  const c = await createGift({ db, decoded: A, body: eventCreateBody(), share: fakeShare() });
  const bad = await rsvpGift({
    db,
    body: { token: c.body.token, status: "accepted", adultCount: 0, childCount: 0 },
  });
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "invalid_rsvp_counts");
});

// --- Event creation ----------------------------------------------------------
test("first event-based seal silently creates the Event with facts, no aggregates", async () => {
  const db = makeFakeDb();
  const res = await createGift({ db, decoded: A, body: eventCreateBody(), share: fakeShare() });
  assert.equal(res.status, 200);
  assert.ok(res.body.eventId);
  const events = eventDocs(db);
  assert.equal(events.length, 1);
  const ev = events[0][1];
  assert.deepEqual(Object.keys(ev).sort(), [
    "createdAt",
    "occasion",
    "schemaVersion",
    "senderUid",
    "status",
    "type",
  ]);
  assert.equal(ev.type, "wedding");
  assert.equal(ev.senderUid, A.uid);
  assert.equal(ev.status, "active");
  assert.deepEqual(ev.occasion.couple, FACTS.couple);
});

test("second invitation attaches to the same event; other sender is forbidden", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const first = await createGift({ db, decoded: A, body: eventCreateBody(), share });
  const attach = await createGift({
    db,
    decoded: A,
    body: eventCreateBody("李女士", { eventCreate: undefined, eventId: first.body.eventId }),
    share,
  });
  assert.equal(attach.status, 200);
  assert.equal(attach.body.eventId, first.body.eventId);
  assert.equal(eventDocs(db).length, 1); // attach never creates a second event
  const stolen = await createGift({
    db,
    decoded: B,
    body: eventCreateBody("王先生全家", { eventCreate: undefined, eventId: first.body.eventId }),
    share,
  });
  assert.equal(stolen.status, 403);
});

test("event-based create validates label and intent", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const noLabel = await createGift({
    db,
    decoded: A,
    body: eventCreateBody(undefined, { recipientLabel: undefined }),
    share,
  });
  assert.equal(noLabel.status, 400);
  assert.equal(noLabel.body.error, "invalid_recipient_label");
  const longLabel = await createGift({ db, decoded: A, body: eventCreateBody("字".repeat(41)), share });
  assert.equal(longLabel.status, 400);
  const bothIntents = await createGift({
    db,
    decoded: A,
    body: eventCreateBody("张先生全家", { eventId: "someid" }),
    share,
  });
  assert.equal(bothIntents.status, 400);
  const noOccasion = await createGift({
    db,
    decoded: A,
    body: { message: "hi", eventCreate: true, recipientLabel: "张先生全家" },
    share,
  });
  assert.equal(noOccasion.status, 400);
  assert.equal(noOccasion.body.error, "invalid_event");
  const labelWithoutEvent = await createGift({
    db,
    decoded: A,
    body: { message: "hi", occasion: FACTS, recipientLabel: "张先生全家" },
    share,
  });
  assert.equal(labelWithoutEvent.status, 400);
  assert.equal(eventDocs(db).length, 0); // nothing above may leave an event behind
});

test("invitation record carries eventId + recipientLabel; ordinary gift carries neither", async () => {
  const db = makeFakeDb();
  const inv = await createGift({ db, decoded: A, body: eventCreateBody(), share: fakeShare() });
  const invRec = [...db._store.values()].find((v) => v.eventId);
  assert.equal(invRec.eventId, inv.body.eventId);
  assert.equal(invRec.recipientLabel, "张先生全家");
  const plain = await createGift({ db, decoded: A, body: { message: "普通心意" } });
  assert.equal(plain.status, 200);
  const plainRec = [...db._store.values()].find((v) => !v.eventId && !v.occasion);
  assert.equal("eventId" in plainRec, false);
  assert.equal("recipientLabel" in plainRec, false);
  assert.equal("shareTokenSealed" in plainRec, false); // no share crypto passed
  assert.equal("eventId" in plain.body, false);
});

// --- Atomicity / compensation ------------------------------------------------
test("share seal failure compensates the created event and answers 503", async () => {
  const db = makeFakeDb();
  const res = await createGift({ db, decoded: A, body: eventCreateBody(), share: brokenShare });
  assert.equal(res.status, 503);
  assert.equal(res.body.error, "share_seal_failed");
  assert.equal(eventDocs(db).length, 0);
});

test("event-based create without configured share crypto answers 503 before creating anything", async () => {
  const db = makeFakeDb();
  const res = await createGift({ db, decoded: A, body: eventCreateBody(), share: null });
  assert.equal(res.status, 503);
  assert.equal(res.body.error, "share_unavailable");
  assert.equal(eventDocs(db).length, 0);
});

test("presentation failure after event creation deletes the fresh event", async () => {
  const db = makeFakeDb();
  const res = await createGift({
    db,
    decoded: A,
    body: eventCreateBody("张先生全家", { presentation: { photo: { assetId: "a1" } } }),
    share: fakeShare(),
    media: null, // media store unavailable → finalize fails
  });
  assert.equal(res.status >= 400, true);
  assert.equal(eventDocs(db).length, 0);
});

test("gift record write failure compensates the created event", async () => {
  const db = makeFakeDb({ failSetOn: GIFT_COLLECTION });
  await assert.rejects(() =>
    createGift({ db, decoded: A, body: eventCreateBody(), share: fakeShare() }),
  );
  assert.equal(eventDocs(db).length, 0);
});

test("attach-mode failures never delete the pre-existing event", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const first = await createGift({ db, decoded: A, body: eventCreateBody(), share });
  const res = await createGift({
    db,
    decoded: A,
    body: eventCreateBody("李女士", {
      eventCreate: undefined,
      eventId: first.body.eventId,
      presentation: { photo: { assetId: "a1" } },
    }),
    share,
    media: null,
  });
  assert.equal(res.status >= 400, true);
  assert.equal(eventDocs(db).length, 1); // the event survives a failed attach seal
});

// --- Share credential --------------------------------------------------------
test("raw token never stored; sealed credential stored; owner recovers it", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const c = await createGift({ db, decoded: A, body: eventCreateBody(), share });
  const serialized = JSON.stringify([...db._store.entries()]);
  assert.equal(serialized.includes(c.body.token), false); // plaintext token nowhere
  const rec = [...db._store.values()].find((v) => v.shareTokenSealed);
  assert.ok(rec.shareTokenSealed.startsWith("sealed:"));
  const giftId = [...db._store.keys()]
    .find((k) => k.startsWith(`${GIFT_COLLECTION}/`))
    .slice(GIFT_COLLECTION.length + 1);
  const rc = await recoverShare({
    db,
    decoded: A,
    body: { giftId },
    giftCollection: GIFT_COLLECTION,
    shareCrypto: share,
  });
  assert.equal(rc.status, 200);
  assert.equal(rc.body.token, c.body.token);
  assert.equal(rc.body.recipientLabel, "张先生全家");
});

test("share recovery: wrong sender 403; revoked 410; decrypt failure 502; no crypto 503", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  await createGift({ db, decoded: A, body: eventCreateBody(), share });
  const giftId = [...db._store.keys()]
    .find((k) => k.startsWith(`${GIFT_COLLECTION}/`))
    .slice(GIFT_COLLECTION.length + 1);
  const forbidden = await recoverShare({
    db, decoded: B, body: { giftId }, giftCollection: GIFT_COLLECTION, shareCrypto: share,
  });
  assert.equal(forbidden.status, 403);
  const noCrypto = await recoverShare({
    db, decoded: A, body: { giftId }, giftCollection: GIFT_COLLECTION, shareCrypto: null,
  });
  assert.equal(noCrypto.status, 503);
  const broken = await recoverShare({
    db, decoded: A, body: { giftId }, giftCollection: GIFT_COLLECTION, shareCrypto: brokenShare,
  });
  assert.equal(broken.status, 502);
  db._store.get(`${GIFT_COLLECTION}/${giftId}`).revoked = true;
  const revoked = await recoverShare({
    db, decoded: A, body: { giftId }, giftCollection: GIFT_COLLECTION, shareCrypto: share,
  });
  assert.equal(revoked.status, 410);
});

test("old gift without sealed credential is honestly unrecoverable (404)", async () => {
  const db = makeFakeDb();
  await createGift({ db, decoded: A, body: { message: "旧心意", occasion: FACTS } }); // no share crypto
  const giftId = [...db._store.keys()]
    .find((k) => k.startsWith(`${GIFT_COLLECTION}/`))
    .slice(GIFT_COLLECTION.length + 1);
  const rc = await recoverShare({
    db, decoded: A, body: { giftId }, giftCollection: GIFT_COLLECTION, shareCrypto: fakeShare(),
  });
  assert.equal(rc.status, 404);
  assert.equal(rc.body.error, "share_unrecoverable");
});

test("recipient responses never expose the sealed credential", async () => {
  const db = makeFakeDb();
  const c = await createGift({ db, decoded: A, body: eventCreateBody(), share: fakeShare() });
  const r = await retrieveGift({ db, body: { token: c.body.token } });
  assert.equal(r.status, 200);
  const s = JSON.stringify(r.body);
  assert.equal(s.includes("shareTokenSealed"), false);
  assert.equal(s.includes("sealed:"), false);
  assert.equal(s.includes("eventId"), false); // event linkage is sender-side data
  assert.equal(s.includes("recipientLabel"), false); // 4.5-A: not yet recipient-facing
});

// --- Sender Library / Event detail -------------------------------------------
test("sender library lists only my events and gifts, without secrets", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const mine = await createGift({ db, decoded: A, body: eventCreateBody(), share });
  await createGift({ db, decoded: A, body: { message: "普通心意" } });
  await createGift({ db, decoded: B, body: { message: "别人的" } });
  const lib = await senderLibrary({ db, decoded: A, giftCollection: GIFT_COLLECTION });
  assert.equal(lib.status, 200);
  assert.equal(lib.body.events.length, 1);
  assert.equal(lib.body.gifts.length, 2);
  const s = JSON.stringify(lib.body);
  assert.equal(s.includes(mine.body.token), false);
  assert.equal(s.includes("keyHash"), false);
  assert.equal(s.includes("keySalt"), false);
  assert.equal(s.includes("shareTokenSealed"), false);
  assert.equal(s.includes("普通心意"), false); // message plaintext stays out of rows
  const invRow = lib.body.gifts.find((g) => g.eventId);
  assert.equal(invRow.recipientLabel, "张先生全家");
  assert.equal(invRow.shareRecoverable, true);
  const plainRow = lib.body.gifts.find((g) => !g.eventId);
  assert.equal(plainRow.shareRecoverable, false); // 单独封存的心意 — honest
});

test("event detail: owner-scoped, invitations listed, aggregate derived (never stored)", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const first = await createGift({ db, decoded: A, body: eventCreateBody("张先生全家"), share });
  const eventId = first.body.eventId;
  const mk = (label) =>
    createGift({
      db,
      decoded: A,
      body: eventCreateBody(label, { eventCreate: undefined, eventId }),
      share,
    });
  const b = await mk("李女士");
  const c2 = await mk("王先生全家");
  await mk("赵家"); // stays pending
  const revoked = await mk("钱家");
  await rsvpGift({ db, body: { token: first.body.token, status: "accepted", adultCount: 2, childCount: 1 } });
  await rsvpGift({ db, body: { token: b.body.token, status: "accepted", adultCount: 1, childCount: 0 } });
  await rsvpGift({ db, body: { token: c2.body.token, status: "declined" } });
  await rsvpGift({ db, body: { token: revoked.body.token, status: "accepted", adultCount: 5, childCount: 5 } });
  const revokedHash = [...db._store.entries()].find(([, v]) => v.recipientLabel === "钱家")[0];
  db._store.get(revokedHash).revoked = true;

  const detail = await eventDetail({ db, decoded: A, body: { eventId }, giftCollection: GIFT_COLLECTION });
  assert.equal(detail.status, 200);
  assert.equal(detail.body.invitations.length, 5);
  assert.deepEqual(detail.body.aggregate, {
    adultTotal: 3,
    childTotal: 1,
    attendingTotal: 4,
    acceptedGroups: 2,
    declinedGroups: 1,
    pendingGroups: 1, // 赵家 — 钱家 is revoked and counts nowhere
  });
  const evDoc = db._store.get(`${EVENT_COLLECTION}/${eventId}`);
  assert.equal("aggregate" in evDoc, false); // single authority: derived only

  const other = await eventDetail({ db, decoded: B, body: { eventId }, giftCollection: GIFT_COLLECTION });
  assert.equal(other.status, 403);
  const missing = await eventDetail({ db, decoded: A, body: { eventId: "nope" }, giftCollection: GIFT_COLLECTION });
  assert.equal(missing.status, 404);
});

test("legacy compatibility: standalone wedding + ordinary gift behave exactly as before", async () => {
  const db = makeFakeDb();
  const wedding = await createGift({ db, decoded: A, body: { message: "旧式婚礼", occasion: FACTS } });
  assert.equal(wedding.status, 200);
  assert.equal("eventId" in wedding.body, false);
  const opened = await retrieveGift({ db, body: { token: wedding.body.token } });
  assert.equal(opened.status, 200);
  assert.deepEqual(opened.body.occasion.couple, FACTS.couple);
  const legacyRsvp = await rsvpGift({ db, body: { token: wedding.body.token, status: "accepted" } });
  assert.equal(legacyRsvp.status, 200);
  const rec = [...db._store.values()].find((v) => v.rsvpStatus === "accepted");
  assert.equal("rsvpAdultCount" in rec, false); // never fabricated for legacy accepts
  const plain = await createGift({ db, decoded: A, body: { message: "普通" } });
  assert.equal(plain.body.retrievalKey !== null, true); // heart_key default untouched
});
