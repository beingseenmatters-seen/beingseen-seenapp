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

test("recipient responses: label ONLY on success (V2); sealed credential never", async () => {
  const db = makeFakeDb();
  const c = await createGift({ db, decoded: A, body: eventCreateBody(), share: fakeShare() });
  const r = await retrieveGift({ db, body: { token: c.body.token } });
  assert.equal(r.status, 200);
  const s = JSON.stringify(r.body);
  assert.equal(r.body.recipientLabel, "张先生全家"); // 致 张先生全家 — post-access only
  assert.equal(s.includes("shareTokenSealed"), false);
  assert.equal(s.includes("sealed:"), false);
  assert.equal(s.includes("eventId"), false); // event linkage stays sender-side

  // heart_key invitation: probes / wrong keys / locks must NOT leak the label
  const hk = await createGift({
    db, decoded: A, share: fakeShare(),
    body: eventCreateBody("李女士", { accessMode: "heart_key" }),
  });
  const probe = await retrieveGift({ db, body: { token: hk.body.token } });
  assert.equal(probe.status, 401);
  assert.equal(JSON.stringify(probe.body).includes("李女士"), false);
  assert.equal(JSON.stringify(probe.body).includes("recipientLabel"), false);
  const wrong = await retrieveGift({ db, body: { token: hk.body.token, key: "111112" } });
  assert.equal(wrong.status, 401);
  assert.equal(JSON.stringify(wrong.body).includes("李女士"), false);
  const good = await retrieveGift({ db, body: { token: hk.body.token, key: hk.body.retrievalKey } });
  assert.equal(good.status, 200);
  assert.equal(good.body.recipientLabel, "李女士"); // visible only after unlock
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
  // The invariant is that a count is never FABRICATED for a legacy accept.
  // An accept with no counts now writes an explicit null instead of omitting
  // the field, so a stale count from a previous decline cannot survive the
  // new answer (founder QA: "Attendance confirmed · 0 attending"). null and
  // absent are equivalent to every consumer — all four read sites test
  // `typeof === "number"` or coalesce with `?? null`.
  assert.equal(typeof rec.rsvpAdultCount === "number", false);
  assert.equal(typeof rec.rsvpChildCount === "number", false);
  const plain = await createGift({ db, decoded: A, body: { message: "普通" } });
  assert.equal(plain.body.retrievalKey !== null, true); // heart_key default untouched
});

// --- 4.5-B: presentation reuse across Event invitations ----------------------
function makeReuseMediaStore() {
  const objects = new Map();
  const store = {
    _objects: objects,
    failReuseCopy: false,
    async putStaging({ uid, assetId, bytes, contentType, metadata }) {
      const meta = Object.fromEntries(Object.entries(metadata || {}).map(([k, v]) => [k.toLowerCase(), v]));
      objects.set(`staging/${uid}/${assetId}`, { bytes, contentType, metadata: meta });
    },
    async headStaging({ uid, assetId }) {
      const o = objects.get(`staging/${uid}/${assetId}`);
      return o ? { bytes: o.bytes.length, contentType: o.contentType, metadata: o.metadata } : null;
    },
    async copyToSealed({ uid, assetId, tokenHash }) {
      const o = objects.get(`staging/${uid}/${assetId}`);
      if (!o) throw new Error("missing source");
      objects.set(`sealed/${tokenHash}/${assetId}`, o);
    },
    async copySealedToSealed({ srcTokenHash, assetId, destTokenHash }) {
      if (store.failReuseCopy) throw new Error("injected reuse copy failure");
      const o = objects.get(`sealed/${srcTokenHash}/${assetId}`);
      if (!o) throw new Error("missing sealed source");
      objects.set(`sealed/${destTokenHash}/${assetId}`, o);
    },
    async deleteStaging({ uid, assetId }) { objects.delete(`staging/${uid}/${assetId}`); },
    async deleteSealed({ tokenHash, assetId }) { objects.delete(`sealed/${tokenHash}/${assetId}`); },
    async presignSealedGet({ tokenHash, assetId }) {
      return `https://media.example/sealed/${tokenHash}/${assetId}?sig=test`;
    },
  };
  return store;
}
async function stagePhoto(media, uid) {
  const bytes = Buffer.alloc(2048, 0x20);
  bytes[0] = 0xff; bytes[1] = 0xd8; bytes[2] = 0xff;
  const { uploadGiftMedia } = await import("./giftMedia.mjs");
  const res = await uploadGiftMedia({ store: media, decoded: { uid }, body: { type: "photo", contentType: "image/jpeg", data: bytes.toString("base64") } });
  if (res.status !== 200) throw new Error("stage photo failed");
  return res.body.assetId;
}
async function stageVoice(media, uid) {
  const bytes = Buffer.alloc(4096, 0x11);
  bytes[4] = 0x66; bytes[5] = 0x74; bytes[6] = 0x79; bytes[7] = 0x70; // ftyp
  const { uploadGiftMedia } = await import("./giftMedia.mjs");
  const res = await uploadGiftMedia({ store: media, decoded: { uid }, body: { type: "audio", contentType: "audio/mp4", data: bytes.toString("base64"), durationMs: 4200 } });
  if (res.status !== 200) throw new Error("stage voice failed");
  return res.body.assetId;
}
const THEMES_ENV = () => { process.env.GIFT_MEDIA_DEV_THEMES = "1"; };

