/**
 * Business Event V1 — the third Event type, proving ONE type × many contexts.
 *
 * Properties under test: business_event seals as ITS OWN type with a
 * business-shaped contract (host organisation + required title + context);
 * contexts change capabilities through a registry, never engines; Product
 * Materials are bounded, validated EXTERNAL https links that live on the
 * Event and never enter generated prose; attendance is attendee-count
 * (adultCount internally, childCount 0); and Wedding/Birthday are untouched.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGift, rsvpGift, GIFT_COLLECTION } from "./gift.mjs";
import { createEvent, eventDetail, upsertGuest, saveVariant } from "./event.mjs";
import { distributeInvitations } from "./distribute.mjs";
import { sharedResponsesForEvent } from "./sharedRsvp.mjs";
import {
  validateBusinessFacts,
  validateBusinessMaterials,
  validateOccasion,
  runBusinessDraft,
  buildBusinessDraftPrompt,
  audiencesForEventType,
  variantKeysForEventType,
  BUSINESS_CONTEXTS,
  BUSINESS_AUDIENCES,
  BUSINESS_MATERIALS_MAX,
} from "./occasion.mjs";

const A = { uid: "host-1" };
const fakeShare = () => ({ seal: async (t) => `sealed:${t}`, open: async (x) => String(x).replace(/^sealed:/, "") });

function bizFacts(overrides = {}) {
  return {
    host: "Seenmatters Technologies",
    eventTitle: "2026 Client Appreciation Dinner",
    context: "business_dinner",
    date: "2026-12-05",
    time: { start: "18:30" },
    venue: { displayName: "Grand Harbour Hotel" },
    audienceType: "clients",
    ...overrides,
  };
}
const bizOccasion = (extra = {}) => ({ type: "business_event", version: 1, ...bizFacts(), ...extra });

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

// --- Contract -----------------------------------------------------------------

test("business facts: smallest contract accepted; no Wedding/Birthday fields survive", () => {
  const res = validateBusinessFacts(bizFacts());
  assert.equal(res.ok, true);
  assert.deepEqual(res.facts, {
    host: "Seenmatters Technologies",
    eventTitle: "2026 Client Appreciation Dinner",
    context: "business_dinner",
    date: "2026-12-05",
    time: { start: "18:30", end: null },
    venue: { displayName: "Grand Harbour Hotel", formattedAddress: null },
    details: null, dressCode: null, materials: [],
    audienceType: "clients",
  });
  for (const k of ["couple", "culture", "registryUrl", "birthdayPersonName", "inviter", "rsvpDeadline"]) {
    assert.equal(k in res.facts, false, `${k} must not exist on business facts`);
  }
});

test("business facts: required fields enforced; foreign vocabularies refused", () => {
  for (const [facts, field] of [
    [bizFacts({ host: "" }), "host"],
    [bizFacts({ eventTitle: "" }), "eventTitle"],
    [bizFacts({ context: "wedding" }), "context"],
    [bizFacts({ context: "annual_dinner_engine" }), "context"],
    [bizFacts({ date: "2026-13-01" }), "date"],
    [bizFacts({ venue: { displayName: "" } }), "venue.displayName"],
    [bizFacts({ audienceType: "elders" }), "audienceType"],      // wedding vocab
    [bizFacts({ audienceType: "classmates" }), "audienceType"],  // birthday vocab
  ]) {
    const res = validateBusinessFacts(facts);
    assert.equal(res.ok, false);
    assert.equal(res.field, field, JSON.stringify(facts.context ?? facts.audienceType));
  }
});

test("fail-closed: unknown business versions and the seal-door dispatcher", () => {
  assert.equal(validateOccasion(bizOccasion()).ok, true);
  assert.equal(validateOccasion(bizOccasion({ version: 2 })).ok, false);
  assert.equal(validateOccasion({ type: "gathering", version: 1 }).ok, false);
  const sealed = validateOccasion(bizOccasion()).occasion;
  assert.equal(sealed.type, "business_event");
  assert.equal(sealed.version, 1);
});

test("every V1 context validates; capability registry gates optional fields", () => {
  for (const context of BUSINESS_CONTEXTS) {
    const res = validateBusinessFacts(bizFacts({ context }));
    assert.equal(res.ok, true, context);
  }
  // dress code accepted where the capability allows…
  assert.equal(validateBusinessFacts(bizFacts({ context: "business_dinner", dressCode: "Business formal" })).facts.dressCode, "Business formal");
  // …and refused where it does not (product_launch, client_appreciation).
  assert.equal(validateBusinessFacts(bizFacts({ context: "product_launch", dressCode: "Smart" })).ok, false);
  assert.equal(validateBusinessFacts(bizFacts({ context: "client_appreciation", dressCode: "Smart" })).ok, false);
});

// --- Product Materials ----------------------------------------------------------

test("product_launch accepts bounded, validated https material links", () => {
  const materials = [
    { title: "Product Brochure", url: "https://example.com/brochure" },
    { title: "Technical Specifications", url: "https://example.com/specs", description: "Full datasheet" },
  ];
  const res = validateBusinessFacts(bizFacts({ context: "product_launch", materials }));
  assert.equal(res.ok, true);
  assert.equal(res.facts.materials.length, 2);
  assert.equal(res.facts.materials[0].description, null);
  assert.equal(res.facts.materials[1].description, "Full datasheet");
});

test("materials: unsafe URLs rejected — https only, no executable schemes", () => {
  for (const url of [
    "http://example.com/doc",
    "javascript:alert(1)",
    "data:text/html,hi",
    "ftp://example.com/x",
    "file:///etc/passwd",
    "not a url",
  ]) {
    const res = validateBusinessMaterials([{ title: "X", url }]);
    assert.equal(res.ok, false, url);
    assert.equal(res.field, "materials.url");
  }
  assert.equal(validateBusinessMaterials([{ title: "", url: "https://x.example" }]).field, "materials.title");
});

test("materials are bounded and belong ONLY to product_launch", () => {
  const many = Array.from({ length: BUSINESS_MATERIALS_MAX + 1 }, (_, i) => ({ title: `M${i}`, url: "https://example.com/m" }));
  assert.equal(validateBusinessMaterials(many).ok, false);
  const ok = Array.from({ length: BUSINESS_MATERIALS_MAX }, (_, i) => ({ title: `M${i}`, url: "https://example.com/m" }));
  assert.equal(validateBusinessMaterials(ok).ok, true);
  // A non-launch context refuses declared materials outright.
  const res = validateBusinessFacts(bizFacts({ context: "business_dinner", materials: [{ title: "X", url: "https://example.com" }] }));
  assert.equal(res.ok, false);
  assert.equal(res.field, "materials");
});

test("materials survive the Event/Invitation lifecycle and never enter prose input", async () => {
  const db = makeFakeDb();
  const materials = [{ title: "Launch Deck", url: "https://example.com/deck" }];
  const res = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "Join us for the unveiling of Aurora at Grand Harbour Hotel on December 5, 2026. — Seenmatters Technologies",
            occasion: bizOccasion({ context: "product_launch", eventTitle: "Aurora Launch", materials }),
            eventCreate: true, recipientLabel: "Guests", sharedDistribution: true, accessMode: "direct" },
  });
  assert.equal(res.status, 200);
  const detail = await eventDetail({ db, decoded: A, body: { eventId: res.body.eventId }, giftCollection: GIFT_COLLECTION, sharedResponses: sharedResponsesForEvent });
  assert.deepEqual(detail.body.event.occasion.materials, [{ title: "Launch Deck", url: "https://example.com/deck", description: null }]);
  const rec = (await db.collection(GIFT_COLLECTION).doc(res.body.giftId).get()).data();
  assert.equal(rec.occasion.materials[0].url, "https://example.com/deck");
  // Generation input is structurally link-free: the prompt builder never
  // receives materials and its output text carries no URL.
  const facts = validateBusinessFacts(bizFacts({ context: "product_launch", materials })).facts;
  const p = buildBusinessDraftPrompt({ facts, tone: "formal", language: "en", attempt: 0 });
  assert.ok(!(p.system + p.user).includes("example.com"), "material URLs must never reach the model");
});

// --- Event engine reuse ---------------------------------------------------------

test("a business seal creates an Event stored as type business_event; cross-type attach refused", async () => {
  const db = makeFakeDb();
  const biz = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "invite", occasion: bizOccasion(), eventCreate: true, recipientLabel: "Clients", sharedDistribution: true, accessMode: "direct" },
  });
  const ev = (await db.collection("events").doc(biz.body.eventId).get()).data();
  assert.equal(ev.type, "business_event");
  // A birthday invitation cannot attach to a business Event.
  const cross = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "party!", occasion: { type: "birthday", version: 1, birthdayPersonName: "Emma", date: "2026-11-20", time: { start: "19:00" }, venue: { displayName: "V" }, audienceType: "friends" },
            eventId: biz.body.eventId, recipientLabel: "X", accessMode: "direct" },
  });
  assert.equal(cross.status, 400);
});

test("business vocabulary drives guests, variants and General fallback distribution", async () => {
  const db = makeFakeDb();
  const ev = await createEvent({ db, decoded: A, body: { occasion: bizOccasion() }, validateOccasion });
  const eventId = ev.body.eventId;
  assert.equal(audiencesForEventType("business_event"), BUSINESS_AUDIENCES);
  assert.ok(variantKeysForEventType("business_event").includes("general"));

  // Wedding/birthday vocab refused on business guests.
  assert.equal((await upsertGuest({ db, decoded: A, body: { eventId, label: "X", relationshipType: "elders" }, giftCollection: GIFT_COLLECTION })).status, 400);
  assert.equal((await upsertGuest({ db, decoded: A, body: { eventId, label: "X", relationshipType: "classmates" }, giftCollection: GIFT_COLLECTION })).status, 400);

  for (const [rel, msg] of [
    ["general", "诚邀出席 Seenmatters Technologies 答谢晚宴 2026年12月5日 Grand Harbour Hotel"],
    ["clients", "尊敬的客户，Seenmatters Technologies 诚邀您 2026年12月5日 莅临 Grand Harbour Hotel"],
  ]) {
    assert.equal((await saveVariant({ db, decoded: A, body: { eventId, relationshipType: rel, message: msg }, giftCollection: GIFT_COLLECTION })).status, 200);
  }
  const client = await upsertGuest({ db, decoded: A, body: { eventId, label: "Acme Ltd", relationshipType: "clients" }, giftCollection: GIFT_COLLECTION });
  const media = await upsertGuest({ db, decoded: A, body: { eventId, label: "Tech Daily", relationshipType: "media" }, giftCollection: GIFT_COLLECTION });
  const dist = await distributeInvitations({
    db, decoded: A, share: fakeShare(), giftCollection: GIFT_COLLECTION,
    body: { eventId, guestIds: [client.body.guestId, media.body.guestId] },
  });
  assert.deepEqual(dist.body.results.map((r) => r.status), ["created", "created"]);
  const msgOf = async (id) => (await db.collection(GIFT_COLLECTION).doc(id).get()).data().message;
  assert.match(await msgOf(dist.body.results[0].giftId), /尊敬的客户/);   // clients variant
  assert.match(await msgOf(dist.body.results[1].giftId), /诚邀出席/);     // General fallback
});

// --- RSVP: attendee semantics ---------------------------------------------------

test("business attendance is attendee-count: adultCount internal, combined totals, update replaces", async () => {
  const db = makeFakeDb();
  const shared = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "invite", occasion: bizOccasion(), eventCreate: true, recipientLabel: "Team link", sharedDistribution: true, accessMode: "direct" },
  });
  const eventId = shared.body.eventId;
  const managed = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "invite", occasion: bizOccasion(), eventId, recipientLabel: "Acme Ltd", accessMode: "direct" },
  });
  // Managed: 3 attendees. Shared scanner: 2 attendees, then corrects to 1.
  await rsvpGift({ db, body: { token: managed.body.token, key: "", status: "accepted", adultCount: 3, childCount: 0, dietaryRequirements: "1 vegetarian" } });
  const first = await rsvpGift({ db, body: { token: shared.body.token, key: "", status: "accepted", adultCount: 2, childCount: 0 } });
  await rsvpGift({ db, body: { token: shared.body.token, key: "", participantToken: first.body.participantToken, status: "accepted", adultCount: 1, childCount: 0 } });

  const detail = await eventDetail({ db, decoded: A, body: { eventId }, giftCollection: GIFT_COLLECTION, sharedResponses: sharedResponsesForEvent });
  assert.equal(detail.body.event.type, "business_event");
  assert.equal(detail.body.aggregate.attendingTotal, 4);          // 3 managed + 1 shared (replaced, not 5)
  assert.equal(detail.body.aggregate.managed.attendingTotal, 3);
  assert.equal(detail.body.sharedAggregate.attendingTotal, 1);
  const row = detail.body.invitations.find((i) => i.recipientLabel === "Acme Ltd");
  assert.equal(row.rsvp.dietaryRequirements, "1 vegetarian");
});

// --- Generation -----------------------------------------------------------------

test("business drafts generate in zh and en with context register; fact gate enforced", async () => {
  const drafts = (lang) =>
    lang === "en"
      ? `Seenmatters Technologies requests the pleasure of your company at the 2026 Client Appreciation Dinner on December 5, 2026 at Grand Harbour Hotel.`
      : `Seenmatters Technologies 诚挚邀请您于2026年12月5日莅临 Grand Harbour Hotel，出席2026年度客户答谢晚宴。`;
  for (const lang of ["zh", "en"]) {
    const callModel = async ({ system, user }) => {
      assert.ok(/json/i.test(system + user), "prompt must name JSON");
      assert.ok((system + user).includes("Seenmatters Technologies"));
      const d = drafts(lang);
      return JSON.stringify({ drafts: [d, d + " 敬候光临。", d + " We look forward to welcoming you."] });
    };
    const res = await runBusinessDraft({
      decoded: A, callModel,
      body: { language: lang, occasion: { type: "business_event", version: 1, tone: "formal", facts: bizFacts() } },
    });
    assert.equal(res.status, 200, lang);
    assert.ok(res.body.drafts.length >= 2);
  }
  // Facts that never appear → 502, never a wrong invitation.
  const bad = await runBusinessDraft({
    decoded: A,
    callModel: async () => JSON.stringify({ drafts: ["Nice generic invite", "Another one", "Third"] }),
    body: { language: "en", occasion: { type: "business_event", version: 1, facts: bizFacts() } },
  });
  assert.equal(bad.status, 502);
  assert.equal(bad.body.error, "business_draft_failed");
  // Foreign tone/audience refused.
  const tone = await runBusinessDraft({ decoded: A, callModel: async () => "", body: { language: "en", occasion: { type: "business_event", version: 1, tone: "playful", facts: bizFacts() } } });
  assert.equal(tone.body.field, "tone");
});
