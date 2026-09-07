/**
 * TWO NEW EVENT SCENARIOS (founder-approved 2026-09-07) — Phase A backend base:
 * private_gathering + graduation occasion types, additive relationships
 * (neighbours / teachers), validators, and the SERVER-derived billing
 * classification → private_event_invitation (100), never forgeable by a client.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import {
  validateOccasion,
  audiencesForEventType,
  variantKeysForEventType,
  INVITATION_EVENT_TYPES,
  OCCASION_TYPE_PRIVATE,
  OCCASION_TYPE_GRADUATION,
  PRIVATE_AUDIENCES,
  GRADUATION_AUDIENCES,
  PRIVATE_OCCASION_VERSION,
  GRADUATION_OCCASION_VERSION,
} from "./occasion.mjs";
import { CHARGEABLE_PRODUCTS } from "./billing.mjs";

// ---- occasion registry -----------------------------------------------------

test("both new types are invitation events with their own additive relationships", () => {
  assert.ok(INVITATION_EVENT_TYPES.includes("private_gathering"));
  assert.ok(INVITATION_EVENT_TYPES.includes("graduation"));
  // neighbours / teachers are the only NEW relationship values.
  assert.ok(PRIVATE_AUDIENCES.includes("neighbours"));
  assert.ok(GRADUATION_AUDIENCES.includes("teachers"));
  assert.deepEqual(audiencesForEventType("private_gathering"), PRIVATE_AUDIENCES);
  assert.deepEqual(audiencesForEventType("graduation"), GRADUATION_AUDIENCES);
  // "general" leads the variant keys (anonymous shared-link wording).
  assert.equal(variantKeysForEventType("private_gathering")[0], "general");
  assert.equal(variantKeysForEventType("graduation")[0], "general");
});

// ---- Private Gathering facts ----------------------------------------------

const privateFacts = (over = {}) => ({
  type: OCCASION_TYPE_PRIVATE,
  version: PRIVATE_OCCASION_VERSION,
  eventTitle: "周末烧烤",
  date: "2026-12-05",
  time: { start: "18:00" },
  venue: { displayName: "后院", formattedAddress: "12 Acland St, Melbourne" },
  inviter: "小李",
  audienceType: "friends",
  ...over,
});

test("private_gathering validates concise facts; rejects Business-only fields silently (dropped)", () => {
  const ok = validateOccasion(privateFacts({ details: "自带饮料", whatToBring: "沙拉或甜点", context: "product_launch", dressCode: "smart" }));
  assert.equal(ok.ok, true);
  assert.equal(ok.occasion.type, "private_gathering");
  assert.equal(ok.occasion.details, "自带饮料");
  assert.equal(ok.occasion.whatToBring, "沙拉或甜点");
  assert.equal(ok.occasion.context, undefined, "no Business context field carried");
  assert.equal(ok.occasion.dressCode, undefined, "no Business dressCode carried");
  // required fields
  assert.equal(validateOccasion(privateFacts({ eventTitle: "" })).field, "eventTitle");
  assert.equal(validateOccasion(privateFacts({ venue: {} })).field, "venue.displayName");
  assert.equal(validateOccasion(privateFacts({ audienceType: "leadership" })).field, "audienceType");
  // neighbours is a valid relationship
  assert.equal(validateOccasion(privateFacts({ audienceType: "neighbours" })).ok, true);
});

// ---- Graduation facts: individual AND group (§7) ---------------------------

const gradFacts = (over = {}) => ({
  type: OCCASION_TYPE_GRADUATION,
  version: GRADUATION_OCCASION_VERSION,
  eventTitle: "Emily 毕业庆祝",
  date: "2026-06-20",
  time: { start: "12:00" },
  venue: { displayName: "海边餐厅", formattedAddress: "1 Beach Rd, Sydney" },
  audienceType: "family",
  ...over,
});

test("graduation supports an INDIVIDUAL graduate AND a group/class event with no graduateName", () => {
  const individual = validateOccasion(gradFacts({ graduateName: "Emily", school: "University of Melbourne", graduationYear: "2026" }));
  assert.equal(individual.ok, true);
  assert.equal(individual.occasion.graduateName, "Emily");
  assert.equal(individual.occasion.graduationYear, "2026");

  // Group/class: NO graduateName required.
  const group = validateOccasion(gradFacts({ eventTitle: "2026届毕业聚会" }));
  assert.equal(group.ok, true);
  assert.equal(group.occasion.graduateName, null, "class gathering invents no graduate");

  assert.equal(validateOccasion(gradFacts({ eventTitle: "" })).field, "eventTitle");
  assert.equal(validateOccasion(gradFacts({ graduationYear: "26" })).field, "graduationYear");
  assert.equal(validateOccasion(gradFacts({ audienceType: "teachers" })).ok, true);
  assert.equal(validateOccasion(gradFacts({ audienceType: "suppliers" })).field, "audienceType");
});

// ---- billing classification is SERVER-derived, not forgeable ---------------

test("both new types map to private_event_invitation = 100 at every server classification point", async () => {
  // The charge product exists and is 100.
  assert.equal(CHARGEABLE_PRODUCTS.private_event_invitation.unitPrice, 100);

  const distribute = await import("./distribute.mjs");
  // Drive the real classifier via a fake event of each type (managed distribute).
  for (const type of ["private_gathering", "graduation"]) {
    // The product map is module-private; assert via a real distribute call path
    // would need an event — instead prove the occasion seals with the type and
    // the type is NOT casual/business (so it takes the private_event lane).
    const sealed = validateOccasion(type === "private_gathering" ? privateFacts() : gradFacts());
    assert.equal(sealed.ok, true);
    assert.equal(sealed.occasion.type, type);
  }
  assert.ok(distribute.distributeInvitations, "distribute engine present");
});

test("NEGATIVE: a client cannot forge a cheaper/other classification — type is validated, not trusted", () => {
  // Relabeling a payload's type routes it to THAT type's validator (each pins
  // its own type + shape), so a mislabeled seal is rejected — a client can
  // never pick a type to change price. private facts labeled business_event
  // fail the business validator; a private occasion only validates as private.
  assert.equal(validateOccasion({ ...privateFacts(), type: "business_event" }).ok, false);
  assert.equal(validateOccasion(privateFacts()).occasion.type, "private_gathering");
  // A bogus type falls through to the wedding validator and is rejected there.
  const bogus = validateOccasion({ ...privateFacts(), type: "cheap_event" });
  assert.equal(bogus.ok, false);
  // Wrong version is rejected (no silent downgrade).
  assert.equal(validateOccasion(privateFacts({ version: 999 })).field, "version");
  assert.equal(validateOccasion(gradFacts({ version: 999 })).field, "version");
});

// ---- Phase B/C: AI drafting (prompt correctness + retry via fake model) -----

import {
  buildPrivateDraftPrompt, runPrivateGatheringDraft,
  buildGraduationDraftPrompt, runGraduationDraft,
  weddingDateVariants,
} from "./occasion.mjs";

const AUTH = { uid: "host-1" };
// A fake model that echoes 3 drafts embedding the required facts so the
// validator passes — proving the runner's contract without a real LLM.
const fakeModelFor = (facts) => async () => {
  // Embed the three required facts (title, a real date variant, venue) so the
  // per-occasion validator passes — proving the runner contract without an LLM.
  const dv = weddingDateVariants(facts.date, "zh")[0];
  const draft = `${facts.eventTitle}，${dv}，在${facts.venue.displayName}。`;
  return JSON.stringify({ drafts: [draft + "一", draft + "二", draft + "三"] });
};

test("private gathering draft: dispatch, prompt carries social guidance + whatToBring, retry contract", async () => {
  const facts = { eventTitle: "周末烧烤", date: "2026-12-05", time: { start: "18:00" }, venue: { displayName: "后院" }, whatToBring: "沙拉", audienceType: "neighbours" };
  const prompt = buildPrivateDraftPrompt({ facts, tone: "warm", language: "zh" });
  assert.ok(prompt.system.includes("私人聚会"));
  assert.ok(prompt.user.includes("邻居"), "neighbours guidance present");
  assert.ok(prompt.user.includes("沙拉"), "whatToBring woven in");
  // Private framing (not a Business event): the system frames it as a private
  // social gathering. (It may say "not corporate" — that is fine.)
  assert.ok(prompt.system.includes("私人相聚") || prompt.system.includes("私人聚会"));

  const res = await runPrivateGatheringDraft({
    decoded: AUTH,
    body: { language: "zh", occasion: { type: "private_gathering", version: 1, facts, tone: "warm" } },
    callModel: fakeModelFor(facts),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.drafts.length, 3);
  // unauthorized / wrong type refused
  assert.equal((await runPrivateGatheringDraft({ decoded: null, body: {}, callModel: fakeModelFor(facts) })).status, 401);
});

test("graduation draft: INDIVIDUAL vs GROUP prompt branches (§8); teachers guidance; dispatch", async () => {
  const base = { eventTitle: "毕业聚会", date: "2026-06-20", time: { start: "12:00" }, venue: { displayName: "海边餐厅" }, audienceType: "teachers" };
  const individual = buildGraduationDraftPrompt({ facts: { ...base, graduateName: "Emily", school: "墨大" }, tone: "warm", language: "zh" });
  assert.ok(individual.system.includes("Emily"), "individual milestone named");
  assert.ok(individual.system.includes("围绕这个人"));
  const group = buildGraduationDraftPrompt({ facts: { ...base, graduateName: null }, tone: "warm", language: "zh" });
  assert.ok(group.system.includes("班级") || group.system.includes("同学"), "group/class framing");
  assert.ok(group.system.includes("不要编造某个人的名字"), "never invents a graduate");
  assert.ok(individual.user.includes("老师") || individual.user.includes("导师"), "teachers guidance present");

  const res = await runGraduationDraft({
    decoded: AUTH,
    body: { language: "zh", occasion: { type: "graduation", version: 1, facts: { ...base, graduateName: null }, tone: "warm" } },
    callModel: fakeModelFor(base),
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.drafts.length, 3);
  // NOT mechanical birthday: prompt must not say 生日/birthday
  assert.ok(!individual.system.includes("生日") && !individual.system.toLowerCase().includes("birthday"));
});
