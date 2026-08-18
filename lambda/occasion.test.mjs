import { test } from "node:test";
import assert from "node:assert/strict";
import {
  WEDDING_AUDIENCES,
  WEDDING_TONES,
  WEDDING_DRAFT_MAX_TOKENS,
  validateWeddingFacts,
  validateWeddingOccasion,
  formatWeddingDate,
  anglesForAttempt,
  buildWeddingDraftPrompt,
  validateWeddingDraft,
  weddingDateVariants,
  weddingLanguageFor,
  validateOccasionVersionCulture,
  OCCASION_VERSION,
  OCCASION_VERSION_CULTURAL,
  runWeddingDraft,
} from "./occasion.mjs";

const SILENT = { warn: () => {}, error: () => {} };

function validFacts(overrides = {}) {
  return {
    couple: { partner1: "冯志俊", partner2: "吴姗姗" },
    date: "2026-10-01",
    time: { start: "17:00" },
    venue: { displayName: "临平温德姆大酒店" },
    inviter: "姚科奇全家",
    audienceType: "elders",
    ...overrides,
  };
}

function validDraft() {
  return "有些喜悦，值得与重要的人一起分享。\n2026年10月1日，冯志俊与吴姗姗将在临平温德姆大酒店举行婚礼，诚挚邀请您见证。\n姚科奇全家 敬邀";
}

/** Western Wedding facts — same shape, different cultural contract. */
/** Western Occasions declare the CULTURAL contract version (see §6). */
function westernOccasion(extra = {}) {
  return { type: "wedding", version: 2, facts: westernFacts(), ...extra };
}

function westernFacts(overrides = {}) {
  return {
    couple: { partner1: "Emma", partner2: "James" },
    date: "2026-10-01",
    time: { start: "16:00" },
    venue: { displayName: "Hedsor House" },
    inviter: "Emma and James",
    audienceType: "friends",
    culture: "western",
    ...overrides,
  };
}

const EN_TAIL = "\nEmma and James";
function enDraft() {
  return `We are getting married.\nOn October 1, 2026 at Hedsor House, Emma and James will marry, and we would love you there.${EN_TAIL}`;
}
function enDraft2() {
  return `You have been part of our story for a long time.\nEmma and James invite you to celebrate their wedding on October 1, 2026 at Hedsor House.${EN_TAIL}`;
}
function enDraft3() {
  return `Emma and James request the pleasure of your company at Hedsor House on 1 October 2026, at four in the afternoon.${EN_TAIL}`;
}

const AUTHOR = { uid: "author-1" };

function weddingBody(occasionOverrides = {}) {
  return {
    language: "zh",
    occasion: {
      type: "wedding",
      version: 1,
      facts: validFacts(),
      ...occasionOverrides,
    },
  };
}

// --- Facts validation -------------------------------------------------------

test("validateWeddingFacts accepts minimal required facts and normalizes optionals to null", () => {
  const res = validateWeddingFacts(validFacts());
  assert.equal(res.ok, true);
  assert.deepEqual(res.facts, {
    couple: { partner1: "冯志俊", partner2: "吴姗姗" },
    date: "2026-10-01",
    time: { start: "17:00", end: null },
    venue: { displayName: "临平温德姆大酒店", formattedAddress: null, latitude: null, longitude: null },
    inviter: "姚科奇全家",
    audienceType: "elders",
    // Western Wedding V1 additive optionals — same "absent → null" convention
    // as the fields above; culture defaults to the exact truth for every
    // record sealed before the field existed.
    culture: "chinese",
    rsvpDeadline: null,
    dressCode: null,
  });
});

test("validateWeddingFacts accepts every optional field", () => {
  const res = validateWeddingFacts(
    validFacts({
      time: { start: "17:00", end: "21:30" },
      venue: {
        displayName: "临平温德姆大酒店",
        formattedAddress: "杭州市临平区XX路1号",
        latitude: 30.42,
        longitude: 120.3,
      },
    }),
  );
  assert.equal(res.ok, true);
  assert.equal(res.facts.time.end, "21:30");
  assert.equal(res.facts.venue.formattedAddress, "杭州市临平区XX路1号");
  assert.equal(res.facts.venue.latitude, 30.42);
  assert.equal(res.facts.venue.longitude, 120.3);
});

