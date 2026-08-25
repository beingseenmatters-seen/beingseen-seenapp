/**
 * Seen.Tag / Seen.Car V1 — one Tag engine, owner plane + anonymous scanner plane.
 *
 * Proves: an authenticated owner creates a Car tag; an anonymous scanner (no
 * login) resolves the public surface and submits ONE contact; the callback phone
 * is owner-only; the scanner can never mutate a Tag; owner isolation; abuse
 * controls (idempotency, per-scanner cap, cooldown); pause/reactivate with a
 * durable QR; and Pet/Luggage stay reserved.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  handleTagManage, handleTagScan, TAG_TYPES, RESERVED_TAG_TYPES, DEFAULT_OWNER_MESSAGE,
  TAG_COLLECTION, TAG_CONTACT_COLLECTION, TAG_EVENT_COLLECTION, TAG_CONTACT_PHOTO_COLLECTION,
  TAG_CODE_COLLECTION, TAG_BATCH_COLLECTION,
} from "./tag.mjs";

const OWNER = { uid: "owner-1" };
const OTHER = { uid: "owner-2" };
const fakeShare = () => ({ seal: async (t) => `sealed:${t}`, open: async (x) => String(x).replace(/^sealed:/, "") });

function makeFakeDb() {
  const store = new Map();
  let txConflictsLeft = 0;
  const doc = (path) => ({
    _key: path,
    get: async () => ({ exists: store.has(path), data: () => store.get(path), id: path.split("/").pop() }),
    create: async (v) => {
      if (store.has(path)) { const e = new Error("6 ALREADY_EXISTS"); e.code = 6; throw e; }
      store.set(path, v);
    },
    set: async (v) => { store.set(path, v); },
    update: async (v) => { store.set(path, { ...store.get(path), ...v }); },
    delete: async () => { store.delete(path); },
  });
  const collection = (name) => ({
    doc: (id) => doc(`${name}/${id}`),
    where: (field, _op, value) => ({
      get: async () => ({ docs: [...store.entries()].filter(([k, v]) => k.startsWith(`${name}/`) && v[field] === value).map(([k, v]) => ({ id: k.split("/").pop(), data: () => v })) }),
    }),
    get: async () => ({ docs: [...store.entries()].filter(([k]) => k.startsWith(`${name}/`)).map(([k, v]) => ({ id: k.split("/").pop(), data: () => v })) }),
  });
  const runTransaction = async (fn) => {
    for (;;) {
      const writes = [];
      const tx = {
        get: async (ref) => ({ exists: store.has(ref._key), data: () => store.get(ref._key) }),
        update: (ref, patch) => void writes.push(() => store.set(ref._key, { ...store.get(ref._key), ...patch })),
        set: (ref, v) => void writes.push(() => store.set(ref._key, { ...v })),
      };
      const out = await fn(tx);
      if (txConflictsLeft > 0) { txConflictsLeft -= 1; continue; } // discard writes, retry fn
      writes.forEach((w) => w());
      return out;
    }
  };
  return { collection, runTransaction, _injectTxConflicts: (n) => { txConflictsLeft = n; }, _store: store };
}

const PUB = "https://x";
const M = (db, body, decoded = OWNER, now = 1000) => handleTagManage({ db, decoded, body, share: fakeShare(), publicBaseUrl: PUB, now });
const S = (db, body, now = 5000, sourceIp = "1.2.3.4") => handleTagScan({ db, body, share: fakeShare(), publicBaseUrl: PUB, sourceIp, now });
const SCAN = "scanner00000000001"; // 18 chars, matches SCANNER_TOKEN_OK

async function makeCar(db, extra = {}) {
  const r = await M(db, { action: "create", type: "car", ...extra });
  return { tagId: r.body.tagId, token: r.body.token, url: r.body.url, body: r.body };
}

// --- Owner creates Seen.Car -------------------------------------------------

test("authenticated owner creates a Seen.Car with a default public message + durable QR", async () => {
  const db = makeFakeDb();
  const r = await M(db, { action: "create", type: "car", displayLabel: "Tesla Model Y", locale: "zh" });
  assert.equal(r.status, 200);
  assert.match(r.body.tagId, /^tg_/);
  assert.ok(r.body.token && r.body.url === `${PUB}/t/${r.body.token}`);
  assert.equal(r.body.ownerMessage, DEFAULT_OWNER_MESSAGE.car.zh);      // founder default
  const tag = db._store.get(`${TAG_COLLECTION}/${r.body.tagId}`);
  assert.equal(tag.ownerUid, OWNER.uid);
  assert.equal(tag.type, "car");
  assert.equal(tag.status, "active");
  assert.equal(tag.displayLabel, "Tesla Model Y");
  // The raw token is NEVER stored in the clear — only its hash + a sealed copy.
  assert.equal("token" in tag, false);
  assert.ok(tag.publicQrHash && tag.publicQrHash !== r.body.token);
  assert.ok(String(tag.shareTokenSealed).startsWith("sealed:"));
  // Owner may override the public message at create (within limits).
  const en = await M(db, { action: "create", type: "car", ownerMessage: "Please call the front desk", locale: "en" });
  assert.equal(en.body.ownerMessage, "Please call the front desk");
});

test("create requires auth; login-less create is rejected", async () => {
  const db = makeFakeDb();
  assert.equal((await handleTagManage({ db, decoded: null, body: { action: "create", type: "car" }, share: fakeShare(), publicBaseUrl: PUB })).status, 401);
});

// --- Anonymous scanner: no login, resolves the public surface ---------------

test("a valid QR resolves for an anonymous scanner (no login) — message + reasons only", async () => {
  const db = makeFakeDb();
  const { token } = await makeCar(db, { locale: "zh" });
  const r = await S(db, { op: "resolve", token }); // no decoded — anonymous
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "active");
  assert.equal(r.body.type, "car");
  assert.equal(r.body.ownerMessage, DEFAULT_OWNER_MESSAGE.car.zh);
  assert.deepEqual(r.body.reasons, TAG_TYPES.car.reasons);
  // The public surface NEVER carries owner identity or private management data.
  for (const k of ["ownerUid", "displayLabel", "shareTokenSealed", "publicQrHash", "callbackPhone"]) {
    assert.equal(k in r.body, false, k);
  }
});

test("invalid / paused Tag fails safe on the public surface", async () => {
  const db = makeFakeDb();
  const { tagId, token } = await makeCar(db);
  assert.equal((await S(db, { op: "resolve", token: "not-a-real-token" })).status, 404);
  await M(db, { action: "pause", tagId });
  const paused = await S(db, { op: "resolve", token });
  assert.equal(paused.status, 200);
  assert.equal(paused.body.status, "paused");
  assert.equal("ownerMessage" in paused.body, false); // no message leaks while paused
  // A contact against a paused Tag is refused.
  assert.equal((await S(db, { op: "contact", token, reason: "blocking", idempotencyKey: "idem-0001", scannerToken: SCAN })).status, 409);
});

// --- Scanner contact: four reasons, details, optional private callback ------

test("all four Seen.Car reasons submit; an invalid reason is rejected", async () => {
  const db = makeFakeDb();
  const { token } = await makeCar(db);
  let n = 0;
  for (const reason of ["blocking", "access", "anomaly", "other"]) {
    const r = await S(db, { op: "contact", token, reason, idempotencyKey: `idem-reason${n}`, scannerToken: SCAN }, 5000 + n * 60000);
    assert.equal(r.status, 200, reason);
    assert.equal(r.body.ok, true);
    n++;
  }
  const bad = await S(db, { op: "contact", token, reason: "hack", idempotencyKey: "idem-bad", scannerToken: SCAN }, 900000);
  assert.equal(bad.status, 400);
  assert.equal(bad.body.error, "invalid_reason");
});

test("optional details + optional callback number are accepted; phone stays owner-only", async () => {
  const db = makeFakeDb();
  const { tagId, token } = await makeCar(db);
  const r = await S(db, { op: "contact", token, reason: "blocking", details: "白色特斯拉挡在车库门口", callbackPhone: "+86 138 0000 0000", idempotencyKey: "idem-full", scannerToken: SCAN });
  assert.equal(r.status, 200);
  // The scanner's confirmation NEVER echoes the phone or owner data.
  assert.equal("callbackPhone" in r.body, false);
  // Owner reads it in My Tags; the phone IS present for the owner.
  const contacts = await M(db, { action: "contacts", tagId });
  assert.equal(contacts.status, 200);
  assert.equal(contacts.body.contacts.length, 1);
  const c = contacts.body.contacts[0];
  assert.equal(c.reason, "blocking");
  assert.equal(c.details, "白色特斯拉挡在车库门口");
  assert.equal(c.callbackPhone, "+86 138 0000 0000");
  // Owner never sees the scanner's technical identity.
  for (const k of ["scannerIdHash", "ipHash", "scannerToken"]) assert.equal(k in c, false, k);
  // A malformed phone is rejected (never stored raw junk).
  assert.equal((await S(db, { op: "contact", token, reason: "other", callbackPhone: "call me maybe!!", idempotencyKey: "idem-badphone", scannerToken: "scannerB0000000001" }, 999999)).status, 400);
});

test("callback phone is never on the public surface or in any URL", async () => {
  const db = makeFakeDb();
  const { token, url } = await makeCar(db);
  await S(db, { op: "contact", token, reason: "blocking", callbackPhone: "13800000000", idempotencyKey: "idem-phone", scannerToken: SCAN });
  const resolved = await S(db, { op: "resolve", token });
  assert.equal(JSON.stringify(resolved.body).includes("13800000000"), false);
  assert.equal(url.includes("13800000000"), false);
});

// --- Owner isolation + scanner cannot mutate --------------------------------

test("owner isolation: another owner cannot read, manage, or list contacts", async () => {
  const db = makeFakeDb();
  const { tagId, token } = await makeCar(db);
  await S(db, { op: "contact", token, reason: "blocking", idempotencyKey: "idem-iso", scannerToken: SCAN });
  for (const action of ["detail", "update", "pause", "reactivate", "contacts"]) {
    const r = await M(db, { action, tagId, ownerMessage: "hijack" }, OTHER);
    assert.equal(r.status, 403, action);
  }
  // OTHER's own list never sees OWNER's tag.
  const list = await M(db, { action: "list" }, OTHER);
  assert.equal(list.body.tags.length, 0);
});

test("scanner plane can NEVER mutate a Tag — only resolve + contact exist", async () => {
  const db = makeFakeDb();
  const { tagId, token } = await makeCar(db);
  const before = db._store.get(`${TAG_COLLECTION}/${tagId}`);
  // Owner-style actions sent to the public door are treated as a resolve (no op:contact).
  for (const attempt of [{ op: "pause", token }, { action: "update", token, ownerMessage: "x" }, { op: "delete", token }]) {
    const r = await handleTagScan({ db, body: attempt, share: fakeShare(), publicBaseUrl: PUB, now: 6000 });
    // resolve path: succeeds as a read, or 400/404 — but NEVER changes the tag.
    assert.ok(r.status === 200 || r.status === 400 || r.status === 404);
  }
  // The ONLY field the public plane may touch is the scan-event throttle
  // timestamp (engine telemetry, not scanner-controlled data). Every
  // configuration field is byte-identical.
  const after = db._store.get(`${TAG_COLLECTION}/${tagId}`);
  const scrub = ({ lastScanEventAt, ...rest }) => rest;
  assert.deepEqual(scrub(after), scrub(before));
  assert.ok(after.lastScanEventAt === 6000 || after.lastScanEventAt === undefined);
  // The public door carries NO owner-mutation capability at all.
  assert.equal(before.status, "active");
});

// --- Abuse controls ---------------------------------------------------------

test("duplicate protection: the same idempotencyKey never creates a second contact", async () => {
  const db = makeFakeDb();
  const { tagId, token } = await makeCar(db);
  const a = await S(db, { op: "contact", token, reason: "blocking", idempotencyKey: "idem-dup", scannerToken: SCAN }, 5000);
  const b = await S(db, { op: "contact", token, reason: "blocking", idempotencyKey: "idem-dup", scannerToken: SCAN }, 5001);
  assert.equal(a.body.duplicate, false);
  assert.equal(b.body.duplicate, true);
  assert.equal((await M(db, { action: "contacts", tagId })).body.contacts.length, 1);
});

test("rate limit: a rapid repeat from the same scanner/IP is cooled down; a per-scanner cap applies", async () => {
  const db = makeFakeDb();
  const { token } = await makeCar(db);
  await S(db, { op: "contact", token, reason: "blocking", idempotencyKey: "idem-cool1", scannerToken: SCAN }, 5000);
  // Within 30s from the same held identity → cooldown.
  const fast = await S(db, { op: "contact", token, reason: "access", idempotencyKey: "idem-cool2", scannerToken: SCAN }, 5000 + 10 * 1000);
  assert.equal(fast.status, 429);
  assert.equal(fast.body.error, "cooldown");
  // Spaced out beyond cooldown, up to the cap, then blocked.
  let t = 5000;
  for (let i = 0; i < 4; i++) { t += 60 * 1000; await S(db, { op: "contact", token, reason: "other", details: `note ${i}`, idempotencyKey: `idem-cap${i}`, scannerToken: SCAN }, t); }
  t += 60 * 1000;
  const over = await S(db, { op: "contact", token, reason: "other", details: "one too many", idempotencyKey: "idem-capX", scannerToken: SCAN }, t);
  assert.equal(over.status, 429);
  assert.equal(over.body.error, "too_many");
});

test("length limits: oversized message / details are bounded, empty update rejected", async () => {
  const db = makeFakeDb();
  const { tagId, token } = await makeCar(db);
  const longMsg = "x".repeat(1000);
  const up = await M(db, { action: "update", tagId, ownerMessage: longMsg });
  assert.equal(up.status, 200);
  assert.ok(db._store.get(`${TAG_COLLECTION}/${tagId}`).ownerMessage.length <= 300);
  assert.equal((await M(db, { action: "update", tagId, ownerMessage: "   " })).status, 400); // empty message refused
  const longDetails = "y".repeat(1000);
  await S(db, { op: "contact", token, reason: "blocking", details: longDetails, idempotencyKey: "idem-long", scannerToken: SCAN });
  const c = (await M(db, { action: "contacts", tagId })).body.contacts[0];
  assert.ok(c.details.length <= 200);
});

// --- Pause / reactivate with a durable QR -----------------------------------

test("pause then reactivate keeps the SAME QR identity (durable, survives changes)", async () => {
  const db = makeFakeDb();
  const { tagId, token, url } = await makeCar(db);
  const hashBefore = db._store.get(`${TAG_COLLECTION}/${tagId}`).publicQrHash;
  await M(db, { action: "pause", tagId });
  await M(db, { action: "update", tagId, displayLabel: "renamed", ownerMessage: "new message" });
  const react = await M(db, { action: "reactivate", tagId });
  assert.equal(react.body.status, "active");
  const tag = db._store.get(`${TAG_COLLECTION}/${tagId}`);
  assert.equal(tag.publicQrHash, hashBefore);          // QR identity unchanged
  // detail recovers the SAME printable URL — the printed card stays valid.
  const detail = await M(db, { action: "detail", tagId });
  assert.equal(detail.body.url, url);
  // The same token still resolves after all the changes.
  assert.equal((await S(db, { op: "resolve", token })).body.status, "active");
});

// --- My Tags ownership ------------------------------------------------------

test("My Tags lists only the owner's tags, newest first", async () => {
  const db = makeFakeDb();
  await M(db, { action: "create", type: "car", displayLabel: "A" }, OWNER, 1000);
  await M(db, { action: "create", type: "car", displayLabel: "B" }, OWNER, 2000);
  await M(db, { action: "create", type: "car", displayLabel: "C" }, OTHER, 1500);
  const list = await M(db, { action: "list" }, OWNER);
  assert.equal(list.body.tags.length, 2);
  assert.equal(list.body.tags[0].displayLabel, "B"); // newest first
  assert.ok(list.body.tags.every((t) => t.type === "car" && t.status));
});

// --- No Gift/Event coupling + Pet/Luggage reserved --------------------------

test("Seen.Tag is its own domain — no Gift/Event record is created", async () => {
  const db = makeFakeDb();
  const { token } = await makeCar(db);
  await S(db, { op: "contact", token, reason: "blocking", idempotencyKey: "idem-dom", scannerToken: SCAN });
  const keys = [...db._store.keys()];
  assert.ok(keys.every((k) => k.startsWith(`${TAG_COLLECTION}/`) || k.startsWith(`${TAG_CONTACT_COLLECTION}/`) || k.startsWith(`${TAG_EVENT_COLLECTION}/`) || k.startsWith(`${TAG_CONTACT_PHOTO_COLLECTION}/`)));
  assert.equal(keys.some((k) => k.startsWith("gifts/") || k.startsWith("events/") || k.startsWith("liveSessions/")), false);
});

test("creatable types gate on the registry — car/pet/luggage live, unknown/reserved refused", async () => {
  const db = makeFakeDb();
  for (const type of ["car", "pet", "luggage"]) assert.equal((await M(db, { action: "create", type })).status, 200, type);
  assert.equal((await M(db, { action: "create", type: "spaceship" })).status, 400); // invalid_type
  // Reason sets present; further concepts stay reserved DATA (never creatable yet).
  assert.ok(TAG_TYPES.pet.reasons.includes("injured"));
  assert.ok(TAG_TYPES.luggage.reasons.includes("handed_to_staff"));
  for (const k of ["key", "bag", "bike", "item"]) {
    assert.ok(RESERVED_TAG_TYPES.includes(k));
    assert.equal((await M(db, { action: "create", type: k })).status, 400); // not in TAG_TYPES → invalid_type
  }
});

test("owner update edits the public message; the scanner sees the new message", async () => {
  const db = makeFakeDb();
  const { tagId, token } = await makeCar(db);
  await M(db, { action: "update", tagId, ownerMessage: "马上到，请稍等一下，谢谢" });
  assert.equal((await S(db, { op: "resolve", token })).body.ownerMessage, "马上到，请稍等一下，谢谢");
});

// ===========================================================================
// Seen.Pet + Seen.Luggage — SAME engine, type-specific profile + contact fields
// ===========================================================================
async function makePet(db, extra = {}) {
  const r = await M(db, { action: "create", type: "pet", locale: "zh", profile: { name: "旺财", petType: "dog", safetyNote: "怕陌生人，请不要强行抱它。" }, ...extra });
  return { tagId: r.body.tagId, token: r.body.token, body: r.body };
}
async function makeLuggage(db, extra = {}) {
  const r = await M(db, { action: "create", type: "luggage", locale: "zh", displayLabel: "蓝色登机箱", ...extra });
  return { tagId: r.body.tagId, token: r.body.token, body: r.body };
}

test("one engine, three ACTIVE types — car/pet/luggage all creatable via the same door", async () => {
  const db = makeFakeDb();
  assert.equal(TAG_TYPES.car.active, true);
  assert.equal(TAG_TYPES.pet.active, true);
  assert.equal(TAG_TYPES.luggage.active, true);
  for (const type of ["car", "pet", "luggage"]) {
    const r = await M(db, { action: "create", type });
    assert.equal(r.status, 200, type);
    assert.equal(db._store.get(`${TAG_COLLECTION}/${r.body.tagId}`).type, type);
  }
  // Still fails closed on an unknown type.
  assert.equal((await M(db, { action: "create", type: "spaceship" })).status, 400);
  // Reserved future concepts remain reserved data.
  assert.ok(RESERVED_TAG_TYPES.includes("bike"));
});

test("Seen.Pet: owner create carries name/type/safety note; default message; durable QR", async () => {
  const db = makeFakeDb();
  const { tagId, token, body } = await makePet(db);
  assert.match(tagId, /^tg_/);
  assert.equal(body.ownerMessage, DEFAULT_OWNER_MESSAGE.pet.zh);
  assert.deepEqual(body.profile, { name: "旺财", petType: "dog", safetyNote: "怕陌生人，请不要强行抱它。", photo: null });
  const tag = db._store.get(`${TAG_COLLECTION}/${tagId}`);
  assert.equal(tag.type, "pet");
  assert.equal("token" in tag, false);            // durable QR: only hash + sealed
  assert.ok(tag.publicQrHash && String(tag.shareTokenSealed).startsWith("sealed:"));
  // Unknown pet type is coerced to "other" (validated, never trusted raw).
  const p2 = await M(db, { action: "create", type: "pet", profile: { name: "x", petType: "dragon" } });
  assert.equal(p2.body.profile.petType, "other");
});

test("Seen.Pet: anonymous scanner sees pet name + note + the five pet reasons", async () => {
  const db = makeFakeDb();
  const { token } = await makePet(db);
  const r = await S(db, { op: "resolve", token });
  assert.equal(r.status, 200);
  assert.equal(r.body.type, "pet");
  assert.equal(r.body.ownerMessage, DEFAULT_OWNER_MESSAGE.pet.zh);
  assert.deepEqual(r.body.reasons, ["found", "safe_with_me", "seen_nearby", "injured", "danger", "other"]);
  assert.deepEqual(r.body.profile, { name: "旺财", petType: "dog", safetyNote: "怕陌生人，请不要强行抱它。" }); // null fields stripped from the public payload
  // Public surface still never leaks owner identity.
  for (const k of ["ownerUid", "displayLabel", "shareTokenSealed", "publicQrHash", "callbackPhone"]) assert.equal(k in r.body, false, k);
});

test("Seen.Pet: all reasons submit; location + optional contact reach the owner (phone owner-only)", async () => {
  const db = makeFakeDb();
  const { tagId, token } = await makePet(db);
  let n = 0;
  for (const reason of ["found", "seen_nearby", "injured", "danger", "other"]) {
    const r = await S(db, { op: "contact", token, reason, location: `路口 ${n}`, idempotencyKey: `idem-pet${n}`, scannerToken: SCAN }, 5000 + n * 60000);
    assert.equal(r.status, 200, reason); n++;
  }
  assert.equal((await S(db, { op: "contact", token, reason: "blocking", idempotencyKey: "idem-petbad", scannerToken: SCAN }, 9e6)).status, 400); // car reason invalid on a pet
  const withPhone = await S(db, { op: "contact", token, reason: "found", location: "地铁站 A 口", callbackPhone: "13800000000", idempotencyKey: "idem-petphone", scannerToken: "scannerP0000000001" }, 1e7);
  assert.equal(withPhone.status, 200);
  assert.equal("callbackPhone" in withPhone.body, false); // never echoed publicly
  const contacts = (await M(db, { action: "contacts", tagId })).body.contacts;
  const c = contacts.find((x) => x.location === "地铁站 A 口");
  assert.ok(c && c.callbackPhone === "13800000000" && c.reason === "found");
  for (const k of ["scannerIdHash", "ipHash"]) assert.equal(k in c, false);
});

test("Seen.Luggage: default message, spec quick messages; public profile (name/colour/description/photo)", async () => {
  const db = makeFakeDb();
  const { token, body, tagId } = await makeLuggage(db);
  assert.equal(body.ownerMessage, DEFAULT_OWNER_MESSAGE.luggage.zh);
  let r = await S(db, { op: "resolve", token });
  assert.equal(r.body.type, "luggage");
  assert.deepEqual(r.body.reasons, ["found", "safe_with_me", "seen_here", "handed_to_staff", "other"]);
  // Freshly made luggage has an empty profile → nothing public yet.
  assert.equal("profile" in r.body, false);
  // The owner names it and the finder can now confirm the match.
  await M(db, { action: "update", tagId, profile: { name: "My Blue Suitcase", colour: "blue" } });
  r = await S(db, { op: "resolve", token });
  assert.equal(r.body.profile.name, "My Blue Suitcase");
  assert.equal(r.body.profile.colour, "blue");
});

test("Seen.Luggage: handed_to_staff exposes a Lost & Found field; it is owner-only and luggage-only", async () => {
  const db = makeFakeDb();
  const { tagId, token } = await makeLuggage(db);
  const r = await S(db, { op: "contact", token, reason: "handed_to_staff", location: "T1 到达层", handedTo: "Melbourne Airport Lost Property", idempotencyKey: "idem-lug1", scannerToken: SCAN });
  assert.equal(r.status, 200);
  const c = (await M(db, { action: "contacts", tagId })).body.contacts[0];
  assert.equal(c.reason, "handed_to_staff");
  assert.equal(c.location, "T1 到达层");
  assert.equal(c.handedTo, "Melbourne Airport Lost Property");
  // handedTo is IGNORED for a non-luggage tag (car/pet never store it).
  const car = await makeCar(db);
  await S(db, { op: "contact", token: car.token, reason: "blocking", handedTo: "should be dropped", idempotencyKey: "idem-cardrop", scannerToken: "scannerC0000000001" }, 2e6);
  const cc = (await M(db, { action: "contacts", tagId: car.tagId })).body.contacts[0];
  assert.equal(cc.handedTo, null);
});

test("owner can edit the pet + luggage public profiles; car's profile edit is a no-op", async () => {
  const db = makeFakeDb();
  const { tagId, token } = await makePet(db);
  const up = await M(db, { action: "update", tagId, profile: { name: "小白", petType: "cat" } });
  assert.equal(up.status, 200);
  assert.equal(up.body.profile.name, "小白");
  assert.equal(up.body.profile.petType, "cat");
  // The scanner now sees the new profile.
  assert.equal((await S(db, { op: "resolve", token })).body.profile.name, "小白");
  // Luggage edits its own public shape (validated fields only).
  const lug = await makeLuggage(db);
  const lu = await M(db, { action: "update", tagId: lug.tagId, profile: { name: "Blue Case", petType: "dog" } });
  assert.equal(lu.body.profile.name, "Blue Case");
  assert.equal("petType" in lu.body.profile, false); // pet fields can't leak into luggage
  // Car has NO public profile — an attempted edit changes nothing.
  const car = await makeCar(db);
  const cu = await M(db, { action: "update", tagId: car.tagId, profile: { name: "hack" } });
  assert.deepEqual(cu.body.profile, {});
});

test("Seen.Car public surface: spec quick messages, NEVER a profile, no handedTo coupling", async () => {
  const db = makeFakeDb();
  const { tagId, token, body } = await makeCar(db);
  assert.deepEqual(body.profile, {});                       // car public profile is empty
  const r = await S(db, { op: "resolve", token });
  assert.equal("profile" in r.body, false);                 // car resolve has no profile
  assert.deepEqual(r.body.reasons, ["blocking", "lights_on", "window_open", "anomaly", "access", "other"]);
  await S(db, { op: "contact", token, reason: "lights_on", idempotencyKey: "idem-carreg", scannerToken: SCAN });
  const c = (await M(db, { action: "contacts", tagId })).body.contacts[0];
  assert.equal(c.reason, "lights_on");
  assert.equal(c.handedTo, null);
});

test("pause/reactivate work across all three types with a durable QR", async () => {
  const db = makeFakeDb();
  for (const make of [makeCar, makePet, makeLuggage]) {
    const { tagId, token } = await make(db);
    const hash = db._store.get(`${TAG_COLLECTION}/${tagId}`).publicQrHash;
    await M(db, { action: "pause", tagId });
    assert.equal((await S(db, { op: "resolve", token })).body.status, "paused");
    await M(db, { action: "reactivate", tagId });
    assert.equal((await S(db, { op: "resolve", token })).body.status, "active");
    assert.equal(db._store.get(`${TAG_COLLECTION}/${tagId}`).publicQrHash, hash); // QR unchanged
  }
});

// ===========================================================================
// Pre-manufactured lifecycle (unactivated → activate → profile → finder →
// inbox → missing → found) + finder GPS/photo + permissions + events.
// ===========================================================================
const ADMIN = { uid: "founder-1", email: "beingseenmatters@gmail.com", email_verified: true };
const JPEG = "data:image/jpeg;base64,/9j/4AAQSkZJRg==";
const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUg==";

test("provision: founder-only (verified email allowlist), custom code TESTPET001, idempotent re-provision", async () => {
  const db = makeFakeDb();
  // Non-admin and unverified-admin are both refused.
  assert.equal((await M(db, { action: "provision", type: "pet", code: "TESTPET001" }, OWNER)).status, 403);
  assert.equal((await M(db, { action: "provision", type: "pet", code: "TESTPET001" }, { uid: "x", email: "beingseenmatters@gmail.com", email_verified: false })).status, 403);
  // Founder mints the named test tag.
  const r = await M(db, { action: "provision", type: "pet", code: "TESTPET001" }, ADMIN);
  assert.equal(r.status, 200);
  assert.deepEqual(r.body.tags.map((t) => t.code), ["TESTPET001"]);
  assert.equal(r.body.tags[0].url, `${PUB}/t/TESTPET001`);
  const stored = db._store.get(`${TAG_COLLECTION}/${r.body.tags[0].tagId}`);
  assert.equal(stored.status, "unactivated");
  assert.equal(stored.ownerUid, null);
  assert.equal("token" in stored, false); // only hash + sealed, never plaintext
  // Re-provisioning the same unactivated code re-returns it (no duplicate doc).
  const again = await M(db, { action: "provision", type: "pet", code: "TESTPET001" }, ADMIN);
  assert.equal(again.body.tags[0].existing, true);
  assert.equal([...db._store.keys()].filter((k) => k.startsWith(`${TAG_COLLECTION}/`)).length, 1);
});

test("provision: batch mints unique unguessable codes from the unambiguous alphabet", async () => {
  const db = makeFakeDb();
  const r = await M(db, { action: "provision", type: "pet", count: 5 }, ADMIN);
  assert.equal(r.status, 200);
  const codes = r.body.tags.map((t) => t.code);
  assert.equal(new Set(codes).size, 5);
  for (const c of codes) assert.match(c, /^[ABCDEFGHJKMNPQRSTUVWXYZ23456789]{10}$/);
});

test("resolve unactivated: invitation only — no owner data, no profile, no reasons", async () => {
  const db = makeFakeDb();
  await M(db, { action: "provision", type: "pet", code: "TESTPET001" }, ADMIN);
  const r = await S(db, { op: "resolve", token: "TESTPET001" });
  assert.equal(r.status, 200);
  assert.deepEqual(r.body, { status: "unactivated", type: "pet" });
});

test("resolve: case-mangled printed code still resolves (uppercase fallback)", async () => {
  const db = makeFakeDb();
  await M(db, { action: "provision", type: "pet", code: "TESTPET001" }, ADMIN);
  const r = await S(db, { op: "resolve", token: "testpet001" });
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "unactivated");
});

test("activate: atomic claim binds owner, sets activatedAt + locale default message, emits TAG_ACTIVATED", async () => {
  const db = makeFakeDb();
  await M(db, { action: "provision", type: "pet", code: "TESTPET001" }, ADMIN);
  const r = await M(db, { action: "activate", token: "TESTPET001", locale: "en" }, OWNER, 7000);
  assert.equal(r.status, 200);
  assert.equal(r.body.status, "active");
  assert.equal(r.body.already, false);
  const t = db._store.get(`${TAG_COLLECTION}/${r.body.tagId}`);
  assert.equal(t.ownerUid, OWNER.uid);
  assert.equal(t.activatedAt, 7000);
  assert.equal(t.ownerMessage, DEFAULT_OWNER_MESSAGE.pet.en);
  const events = [...db._store.entries()].filter(([k]) => k.startsWith(`${TAG_EVENT_COLLECTION}/`)).map(([, v]) => v);
  assert.equal(events.length, 1);
  assert.equal(events[0].eventType, "TAG_ACTIVATED");
  assert.equal(events[0].recipientUid, OWNER.uid);
  assert.equal(events[0].delivery.webInbox.status, "delivered");
});

test("activate: an activated Tag can NEVER be claimed by another user; owner re-activation echoes", async () => {
  const db = makeFakeDb();
  await M(db, { action: "provision", type: "pet", code: "TESTPET001" }, ADMIN);
  await M(db, { action: "activate", token: "TESTPET001" }, OWNER);
  const thief = await M(db, { action: "activate", token: "TESTPET001" }, OTHER);
  assert.equal(thief.status, 409);
  assert.equal(thief.body.error, "already_activated");
  const t = [...db._store.values()].find((v) => v.publicQrHash);
  assert.equal(t.ownerUid, OWNER.uid); // ownership untouched
  const again = await M(db, { action: "activate", token: "TESTPET001" }, OWNER);
  assert.equal(again.status, 200);
  assert.equal(again.body.already, true);
});

test("activate: transaction retry survives a mid-flight conflict (atomicity mechanism)", async () => {
  const db = makeFakeDb();
  await M(db, { action: "provision", type: "pet", code: "TESTPET001" }, ADMIN);
  db._injectTxConflicts(2); // two optimistic-concurrency retries before commit
  const r = await M(db, { action: "activate", token: "TESTPET001" }, OWNER);
  assert.equal(r.status, 200);
  assert.equal(db._store.size >= 1, true);
  const t = [...db._store.values()].find((v) => v.publicQrHash);
  assert.equal(t.ownerUid, OWNER.uid);
  assert.equal(t.status, "active");
});

test("activate: self-print (born-active) tokens refuse foreign claims too", async () => {
  const db = makeFakeDb();
  const { token } = await makePet(db); // OWNER's self-print pet
  const r = await M(db, { action: "activate", token }, OTHER);
  assert.equal(r.status, 409);
});

test("pet profile: owner sets photo (validated data-URL) and it appears on the public surface", async () => {
  const db = makeFakeDb();
  await M(db, { action: "provision", type: "pet", code: "TESTPET001" }, ADMIN);
  const act = await M(db, { action: "activate", token: "TESTPET001" }, OWNER);
  const tagId = act.body.tagId;
  const up = await M(db, { action: "update", tagId, profile: { name: "Milo", petType: "dog", photo: JPEG } }, OWNER);
  assert.equal(up.status, 200);
  assert.equal(up.body.profile.photo, JPEG);
  const pub = await S(db, { op: "resolve", token: "TESTPET001" });
  assert.equal(pub.body.profile.name, "Milo");
  assert.equal(pub.body.profile.photo, JPEG);
  // Invalid photos are refused loudly: wrong magic bytes, wrong mime, oversize.
  assert.equal((await M(db, { action: "update", tagId, profile: { photo: "data:image/jpeg;base64,aGVsbG8=" } }, OWNER)).status, 400);
  assert.equal((await M(db, { action: "update", tagId, profile: { photo: "data:image/gif;base64,/9j/4A==" } }, OWNER)).status, 400);
  assert.equal((await M(db, { action: "update", tagId, profile: { photo: `data:image/jpeg;base64,${"/9j/".repeat(60000)}` } }, OWNER)).status, 400);
});

test("finder GPS: explicit valid pair is stored (rounded); invalid pairs are refused; disabled → silently not stored", async () => {
  const db = makeFakeDb();
  await M(db, { action: "provision", type: "pet", code: "TESTPET001" }, ADMIN);
  const act = await M(db, { action: "activate", token: "TESTPET001" }, OWNER);
  await M(db, { action: "update", tagId: act.body.tagId, profile: { name: "Milo" } }, OWNER);
  const ok = await S(db, { op: "contact", token: "TESTPET001", reason: "found", idempotencyKey: "idem-gps-1", scannerToken: SCAN, finderLat: -33.8568123456, finderLng: 151.2152999 });
  assert.equal(ok.status, 200);
  const c = [...db._store.values()].find((v) => v.contactId && v.finderLat !== null);
  assert.equal(c.finderLat, -33.856812);
  assert.equal(c.finderLng, 151.2153);
  assert.equal((await S(db, { op: "contact", token: "TESTPET001", reason: "found", idempotencyKey: "idem-gps-2", scannerToken: SCAN, finderLat: 91, finderLng: 0, now: 99e9 })).status, 400);
  assert.equal((await S(db, { op: "contact", token: "TESTPET001", reason: "found", idempotencyKey: "idem-gps-3", scannerToken: SCAN, finderLat: 10 })).status, 400);
  // Owner disables location → coords never stored, message still lands.
  await M(db, { action: "update", tagId: act.body.tagId, permissions: { allowLocation: false } }, OWNER);
  const r2 = await S(db, { op: "contact", token: "TESTPET001", reason: "seen_nearby", details: "park", idempotencyKey: "idem-gps-4", scannerToken: SCAN }, 99999999);
  assert.equal(r2.status, 200);
  const c2 = [...db._store.values()].find((v) => v.contactId && v.reason === "seen_nearby");
  assert.equal(c2.finderLat, null);
});

test("finder photo: validated, stored OUT of the contact row, owner-only fetch; disabled → loud 403", async () => {
  const db = makeFakeDb();
  await M(db, { action: "provision", type: "pet", code: "TESTPET001" }, ADMIN);
  const act = await M(db, { action: "activate", token: "TESTPET001" }, OWNER);
  const tagId = act.body.tagId;
  const r = await S(db, { op: "contact", token: "TESTPET001", reason: "found", idempotencyKey: "idem-ph-1", scannerToken: SCAN, photo: PNG });
  assert.equal(r.status, 200);
  const contact = [...db._store.entries()].find(([k]) => k.startsWith(`${TAG_CONTACT_COLLECTION}/`))[1];
  assert.equal(contact.hasPhoto, true);
  assert.equal("photo" in contact, false); // out-of-row
  const fetched = await M(db, { action: "contact_photo", tagId, contactId: contact.contactId }, OWNER);
  assert.equal(fetched.body.photo, PNG);
  assert.equal((await M(db, { action: "contact_photo", tagId, contactId: contact.contactId }, OTHER)).status, 403);
  assert.equal((await S(db, { op: "contact", token: "TESTPET001", reason: "found", idempotencyKey: "idem-ph-2", scannerToken: "another-scanner-token-1", photo: "data:image/png;base64,/9j/4A==" }, 99999999)).status, 400);
  await M(db, { action: "update", tagId, permissions: { allowPhoto: false } }, OWNER);
  assert.equal((await S(db, { op: "contact", token: "TESTPET001", reason: "found", idempotencyKey: "idem-ph-3", scannerToken: "another-scanner-token-2", photo: PNG }, 199999999)).status, 403);
});

test("permissions: allowMessages=false closes the public form server-side", async () => {
  const db = makeFakeDb();
  await M(db, { action: "provision", type: "pet", code: "TESTPET001" }, ADMIN);
  const act = await M(db, { action: "activate", token: "TESTPET001" }, OWNER);
  await M(db, { action: "update", tagId: act.body.tagId, permissions: { allowMessages: false } }, OWNER);
  const pub = await S(db, { op: "resolve", token: "TESTPET001" });
  assert.equal(pub.body.permissions.allowMessages, false);
  const r = await S(db, { op: "contact", token: "TESTPET001", reason: "found", idempotencyKey: "idem-pm-1", scannerToken: SCAN });
  assert.equal(r.status, 403);
  assert.equal(r.body.error, "messages_disabled");
});

test("missing mode: active→missing→found with guards, events, and the urgent public surface", async () => {
  const db = makeFakeDb();
  await M(db, { action: "provision", type: "pet", code: "TESTPET001" }, ADMIN);
  const act = await M(db, { action: "activate", token: "TESTPET001" }, OWNER);
  const tagId = act.body.tagId;
  await M(db, { action: "update", tagId, profile: { name: "Milo", petType: "dog" } }, OWNER);
  // Only the owner may change status.
  assert.equal((await M(db, { action: "mark_missing", tagId }, OTHER)).status, 403);
  const mm = await M(db, { action: "mark_missing", tagId }, OWNER, 5000);
  assert.equal(mm.body.status, "missing");
  assert.equal(db._store.get(`${TAG_COLLECTION}/${tagId}`).missingSince, 5000);
  // Public surface turns urgent but keeps the full contact surface.
  const pub = await S(db, { op: "resolve", token: "TESTPET001" });
  assert.equal(pub.body.status, "missing");
  assert.equal(pub.body.missingSince, 5000);
  assert.ok(Array.isArray(pub.body.reasons) && pub.body.reasons.includes("found"));
  // Contact still lands while missing.
  const c = await S(db, { op: "contact", token: "TESTPET001", reason: "seen_nearby", location: "河边小路", idempotencyKey: "idem-mm-1", scannerToken: SCAN });
  assert.equal(c.status, 200);
  // found → back to active, missingSince cleared, event emitted.
  const mf = await M(db, { action: "mark_found", tagId }, OWNER, 6000);
  assert.equal(mf.body.status, "active");
  assert.equal(db._store.get(`${TAG_COLLECTION}/${tagId}`).missingSince, null);
  const types = [...db._store.values()].filter((v) => v.eventType).map((v) => v.eventType);
  assert.ok(types.includes("TAG_MARKED_MISSING") && types.includes("TAG_MARKED_FOUND"));
  // Guards: missing only from active (now active again → pause → mark_missing refused).
  await M(db, { action: "pause", tagId }, OWNER);
  assert.equal((await M(db, { action: "mark_missing", tagId }, OWNER)).status, 409);
});

test("inbox read: contacts arrive unread; owner marks read (readAt) and only the owner can", async () => {
  const db = makeFakeDb();
  await M(db, { action: "provision", type: "pet", code: "TESTPET001" }, ADMIN);
  const act = await M(db, { action: "activate", token: "TESTPET001" }, OWNER);
  const tagId = act.body.tagId;
  await S(db, { op: "contact", token: "TESTPET001", reason: "found", details: "在小区门口", idempotencyKey: "idem-rd-1", scannerToken: SCAN });
  let list = await M(db, { action: "contacts", tagId }, OWNER);
  assert.equal(list.body.contacts[0].read, false);
  const cid = list.body.contacts[0].contactId;
  assert.equal((await M(db, { action: "mark_read", tagId, contactId: cid }, OTHER)).status, 403);
  const mr = await M(db, { action: "mark_read", tagId, contactId: cid }, OWNER, 8000);
  assert.equal(mr.body.read, true);
  list = await M(db, { action: "contacts", tagId }, OWNER);
  assert.equal(list.body.contacts[0].read, true);
  assert.equal(list.body.contacts[0].readAt, 8000);
});

test("events: finder message emits TAG_MESSAGE_SENT (+TAG_LOCATION_SHARED when coords shared) to the owner", async () => {
  const db = makeFakeDb();
  await M(db, { action: "provision", type: "pet", code: "TESTPET001" }, ADMIN);
  const act = await M(db, { action: "activate", token: "TESTPET001" }, OWNER);
  await M(db, { action: "update", tagId: act.body.tagId, profile: { name: "Milo" } }, OWNER);
  await S(db, { op: "contact", token: "TESTPET001", reason: "found", idempotencyKey: "idem-ev-1", scannerToken: SCAN, finderLat: 1, finderLng: 2 });
  const events = [...db._store.values()].filter((v) => v.eventType);
  const msg = events.find((e) => e.eventType === "TAG_MESSAGE_SENT");
  assert.ok(msg);
  assert.equal(msg.recipientUid, OWNER.uid);
  assert.equal(msg.data.petName, "Milo");
  assert.equal(msg.data.locationShared, true);
  assert.ok(events.some((e) => e.eventType === "TAG_LOCATION_SHARED"));
});

test("FULL SPEC FLOW: provision → scan invites → activate → profile → finder message+GPS → inbox → read → missing → urgent → found", async () => {
  const db = makeFakeDb();
  // 1. TESTPET001 exists, unactivated.
  await M(db, { action: "provision", type: "pet", code: "TESTPET001" }, ADMIN);
  // 2. Scanner sees the activation invitation (not the finder page).
  assert.equal((await S(db, { op: "resolve", token: "TESTPET001" })).body.status, "unactivated");
  // 3-5. Owner activates; creates Milo the Dog; tag is ACTIVE.
  const act = await M(db, { action: "activate", token: "TESTPET001", locale: "en" }, OWNER);
  const tagId = act.body.tagId;
  await M(db, { action: "update", tagId, profile: { name: "Milo", petType: "dog" } }, OWNER);
  const det = await M(db, { action: "detail", tagId }, OWNER);
  assert.equal(det.body.status, "active");
  assert.equal(det.body.profile.name, "Milo");
  assert.ok(det.body.activatedAt);
  // 6-8. Second device: NOT the activation page — the finder page with Milo.
  const pub = await S(db, { op: "resolve", token: "TESTPET001" });
  assert.equal(pub.body.status, "active");
  assert.equal(pub.body.profile.name, "Milo");
  // 9+11. Finder sends "I found Milo" + shares location.
  const sent = await S(db, { op: "contact", token: "TESTPET001", reason: "found", idempotencyKey: "idem-full-1", scannerToken: SCAN, finderLat: -33.86, finderLng: 151.21 });
  assert.equal(sent.body.ok, true);
  // 10+12. Owner receives it in the Web Inbox with the shared location.
  const inbox = await M(db, { action: "contacts", tagId }, OWNER);
  assert.equal(inbox.body.contacts.length, 1);
  assert.equal(inbox.body.contacts[0].reason, "found");
  assert.equal(inbox.body.contacts[0].finderLat, -33.86);
  await M(db, { action: "mark_read", tagId, contactId: inbox.body.contacts[0].contactId }, OWNER);
  // 13-14. Missing mode; the public page turns urgent.
  await M(db, { action: "mark_missing", tagId }, OWNER);
  assert.equal((await S(db, { op: "resolve", token: "TESTPET001" })).body.status, "missing");
  // 15-16. Found again; the public page returns to normal.
  await M(db, { action: "mark_found", tagId }, OWNER);
  assert.equal((await S(db, { op: "resolve", token: "TESTPET001" })).body.status, "active");
});

// ===========================================================================
// Car + Luggage pre-manufactured parity (spec 2026-08-25): private car profile,
// luggage missing mode, car missing refusal, TAG_SCANNED throttle.
// ===========================================================================

test("car ownerProfile is PRIVATE: owner sees it, the public surface never does", async () => {
  const db = makeFakeDb();
  await M(db, { action: "provision", type: "car", code: "TESTCAR001" }, ADMIN);
  const act = await M(db, { action: "activate", token: "TESTCAR001", locale: "en" }, OWNER);
  const tagId = act.body.tagId;
  const up = await M(db, { action: "update", tagId, ownerProfile: { name: "White Tesla", make: "Tesla", model: "Model Y", colour: "white", registrationHint: "…X882" } }, OWNER);
  assert.equal(up.status, 200);
  assert.equal(up.body.ownerProfile.name, "White Tesla");
  const det = await M(db, { action: "detail", tagId }, OWNER);
  assert.equal(det.body.ownerProfile.registrationHint, "…X882");
  // The scanner learns NOTHING about the vehicle.
  const pub = await S(db, { op: "resolve", token: "TESTCAR001" });
  assert.equal("ownerProfile" in pub.body, false);
  assert.equal("profile" in pub.body, false);
  assert.equal(JSON.stringify(pub.body).includes("Tesla"), false);
  // Pet fields can't sneak into a car ownerProfile / luggage can't get one.
  const lug = await makeLuggage(db);
  const lu = await M(db, { action: "update", tagId: lug.tagId, ownerProfile: { name: "x" } });
  assert.deepEqual(lu.body.ownerProfile, {});
});

test("car cannot be marked missing (spec §15); luggage can", async () => {
  const db = makeFakeDb();
  await M(db, { action: "provision", type: "car", code: "TESTCAR001" }, ADMIN);
  const car = await M(db, { action: "activate", token: "TESTCAR001" }, OWNER);
  const r = await M(db, { action: "mark_missing", tagId: car.body.tagId }, OWNER);
  assert.equal(r.status, 409);
  assert.equal(r.body.error, "missing_not_supported");
  await M(db, { action: "provision", type: "luggage", code: "TESTLUG001" }, ADMIN);
  const lug = await M(db, { action: "activate", token: "TESTLUG001" }, OWNER);
  const ok = await M(db, { action: "mark_missing", tagId: lug.body.tagId }, OWNER, 5000);
  assert.equal(ok.body.status, "missing");
  const pub = await S(db, { op: "resolve", token: "TESTLUG001" });
  assert.equal(pub.body.status, "missing");
});

test("TAG_SCANNED: emitted on active resolve, throttled to one per hour, silent for unactivated", async () => {
  const db = makeFakeDb();
  await M(db, { action: "provision", type: "pet", code: "TESTPET001" }, ADMIN);
  // Unactivated resolve → NO scan event (nobody owns it yet).
  await S(db, { op: "resolve", token: "TESTPET001" });
  const countScans = () => [...db._store.values()].filter((v) => v.eventType === "TAG_SCANNED").length;
  assert.equal(countScans(), 0);
  await M(db, { action: "activate", token: "TESTPET001" }, OWNER);
  await S(db, { op: "resolve", token: "TESTPET001" });          // now=1000 → emits
  assert.equal(countScans(), 1);
  await S(db, { op: "resolve", token: "TESTPET001" });          // same hour → throttled
  assert.equal(countScans(), 1);
  const later = await handleTagScan({ db, body: { op: "resolve", token: "TESTPET001" }, share: fakeShare(), publicBaseUrl: PUB, now: 1000 + 61 * 60 * 1000 });
  assert.equal(later.status, 200);
  assert.equal(countScans(), 2);                                 // next hour → emits again
  const evt = [...db._store.values()].find((v) => v.eventType === "TAG_SCANNED");
  assert.equal(evt.recipientUid, OWNER.uid);
});

test("FULL SPEC FLOW — Car §17: provision → activate → White Tesla → anonymous quick message → inbox", async () => {
  const db = makeFakeDb();
  await M(db, { action: "provision", type: "car", code: "TESTCAR001" }, ADMIN);
  assert.equal((await S(db, { op: "resolve", token: "TESTCAR001" })).body.status, "unactivated");
  const act = await M(db, { action: "activate", token: "TESTCAR001", locale: "en" }, OWNER);
  const tagId = act.body.tagId;
  await M(db, { action: "update", tagId, ownerProfile: { name: "White Tesla" } }, OWNER);
  assert.equal((await M(db, { action: "detail", tagId }, OWNER)).body.status, "active");
  // Anonymous scan: no activation screen, spec quick messages offered.
  const pub = await S(db, { op: "resolve", token: "TESTCAR001" });
  assert.equal(pub.body.status, "active");
  assert.ok(pub.body.reasons.includes("blocking") && pub.body.reasons.includes("lights_on"));
  const sent = await S(db, { op: "contact", token: "TESTCAR001", reason: "blocking", idempotencyKey: "idem-car17", scannerToken: SCAN });
  assert.equal(sent.body.ok, true);
  const inbox = await M(db, { action: "contacts", tagId }, OWNER);
  assert.equal(inbox.body.contacts[0].reason, "blocking");
  assert.equal(inbox.body.contacts[0].read, false);
});

test("FULL SPEC FLOW — Luggage §18: provision → activate → My Blue Suitcase → found+GPS → inbox → missing → found", async () => {
  const db = makeFakeDb();
  await M(db, { action: "provision", type: "luggage", code: "TESTLUG001" }, ADMIN);
  assert.equal((await S(db, { op: "resolve", token: "TESTLUG001" })).body.status, "unactivated");
  const act = await M(db, { action: "activate", token: "TESTLUG001", locale: "en" }, OWNER);
  const tagId = act.body.tagId;
  await M(db, { action: "update", tagId, profile: { name: "My Blue Suitcase" } }, OWNER);
  const pub = await S(db, { op: "resolve", token: "TESTLUG001" });
  assert.equal(pub.body.status, "active");
  assert.equal(pub.body.profile.name, "My Blue Suitcase");
  assert.ok(pub.body.reasons.includes("found") && pub.body.reasons.includes("safe_with_me"));
  const sent = await S(db, { op: "contact", token: "TESTLUG001", reason: "found", idempotencyKey: "idem-lug18", scannerToken: SCAN, finderLat: 1.29, finderLng: 103.85 });
  assert.equal(sent.body.ok, true);
  const inbox = await M(db, { action: "contacts", tagId }, OWNER);
  assert.equal(inbox.body.contacts[0].finderLat, 1.29);
  await M(db, { action: "mark_missing", tagId }, OWNER);
  assert.equal((await S(db, { op: "resolve", token: "TESTLUG001" })).body.status, "missing");
  await M(db, { action: "mark_found", tagId }, OWNER);
  assert.equal((await S(db, { op: "resolve", token: "TESTLUG001" })).body.status, "active");
});

test("luggage handed_to_staff (relabeled 'at lost property') still carries the handedTo desk", async () => {
  const db = makeFakeDb();
  await M(db, { action: "provision", type: "luggage", code: "TESTLUG001" }, ADMIN);
  const act = await M(db, { action: "activate", token: "TESTLUG001" }, OWNER);
  await S(db, { op: "contact", token: "TESTLUG001", reason: "handed_to_staff", handedTo: "T2 失物招领处", idempotencyKey: "idem-lugdesk", scannerToken: SCAN });
  const inbox = await M(db, { action: "contacts", tagId: act.body.tagId }, OWNER);
  assert.equal(inbox.body.contacts[0].handedTo, "T2 失物招领处");
});

// ===========================================================================
// Master Admin phase: custom-claim authority, bootstrap grant, atomic code
// reservation (race-proof), minimal TagBatch.
// ===========================================================================

/** Fake Firebase Admin auth — records claims per uid, resolves known emails. */
function makeFakeAuth(users = {}) {
  const claims = {};
  return {
    _claims: claims,
    getUserByEmail: async (email) => {
      const hit = Object.entries(users).find(([, u]) => u.email === email);
      if (!hit) { const e = new Error("user not found"); e.code = "auth/user-not-found"; throw e; }
      return { uid: hit[0], email, customClaims: claims[hit[0]] ?? {} };
    },
    setCustomUserClaims: async (uid, c) => { claims[uid] = c; },
  };
}
const CLAIMED = { uid: "admin-2", email: "seen-admin@example.com", email_verified: true, master_admin: true };

