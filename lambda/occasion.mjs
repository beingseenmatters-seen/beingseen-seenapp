/**
 * Seen — Structured Occasion engine, server side. Wedding V1 (Chinese-first).
 *
 * Architectural rule (Founder-approved, Phase 1): event facts are persistent
 * structured data, SEPARATE from AI prose. Facts never exist only inside
 * generated text — the client seals facts from its own form state; generation
 * receives facts as input and is validated against them, but facts never
 * round-trip out of the model.
 *
 * This module is deliberately DI-style like gift.mjs: pure validation +
 * prompt building, and an orchestrator (`runWeddingDraft`) that takes the
 * model call as a dependency so retry/failure logic is unit-testable.
 *
 * The occasion data model is generic ({ type, version, ... }); everything
 * wedding-specific lives behind type === "wedding". Later occasions add a
 * type, not a rewrite. No presentation choices are persisted here (visual
 * identity — 红/囍 for the Chinese experience — is a later, separate layer).
 */

// --- Contract constants -----------------------------------------------------

export const OCCASION_TYPE_WEDDING = "wedding";
export const OCCASION_VERSION = 1;

/** Stable internal audience values — UI labels come later, never stored. */
export const WEDDING_AUDIENCES = [
  "relatives",
  "elders",
  "friends",
  "close_friends",
  "colleagues",
  "clients_vip",
];

/** Wedding tone vocabulary — independent of the legacy Expression tones. */
export const WEDDING_TONES = [
  "sincere",
  "warm",
  "joyful",
  "literary",
  "poetic",
  "lighthearted",
];

/** Generation budget — scoped to Wedding occasion mode only (never legacy). */
export const WEDDING_DRAFT_MAX_TOKENS = 1800;
export const WEDDING_DRAFT_TEMPERATURE = 0.8;

const LIMITS = {
  partner: 40,
  venueName: 80,
  address: 160,
  inviter: 40,
  personalContext: 200,
};

// --- Facts validation -------------------------------------------------------

function cleanString(v, max) {
  if (typeof v !== "string") return null;
  const s = v.trim();
  if (!s || s.length > max) return null;
  return s;
}

function isValidIsoDate(s) {
  if (typeof s !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const [y, m, d] = s.split("-").map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d;
}

const TIME_RE = /^([01]\d|2[0-3]):[0-5]\d$/;

/**
 * Validate + normalize the Wedding facts group:
 *   { couple:{partner1,partner2}, date, time:{start,end?},
 *     venue:{displayName,formattedAddress?,latitude?,longitude?},
 *     inviter, audienceType }
 *
 * Returns { ok:true, facts } with a canonical shape (absent optionals stored
 * as null), or { ok:false, field } naming the first offending field. Invalid
 * input is REJECTED, never silently discarded (Founder rule).
 */
export function validateWeddingFacts(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, field: "facts" };

  const couple = raw.couple;
  if (!couple || typeof couple !== "object") return { ok: false, field: "couple" };
  const partner1 = cleanString(couple.partner1, LIMITS.partner);
  if (!partner1) return { ok: false, field: "couple.partner1" };
  const partner2 = cleanString(couple.partner2, LIMITS.partner);
  if (!partner2) return { ok: false, field: "couple.partner2" };

  if (!isValidIsoDate(raw.date)) return { ok: false, field: "date" };

  const time = raw.time;
  if (!time || typeof time !== "object") return { ok: false, field: "time" };
  if (typeof time.start !== "string" || !TIME_RE.test(time.start)) {
    return { ok: false, field: "time.start" };
  }
  let end = null;
  if (time.end !== undefined && time.end !== null && time.end !== "") {
    if (typeof time.end !== "string" || !TIME_RE.test(time.end)) {
      return { ok: false, field: "time.end" };
    }
    end = time.end;
  }

  const venue = raw.venue;
  if (!venue || typeof venue !== "object") return { ok: false, field: "venue" };
  const displayName = cleanString(venue.displayName, LIMITS.venueName);
  if (!displayName) return { ok: false, field: "venue.displayName" };
  let formattedAddress = null;
  if (venue.formattedAddress !== undefined && venue.formattedAddress !== null && venue.formattedAddress !== "") {
    formattedAddress = cleanString(venue.formattedAddress, LIMITS.address);
    if (!formattedAddress) return { ok: false, field: "venue.formattedAddress" };
  }
  // Coordinates: provider-neutral, optional, both-or-neither. No map URLs.
  const hasLat = venue.latitude !== undefined && venue.latitude !== null;
  const hasLng = venue.longitude !== undefined && venue.longitude !== null;
  if (hasLat !== hasLng) return { ok: false, field: "venue.coordinates" };
  let latitude = null;
  let longitude = null;
  if (hasLat) {
    if (typeof venue.latitude !== "number" || !Number.isFinite(venue.latitude) || Math.abs(venue.latitude) > 90) {
      return { ok: false, field: "venue.latitude" };
    }
    if (typeof venue.longitude !== "number" || !Number.isFinite(venue.longitude) || Math.abs(venue.longitude) > 180) {
      return { ok: false, field: "venue.longitude" };
    }
    latitude = venue.latitude;
    longitude = venue.longitude;
  }

  const inviter = cleanString(raw.inviter, LIMITS.inviter);
  if (!inviter) return { ok: false, field: "inviter" };

  if (!WEDDING_AUDIENCES.includes(raw.audienceType)) {
    return { ok: false, field: "audienceType" };
  }

  return {
    ok: true,
    facts: {
      couple: { partner1, partner2 },
      date: raw.date,
      time: { start: time.start, end },
      venue: { displayName, formattedAddress, latitude, longitude },
      inviter,
      audienceType: raw.audienceType,
    },
  };
}

