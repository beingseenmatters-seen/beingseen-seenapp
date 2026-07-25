/**
 * Seen — LOCAL-ONLY Reflect dev adapter (Phase 2 five-mode validation,
 * Phase 2B end-of-conversation extraction).
 *
 * Purpose: let the local Vite frontend exercise the canonical five response
 * modes AND the completion extraction against the SAME normalisation +
 * prompt-building path as the Lambda (./reflectModes.mjs), without sending
 * traffic to the production API and without deploying anything.
 *
 * Strictly scoped:
 *   - exposes ONLY POST /reflect/send and POST /reflect/extract (+ CORS preflight)
 *   - uses ONLY built-in Node modules (node:http) and global fetch
 *   - writes to no database, reads no Firestore, verifies no auth token
 *   - refuses to start when OPENAI_API_KEY is missing
 *   - CORS restricted to the local Vite origin
 *   - never imported by any production build or bundle
 *
 * Usage:
 *   OPENAI_API_KEY=sk-... node lambda/local-reflect-server.mjs
 *   # optional: PORT=8788 LOCAL_VITE_ORIGIN=http://localhost:5174
 *   # then run the frontend with VITE_API_BASE_URL=http://localhost:8788
 */

import http from "node:http";
import {
  REFLECT_MODE_PROMPT_VERSION,
  resolveRequestMode,
  toLegacyModeField,
  buildModeInstructions,
  analyzeUserText,
  formatExtractTranscript,
  buildExtractPrompt,
  parseExtractionContent,
  toExtractResponsePayload,
} from "./reflectModes.mjs";

const PORT = Number(process.env.PORT || 8788);
const ALLOWED_ORIGIN = process.env.LOCAL_VITE_ORIGIN || "http://localhost:5174";
const MODEL = process.env.OPENAI_MODEL || "gpt-4.1";
const API_KEY = process.env.OPENAI_API_KEY;

if (!API_KEY) {
  console.error(
    "[local-reflect] OPENAI_API_KEY is not set.\n" +
      "This local adapter needs an OpenAI API key to invoke the model.\n" +
      "Start it with:  OPENAI_API_KEY=sk-... node lambda/local-reflect-server.mjs\n" +
      "No key is stored or printed. Refusing to start."
  );
  process.exit(1);
}

function corsHeaders(origin) {
  // Only the local Vite origin is allowed — never "*".
  const allowed = origin === ALLOWED_ORIGIN ? origin : ALLOWED_ORIGIN;
  return {
    "Content-Type": "application/json",
    "Access-Control-Allow-Origin": allowed,
    "Access-Control-Allow-Headers":
      "Content-Type,Authorization,X-Seen-App-Key,Accept,Origin",
    "Access-Control-Allow-Methods": "POST,OPTIONS",
  };
}

function send(res, status, origin, body) {
  res.writeHead(status, corsHeaders(origin));
  res.end(JSON.stringify(body));
}

function buildInput(conversationHistory, currentText) {
  const input = [];
  if (Array.isArray(conversationHistory)) {
    for (const turn of conversationHistory) {
      if (turn.role === "ai") {
        input.push({ role: "assistant", content: [{ type: "output_text", text: turn.text }] });
      } else {
        input.push({ role: "user", content: [{ type: "input_text", text: turn.text }] });
      }
    }
  }
  input.push({ role: "user", content: [{ type: "input_text", text: currentText }] });
  return input;
}

const SUPPORTED_ROUTES = ["/reflect/send", "/reflect/extract"];

/**
 * Same extraction path as the Lambda /reflect/extract route: shared prompt,
 * shared parsing, shared response contract. Never fakes a success — model or
 * parse failures return the same error codes the Lambda would.
 */
