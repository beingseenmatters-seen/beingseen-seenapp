/**
 * Moment.Seen — Smart Expression assistant (v2, vision-backed).
 *
 * Owns the prompt, request validation, and response parsing (index.mjs owns
 * the OpenAI key + HTTP, exactly like the Structured Occasion seam).
 *
 * v2 contract (POST /moment/caption, app-key gated, no auth token):
 *   in:  {
 *     images?:   string[]   // 0–9 data URLs — LOW-RES ANALYSIS COPIES only
 *     context?:  string     // optional user context (was `description` in v1)
 *     tone?:     plain|warm|reflective|playful
 *     platform?: general|wechat|whatsapp|instagram
 *     length?:   short|natural|story
 *     language?: en|zh
 *     refine?:   shorter|natural|humorous     // refine mode (no images needed)
 *     selectedCaption?: string                // the caption being refined
 *     observations?: string[]                 // grounding carried back on refine
 *   }
 *   out: { observations: string[], overlaySuggestions: string[], captions: string[] }
 *
 * PRIVACY: analysis images are used ONLY inside the live OpenAI request and are
 * never written to Firestore/S3/logs. No Moment.Seen cloud photo library.
 *
 * Backward compatibility: a v1 body ({ description, ... } with no images) still
 * works — `description` is accepted as `context`, and the response includes the
 * `captions` key the v1 frontend reads.
 */

export const MOMENT_CAPTION_TEMPERATURE = 0.85;

export const CAPTION_TONES = ["plain", "warm", "reflective", "playful"];
export const CAPTION_PLATFORMS = ["general", "wechat", "whatsapp", "instagram"];
export const CAPTION_LENGTHS = ["short", "natural", "story"];
export const CAPTION_REFINES = ["shorter", "natural", "humorous"];
/** Music moods the Moment Movie can score with (rights-approved assets only). */
export const MUSIC_MOODS = ["light", "warm", "romantic", "none"];
/** Typography themes the frontend ships (§11 — recommendation is a default only). */
export const TYPOGRAPHY_STYLES = ["modern", "elegant", "literary", "handwritten", "rounded", "bold"];

/** Analysis-copy limits — the frontend downscales before sending. */
export const MAX_ANALYSIS_IMAGES = 9;
export const MAX_IMAGE_DATAURL_CHARS = 480_000; // ~350KB binary per image
export const MAX_TOTAL_DATAURL_CHARS = 4_200_000; // ~3MB binary total (Lambda 6MB cap)

const DATA_URL_RE = /^data:image\/(jpeg|png|webp);base64,[A-Za-z0-9+/=]+$/;

/** max_tokens by requested length (JSON with 3 captions + 3 story sets + extras). */
export function maxTokensForLength(length) {
  if (length === "story") return 1400;
  if (length === "short") return 800;
  return 1050;
}

const TONE_LABEL = {
  en: { plain: "plain and clear", warm: "warm", reflective: "reflective", playful: "playful" },
  zh: { plain: "平实清楚", warm: "温暖", reflective: "内省", playful: "俏皮" },
};

const LENGTH_RULE = {
  en: {
    short: "Each caption: roughly 8–25 English words.",
    natural: "Each caption: roughly 25–70 English words.",
    story: "Each caption: roughly 60–140 English words, with real narrative — never padded with generic emotional filler.",
  },
  zh: {
    short: "每条文案约 15–35 个汉字。",
    natural: "每条文案约 40–90 个汉字。",
    story: "每条文案约 80–180 个汉字，要有真实的叙事推进——不许用空泛的抒情凑长度。",
  },
};

const PLATFORM_RULE = {
  en: {
    general: "Style: neutral and platform-independent.",
    wechat:
      "Style for WeChat Moments (朋友圈): natural, personal, conversational — written for friends and family. Avoid hashtags. Nothing salesy or performative.",
    whatsapp:
      "Style for WhatsApp: short, direct, message-like — as if texting close friends. No hashtags.",
    instagram:
      "Style for Instagram: visually expressive with a concise opening line; line breaks where they help; optional tasteful emoji; at most 1–3 hashtags and only when they fit naturally.",
  },
  zh: {
    general: "风格：中性、不针对特定平台。",
    wechat: "微信朋友圈风格：自然、私人、口语化——写给朋友和家人看。不用话题标签，不营销、不表演。",
    whatsapp: "WhatsApp 风格：更短、直接、像发消息——像发给亲近朋友的一句话。不用话题标签。",
    instagram: "Instagram 风格：开头一句要抓人；适当分行；可少量得体的 emoji；最多 1–3 个话题标签，且只在自然贴合时用。",
  },
};