test("validateWeddingFacts rejects each missing/invalid required field with the offending field name", () => {
  const cases = [
    [validFacts({ couple: undefined }), "couple"],
    [validFacts({ couple: { partner1: "", partner2: "吴姗姗" } }), "couple.partner1"],
    [validFacts({ couple: { partner1: "冯志俊", partner2: "x".repeat(41) } }), "couple.partner2"],
    [validFacts({ date: "2026/10/01" }), "date"],
    [validFacts({ date: "2026-02-30" }), "date"],
    [validFacts({ time: undefined }), "time"],
    [validFacts({ time: { start: "25:00" } }), "time.start"],
    [validFacts({ time: { start: "17:00", end: "9pm" } }), "time.end"],
    [validFacts({ venue: undefined }), "venue"],
    [validFacts({ venue: { displayName: "" } }), "venue.displayName"],
    [validFacts({ venue: { displayName: "x".repeat(81) } }), "venue.displayName"],
    [validFacts({ venue: { displayName: "ok", formattedAddress: "x".repeat(161) } }), "venue.formattedAddress"],
    [validFacts({ venue: { displayName: "ok", latitude: 30.42 } }), "venue.coordinates"],
    [validFacts({ venue: { displayName: "ok", latitude: 91, longitude: 120 } }), "venue.latitude"],
    [validFacts({ venue: { displayName: "ok", latitude: 30, longitude: 181 } }), "venue.longitude"],
    [validFacts({ inviter: "  " }), "inviter"],
    [validFacts({ audienceType: "vip" }), "audienceType"],
  ];
  for (const [facts, field] of cases) {
    const res = validateWeddingFacts(facts);
    assert.equal(res.ok, false, `expected rejection for ${field}`);
    assert.equal(res.field, field);
  }
});

test("audience and tone vocabularies are the approved Phase 1 sets", () => {
  assert.deepEqual(WEDDING_AUDIENCES, [
    "relatives", "elders", "friends", "close_friends", "colleagues", "clients_vip",
  ]);
  assert.deepEqual(WEDDING_TONES, [
    "sincere", "warm", "joyful", "literary", "poetic", "lighthearted",
  ]);
});

// --- Sealed occasion shape (gift/create) ------------------------------------

test("validateWeddingOccasion accepts the flat sealed shape and stamps type/version", () => {
  const res = validateWeddingOccasion({ type: "wedding", version: 1, ...validFacts() });
  assert.equal(res.ok, true);
  assert.equal(res.occasion.type, "wedding");
  assert.equal(res.occasion.version, 1);
  assert.equal(res.occasion.couple.partner1, "冯志俊");
  assert.equal(res.occasion.venue.formattedAddress, null);
});

test("validateWeddingOccasion rejects unknown type and wrong version", () => {
  assert.deepEqual(validateWeddingOccasion({ type: "birthday", version: 1, ...validFacts() }), {
    ok: false, field: "type",
  });
  // v2 is a supported contract version, but it exists to DECLARE a culture:
  // v2 without one is refused.
  assert.deepEqual(validateWeddingOccasion({ type: "wedding", version: 2, ...validFacts() }), {
    ok: false, field: "culture",
  });
  assert.deepEqual(validateWeddingOccasion({ type: "wedding", version: 9, ...validFacts() }), {
    ok: false, field: "version",
  });
  assert.deepEqual(validateWeddingOccasion("wedding"), { ok: false, field: "occasion" });
});

// --- Prompt building --------------------------------------------------------

test("formatWeddingDate renders natural Chinese without zero padding", () => {
  assert.equal(formatWeddingDate("2026-10-01"), "2026年10月1日");
  assert.equal(formatWeddingDate("2027-01-15"), "2027年1月15日");
});