test("provision authorizes by master_admin CLAIM — no email string in the request path", async () => {
  const db = makeFakeDb();
  // A user whose email is NOT on any whitelist but who carries the claim: allowed.
  const r = await M(db, { action: "provision", type: "pet" }, CLAIMED);
  assert.equal(r.status, 200);
  assert.equal(r.body.tags.length, 1);
  // Same user WITHOUT the claim: refused.
  const { master_admin, ...noClaim } = CLAIMED;
  assert.equal((await M(db, { action: "provision", type: "pet" }, noClaim)).status, 403);
  // Bootstrap fallback (founder email) still works — marked temporary.
  assert.equal((await M(db, { action: "provision", type: "pet" }, ADMIN)).status, 200);
});

test("grant_master_admin: bootstrap-gated, binds the claim to the resolved UID, honest on unknown alias emails", async () => {
  const db = makeFakeDb();
  const auth = makeFakeAuth({ "uid-alan": { email: "alan@spotontechnologies.com.au" } });
  const G = (body, decoded) => handleTagManage({ db, decoded, body, share: fakeShare(), publicBaseUrl: PUB, auth, now: 1000 });
  // Non-admin cannot grant.
  assert.equal((await G({ action: "grant_master_admin", email: "alan@spotontechnologies.com.au" }, OWNER)).status, 403);
  // An alias that never signed in does not resolve — reported, not guessed.
  const miss = await G({ action: "grant_master_admin", email: "seen@spotontechnologies.com.au" }, ADMIN);
  assert.equal(miss.status, 404);
  assert.equal(miss.body.error, "user_not_found");
  // The real signed-in account resolves; the claim lands on the UID.
  const ok = await G({ action: "grant_master_admin", email: "alan@spotontechnologies.com.au" }, ADMIN);
  assert.equal(ok.status, 200);
  assert.equal(ok.body.uid, "uid-alan");
  assert.deepEqual(auth._claims["uid-alan"], { master_admin: true });
  // From then on that UID provisions BY CLAIM (email is irrelevant).
  const asAlan = { uid: "uid-alan", email: "whatever@else.com", email_verified: true, master_admin: true };
  assert.equal((await M(db, { action: "provision", type: "car" }, asAlan)).status, 200);
  // Existing master admins can grant further admins (post-bootstrap path).
  const auth2 = makeFakeAuth({ "uid-x": { email: "x@example.com" } });
  const G2 = (body, decoded) => handleTagManage({ db, decoded, body, share: fakeShare(), publicBaseUrl: PUB, auth: auth2, now: 1000 });
  assert.equal((await G2({ action: "grant_master_admin", email: "x@example.com" }, CLAIMED)).status, 200);
  // No auth dependency injected → honest 503, never a silent grant.
  const noAuth = await handleTagManage({ db, decoded: ADMIN, body: { action: "grant_master_admin", email: "x@example.com" }, share: fakeShare(), publicBaseUrl: PUB, now: 1000 });
  assert.equal(noAuth.status, 503);
});