const REFINE_RULE = {
  en: {
    shorter: "Rewrite it noticeably shorter while keeping the specific moment.",
    natural: "Rewrite it to sound more natural and conversational, less polished — same moment, same facts.",
    humorous: "Rewrite it with a light, humorous touch — playful, not corny — grounded in the SAME moment, never a generic joke.",
  },
  zh: {
    shorter: "改写得明显更短，但保留这个瞬间的具体细节。",
    natural: "改写得更自然、更口语，别太雕琢——同一个瞬间、同样的事实。",
    humorous: "改写出一点轻松的幽默感——俏皮但不尴尬——必须扎根于同一个瞬间，不许写无关的段子。",
  },
};

function pick(map, key, fallbackKey) {
  return map[key] !== undefined ? map[key] : map[fallbackKey];
}

/**
 * Validate + normalize the request body.
 * Returns { ok:true, value } or { ok:false, error, status }.
 */
export function normalizeCaptionRequest(body) {
  // v1 sent `description`; v2 sends optional `context`.
  const rawContext =
    typeof body?.context === "string" ? body.context : typeof body?.description === "string" ? body.description : "";
  const context = rawContext.trim().slice(0, 1000);

  const rawImages = Array.isArray(body?.images) ? body.images : [];
  if (rawImages.length > MAX_ANALYSIS_IMAGES) {
    return { ok: false, error: "too_many_images", status: 400 };
  }
  let total = 0;
  const images = [];
  for (const img of rawImages) {
    if (typeof img !== "string" || !DATA_URL_RE.test(img)) {
      return { ok: false, error: "invalid_image", status: 400 };
    }
    if (img.length > MAX_IMAGE_DATAURL_CHARS) {
      return { ok: false, error: "image_too_large", status: 413 };
    }
    total += img.length;
    images.push(img);
  }
  if (total > MAX_TOTAL_DATAURL_CHARS) {
    return { ok: false, error: "images_too_large", status: 413 };
  }

  const refine = CAPTION_REFINES.includes(body?.refine) ? body.refine : null;
  const selectedCaption =
    typeof body?.selectedCaption === "string" ? body.selectedCaption.trim().slice(0, 1200) : "";
  const observations = Array.isArray(body?.observations)
    ? body.observations
        .filter((o) => typeof o === "string" && o.trim() !== "")
        .map((o) => o.trim().slice(0, 300))
        .slice(0, 12)
    : [];

  // Something must ground the generation: images, context, or (refine + prior grounding).
  if (images.length === 0 && context === "" && !(refine && selectedCaption)) {
    return { ok: false, error: "missing_input", status: 400 };
  }

  const tone = CAPTION_TONES.includes(body?.tone) ? body.tone : "warm";
  const platform = CAPTION_PLATFORMS.includes(body?.platform) ? body.platform : "general";
  const length = CAPTION_LENGTHS.includes(body?.length) ? body.length : "natural";
  const language = body?.language === "zh" ? "zh" : "en";

  return {
    ok: true,
    value: { images, context, tone, platform, length, language, refine, selectedCaption, observations },
  };
}

/** Shared observation discipline — the "do not invent private facts" contract. */
function observationDiscipline(isZh) {
  return isZh
    ? [
        "观察纪律（必须遵守）：",
        "- observations 只写照片里【看得见】的事实（例如：一个孩子伸出手；一只蝴蝶停在手上；场景在户外，有绿植）。",
        "- 绝不把推测当事实：不得推断具体亲属关系、具体地点、姓名、场合或个人经历，除非用户在补充说明里明确提供。",
        "- 用户补充说明里的信息可以使用，但要当作用户提供的背景，而不是你看出来的。",
        "- 看不清或不确定的内容，宁可不写。",
      ].join("\n")
    : [
        "Observation discipline (MUST follow):",
        "- `observations` may contain ONLY what is VISIBLE in the photos (e.g. a child is holding out a hand; a butterfly is resting on the hand; the scene appears outdoors with greenery).",
        "- Never turn assumptions into facts: do not infer exact family relationships, exact locations, names, occasions, or personal history unless the user's context explicitly provides them.",
        "- Information from the user's context may be used, but treat it as user-provided background, not something you saw.",
        "- When something is unclear, leave it out.",
      ].join("\n");
}

function storySetsRule(isZh) {
  return isZh
    ? [
        "storySets：3 组完整的「小故事」，每组包含 opening / middle / ending 三句，印在短片的开头、中间、结尾。",
        "- 三句必须属于同一个叙事弧：开头引入，中间推进，结尾收束——不是三条可以互换的通用金句。",
        "- 每句约 4–18 个汉字，适合印在画面上；允许克制地用一个 emoji。",
        "- 三组之间角度或语气要明显不同（例如一组更内心，一组更轻快）。",
        "- 内容必须扎根于照片可见的事实或用户补充说明。",
      ].join("\n")
    : [
        "storySets: 3 complete mini-stories, each with opening / middle / ending lines shown at the start, middle, and end of the short movie.",
        "- The three lines of a set MUST form one narrative arc — a beginning, a development, a close. Never three interchangeable generic quotes.",
        "- Each line roughly 2–12 words, suitable to place on the image; one restrained emoji allowed.",
        "- The three sets must differ clearly in angle or tone (e.g. one inward, one lighter).",
        "- Ground every line in visible facts or the user's context.",
      ].join("\n");
}