test("4.5-B reuse: second household inherits photo+voice by fromGiftId (sealed→sealed, no staging)", async () => {
  const db = makeFakeDb();
  const media = makeReuseMediaStore();
  const share = fakeShare();
  const [photoId, voiceId] = [await stagePhoto(media, A.uid), await stageVoice(media, A.uid)];
  const c1 = await createGift({
    db, decoded: A, media, share,
    body: eventCreateBody("张先生全家", { presentation: { photo: { assetId: photoId }, voice: { assetId: voiceId } } }),
  });
  assert.equal(c1.status, 200);
  assert.ok(c1.body.giftId, "event create returns giftId");
  const eventId = c1.body.eventId;
  const stagingLeft = [...media._objects.keys()].filter((k) => k.startsWith("staging/"));
  assert.equal(stagingLeft.length, 0); // first seal consumed stagings

  const c2 = await createGift({
    db, decoded: A, media, share,
    body: eventCreateBody("李女士", {
      eventCreate: undefined, eventId,
      presentation: { photo: { fromGiftId: c1.body.giftId }, voice: { fromGiftId: c1.body.giftId } },
    }),
  });
  assert.equal(c2.status, 200);
  const recB = db._store.get(`${GIFT_COLLECTION}/${c2.body.giftId}`);
  const recA = db._store.get(`${GIFT_COLLECTION}/${c1.body.giftId}`);
  // fragments inherited verbatim from the source's validated seal
  assert.deepEqual(recB.presentation.photo, recA.presentation.photo);
  assert.deepEqual(recB.presentation.voice, recA.presentation.voice);
  // both invitations own their own sealed objects
  assert.ok(media._objects.has(`sealed/${c1.body.giftId}/${photoId}`));
  assert.ok(media._objects.has(`sealed/${c2.body.giftId}/${photoId}`));
  assert.ok(media._objects.has(`sealed/${c2.body.giftId}/${voiceId}`));
});

test("4.5-B reuse: revoking the source household never breaks the copied one", async () => {
  const db = makeFakeDb();
  const media = makeReuseMediaStore();
  const share = fakeShare();
  const photoId = await stagePhoto(media, A.uid);
  const c1 = await createGift({ db, decoded: A, media, share, body: eventCreateBody("张先生全家", { presentation: { photo: { assetId: photoId } } }) });
  const c2 = await createGift({ db, decoded: A, media, share, body: eventCreateBody("李女士", { eventCreate: undefined, eventId: c1.body.eventId, presentation: { photo: { fromGiftId: c1.body.giftId } } }) });
  const { revokeGift } = await import("./gift.mjs");
  const rv = await revokeGift({ db, decoded: A, media, body: { token: c1.body.token } });
  assert.equal(rv.status, 200);
  assert.equal(media._objects.has(`sealed/${c1.body.giftId}/${photoId}`), false); // A's copy gone
  assert.equal(media._objects.has(`sealed/${c2.body.giftId}/${photoId}`), true);  // B untouched
  const ret = await retrieveGift({ db, media, body: { token: c2.body.token } });
  assert.equal(ret.status, 200);
  assert.ok(JSON.stringify(ret.body).includes(`sealed/${c2.body.giftId}/${photoId}`)); // B still presigns its own copy
});

