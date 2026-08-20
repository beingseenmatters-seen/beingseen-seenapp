/**
 * Seen — Reflect Lambda Handler
 *
 * REFLECT_PROMPT_VERSION = "v2.1"
 *
 * Changelog:
 *   v1.0 — original 4-role prompts (mirror/organizer/expression/guide)
 *   v2.0 — directness rules, anti-passive-mirroring, answer-first policy
 *   v2.1 — production Lambda integration, conversation history, debug logging,
 *           post-response compliance check with optional rewrite
 *
 * Deployment: copy this file into your Lambda, set handler to reflect-handler.handler
 */

import {
  SecretsManagerClient,
  GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import admin from "firebase-admin";
import { Resend } from "resend";
import { buildPushPayload, buildMatchPushPayload } from "./pushCopy.mjs";
import { generatePrimaryMatchReason } from "./matchReason.mjs";
import {
  assembleRIProfile,
  isEligibleToMatch,
  computeResonance,
  buildReasons,
  assembleMomentProfile,
  isMomentEligible,
  computeMomentResonance,
  classifyOrigin,
} from "./resonance.mjs";
import {
  REFLECT_MODE_PROMPT_VERSION,
  resolveRequestMode,
  toLegacyModeField,
  buildModeInstructions,
  analyzeUserText as analyzeUserTextShared,
  formatExtractTranscript,
  buildExtractPrompt,
  parseExtractionContent,
  toExtractResponsePayload,
} from "./reflectModes.mjs";
import { createGift, retrieveGift, revokeGift, setGiftHidden, rsvpGift, GIFT_COLLECTION, GIFT_PUBLIC_BASE_URL } from "./gift.mjs";
import { senderLibrary, eventDetail, recoverShare, createEvent, upsertGuest, removeGuest, saveVariant } from "./event.mjs";
import {
  createOnsite,
  onsiteDetail,
  listGuestbook,
  configureDraw,
  openDraw,
  lockDraw,
  submitBlessing,
  claimLuckyCode,
  listEntrants,
  drawWinner,
} from "./onsite.mjs";
import { handleSenderLive } from "./liveSession.mjs";
import { distributeInvitations } from "./distribute.mjs";
import { validateOccasion } from "./occasion.mjs";
import { makeKmsShareCrypto } from "./shareCrypto.mjs";
import { sharedResponsesForEvent } from "./sharedRsvp.mjs";
import { runWeddingDraft, runBirthdayDraft, runBusinessDraft } from "./occasion.mjs";
import { uploadGiftMedia, makeS3MediaStore } from "./giftMedia.mjs";

// Opening Media store — one private bucket, this Lambda as the only gateway.
// Absent GIFT_MEDIA_BUCKET → store is null → media routes answer 503 and
// gifts seal/read exactly as before (media is optional ceremony content).
const giftMediaStore = makeS3MediaStore({ bucket: process.env.GIFT_MEDIA_BUCKET });

// Sender-recoverable share credential (Phase 4.5-A) — KMS-backed. Absent
// GIFT_SHARE_KMS_KEY_ID → null → event-based creation answers 503
// share_unavailable explicitly; ordinary gifts seal exactly as before.
const giftShareCrypto = makeKmsShareCrypto();
import {
  createHandoff,
  inspectHandoff,
  redeemHandoff,
  allHandoffOrigins,
} from "./authHandoff.mjs";

// ========================
// Version & Constants
// ========================

const REFLECT_PROMPT_VERSION = "v2.1";
const MODEL = "gpt-4.1";
const TEMPERATURE = 0.6;
const MAX_OUTPUT_TOKENS = 600;
const REWRITE_MAX_TOKENS = 500;

// ========================
// AWS Secrets & Clients
// ========================

const secrets = new SecretsManagerClient({
  region: process.env.AWS_REGION || "ap-southeast-2",
});

// Initialize Firebase Admin if not already initialized
if (!admin.apps.length) {
  try {
    // If FIREBASE_SERVICE_ACCOUNT is provided as an env var (JSON string)
    if (process.env.FIREBASE_SERVICE_ACCOUNT) {
      const serviceAccount = JSON.parse(process.env.FIREBASE_SERVICE_ACCOUNT);
      admin.initializeApp({
        credential: admin.credential.cert(serviceAccount)
      });
      console.log("[FirebaseAdmin] Initialized with service account from env");
    } else {
      // Fallback to default application credentials (e.g. if running in an environment with IAM roles that have access, though usually requires service account for Auth)
      admin.initializeApp();
      console.log("[FirebaseAdmin] Initialized with default credentials");
    }
  } catch (error) {
    console.error("[FirebaseAdmin] Initialization error:", error);
  }
}

/**
 * W4 — Verify a Firebase ID token from the Authorization header.
 *
 * Returns the decoded token (incl. `uid`) when valid, or null otherwise.
 * Server-side selection (W3 `/match/candidate`) takes the viewer uid from the
 * verified token — never from the request body — so a client cannot act as
 * another user.
 */
async function verifyAuthToken(event) {
  const headers = event.headers || {};
  const raw =
    headers.authorization ||
    headers.Authorization ||
    headers.AUTHORIZATION ||
    "";

  if (!raw || typeof raw !== "string") return null;

  const match = raw.match(/^Bearer\s+(.+)$/i);
  const idToken = match ? match[1].trim() : null;
  if (!idToken) return null;

  try {
    return await admin.auth().verifyIdToken(idToken);
  } catch (error) {
    console.warn("[Auth] verifyIdToken failed:", error?.code || error?.message);
    return null;
  }
}

async function getOpenAIKey() {
  const sid = process.env.OPENAI_SECRET_ID;
  const v = await secrets.send(
    new GetSecretValueCommand({ SecretId: sid })
  );
  const s = v.SecretString ? JSON.parse(v.SecretString) : {};
  return s.key || s.OPENAI_API_KEY || Object.values(s)[0];
}

// ========================
// HTTP Response Helper
// ========================

function httpResponse(statusCode, body) {
  return {
    statusCode,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Seen-App-Key,Accept,Origin",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

// ========================
// Relationship Expression — draft assistance (feat/expression-gift-v1)
// ========================

const EXPRESSION_TONES = ["真诚", "浪漫", "轻松幽默", "克制含蓄", "简单直接"];

// English equivalents for each Chinese tone the client sends, so the English
// prompt never injects a Chinese tone word (which would nudge the model toward
// Chinese output).
const EXPRESSION_TONES_EN = {
  真诚: "sincere",
  浪漫: "romantic",
  轻松幽默: "light and playful",
  克制含蓄: "understated and restrained",
  简单直接: "simple and direct",
};

function buildExpressDraftPrompt({ situation, tone, language }) {
  const isZh = language !== "en";
  if (isZh) {
    const safeTone = EXPRESSION_TONES.includes(tone) ? tone : "真诚";
    return [
      "你在帮一个人，把一句想对某个具体的人说的话，写得更好。",
      `语气：${safeTone}。`,
      "要求：以第一人称、直接写给对方（称呼可用「你」），不要写成书信格式，不要署名，不要加引号。",
      "每条 1–3 句，真诚、克制、不浮夸，贴近真实口吻。",
      "严格只输出一个 JSON 数组，包含 3 条候选文字，例如 [\"…\",\"…\",\"…\"]，不要输出其它任何内容。",
      "对方与情境：",
      situation,
    ].join("\n");
  }
  const toneEn = EXPRESSION_TONES_EN[tone] || tone || "sincere";
  return [
    "You help someone say one thing to a specific person, more beautifully.",
    `Tone: ${toneEn}.`,
    "Write every option in natural, idiomatic English — the way a native English speaker would actually say it. Never translate word-for-word from Chinese; avoid stiff, formal, or 'translated' phrasing.",
    "Write in the first person, addressed directly to the person ('you'). No letter format, no signature, no quotation marks.",
    "Each option is 1–3 sentences, sincere and restrained, close to a real spoken voice.",
    'Output ONLY a JSON array of exactly 3 candidate strings, e.g. ["…","…","…"]. Nothing else.',
    "The situation below may be written in Chinese — regardless, write ALL of your options in English:",
    situation,
  ].join("\n");
}

function parseDrafts(content) {
  const text = String(content || "").trim();
  // Prefer a strict JSON array.
  const start = text.indexOf("[");
  const end = text.lastIndexOf("]");
  if (start !== -1 && end > start) {
    try {
      const arr = JSON.parse(text.slice(start, end + 1));
      if (Array.isArray(arr)) {
        return arr.map((s) => String(s).trim()).filter(Boolean).slice(0, 3);
      }
    } catch {
      /* fall through to line parsing */
    }
  }
  // Fallback: split lines, strip numbering/bullets.
  return text
    .split(/\n+/)
    .map((l) => l.replace(/^\s*(?:\d+[.)、]|[-*•])\s*/, "").trim())
    .filter(Boolean)
    .slice(0, 3);
}

/**
 * Model transport for the Structured Occasion path (occasion.mjs owns the
 * prompt, validation, and retry policy; this owns only key + HTTP). Throws on
 * any transport/HTTP failure so the orchestrator can count the round.
 */
async function callExpressModel({ system, user, maxTokens, temperature, jsonObject }) {
  const apiKey = await getOpenAIKey();
  const r = await fetch("https://api.openai.com/v1/chat/completions", {
    method: "POST",
    headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
    body: JSON.stringify({
      model: MODEL,
      messages: [
        { role: "system", content: system },
        { role: "user", content: user },
      ],
      temperature,
      max_tokens: maxTokens,
      ...(jsonObject ? { response_format: { type: "json_object" } } : {}),
    }),
  });
  if (!r.ok) {
    console.error("[Occasion] OpenAI error", await r.text());
    throw new Error(`model_http_${r.status}`);
  }
  const data = await r.json();
  return data.choices?.[0]?.message?.content || "";
}

async function handleExpressDraft(body) {
  const situation = typeof body?.situation === "string" ? body.situation.trim() : "";
  const tone = typeof body?.tone === "string" ? body.tone.trim() : "";
  const language = body?.language === "en" ? "en" : "zh";
  if (!situation) return httpResponse(400, { error: "missing_situation" });

  let apiKey;
  try {
    apiKey = await getOpenAIKey();
  } catch (e) {
    console.error("[Express] key error", e);
    return httpResponse(500, { error: "openai_key_error" });
  }

  try {
    const r = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: buildExpressDraftPrompt({ situation, tone, language }) }],
        temperature: 0.8,
        max_tokens: 600,
      }),
    });
    if (!r.ok) {
      console.error("[Express] OpenAI error", await r.text());
      return httpResponse(502, { error: "draft_failed" });
    }
    const data = await r.json();
    const drafts = parseDrafts(data.choices?.[0]?.message?.content || "");
    return httpResponse(200, { drafts });
  } catch (e) {
    console.error("[Express] draft error", e);
    return httpResponse(502, { error: "draft_failed" });
  }
}