test("anglesForAttempt rotates deterministically and wraps", () => {
  const a0 = anglesForAttempt(0);
  const a1 = anglesForAttempt(1);
  assert.equal(a0.length, 3);
  assert.notDeepEqual(a0, a1);
  assert.deepEqual(anglesForAttempt(6), a0); // 6 angles → full wrap
  assert.deepEqual(anglesForAttempt(-1), anglesForAttempt(5)); // defensive
});

test("buildWeddingDraftPrompt carries facts, audience, tone, and personalContext in the user message", () => {
  const { system, user } = buildWeddingDraftPrompt({
    facts: validateWeddingFacts(validFacts()).facts,
    tone: "warm",
    personalContext: "TA 是看着孩子长大的长辈",
    attempt: 0,
  });
  for (const needle of ["2026年10月1日", "临平温德姆大酒店", "姚科奇全家"]) {
    assert.ok(system.includes(needle) || user.includes(needle), `missing ${needle}`);
  }
  assert.ok(user.includes("冯志俊"));
  assert.ok(user.includes("长辈"));
  assert.ok(user.includes("温暖"));
  assert.ok(user.includes("TA 是看着孩子长大的长辈"));
  assert.ok(user.includes("第三篇："));
  assert.ok(system.includes('{"drafts"'));
  // Untrusted sender text lives in the user role, never the system role.
  assert.ok(!system.includes("TA 是看着孩子长大的长辈"));
});

test("buildWeddingDraftPrompt omits the personalContext block when absent", () => {
  const { user } = buildWeddingDraftPrompt({
    facts: validateWeddingFacts(validFacts()).facts,
    tone: "sincere",
    personalContext: null,
    attempt: 0,
  });
  assert.ok(!user.includes("心里话"));
});

// --- Draft fact validation ---------------------------------------------------

test("validateWeddingDraft demands both names, formatted date, and venue verbatim", () => {
  const facts = validateWeddingFacts(validFacts()).facts;
  assert.equal(validateWeddingDraft(validDraft(), facts), true);
  assert.equal(validateWeddingDraft(validDraft().replace("吴姗姗", "他的爱人"), facts), false);
  assert.equal(validateWeddingDraft(validDraft().replace("2026年10月1日", "十月一日"), facts), false);
  assert.equal(validateWeddingDraft(validDraft().replace("临平温德姆大酒店", "酒店"), facts), false);
  assert.equal(validateWeddingDraft("", facts), false);
});

// --- Orchestrator: auth + input gates ----------------------------------------

test("runWeddingDraft requires a verified sender (401 without decoded uid)", async () => {
  for (const decoded of [null, undefined, {}]) {
    const res = await runWeddingDraft({ decoded, body: weddingBody(), callModel: async () => {
      throw new Error("must not be called");
    }, log: SILENT });
    assert.equal(res.status, 401);
    assert.equal(res.body.error, "unauthorized");
  }
});

test("runWeddingDraft ACCEPTS English (Western Wedding V1) but still rejects unknown languages", async () => {
  // P0.1: the blanket "en" refusal is gone — English is a supported contract.
  const en = await runWeddingDraft({
    decoded: AUTHOR,
    body: { occasion: westernOccasion(), language: "en" },
    callModel: async () => JSON.stringify({ drafts: [enDraft(), enDraft2(), enDraft3()] }),
    log: SILENT,
  });
  assert.equal(en.status, 200);
  assert.equal(en.body.drafts.length, 3);

  // An unrecognised language is still refused — validation was narrowed, not weakened.
  for (const language of ["fr", "zh-TW", 42, {}]) {
    const bad = await runWeddingDraft({
      decoded: AUTHOR,
      body: { ...weddingBody(), language },
      callModel: async () => { throw new Error("must not be called"); },
      log: SILENT,
    });
    assert.equal(bad.status, 400, `expected 400 for language ${JSON.stringify(language)}`);
    assert.equal(bad.body.error, "occasion_language_unsupported");
  }
});