test("4.5-B reuse security: cross-sender 403; cross-event/revoked/missing-role/no-event/both-fields 400", async () => {
  const db = makeFakeDb();
  const media = makeReuseMediaStore();
  const share = fakeShare();
  const photoId = await stagePhoto(media, A.uid);
  const mine = await createGift({ db, decoded: A, media, share, body: eventCreateBody("张先生全家", { presentation: { photo: { assetId: photoId } } }) });
  const otherPhotoId = await stagePhoto(media, B.uid);
  const theirs = await createGift({ db, decoded: B, media, share, body: eventCreateBody("别家", { presentation: { photo: { assetId: otherPhotoId } } }) });

  // cross-sender: B's event trying to reuse A's gift
  const crossSender = await createGift({ db, decoded: B, media, share, body: eventCreateBody("别家二", { eventCreate: undefined, eventId: theirs.body.eventId, presentation: { photo: { fromGiftId: mine.body.giftId } } }) });
  assert.equal(crossSender.status, 403);
  // cross-event: A's SECOND event reusing from the first event's gift
  const secondEvent = await createGift({ db, decoded: A, media, share, body: eventCreateBody("另一场") });
  const crossEvent = await createGift({ db, decoded: A, media, share, body: eventCreateBody("另一场二", { eventCreate: undefined, eventId: secondEvent.body.eventId, presentation: { photo: { fromGiftId: mine.body.giftId } } }) });
  assert.equal(crossEvent.status, 400);
  // missing role on source
  const noVoice = await createGift({ db, decoded: A, media, share, body: eventCreateBody("三户", { eventCreate: undefined, eventId: mine.body.eventId, presentation: { voice: { fromGiftId: mine.body.giftId } } }) });
  assert.equal(noVoice.status, 400);
  // both assetId and fromGiftId
  const both = await createGift({ db, decoded: A, media, share, body: eventCreateBody("四户", { eventCreate: undefined, eventId: mine.body.eventId, presentation: { photo: { assetId: "a", fromGiftId: mine.body.giftId } } }) });
  assert.equal(both.status, 400);
  // reuse outside any event
  const noEvent = await createGift({ db, decoded: A, media, share, body: { message: "hi", occasion: FACTS, presentation: { photo: { fromGiftId: mine.body.giftId } } } });
  assert.equal(noEvent.status, 400);
  // revoked source
  const { revokeGift } = await import("./gift.mjs");
  await revokeGift({ db, decoded: A, media, body: { token: mine.body.token } });
  const fromRevoked = await createGift({ db, decoded: A, media, share, body: eventCreateBody("五户", { eventCreate: undefined, eventId: mine.body.eventId, presentation: { photo: { fromGiftId: mine.body.giftId } } }) });
  assert.equal(fromRevoked.status, 400);
});

test("4.5-B reuse atomicity: copy failure compensates and leaves source + event intact", async () => {
  const db = makeFakeDb();
  const media = makeReuseMediaStore();
  const share = fakeShare();
  const photoId = await stagePhoto(media, A.uid);
  const c1 = await createGift({ db, decoded: A, media, share, body: eventCreateBody("张先生全家", { presentation: { photo: { assetId: photoId } } }) });
  media.failReuseCopy = true;
  const c2 = await createGift({ db, decoded: A, media, share, body: eventCreateBody("李女士", { eventCreate: undefined, eventId: c1.body.eventId, presentation: { photo: { fromGiftId: c1.body.giftId } } }) });
  assert.equal(c2.status, 502);
  assert.ok(media._objects.has(`sealed/${c1.body.giftId}/${photoId}`)); // source untouched
  assert.equal(eventDocs(db).length, 1); // attached event never compensated
  const sealedB = [...media._objects.keys()].filter((k) => k.startsWith("sealed/") && !k.includes(c1.body.giftId));
  assert.equal(sealedB.length, 0); // nothing stranded for the failed invitation
});

test("4.5-B: rsvp isolation across household invitations (overwrite stays per-token)", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const c1 = await createGift({ db, decoded: A, share, body: eventCreateBody("张先生全家") });
  const c2 = await createGift({ db, decoded: A, share, body: eventCreateBody("李女士", { eventCreate: undefined, eventId: c1.body.eventId }) });
  await rsvpGift({ db, body: { token: c1.body.token, status: "accepted", adultCount: 2, childCount: 1 } });
  await rsvpGift({ db, body: { token: c2.body.token, status: "declined" } });
  const a = db._store.get(`${GIFT_COLLECTION}/${c1.body.giftId}`);
  const b = db._store.get(`${GIFT_COLLECTION}/${c2.body.giftId}`);
  assert.equal(a.rsvpStatus, "accepted");
  assert.equal(a.rsvpAdultCount, 2);
  assert.equal(b.rsvpStatus, "declined");
  assert.equal(b.rsvpAdultCount, 0);
  assert.equal(a.recipientLabel, "张先生全家");
  assert.equal(b.recipientLabel, "李女士");
});

