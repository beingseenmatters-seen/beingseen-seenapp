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

/**
 * Occasion contract versions.
 *
 * v1 — the original Wedding contract. Carries no explicit culture; absent
 *      culture means Chinese, which is exact for every record sealed before
 *      Western Wedding existed.
 * v2 — the CULTURAL contract: culture is declared explicitly.
 *
 * DEPLOYMENT-ORDER PROTECTION (Founder §6). A backend that predates Western
 * Wedding does not reject unknown fields — it accepts a Western payload and
 * silently DROPS `culture`, sealing an immutable record that then renders as
 * a Chinese Wedding. Sealed records are product truth, so that downgrade is
 * unrecoverable.
 *
 * The fix uses the version gate the contract already had: a Western Occasion
 * declares v2, and every pre-Western backend rejects v2 outright
 * (`invalid_occasion`, field "version"). Western therefore FAILS CLOSED
 * against an unsupporting backend instead of silently becoming Chinese.
 *
 * Chinese Wedding deliberately stays on v1 — it is the live product, and
 * keeping it on the version every deployed backend already accepts means a
 * frontend/backend ordering mistake can never break it either.
 */
export const OCCASION_VERSION = 1;
export const OCCASION_VERSION_CULTURAL = 2;
export const SUPPORTED_OCCASION_VERSIONS = [OCCASION_VERSION, OCCASION_VERSION_CULTURAL];

/**
 * Cultural contract of a Wedding Occasion (Western Wedding V1).
 *
 * Chinese Wedding and Western Wedding are two distinct cultural Occasions
 * over ONE shared Wedding infrastructure — they share `type: "wedding"`,
 * the Event model, distribution, RSVP and media. `culture` is what makes
 * them distinguishable in SEALED truth, so the recipient experience never
 * has to infer culture from a `?p=` hint or from the reader's UI language.
 *
 * ABSENT culture === "chinese". Every record sealed before this field
 * existed is a Chinese Wedding, so the default is exact, not a guess, and
 * no migration is required.
 */
export const WEDDING_CULTURES = ["chinese", "western"];
export const DEFAULT_WEDDING_CULTURE = "chinese";

export const OCCASION_TYPE_BIRTHDAY = "birthday";

/**
 * Event types the Invitation engine serves. onsite (Live Event) deliberately
 * keeps its own wedding-only gate — Birthday Invitation owns no on-site flow.
 */
export const INVITATION_EVENT_TYPES = [OCCASION_TYPE_WEDDING, OCCASION_TYPE_BIRTHDAY];

/**
 * Birthday relationship vocabulary — ITS OWN list, not Wedding's. 长辈 and
 * clients_vip are wedding-shaped; a birthday party invites these.
 */
export const BIRTHDAY_AUDIENCES = ["family", "friends", "close_friends", "colleagues", "classmates"];

export const BIRTHDAY_TONES = ["warm", "playful", "casual", "heartfelt", "simple"];

/** Relationship vocabulary for an EVENT type — guests/variants validate here. */
export function audiencesForEventType(type) {
  return type === OCCASION_TYPE_BIRTHDAY ? BIRTHDAY_AUDIENCES : WEDDING_AUDIENCES;
}

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

/**
 * Wedding music theme allowlist (Invitation Presentation, Phase 3C-1).
 *
 * EMPTY until genuinely rights-cleared production assets exist — a theme id
 * here means a real, approved, playable asset; fake themes are never
 * sealable. Approved naming pattern (versioned, immutable, append-only —
 * frozen-presentation discipline; a sealed gift's sound never changes):
 *   wedding_warm_piano_v1        温暖钢琴 (default candidate)
 *   wedding_romantic_strings_v1  浪漫弦乐
 *   wedding_chinese_elegance_v1  中式雅韵
 *   wedding_quiet_celebration_v1 静谧喜悦
 * A materially different recording gets a _v2, never a replacement.
 * Every entry requires recorded rights provenance (source / license /
 * reference / internal approval) in the frontend registry — commissioned or
 * explicitly licensed for product distribution; "royalty-free" alone is not
 * sufficient. Music is Gift.Seen-owned presentation, never sender media.
 */
export const WEDDING_MUSIC_THEMES = [
  // Rights-verified 2026-08-15 (giftseen/docs/WEDDING_MUSIC_RIGHTS.md):
  // Pixabay Content License; ids immutable — a different recording is a _v2.
  "wedding_warm_piano_v1",        // 温暖钢琴 — default
  "wedding_romantic_ceremony_v1", // 浪漫仪式
  "wedding_light_invitation_v1",  // 轻盈邀请
  // DEV-ONLY escape hatch for local rig E2E (production never sets this).
  ...(process.env.GIFT_MEDIA_DEV_THEMES === "1" ? ["dev_placeholder_tone_v0"] : []),
];

const LIMITS = {
  partner: 40,
  venueName: 80,
  address: 160,
  inviter: 40,
  personalContext: 200,
  dressCode: 40,
  registryUrl: 300,
};

