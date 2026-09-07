/**
 * FCM Phase 2 — RSVP notifications, through the REAL rsvpGift / shared handler.
 *
 * LOCKED contract (founder §2-§24): a committed MEANINGFUL RSVP change notifies
 * the event ORGANIZER (server-derived senderUid — never a client target); a
 * message-only edit or an identical resubmission does NOT; one logical event
 * per meaningful state (rsvp_{hash(rsvpId|canonicalState)}); managed household
 * label shows, shared links stay generic; the RSVP message/phone/email never
 * ride the payload; default sound; 0 Credits.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeDb } from "./billing.test.mjs";
import { CREDIT_ACCOUNTS, CREDIT_LEDGER } from "./billing.mjs";
import { rsvpGift, GIFT_COLLECTION, sha256Hex } from "./gift.mjs";
import { canonicalRsvpState, rsvpReceivedPushCopy, PUSH_EVENTS_COLLECTION } from "./push.mjs";

const ORG = { uid: "organizer-1" };
const NOW = Date.UTC(2026, 8, 7, 12, 0, 0);

const makeFakeMessaging = () => {
  const sent = [];
  const failWith = new Map();
  return {
    sent,
    failToken: (t, c) => failWith.set(t, c),
    send: async (m) => {
      const c = failWith.get(m.token);
      if (c) { const e = new Error(c); e.errorInfo = { code: c }; throw e; }
      sent.push(m); return "ok";
    },
  };
};

const pushEvents = (db) => [...db._store.entries()].filter(([k]) => k.startsWith(`${PUSH_EVENTS_COLLECTION}/`)).map(([k, v]) => ({ id: k, ...v }));
const billingDocs = (db) => [...db._store.keys()].filter((k) => k.startsWith(`${CREDIT_ACCOUNTS}/`) || k.startsWith(`${CREDIT_LEDGER}/`));

const seedDevices = (db, uid, tokens) =>
  db._store.set(`users/${uid}`, { fcmTokens: tokens.map((t, i) => ({ token: t, platform: "ios", app: "giftseen", ...(i === 99 ? {} : {}) })) });

/** Seed a MANAGED event invitation gift directly (accessMode direct → no key). */
const seedManaged = (db, token, over = {}) => {
  const h = sha256Hex(token);
  db._store.set(`${GIFT_COLLECTION}/${h}`, {
    schemaVersion: 1, senderUid: ORG.uid, accessMode: "direct",
    recipientLabel: "Jason Family", eventId: "evt-1",
    occasion: { type: "wedding", language: "zh" },
    createdAt: NOW, expiresAt: NOW + 1e9, revoked: false,
    ...over,
  });
  return h;
};

const rsvp = (db, messaging, token, body, now = NOW) =>
  rsvpGift({ db, messaging, now, body: { token, ...body } });

const orgTokensTargeted = (messaging) => messaging.sent.map((m) => m.token);

// ---- §24.1/2: first accepted / declined → one push -------------------------

test("first accepted RSVP → ONE organizer push, household label, default sound, no reply/PII in payload", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  seedDevices(db, ORG.uid, ["org-ios"]);
  seedDevices(db, "guest-1", ["guest-ios"]); // the guest's own device must NEVER be targeted
  const token = "wedtok_managed_0001";
  seedManaged(db, token);

  const res = await rsvp(db, messaging, token, { status: "accepted", adultCount: 2, childCount: 0, recipientMessage: "See you!" });
  assert.equal(res.status, 200);
  const ev = pushEvents(db);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].type, "rsvp_received");
  assert.equal(ev[0].ownerUid, ORG.uid);
  assert.equal(ev[0].status, "sent");
  assert.equal(ev[0].deviceCount, 1);
  assert.ok(ev[0].id.includes("rsvp_"));
  const m = messaging.sent[0];
  assert.deepEqual(orgTokensTargeted(messaging), ["org-ios"]);   // §16 guest token untargeted
  assert.equal(m.notification.title, "收到新的出席回复");
  assert.equal(m.notification.body, "Jason Family 已确认参加。");
  assert.equal(m.apns.payload.aps.sound, "default");             // §19
  assert.equal(m.android.notification.sound, "default");
  assert.equal(m.data.type, "rsvp_received");
  assert.equal(m.data.eventId, "evt-1");
  assert.ok(m.data.url.includes("/library/event/evt-1"));         // §15 exact dashboard
  const flat = JSON.stringify(m);
  assert.ok(!flat.includes("See you"), "RSVP message NEVER in payload");   // §13
  assert.equal(billingDocs(db).length, 0);                        // §20
});