function typographyRule(isZh) {
  return isZh
    ? "typography：从 modern（现代）/ elegant（雅致，适合婚礼、正式）/ literary（文艺，适合旅行、风景、内省）/ handwritten（手写，私人随性）/ rounded（圆润，适合孩子、宠物）/ bold（醒目，适合运动、庆祝）中选一个，为这个瞬间推荐文字风格。只依据画面可见的内容类型，绝不推断敏感的个人信息。"
    : "typography: recommend ONE of modern / elegant (weddings, formal) / literary (travel, landscapes, reflective) / handwritten (casual personal) / rounded (children, pets) / bold (sports, celebration) as the text style for this Moment. Base it ONLY on the visible type of content; NEVER infer sensitive personal facts.";
}

function captionRule(isZh, length, tone, platform) {
  const lang = isZh ? "zh" : "en";
  return [
    isZh
      ? "captions：3 条【明显不同】的分享文案。必须引用画面里具体可见的细节，或用户提供的背景——不许写放在几千张照片上都成立的空泛生活感悟（如「和大自然待在一起，心也慢慢变得柔软」这类就是反例）。"
      : "captions: 3 SUBSTANTIALLY different share captions. Each must reference specific visible details or user-provided context — never generic lifestyle language that could sit under thousands of unrelated photos.",
    LENGTH_RULE[lang][length],
    (isZh ? "语气：" : "Tone: ") + pick(TONE_LABEL[lang], tone, "warm") + (isZh ? "。" : "."),
    PLATFORM_RULE[lang][platform],
  ].join("\n");
}

/**
 * Build the Chat Completions messages for a generation round.
 * Returns { system, userContent } where userContent is a content-parts array
 * (text + image_url parts) for the user message.
 */