/**
 * External Wedding gift registry link (Western Wedding V1).
 *
 * Gift.Seen stores and presents a URL. It does NOT host registries, track
 * purchases, hold inventory, take payment or integrate with any provider —
 * the external registry remains authoritative. This is one optional string,
 * deliberately not a Registry model or collection.
 *
 * https ONLY: an invitation is a trusted surface, so a link that could carry
 * script or inline payload (javascript:, data:, vbscript:) is refused, and so
 * is plaintext http — a guest tapping through from a wedding invitation should
 * not be downgraded.
 */
export function validateRegistryUrl(raw, culture) {
  if (raw === undefined || raw === null || raw === "") return { ok: true, registryUrl: null };
  if (typeof raw !== "string") return { ok: false, field: "registryUrl" };
  const value = raw.trim();
  if (!value) return { ok: true, registryUrl: null };
  if (value.length > LIMITS.registryUrl) return { ok: false, field: "registryUrl" };

  // Registry is a WESTERN cultural product decision. A Chinese Wedding is not
  // given one merely because both cultures seal type "wedding"; if the Chinese
  // experience ever wants a gift convention, that is its own decision.
  if (culture !== "western") return { ok: false, field: "registryUrl" };

  let parsed;
  try {
    parsed = new URL(value);
  } catch {
    return { ok: false, field: "registryUrl" };
  }
  if (parsed.protocol !== "https:") return { ok: false, field: "registryUrl" };
  if (!parsed.hostname || !parsed.hostname.includes(".")) return { ok: false, field: "registryUrl" };
  return { ok: true, registryUrl: parsed.toString() };
}

/**
 * The version/culture invariant — the single place the fail-closed rule lives.
 *
 *   v1 + (absent | "chinese")  → ok   (legacy and Chinese Wedding)
 *   v1 + "western"             → REJECT: a Western Occasion must declare v2,
 *                                so it can never be sealed by a reader that
 *                                would ignore its culture.
 *   v2 + a known culture       → ok
 *   v2 + absent culture        → REJECT: v2 exists precisely to declare one.
 *   anything else              → REJECT.
 *
 * Returns { ok: true } or { ok: false, field }.
 */
export function validateOccasionVersionCulture(version, culture) {
  if (!SUPPORTED_OCCASION_VERSIONS.includes(version)) return { ok: false, field: "version" };
  const declared = culture !== undefined && culture !== null && culture !== "";
  if (declared && !WEDDING_CULTURES.includes(culture)) return { ok: false, field: "culture" };

  if (version === OCCASION_VERSION) {
    // Never allow a non-default culture to ride on the version that older
    // backends accept — that is exactly the silent-downgrade path.
    if (declared && culture !== DEFAULT_WEDDING_CULTURE) return { ok: false, field: "version" };
    return { ok: true };
  }
  // v2 must say what it is.
  if (!declared) return { ok: false, field: "culture" };
  return { ok: true };
}

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

  // Culture: optional and additive. Absent → "chinese" (every pre-Western
  // record). An unknown value is REJECTED, never silently defaulted.
  let culture = DEFAULT_WEDDING_CULTURE;
  if (raw.culture !== undefined && raw.culture !== null && raw.culture !== "") {
    if (!WEDDING_CULTURES.includes(raw.culture)) return { ok: false, field: "culture" };
    culture = raw.culture;
  }

  // Western V1 optional facts. Both are STRUCTURED product truth (never
  // parsed out of prose) and both are display/context only — rsvpDeadline
  // carries NO server-side enforcement in this milestone.
  let rsvpDeadline = null;
  if (raw.rsvpDeadline !== undefined && raw.rsvpDeadline !== null && raw.rsvpDeadline !== "") {
    if (!isValidIsoDate(raw.rsvpDeadline)) return { ok: false, field: "rsvpDeadline" };
    if (raw.rsvpDeadline > raw.date) return { ok: false, field: "rsvpDeadline" };
    rsvpDeadline = raw.rsvpDeadline;
  }

  let dressCode = null;
  if (raw.dressCode !== undefined && raw.dressCode !== null && raw.dressCode !== "") {
    dressCode = cleanString(raw.dressCode, LIMITS.dressCode);
    if (!dressCode) return { ok: false, field: "dressCode" };
  }

  const reg = validateRegistryUrl(raw.registryUrl, culture);
  if (!reg.ok) return { ok: false, field: reg.field };

  return {
    ok: true,
    facts: {
      couple: { partner1, partner2 },
      date: raw.date,
      time: { start: time.start, end },
      venue: { displayName, formattedAddress, latitude, longitude },
      inviter,
      audienceType: raw.audienceType,
      culture,
      rsvpDeadline,
      dressCode,
      registryUrl: reg.registryUrl,
    },
  };
}

const BIRTHDAY_LIMITS = { name: 40, eventTitle: 60, venueName: 80, address: 160, inviter: 40 };
export const BIRTHDAY_OCCASION_VERSION = 1;