/**
 * Validate the SEALED occasion shape (gift/create):
 *   { type:"wedding", version:1, couple, date, time, venue, inviter, audienceType }
 * (facts flat inside occasion — no `facts` wrapper in storage).
 */
export function validateWeddingOccasion(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, field: "occasion" };
  if (raw.type !== OCCASION_TYPE_WEDDING) return { ok: false, field: "type" };
  if (raw.version !== OCCASION_VERSION) return { ok: false, field: "version" };
  const { type: _t, version: _v, ...facts } = raw;
  const res = validateWeddingFacts(facts);
  if (!res.ok) return res;
  return {
    ok: true,
    occasion: { type: OCCASION_TYPE_WEDDING, version: OCCASION_VERSION, ...res.facts },
  };
}

// --- Prompt building --------------------------------------------------------

/** "2026-10-01" → "2026年10月1日" (no zero padding — natural Chinese). */
export function formatWeddingDate(date) {
  const [y, m, d] = date.split("-").map(Number);
  return `${y}年${m}月${d}日`;
}

const AUDIENCE_GUIDANCE = {
  relatives: "亲戚家人——亲切自然，是家里人说话的温度，郑重但不客套。",
  elders: "长辈——敬重、感恩、郑重相邀（如「诚挚邀请您」的语感），但不僵硬、不老套。",
  friends: "朋友——自然、真挚，像认真地告诉朋友一件人生大事。",
  close_friends: "多年挚友——更私人、更有回忆感，可以不拘礼数（如「这一次，也希望你在」的语感）。",
  colleagues: "同事——温暖而得体，有分寸，不过分亲昵。",
  clients_vip: "客户与贵宾——正式、周到、有礼，郑重而不谄媚。",
};

const TONE_GUIDANCE = {
  sincere: "真诚——朴素诚恳，句句落在实处。",
  warm: "温暖——柔软、有人情味。",
  joyful: "喜悦——明亮、带着笑意，是喜事应有的欢快。",
  literary: "文艺——干净克制的书面感，有留白。",
  poetic: "诗意——含蓄、有画面，但仍是自然的现代汉语，绝不做作。",
  lighthearted: "轻快——轻盈不沉重，可以有一点点俏皮，但不失体面。",
};

// Six composition angles; each request names three, rotated by `attempt` so
// 换一批 genuinely explores new ground instead of re-rolling the same ask.
const COMPOSITION_ANGLES = [
  "以温暖真挚的正式邀请为主线——诚恳地说出婚讯与邀请本身",
  "以关系与共同记忆为主线——从「你对我们的意义」写起",
  "以更文气、克制的书面表达为主线——安静、庄重、有留白",
  "以喜悦分享为主线——把好消息告诉重要的人时的那种高兴",
  "以感恩为主线——谢谢对方一路以来的存在与陪伴",
  "以简洁得体为主线——篇幅最短的一篇，但仍是有开场与收尾的完整邀请，绝不是一句通知",
];

export function anglesForAttempt(attempt) {
  const n = COMPOSITION_ANGLES.length;
  const offset = ((Math.trunc(attempt) % n) + n) % n;
  return [0, 1, 2].map((i) => COMPOSITION_ANGLES[(offset + i) % n]);
}

/**
 * Build the Wedding generation prompt (Chinese; Wedding V1 is zh-first).
 * Returns { system, user } — unlike the legacy path, untrusted sender input
 * (personalContext) sits in the user message, not the system role.
 */