test("runWeddingDraft rejects mixed situation+occasion", async () => {
  const mixed = await runWeddingDraft({
    decoded: AUTHOR,
    body: { ...weddingBody(), situation: "帮我写点什么" },
    callModel: async () => "",
    log: SILENT,
  });
  assert.equal(mixed.status, 400);
  assert.equal(mixed.body.error, "invalid_request");
});

test("runWeddingDraft rejects invalid occasion type/version/facts/tone/personalContext clearly", async () => {
  const never = async () => { throw new Error("must not be called"); };
  const cases = [
    [{ language: "zh", occasion: { type: "birthday", version: 1, facts: validFacts() } }, "type"],
    [{ language: "zh", occasion: { type: "wedding", version: 9, facts: validFacts() } }, "version"],
    [{ language: "zh", occasion: { type: "wedding", version: 1, facts: validFacts({ date: "bad" }) } }, "date"],
    [weddingBody({ tone: "romantic" }), "tone"],
    [weddingBody({ personalContext: "长".repeat(201) }), "personalContext"],
  ];
  for (const [body, field] of cases) {
    const res = await runWeddingDraft({ decoded: AUTHOR, body, callModel: never, log: SILENT });
    assert.equal(res.status, 400, `expected 400 for ${field}`);
    assert.equal(res.body.error, "invalid_occasion");
    assert.equal(res.body.field, field);
  }
});

// --- Orchestrator: generation, retry, loud failure ---------------------------

test("runWeddingDraft returns three validated drafts on a clean first round", async () => {
  const calls = [];
  const drafts = [validDraft(), `${validDraft()} A`, `${validDraft()} B`];
  const res = await runWeddingDraft({
    decoded: AUTHOR,
    body: weddingBody({ tone: "warm", personalContext: "希望老朋友都回来聚聚" }),
    callModel: async (req) => {
      calls.push(req);
      return JSON.stringify({ drafts });
    },
    log: SILENT,
  });
  assert.equal(res.status, 200);
  assert.deepEqual(res.body.drafts, drafts);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].jsonObject, true);
  assert.equal(calls[0].maxTokens, WEDDING_DRAFT_MAX_TOKENS);
});