/**
 * Birthday facts — deliberately the SMALLEST contract that is a real
 * invitation. One person (never a couple), when, where, who invites, and an
 * optional title ("Emma turns 30"). No culture field, no dress code, no RSVP
 * deadline, no registry, no lunar anything: Birthday exists to prove the
 * engine can carry a LIGHTER Occasion, not a re-skinned Wedding.
 */
export function validateBirthdayFacts(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, field: "facts" };
  const birthdayPersonName = cleanString(raw.birthdayPersonName, BIRTHDAY_LIMITS.name);
  if (!birthdayPersonName) return { ok: false, field: "birthdayPersonName" };

  if (!isValidIsoDate(raw.date)) return { ok: false, field: "date" };
  const time = raw.time;
  if (!time || typeof time !== "object") return { ok: false, field: "time" };
  if (typeof time.start !== "string" || !TIME_RE.test(time.start)) return { ok: false, field: "time.start" };
  let end = null;
  if (time.end !== undefined && time.end !== null && time.end !== "") {
    if (typeof time.end !== "string" || !TIME_RE.test(time.end)) return { ok: false, field: "time.end" };
    end = time.end;
  }

  const venue = raw.venue;
  if (!venue || typeof venue !== "object") return { ok: false, field: "venue" };
  const displayName = cleanString(venue.displayName, BIRTHDAY_LIMITS.venueName);
  if (!displayName) return { ok: false, field: "venue.displayName" };
  let formattedAddress = null;
  if (venue.formattedAddress !== undefined && venue.formattedAddress !== null && venue.formattedAddress !== "") {
    formattedAddress = cleanString(venue.formattedAddress, BIRTHDAY_LIMITS.address);
    if (!formattedAddress) return { ok: false, field: "venue.formattedAddress" };
  }

  // Host is OPTIONAL (Founder §3): most birthday invitations come from the
  // birthday person themself. Sealed null means "no separate host" — display
  // falls back to the birthday person, and a "Hosted by" line only exists
  // when a host was explicitly declared.
  let inviter = null;
  if (raw.inviter !== undefined && raw.inviter !== null && raw.inviter !== "") {
    inviter = cleanString(raw.inviter, BIRTHDAY_LIMITS.inviter);
    if (!inviter) return { ok: false, field: "inviter" };
  }
  if (!BIRTHDAY_AUDIENCES.includes(raw.audienceType)) return { ok: false, field: "audienceType" };

  let eventTitle = null;
  if (raw.eventTitle !== undefined && raw.eventTitle !== null && raw.eventTitle !== "") {
    eventTitle = cleanString(raw.eventTitle, BIRTHDAY_LIMITS.eventTitle);
    if (!eventTitle) return { ok: false, field: "eventTitle" };
  }

  return {
    ok: true,
    facts: {
      birthdayPersonName,
      eventTitle,
      date: raw.date,
      time: { start: time.start, end },
      venue: { displayName, formattedAddress },
      inviter,
      audienceType: raw.audienceType,
    },
  };
}

export function validateBirthdayOccasion(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, field: "occasion" };
  if (raw.type !== OCCASION_TYPE_BIRTHDAY) return { ok: false, field: "type" };
  if (raw.version !== BIRTHDAY_OCCASION_VERSION) return { ok: false, field: "version" };
  const { type: _t, version: _v, ...facts } = raw;
  const res = validateBirthdayFacts(facts);
  if (!res.ok) return res;
  return { ok: true, occasion: { type: OCCASION_TYPE_BIRTHDAY, version: BIRTHDAY_OCCASION_VERSION, ...res.facts } };
}

/**
 * ONE seal-door validator, dispatching on the declared type. Unknown types
 * fail closed — which is also the deployment-order story: a backend without
 * Birthday rejects a Birthday seal loudly (invalid_occasion/type); nothing
 * can silently downgrade.
 */
export function validateOccasion(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, field: "occasion" };
  if (raw.type === OCCASION_TYPE_BIRTHDAY) return validateBirthdayOccasion(raw);
  return validateWeddingOccasion(raw);
}

/**
 * Validate the SEALED occasion shape (gift/create):
 *   { type:"wedding", version:1, couple, date, time, venue, inviter, audienceType }
 * (facts flat inside occasion — no `facts` wrapper in storage).
 */
export function validateWeddingOccasion(raw) {
  if (!raw || typeof raw !== "object") return { ok: false, field: "occasion" };
  if (raw.type !== OCCASION_TYPE_WEDDING) return { ok: false, field: "type" };
  // Fail-closed version/culture gate BEFORE anything is normalized, so a
  // Western Occasion can never be accepted by a contract that would ignore
  // its culture.
  const vc = validateOccasionVersionCulture(raw.version, raw.culture);
  if (!vc.ok) return { ok: false, field: vc.field };
  const { type: _t, version: _v, ...facts } = raw;
  const res = validateWeddingFacts(facts);
  if (!res.ok) return res;
  // The sealed record keeps the version it declared — v1 stays v1 forever.
  return {
    ok: true,
    occasion: { type: OCCASION_TYPE_WEDDING, version: raw.version, ...res.facts },
  };
}

