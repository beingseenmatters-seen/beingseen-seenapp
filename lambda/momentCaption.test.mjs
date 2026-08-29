import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMomentMessages,
  parseMomentResponse,
  normalizeCaptionRequest,
  maxTokensForLength,
  CAPTION_TONES,
  CAPTION_PLATFORMS,
  CAPTION_LENGTHS,
  CAPTION_REFINES,
  MAX_ANALYSIS_IMAGES,
  MAX_IMAGE_DATAURL_CHARS,
} from "./momentCaption.mjs";

const IMG = "data:image/jpeg;base64," + "A".repeat(400);
const PNG = "data:image/png;base64," + "B".repeat(400);

// ---------- normalize ----------

test("normalize rejects a body with no grounding at all", () => {
  const r = normalizeCaptionRequest({});
  assert.equal(r.ok, false);
  assert.equal(r.error, "missing_input");
});

test("normalize accepts images-only (context optional — the v2 core)", () => {
  const r = normalizeCaptionRequest({ images: [IMG] });
  assert.equal(r.ok, true);
  assert.equal(r.value.context, "");
  assert.equal(r.value.images.length, 1);
});

test("normalize accepts context-only (text fallback path)", () => {
  const r = normalizeCaptionRequest({ context: "coffee" });
  assert.equal(r.ok, true);
  assert.equal(r.value.context, "coffee");
});

test("normalize accepts legacy v1 `description` as context", () => {
  const r = normalizeCaptionRequest({ description: "legacy body" });
  assert.equal(r.ok, true);
  assert.equal(r.value.context, "legacy body");
});

test("normalize applies safe defaults incl. length", () => {
  const { value } = normalizeCaptionRequest({ images: [IMG] });
  assert.equal(value.tone, "warm");
  assert.equal(value.platform, "general");
  assert.equal(value.length, "natural");
  assert.equal(value.language, "en");
  assert.equal(value.refine, null);
});

test("normalize validates every enum", () => {
  for (const tone of CAPTION_TONES)
    for (const platform of CAPTION_PLATFORMS)
      for (const length of CAPTION_LENGTHS) {
        const { value } = normalizeCaptionRequest({ images: [IMG], tone, platform, length, language: "zh" });
        assert.equal(value.tone, tone);
        assert.equal(value.platform, platform);
        assert.equal(value.length, length);
        assert.equal(value.language, "zh");
      }
});

test("normalize rejects >9 images", () => {
  const r = normalizeCaptionRequest({ images: Array(MAX_ANALYSIS_IMAGES + 1).fill(IMG) });
  assert.equal(r.ok, false);
  assert.equal(r.error, "too_many_images");
});

test("normalize rejects a non-data-URL image", () => {
  const r = normalizeCaptionRequest({ images: ["https://evil.example/x.jpg"] });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_image");
});

test("normalize rejects gif/svg data URLs (only jpeg/png/webp)", () => {
  const r = normalizeCaptionRequest({ images: ["data:image/gif;base64,AAAA"] });
  assert.equal(r.ok, false);
  assert.equal(r.error, "invalid_image");
});

test("normalize rejects an oversized single image with 413", () => {
  const big = "data:image/jpeg;base64," + "A".repeat(MAX_IMAGE_DATAURL_CHARS + 10);
  const r = normalizeCaptionRequest({ images: [big] });
  assert.equal(r.ok, false);
  assert.equal(r.error, "image_too_large");
  assert.equal(r.status, 413);
});

test("normalize accepts refine mode without images when grounding is carried", () => {
  const r = normalizeCaptionRequest({
    refine: "humorous",
    selectedCaption: "A butterfly landed on his hand.",
    observations: ["a child is holding out a hand", "a butterfly rests on the hand"],
  });
  assert.equal(r.ok, true);
  assert.equal(r.value.refine, "humorous");
  assert.equal(r.value.observations.length, 2);
});

test("normalize drops unknown refine values", () => {
  const r = normalizeCaptionRequest({ images: [IMG], refine: "spicier" });
  assert.equal(r.value.refine, null);
});

test("normalize clips very long context", () => {
  const { value } = normalizeCaptionRequest({ images: [IMG], context: "a".repeat(5000) });
  assert.equal(value.context.length, 1000);
});