// ========================
// Mode Resolution
// ========================

/**
 * Resolve the effective canonical mode (Phase 2 — five response modes).
 *
 * New clients send:      { responseMode: 'reflect'|'untangle'|'express'|'connect'|'discover' }
 * Released clients send: { responseStyle: 'mirror'|'organizer'|'helper'|'guide' }
 * Oldest clients send:   { mode: 'mirror'|'organizer'|'expression'|'guide' }
 *
 * All are normalised through the shared mapping in ./reflectModes.mjs
 * (mirror→reflect, organizer→untangle, helper/expression→express,
 * guide→discover); unknown values fall back to "reflect".
 */
function resolveMode(body) {
  return resolveRequestMode(body);
}

// ========================
// User-State Detection (lightweight, no full content logged)
// ========================

/**
 * Delegates to the shared implementation in ./reflectModes.mjs so the local
 * dev adapter and tests exercise the identical detection path.
 */
function analyzeUserText(text) {
  return analyzeUserTextShared(text);
}

// ========================
// Passive-Mirroring Detection
// ========================

const PASSIVE_LEAD_RE =
  /^(你似乎|你好像|你在意|也许你|听起来你|我听到你|你像是在|it seems like|you seem to|maybe you|it sounds like|i hear that|you appear to)/i;

function startsWithPassiveMirroring(text) {
  return PASSIVE_LEAD_RE.test(text.trim());
}

// ========================
// V3.0 Prompt Builder — canonical five modes
// ========================

/**
 * Active prompt path: universal Seen layer + mode-specific layer from
 * ./reflectModes.mjs (single source of truth, also used by local dev
 * adapter and frontend contract tests). Distress override is handled
 * inside buildModeInstructions and has highest priority.
 */
function buildInstructions(mode, language, userState) {
  return buildModeInstructions(mode, language, userState);
}

/**
 * LEGACY v2.1 four-role prompt builder — kept for reference/parity only.
 * Not called anywhere. Safe to delete after the five-mode rollout settles.
 */
// eslint-disable-next-line no-unused-vars
function buildInstructionsV21Legacy(mode, language, userState) {
  // Shared directness block injected into mirror & guide
  const directnessRulesZh = `- 如果用户在问具体问题、索要观点、评价、解释或分析，必须先直接回答问题
- 理解与共情只能放在答案之后，不能替代答案
- 如果用户说"我在测试你的回复"或"按我要求回答"，切换到精确直答模式：直接、准确、不加铺垫
- 减少公式化开头，例如"你似乎 / 你好像 / 你在意 / 也许你"
- 语气温暖而有思考感，但不像机器人、不像心理咨询`;

  const directnessRulesEn = `- If the user asks a question, requests an opinion, evaluation, interpretation, or analysis, answer the question FIRST
- Empathy/reflection may follow the answer but must NEVER replace it
- If the user says "I'm testing your reply" or "respond exactly as I asked", switch to precise direct mode: answer directly with minimal preamble
- Reduce formulaic openers such as "you seem to / it seems like / maybe you / it sounds like"
- Tone should be warm and thoughtful, but not robotic or therapy-like`;

  // If distressed, override to gentle mirror regardless of selected mode
  if (userState.isDistressed) {
    return language === "en"
      ? `You are the Mirror in Seen. The user may be in distress.
Rules:
- Respond gently and calmly
- Do not analyze, judge, or ask questions
- Acknowledge their feelings simply
- Let them know they are heard
Tone: warm, safe, non-intrusive.`
      : `你是 Seen 的"镜子"。用户可能情绪不稳定。
规则：
- 温和、平静地回应
- 不分析、不评判、不提问
- 简单地承认他们的感受
- 让他们知道自己被听见了
语气：温暖、安全、不打扰。`;
  }

  switch (mode) {
    // ──────────────────────────────────
    // MIRROR
    // ──────────────────────────────────
    case "mirror":
      return language === "en"
        ? `You are the Mirror in Seen.

Core task: reflect the user's thoughts so they feel understood.

Rules:
${directnessRulesEn}
- Do not push the conversation forward
- Do not analyze personality
- Do not ask complex questions or use question marks
- Do not give advice or conclusions
- Do not mechanically repeat the user's sentences

What to do:
1. Answer what the user is actually asking (if anything)
2. Then reflect/map the user's viewpoint
3. Then express that you understand
4. Allow the user to stay with their current thought`
        : `你是 Seen 的"镜子"。

核心任务：照见用户的想法，让用户感到被理解。

规则：
${directnessRulesZh}
- 不要推进话题
- 不要分析用户人格
- 不要提出复杂问题，也不要出现问号
- 不要给建议或结论
- 不要机械重复用户原句

只需做到：
1. 先回答用户实际在问什么（如果有提问）
2. 再映射用户的观点
3. 再表达你已经理解
4. 允许用户停留在当前思路里`;

    // ──────────────────────────────────
    // ORGANIZER
    // ──────────────────────────────────
    case "organizer":
      return language === "en"
        ? `You are the Organizer in Seen.

Core task: structure the user's thoughts clearly.

Rules:
- Identify the thinking structure
- Extract the logic chain
- Organize ideas into clear steps or hierarchies
- Do NOT ask questions or use question marks
- Do NOT do psychological analysis
- Do NOT push emotional exploration

Output examples:
A → B → C
or
1. Proposition
2. Reasoning
3. Broader structure`
        : `你是 Seen 的"整理者"。

核心任务：把用户的想法整理成清晰结构。

规则：
- 提取逻辑链
- 归纳思路
- 用清晰结构表达出来
- 不进行心理分析
- 不推进情绪探索
- 不出现问号

输出形态示例：
A → B → C
或
1. 命题
2. 推演
3. 更大的结构`;

    // ──────────────────────────────────
    // EXPRESSION HELPER
    // ──────────────────────────────────
    case "expression":
      return language === "en"
        ? `You are the Expression Helper in Seen.

Core task: help the user express their ideas more clearly and powerfully.

Rules:
- Improve wording and offer better phrasing
- Keep the user's original meaning — do NOT change their ideas
- If context is sufficient, give a usable version directly
- If information is incomplete, provide a best-effort version with bracketed placeholders rather than asking the user to repeat themselves
- At most 1 clarifying question about scene/audience/tone
- Never request the user to restate content they already provided

Focus on clarity, elegance, and directness.`
        : `你是 Seen 的"表达辅助"。

核心任务：帮助用户把想法表达得更清晰、更有力量。

规则：
- 优化语言
- 提供表达版本
- 不改变用户观点
- 不替用户换思想，只帮用户换表达
- 如果上下文已足够，直接给版本
- 信息不完整时，先给一个可用版本，用括号占位符提示可选补充
- 最多只能问 1 个场景补全问题（对象/目的/语气）
- 禁止索要重复内容`;

    // ──────────────────────────────────
    // GUIDE
    // ──────────────────────────────────
    case "guide":
      return language === "en"
        ? `You are the Guide in Seen.

Core task: deepen the user's thinking.

Rules:
${directnessRulesEn}
- After answering (if applicable), ask 1 deeper question
- The question must expand thinking dimensions, not repeat the user's words
- Do not give conclusions
- Do not do psychological analysis
- Avoid shallow emotional questions (e.g. "how does that make you feel?")
- Avoid pseudo-deep open questions (e.g. "what does this remind you of?")

Encourage exploration, not answers.`
        : `你是 Seen 的"引导者"。

核心任务：帮助用户更深入思考问题。

规则：
${directnessRulesZh}
- 先理解观点，再提出 1 个更深的问题
- 这个问题必须推进思考，而不是重复原观点
- 不给结论
- 不做心理分析
- 禁止浅层情绪问题（例如"你感觉如何"）
- 禁止假深度开放题（例如"这让你想起什么"）`;

    default:
      return "";
  }
}