test("first declined RSVP → one push, declined copy", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  seedDevices(db, ORG.uid, ["org-ios"]);
  const token = "wedtok_dec_0001";
  seedManaged(db, token);
  await rsvp(db, messaging, token, { status: "declined" });
  assert.equal(messaging.sent[0].notification.body, "Jason Family 无法参加。");
  assert.equal(pushEvents(db)[0].response, "declined");
});

// ---- §24.3/4/13: party-size change vs identical retry -----------------------

test("accepted 2 → accepted 4 → SECOND push (party-size update copy); 4 → 4 retry → NO new push", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  seedDevices(db, ORG.uid, ["org-ios"]);
  const token = "wedtok_size_0001";
  seedManaged(db, token);

  await rsvp(db, messaging, token, { status: "accepted", adultCount: 2, childCount: 0 });
  await rsvp(db, messaging, token, { status: "accepted", adultCount: 4, childCount: 0 });
  assert.equal(messaging.sent.length, 2);
  assert.equal(messaging.sent[1].notification.title, "出席人数有更新");
  assert.equal(messaging.sent[1].notification.body, "Jason Family 更新了出席人数：4 人。");
  assert.equal(pushEvents(db).length, 2);

  // Identical retry (4 → 4): canonical state unchanged → no new logical push.
  await rsvp(db, messaging, token, { status: "accepted", adultCount: 4, childCount: 0 });
  assert.equal(messaging.sent.length, 2, "identical resubmission never re-pushes");
  assert.equal(pushEvents(db).length, 2);
});

// ---- §24.5/6: accepted↔declined transitions --------------------------------

test("accepted → declined → new push; declined → accepted → new push", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  seedDevices(db, ORG.uid, ["org-ios"]);
  const token = "wedtok_flip_0001";
  seedManaged(db, token);
  await rsvp(db, messaging, token, { status: "accepted", adultCount: 2, childCount: 0 });
  await rsvp(db, messaging, token, { status: "declined" });
  await rsvp(db, messaging, token, { status: "accepted", adultCount: 2, childCount: 0 });
  assert.equal(messaging.sent.length, 3);
  assert.deepEqual(messaging.sent.map((m) => m.notification.body), [
    "Jason Family 已确认参加。",
    "Jason Family 无法参加。",
    "Jason Family 已确认参加。",
  ]);
});

// ---- oscillation: the previous-timestamp anchor lets repeats notify --------

test("full oscillation accepted→declined→accepted→declined (distinct commit times) → four pushes", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  seedDevices(db, ORG.uid, ["org-ios"]);
  const token = "wedtok_osc_0001";
  seedManaged(db, token);
  // Production requests carry distinct Date.now() — the prior write's
  // timestamp is what distinguishes the two identical A→B transitions.
  await rsvp(db, messaging, token, { status: "accepted", adultCount: 2, childCount: 0 }, NOW);
  await rsvp(db, messaging, token, { status: "declined" }, NOW + 1000);
  await rsvp(db, messaging, token, { status: "accepted", adultCount: 2, childCount: 0 }, NOW + 2000);
  await rsvp(db, messaging, token, { status: "declined" }, NOW + 3000);
  assert.equal(messaging.sent.length, 4, "each committed transition notifies, even repeats");
  assert.equal(pushEvents(db).filter((e) => e.type === "rsvp_received").length, 4);
});

