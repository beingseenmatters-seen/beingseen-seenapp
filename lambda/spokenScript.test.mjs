/**
 * Spoken-script drafting (AI 帮我说) — the shared spoken register + the
 * Gift.Seen voice-script door, and the product-isolation contract:
 * Gift prompts NEVER carry Mind.Seen's Buddhist safeguards, Mind keeps them.
 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { spokenRules, spokenSystemPrompt, runGiftVoiceScript } from "./spokenScript.mjs";

const okModel = (capture) => async ({ system, user }) => {
  if (capture) { capture.system = system; capture.user = user; }
  return JSON.stringify({ scripts: ["版本一。", "版本二。", "版本三。"] });
};
const SENDER = { uid: "sender-1" };

test("shared spoken rules are product-neutral and carry the approved register", () => {
  const rules = spokenRules("zh");
  for (const must of ["READ ALOUD", "30–60 seconds", "SHORT sentences", "invented personal experiences"]) {
    assert.ok(rules.includes(must), must);
  }
  // Quote discipline (名人名言): never fabricate an attribution.
  assert.ok(rules.includes("WITHOUT fabricating a quote"));
  // NOTHING Buddhist/community-specific lives in the shared half.
  for (const never of ["济群法师", "静心学堂", "Buddhist", "观·静心"]) {
    assert.ok(!rules.includes(never), never);
  }
});

test("gift voice script: authenticated, three alternatives, GIFT context only", async () => {
  // Never an open model door.
  assert.equal((await runGiftVoiceScript({ decoded: null, body: {}, callModel: okModel() })).status, 401);

  const cap = {};
  const r = await runGiftVoiceScript({
    decoded: SENDER,
    body: {
      kind: "voice_script", surface: "gift_tag", lang: "zh",
      recipientLabel: "小雅", senderName: "阿哲",
      cardText: "谢谢你一直都在。", notes: "想让她知道我很感激",
      styleHint: "风格：真诚。",
    },
    callModel: okModel(cap),
  });
  assert.equal(r.status, 200);
  assert.equal(r.body.scripts.length, 3);
  // Context the creator already typed rides along — never retyped.
  assert.ok(cap.user.includes("小雅"));
  assert.ok(cap.user.includes("谢谢你一直都在。"));
  assert.ok(cap.user.includes("想让她知道我很感激"));
  // The spoken register + complement-not-duplicate rule are in force…
  assert.ok(cap.system.includes("READ ALOUD"));
  assert.ok(cap.system.includes("COMPLEMENT the written card"));
  assert.ok(cap.system.includes("Style direction: 风格：真诚。"));
  // …and Mind.Seen's Buddhist safeguards are ABSENT from the gift door.
  for (const never of ["济群法师", "静心学堂", "Buddhist", "mindfulness-community"]) {
    assert.ok(!cap.system.includes(never), never);
  }
});

test("wedding surface: couple/date/venue/audience context, couple-addressing role", async () => {
  const cap = {};
  const r = await runGiftVoiceScript({
    decoded: SENDER,
    body: {
      kind: "voice_script", surface: "wedding", lang: "zh",
      couple: { partner1: "李雷", partner2: "韩梅梅" },
      date: "2026-10-01", venueName: "华彩厅", audience: "亲友",
      cardText: "我们要结婚啦，盼你来。",
    },
    callModel: okModel(cap),
  });
  assert.equal(r.status, 200);
  assert.ok(cap.user.includes("李雷") && cap.user.includes("韩梅梅"));
  assert.ok(cap.user.includes("华彩厅"));
  assert.ok(cap.user.includes("WEDDING"));
  // No invention of relationship/wedding facts beyond the supplied context.
  assert.ok(cap.system.includes("not present in the supplied context"));
});

test("graceful failure on malformed model output", async () => {
  const bad = await runGiftVoiceScript({ decoded: SENDER, body: {}, callModel: async () => "not json" });
  assert.equal(bad.status, 502);
  const empty = await runGiftVoiceScript({ decoded: SENDER, body: {}, callModel: async () => JSON.stringify({ scripts: [] }) });
  assert.equal(empty.status, 502);
});

test("routing contract: the branch is EXPLICITLY gated; old draft paths untouched; Mind keeps its safeguards", () => {
  const index = readFileSync(new URL("./index.mjs", import.meta.url), "utf-8");
  // Explicit kind gate BEFORE occasion dispatch — absent/different kind flows
  // exactly as before (occasion mode, then the legacy free-text path).
  const gate = index.indexOf('body.kind === "voice_script"');
  const occasion = index.indexOf("body.occasion !== undefined");
  assert.ok(gate > -1 && occasion > -1 && gate < occasion);
  assert.ok(index.includes("runGiftVoiceScript"));
  // Mind.Seen still carries its OWN Buddhist safeguards, physically in mind.mjs.
  const mind = readFileSync(new URL("./mind.mjs", import.meta.url), "utf-8");
  assert.ok(mind.includes("济群法师"));
  assert.ok(mind.includes("NEVER invent Buddhist teachings"));
  // And spokenScript.mjs (the shared+gift half) contains none of them.
  const shared = readFileSync(new URL("./spokenScript.mjs", import.meta.url), "utf-8");
  assert.ok(!shared.includes("济群法师"));
});