export function buildWeddingDraftPrompt({ facts, tone, personalContext, attempt = 0 }) {
  const dateDisplay = formatWeddingDate(facts.date);
  const angles = anglesForAttempt(attempt);
  const toneKey = WEDDING_TONES.includes(tone) ? tone : "sincere";

  const system = [
    "你在替一对新人撰写中文婚礼邀请的正文——完整、可直接送出的邀请，不是贺卡金句，也不是三言两语的祝福。",
    "",
    "【事实规则（最高优先级）】",
    `以下事实必须完整保留：两位新人的姓名、日期「${dateDisplay}」、场地「${facts.venue.displayName}」都必须在每一篇中原样出现；时间也应自然出现在正文里。`,
    "时间写法：直接使用 24 小时制（如「17:00–20:00」），或换成自然的中文说法（如「下午五点到八点」）。绝对不要把「下午/上午/晚上」与 24 小时制混在一起——「下午17:00」是错误写法。",
    "严禁编造任何未提供的事实：具体地址、宴会厅名、仪式或晚宴的具体环节时间、着装要求、父母或家人的姓名与角色、宗教或婚俗环节、回复截止时间、餐饮安排、停车、住宿、路线指引、礼金或礼物要求。你可以创造情感表达，但不可以创造事实。",
    "",
    "【语言要求】",
    "当代、自然、有温度的中文。避免空洞的宏大辞藻与婚礼陈词滥调；「幸福」「美好」「圆满」「珍贵」「重要」这类词每篇合计至多出现一次，能不用就不用。不要伪诗歌，不要英文腔的直译感，除非语气要求，不要过度文言。温度比辞藻重要——写完后，发出邀请的人应当觉得「这就是我想表达的」。",
    "",
    "【开场要求】",
    "三篇的开场必须彼此完全不同，且不要都用称呼式开头（「亲爱的家人们：」「尊敬的长辈：」这类）。至少两篇不用称呼行，直接从一种心情、一个场景、或这件事本身写起。称呼是可选项，不是格式。",
    "",
    "【结构要求】",
    `每一篇都是完整的邀请：有合适的开场、清楚交代新人是谁、明确的邀请之意、与受邀对象关系相称的温度、日期、时间、地点、收尾的心意，并以「${facts.inviter}」自然落款。不要固定段落数，不要模板腔——完整比整齐重要。`,
    "即使是最简洁的一篇，也必须是一份有开场、有情感、有收尾的完整邀请，绝不能退化成一句通知或一张日程便条。",
    "",
    "【差异要求】",
    "三篇必须在情感结构与切入角度上真正不同（按下面指定的主线），不是同义改写，也不是靠长短制造差异。",
    "",
    "【输出格式】",
    '严格输出一个 JSON 对象：{"drafts":["第一篇","第二篇","第三篇"]}，不要输出其它任何内容。篇内换行用 \\n。',
  ].join("\n");

  const factsLines = [
    "【婚礼事实】",
    `新人：${facts.couple.partner1} 与 ${facts.couple.partner2}`,
    `日期：${dateDisplay}（须原样出现）`,
    `时间：${facts.time.start}${facts.time.end ? `–${facts.time.end}` : ""}`,
    `地点：${facts.venue.displayName}（名称须原样出现）`,
  ];
  if (facts.venue.formattedAddress) {
    factsLines.push(`地址：${facts.venue.formattedAddress}（可自然带入，也可不写）`);
  }
  factsLines.push(`落款：${facts.inviter}`);

  const user = [
    ...factsLines,
    "",
    `【受邀对象】${AUDIENCE_GUIDANCE[facts.audienceType]}`,
    `【语气】${TONE_GUIDANCE[toneKey]}`,
    ...(personalContext
      ? ["", `【发件人的心里话】（供你体会这段关系，把它融进表达里，不要原句照抄）：「${personalContext}」`]
      : []),
    "",
    "【三篇的主线】",
    `第一篇：${angles[0]}`,
    `第二篇：${angles[1]}`,
    `第三篇：${angles[2]}`,
  ].join("\n");

  return { system, user };
}

// --- Draft validation -------------------------------------------------------

/**
 * A Wedding draft is acceptable only if it preserved the core facts verbatim:
 * both partner names, the formatted date, and the venue display name.
 * (Time is expected in prose but rendered independently by the factual UI
 * later, so it is not part of the hard gate.)
 */
export function validateWeddingDraft(text, facts) {
  const t = typeof text === "string" ? text : "";
  if (!t.trim()) return false;
  return (
    t.includes(facts.couple.partner1) &&
    t.includes(facts.couple.partner2) &&
    t.includes(formatWeddingDate(facts.date)) &&
    t.includes(facts.venue.displayName)
  );
}