export function buildMomentMessages({ images, context, tone, platform, length, language, refine, selectedCaption, observations }) {
  const isZh = language === "zh";
  const lang = isZh ? "zh" : "en";

  // ---- Refine mode: no images; ground on carried-back observations. ----
  if (refine && selectedCaption) {
    const system = [
      isZh
        ? "你在帮一个人改写 TA 已选中的一条照片分享文案。你必须停留在同一个真实瞬间里。"
        : "You are refining a photo-share caption the user already selected. You MUST stay inside the same real moment.",
      observations.length
        ? (isZh ? "这个瞬间已确认的可见事实：\n" : "Confirmed visible facts of this moment:\n") +
          observations.map((o) => `- ${o}`).join("\n")
        : "",
      context ? (isZh ? `用户补充说明：${context}` : `User context: ${context}`) : "",
      (isZh ? "待改写的文案：" : "Caption to refine: ") + selectedCaption,
      REFINE_RULE[lang][refine],
      LENGTH_RULE[lang][length],
      PLATFORM_RULE[lang][platform],
      observationDiscipline(isZh),
      isZh
        ? '严格只输出一个 JSON 对象：{"observations":[],"overlaySuggestions":[],"captions":["改写1","改写2","改写3"]}。captions 是 3 个不同的改写方向。不要输出其它任何内容。'
        : 'Output ONLY a JSON object: {"observations":[],"overlaySuggestions":[],"captions":["rewrite1","rewrite2","rewrite3"]} — 3 different refinement directions. Nothing else.',
    ]
      .filter(Boolean)
      .join("\n\n");
    return { system, userContent: [{ type: "text", text: selectedCaption }] };
  }

  // ---- Generation mode: images (if any) + optional context. ----
  const multi = images.length > 1;
  const system = [
    isZh
      ? "你在帮一个人为 TA 刚选出的照片准备分享表达。先看懂照片里正在发生什么，再帮 TA 说出来。"
      : "You help someone prepare a just-selected photo moment for sharing. First understand what is actually happening in the photos, then help them express it.",
    multi
      ? isZh
        ? "多张照片通常是【同一个瞬间/同一件事】的连续画面——把它们当作一个整体去理解和描述。但如果照片明显互不相关，就不要硬编一个故事，按一组照片的共同气质来写。"
        : "Multiple photos are usually one continuous Moment — understand and describe them as ONE combined event. But if they are clearly unrelated, do NOT force a false narrative; write for the collection honestly."
      : "",
    context
      ? (isZh ? "用户补充说明（照片看不出来的信息）：" : "User context (things the photos cannot show): ") + context
      : isZh
        ? "用户没有补充说明——只依据照片可见内容。"
        : "The user added no context — rely on what is visible.",
    observationDiscipline(isZh),
    isZh ? "输出要求：" : "Output requirements:",
    isZh
      ? "observations：3–6 条照片可见事实，简短、客观。"
      : "observations: 3–6 short, objective visible facts from the photos.",
    storySetsRule(isZh),
    captionRule(isZh, length, tone, platform),
    isZh
      ? "musicMood：从 light / warm / romantic / none 中选一个，为这个瞬间的配乐给出推荐。只依据画面的可见内容类型（如：庆祝聚会→light；家庭温馨、孩子玩耍→warm 或 light；情侣、婚礼→romantic；自然旅行→light；安静内省的画面→warm 或 none）。绝不为了选音乐去推断敏感的个人信息。"
      : "musicMood: recommend ONE of light / warm / romantic / none as the score for this Moment. Base it ONLY on the visible type of content (e.g. celebration → light; cozy family or children playing → warm or light; couple/wedding → romantic; nature/travel → light; quiet reflective scenes → warm or none). NEVER infer sensitive personal facts to choose music.",
    typographyRule(isZh),
    isZh
      ? "写作基准：真诚、克制、贴近真实口吻，像本人发的，不像广告或散文比赛。"
      : "Voice: sincere, restrained, close to how a real person actually posts — never ad copy, never an essay contest.",
    isZh
      ? '严格只输出一个 JSON 对象：{"observations":[...],"storySets":[{"opening":"...","middle":"...","ending":"..."},{...},{...}],"captions":["...","...","..."],"musicMood":"light|warm|romantic|none","typography":"modern|elegant|literary|handwritten|rounded|bold"}。不要输出其它任何内容。'
      : 'Output ONLY a JSON object: {"observations":[...],"storySets":[{"opening":"...","middle":"...","ending":"..."},{...},{...}],"captions":["...","...","..."],"musicMood":"light|warm|romantic|none","typography":"modern|elegant|literary|handwritten|rounded|bold"}. Nothing else.',
  ]
    .filter(Boolean)
    .join("\n\n");

  const userContent = [];
  userContent.push({
    type: "text",
    text: isZh
      ? context
        ? `请基于这些照片和我的补充说明，帮我准备分享表达。补充说明：${context}`
        : "请基于这些照片，帮我准备分享表达。"
      : context
        ? `Please prepare share expressions from these photos and my note. Note: ${context}`
        : "Please prepare share expressions from these photos.",
  });
  for (const img of images) {
    // detail:"low" — a 512px understanding pass; cheap, and enough for scene facts.
    userContent.push({ type: "image_url", image_url: { url: img, detail: "low" } });
  }
  return { system, userContent };
}

/**
 * Parse + validate the model's JSON reply into the typed contract.
 * Returns { observations, overlaySuggestions, captions } — captions non-empty
 * or it throws (caller maps to a 502).
 */
export function parseMomentResponse(content) {
  const text = String(content || "").trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) throw new Error("no_json");
  let data;
  try {
    data = JSON.parse(text.slice(start, end + 1));
  } catch {
    throw new Error("bad_json");
  }
  const clean = (arr, cap, maxLen) =>
    (Array.isArray(arr) ? arr : [])
      .filter((s) => typeof s === "string" && s.trim() !== "")
      .map((s) => s.trim().slice(0, maxLen))
      .slice(0, cap);

  const observations = clean(data.observations, 8, 300);
  const captions = clean(data.captions, 3, 1500);
  if (captions.length === 0) throw new Error("no_captions");

  // Story sets: up to 3 complete opening/middle/ending arcs (§2). A set
  // survives only if all three lines are usable strings.
  const cleanLine = (s) => (typeof s === "string" && s.trim() !== "" ? s.trim().slice(0, 80) : null);
  const storySets = (Array.isArray(data.storySets) ? data.storySets : [])
    .map((set) => {
      const opening = cleanLine(set?.opening);
      const middle = cleanLine(set?.middle);
      const ending = cleanLine(set?.ending);
      return opening && middle && ending ? { opening, middle, ending } : null;
    })
    .filter(Boolean)
    .slice(0, 3);

  // Back-compat: older clients read overlaySuggestions — the opening lines
  // (or the model's own field when it sent the legacy shape).
  const overlaySuggestions =
    storySets.length > 0 ? storySets.map((s) => s.opening) : clean(data.overlaySuggestions, 3, 80);

  const musicMood = MUSIC_MOODS.includes(data.musicMood) ? data.musicMood : null;
  const typography = TYPOGRAPHY_STYLES.includes(data.typography) ? data.typography : null;
  return { observations, storySets, overlaySuggestions, captions, musicMood, typography };
}