// ========================
// Build OpenAI Input (multi-turn)
// ========================

/**
 * Convert conversationHistory into OpenAI Responses API input format.
 * conversationHistory = [{ role: 'user'|'ai', text: '...' }, ...]
 *
 * For the Responses API:
 *   role: 'user' | 'assistant'
 *   content: [{ type: 'input_text', text }]  ← for user
 *   content: [{ type: 'output_text', text }] ← for assistant
 */
function buildInput(conversationHistory, currentText) {
  const input = [];

  if (Array.isArray(conversationHistory)) {
    for (const turn of conversationHistory) {
      const role = turn.role === "ai" ? "assistant" : "user";
      if (role === "user") {
        input.push({
          role: "user",
          content: [{ type: "input_text", text: turn.text }],
        });
      } else {
        input.push({
          role: "assistant",
          content: [{ type: "output_text", text: turn.text }],
        });
      }
    }
  }

  // Current user message
  input.push({
    role: "user",
    content: [{ type: "input_text", text: currentText }],
  });

  return input;
}

// ========================
// Rewrite Pass (optional, lightweight)
// ========================

async function rewriteIfNeeded(
  reply,
  mode,
  language,
  userState,
  apiKey,
  currentText
) {
  // Only rewrite if:
  // 1. User explicitly asked for direct answer AND reply starts with passive mirroring
  // 2. This keeps latency low — most responses won't trigger rewrite
  const shouldRewrite =
    (userState.prefersDirectMode || userState.needsDirectAnswer) &&
    startsWithPassiveMirroring(reply);

  if (!shouldRewrite) return { reply, wasRewritten: false };

  console.log(
    `[Seen:Reflect] Rewrite triggered — passive lead detected while user wants direct answer`
  );

  const rewritePrompt =
    language === "en"
      ? `Rewrite this AI reply. The user asked a direct question or requested an opinion/analysis.
The current reply starts with passive mirroring ("you seem to...") instead of answering.

Rules:
- Answer the user's question FIRST
- Reflection/empathy may follow the answer, not replace it
- Remove "you seem to / it seems like / maybe you" openers
- Keep the same meaning and warmth
- Keep similar length

Original reply:
${reply}

User's message (for context, do not repeat):
${currentText.substring(0, 200)}`
      : `请重写这段 AI 回复。用户在问一个直接的问题或者需要观点/分析。
当前回复以被动映射开头（"你似乎..."）而没有先回答问题。

规则：
- 先回答用户的问题
- 理解/共情可以跟在答案后面，但不能替代答案
- 去掉"你似乎 / 你好像 / 也许你"这类开头
- 保持同样的意思和温度
- 保持相似长度

原始回复：
${reply}

用户原文（仅供参考，不要复述）：
${currentText.substring(0, 200)}`;

  try {
    const r = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: MODEL,
        instructions: rewritePrompt,
        input: [
          {
            role: "user",
            content: [
              { type: "input_text", text: "请按照上面的要求重写。" },
            ],
          },
        ],
        temperature: 0.5,
        max_output_tokens: REWRITE_MAX_TOKENS,
      }),
    });

    if (!r.ok) {
      console.error("[Seen:Reflect] Rewrite API failed, using original");
      return { reply, wasRewritten: false };
    }

    const data = await r.json();
    const rewritten =
      data.output_text ||
      data.output
        ?.flatMap((o) => o.content || [])
        .map((c) => c.text)
        .filter(Boolean)
        .join("\n") ||
      "";

    if (rewritten && rewritten.length > 20) {
      return { reply: rewritten, wasRewritten: true };
    }
    return { reply, wasRewritten: false };
  } catch (e) {
    console.error("[Seen:Reflect] Rewrite exception:", e.message);
    return { reply, wasRewritten: false };
  }
}

// ========================
// Match Ranking Logic
// ========================

function getProfileWeight(reflectCount) {
  if (reflectCount <= 2) {
    return { stage: 'cold_start', me: 0.7, soul: 0.3 };
  } else if (reflectCount <= 5) {
    return { stage: 'early', me: 0.55, soul: 0.45 };
  } else if (reflectCount <= 10) {
    return { stage: 'stable', me: 0.4, soul: 0.6 };
  } else {
    return { stage: 'deep', me: 0.3, soul: 0.7 };
  }
}

function calculateArraySimilarity(arr1, arr2) {
  if (!arr1 || !arr2 || !Array.isArray(arr1) || !Array.isArray(arr2) || arr1.length === 0 || arr2.length === 0) return 0;
  const set1 = new Set(arr1);
  const set2 = new Set(arr2);
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return intersection.size / union.size;
}

/**
 * Structured Me fields on `basic`: interests, values, lifeStage, goals, communicationPreference.
 * Returns normalized score 0–1 and whether any dimension had data on both sides.
 */
function calculateMeStructuredSimilarity(me1, me2) {
  if (!me1 || !me2) return { score: 0, hasData: false };

  let totalScore = 0;
  let totalWeight = 0;

  // 1. interests (array) - 30% weight
  if (Array.isArray(me1.interests) && Array.isArray(me2.interests) && me1.interests.length > 0 && me2.interests.length > 0) {
    const sim = calculateArraySimilarity(me1.interests, me2.interests);
    totalScore += sim * 0.30;
    totalWeight += 0.30;
  }

  // 2. values (array) - 25% weight
  if (Array.isArray(me1.values) && Array.isArray(me2.values) && me1.values.length > 0 && me2.values.length > 0) {
    const sim = calculateArraySimilarity(me1.values, me2.values);
    totalScore += sim * 0.25;
    totalWeight += 0.25;
  }

  // 3. lifeStage (string) - 20% weight
  if (me1.lifeStage && me2.lifeStage) {
    const sim = me1.lifeStage === me2.lifeStage ? 1 : 0;
    totalScore += sim * 0.20;
    totalWeight += 0.20;
  }

  // 4. goals (array) - 15% weight
  if (Array.isArray(me1.goals) && Array.isArray(me2.goals) && me1.goals.length > 0 && me2.goals.length > 0) {
    const sim = calculateArraySimilarity(me1.goals, me2.goals);
    totalScore += sim * 0.15;
    totalWeight += 0.15;
  }

  // 5. communicationPreference (string) - 10% weight
  if (me1.communicationPreference && me2.communicationPreference) {
    const sim = me1.communicationPreference === me2.communicationPreference ? 1 : 0;
    totalScore += sim * 0.10;
    totalWeight += 0.10;
  }

  const hasData = totalWeight > 0;
  const score = hasData ? totalScore / totalWeight : 0;
  return { score, hasData };
}

const UNDERSTANDING_SLIDER_KEYS = [
  'value_orientation',
  'self_vs_relationship',
  'conflict_handling',
  'life_pace',
  'connection_depth',
  'money_view',
  'expression_style',
];

function calculateBasicContextSimilarity(basic1 = {}, basic2 = {}) {
  let totalScore = 0;
  let totalWeight = 0;

  // currentState only — demographics (age, location, gender, zodiac) are out of the match path (T-102)
  if (basic1.currentState && basic2.currentState) {
    totalScore += basic1.currentState === basic2.currentState ? 1 : 0;
    totalWeight += 1;
  }

  const hasData = totalWeight > 0;
  const score = hasData ? totalScore / totalWeight : 0;
  return { score, hasData };
}

/**
 * 7 sliders under soulProfile.understanding (0–100). Average of per-field 1 - |a-b|/100.
 */