test("RACE: two concurrent provisions of the same custom code — exactly one tag, loser fails cleanly", async () => {
  const db = makeFakeDb();
  const [a, b] = await Promise.all([
    M(db, { action: "provision", type: "pet", code: "RACEPET01" }, ADMIN),
    M(db, { action: "provision", type: "pet", code: "RACEPET01" }, ADMIN),
  ]);
  const outcomes = [a, b].map((r) => r.status).sort();
  assert.deepEqual(outcomes, [200, 409]); // one wins, one fails cleanly
  const tags = [...db._store.keys()].filter((k) => k.startsWith(`${TAG_COLLECTION}/`));
  assert.equal(tags.length, 1); // NO duplicate public identity
  const reservations = [...db._store.keys()].filter((k) => k.startsWith(`${TAG_CODE_COLLECTION}/`));
  assert.equal(reservations.length, 1); // one reservation, keyed by the QR hash
});

test("reservation ledger: legacy tags without reservations still block re-use of their code", async () => {
  const db = makeFakeDb();
  await M(db, { action: "provision", type: "pet", code: "LEGACY01" }, ADMIN);
  // Simulate a pre-ledger world: drop the reservation, keep the tag + ACTIVATE it.
  const resKey = [...db._store.keys()].find((k) => k.startsWith(`${TAG_CODE_COLLECTION}/`));
  db._store.delete(resKey);
  await M(db, { action: "activate", token: "LEGACY01" }, OWNER);
  const again = await M(db, { action: "provision", type: "pet", code: "LEGACY01" }, ADMIN);
  assert.equal(again.status, 409); // legacy query guard holds
});

