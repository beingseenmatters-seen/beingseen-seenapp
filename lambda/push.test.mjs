/**
 * FCM Phase 1 — Quick Reply push notifications, through the REAL handlers.
 *
 * LOCKED contract under test (founder §23, all 12 items):
 *   push fires ONLY after a committed NEW reply; refusals/duplicates/quota
 *   never notify; one logical event per reply (deterministic
 *   pushEvents/quick_reply_{replyId}); multi-device fan-out targets ONLY the
 *   gift owner's registered tokens; dead tokens are pruned, transient
 *   failures leave both the reply and the token intact; the payload carries
 *   the sanitized signature label but NEVER the reply text; and nothing in
 *   the push path can touch Credits.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { makeFakeDb } from "./billing.test.mjs";
import { CREDIT_ACCOUNTS, CREDIT_LEDGER } from "./billing.mjs";
import {
  createGift,
  retrieveGift,
  quickReply,
  GIFT_REPLIES_COLLECTION,
  REPLY_FREE_MAX,
} from "./gift.mjs";
import {
  PUSH_EVENTS_COLLECTION,
  PUSH_TYPES,
  PUSH_TOKEN_MAX,
  quickReplyPushCopy,
  sendQuickReplyPush,
  registerPushToken,
  unregisterPushToken,
} from "./push.mjs";

const SENDER = { uid: "sender-1" };
const NOW = Date.UTC(2026, 8, 6, 12, 0, 0);
const KEY = (s) => `qk_${s}_00000000`.slice(0, 20);

const fakeShare = () => ({
  seal: async (t, ctx) => `S|${ctx}|${t}`,
  open: async (sealed, ctx) => {
    const [tag, c, t] = String(sealed).split("|");
    if (tag !== "S" || c !== ctx) throw new Error("context_mismatch");
    return t;
  },
});

const makeFakeMessaging = () => {
  const sent = [];
  const failWith = new Map();
  return {
    sent,
    failToken: (token, code) => failWith.set(token, code),
    send: async (msg) => {
      const code = failWith.get(msg.token);
      if (code) {
        const e = new Error(code);
        e.errorInfo = { code };
        throw e;
      }
      sent.push(msg);
      return "projects/x/messages/1";
    },
  };
};

const pushEvents = (db) => [...db._store.entries()].filter(([k]) => k.startsWith(`${PUSH_EVENTS_COLLECTION}/`)).map(([k, v]) => ({ id: k, ...v }));
const billingDocs = (db) =>
  [...db._store.keys()].filter((k) => k.startsWith(`${CREDIT_ACCOUNTS}/`) || k.startsWith(`${CREDIT_LEDGER}/`));
const seedDevices = (db, uid, tokens) =>
  db._store.set(`users/${uid}`, { fcmTokens: tokens.map((t, i) => ({ token: t, platform: i % 2 ? "android" : "ios", updatedAt: NOW })) });

async function openSourceGift(db, share) {
  const res = await createGift({
    db, decoded: SENDER, now: NOW, media: null, share,
    body: { message: "original secret 谢谢你的心意正文", accessMode: "direct", recipientLabel: "妈妈" },
  });
  const retrieved = await retrieveGift({ db, body: { token: res.body.token }, now: NOW });
  assert.equal(retrieved.status, 200);
  return { grant: retrieved.body.replyGrant };
}

const reply = (db, messaging, grant, key, extra = {}) =>
  quickReply({ db, messaging, now: NOW, body: { replyGrant: grant, message: "收到啦，谢谢！", idempotencyKey: KEY(key), ...extra } });

// ---- §23.1/6/7: success → one event, owner's devices only -------------------

test("successful Quick Reply → ONE push event; BOTH owner devices targeted; nobody else's token reachable", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  seedDevices(db, SENDER.uid, ["tokA", "tokB"]);
  seedDevices(db, "bystander-1", ["tokEVIL"]); // any other identity's device
  const { grant } = await openSourceGift(db, fakeShare());

  const res = await reply(db, messaging, grant, "r1", { signature: "妈妈" });
  assert.equal(res.status, 200);
  assert.equal(res.body.duplicate, false);

  const events = pushEvents(db);
  assert.equal(events.length, 1);
  assert.equal(events[0].type, "quick_reply");
  assert.equal(events[0].ownerUid, SENDER.uid);
  assert.equal(events[0].status, "sent");
  assert.equal(events[0].deviceCount, 2, "one logical event fans out to the owner's devices");
  assert.equal(events[0].failureCount, 0);
  assert.ok(events[0].id.includes("quick_reply_"), "deterministic quick_reply_<replyId> identity");

  assert.equal(messaging.sent.length, 2);
  assert.deepEqual(messaging.sent.map((m) => m.token).sort(), ["tokA", "tokB"]);
  assert.ok(messaging.sent.every((m) => m.token !== "tokEVIL"), "only server-side gift ownership targets devices");
});

// ---- §23.2/3/4: refusals never notify ---------------------------------------

test("invalid grant / failed reply / quota exceeded → ZERO push events, zero sends", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  seedDevices(db, SENDER.uid, ["tokA"]);
  const { grant } = await openSourceGift(db, fakeShare());

  const bad = await reply(db, messaging, "not-a-real-grant", "bad1");
  assert.equal(bad.status, 401);
  const malformed = await quickReply({ db, messaging, now: NOW, body: { replyGrant: grant, message: "", idempotencyKey: KEY("bad2") } });
  assert.equal(malformed.status, 400);
  assert.equal(pushEvents(db).length, 0);
  assert.equal(messaging.sent.length, 0);

  // Fill the 5-reply quota, then the sixth refusal must not notify.
  for (let i = 1; i <= REPLY_FREE_MAX; i++) {
    const r = await reply(db, messaging, grant, `q${i}`);
    assert.equal(r.status, 200);
  }
  assert.equal(pushEvents(db).length, REPLY_FREE_MAX);
  const sixth = await reply(db, messaging, grant, "q6");
  assert.equal(sixth.status, 409);
  assert.equal(pushEvents(db).length, REPLY_FREE_MAX, "quota refusal creates no event");
});

// ---- §23.5: retry of the same reply -----------------------------------------

test("same Quick Reply retried → duplicate reply, NO second logical push", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  seedDevices(db, SENDER.uid, ["tokA"]);
  const { grant } = await openSourceGift(db, fakeShare());

  const first = await reply(db, messaging, grant, "same");
  assert.equal(first.body.duplicate, false);
  const retry = await reply(db, messaging, grant, "same");
  assert.equal(retry.status, 200);
  assert.equal(retry.body.duplicate, true);
  assert.equal(pushEvents(db).length, 1);
  assert.equal(messaging.sent.length, 1);

  // Belt: even a direct duplicate call into the push module collapses on the
  // deterministic event id.
  const evId = pushEvents(db)[0].id.split("/").pop();
  const replyId = evId.replace("quick_reply_", "");
  const dup = await sendQuickReplyPush({ db, messaging, ownerUid: SENDER.uid, giftId: "g", replyId, now: NOW });
  assert.equal(dup.duplicate, true);
  assert.equal(messaging.sent.length, 1);

  // A SECOND genuine reply is a new logical event.
  const second = await reply(db, messaging, grant, "fresh");
  assert.equal(second.body.duplicate, false);
  assert.equal(pushEvents(db).length, 2);
  assert.equal(messaging.sent.length, 2);
});

// ---- §23.8: dead-token pruning ----------------------------------------------

test("permanently dead token is pruned from the shared registry; next push targets only live devices", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  seedDevices(db, SENDER.uid, ["tokLive", "tokDead"]);
  messaging.failToken("tokDead", "messaging/registration-token-not-registered");
  const { grant } = await openSourceGift(db, fakeShare());

  const r1 = await reply(db, messaging, grant, "d1");
  assert.equal(r1.status, 200);
  const ev1 = pushEvents(db)[0];
  assert.equal(ev1.deviceCount, 1);
  assert.equal(ev1.failureCount, 0, "a dead token is invalidated, not counted as transient failure");
  assert.deepEqual(db._store.get(`users/${SENDER.uid}`).fcmTokens.map((t) => t.token), ["tokLive"]);

  const r2 = await reply(db, messaging, grant, "d2");
  assert.equal(r2.status, 200);
  assert.equal(messaging.sent.filter((m) => m.token === "tokDead").length, 0, "never sends to a known dead token again");
});

// ---- §23.9: transient FCM failure -------------------------------------------

test("transient FCM failure: reply intact + saved, token kept, event recorded as failed", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  seedDevices(db, SENDER.uid, ["tokA"]);
  messaging.failToken("tokA", "messaging/internal-error");
  const { grant } = await openSourceGift(db, fakeShare());

  const res = await reply(db, messaging, grant, "t1");
  assert.equal(res.status, 200, "push failure NEVER surfaces as reply failure");
  assert.equal(res.body.ok, true);
  assert.equal([...db._store.keys()].filter((k) => k.startsWith(`${GIFT_REPLIES_COLLECTION}/`)).length, 1);
  const ev = pushEvents(db)[0];
  assert.equal(ev.status, "failed");
  assert.equal(ev.failureCount, 1);
  assert.deepEqual(db._store.get(`users/${SENDER.uid}`).fcmTokens.map((t) => t.token), ["tokA"], "transient error keeps the token");
});

test("messaging unavailable / owner has no devices: reply succeeds, event records the outcome", async () => {
  const db = makeFakeDb();
  const { grant } = await openSourceGift(db, fakeShare());
  const noMsg = await reply(db, null, grant, "n1");
  assert.equal(noMsg.status, 200);
  assert.equal(pushEvents(db)[0].status, "skipped_no_messaging");

  const db2 = makeFakeDb();
  const messaging = makeFakeMessaging();
  const g2 = await openSourceGift(db2, fakeShare());
  const res = await reply(db2, messaging, g2.grant, "n2"); // no users doc at all
  assert.equal(res.status, 200);
  assert.equal(pushEvents(db2)[0].status, "no_devices");
  assert.equal(messaging.sent.length, 0);
});

// ---- §23.10/11: payload privacy ---------------------------------------------

test("payload: sanitized signature label only; the reply TEXT never leaves the server", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  seedDevices(db, SENDER.uid, ["tokA"]);
  const { grant } = await openSourceGift(db, fakeShare());

  await reply(db, messaging, grant, "p1", { signature: "  妈妈 <script>  " });
  const msg = messaging.sent[0];
  // Audible by default (2026-09-07): normal APNs + Android sound, never a
  // critical alert. Copy/privacy/deep-link data all unchanged.
  assert.equal(msg.apns.payload.aps.sound, "default");
  assert.equal(msg.android.notification.sound, "default");
  assert.equal(msg.apns.payload.aps.critical, undefined, "normal sound, never a critical alert");
  assert.equal(msg.notification.title, "收到一条回复");
  assert.ok(msg.notification.body.includes("回复了你送出的心意"), "signature path copy");
  assert.ok(!msg.notification.body.includes(" "), "sanitized display label only");
  const flat = JSON.stringify(msg);
  assert.ok(!flat.includes("收到啦"), "reply body text NEVER rides the push payload");
  assert.ok(!flat.includes("谢谢"), "reply body text NEVER rides the push payload");
  assert.equal(msg.data.type, "quick_reply");
  // Deep link (2026-09-06): tap lands on the EXACT replied gift's reply list.
  assert.ok(msg.data.giftId, "giftId is an explicit structured field");
  assert.ok(msg.data.replyId, "replyId is an explicit structured field");
  assert.ok(msg.data.url.includes("/library?gift="), "web-fallback url deep-links to the gift");
  assert.ok(msg.data.url.includes("view=replies"), "web-fallback url opens the reply list");
  assert.ok(msg.data.url.includes(`reply=${encodeURIComponent(msg.data.replyId)}`), "web-fallback url carries the reply id");

  // No-signature copy stays generic; en copy per founder spec.
  assert.deepEqual(quickReplyPushCopy({}), { title: "收到一条回复", body: "有人回复了你送出的心意。" });
  assert.deepEqual(quickReplyPushCopy({ signature: "妈妈" }).body, "妈妈回复了你送出的心意。");
  assert.deepEqual(quickReplyPushCopy({ language: "en" }), { title: "You received a reply", body: "Someone replied to your Gift." });
  assert.equal(quickReplyPushCopy({ signature: "Mum", language: "en" }).body, "Mum replied to your Gift.");
});

// ---- Correction §1/§2/§6: Gift.Seen token lifecycle -------------------------

test("register: server binds the token to the VERIFIED caller uid with app:giftseen; re-register dedupes; cap keeps newest", async () => {
  const db = makeFakeDb();
  const anon = await registerPushToken({ db, decoded: null, body: { token: "t1" } });
  assert.equal(anon.status, 401);

  await registerPushToken({ db, decoded: SENDER, body: { token: "gs-1", platform: "ios" }, now: NOW });
  const doc = db._store.get(`users/${SENDER.uid}`);
  assert.deepEqual(doc.fcmTokens, [{ token: "gs-1", platform: "ios", app: "giftseen", updatedAt: NOW }]);

  // Refresh/re-register of the SAME token updates in place — one entry.
  await registerPushToken({ db, decoded: SENDER, body: { token: "gs-1", platform: "ios" }, now: NOW + 5 });
  assert.equal(db._store.get(`users/${SENDER.uid}`).fcmTokens.length, 1);
  assert.equal(db._store.get(`users/${SENDER.uid}`).fcmTokens[0].updatedAt, NOW + 5);

  for (let i = 0; i < PUSH_TOKEN_MAX + 3; i++) {
    await registerPushToken({ db, decoded: SENDER, body: { token: `many-${i}`, platform: "ios" }, now: NOW + i });
  }
  assert.equal(db._store.get(`users/${SENDER.uid}`).fcmTokens.length, PUSH_TOKEN_MAX, "capped, newest kept");
});

test("register preserves LEGACY Seen entries; unregister removes ONLY the submitted device token", async () => {
  const db = makeFakeDb();
  db._store.set(`users/${SENDER.uid}`, {
    someProfileField: "untouched",
    fcmTokens: [{ token: "seen-legacy", platform: "ios", updatedAt: NOW - 999 }],
  });
  await registerPushToken({ db, decoded: SENDER, body: { token: "gs-1", platform: "ios" }, now: NOW });
  await registerPushToken({ db, decoded: SENDER, body: { token: "gs-2", platform: "android" }, now: NOW });
  const doc = db._store.get(`users/${SENDER.uid}`);
  assert.equal(doc.someProfileField, "untouched", "merge-set never clobbers the identity doc");
  assert.equal(doc.fcmTokens.length, 3);
  assert.equal(doc.fcmTokens[0].token, "seen-legacy", "legacy Seen entry (no app field) preserved");

  const res = await unregisterPushToken({ db, decoded: SENDER, body: { token: "gs-1" }, now: NOW });
  assert.equal(res.body.removed, true);
  const after = db._store.get(`users/${SENDER.uid}`).fcmTokens;
  assert.deepEqual(after.map((t) => t.token), ["seen-legacy", "gs-2"], "only that device released — Seen token and the other Gift.Seen device stay");
  const again = await unregisterPushToken({ db, decoded: SENDER, body: { token: "gs-1" }, now: NOW });
  assert.equal(again.body.removed, false, "idempotent");
});

// ---- Correction §2/§5: app-identity targeting -------------------------------

test("targeting: Gift.Seen devices preferred (ALL of them fan out); legacy Seen devices excluded when a Gift.Seen device exists", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  db._store.set(`users/${SENDER.uid}`, {
    fcmTokens: [
      { token: "seen-old", platform: "ios", updatedAt: NOW }, // legacy, no app
      { token: "gs-iphone", platform: "ios", app: "giftseen", updatedAt: NOW },
      { token: "gs-ipad", platform: "ios", app: "giftseen", updatedAt: NOW },
    ],
  });
  const { grant } = await openSourceGift(db, fakeShare());
  await reply(db, messaging, grant, "target1");
  assert.deepEqual(messaging.sent.map((m) => m.token).sort(), ["gs-ipad", "gs-iphone"],
    "one logical event → every Gift.Seen device, NO cross-app double notification");
  assert.equal(pushEvents(db)[0].deviceCount, 2);
});

test("targeting fallback: with NO Gift.Seen device, legacy Seen tokens keep the sender covered", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  db._store.set(`users/${SENDER.uid}`, {
    fcmTokens: [{ token: "seen-old", platform: "ios", updatedAt: NOW }],
  });
  const { grant } = await openSourceGift(db, fakeShare());
  await reply(db, messaging, grant, "fb1");
  assert.deepEqual(messaging.sent.map((m) => m.token), ["seen-old"]);
});

// ---- Correction §4: seal-time notification language -------------------------

test("notifyLanguage sealed with the gift drives the push copy; legacy gifts fall back deterministically to zh", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  seedDevices(db, SENDER.uid, ["tokA"]);
  const share = fakeShare();
  // English-UI sender seals a simple gift.
  const created = await createGift({
    db, decoded: SENDER, now: NOW, media: null, share,
    body: { message: "for you", accessMode: "direct", recipientLabel: "Mum", notifyLanguage: "en" },
  });
  assert.equal(db._store.get(`giftMessages/${[...db._store.keys()].find((k) => k.startsWith("giftMessages/")).split("/")[1]}`).notifyLanguage, "en");
  const retrieved = await retrieveGift({ db, body: { token: created.body.token }, now: NOW });
  await quickReply({ db, messaging, now: NOW, body: { replyGrant: retrieved.body.replyGrant, message: "thanks!", idempotencyKey: KEY("en1"), signature: "Mum" } });
  assert.equal(messaging.sent[0].notification.title, "You received a reply");
  assert.equal(messaging.sent[0].notification.body, "Mum replied to your Gift.");

  // Legacy gift (no notifyLanguage, no occasion) → zh fallback.
  const db2 = makeFakeDb();
  const messaging2 = makeFakeMessaging();
  seedDevices(db2, SENDER.uid, ["tokB"]);
  const g2 = await openSourceGift(db2, share);
  await reply(db2, messaging2, g2.grant, "zh1");
  assert.equal(messaging2.sent[0].notification.title, "收到一条回复");

  // A junk notifyLanguage is refused at seal (whitelist) — field absent.
  const db3 = makeFakeDb();
  await createGift({
    db: db3, decoded: SENDER, now: NOW, media: null, share,
    body: { message: "x", accessMode: "direct", notifyLanguage: "fr" },
  });
  const rec3 = [...db3._store.entries()].find(([k]) => k.startsWith("giftMessages/"))[1];
  assert.equal(rec3.notifyLanguage, undefined);
});

// ---- §23.12: Credits isolation ----------------------------------------------

test("push path creates ZERO Credits documents; type registry implements quick_reply only", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  seedDevices(db, SENDER.uid, ["tokA"]);
  const { grant } = await openSourceGift(db, fakeShare());
  await reply(db, messaging, grant, "c1");
  assert.equal(billingDocs(db).length, 0, "no creditAccounts/creditLedger writes anywhere in the chain");

  assert.equal(PUSH_TYPES[0], "quick_reply");
  // Reserved names exist for later phases but NOTHING else may send: the
  // push module exposes exactly one send function.
  const mod = await import("./push.mjs");
  const senders = Object.keys(mod).filter((n) => n.toLowerCase().startsWith("send"));
  assert.deepEqual(senders, ["sendQuickReplyPush"]);
});
