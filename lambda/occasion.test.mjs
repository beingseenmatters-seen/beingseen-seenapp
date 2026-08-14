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
  assert.deepEqual(validateWeddingOccasion({ type: "wedding", version: 2, ...validFacts() }), {
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

test("runWeddingDraft rejects English (V1 is Chinese-first) and mixed situation+occasion", async () => {
  const en = await runWeddingDraft({ decoded: AUTHOR, body: { ...weddingBody(), language: "en" }, callModel: async () => "", log: SILENT });
  assert.equal(en.status, 400);
  assert.equal(en.body.error, "occasion_language_unsupported");

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
