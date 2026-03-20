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

// ========================
// Version & Constants
// ========================

const REFLECT_PROMPT_VERSION = "v2.1";
const MODEL = "gpt-4.1";
const TEMPERATURE = 0.6;
const MAX_OUTPUT_TOKENS = 600;
const REWRITE_MAX_TOKENS = 500;

// ========================
// AWS Secrets
// ========================

const secrets = new SecretsManagerClient({
  region: process.env.AWS_REGION,
});

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
      "Access-Control-Allow-Headers":
        "Content-Type,Authorization,X-Seen-App-Key",
      "Access-Control-Allow-Methods": "POST,OPTIONS",
    },
    body: JSON.stringify(body),
  };
}

// ========================
// Mode Resolution
// ========================

/**
 * Resolve the effective mode from both old and new payload fields.
 *
 * Frontend sendReflectWithGate sends:
 *   { responseStyle: 'mirror' | 'organizer' | 'helper' | 'guide' }
 *
 * Old sendReflect sends:
 *   { mode: 'mirror' | 'organizer' | 'expression' | 'guide' }
 *
 * We normalise to: mirror | organizer | expression | guide
 */
function resolveMode(body) {
  const raw = body.responseStyle || body.mode || "mirror";
  // Frontend uses 'helper' for the Expression role
  if (raw === "helper") return "expression";
  if (["mirror", "organizer", "expression", "guide"].includes(raw))
    return raw;
  return "mirror";
}

// ========================
// User-State Detection (lightweight, no full content logged)
// ========================

const DIRECT_MODE_ZH = [
  "测试你的回复", "按我要求回答", "直接回答", "不要绕弯子",
  "简洁回答", "直说", "直接说", "不要套话",
];
const DIRECT_MODE_EN = [
  "testing your reply", "respond exactly", "answer directly",
  "straight answer", "just answer", "no fluff", "be direct",
];

const DIRECT_ANSWER_ZH = [
  "你怎么看", "你觉得", "你认为", "请分析", "帮我分析",
  "你的判断", "你的观点", "你的看法", "解释一下", "评价一下",
];
const DIRECT_ANSWER_EN = [
  "what do you think", "your opinion", "your view", "analyze",
  "evaluate", "interpret", "explain", "your take",
];

const DISTRESS_ZH = [
  "崩溃", "焦虑", "绝望", "不想活", "活不下去", "撑不住",
  "受不了", "快扛不住",
];
const DISTRESS_EN = [
  "desperate", "hopeless", "suicidal", "can't cope", "breaking down",
];

function analyzeUserText(text) {
  const t = text.toLowerCase();
  const prefersDirectMode = [...DIRECT_MODE_ZH, ...DIRECT_MODE_EN].some(
    (k) => t.includes(k.toLowerCase())
  );
  const needsDirectAnswer = [...DIRECT_ANSWER_ZH, ...DIRECT_ANSWER_EN].some(
    (k) => t.includes(k.toLowerCase())
  );
  const isDistressed = [...DISTRESS_ZH, ...DISTRESS_EN].some((k) =>
    t.includes(k.toLowerCase())
  );
  return { prefersDirectMode, needsDirectAnswer, isDistressed };
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
// V2.1 Prompt Builder
// ========================

function buildInstructions(mode, language, userState) {
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
// Lambda Handler
// ========================

export const handler = async (event) => {
  // CORS preflight
  if (event.requestContext?.http?.method === "OPTIONS") {
    return httpResponse(200, { ok: true });
  }

  // API key check
  const appKey =
    event.headers?.["x-seen-app-key"] ||
    event.headers?.["X-Seen-App-Key"];

  if (
    process.env.SEEN_APP_API_KEY &&
    appKey !== process.env.SEEN_APP_API_KEY
  ) {
    return httpResponse(401, { error: "unauthorized" });
  }

  // Parse body
  let body = {};
  try {
    body = JSON.parse(event.body || "{}");
  } catch {}

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
    promptVersion: REFLECT_PROMPT_VERSION,
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
    `[Seen:Reflect] Done — mode=${mode} rewritten=${wasRewritten} replyLen=${reply.length}`
  );

  // ── Response (same shape as before + debug fields) ──
  return httpResponse(200, {
    reply,
    response_id: data.id,
    model: effectiveModel,
    mode,
    // New debug fields (safe to expose, no user content)
    _debug: {
      promptVersion: REFLECT_PROMPT_VERSION,
      wasRewritten,
      directMode: userState.prefersDirectMode,
      directAnswer: userState.needsDirectAnswer,
      distressed: userState.isDistressed,
      historyTurns: routeInfo.historyTurns,
    },
  });
};
