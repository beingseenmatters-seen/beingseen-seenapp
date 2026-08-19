/**
 * Birthday Invitation V1 — the engine's first non-Wedding Occasion.
 *
 * The properties under test: Birthday is stored as ITS OWN Event type (never
 * a Wedding), carries the smallest facts contract, and reuses the shared
 * primitives — distribution, per-scanner shared responses, combined
 * attendance, dietary, direct message — without inheriting any Wedding
 * cultural field.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { createGift, retrieveGift, rsvpGift, revokeGift, GIFT_COLLECTION } from "./gift.mjs";
import { createEvent, eventDetail, upsertGuest, saveVariant } from "./event.mjs";
import { distributeInvitations } from "./distribute.mjs";
import { sharedResponsesForEvent } from "./sharedRsvp.mjs";
import {
  validateBirthdayFacts,
  validateOccasion,
  runBirthdayDraft,
  buildBirthdayDraftPrompt,
  audiencesForEventType,
  BIRTHDAY_AUDIENCES,
  WEDDING_AUDIENCES,
} from "./occasion.mjs";

const A = { uid: "host-1" };
const SILENT = { warn: () => {}, error: () => {} };
const fakeShare = () => ({ seal: async (t) => `sealed:${t}`, open: async (x) => String(x).replace(/^sealed:/, "") });

function bFacts(overrides = {}) {
  return {
    birthdayPersonName: "Emma",
    date: "2026-11-20",
    time: { start: "19:00" },
    venue: { displayName: "The Garden House" },
    inviter: "Emma",
    audienceType: "friends",
    ...overrides,
  };
}
const bOccasion = (extra = {}) => ({ type: "birthday", version: 1, ...bFacts(), ...extra });

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

// --- Facts: smallest contract, no Wedding fields -----------------------------

test("birthday facts: minimal contract accepted, canonicalised with null optionals", () => {
  const res = validateBirthdayFacts(bFacts());
  assert.equal(res.ok, true);
  assert.deepEqual(res.facts, {
    birthdayPersonName: "Emma", eventTitle: null, date: "2026-11-20",
    time: { start: "19:00", end: null },
    venue: { displayName: "The Garden House", formattedAddress: null },
    inviter: "Emma", audienceType: "friends",
  });
  // No Wedding cultural field survives into the canonical shape.
  for (const k of ["couple", "culture", "dressCode", "rsvpDeadline", "registryUrl"]) {
    assert.equal(k in res.facts, false, `${k} must not exist on birthday facts`);
  }
});

test("birthday facts: required fields enforced; wedding audience vocabulary refused", () => {
  for (const [facts, field] of [
    [bFacts({ birthdayPersonName: "" }), "birthdayPersonName"],
    [bFacts({ date: "2026-13-01" }), "date"],
    [bFacts({ venue: { displayName: "" } }), "venue.displayName"],
    [bFacts({ audienceType: "elders" }), "audienceType"],       // wedding vocab
    [bFacts({ audienceType: "clients_vip" }), "audienceType"],
    [bFacts({ eventTitle: "x".repeat(61) }), "eventTitle"],
  ]) {
    const res = validateBirthdayFacts(facts);
    assert.equal(res.ok, false);
    assert.equal(res.field, field);
  }
  assert.equal(validateBirthdayFacts(bFacts({ eventTitle: "Emma turns 30" })).facts.eventTitle, "Emma turns 30");
});

test("audiencesForEventType keeps the vocabularies apart", () => {
  assert.equal(audiencesForEventType("birthday"), BIRTHDAY_AUDIENCES);
  assert.equal(audiencesForEventType("wedding"), WEDDING_AUDIENCES);
  assert.ok(!BIRTHDAY_AUDIENCES.includes("elders"));
  assert.ok(!WEDDING_AUDIENCES.includes("classmates"));
});

// --- THE core property: a Birthday Event is never a Wedding ------------------

test("a birthday seal creates an Event stored as type 'birthday'", async () => {
  const db = makeFakeDb();
  const res = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "Come celebrate Emma on November 20, 2026 at The Garden House!",
            occasion: bOccasion(), eventCreate: true, recipientLabel: "Our friends",
            sharedDistribution: true, accessMode: "direct" },
  });
  assert.equal(res.status, 200);
  const ev = [...db._store.entries()].find(([k]) => k.startsWith("events/"))[1];
  assert.equal(ev.type, "birthday");                        // NEVER "wedding"
  assert.equal(ev.occasion.birthdayPersonName, "Emma");
  const opened = await retrieveGift({ db, body: { token: res.body.token } });
  assert.equal(opened.body.occasion.type, "birthday");
});

test("cross-type attachment is refused: birthday invitation onto a wedding Event", async () => {
  const db = makeFakeDb();
  const wedding = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "hi", eventCreate: true, recipientLabel: "x", accessMode: "direct",
            occasion: { type: "wedding", version: 1, couple: { partner1: "冯志俊", partner2: "吴姗姗" },
                        date: "2026-10-01", time: { start: "17:00" }, venue: { displayName: "酒店" },
                        inviter: "全家", audienceType: "friends" } },
  });
  const cross = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "hi", occasion: bOccasion(), eventId: wedding.body.eventId,
            recipientLabel: "y", accessMode: "direct" },
  });
  assert.equal(cross.status, 400);
  assert.equal(cross.body.error, "invalid_event");
});

// --- Shared primitives reused straight through -------------------------------

test("managed guests + distribution work for birthday with birthday vocabulary", async () => {
  const db = makeFakeDb();
  const ev = await createEvent({ db, decoded: A, body: { occasion: bOccasion() }, validateOccasion });
  assert.equal(ev.status, 200);
  const eventId = ev.body.eventId;

  // Wedding vocabulary is refused on a birthday Event's guests…
  const bad = await upsertGuest({ db, decoded: A, body: { eventId, label: "The Lees", relationshipType: "elders" }, giftCollection: GIFT_COLLECTION });
  assert.equal(bad.status, 400);
  // …birthday vocabulary is accepted.
  const g = await upsertGuest({ db, decoded: A, body: { eventId, label: "The Lees", relationshipType: "classmates" }, giftCollection: GIFT_COLLECTION });
  assert.equal(g.status, 200);
  const v = await saveVariant({ db, decoded: A, body: { eventId, relationshipType: "classmates", message: "Emma的生日请柬 2026年11月20日 The Garden House" }, giftCollection: GIFT_COLLECTION });
  assert.equal(v.status, 200);

  const dist = await distributeInvitations({
    db, decoded: A, share: fakeShare(), giftCollection: GIFT_COLLECTION,
    body: { eventId, guestIds: [g.body.guestId] },
  });
  assert.equal(dist.status, 200);
  assert.equal(dist.body.results[0].status, "created");
});

test("attendance is first-class: managed + shared combine on a birthday Event", async () => {
  const db = makeFakeDb();
  const shared = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "party!", occasion: bOccasion(), eventCreate: true,
            recipientLabel: "Group chat", sharedDistribution: true, accessMode: "direct" },
  });
  const eventId = shared.body.eventId;
  const managed = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "party!", occasion: bOccasion(), eventId, recipientLabel: "The Lees", accessMode: "direct" },
  });
  await rsvpGift({ db, body: { token: managed.body.token, key: "", status: "accepted", adultCount: 2, childCount: 0, dietaryRequirements: "No nuts" } });
  await rsvpGift({ db, body: { token: shared.body.token, key: "", status: "accepted", adultCount: 3, childCount: 0, recipientMessage: "Can't wait!" } });

  const detail = await eventDetail({ db, decoded: A, body: { eventId }, giftCollection: GIFT_COLLECTION, sharedResponses: sharedResponsesForEvent });
  assert.equal(detail.body.event.type, "birthday");
  assert.equal(detail.body.aggregate.attendingTotal, 5);      // combined
  assert.equal(detail.body.aggregate.managed.attendingTotal, 2);
  assert.equal(detail.body.sharedAggregate.attendingTotal, 3);
  const row = detail.body.invitations.find((i) => i.recipientLabel === "The Lees");
  assert.equal(row.rsvp.dietaryRequirements, "No nuts");
  assert.equal(detail.body.sharedResponses[0].recipientMessage, "Can't wait!");
});

test("revoke works and no reply ever creates a second Gift on a birthday", async () => {
  const db = makeFakeDb();
  const res = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "party!", occasion: bOccasion(), eventCreate: true,
            recipientLabel: "The Lees", accessMode: "direct" },
  });
  const before = db._store.size;
  const msg = await rsvpGift({ db, body: { token: res.body.token, key: "", status: "accepted", adultCount: 1, childCount: 0, recipientMessage: "See you!" } });
  assert.equal(msg.status, 200);
  assert.equal(db._store.size, before);                       // no new records
  assert.equal("token" in msg.body, false);
  await revokeGift({ db, decoded: A, body: { token: res.body.token } });
  assert.equal((await retrieveGift({ db, body: { token: res.body.token } })).status, 410);
});

// --- Generation ---------------------------------------------------------------

test("birthday drafts generate in zh and en with birthday guidance, never wedding wording", async () => {
  const draft = (lang) =>
    lang === "en"
      ? `You're invited! Emma is turning another year brighter — join us on November 20, 2026 at The Garden House.\\nEmma`
      : `来一起给 Emma 庆生吧！2026年11月20日，The Garden House 见。\\nEmma`;
  for (const language of ["zh", "en"]) {
    const { system, user } = buildBirthdayDraftPrompt({ facts: validateBirthdayFacts(bFacts()).facts, tone: "playful", language });
    assert.ok(!system.includes("婚礼") && !system.toLowerCase().includes("wedding invitation"), `no wedding corpus (${language})`);
    assert.ok(user.includes("Emma"));
    const res = await runBirthdayDraft({
      decoded: A, body: { language, occasion: { type: "birthday", version: 1, facts: bFacts(), tone: "playful" } },
      callModel: async () => JSON.stringify({ drafts: [draft(language), draft(language) + " 🎈", draft(language) + " !"] }),
      log: SILENT,
    });
    assert.equal(res.status, 200, language);
    assert.equal(res.body.drafts.length, 3);
  }
  // The fact gate holds: drop the venue and the draft dies.
  const bad = await runBirthdayDraft({
    decoded: A, body: { occasion: { type: "birthday", version: 1, facts: bFacts() } },
    callModel: async () => JSON.stringify({ drafts: ["来庆生吧！2026年11月20日见。"] }),
    log: SILENT,
  });
  assert.equal(bad.status, 502);
});

test("fail-closed: unknown birthday version and unknown types are refused at the seal", () => {
  assert.equal(validateOccasion({ type: "birthday", version: 2, ...bFacts() }).field, "version");
  assert.equal(validateOccasion({ type: "graduation", version: 1, ...bFacts() }).field, "type");
  assert.equal(validateOccasion(bOccasion()).ok, true);
});

// --- Founder §3: host is optional, falls back to the birthday person ---------

test("host is optional: absent inviter seals as null and never fails the contract", () => {
  const { inviter: _omit, ...noHost } = bFacts();
  const res = validateBirthdayFacts(noHost);
  assert.equal(res.ok, true);
  assert.equal(res.facts.inviter, null);
  // An explicit host is preserved verbatim.
  assert.equal(validateBirthdayFacts(bFacts({ inviter: "Sarah & David" })).facts.inviter, "Sarah & David");
  // A host that is nothing but whitespace is a malformed declaration, not
  // "absent" — same rule as every other optional string in the contract.
  const ws = validateBirthdayFacts(bFacts({ inviter: "   " }));
  assert.equal(ws.ok, false);
  assert.equal(ws.field, "inviter");
});

test("draft sign-off falls back to the birthday person when no host is declared", () => {
  const { inviter: _omit, ...noHost } = bFacts();
  const facts = validateBirthdayFacts(noHost).facts;
  for (const lang of ["en", "zh"]) {
    const prompt = buildBirthdayDraftPrompt({ facts, tone: "warm", language: lang, attempt: 0 });
    const text = prompt.system + "\n" + prompt.user;
    assert.ok(text.includes("Emma"), `${lang}: sign-off must fall back to the birthday person`);
    assert.equal(text.includes("null"), false, `${lang}: null must never leak into a prompt`);
  }
  // With a host, the host signs.
  const hosted = validateBirthdayFacts(bFacts({ inviter: "Sarah" })).facts;
  const p = buildBirthdayDraftPrompt({ facts: hosted, tone: "warm", language: "en", attempt: 0 });
  assert.ok((p.system + p.user).includes("Sarah"));
});

// --- Founder §6: adults + children RSVP, drop-off parties are valid ----------

test("0 adults + N children is a valid acceptance (drop-off children's party)", async () => {
  const db = makeFakeDb();
  const inv = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "party!", occasion: bOccasion(), eventCreate: true,
            recipientLabel: "The Lees", accessMode: "direct" },
  });
  const r = await rsvpGift({ db, body: { token: inv.body.token, key: "", status: "accepted", adultCount: 0, childCount: 3 } });
  assert.equal(r.status, 200);
  const detail = await eventDetail({ db, decoded: A, body: { eventId: inv.body.eventId }, giftCollection: GIFT_COLLECTION, sharedResponses: sharedResponsesForEvent });
  assert.equal(detail.body.aggregate.adultTotal, 0);
  assert.equal(detail.body.aggregate.childTotal, 3);
  assert.equal(detail.body.aggregate.attendingTotal, 3);
});

test("0 adults + 0 children is refused after acceptance; decline zeroes the contribution", async () => {
  const db = makeFakeDb();
  const inv = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "party!", occasion: bOccasion(), eventCreate: true,
            recipientLabel: "The Lees", accessMode: "direct" },
  });
  const zero = await rsvpGift({ db, body: { token: inv.body.token, key: "", status: "accepted", adultCount: 0, childCount: 0 } });
  assert.equal(zero.status, 400);
  assert.equal(zero.body.error, "invalid_rsvp_counts");

  await rsvpGift({ db, body: { token: inv.body.token, key: "", status: "accepted", adultCount: 1, childCount: 2 } });
  await rsvpGift({ db, body: { token: inv.body.token, key: "", status: "declined" } });
  const detail = await eventDetail({ db, decoded: A, body: { eventId: inv.body.eventId }, giftCollection: GIFT_COLLECTION, sharedResponses: sharedResponsesForEvent });
  assert.equal(detail.body.aggregate.attendingTotal, 0);      // decline removed it
});

// --- Founder §9: an update REPLACES its previous contribution ----------------

test("managed update replaces: 1A+2C then 0A+2C moves the adult total by -1", async () => {
  const db = makeFakeDb();
  const inv = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "party!", occasion: bOccasion(), eventCreate: true,
            recipientLabel: "The Lees", accessMode: "direct" },
  });
  await rsvpGift({ db, body: { token: inv.body.token, key: "", status: "accepted", adultCount: 1, childCount: 2 } });
  await rsvpGift({ db, body: { token: inv.body.token, key: "", status: "accepted", adultCount: 0, childCount: 2 } });
  const detail = await eventDetail({ db, decoded: A, body: { eventId: inv.body.eventId }, giftCollection: GIFT_COLLECTION, sharedResponses: sharedResponsesForEvent });
  assert.equal(detail.body.aggregate.adultTotal, 0);          // replaced, not 1
  assert.equal(detail.body.aggregate.childTotal, 2);          // not 4
  assert.equal(detail.body.aggregate.acceptedGroups, 1);   // one household, once
});

test("shared scanner update replaces its own contribution; children combine across sources", async () => {
  const db = makeFakeDb();
  const shared = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "party!", occasion: bOccasion(), eventCreate: true,
            recipientLabel: "Group chat", sharedDistribution: true, accessMode: "direct" },
  });
  const eventId = shared.body.eventId;
  const managed = await createGift({
    db, decoded: A, share: fakeShare(),
    body: { message: "party!", occasion: bOccasion(), eventId, recipientLabel: "The Lees", accessMode: "direct" },
  });
  await rsvpGift({ db, body: { token: managed.body.token, key: "", status: "accepted", adultCount: 2, childCount: 1 } });

  const first = await rsvpGift({ db, body: { token: shared.body.token, key: "", status: "accepted", adultCount: 1, childCount: 3 } });
  const pt = first.body.participantToken;
  assert.ok(pt, "shared scanner gets an anonymous identity");
  await rsvpGift({ db, body: { token: shared.body.token, key: "", participantToken: pt, status: "accepted", adultCount: 1, childCount: 1 } });

  const detail = await eventDetail({ db, decoded: A, body: { eventId }, giftCollection: GIFT_COLLECTION, sharedResponses: sharedResponsesForEvent });
  assert.equal(detail.body.sharedAggregate.childTotal, 1);    // replaced, not 4
  assert.equal(detail.body.aggregate.adultTotal, 3);          // 2 managed + 1 shared
  assert.equal(detail.body.aggregate.childTotal, 2);          // 1 managed + 1 shared
  assert.equal(detail.body.aggregate.attendingTotal, 5);
});

// --- Model-contract pin: json_object REQUIRES the word "JSON" in messages ----
// Root cause of the founder's 帮我写 failure (2026-08-19 device QA): OpenAI
// hard-rejects response_format json_object when no message contains the
// literal word "JSON". The zh birthday prompt lacked it, so every zh
// generation threw before the model ever wrote a draft. Pin ALL invitation
// prompt builders in BOTH languages so no future Occasion repeats this.

test('every draft prompt names JSON explicitly — the json_object API contract', async () => {
  const { buildWeddingDraftPrompt } = await import('./occasion.mjs');
  const bFactsFull = validateBirthdayFacts(bFacts()).facts;
  const wFacts = {
    couple: { partner1: "Emma", partner2: "James" }, date: "2026-11-20",
    time: { start: "17:00" }, venue: { displayName: "The Garden House" },
    inviter: "Emma & James", audienceType: "friends",
  };
  const prompts = [
    ["birthday zh", buildBirthdayDraftPrompt({ facts: bFactsFull, tone: "warm", language: "zh", attempt: 0 })],
    ["birthday en", buildBirthdayDraftPrompt({ facts: bFactsFull, tone: "warm", language: "en", attempt: 0 })],
    ["wedding zh", buildWeddingDraftPrompt({ facts: wFacts, tone: "sincere", language: "zh", attempt: 0 })],
    ["wedding en", buildWeddingDraftPrompt({ facts: { ...wFacts, culture: "western" }, tone: "sincere", language: "en", attempt: 0 })],
  ];
  for (const [name, p] of prompts) {
    assert.ok(/json/i.test(`${p.system}\n${p.user}`), `${name} prompt must contain the word "JSON"`);
  }
});