// ---- §24.7: concurrency ----------------------------------------------------

test("concurrent identical submissions → one logical push", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  seedDevices(db, ORG.uid, ["org-ios"]);
  const token = "wedtok_conc_0001";
  seedManaged(db, token);
  await Promise.all([
    rsvp(db, messaging, token, { status: "accepted", adultCount: 3, childCount: 1 }),
    rsvp(db, messaging, token, { status: "accepted", adultCount: 3, childCount: 1 }),
  ]);
  assert.equal(pushEvents(db).filter((e) => e.type === "rsvp_received").length, 1);
  assert.equal(messaging.sent.length, 1);
});

// ---- §24.8/9/14 (message-only, revoked): no push ---------------------------

test("message-only edit → NO push (attendance unchanged); revoked invitation → RSVP rejected, no push", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  seedDevices(db, ORG.uid, ["org-ios"]);
  const token = "wedtok_msg_0001";
  seedManaged(db, token);
  await rsvp(db, messaging, token, { status: "accepted", adultCount: 2, childCount: 0 });
  assert.equal(messaging.sent.length, 1);
  // Later message-only edit: no status → no attendance change → no push (§14).
  await rsvp(db, messaging, token, { recipientMessage: "Can we bring a gift?" });
  assert.equal(messaging.sent.length, 1, "message-only edit never pushes");

  // Revoked invitation: RSVP refused → no push.
  const revoked = "wedtok_rev_0001";
  seedManaged(db, revoked, { revoked: true });
  const r = await rsvp(db, messaging, revoked, { status: "accepted", adultCount: 1, childCount: 0 });
  assert.equal(r.status, 410);
  assert.equal(pushEvents(db).filter((e) => e.rsvpId === sha256Hex(revoked)).length, 0);
});

// ---- §24.6 language + §27 casual exclusion ---------------------------------

test("notifyLanguage drives copy (en); casual invitation is EXCLUDED this phase (audit-only)", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  seedDevices(db, ORG.uid, ["org-ios"]);
  const en = "wedtok_en_0001";
  seedManaged(db, en, { notifyLanguage: "en", occasion: { type: "birthday", language: "zh" } });
  await rsvp(db, messaging, en, { status: "accepted", adultCount: 2, childCount: 0 });
  assert.equal(messaging.sent[0].notification.title, "New RSVP");
  assert.equal(messaging.sent[0].notification.body, "Jason Family is attending.");

  const cas = "castok_0001";
  seedManaged(db, cas, { occasion: { type: "casual", language: "zh" } });
  await rsvp(db, messaging, cas, { status: "accepted" });
  assert.equal(messaging.sent.length, 1, "casual RSVP creates NO push in Phase 2");
  assert.equal(pushEvents(db).length, 1);
});

// ---- §24.11/12: shared link → generic copy (no responder name captured) ----

test("shared-link RSVP → organizer push with GENERIC copy (shared captures no responder name)", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  seedDevices(db, ORG.uid, ["org-ios"]);
  const token = "sharedtok_0001";
  seedManaged(db, token, { sharedDistribution: true, recipientLabel: "各位亲友" });
  const first = await rsvp(db, messaging, token, { status: "accepted", adultCount: 2, childCount: 0 });
  assert.equal(first.status, 200);
  const pt = first.body.participantToken;
  assert.ok(pt, "first shared responder is minted a participant token");
  assert.equal(messaging.sent[0].notification.body, "有人回复了你的邀请。", "shared → generic, never a household name");
  assert.equal(pushEvents(db)[0].type, "rsvp_received");

  // Same participant, identical resubmission → no new push.
  await rsvp(db, messaging, token, { status: "accepted", adultCount: 2, childCount: 0, participantToken: pt });
  assert.equal(messaging.sent.length, 1);
  // A DIFFERENT scanner (new participant) accepting → a separate logical push.
  await rsvp(db, messaging, token, { status: "accepted", adultCount: 1, childCount: 0 });
  assert.equal(messaging.sent.length, 2);
});