test("runWeddingDraft drops fact-losing drafts, retries once with fresh angles, and merges", async () => {
  const calls = [];
  const res = await runWeddingDraft({
    decoded: AUTHOR,
    body: weddingBody(),
    callModel: async (req) => {
      calls.push(req);
      if (calls.length === 1) {
        // one valid, one that lost the venue, one that lost a name
        return JSON.stringify({
          drafts: [validDraft(), validDraft().replace("临平温德姆大酒店", "酒店"), validDraft().replace("冯志俊", "新郎")],
        });
      }
      return JSON.stringify({ drafts: [`${validDraft()} 二`, `${validDraft()} 三`] });
    },
    log: SILENT,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.drafts.length, 3);
  assert.equal(calls.length, 2);
  // Retry must ask with rotated angles — the user prompt changes.
  assert.notEqual(calls[0].user, calls[1].user);
});

test("runWeddingDraft accepts a degraded two-draft result but never one", async () => {
  let round = 0;
  const two = await runWeddingDraft({
    decoded: AUTHOR,
    body: weddingBody(),
    callModel: async () => {
      round += 1;
      return JSON.stringify({ drafts: round === 1 ? [validDraft()] : [`${validDraft()} 二`] });
    },
    log: SILENT,
  });
  assert.equal(two.status, 200);
  assert.equal(two.body.drafts.length, 2);

  const one = await runWeddingDraft({
    decoded: AUTHOR,
    body: weddingBody(),
    callModel: async () => JSON.stringify({ drafts: [validDraft()] }), // same text both rounds → deduped to 1
    log: SILENT,
  });
  assert.equal(one.status, 502);
  assert.equal(one.body.error, "wedding_draft_failed");
});

test("runWeddingDraft fails loudly (502, never silent empty) on garbage or model failure", async () => {
  const garbage = await runWeddingDraft({
    decoded: AUTHOR,
    body: weddingBody(),
    callModel: async () => "婚礼邀请如下：……（不是 JSON）",
    log: SILENT,
  });
  assert.equal(garbage.status, 502);
  assert.equal(garbage.body.error, "wedding_draft_failed");

  const failing = await runWeddingDraft({
    decoded: AUTHOR,
    body: weddingBody(),
    callModel: async () => { throw new Error("model_http_500"); },
    log: SILENT,
  });
  assert.equal(failing.status, 502);
  assert.equal(failing.body.error, "wedding_draft_failed");
});

test("runWeddingDraft 换一批: attempt shifts the requested angles", async () => {
  const prompts = [];
  const make = (attempt) =>
    runWeddingDraft({
      decoded: AUTHOR,
      body: weddingBody({ attempt }),
      callModel: async (req) => {
        prompts.push(req.user);
        return JSON.stringify({ drafts: [validDraft(), `${validDraft()} A`, `${validDraft()} B`] });
      },
      log: SILENT,
    });
  await make(0);
  await make(1);
  assert.notEqual(prompts[0], prompts[1]);
});


// --- Western Wedding V1 (cultural contract over shared Wedding infra) --------

test("culture: absent → chinese, western accepted, unknown rejected", () => {
  // Absent is EXACT, not a guess: every record sealed before this field
  // existed is a Chinese Wedding.
  assert.equal(validateWeddingFacts(validFacts()).facts.culture, "chinese");
  assert.equal(validateWeddingFacts(westernFacts()).facts.culture, "western");
  assert.equal(validateWeddingFacts(validFacts({ culture: "" })).facts.culture, "chinese");

  const bad = validateWeddingFacts(validFacts({ culture: "japanese" }));
  assert.equal(bad.ok, false);
  assert.equal(bad.field, "culture");
});

test("culture survives sealing into the occasion record", () => {
  const res = validateWeddingOccasion({ type: "wedding", version: 2, ...westernFacts() });
  assert.equal(res.ok, true);
  assert.equal(res.occasion.culture, "western");
  assert.equal(res.occasion.type, "wedding"); // Western Wedding is STILL type wedding
});

test("rsvpDeadline: optional, ISO-valid, and never after the wedding itself", () => {
  assert.equal(validateWeddingFacts(westernFacts()).facts.rsvpDeadline, null);
  assert.equal(
    validateWeddingFacts(westernFacts({ rsvpDeadline: "2026-09-01" })).facts.rsvpDeadline,
    "2026-09-01",
  );
  // Same day is allowed (late but coherent); after the wedding is not.
  assert.equal(validateWeddingFacts(westernFacts({ rsvpDeadline: "2026-10-01" })).ok, true);
  for (const bad of ["2026-10-02", "not-a-date", "2026-13-01", "2026-02-30"]) {
    const res = validateWeddingFacts(westernFacts({ rsvpDeadline: bad }));
    assert.equal(res.ok, false, `expected rejection for ${bad}`);
    assert.equal(res.field, "rsvpDeadline");
  }
});

test("dressCode: optional, trimmed, capped at 40", () => {
  assert.equal(validateWeddingFacts(westernFacts()).facts.dressCode, null);
  assert.equal(validateWeddingFacts(westernFacts({ dressCode: "  Cocktail  " })).facts.dressCode, "Cocktail");
  const long = validateWeddingFacts(westernFacts({ dressCode: "x".repeat(41) }));
  assert.equal(long.ok, false);
  assert.equal(long.field, "dressCode");
});

test("formatWeddingDate renders the locale-appropriate form", () => {
  assert.equal(formatWeddingDate("2026-10-01"), "2026年10月1日");        // default unchanged
  assert.equal(formatWeddingDate("2026-10-01", "zh"), "2026年10月1日");
  assert.equal(formatWeddingDate("2026-10-01", "en"), "October 1, 2026");
  assert.equal(formatWeddingDate("2027-01-15", "en"), "January 15, 2027");
});

test("weddingDateVariants accepts natural US and UK renderings, nothing else", () => {
  const en = weddingDateVariants("2026-10-01", "en");
  assert.ok(en.includes("October 1, 2026"));
  assert.ok(en.includes("1 October 2026"));
  assert.deepEqual(weddingDateVariants("2026-10-01", "zh"), ["2026年10月1日"]);
});

test("weddingLanguageFor: explicit wins, else culture decides", () => {
  assert.equal(weddingLanguageFor(westernFacts()), "en");
  assert.equal(weddingLanguageFor(validFacts()), "zh");
  assert.equal(weddingLanguageFor(westernFacts(), "zh"), "zh");
  assert.equal(weddingLanguageFor(validFacts(), "en"), "en");
});

test("validateWeddingDraft gates English prose on English facts (P0.2)", () => {
  const facts = validateWeddingFacts(westernFacts()).facts;
  assert.equal(validateWeddingDraft(enDraft(), facts), true);
  assert.equal(validateWeddingDraft(enDraft3(), facts), true); // UK date form

  // The PRINCIPLE is intact: drop a fact and the draft is refused.
  assert.equal(validateWeddingDraft(enDraft().replaceAll("Emma", "my partner"), facts), false);
  assert.equal(validateWeddingDraft(enDraft().replaceAll("Hedsor House", "the venue"), facts), false);
  assert.equal(validateWeddingDraft(enDraft().replaceAll("October 1, 2026", "next autumn"), facts), false);

  // A Chinese-rendered date does NOT satisfy an English wedding.
  assert.equal(
    validateWeddingDraft(enDraft().replaceAll("October 1, 2026", "2026年10月1日"), facts),
    false,
  );
});

test("validateWeddingDraft still gates Chinese prose on Chinese facts (unchanged)", () => {
  const facts = validateWeddingFacts(validFacts()).facts;
  assert.equal(validateWeddingDraft(validDraft(), facts), true);
  assert.equal(validateWeddingDraft(validDraft().replace("2026年10月1日", "October 1, 2026"), facts), false);
});

test("Western prompt is English, carries the facts, and is NOT the Chinese corpus", () => {
  const facts = validateWeddingFacts(westernFacts({ dressCode: "Cocktail", rsvpDeadline: "2026-09-01" })).facts;
  const { system, user } = buildWeddingDraftPrompt({ facts, tone: "warm", personalContext: "we met at university", language: "en" });

  assert.ok(system.includes("October 1, 2026"));
  assert.ok(system.includes("Hedsor House"));
  assert.ok(user.includes("Emma"));
  assert.ok(user.includes("James"));
  assert.ok(user.includes("we met at university"));
  // Structured extras are passed as CONTEXT but must not be written into prose.
  assert.ok(user.includes("Cocktail"));
  assert.ok(user.includes("do NOT state it in the prose"));
  // No Chinese ceremonial corpus leaked into the Western prompt.
  assert.equal(/[\u4e00-\u9fff]/.test(system), false);
  assert.equal(/[\u4e00-\u9fff]/.test(user), false);
});

test("Chinese prompt is unchanged by the Western addition", () => {
  const facts = validateWeddingFacts(validFacts()).facts;
  const { system, user } = buildWeddingDraftPrompt({ facts, tone: "sincere" });
  assert.ok(system.includes("2026年10月1日"));
  assert.ok(user.includes("【婚礼事实】"));
  assert.equal(system.includes("[FACT RULES"), false);
});

test("Western Wedding generates in English with no explicit language field", async () => {
  const res = await runWeddingDraft({
    decoded: AUTHOR,
    body: { occasion: westernOccasion() },
    callModel: async ({ system }) => {
      // Culture alone must have selected the English corpus.
      assert.ok(system.includes("[FACT RULES"));
      return JSON.stringify({ drafts: [enDraft(), enDraft2(), enDraft3()] });
    },
    log: SILENT,
  });
  assert.equal(res.status, 200);
  assert.equal(res.body.drafts.length, 3);
});

test("Western generation fails loudly when English drafts drop a fact", async () => {
  const res = await runWeddingDraft({
    decoded: AUTHOR,
    body: { occasion: westernOccasion() },
    callModel: async () => JSON.stringify({ drafts: ["A lovely day awaits. Do come."] }),
    log: SILENT,
  });
  assert.equal(res.status, 502);
  assert.equal(res.body.error, "wedding_draft_failed");
});


// --- Deployment-order protection (§6) ---------------------------------------

/**
 * THE INVARIANT: an unsupported/undeclared Occasion culture must fail closed,
 * never silently downgrade to Chinese.
 *
 * Why this exists: a backend that predates Western Wedding does not reject
 * unknown fields. Handed a Western payload it accepts it and DROPS `culture`,
 * sealing an immutable record that renders as a Chinese Wedding. Declaring
 * Western on contract v2 makes every such backend refuse it outright.
 */
test("INVARIANT: culture western on v1 is refused — never silently Chinese", () => {
  // The exact payload shape an old backend would have silently downgraded.
  const res = validateWeddingOccasion({ type: "wedding", version: 1, ...westernFacts() });
  assert.equal(res.ok, false);
  assert.equal(res.field, "version");

  // And on the generation path too.
  assert.equal(
    validateOccasionVersionCulture(OCCASION_VERSION, "western").ok,
    false,
  );
});

test("INVARIANT: v2 must declare a culture; unknown cultures are refused", () => {
  assert.equal(validateOccasionVersionCulture(OCCASION_VERSION_CULTURAL, undefined).field, "culture");
  assert.equal(validateOccasionVersionCulture(OCCASION_VERSION_CULTURAL, "").field, "culture");
  assert.equal(validateOccasionVersionCulture(OCCASION_VERSION_CULTURAL, "japanese").field, "culture");
  assert.equal(validateOccasionVersionCulture(OCCASION_VERSION_CULTURAL, "western").ok, true);
  assert.equal(validateOccasionVersionCulture(OCCASION_VERSION_CULTURAL, "chinese").ok, true);
});

test("BACKWARD COMPATIBILITY: legacy v1 with no culture is still valid Chinese", () => {
  const res = validateWeddingOccasion({ type: "wedding", version: 1, ...validFacts() });
  assert.equal(res.ok, true);
  assert.equal(res.occasion.version, 1);
  assert.equal(res.occasion.culture, "chinese");     // resolved, not invented
  // An explicit "chinese" on v1 is also fine — it says what v1 already meant.
  const explicit = validateWeddingOccasion({ type: "wedding", version: 1, ...validFacts({ culture: "chinese" }) });
  assert.equal(explicit.ok, true);
  assert.equal(explicit.occasion.version, 1);
});

test("a sealed Occasion keeps the contract version it declared", () => {
  const west = validateWeddingOccasion({ type: "wedding", version: 2, ...westernFacts() });
  assert.equal(west.ok, true);
  assert.equal(west.occasion.version, 2);
  assert.equal(west.occasion.culture, "western");

  const cn = validateWeddingOccasion({ type: "wedding", version: 1, ...validFacts() });
  assert.equal(cn.occasion.version, 1);             // v1 records stay v1 forever
});

test("unsupported contract versions are refused on both paths", async () => {
  for (const v of [0, 3, 9, "2", null, undefined]) {
    assert.equal(
      validateWeddingOccasion({ type: "wedding", version: v, ...validFacts() }).field,
      "version",
      `expected version rejection for ${JSON.stringify(v)}`,
    );
  }
  const draft = await runWeddingDraft({
    decoded: AUTHOR,
    body: { occasion: { type: "wedding", version: 3, facts: westernFacts() } },
    callModel: async () => { throw new Error("must not be called"); },
    log: SILENT,
  });
  assert.equal(draft.status, 400);
  assert.equal(draft.body.field, "version");
});

test("generation refuses a Western Occasion declared on v1", async () => {
  const res = await runWeddingDraft({
    decoded: AUTHOR,
    body: { occasion: { type: "wedding", version: 1, facts: westernFacts() }, language: "en" },
    callModel: async () => { throw new Error("must not be called"); },
    log: SILENT,
  });
  assert.equal(res.status, 400);
  assert.equal(res.body.error, "invalid_occasion");
  assert.equal(res.body.field, "version");
});