// --- Prompt building --------------------------------------------------------

const EN_MONTHS = [
  "January", "February", "March", "April", "May", "June",
  "July", "August", "September", "October", "November", "December",
];

/**
 * Canonical rendering of a wedding date for the generation language.
 *   zh → "2026年10月1日" (no zero padding — natural Chinese)
 *   en → "October 1, 2026"
 * Defaults to zh so every pre-Western call site is unchanged.
 */
export function formatWeddingDate(date, language = "zh") {
  const [y, m, d] = date.split("-").map(Number);
  if (language === "en") return `${EN_MONTHS[m - 1]} ${d}, ${y}`;
  return `${y}年${m}月${d}日`;
}

/**
 * Canonical 'HH:mm' → the written clock the generation language expects.
 *   zh → "17:00"      (unchanged; the Chinese corpus already handles this)
 *   en → "5:00 PM"
 * STORAGE IS UNTOUCHED — the sealed fact stays canonical 24-hour.
 */
export function formatWeddingTime(time, language = "zh") {
  if (language !== "en") return time;
  const m = /^([01]\d|2[0-3]):([0-5]\d)$/.exec(String(time));
  if (!m) return time;
  const h24 = Number(m[1]);
  const h12 = h24 % 12 === 0 ? 12 : h24 % 12;
  return `${h12}:${m[2]} ${h24 < 12 ? "AM" : "PM"}`;
}

/**
 * Renderings of the date that COUNT as the fact having survived generation.
 *
 * The principle is unchanged (facts validate prose; prose never creates
 * facts) — only the surface form is locale-appropriate. Chinese has exactly
 * one natural written form. English has two in common use, and refusing a
 * correct British rendering would be a validation bug, not rigour. Anything
 * outside this set still fails the gate.
 */
export function weddingDateVariants(date, language = "zh") {
  const [y, m, d] = date.split("-").map(Number);
  if (language === "en") {
    const month = EN_MONTHS[m - 1];
    return [`${month} ${d}, ${y}`, `${month} ${d} ${y}`, `${d} ${month} ${y}`];
  }
  return [`${y}年${m}月${d}日`];
}