async function handleExtract(res, origin, body) {
  const conversation = body.conversation;
  if (!Array.isArray(conversation) || conversation.length === 0) {
    return send(res, 400, origin, { error: "conversation_required" });
  }

  const language = body.language === "en" ? "en" : "zh";
  const transcript = formatExtractTranscript(conversation);
  const extractPrompt = buildExtractPrompt(language, transcript);

  console.log(
    `[local-reflect] extract turns=${conversation.length} lang=${language}`
  );

  try {
    const response = await fetch("https://api.openai.com/v1/chat/completions", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${API_KEY}`,
      },
      body: JSON.stringify({
        model: MODEL,
        messages: [{ role: "system", content: extractPrompt }],
        temperature: 0.2,
        max_tokens: 1000,
      }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      console.error("[local-reflect] extract OpenAI error:", errorText.substring(0, 300));
      return send(res, 500, origin, { error: "openai_api_error" });
    }

    const data = await response.json();
    const rawContent = data.choices?.[0]?.message?.content || "";

    const parsedResult = parseExtractionContent(rawContent);
    if (!parsedResult) {
      return send(res, 500, origin, { error: "reflect_extract_parse_failed" });
    }

    const payload = toExtractResponsePayload(parsedResult, MODEL);
    if (!payload) {
      return send(res, 500, origin, { error: "reflect_extract_invalid_structure" });
    }

    return send(res, 200, origin, payload);
  } catch (error) {
    console.error("[local-reflect] extract exception:", error.message);
    return send(res, 500, origin, { error: "internal_server_error" });
  }
}

const server = http.createServer(async (req, res) => {
  const origin = req.headers.origin || "";
  const url = new URL(req.url || "/", `http://localhost:${PORT}`);

  if (req.method === "OPTIONS" && SUPPORTED_ROUTES.includes(url.pathname)) {
    return send(res, 200, origin, { ok: true });
  }

  if (req.method !== "POST" || !SUPPORTED_ROUTES.includes(url.pathname)) {
    return send(res, 404, origin, {
      error: "not_found",
      detail: "Local adapter serves only POST /reflect/send and POST /reflect/extract",
    });
  }

  let raw = "";
  req.on("data", (chunk) => {
    raw += chunk;
  });
  req.on("end", async () => {
    let body = {};
    try {
      body = JSON.parse(raw || "{}");
    } catch {
      return send(res, 400, origin, { error: "invalid_json" });
    }

    if (url.pathname === "/reflect/extract") {
      return handleExtract(res, origin, body);
    }

    const text = (body.text || "").trim();
    const language = body.language === "en" ? "en" : "zh";
    if (!text) return send(res, 400, origin, { error: "text_required" });

    // Same path as the Lambda: resolve canonical mode, analyse state,
    // build universal + mode-specific instructions.
    const mode = resolveRequestMode(body);
    const userState = analyzeUserText(text);
    const instructions = buildModeInstructions(mode, language, userState);
    const input = buildInput(body.conversationHistory || body.recentTurns, text);

    console.log(
      `[local-reflect] responseMode=${mode} lang=${language} distressed=${userState.isDistressed} historyTurns=${input.length - 1}`
    );

    try {
      const r = await fetch("https://api.openai.com/v1/responses", {
        method: "POST",
        headers: {
          Authorization: `Bearer ${API_KEY}`,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          model: MODEL,
          instructions,
          input,
          temperature: 0.6,
          max_output_tokens: 600,
        }),
      });

      if (!r.ok) {
        const err = await r.text();
        console.error("[local-reflect] OpenAI error:", err.substring(0, 300));
        return send(res, 500, origin, { error: "openai_error", detail: err });
      }

      const data = await r.json();
      const reply =
        data.output_text ||
        data.output
          ?.flatMap((o) => o.content || [])
          .map((c) => c.text)
          .filter(Boolean)
          .join("\n") ||
        "";

      // Same response contract as the Lambda reflect route.
      return send(res, 200, origin, {
        reply,
        response_id: data.id,
        model: MODEL,
        mode: toLegacyModeField(mode),
        responseMode: mode,
        _debug: {
          promptVersion: REFLECT_MODE_PROMPT_VERSION,
          wasRewritten: false,
          directMode: userState.prefersDirectMode,
          directAnswer: userState.needsDirectAnswer,
          distressed: userState.isDistressed,
          historyTurns: input.length - 1,
        },
      });
    } catch (e) {
      console.error("[local-reflect] Exception:", e.message);
      return send(res, 500, origin, { error: "internal_error", detail: e.message });
    }
  });
});

server.listen(PORT, "127.0.0.1", () => {
  console.log(
    `[local-reflect] Listening on http://localhost:${PORT} (CORS origin: ${ALLOWED_ORIGIN})\n` +
      `[local-reflect] Frontend: VITE_API_BASE_URL=http://localhost:${PORT} npm run dev`
  );
});