// ---- §24.15/16: organizer devices fan out; guest token never targeted ------

test("organizer's Gift.Seen devices fan out (one logical event); no cross-app double", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  db._store.set(`users/${ORG.uid}`, { fcmTokens: [
    { token: "seen-legacy", platform: "ios" },                 // legacy Seen (no app)
    { token: "gs-iphone", platform: "ios", app: "giftseen" },
    { token: "gs-ipad", platform: "ios", app: "giftseen" },
  ] });
  const token = "wedtok_multi_0001";
  seedManaged(db, token);
  await rsvp(db, messaging, token, { status: "accepted", adultCount: 2, childCount: 0 });
  assert.deepEqual(orgTokensTargeted(messaging).sort(), ["gs-ipad", "gs-iphone"]);
  assert.equal(pushEvents(db)[0].deviceCount, 2);
});

// ---- §24.17/18: dead token cleanup + transient failure ---------------------

test("dead token pruned; transient FCM failure leaves the RSVP committed", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  db._store.set(`users/${ORG.uid}`, { fcmTokens: [
    { token: "gs-live", platform: "ios", app: "giftseen" },
    { token: "gs-dead", platform: "ios", app: "giftseen" },
  ] });
  messaging.failToken("gs-dead", "messaging/registration-token-not-registered");
  const token = "wedtok_dead_0001";
  seedManaged(db, token);
  const res = await rsvp(db, messaging, token, { status: "accepted", adultCount: 2, childCount: 0 });
  assert.equal(res.status, 200, "push failure never surfaces as RSVP failure");
  assert.deepEqual(db._store.get(`users/${ORG.uid}`).fcmTokens.map((t) => t.token), ["gs-live"]);

  const db2 = makeFakeDb();
  const messaging2 = makeFakeMessaging();
  seedDevices(db2, ORG.uid, ["gs-x"]);
  messaging2.failToken("gs-x", "messaging/internal-error"); // transient
  const t2 = "wedtok_transient_0001";
  seedManaged(db2, t2);
  const r2 = await rsvp(db2, messaging2, t2, { status: "accepted", adultCount: 1, childCount: 0 });
  assert.equal(r2.status, 200);
  assert.equal(db2._store.get(`${GIFT_COLLECTION}/${sha256Hex(t2)}`).rsvpStatus, "accepted", "RSVP committed");
  assert.equal(db2._store.get(`users/${ORG.uid}`).fcmTokens.length, 1, "transient error keeps the token");
  assert.equal(pushEvents(db2)[0].status, "failed");
});

// ---- pure helpers ----------------------------------------------------------

test("canonical state excludes message/dietary/timestamps; copy is privacy-safe", () => {
  assert.equal(canonicalRsvpState({ response: "accepted", adultCount: 2, childCount: 1 }), "accepted|2|1");
  assert.equal(canonicalRsvpState({ response: "accepted", adultCount: 2, childCount: 1 }),
    canonicalRsvpState({ response: "accepted", adultCount: 2, childCount: 1 }), "deterministic");
  assert.notEqual(canonicalRsvpState({ response: "accepted", adultCount: 2 }), canonicalRsvpState({ response: "accepted", adultCount: 4 }));
  assert.notEqual(canonicalRsvpState({ response: "accepted" }), canonicalRsvpState({ response: "declined" }));
  // No label → generic (never fabricate identity from anything).
  assert.equal(rsvpReceivedPushCopy({ label: null, response: "accepted" }).body, "有人回复了你的邀请。");
  assert.equal(rsvpReceivedPushCopy({ label: null, response: "declined", language: "en" }).body, "Someone responded to your invitation.");
});