test("4.5-C §12: shared-link invitation never enters household aggregate", async () => {
  const db = makeFakeDb();
  const share = fakeShare();
  const c1 = await createGift({ db, decoded: A, share, body: eventCreateBody("张先生全家") });
  const shared = await createGift({
    db, decoded: A, share,
    body: eventCreateBody("各位亲友", { eventCreate: undefined, eventId: c1.body.eventId, sharedDistribution: true }),
  });
  await rsvpGift({ db, body: { token: c1.body.token, status: "accepted", adultCount: 2, childCount: 1 } });
  await rsvpGift({ db, body: { token: shared.body.token, status: "accepted", adultCount: 9, childCount: 9 } });
  const det = await eventDetail({ db, decoded: A, body: { eventId: c1.body.eventId }, giftCollection: GIFT_COLLECTION });
  assert.deepEqual(det.body.aggregate, {
    adultTotal: 2, childTotal: 1, attendingTotal: 3,
    acceptedGroups: 1, declinedGroups: 0, pendingGroups: 0,
  }); // the shared link's 9/9 is invisible to household statistics
  const row = det.body.invitations.find((i) => i.recipientLabel === "各位亲友");
  assert.equal(row.sharedDistribution, true); // but the row itself stays honest
  const ret = await retrieveGift({ db, body: { token: shared.body.token } });
  assert.equal(ret.body.sharedDistribution, true); // recipient UI can adapt
  const retH = await retrieveGift({ db, body: { token: c1.body.token } });
  assert.equal(retH.body.sharedDistribution, false);
});

test("4.5-D: library rows expose presentation role FLAGS only (no urls/assetIds)", async () => {
  const db = makeFakeDb();
  const c = await createGift({ db, decoded: A, share: fakeShare(), body: eventCreateBody("张先生全家", { presentation: { musicThemeId: "wedding_warm_piano_v1" } }) });
  const det = await eventDetail({ db, decoded: A, body: { eventId: c.body.eventId }, giftCollection: GIFT_COLLECTION });
  const row = det.body.invitations[0];
  assert.deepEqual(row.presentationRoles, { photo: false, voice: false, musicThemeId: "wedding_warm_piano_v1" });
  assert.equal(JSON.stringify(row).includes("assetId"), false);
  assert.equal(JSON.stringify(row).includes("url"), false);
});


// --- Founder QA: sender sees the household's dietary note -------------------

test("dietary note reaches the sender's Event management surface only", async () => {
  const db = makeFakeDb();
  const created = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "邀请", occasion: FACTS, eventCreate: true, recipientLabel: "The Smith Family", accessMode: "direct" },
  });
  assert.equal(created.status, 200);
  const eventId = created.body.eventId;
  await rsvpGift({ db, body: { token: created.body.token, status: "accepted", adultCount: 3, childCount: 0, dietaryRequirements: "Vegetarian, nut allergy" } });

  const detail = await eventDetail({ db, decoded: A, body: { eventId }, giftCollection: GIFT_COLLECTION });
  assert.equal(detail.status, 200);
  const row = detail.body.invitations.find((i) => i.recipientLabel === "The Smith Family");
  assert.equal(row.rsvp.status, "accepted");
  assert.equal(row.rsvp.adultCount, 3);
  assert.equal(row.rsvp.dietaryRequirements, "Vegetarian, nut allergy");
  assert.equal(detail.body.aggregate.attendingTotal, 3);

  // The household sees its OWN note back (they must be able to edit it)…
  const opened = await retrieveGift({ db, body: { token: created.body.token } });
  assert.equal(opened.status, 200);
  assert.equal(opened.body.rsvpDietary, "Vegetarian, nut allergy");

  // …but a SHARED link never exposes one household's note to everyone.
  const shared = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "邀请", occasion: FACTS, eventId, recipientLabel: "Direct share",
            sharedDistribution: true, accessMode: "direct" },
  });
  await rsvpGift({ db, body: { token: shared.body.token, status: "accepted", adultCount: 1, childCount: 0, dietaryRequirements: "Vegan" } });
  const openedShared = await retrieveGift({ db, body: { token: shared.body.token } });
  assert.equal(openedShared.body.rsvpDietary, null);
});