test("TagBatch: every creating provision writes one batch; tags reference provision.batchId", async () => {
  const db = makeFakeDb();
  const r = await M(db, { action: "provision", type: "luggage", count: 3, notes: "first factory sample" }, ADMIN);
  assert.equal(r.status, 200);
  assert.ok(r.body.batchId?.startsWith("tb_"));
  const batch = db._store.get(`${TAG_BATCH_COLLECTION}/${r.body.batchId}`);
  assert.equal(batch.quantity, 3);
  assert.equal(batch.type, "luggage");
  assert.equal(batch.createdBy, ADMIN.uid);
  assert.equal(batch.status, "generated");
  assert.equal(batch.notes, "first factory sample");
  const tags = [...db._store.values()].filter((v) => v.publicQrHash && v.provision);
  assert.ok(tags.every((t) => t.provision.batchId === r.body.batchId && t.provision.by === ADMIN.uid));
  // Idempotent re-provision of an existing custom code creates NO new batch.
  await M(db, { action: "provision", type: "pet", code: "IDEMBATCH1" }, ADMIN);
  const batchesBefore = [...db._store.keys()].filter((k) => k.startsWith(`${TAG_BATCH_COLLECTION}/`)).length;
  const again = await M(db, { action: "provision", type: "pet", code: "IDEMBATCH1" }, ADMIN);
  assert.equal(again.body.batchId, null);
  const batchesAfter = [...db._store.keys()].filter((k) => k.startsWith(`${TAG_BATCH_COLLECTION}/`)).length;
  assert.equal(batchesAfter, batchesBefore);
});

test("owner list carries each tag's PUBLIC code (never internal ids beyond tagId)", async () => {
  const db = makeFakeDb();
  await M(db, { action: "provision", type: "pet", code: "COCOCODE01" }, ADMIN);
  await M(db, { action: "activate", token: "COCOCODE01" }, OWNER);
  const list = await M(db, { action: "list" }, OWNER);
  assert.equal(list.status, 200);
  assert.equal(list.body.tags[0].publicCode, "COCOCODE01");
  assert.equal("publicQrHash" in list.body.tags[0], false);
  assert.equal("shareTokenSealed" in list.body.tags[0], false);
});