// ---------- messages ----------

function base(over = {}) {
  return {
    images: [IMG, PNG],
    context: "",
    tone: "warm",
    platform: "general",
    length: "natural",
    language: "en",
    refine: null,
    selectedCaption: "",
    observations: [],
    ...over,
  };
}

test("generation messages carry every image as an image_url part with detail low", () => {
  const { userContent } = buildMomentMessages(base());
  const imgs = userContent.filter((p) => p.type === "image_url");
  assert.equal(imgs.length, 2);
  for (const p of imgs) assert.equal(p.image_url.detail, "low");
});

test("system prompt enforces observation discipline and the JSON contract", () => {
  const { system } = buildMomentMessages(base());
  assert.match(system, /Never turn assumptions into facts/);
  assert.match(system, /storySets/);
  assert.match(system, /narrative arc/);
  assert.match(system, /JSON object/);
});

test("multi-photo prompt treats photos as one Moment without forcing it", () => {
  const { system } = buildMomentMessages(base());
  assert.match(system, /one continuous Moment/i);
  assert.match(system, /do NOT force a false narrative/i);
  const single = buildMomentMessages(base({ images: [IMG] }));
  assert.doesNotMatch(single.system, /one continuous Moment/i);
});

test("context is framed as user-provided, absence stated explicitly", () => {
  const withCtx = buildMomentMessages(base({ context: "his first butterfly" }));
  assert.match(withCtx.system, /User context .*his first butterfly/);
  const without = buildMomentMessages(base());
  assert.match(without.system, /added no context/);
});

test("length + platform + tone rules land in the prompt", () => {
  const { system } = buildMomentMessages(base({ length: "story", platform: "wechat", tone: "playful" }));
  assert.match(system, /60–140 English words/);
  assert.match(system, /WeChat Moments/);
  assert.match(system, /playful/);
});

test("zh prompt is fully Chinese with zh length rules", () => {
  const { system } = buildMomentMessages(base({ language: "zh", length: "short", platform: "wechat" }));
  assert.match(system, /15–35 个汉字/);
  assert.match(system, /朋友圈/);
  assert.match(system, /绝不把推测当事实/);
});