function parseWeddingDrafts(content) {
  try {
    const parsed = JSON.parse(String(content || ""));
    const arr = Array.isArray(parsed) ? parsed : parsed?.drafts;
    if (!Array.isArray(arr)) return [];
    return arr.map((s) => String(s).trim()).filter(Boolean);
  } catch {
    return [];
  }
}

// --- Orchestrator -----------------------------------------------------------

// Wedding mode returns at least this many validated compositions, or fails
// loudly — never a silent `{drafts: []}` (that legacy behavior is unchanged
// for the ordinary Expression path only).
const MIN_VALID_DRAFTS = 2;

/**
 * POST /express/draft — Structured Occasion mode (body.occasion present).
 *
 * Contract:
 *   body = {
 *     language?: "zh",                       // V1 is Chinese-first; "en" → 400
 *     occasion: {
 *       type: "wedding", version: 1,
 *       facts: { couple, date, time, venue, inviter, audienceType },
 *       tone?: one of WEDDING_TONES,         // default "sincere"
 *       personalContext?: string ≤200,       // generation-only; NEVER persisted
 *       attempt?: number                     // 换一批 variation seed
 *     }
 *   }
 *
 * Auth: REQUIRES a verified Firebase ID token (decoded) — Founder decision.
 * The legacy Expression path stays public; only occasion mode is gated.
 *
 * `callModel({system, user, maxTokens, temperature, jsonObject})` → content
 * string (throws on transport/HTTP failure). Injected for testability.
 */
export async function runWeddingDraft({ decoded, body, callModel, log = console }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };

  // Occasion mode and the legacy free-text mode are mutually exclusive.
  if (typeof body?.situation === "string" && body.situation.trim()) {
    return { status: 400, body: { error: "invalid_request" } };
  }
  if (body?.language === "en") {
    return { status: 400, body: { error: "occasion_language_unsupported" } };
  }

  const occ = body?.occasion;
  if (!occ || typeof occ !== "object") return { status: 400, body: { error: "invalid_occasion", field: "occasion" } };
  if (occ.type !== OCCASION_TYPE_WEDDING) return { status: 400, body: { error: "invalid_occasion", field: "type" } };
  if (occ.version !== OCCASION_VERSION) return { status: 400, body: { error: "invalid_occasion", field: "version" } };

  const factsRes = validateWeddingFacts(occ.facts);
  if (!factsRes.ok) return { status: 400, body: { error: "invalid_occasion", field: factsRes.field } };
  const facts = factsRes.facts;

  let tone = "sincere";
  if (occ.tone !== undefined && occ.tone !== null && occ.tone !== "") {
    if (!WEDDING_TONES.includes(occ.tone)) {
      return { status: 400, body: { error: "invalid_occasion", field: "tone" } };
    }
    tone = occ.tone;
  }

  let personalContext = null;
  if (occ.personalContext !== undefined && occ.personalContext !== null && occ.personalContext !== "") {
    if (typeof occ.personalContext !== "string" || occ.personalContext.trim().length > LIMITS.personalContext) {
      return { status: 400, body: { error: "invalid_occasion", field: "personalContext" } };
    }
    personalContext = occ.personalContext.trim();
  }

  const attempt =
    typeof occ.attempt === "number" && Number.isFinite(occ.attempt)
      ? Math.max(0, Math.trunc(occ.attempt))
      : 0;

  // Generate → validate facts survived → retry once with fresh angles → fail loudly.
  const seen = new Set();
  const valid = [];
  for (let round = 0; round < 2; round += 1) {
    let content;
    try {
      content = await callModel({
        ...buildWeddingDraftPrompt({ facts, tone, personalContext, attempt: attempt + round }),
        maxTokens: WEDDING_DRAFT_MAX_TOKENS,
        temperature: WEDDING_DRAFT_TEMPERATURE,
        jsonObject: true,
      });
    } catch (e) {
      log.error?.("[Occasion] wedding model call failed", e?.message || e);
      continue;
    }
    const drafts = parseWeddingDrafts(content);
    let dropped = 0;
    for (const d of drafts) {
      if (seen.has(d)) continue;
      seen.add(d);
      if (validateWeddingDraft(d, facts)) valid.push(d);
      else dropped += 1;
    }
    if (dropped > 0) log.warn?.(`[Occasion] wedding drafts dropped by fact validation: ${dropped} (round ${round + 1})`);
    if (valid.length >= 3) break;
  }

  if (valid.length < MIN_VALID_DRAFTS) {
    log.error?.(`[Occasion] wedding draft generation failed: ${valid.length} valid after retry`);
    return { status: 502, body: { error: "wedding_draft_failed" } };
  }
  return { status: 200, body: { drafts: valid.slice(0, 3) } };
}