/** Generation language for a facts group: explicit wins, else culture decides. */
export function weddingLanguageFor(facts, requested) {
  if (requested === "en" || requested === "zh") return requested;
  return facts?.culture === "western" ? "en" : "zh";
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

// --- Western Wedding (English) vocabulary -----------------------------------
// Written for Western wedding practice, NOT translated from the Chinese
// tables above: the registers differ (English invitations lean on restraint
// and formula — "request the pleasure of your company" — where the Chinese
// leans on warmth and relationship).

const EN_AUDIENCE_GUIDANCE = {
  relatives: "Family — affectionate and unguarded, the way you'd write to people who already know your whole story.",
  elders: "Older family members — respectful and a little more formal, genuinely honouring them without becoming stiff.",
  friends: "Friends — warm, natural, the tone of telling someone you care about a piece of real news.",
  close_friends: "Closest friends — personal and specific, room for shared history; formality can relax here.",
  colleagues: "Colleagues — warm but composed, friendly without presuming intimacy.",
  clients_vip: "Clients and honoured guests — formal, gracious and precise; courteous, never fawning.",
};

const EN_TONE_GUIDANCE = {
  sincere: "Sincere — plain, honest, every sentence meaning exactly what it says.",
  warm: "Warm — affectionate and human, generous without gushing.",
  joyful: "Joyful — bright and glad, the happiness the news actually carries.",
  literary: "Literary — considered and spare, comfortable with white space.",
  poetic: "Poetic — image-led and restrained; still natural modern English, never florid.",
  lighthearted: "Lighthearted — easy and a little playful, while staying gracious.",
};

// Six angles, rotated by `attempt` exactly like the Chinese set, so
// "regenerate" explores genuinely new ground instead of re-rolling.
const EN_COMPOSITION_ANGLES = [
  "a warm, direct invitation — simply and gladly say that they are marrying, and ask this person to be there",
  "lead with the relationship — begin from what this person has meant to the couple",
  "the formal register — restrained and traditional (\"request the pleasure of your company\"), dignified without being cold",
  "lead with the gladness of sharing the news with someone who matters",
  "lead with gratitude — thank them for their presence in the couple's life so far",
  "the shortest of the three — still a complete invitation with an opening and a close, never a bare notice",
];

export function enAnglesForAttempt(attempt) {
  const n = EN_COMPOSITION_ANGLES.length;
  const offset = ((Math.trunc(attempt) % n) + n) % n;
  return [0, 1, 2].map((i) => EN_COMPOSITION_ANGLES[(offset + i) % n]);
}

/**
 * Build the Western Wedding generation prompt (English).
 *
 * Same architecture as the Chinese builder — untrusted sender input
 * (personalContext) sits in the user message, never the system role — and
 * the same hard rule: invent expression, never facts.
 */
function buildEnglishWeddingPrompt({ facts, tone, personalContext, attempt = 0 }) {
  const dateDisplay = formatWeddingDate(facts.date, "en");
  const angles = enAnglesForAttempt(attempt);
  const toneKey = WEDDING_TONES.includes(tone) ? tone : "sincere";

  const system = [
    "You are writing the body of a Western wedding invitation — a complete invitation that could be sent as it stands, not a greeting-card line and not a short well-wish.",
    "",
    "[FACT RULES — HIGHEST PRIORITY]",
    `These must appear in every draft, exactly as written: both partners' names, the date \"${dateDisplay}\", and the venue \"${facts.venue.displayName}\". The time must also appear naturally in the text.`,
    "Write the date exactly as given above. Write the time the way a printed Western invitation does — \"4:00 PM\", \"4 pm\", \"four in the afternoon\", \"half past four\". NEVER use 24-hour form: \"16:00\" is wrong here, and never mix conventions in one phrase (\"4:00 PM in the afternoon\").",
    "Invent NO fact that was not supplied: no street address, no room or hall name, no ceremony or dinner schedule, no dress code, no parents' or family members' names or roles, no religious or cultural rites, no RSVP deadline, no catering, parking, travel, accommodation or gift information. You may invent feeling and phrasing. You may not invent facts.",
    "",
    "[LANGUAGE]",
    "Contemporary, natural English with real warmth. Avoid wedding cliché and inflated abstractions — \"magical\", \"perfect\", \"special day\", \"journey of love\", \"tie the knot\", \"happily ever after\". Between all three drafts, words like \"joy\", \"beautiful\" and \"precious\" may appear at most once in total. Do not imitate Victorian pastiche, and do not translate another language's cadence. Restraint reads as sincerity.",
    "Useful invitation formulas, to draw on rather than to copy mechanically: \"invite you to celebrate their wedding\", \"invite you to join them in celebrating their marriage\", \"request the pleasure of your company\", \"together with their families\".",
    "",
    "[OPENINGS]",
    "The three openings must be entirely different from one another, and they must not all begin with a salutation (\"Dear friends,\" and the like). At least two should open with a feeling, a scene, or the news itself. A salutation is optional, never a required format.",
    "",
    "[STRUCTURE]",
    `Each draft is a complete invitation: a fitting opening, a clear statement of who is marrying, an unmistakable invitation, warmth appropriate to this relationship, the date, the time, the place, a closing thought, and a natural sign-off from \"${facts.inviter}\". No fixed paragraph count and no template voice — completeness matters more than symmetry.`,
    "Even the briefest of the three must remain a real invitation with an opening, feeling and close. It must never collapse into a notice or a calendar entry.",
    "",
    "[DIFFERENCE]",
    "The three must genuinely differ in emotional structure and angle of approach (following the assigned lines below) — not paraphrases of one another, and not distinguished merely by length.",
    "",
    "[OUTPUT FORMAT]",
    'Output strictly one JSON object: {"drafts":["first","second","third"]}, and nothing else. Use \\n for line breaks inside a draft.',
  ].join("\n");

  const factsLines = [
    "[WEDDING FACTS]",
    `Couple: ${facts.couple.partner1} and ${facts.couple.partner2}`,
    `Date: ${dateDisplay} (must appear exactly)`,
    `Time: ${formatWeddingTime(facts.time.start, "en")}${facts.time.end ? ` – ${formatWeddingTime(facts.time.end, "en")}` : ""}`,
    `Venue: ${facts.venue.displayName} (name must appear exactly)`,
  ];
  if (facts.venue.formattedAddress) {
    factsLines.push(`Address: ${facts.venue.formattedAddress} (may be woven in, or left out)`);
  }
  factsLines.push(`Sign-off: ${facts.inviter}`);
  if (facts.dressCode) {
    factsLines.push(`Dress code: ${facts.dressCode} (shown separately to the guest — do NOT state it in the prose)`);
  }
  if (facts.rsvpDeadline) {
    factsLines.push(
      `RSVP by: ${formatWeddingDate(facts.rsvpDeadline, "en")} (shown separately to the guest — do NOT state it in the prose)`,
    );
  }

  const user = [
    ...factsLines,
    "",
    `[GUEST] ${EN_AUDIENCE_GUIDANCE[facts.audienceType]}`,
    `[TONE] ${EN_TONE_GUIDANCE[toneKey]}`,
    ...(personalContext
      ? ["", `[FROM THE SENDER] (to help you feel this relationship — weave it in, never quote it verbatim): "${personalContext}"`]
      : []),
    "",
    "[THE THREE LINES]",
    `First: ${angles[0]}`,
    `Second: ${angles[1]}`,
    `Third: ${angles[2]}`,
  ].join("\n");

  return { system, user };
}

/**
 * Build the Wedding generation prompt for the resolved language.
 *
 * Chinese Wedding and Western Wedding are two cultural Occasions over one
 * Wedding infrastructure, so they share this entry point, the orchestrator,
 * the fact gate and the retry policy — only the prompt corpus differs.
 * Returns { system, user }; untrusted sender input (personalContext) always
 * sits in the user message, never the system role.
 */
export function buildWeddingDraftPrompt({ facts, tone, personalContext, attempt = 0, language }) {
  const lang = weddingLanguageFor(facts, language);
  if (lang === "en") return buildEnglishWeddingPrompt({ facts, tone, personalContext, attempt });
  return buildChineseWeddingPrompt({ facts, tone, personalContext, attempt });
}

/**
 * Build the Chinese Wedding generation prompt (Wedding V1 is zh-first).
 * Unchanged from the shipped Chinese Wedding implementation.
 */
function buildChineseWeddingPrompt({ facts, tone, personalContext, attempt = 0 }) {
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
export function validateWeddingDraft(text, facts, language) {
  const t = typeof text === "string" ? text : "";
  if (!t.trim()) return false;
  const lang = weddingLanguageFor(facts, language);
  return (
    t.includes(facts.couple.partner1) &&
    t.includes(facts.couple.partner2) &&
    weddingDateVariants(facts.date, lang).some((v) => t.includes(v)) &&
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
 *     language?: "zh" | "en",                // absent → sealed culture decides
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
  // P0.1 — English generation is a supported server contract (Western
  // Wedding V1). An unrecognised language is still rejected; only the blanket
  // "en" refusal is gone. Absent language resolves from the sealed culture,
  // so a Chinese Wedding with no language field behaves exactly as before.
  const requestedLanguage = body?.language;
  if (
    requestedLanguage !== undefined &&
    requestedLanguage !== null &&
    requestedLanguage !== "" &&
    requestedLanguage !== "zh" &&
    requestedLanguage !== "en"
  ) {
    return { status: 400, body: { error: "occasion_language_unsupported" } };
  }

  const occ = body?.occasion;
  if (!occ || typeof occ !== "object") return { status: 400, body: { error: "invalid_occasion", field: "occasion" } };
  if (occ.type !== OCCASION_TYPE_WEDDING) return { status: 400, body: { error: "invalid_occasion", field: "type" } };
  // Same fail-closed gate as the seal path: generation must refuse a Western
  // Occasion on a contract version that cannot carry culture.
  const vc = validateOccasionVersionCulture(occ.version, occ.facts?.culture);
  if (!vc.ok) return { status: 400, body: { error: "invalid_occasion", field: vc.field } };

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

  // Generation language: an explicit request wins, else the sealed culture
  // decides (western → en, chinese → zh). The SAME resolved language drives
  // the prompt AND the fact gate, so prose can never be validated against a
  // date rendering it was never asked to produce (P0.2).
  const language = weddingLanguageFor(facts, requestedLanguage);

  // Generate → validate facts survived → retry once with fresh angles → fail loudly.
  const seen = new Set();
  const valid = [];
  for (let round = 0; round < 2; round += 1) {
    let content;
    try {
      content = await callModel({
        ...buildWeddingDraftPrompt({ facts, tone, personalContext, attempt: attempt + round, language }),
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
      if (validateWeddingDraft(d, facts, language)) valid.push(d);
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


// --- Birthday generation ------------------------------------------------------
// Its own corpus — never Wedding wording. Same architecture as Wedding:
// untrusted personalContext stays in the user message; facts are validated
// back against the drafts; Event × relationship stays the cost model.

const BIRTHDAY_TONE_GUIDANCE_EN = {
  warm: "Warm — affectionate and genuine, like inviting someone you really want there.",
  playful: "Playful — light, fun, a little cheeky; a party, not a ceremony.",
  casual: "Casual — easy and low-key, the way you'd message a friend.",
  heartfelt: "Heartfelt — sincere about what this person and this day mean.",
  simple: "Simple — short, clear and friendly; no fuss.",
};
const BIRTHDAY_TONE_GUIDANCE_ZH = {
  warm: "温暖——真挚亲切，是真心希望对方来的语气。",
  playful: "俏皮——轻松有趣，可以有点小幽默，是派对不是典礼。",
  casual: "随性——像给朋友发消息一样自然，不端着。",
  heartfelt: "走心——认真说出这个人、这一天的意义。",
  simple: "简洁——短短几句，清楚友好，不啰嗦。",
};
const BIRTHDAY_AUDIENCE_GUIDANCE_EN = {
  family: "Family — close and unguarded; they know the birthday person well.",
  friends: "Friends — natural and warm, glad to share the day.",
  close_friends: "Closest friends — personal, room for in-jokes and shared history.",
  colleagues: "Colleagues — friendly and easy, without presuming intimacy.",
  classmates: "Classmates — familiar and fun, the tone of a group that grew up together.",
};
const BIRTHDAY_AUDIENCE_GUIDANCE_ZH = {
  family: "家人——亲近自然，不用客套。",
  friends: "朋友——自然温暖，高兴地邀请对方来一起庆祝。",
  close_friends: "挚友——更私人，可以带共同回忆和玩笑。",
  colleagues: "同事——友好轻松，有分寸。",
  classmates: "同学——熟悉热闹，一起长大的语气。",
};

export function buildBirthdayDraftPrompt({ facts, tone, personalContext, attempt = 0, language = "zh" }) {
  const en = language === "en";
  const dateDisplay = formatWeddingDate(facts.date, language);
  const toneKey = BIRTHDAY_TONES.includes(tone) ? tone : "warm";
  const signoff = facts.inviter || facts.birthdayPersonName;
  const who = facts.eventTitle || (en ? `${facts.birthdayPersonName}'s birthday` : `${facts.birthdayPersonName}的生日`);
  const angleSets = en
    ? [
        "lead with the invitation itself — simply and gladly ask them to come",
        "lead with the birthday person — why this day is worth showing up for",
        "the shortest one — a complete, friendly invitation in a few lines",
        "lead with the fun — what kind of gathering this will be",
      ]
    : [
        "以邀请本身为主线——高兴地请对方来",
        "以寿星为主线——这个日子为什么值得到场",
        "最短的一篇——几句话说清，但仍是完整友好的邀请",
        "以聚会气氛为主线——这会是一场什么样的相聚",
      ];
  const n = angleSets.length;
  const off = ((Math.trunc(attempt) % n) + n) % n;
  const angles = [0, 1, 2].map((i) => angleSets[(off + i) % n]);

  const system = en
    ? [
        "You are writing the body of a birthday party invitation — complete and sendable, not a greeting-card line.",
        "[FACTS — HIGHEST PRIORITY]",
        `These must appear exactly: the name "${facts.birthdayPersonName}", the date "${dateDisplay}", and the venue "${facts.venue.displayName}". The time should appear naturally.`,
        "Write the time as a natural clock time (\"7:00 PM\", \"seven in the evening\") — never 24-hour form.",
        "Invent NO fact not supplied: no address details, no schedule, no gifts, no dress code, no other guests' names.",
        "[LANGUAGE] Contemporary, natural English. A party invitation, warm and easy — not solemn, not corporate, no clichés.",
        "[STRUCTURE] Each draft: a fitting opening, who and what is being celebrated, a clear invitation, date, time, place, and a natural sign-off from \"" + signoff + "\".",
        "[DIFFERENCE] The three drafts must genuinely differ per the assigned lines.",
        '[OUTPUT] Strictly one JSON object: {"drafts":["first","second","third"]} — nothing else. Use \\n for line breaks.',
      ].join("\n")
    : [
        "你在替派对主人写一份中文生日邀请正文——完整、可直接送出的邀请，不是贺卡金句。",
        "【事实规则（最高优先级）】",
        `以下内容必须原样出现：寿星「${facts.birthdayPersonName}」、日期「${dateDisplay}」、地点「${facts.venue.displayName}」；时间也应自然出现。`,
        "时间直接用 24 小时制（如「19:00」）或自然中文说法（如「晚上七点」），不要混用。",
        "严禁编造未提供的事实：具体环节、着装、礼物要求、其他宾客。",
        "【语言】当代自然的中文，轻松有温度——这是聚会邀请，不是典礼请柬，不要陈词滥调。",
        `【结构】每篇都要有开场、说清为谁庆祝什么、明确的邀请、日期时间地点，并以「${signoff}」自然落款。`,
        "【差异】三篇按指定主线真正不同。",
        '【输出】严格输出 {"drafts":["第一篇","第二篇","第三篇"]}，不要其它内容。换行用 \\n。',
      ].join("\n");

  const factsLines = en
    ? [
        "[BIRTHDAY FACTS]",
        `Celebrating: ${who}`,
        `Birthday person: ${facts.birthdayPersonName}`,
        `Date: ${dateDisplay} (must appear exactly)`,
        `Time: ${formatWeddingTime(facts.time.start, "en")}${facts.time.end ? ` – ${formatWeddingTime(facts.time.end, "en")}` : ""}`,
        `Venue: ${facts.venue.displayName} (must appear exactly)`,
        ...(facts.venue.formattedAddress ? [`Address: ${facts.venue.formattedAddress} (optional to include)`] : []),
        `Host / sign-off: ${signoff}`,
      ]
    : [
        "【生日事实】",
        `庆祝：${who}`,
        `寿星：${facts.birthdayPersonName}`,
        `日期：${dateDisplay}（须原样出现）`,
        `时间：${facts.time.start}${facts.time.end ? `–${facts.time.end}` : ""}`,
        `地点：${facts.venue.displayName}（须原样出现）`,
        ...(facts.venue.formattedAddress ? [`地址：${facts.venue.formattedAddress}（可自然带入）`] : []),
        `落款：${signoff}`,
      ];
  const user = [
    ...factsLines,
    "",
    (en ? "[GUESTS] " : "【受邀对象】") + (en ? BIRTHDAY_AUDIENCE_GUIDANCE_EN : BIRTHDAY_AUDIENCE_GUIDANCE_ZH)[facts.audienceType],
    (en ? "[TONE] " : "【语气】") + (en ? BIRTHDAY_TONE_GUIDANCE_EN : BIRTHDAY_TONE_GUIDANCE_ZH)[toneKey],
    ...(personalContext
      ? ["", (en ? `[FROM THE HOST] (context to weave in, never quote): "${personalContext}"` : `【主人的心里话】（供你体会，不要原句照抄）：「${personalContext}」`)]
      : []),
    "",
    en ? "[THE THREE LINES]" : "【三篇的主线】",
    ...(en ? [`First: ${angles[0]}`, `Second: ${angles[1]}`, `Third: ${angles[2]}`] : [`第一篇：${angles[0]}`, `第二篇：${angles[1]}`, `第三篇：${angles[2]}`]),
  ].join("\n");

  return { system, user };
}

export function validateBirthdayDraft(text, facts, language = "zh") {
  const t = typeof text === "string" ? text : "";
  if (!t.trim()) return false;
  return (
    t.includes(facts.birthdayPersonName) &&
    weddingDateVariants(facts.date, language).some((v) => t.includes(v)) &&
    t.includes(facts.venue.displayName)
  );
}

/** POST /express/draft, occasion.type === "birthday". Same auth + retry shape as Wedding. */
export async function runBirthdayDraft({ decoded, body, callModel, log = console }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };
  if (typeof body?.situation === "string" && body.situation.trim()) {
    return { status: 400, body: { error: "invalid_request" } };
  }
  const language = body?.language === "en" ? "en" : body?.language === "zh" || body?.language === undefined || body?.language === null || body?.language === "" ? "zh" : null;
  if (!language) return { status: 400, body: { error: "occasion_language_unsupported" } };

  const occ = body?.occasion;
  if (!occ || typeof occ !== "object") return { status: 400, body: { error: "invalid_occasion", field: "occasion" } };
  if (occ.type !== OCCASION_TYPE_BIRTHDAY) return { status: 400, body: { error: "invalid_occasion", field: "type" } };
  if (occ.version !== BIRTHDAY_OCCASION_VERSION) return { status: 400, body: { error: "invalid_occasion", field: "version" } };
  const factsRes = validateBirthdayFacts(occ.facts);
  if (!factsRes.ok) return { status: 400, body: { error: "invalid_occasion", field: factsRes.field } };
  const facts = factsRes.facts;

  let tone = "warm";
  if (occ.tone !== undefined && occ.tone !== null && occ.tone !== "") {
    if (!BIRTHDAY_TONES.includes(occ.tone)) return { status: 400, body: { error: "invalid_occasion", field: "tone" } };
    tone = occ.tone;
  }
  let personalContext = null;
  if (occ.personalContext !== undefined && occ.personalContext !== null && occ.personalContext !== "") {
    if (typeof occ.personalContext !== "string" || occ.personalContext.trim().length > 200) {
      return { status: 400, body: { error: "invalid_occasion", field: "personalContext" } };
    }
    personalContext = occ.personalContext.trim();
  }
  const attempt = typeof occ.attempt === "number" && Number.isFinite(occ.attempt) ? Math.max(0, Math.trunc(occ.attempt)) : 0;

  const seen = new Set();
  const valid = [];
  for (let round = 0; round < 2; round += 1) {
    let content;
    try {
      content = await callModel({
        ...buildBirthdayDraftPrompt({ facts, tone, personalContext, attempt: attempt + round, language }),
        maxTokens: WEDDING_DRAFT_MAX_TOKENS,
        temperature: WEDDING_DRAFT_TEMPERATURE,
        jsonObject: true,
      });
    } catch (e) {
      log.error?.("[Occasion] birthday model call failed", e?.message || e);
      continue;
    }
    let parsed = [];
    try {
      const p = JSON.parse(String(content || ""));
      parsed = (Array.isArray(p) ? p : p?.drafts) || [];
    } catch { parsed = []; }
    for (const d of parsed.map((x) => String(x).trim()).filter(Boolean)) {
      if (seen.has(d)) continue;
      seen.add(d);
      if (validateBirthdayDraft(d, facts, language)) valid.push(d);
    }
    if (valid.length >= 3) break;
  }
  if (valid.length < 2) {
    log.error?.(`[Occasion] birthday draft generation failed: ${valid.length} valid after retry`);
    return { status: 502, body: { error: "birthday_draft_failed" } };
  }
  return { status: 200, body: { drafts: valid.slice(0, 3) } };
}
