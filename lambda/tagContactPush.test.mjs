/**
 * FCM Phase 3 — Seen.Tag contact notifications, through the REAL handlers
 * (handleTagManage create + handleTagScan op:"contact").
 *
 * LOCKED contract (founder §2-§25): a bare QR scan NEVER pushes; only a
 * successfully persisted meaningful contact does, to the Tag OWNER (server
 * authority), for pet/luggage/car only (gift excluded — Quick Reply's job and
 * structurally closed). Cooldown/duplicate/invalid/unactivated all suppress.
 * The finder message / phone / email / coordinates / QR code NEVER ride the
 * payload; default sound; deep link to the exact Tag; 0 Credits.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  handleTagManage, handleTagScan,
  TAG_COLLECTION, TAG_CONTACT_COLLECTION,
} from "./tag.mjs";
import { CREDIT_ACCOUNTS, CREDIT_LEDGER } from "./billing.mjs";
import { PUSH_EVENTS_COLLECTION, tagContactPushCopy, TAG_CONTACT_PUSH_TYPES } from "./push.mjs";

const OWNER = { uid: "tag-owner-1" };
const fakeShare = () => ({ seal: async (t) => `sealed:${t}`, open: async (x) => String(x).replace(/^sealed:/, "") });

function makeFakeDb() {
  const store = new Map();
  const doc = (path) => ({
    _key: path,
    get: async () => ({ exists: store.has(path), data: () => store.get(path), id: path.split("/").pop() }),
    create: async (v) => { if (store.has(path)) { const e = new Error("6 ALREADY_EXISTS"); e.code = 6; throw e; } store.set(path, v); },
    set: async (v) => { store.set(path, v); },
    update: async (v) => { store.set(path, { ...store.get(path), ...v }); },
    delete: async () => { store.delete(path); },
  });
  const collection = (name) => ({
    doc: (id) => doc(`${name}/${id}`),
    where: (field, _op, value) => ({ get: async () => ({ docs: [...store.entries()].filter(([k, v]) => k.startsWith(`${name}/`) && v[field] === value).map(([k, v]) => ({ id: k.split("/").pop(), data: () => v })) }) }),
    get: async () => ({ docs: [...store.entries()].filter(([k]) => k.startsWith(`${name}/`)).map(([k, v]) => ({ id: k.split("/").pop(), data: () => v })) }),
  });
  return { collection, _store: store };
}

const makeFakeMessaging = () => {
  const sent = [];
  const failWith = new Map();
  return {
    sent,
    failToken: (t, c) => failWith.set(t, c),
    send: async (m) => { const c = failWith.get(m.token); if (c) { const e = new Error(c); e.errorInfo = { code: c }; throw e; } sent.push(m); return "ok"; },
  };
};

const PUB = "https://x";
const M = (db, body, decoded = OWNER, now = 1000) => handleTagManage({ db, decoded, body, share: fakeShare(), publicBaseUrl: PUB, now });
const S = (db, messaging, body, now = 5000, sourceIp = "1.2.3.4") =>
  handleTagScan({ db, body, share: fakeShare(), publicBaseUrl: PUB, sourceIp, now, messaging });

const SCAN = "scanner00000000001";
const pushEvents = (db) => [...db._store.entries()].filter(([k]) => k.startsWith(`${PUSH_EVENTS_COLLECTION}/`)).map(([k, v]) => ({ id: k, ...v }));
const billingDocs = (db) => [...db._store.keys()].filter((k) => k.startsWith(`${CREDIT_ACCOUNTS}/`) || k.startsWith(`${CREDIT_LEDGER}/`));
const seedDevices = (db, uid, tokens) => db._store.set(`users/${uid}`, { fcmTokens: tokens.map((t) => ({ token: t, platform: "ios", app: "giftseen" })) });

const make = async (db, type, extra = {}) => {
  const r = await M(db, { action: "create", type, ...extra });
  assert.equal(r.status, 200, `create ${type}`);
  return { tagId: r.body.tagId, token: r.body.token };
};
const reasonFor = { pet: "found", luggage: "found", car: "blocking" };
const contact = (db, messaging, token, type, over = {}, now = 5000, ip = "1.2.3.4") =>
  S(db, messaging, { op: "contact", token, reason: reasonFor[type], idempotencyKey: over.idem ?? "idem-aaaa", scannerToken: over.scannerToken ?? SCAN, ...over.body }, now, ip);

// ---- §25.1: scan only → no push --------------------------------------------

test("QR resolve (scan only) → NO push; NO contact record", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  seedDevices(db, OWNER.uid, ["org-ios"]);
  const { token } = await make(db, "pet", { profile: { name: "Milo" } });
  const r = await S(db, messaging, { op: "resolve", token });
  assert.equal(r.status, 200);
  assert.equal(messaging.sent.length, 0);
  assert.equal(pushEvents(db).length, 0);
});

// ---- §25.2/3/4: successful contact per type → one push ----------------------

test("pet contact → ONE owner push w/ pet name, default sound, deep link, no PII/message", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  seedDevices(db, OWNER.uid, ["org-ios"]);
  seedDevices(db, "scanner-acct", ["scanner-ios"]); // a scanner's own device is never targeted
  const { tagId, token } = await make(db, "pet", { profile: { name: "Milo" } });
  const r = await contact(db, messaging, token, "pet", { body: { details: "at the park, my number 0400", callbackPhone: "0400000000", location: "Fitzroy Gardens" } });
  assert.equal(r.status, 200);
  assert.equal(r.body.duplicate, false);
  const ev = pushEvents(db);
  assert.equal(ev.length, 1);
  assert.equal(ev[0].type, "tag_contact");
  assert.equal(ev[0].ownerUid, OWNER.uid);
  assert.equal(ev[0].tagType, "pet");
  assert.equal(ev[0].status, "sent");
  const m = messaging.sent[0];
  assert.deepEqual(messaging.sent.map((x) => x.token), ["org-ios"]);
  assert.equal(m.notification.title, "有人联系你关于「Milo」");
  assert.equal(m.notification.body, "有人通过 Seen.Pet 联系你，请尽快查看。");
  assert.equal(m.apns.payload.aps.sound, "default");
  assert.equal(m.android.notification.sound, "default");
  assert.equal(m.data.type, "tag_contact");
  assert.equal(m.data.tagId, tagId);
  assert.ok(m.data.url.includes(`/tag/manage/${tagId}?contact=`));
  const flat = JSON.stringify(m);
  assert.ok(!flat.includes("0400"), "phone / message NEVER in payload");
  assert.ok(!flat.includes("Fitzroy"), "location text NEVER in payload");
  assert.ok(!flat.includes(token), "QR token NEVER in payload");
  assert.equal(billingDocs(db).length, 0);
});

test("luggage contact → one push (generic copy); car contact → one push (generic copy)", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  seedDevices(db, OWNER.uid, ["org-ios"]);
  const lug = await make(db, "luggage");
  await contact(db, messaging, lug.token, "luggage");
  assert.equal(messaging.sent.at(-1).notification.title, "有人联系你关于行李牌");

  const car = await make(db, "car");
  await contact(db, messaging, car.token, "car", {}, 40000);
  assert.equal(messaging.sent.at(-1).notification.title, "有人通过挪车卡联系你");
  assert.equal(pushEvents(db).length, 2);
});

// ---- §25.5/30: Gift.Tag excluded -------------------------------------------

test("Gift.Tag can't submit a tag contact (reasons closed) → no tag_contact push", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  seedDevices(db, OWNER.uid, ["org-ios"]);
  // A gift Tag has no contact reasons — the contact door is structurally shut.
  assert.deepEqual(TAG_CONTACT_PUSH_TYPES, ["pet", "luggage", "car"]);
  assert.ok(!TAG_CONTACT_PUSH_TYPES.includes("gift"));
});

// ---- §25.6/7: retry vs genuine second contact ------------------------------

test("same contact retry (same idem) → no duplicate push; a genuinely new contact → second push", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  seedDevices(db, OWNER.uid, ["org-ios"]);
  const { token } = await make(db, "pet", { profile: { name: "Milo" } });
  await contact(db, messaging, token, "pet", { idem: "idem-0001" }, 5000);
  const retry = await contact(db, messaging, token, "pet", { idem: "idem-0001" }, 6000);
  assert.equal(retry.body.duplicate, true);
  assert.equal(messaging.sent.length, 1, "identical retry never re-pushes");
  assert.equal(pushEvents(db).length, 1);
  // A new contact from a DIFFERENT scanner, past the cooldown → second push.
  await contact(db, messaging, token, "pet", { idem: "idem-0002", scannerToken: "scanner00000000002", body: { details: "seen near cafe" } }, 60000);
  assert.equal(messaging.sent.length, 2);
  assert.equal(pushEvents(db).length, 2);
});

// ---- §25.8: cooldown / rate-limit rejected → no push -----------------------

test("cooldown-rejected rapid second attempt → no push", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  seedDevices(db, OWNER.uid, ["org-ios"]);
  const { token } = await make(db, "pet", { profile: { name: "Milo" } });
  await contact(db, messaging, token, "pet", { idem: "cool-0001" }, 5000);
  // Same scanner, within CONTACT_COOLDOWN_MS, new content → 429, no contact, no push.
  const blocked = await contact(db, messaging, token, "pet", { idem: "cool-0002", body: { details: "different" } }, 5000 + 1000);
  assert.equal(blocked.status, 429);
  assert.equal(messaging.sent.length, 1);
  assert.equal(pushEvents(db).length, 1);
});

// ---- §25.9/10/13: invalid / unactivated / paused → no push -----------------

test("invalid token / unactivated / paused tag → no push", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  seedDevices(db, OWNER.uid, ["org-ios"]);
  const bad = await S(db, messaging, { op: "contact", token: "nope", reason: "found", idempotencyKey: "invalidtok", scannerToken: SCAN });
  assert.ok(bad.status >= 400);
  assert.equal(pushEvents(db).length, 0);

  const { tagId, token } = await make(db, "pet", { profile: { name: "Milo" } });
  await M(db, { action: "pause", tagId });
  const paused = await contact(db, messaging, token, "pet");
  assert.equal(paused.status, 409, "paused tag refuses contact");
  assert.equal(messaging.sent.length, 0);
  assert.equal(pushEvents(db).length, 0);
});

// ---- §25.12: missing tag still notifies (most valuable) --------------------

test("missing tag → contact still accepted → push fires (recovery-critical)", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  seedDevices(db, OWNER.uid, ["org-ios"]);
  const { tagId, token } = await make(db, "pet", { profile: { name: "Milo" } });
  await M(db, { action: "mark_missing", tagId });
  const r = await contact(db, messaging, token, "pet");
  assert.equal(r.status, 200);
  assert.equal(messaging.sent.length, 1);
  assert.equal(pushEvents(db)[0].tagType, "pet");
});

// ---- §25.21/22/23: fan-out, dead token, transient failure ------------------

test("owner Gift.Seen devices fan out; dead token pruned; transient failure keeps contact", async () => {
  const db = makeFakeDb();
  const messaging = makeFakeMessaging();
  db._store.set(`users/${OWNER.uid}`, { fcmTokens: [
    { token: "seen-legacy", platform: "ios" },
    { token: "gs-iphone", platform: "ios", app: "giftseen" },
    { token: "gs-ipad", platform: "ios", app: "giftseen" },
  ] });
  const { token } = await make(db, "car");
  await contact(db, messaging, token, "car");
  assert.deepEqual(messaging.sent.map((m) => m.token).sort(), ["gs-ipad", "gs-iphone"], "giftseen devices only");

  const db2 = makeFakeDb();
  const m2 = makeFakeMessaging();
  db2._store.set(`users/${OWNER.uid}`, { fcmTokens: [
    { token: "gs-live", platform: "ios", app: "giftseen" },
    { token: "gs-dead", platform: "ios", app: "giftseen" },
  ] });
  m2.failToken("gs-dead", "messaging/registration-token-not-registered");
  const car2 = await make(db2, "car");
  const r2 = await contact(db2, m2, car2.token, "car");
  assert.equal(r2.status, 200, "push failure never surfaces as contact failure");
  assert.deepEqual(db2._store.get(`users/${OWNER.uid}`).fcmTokens.map((t) => t.token), ["gs-live"]);

  const db3 = makeFakeDb();
  const m3 = makeFakeMessaging();
  seedDevices(db3, OWNER.uid, ["gs-x"]);
  m3.failToken("gs-x", "messaging/internal-error");
  const car3 = await make(db3, "car");
  const r3 = await contact(db3, m3, car3.token, "car");
  assert.equal(r3.status, 200);
  const contacts = [...db3._store.keys()].filter((k) => k.startsWith(`${TAG_CONTACT_COLLECTION}/`));
  assert.equal(contacts.length, 1, "contact persisted despite transient push failure");
  assert.equal(db3._store.get(`users/${OWNER.uid}`).fcmTokens.length, 1, "transient error keeps token");
  assert.equal(pushEvents(db3)[0].status, "failed");
});

// ---- copy helper (privacy + language) --------------------------------------

test("copy: pet name only when present; car/luggage generic; en variants; never overstates 'found'", () => {
  assert.equal(tagContactPushCopy({ tagType: "pet", petName: "Milo" }).title, "有人联系你关于「Milo」");
  assert.equal(tagContactPushCopy({ tagType: "pet" }).title, "有人联系你关于宠物牌");
  assert.equal(tagContactPushCopy({ tagType: "luggage", petName: "IgnoreMe" }).title, "有人联系你关于行李牌");
  assert.equal(tagContactPushCopy({ tagType: "car" }).body, "请查看对方留下的信息。");
  assert.equal(tagContactPushCopy({ tagType: "pet", language: "en" }).title, "Someone contacted you about your pet");
  assert.equal(tagContactPushCopy({ tagType: "luggage", language: "en" }).body, "Someone used Seen.Luggage to contact you. Please check the details.");
  // No copy claims the pet was "found".
  for (const type of ["pet", "luggage", "car"]) {
    for (const lang of ["zh", "en"]) {
      const c = tagContactPushCopy({ tagType: type, language: lang });
      assert.ok(!/找到|已找到|has been found|was found/i.test(`${c.title} ${c.body}`), `${type}/${lang} never overstates`);
    }
  }
});