function calculateUnderstandingSimilarity(understanding1 = {}, understanding2 = {}) {
  let total = 0;
  let count = 0;
  for (const key of UNDERSTANDING_SLIDER_KEYS) {
    const a = understanding1[key];
    const b = understanding2[key];
    if (typeof a === 'number' && typeof b === 'number' && !Number.isNaN(a) && !Number.isNaN(b)) {
      total += 1 - Math.abs(a - b) / 100;
      count += 1;
    }
  }
  const hasData = count > 0;
  const score = hasData ? total / count : 0;
  return { score, hasData };
}

const ABOUT_ME_SIGNALS_KEYS = [
  'valueTags',
  'regretThemes',
  'aspirationThemes',
  'selfNarrativeTags',
  'copingStyleTags',
  'resonanceTags',
  'emotionalNeeds'
];

function calculateAboutMeSignalsSimilarity(signals1 = {}, signals2 = {}) {
  let totalScore = 0;
  let totalWeight = 0;

  for (const key of ABOUT_ME_SIGNALS_KEYS) {
    const arr1 = signals1[key];
    const arr2 = signals2[key];
    if (Array.isArray(arr1) && Array.isArray(arr2) && arr1.length > 0 && arr2.length > 0) {
      totalScore += calculateArraySimilarity(arr1, arr2);
      totalWeight += 1;
    }
  }

  const hasData = totalWeight > 0;
  const score = hasData ? totalScore / totalWeight : 0;
  return { score, hasData };
}

const ME_STRUCTURED_WEIGHT = 0.28;
const ME_UNDERSTANDING_WEIGHT = 0.32;
const ME_CONTEXT_WEIGHT = 0.15;
const ME_ABOUT_ME_SIGNALS_WEIGHT = 0.25;

/**
 * Combine structured basic + understanding sliders + basic context + aboutMe signals into one meSimilarity.
 * If any layer is missing data, re-normalize the weights among the layers that have data.
 */
function combineMeSimilarity(structuredResult, understandingResult, contextResult, aboutMeSignalsResult) {
  const { score: s, hasData: hs } = structuredResult;
  const { score: u, hasData: hu } = understandingResult;
  const { score: c, hasData: hc } = contextResult || { score: 0, hasData: false };
  const { score: a, hasData: ha } = aboutMeSignalsResult || { score: 0, hasData: false };

  let totalWeight = 0;
  let totalScore = 0;

  if (hs) {
    totalWeight += ME_STRUCTURED_WEIGHT;
    totalScore += s * ME_STRUCTURED_WEIGHT;
  }
  if (hu) {
    totalWeight += ME_UNDERSTANDING_WEIGHT;
    totalScore += u * ME_UNDERSTANDING_WEIGHT;
  }
  if (hc) {
    totalWeight += ME_CONTEXT_WEIGHT;
    totalScore += c * ME_CONTEXT_WEIGHT;
  }
  if (ha) {
    totalWeight += ME_ABOUT_ME_SIGNALS_WEIGHT;
    totalScore += a * ME_ABOUT_ME_SIGNALS_WEIGHT;
  }

  return totalWeight > 0 ? totalScore / totalWeight : 0;
}

function calculateSoulSimilarity(soul1, soul2) {
  if (!soul1 || !soul2) return 0;
  
  const model1 = soul1.reflectModel || soul1.latestInsight;
  const model2 = soul2.reflectModel || soul2.latestInsight;
  
  if (!model1 || !model2) return 0;

  let score = 0;
  let maxScore = 0;

  const arrayFields = ['thinkingStyle', 'coreQuestions', 'worldview', 'relationshipPhilosophy', 'conversationStyle'];
  for (const field of arrayFields) {
    if (model1[field] && model2[field]) {
      maxScore += 1;
      score += calculateArraySimilarity(model1[field], model2[field]);
    }
  }

  const stringFields = ['emotion', 'trigger', 'values', 'behaviorPattern', 'decisionModel', 'personalityTraits', 'relationshipNeed', 'motivation', 'coreConflict'];
  for (const field of stringFields) {
    if (model1[field] && model2[field]) {
      maxScore += 0.5;
      if (model1[field] === model2[field]) {
        score += 0.5;
      }
    }
  }

  return maxScore > 0 ? score / maxScore : 0;
}

// ========================
// Lambda Handler
// ========================

// MATTERS SSO handoff routes get origin-restricted CORS (not the global `*`).
// Only genuine MATTERS origins (plus explicit HANDOFF_DEV_ORIGINS) are echoed.
function handoffResponse(statusCode, body, event) {
  const origin = event.headers?.origin || event.headers?.Origin || "";
  const allowed = allHandoffOrigins().includes(origin) ? origin : null;
  const headers = {
    "Content-Type": "application/json",
    "Access-Control-Allow-Headers": "Content-Type,Authorization,X-Seen-App-Key,Accept,Origin",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
    "Vary": "Origin",
  };
  if (allowed) headers["Access-Control-Allow-Origin"] = allowed;
  return { statusCode, headers, body: JSON.stringify(body) };
}