test("refine mode sends NO images and grounds on carried observations", () => {
  const { system, userContent } = buildMomentMessages(
    base({
      refine: "humorous",
      selectedCaption: "A butterfly stayed on his hand for a while.",
      observations: ["a butterfly rests on a child's hand"],
      context: "first butterfly",
    }),
  );
  assert.equal(userContent.some((p) => p.type === "image_url"), false);
  assert.match(system, /butterfly rests on a child's hand/);
  assert.match(system, /never a generic joke/);
  assert.match(system, /first butterfly/);
});

test("maxTokensForLength scales with length", () => {
  assert.ok(maxTokensForLength("short") < maxTokensForLength("natural"));
  assert.ok(maxTokensForLength("natural") < maxTokensForLength("story"));
});

// ---------- parse ----------

test("parse reads the typed JSON contract", () => {
  const out = parseMomentResponse(
    JSON.stringify({
      observations: ["a child holds out a hand", "a butterfly rests on it"],
      overlaySuggestions: ["Little visitor.", "今天交了个新朋友 🦋", "Just this moment."],
      captions: ["c1", "c2", "c3"],
    }),
  );
  assert.equal(out.observations.length, 2);
  assert.equal(out.overlaySuggestions.length, 3);
  assert.deepEqual(out.captions, ["c1", "c2", "c3"]);
});

test("parse tolerates JSON wrapped in prose and caps list sizes", () => {
  const raw =
    "Here you go:\n" +
    JSON.stringify({
      observations: Array(20).fill("obs"),
      overlaySuggestions: ["a", "b", "c", "d", "e"],
      captions: ["1", "2", "3", "4"],
    });
  const out = parseMomentResponse(raw);
  assert.equal(out.observations.length, 8);
  assert.equal(out.overlaySuggestions.length, 3);
  assert.equal(out.captions.length, 3);
});

test("parse drops empty strings and non-strings", () => {
  const out = parseMomentResponse(
    JSON.stringify({ observations: ["", 42, "ok"], overlaySuggestions: [null], captions: ["only"] }),
  );
  assert.deepEqual(out.observations, ["ok"]);
  assert.deepEqual(out.overlaySuggestions, []);
  assert.deepEqual(out.captions, ["only"]);
});

test("parse throws when captions are missing (caller maps to 502)", () => {
  assert.throws(() => parseMomentResponse(JSON.stringify({ observations: ["x"], captions: [] })));
  assert.throws(() => parseMomentResponse("not json at all"));
  assert.throws(() => parseMomentResponse(""));
});

test("every refine enum has a rule in both languages", () => {
  for (const refine of CAPTION_REFINES) {
    for (const language of ["en", "zh"]) {
      const { system } = buildMomentMessages(
        base({ refine, selectedCaption: "x", observations: ["o"], language }),
      );
      assert.ok(system.length > 100, `${refine}/${language} produced a prompt`);
    }
  }
});

// ---------- musicMood (Moment Movie upgrade) ----------

test("generation prompt asks for a musicMood recommendation with privacy rule", () => {
  const { system } = buildMomentMessages(base());
  assert.match(system, /musicMood/);
  assert.match(system, /NEVER infer sensitive personal facts/);
});

test("parse validates musicMood enum and nulls unknown values", () => {
  const ok = parseMomentResponse(JSON.stringify({ captions: ["c"], musicMood: "romantic" }));
  assert.equal(ok.musicMood, "romantic");
  const none = parseMomentResponse(JSON.stringify({ captions: ["c"], musicMood: "none" }));
  assert.equal(none.musicMood, "none");
  const bad = parseMomentResponse(JSON.stringify({ captions: ["c"], musicMood: "techno" }));
  assert.equal(bad.musicMood, null);
  const absent = parseMomentResponse(JSON.stringify({ captions: ["c"] }));
  assert.equal(absent.musicMood, null);
});

// ---------- story sets + typography (three-part text correction) ----------

test("parse reads story sets and derives back-compat overlaySuggestions from openings", () => {
  const out = parseMomentResponse(
    JSON.stringify({
      captions: ["c1"],
      storySets: [
        { opening: "第一次站上雪地，还有一点小紧张。", middle: "摔倒了再起来，慢慢找到自己的节奏。", ending: "这个冬天，又多了一段值得记住的故事。" },
        { opening: "阳光、白雪，今天正式开滑 ☀️", middle: "从小心翼翼，到越来越大胆。", ending: "第一次滑雪，完美收官。" },
      ],
    }),
  );
  assert.equal(out.storySets.length, 2);
  assert.equal(out.storySets[0].middle, "摔倒了再起来，慢慢找到自己的节奏。");
  assert.deepEqual(out.overlaySuggestions, [out.storySets[0].opening, out.storySets[1].opening]);
});

test("parse drops incomplete story sets (all three lines required)", () => {
  const out = parseMomentResponse(
    JSON.stringify({
      captions: ["c"],
      storySets: [
        { opening: "ok", middle: "", ending: "x" },
        { opening: "a", middle: "b", ending: "c" },
        { opening: "only" },
        { opening: "d", middle: "e", ending: "f" },
        { opening: "g", middle: "h", ending: "i" },
      ],
    }),
  );
  assert.equal(out.storySets.length, 3); // capped at 3, invalid dropped
  assert.equal(out.storySets[0].opening, "a");
});

test("parse falls back to legacy overlaySuggestions when no story sets", () => {
  const out = parseMomentResponse(JSON.stringify({ captions: ["c"], overlaySuggestions: ["a", "b"] }));
  assert.deepEqual(out.storySets, []);
  assert.deepEqual(out.overlaySuggestions, ["a", "b"]);
});

test("parse validates typography enum", () => {
  const ok = parseMomentResponse(JSON.stringify({ captions: ["c"], typography: "literary" }));
  assert.equal(ok.typography, "literary");
  const bad = parseMomentResponse(JSON.stringify({ captions: ["c"], typography: "comic-sans" }));
  assert.equal(bad.typography, null);
});

test("generation prompt asks for story sets with a narrative arc + typography with privacy rule", () => {
  const { system } = buildMomentMessages(base());
  assert.match(system, /storySets/);
  assert.match(system, /narrative arc/);
  assert.match(system, /typography/);
  assert.match(system, /Never three interchangeable generic quotes/i);
});