export const handler = async (event) => {
  // MATTERS SSO handoff preflight — must run before the generic `*` OPTIONS block.
  {
    const method = event.requestContext?.http?.method || event.httpMethod;
    const p = event.requestContext?.http?.path || event.rawPath || event.path || "";
    if (method === "OPTIONS" && p.startsWith("/auth/handoff/")) {
      return handoffResponse(200, { ok: true }, event);
    }
  }

  // CORS preflight
  if (
    event.requestContext?.http?.method === "OPTIONS" || 
    event.httpMethod === "OPTIONS" || 
    event.routeKey === "OPTIONS /reflect/send" || 
    event.routeKey === "OPTIONS /reflect/extract" || 
    event.routeKey === "OPTIONS /voice/transcribe" ||
    event.routeKey === "OPTIONS /match/rank" ||
    event.routeKey === "OPTIONS /match/candidate" ||
    event.routeKey === "OPTIONS /profiles/hydrate" ||
    event.routeKey === "OPTIONS /auth/email-link/send" ||
    event.routeKey === "OPTIONS /test/push"
  ) {
    return httpResponse(200, { ok: true });
  }

  // App identifier check (X-Seen-App-Key). Non-secret application
  // identification — real authorization is per-route (Firebase ID tokens,
  // possession credentials, one-time codes). SEEN_APP_API_KEY may hold a
  // comma-separated list ONLY during a rotation window; steady state is a
  // single value.
  const appKey =
    event.headers?.["x-seen-app-key"] ||
    event.headers?.["X-Seen-App-Key"];

  const validAppKeys = (process.env.SEEN_APP_API_KEY || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
  if (validAppKeys.length > 0 && !validAppKeys.includes(appKey)) {
    return httpResponse(401, { error: "unauthorized" });
  }

  // Parse body early to use in both routes
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {}

  const path = event.requestContext?.http?.path || event.rawPath || event.path;

  // ---- Relationship Expression / QR Gift (feat/expression-gift-v1) --------
  // Firestore via Admin SDK; GLOBAL-only V1. create/revoke require a verified
  // Firebase ID token; retrieve is app-key-only so an account-less recipient
  // can open a Gift by scanning the QR and entering the six-digit 心意钥匙.
  if (path === "/gift/create") {
    const decoded = await verifyAuthToken(event);
    const result = await createGift({
      db: admin.firestore(),
      decoded,
      body,
      media: giftMediaStore,
      share: giftShareCrypto,
    });
    return httpResponse(result.status, result.body);
  }
  if (path === "/gift/retrieve") {
    const result = await retrieveGift({ db: admin.firestore(), body, media: giftMediaStore });
    return httpResponse(result.status, result.body);
  }
  if (path === "/gift/rsvp") {
    const result = await rsvpGift({ db: admin.firestore(), body });
    return httpResponse(result.status, result.body);
  }
  // Shared-link RSVP needs NO route of its own: /gift/rsvp delegates to the
  // per-scanner response when the invitation is a shared link, and
  // /gift/retrieve returns that scanner's own answer when they present their
  // anonymous id. API Gateway is configured per-route, so keeping the feature
  // on existing paths avoids an infrastructure change.
  // ---- Wedding Day on-site (WD-1) — guest side: app-key only. The shared
  // on_site token is the capability; these must never inherit sender auth
  // semantics (Founder AA-9) and never list other guests' data.
  if (path === "/gift/onsite/blessing") {
    const result = await submitBlessing({
      db: admin.firestore(),
      body,
      giftCollection: GIFT_COLLECTION,
    });
    return httpResponse(result.status, result.body);
  }
  if (path === "/gift/onsite/lucky/claim") {
    const result = await claimLuckyCode({
      db: admin.firestore(),
      body,
      giftCollection: GIFT_COLLECTION,
    });
    return httpResponse(result.status, result.body);
  }
  if (path === "/gift/revoke") {
    const decoded = await verifyAuthToken(event);
    const result = await revokeGift({ db: admin.firestore(), decoded, body, media: giftMediaStore });
    return httpResponse(result.status, result.body);
  }
  if (path === "/gift/media/upload") {
    // Opening Media staging — authenticated sender only (Phase 3B-1).
    const decoded = await verifyAuthToken(event);
    const result = await uploadGiftMedia({ store: giftMediaStore, decoded, body });
    return httpResponse(result.status, result.body);
  }

  // ---- Sender Library / Event management (Phase 4.5-A) --------------------
  // Sender-authenticated ONLY: every handler additionally verifies
  // senderUid === decoded.uid on each touched record. Recipient tokens can
  // never reach event data, RSVP aggregates, or share credentials.
  if (path === "/sender/library") {
    const decoded = await verifyAuthToken(event);
    const result = await senderLibrary({
      db: admin.firestore(),
      decoded,
      giftCollection: GIFT_COLLECTION,
    });
    return httpResponse(result.status, result.body);
  }
  if (path === "/sender/event/detail") {
    const decoded = await verifyAuthToken(event);
    const result = await eventDetail({
      db: admin.firestore(),
      decoded,
      body,
      giftCollection: GIFT_COLLECTION,
      sharedResponses: sharedResponsesForEvent,
    });
    return httpResponse(result.status, result.body);
  }
  if (path === "/sender/event/create") {
    const decoded = await verifyAuthToken(event);
    const result = await createEvent({ db: admin.firestore(), decoded, body, validateOccasion });
    return httpResponse(result.status, result.body);
  }
  if (path === "/sender/guest/upsert") {
    const decoded = await verifyAuthToken(event);
    const result = await upsertGuest({ db: admin.firestore(), decoded, body, giftCollection: GIFT_COLLECTION });
    return httpResponse(result.status, result.body);
  }
  if (path === "/sender/guest/remove") {
    const decoded = await verifyAuthToken(event);
    const result = await removeGuest({ db: admin.firestore(), decoded, body });
    return httpResponse(result.status, result.body);
  }
  if (path === "/sender/event/variant/save") {
    const decoded = await verifyAuthToken(event);
    const result = await saveVariant({ db: admin.firestore(), decoded, body });
    return httpResponse(result.status, result.body);
  }
  if (path === "/sender/event/distribute") {
    const decoded = await verifyAuthToken(event);
    const result = await distributeInvitations({
      db: admin.firestore(),
      decoded,
      body,
      media: giftMediaStore,
      share: giftShareCrypto,
      giftCollection: GIFT_COLLECTION,
    });
    return httpResponse(result.status, result.body);
  }
  // ---- Wedding Day on-site (WD-1) — sender side: authenticated owner only.
  // Live Interaction — ONE consolidated sender door (per-route gateway;
  // create/list/detail/draw_* all dispatch on body.action). NEW gateway route.
  if (path === "/sender/live") {
    const decoded = await verifyAuthToken(event);
    const result = await handleSenderLive({
      db: admin.firestore(),
      decoded,
      body,
      share: giftShareCrypto,
      media: giftMediaStore,
      giftCollection: GIFT_COLLECTION,
      publicBaseUrl: GIFT_PUBLIC_BASE_URL,
    });
    return httpResponse(result.status, result.body);
  }
  if (path === "/sender/onsite/create") {
    const decoded = await verifyAuthToken(event);
    const result = await createOnsite({
      db: admin.firestore(),
      decoded,
      body,
      share: giftShareCrypto,
      media: giftMediaStore,
      giftCollection: GIFT_COLLECTION,
      publicBaseUrl: GIFT_PUBLIC_BASE_URL,
    });
    return httpResponse(result.status, result.body);
  }
  if (path === "/sender/onsite/detail") {
    const decoded = await verifyAuthToken(event);
    const result = await onsiteDetail({
      db: admin.firestore(),
      decoded,
      body,
      giftCollection: GIFT_COLLECTION,
    });
    return httpResponse(result.status, result.body);
  }
  if (path === "/sender/onsite/guestbook") {
    const decoded = await verifyAuthToken(event);
    const result = await listGuestbook({ db: admin.firestore(), decoded, body });
    return httpResponse(result.status, result.body);
  }
  if (path === "/sender/onsite/draw/configure") {
    const decoded = await verifyAuthToken(event);
    const result = await configureDraw({ db: admin.firestore(), decoded, body });
    return httpResponse(result.status, result.body);
  }
  if (path === "/sender/onsite/draw/open") {
    const decoded = await verifyAuthToken(event);
    const result = await openDraw({ db: admin.firestore(), decoded, body });
    return httpResponse(result.status, result.body);
  }
  if (path === "/sender/onsite/draw/entrants") {
    const decoded = await verifyAuthToken(event);
    const result = await listEntrants({ db: admin.firestore(), decoded, body });
    return httpResponse(result.status, result.body);
  }
  if (path === "/sender/onsite/draw/winner") {
    const decoded = await verifyAuthToken(event);
    const result = await drawWinner({ db: admin.firestore(), decoded, body });
    return httpResponse(result.status, result.body);
  }
  if (path === "/sender/onsite/draw/lock") {
    const decoded = await verifyAuthToken(event);
    const result = await lockDraw({ db: admin.firestore(), decoded, body });
    return httpResponse(result.status, result.body);
  }
  if (path === "/sender/gift/share") {
    const decoded = await verifyAuthToken(event);
    // Sender-only Library visibility rides this existing sender-gift door via
    // an explicit action (API Gateway is per-route; a new /sender/gift/hidden
    // path 404s at the gateway — shared-RSVP lesson). Default: share recovery.
    if (body?.action === "set_hidden") {
      const hid = await setGiftHidden({ db: admin.firestore(), decoded, body });
      return httpResponse(hid.status, hid.body);
    }
    const result = await recoverShare({
      db: admin.firestore(),
      decoded,
      body,
      giftCollection: GIFT_COLLECTION,
      shareCrypto: giftShareCrypto,
    });
    return httpResponse(result.status, result.body);
  }
  if (path === "/express/draft") {
    // Structured Occasion mode (body.occasion present) requires a verified
    // sender identity — Founder decision. The legacy free-text Expression
    // path below stays app-key-only, exactly as before.
    if (body && typeof body === "object" && body.occasion !== undefined) {
      const decoded = await verifyAuthToken(event);
      // One draft door, dispatched on the declared Occasion type.
      const result =
        body?.occasion?.type === "birthday"
          ? await runBirthdayDraft({ decoded, body, callModel: callExpressModel })
          : body?.occasion?.type === "business_event"
            ? await runBusinessDraft({ decoded, body, callModel: callExpressModel })
            : await runWeddingDraft({ decoded, body, callModel: callExpressModel });
      return httpResponse(result.status, result.body);
    }
    return await handleExpressDraft(body);
  }

  // ---- MATTERS SSO handoff (Phase 1 Rev.2) --------------------------------
  // One-time cross-subdomain identity handoff. IDENTITY ONLY — no product
  // data is read or written. create requires the www user's ID token;
  // inspect requires the DESTINATION's local user's ID token; redeem is
  // app-key-only (the unguessable single-use code is the credential).
  {
    const handoffCommon = () => ({
      db: admin.firestore(),
      origin: event.headers?.origin || event.headers?.Origin || "",
      sourceIp: event.requestContext?.http?.sourceIp || null,
    });
    if (path === "/auth/handoff/create") {
      const decoded = await verifyAuthToken(event);
      const result = await createHandoff({
        ...handoffCommon(),
        decoded,
        body,
        makeExpireTimestamp: (ms) => admin.firestore.Timestamp.fromMillis(ms),
      });
      return handoffResponse(result.status, result.body, event);
    }
    if (path === "/auth/handoff/inspect") {
      const decoded = await verifyAuthToken(event);
      const result = await inspectHandoff({
        ...handoffCommon(),
        authAdmin: admin.auth(),
        decoded,
        body,
      });
      return handoffResponse(result.status, result.body, event);
    }
    if (path === "/auth/handoff/redeem") {
      const result = await redeemHandoff({
        ...handoffCommon(),
        authAdmin: admin.auth(),
        body,
      });
      return handoffResponse(result.status, result.body, event);
    }
  }

  // Route: /test/push
  if (path === "/test/push") {
    console.log("Handling /test/push request");
    const { token, title, body: pushBody, type, level, language } = body;
    
    if (!token) {
      return httpResponse(400, { error: "missing_token", detail: "Requires FCM token" });
    }

    try {
      // If type is provided, use the unified copy system, otherwise fallback to direct title/body
      let finalTitle = title || "Seen Test";
      let finalBody = pushBody || "Push is working";

        if (type === 'match') {
          const payload = buildMatchPushPayload({ language, primaryReason: body.primaryReason });
          finalTitle = payload.title;
          finalBody = payload.body;
        } else if (type) {
          const payload = buildPushPayload({ type, level, language });
          finalTitle = payload.title;
          finalBody = payload.body;
        }

      const response = await admin.messaging().send({
        token,
        notification: {
          title: finalTitle,
          body: finalBody,
        },
      });
      console.log("[Push] Successfully sent message:", response);
      return httpResponse(200, { success: true, messageId: response, title: finalTitle, body: finalBody });
    } catch (error) {
      console.error("[Push] Error sending message:", error);
      return httpResponse(500, { error: "push_failed", detail: error.message });
    }
  }

  // Route: /auth/email-link/send
  if (path === "/auth/email-link/send") {
    console.log("Handling /auth/email-link/send request");
    
    const { email, continueUrl, actionCodeSettings } = body;
    if (!email || !continueUrl) {
      return httpResponse(400, { error: "missing_required_fields", detail: "Requires email and continueUrl" });
    }

    try {
      // 1. Generate the email link using Firebase Admin SDK
      console.log(`[Auth] Generating email link for ${email} with continueUrl ${continueUrl}`);
      
      const settings = actionCodeSettings || {
        url: continueUrl,
        handleCodeInApp: true,
      };
      
      let link;
      try {
        link = await admin.auth().generateSignInWithEmailLink(email, settings);
        console.log(`[Auth] Firebase action link generated successfully`);
      } catch (err) {
        console.error("[Auth] Failed to generate Firebase email link:", err);
        throw new Error(`Firebase link generation failed: ${err.message}`);
      }
      
      // 2. Send the email using Resend
      const resendApiKey = process.env.RESEND_API_KEY;
      if (!resendApiKey) {
        throw new Error("RESEND_API_KEY is not configured");
      }

      const resend = new Resend(resendApiKey);
      const fromEmail = "Seen <noreply@beingseenmatters.com>";
      const emailHtml = `
        <div style="font-family: Arial, Helvetica, sans-serif; line-height: 1.6; color: #222; max-width: 560px; margin: 0 auto; padding: 24px;">
          <h2 style="margin: 0 0 20px; font-size: 28px; font-weight: 700; color: #111;">
            Welcome to Seen
          </h2>

          <p style="margin: 0 0 16px; font-size: 16px;">Hi,</p>

          <p style="margin: 0 0 16px; font-size: 16px;">
            Thank you for signing in to <strong>Seen</strong>.
          </p>

          <p style="margin: 0 0 24px; font-size: 16px;">
            Please click the button below to continue.
          </p>

          <p style="margin: 0 0 28px;">
            <a
              href="${link}"
              style="display: inline-block; background: #111; color: #fff; text-decoration: none; padding: 12px 20px; border-radius: 8px; font-size: 16px; font-weight: 600;"
            >
              Log in to Seen
            </a>
          </p>

          <p style="margin: 0 0 10px; font-size: 14px; color: #555;">
            If the button does not work, you can use the link below:
          </p>

          <p style="margin: 0 0 24px; font-size: 14px; word-break: break-all;">
            <a href="${link}" style="color: #2563eb; text-decoration: underline;">${link}</a>
          </p>

          <p style="margin: 0 0 24px; font-size: 14px; color: #555;">
            If you did not request this email, you can safely ignore it.
          </p>

          <hr style="border: 0; border-top: 1px solid #e5e7eb; margin: 24px 0;" />

          <p style="margin: 0; font-size: 12px; color: #888;">
            Seen · Being seen matters
          </p>
        </div>
      `;
      const emailText = `Hi,

Thank you for signing in to Seen.

Please use the link below to continue:
${link}

If you did not request this email, you can safely ignore it.

Seen · Being seen matters`;

      console.log(`[Auth] Sending login email to ${email} via Resend`);

      try {
        const resendResponse = await resend.emails.send({
          from: fromEmail,
          to: [email],
          subject: "Your login link",
          html: emailHtml,
          text: emailText,
        });

        if (resendResponse.error) {
          console.error("[Auth] Resend returned an email send error", {
            email,
            message: resendResponse.error.message,
            name: resendResponse.error.name,
          });
          throw new Error(`Resend email sending failed: ${resendResponse.error.message}`);
        }

        console.log("[Auth] Resend email sent successfully", {
          email,
          emailId: resendResponse.data?.id || null,
        });
      } catch (err) {
        console.error("[Auth] Failed to send email via Resend", {
          email,
          message: err?.message,
          name: err?.name,
        });
        throw new Error(`Resend email sending failed: ${err.message}`);
      }

      return httpResponse(200, {
        success: true,
        message: "Email link generated and sent successfully"
      });
    } catch (error) {
      console.error("[Auth] /auth/email-link/send error:", error);
      return httpResponse(500, { error: "internal_server_error", detail: error.message });
    }
  }

  // Route: /match/rank
  
  if (path === "/match/rank") {
    console.log("Handling /match/rank request");
    const { currentUser, candidates } = body;

    if (!currentUser || !Array.isArray(candidates)) {
      return httpResponse(400, { error: "missing_required_fields", detail: "Requires currentUser and candidates array" });
    }

    // 1. Determine current user's profile stage
    const mySoulProfile = currentUser.soulProfile || {};
    const myReflectCount = mySoulProfile.reflectModel?.sourceInsightCount || (mySoulProfile.latestInsight ? 1 : 0);
    const { stage, me: meWeight, soul: soulWeight } = getProfileWeight(myReflectCount);

    console.log(`[MatchEngine] Current user ${currentUser.uid} stage: ${stage} (count: ${myReflectCount}, meW: ${meWeight}, soulW: ${soulWeight})`);

    // 2. Score each candidate
    const rankedCandidates = candidates.map(candidate => {
      const structuredSim = calculateMeStructuredSimilarity(currentUser.basic, candidate.basic);
      const understandingSim = calculateUnderstandingSimilarity(
        currentUser.soulProfile?.understanding || {},
        candidate.soulProfile?.understanding || {},
      );
      const contextSim = calculateBasicContextSimilarity(currentUser.basic, candidate.basic);
      const aboutMeSim = calculateAboutMeSignalsSimilarity(
        currentUser.soulProfile?.aboutMeSignals || {},
        candidate.soulProfile?.aboutMeSignals || {},
      );
      let meSim = combineMeSimilarity(structuredSim, understandingSim, contextSim, aboutMeSim);
      let soulSim = calculateSoulSimilarity(mySoulProfile, candidate.soulProfile);

      // Fallback rules
      const candidateSoul = candidate.soulProfile || {};
      if (!candidateSoul.reflectModel && !candidateSoul.latestInsight) {
        soulSim = 0; // Ignore soul if missing
      }

      // Final Score Calculation
      let finalScore = (meWeight * meSim) + (soulWeight * soulSim);

      console.log(
        `[Match] ${currentUser.uid} -> ${candidate.uid} | count:${myReflectCount} stage:${stage} | meStr:${structuredSim.score.toFixed(2)} meUnd:${understandingSim.score.toFixed(2)} meCtx:${contextSim.score.toFixed(2)} meAbt:${aboutMeSim.score.toFixed(2)} meSim:${meSim.toFixed(2)} soulSim:${soulSim.toFixed(2)} | final:${finalScore.toFixed(2)}`,
      );

      // Light match reasons
      const matchReasons = [];
      if (aboutMeSim.hasData && aboutMeSim.score > 0.4) {
        const myS = currentUser.soulProfile?.aboutMeSignals || {};
        const theirS = candidate.soulProfile?.aboutMeSignals || {};
        
        if (calculateArraySimilarity(myS.valueTags, theirS.valueTags) > 0) {
          matchReasons.push('shared_values');
        }
        if (calculateArraySimilarity(myS.copingStyleTags, theirS.copingStyleTags) > 0) {
          matchReasons.push('similar_coping_style');
        }
        if (calculateArraySimilarity(myS.selfNarrativeTags, theirS.selfNarrativeTags) > 0) {
          matchReasons.push('similar_self_narrative');
        }
        if (calculateArraySimilarity(myS.resonanceTags, theirS.resonanceTags) > 0) {
          matchReasons.push('similar_resonance_points');
        }
      }

      const primaryMatchReason = generatePrimaryMatchReason(currentUser, candidate);

      return {
        ...candidate,
        finalScore,
        primaryMatchReason,
        matchMetrics: {
          stage,
          meWeight,
          soulWeight,
          meSimilarity: meSim,
          meStructuredSimilarity: structuredSim.score,
          meUnderstandingSimilarity: understandingSim.score,
          basicContextSimilarity: contextSim.score,
          aboutMeSignalsSimilarity: aboutMeSim.score,
          soulSimilarity: soulSim,
          finalScore,
          matchReasons: matchReasons.length > 0 ? matchReasons : undefined,
        },
      };
    });

    // 3. Sort by final score descending
    rankedCandidates.sort((a, b) => b.finalScore - a.finalScore);

    return httpResponse(200, {
      success: true,
      stage,
      meWeight,
      soulWeight,
      rankedCandidates
    });
  }

  // Route: /match/candidate  (T-301 — server-side selection, trait-level resonance)
  //
  // Client sends ONLY its identity (verified ID token). The server reads the
  // pool via Admin SDK, ranks on emergent traits, and returns exactly ONE
  // candidate with human-language reasons. No traits, no scores, ever leave here.
  if (path === "/match/candidate") {
    console.log("Handling /match/candidate request");

    // W7 kill switch: MATCH_ENGINE=legacy disables server selection without a
    // client deploy. Default (unset) allows it; the client flag gates rollout.
    if (process.env.MATCH_ENGINE === "legacy") {
      return httpResponse(200, { success: true, candidate: null, state: "disabled" });
    }

    const decoded = await verifyAuthToken(event);
    if (!decoded || !decoded.uid) {
      return httpResponse(401, { error: "invalid_token" });
    }
    const uid = decoded.uid;

    try {
      const fdb = admin.firestore();

      // 1. Viewer + RI profile + readiness gate.
      const myDoc = await fdb.collection("users").doc(uid).get();
      if (!myDoc.exists) {
        return httpResponse(200, { success: true, candidate: null, state: "viewer_not_ready" });
      }
      const myData = myDoc.data() || {};
      const mySoul = myData.soulProfile || {};
      const myInsightCount =
        mySoul.traitInferenceMeta?.insightCount ??
        mySoul.reflectModel?.sourceInsightCount ??
        (mySoul.latestInsight ? 1 : 0);
      const myRI = assembleRIProfile(mySoul.emergentTraits);
      const myMoment = assembleMomentProfile(myData.momentProfile);

      // Unified pool, progressive understanding: EITHER evidence channel makes the
      // viewer matchable. Moments start understanding; Reflect deepens it.
      if (!isEligibleToMatch(myRI, myInsightCount) && !isMomentEligible(myMoment)) {
        return httpResponse(200, { success: true, candidate: null, state: "viewer_not_ready" });
      }

      // 2. Exclusions: self + anyone with an existing request/connection.
      const excluded = new Set([uid]);
      try {
        const [fromReqs, toReqs, conns] = await Promise.all([
          fdb.collection("connectionRequests").where("fromUid", "==", uid).get(),
          fdb.collection("connectionRequests").where("toUid", "==", uid).get(),
          fdb.collection("connections").where("users", "array-contains", uid).get(),
        ]);
        fromReqs.forEach((d) => excluded.add(d.data().toUid));
        toReqs.forEach((d) => excluded.add(d.data().fromUid));
        conns.forEach((d) => (d.data().users || []).forEach((u) => excluded.add(u)));
      } catch (exErr) {
        console.warn("[match/candidate] exclusion read failed:", exErr?.message);
      }

      // 3. Candidate pool (server-side, capped). ONE unified pool: a user is a
      // candidate if EITHER channel is ready — Reflect (profile.matchReady) OR
      // Moments (profile.momentReady). The two flags are written by independent
      // producers; we union them here so there is a single Discover population.
      // Per-candidate gates below remain authoritative (flags are a query pre-filter).
      const POOL_CAP = 500;
      // Each channel's pool query is guarded INDEPENDENTLY: if one channel's
      // composite index is missing or still building, we degrade to the other
      // channel instead of failing the whole request. A missing index must never
      // take matching down — the worst case is that one channel is temporarily
      // unavailable, not a 500.
      const safePool = async (field) => {
        try {
          return await fdb
            .collection("users")
            .where(field, "==", true)
            .orderBy("profile.updatedAt", "desc")
            .limit(POOL_CAP)
            .get();
        } catch (poolErr) {
          console.warn(
            `[match/candidate] pool query ${field} failed (degrading to other channel):`,
            poolErr?.code || poolErr?.message,
          );
          return null;
        }
      };
      const [reflectPool, momentPool] = await Promise.all([
        safePool("profile.matchReady"),
        safePool("profile.momentReady"),
      ]);

      const seenPool = new Set();
      const poolDocs = [];
      for (const snap of [reflectPool, momentPool]) {
        if (!snap) continue;
        snap.forEach((docSnap) => {
          if (seenPool.has(docSnap.id)) return;
          seenPool.add(docSnap.id);
          poolDocs.push(docSnap);
        });
      }

      let best = null; // { uid, nickname, score, resonance }
      for (const docSnap of poolDocs) {
        const cuid = docSnap.id;
        if (excluded.has(cuid)) continue;

        const cData = docSnap.data() || {};
        const cSoul = cData.soulProfile || {};
        const cInsightCount =
          cSoul.traitInferenceMeta?.insightCount ??
          cSoul.reflectModel?.sourceInsightCount ??
          (cSoul.latestInsight ? 1 : 0);
        const cRI = assembleRIProfile(cSoul.emergentTraits);
        const cMoment = assembleMomentProfile(cData.momentProfile);

        // Eligible via EITHER channel.
        const reflectOk = isEligibleToMatch(cRI, cInsightCount);
        if (!reflectOk && !isMomentEligible(cMoment)) continue;

        // Two independent scores, each in its own vocabulary; combined additively.
        // Reflect deepens (adds signal) rather than unlocks. Weighting is an
        // internal detail and will evolve with production data.
        const resonance = computeResonance(myRI, cRI);
        const momentResonance = computeMomentResonance(myMoment, cMoment);
        const rankingScore = resonance.resonanceScore + momentResonance.momentScore;

        if (!best || rankingScore > best.score) {
          best = {
            uid: cuid,
            nickname: cData.nickname || cData.basic?.nickname || "Anonymous User",
            score: rankingScore,
            resonance,
            reflectScore: resonance.resonanceScore,
            momentScore: momentResonance.momentScore,
          };
        }
      }

      // Developer observability: unified-pool composition (reflect vs moment).
      console.log(
        `[match/candidate] pool ${uid} | reflect:${reflectPool?.size ?? "ERR"} moment:${momentPool?.size ?? "ERR"} unified:${poolDocs.length}`,
      );

      if (!best) {
        return httpResponse(200, { success: true, candidate: null, state: "no_candidate" });
      }

      const reasons = buildReasons(best.resonance);

      // Connection Origin (同频遇见): internal channel classification, derived from
      // the two scores already on `best`. Explainability only — no scoring change.
      const source = classifyOrigin(best.reflectScore, best.momentScore);

      // Internal-only telemetry (server logs; never returned to client).
      // Split the combined score into its two independent channels for audits.
      console.log(
        `[match/candidate] ${uid} -> ${best.uid} | score:${best.score.toFixed(3)} ` +
          `(reflect:${best.reflectScore.toFixed(3)} moment:${best.momentScore.toFixed(3)}) origin:${source} reasons:${reasons.length}`,
      );

      // Response is intentionally minimal: no traitId/name/family/confidence, no score.
      // `source` is the Connection Origin channel; the user-facing copy lives client-side.
      return httpResponse(200, {
        success: true,
        candidate: {
          uid: best.uid,
          nickname: best.nickname,
          reasons,
          source,
        },
      });
    } catch (error) {
      console.error("[match/candidate] error:", error);
      return httpResponse(500, { error: "internal_server_error" });
    }
  }

  // Route: /profiles/hydrate  (T-301 companion — owner-only rules make the client
  // unable to read other users; inbox/connection name hydration goes through here.)
  //
  // Returns ONLY minimal public fields (uid, nickname) and ONLY for users the
  // caller already shares a request/connection with. No soulProfile, no traits.
  if (path === "/profiles/hydrate") {
    console.log("Handling /profiles/hydrate request");

    const decoded = await verifyAuthToken(event);
    if (!decoded || !decoded.uid) {
      return httpResponse(401, { error: "invalid_token" });
    }
    const uid = decoded.uid;

    const requestedUids = Array.isArray(body.uids) ? body.uids.slice(0, 50) : [];
    if (requestedUids.length === 0) {
      return httpResponse(200, { success: true, profiles: {} });
    }

    try {
      const fdb = admin.firestore();

      // Build the set of uids the caller is allowed to see.
      const allowed = new Set();
      const [fromReqs, toReqs, conns] = await Promise.all([
        fdb.collection("connectionRequests").where("fromUid", "==", uid).get(),
        fdb.collection("connectionRequests").where("toUid", "==", uid).get(),
        fdb.collection("connections").where("users", "array-contains", uid).get(),
      ]);
      fromReqs.forEach((d) => allowed.add(d.data().toUid));
      toReqs.forEach((d) => allowed.add(d.data().fromUid));
      conns.forEach((d) => (d.data().users || []).forEach((u) => { if (u !== uid) allowed.add(u); }));

      const targets = requestedUids.filter((u) => allowed.has(u));
      const profiles = {};
      await Promise.all(
        targets.map(async (tUid) => {
          const snap = await fdb.collection("users").doc(tUid).get();
          if (snap.exists) {
            const d = snap.data() || {};
            profiles[tUid] = {
              uid: tUid,
              nickname: d.nickname || d.basic?.nickname || "Anonymous User",
            };
          }
        }),
      );

      return httpResponse(200, { success: true, profiles });
    } catch (error) {
      console.error("[profiles/hydrate] error:", error);
      return httpResponse(500, { error: "internal_server_error" });
    }
  }

  // Route: /extract
  if (path === "/reflect/extract") {
    console.log("Handling /reflect/extract request");
    
    const conversation = body.conversation;
    if (!Array.isArray(conversation) || conversation.length === 0) {
      return httpResponse(400, { error: "conversation_required" });
    }

    const language = body.language === "en" ? "en" : "zh";
    const openAIKey = await getOpenAIKey();
    const model = process.env.OPENAI_MODEL || MODEL;

    // Format conversation for extraction (shared with the local dev adapter)
    const transcript = formatExtractTranscript(conversation);

    console.log(`[Extract] Processing conversation with ${conversation.length} turns, language: ${language}`);

    const extractPrompt = buildExtractPrompt(language, transcript);

    try {
      const response = await fetch("https://api.openai.com/v1/chat/completions", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${openAIKey}`,
        },
        body: JSON.stringify({
          model: model,
          messages: [{ role: "system", content: extractPrompt }],
          temperature: 0.2,
          max_tokens: 1000,
        }),
      });

      if (!response.ok) {
        const errorText = await response.text();
        console.error("[Extract] OpenAI API error:", errorText);
        return httpResponse(500, { error: "openai_api_error" });
      }

      const data = await response.json();
      const rawContent = data.choices?.[0]?.message?.content || "";

      // Parse + validate via the shared module (identical to the local adapter)
      const parsedResult = parseExtractionContent(rawContent);
      if (!parsedResult) {
        console.error("[Extract] Failed to parse JSON:", rawContent);
        return httpResponse(500, { error: "reflect_extract_parse_failed" });
      }

      const payload = toExtractResponsePayload(parsedResult, model);
      if (!payload) {
        console.error("[Extract] Missing required top-level fields:", parsedResult);
        return httpResponse(500, { error: "reflect_extract_invalid_structure" });
      }

      console.log("[Extract] Successfully extracted 10-layer profile");

      return httpResponse(200, payload);

    } catch (error) {
      console.error("[Extract] Error processing request:", error);
      return httpResponse(500, { error: "internal_server_error" });
    }
  }

  // Route: /voice/transcribe
  if (path === "/voice/transcribe") {
    console.log("Handling /voice/transcribe request");

    const { audio, mimeType, language: voiceLang } = body;
    if (!audio) {
      return httpResponse(400, { error: "audio_required", detail: "Base64 audio data is required" });
    }

    const lang = voiceLang === "en" ? "en" : "zh";

    try {
      const openAIKey = await getOpenAIKey();

      // Decode base64 to binary buffer
      const audioBuffer = Buffer.from(audio, "base64");

      // Determine file extension from mimeType
      const extMap = {
        "audio/aac": "m4a",
        "audio/mp4": "m4a",
        "audio/x-m4a": "m4a",
        "audio/mpeg": "mp3",
        "audio/wav": "wav",
        "audio/webm": "webm",
        "audio/ogg": "ogg",
      };
      const ext = extMap[mimeType] || "m4a";
      const fileName = `audio.${ext}`;

      // Build multipart/form-data manually for Whisper API
      const boundary = "----SeenVoiceBoundary" + Date.now();
      const CRLF = "\r\n";

      const preamble =
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="model"${CRLF}${CRLF}` +
        `whisper-1${CRLF}` +
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="language"${CRLF}${CRLF}` +
        `${lang}${CRLF}` +
        `--${boundary}${CRLF}` +
        `Content-Disposition: form-data; name="file"; filename="${fileName}"${CRLF}` +
        `Content-Type: ${mimeType || "audio/mp4"}${CRLF}${CRLF}`;

      const epilogue = `${CRLF}--${boundary}--${CRLF}`;

      const preambleBuf = Buffer.from(preamble, "utf-8");
      const epilogueBuf = Buffer.from(epilogue, "utf-8");
      const multipartBody = Buffer.concat([preambleBuf, audioBuffer, epilogueBuf]);

      const whisperResp = await fetch("https://api.openai.com/v1/audio/transcriptions", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${openAIKey}`,
          "Content-Type": `multipart/form-data; boundary=${boundary}`,
        },
        body: multipartBody,
      });

      if (!whisperResp.ok) {
        const errText = await whisperResp.text();
        console.error("[Voice] Whisper API error:", whisperResp.status, errText);
        return httpResponse(500, { error: "transcription_failed", detail: errText });
      }

      const whisperData = await whisperResp.json();
      const transcribedText = (whisperData.text || "").trim();

      console.log(`[Voice] Transcription complete (${lang}), length: ${transcribedText.length}`);
      return httpResponse(200, { text: transcribedText });
    } catch (error) {
      console.error("[Voice] Transcription error:", error);
      return httpResponse(500, { error: "internal_server_error", detail: error.message });
    }
  }

  const text = (body.text || "").trim();
  const language = body.language === "en" ? "en" : "zh";

  if (!text) {
    return httpResponse(400, { error: "text_required" });
  }

  // ── Resolve mode ──
  const mode = resolveMode(body);

  // ── Analyse user state (lightweight) ──
  const userState = analyzeUserText(text);

  // ── Build prompt ──
  const instructions = buildInstructions(mode, language, userState);

  // ── Build multi-turn input ──
  const conversationHistory = body.conversationHistory || body.recentTurns;
  const input = buildInput(conversationHistory, text);

  // ── Debug log (safe — no full user content) ──
  const routeInfo = {
    promptVersion: REFLECT_MODE_PROMPT_VERSION,
    mode,
    model: process.env.OPENAI_MODEL || MODEL,
    language,
    directMode: userState.prefersDirectMode,
    directAnswer: userState.needsDirectAnswer,
    distressed: userState.isDistressed,
    historyTurns: Array.isArray(conversationHistory)
      ? conversationHistory.length
      : 0,
    textLength: text.length,
  };
  console.log("[Seen:Reflect] Route:", JSON.stringify(routeInfo));

  // ── Call OpenAI ──
  const apiKey = await getOpenAIKey();
  const effectiveModel = process.env.OPENAI_MODEL || MODEL;

  const payload = {
    model: effectiveModel,
    instructions,
    input,
    temperature: TEMPERATURE,
    max_output_tokens: MAX_OUTPUT_TOKENS,
  };

  const r = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${apiKey}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(payload),
  });

  if (!r.ok) {
    const err = await r.text();
    console.error("[Seen:Reflect] OpenAI error:", err.substring(0, 500));
    return httpResponse(500, { error: "openai_error", detail: err });
  }

  const data = await r.json();

  let reply =
    data.output_text ||
    data.output
      ?.flatMap((o) => o.content || [])
      .map((c) => c.text)
      .filter(Boolean)
      .join("\n") ||
    "";

  // ── Post-response compliance check ──
  let wasRewritten = false;
  if (reply) {
    const result = await rewriteIfNeeded(
      reply,
      mode,
      language,
      userState,
      apiKey,
      text
    );
    reply = result.reply;
    wasRewritten = result.wasRewritten;
  }

  // ── Log result summary ──
  console.log(
    `[Seen:Reflect] Done — responseMode=${mode} rewritten=${wasRewritten} replyLen=${reply.length}`
  );

  // ── Response ──
  // Compatibility contract: `reply`, `response_id`, `model` and `mode` are
  // preserved for released clients. `mode` keeps the legacy vocabulary
  // (mirror/organizer/expression/guide) so old clients see exactly what they
  // saw before; `responseMode` carries the canonical five-mode value.
  return httpResponse(200, {
    reply,
    response_id: data.id,
    model: effectiveModel,
    mode: toLegacyModeField(mode),
    responseMode: mode,
    // Debug fields (safe to expose, no user content)
    _debug: {
      promptVersion: REFLECT_MODE_PROMPT_VERSION,
      wasRewritten,
      directMode: userState.prefersDirectMode,
      directAnswer: userState.needsDirectAnswer,
      distressed: userState.isDistressed,
      historyTurns: routeInfo.historyTurns,
    },
  }); 
};
