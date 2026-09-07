/**
 * Spoken-script drafting — the SHARED, product-neutral half of the approved
 * AI Voice Script Assistant (text the creator READS ALOUD while recording;
 * never TTS, never generated voice).
 *
 * This module owns exactly two things:
 *   1. the genuinely product-neutral SPOKEN-LANGUAGE rules (register, length,
 *      breathing rhythm, no invention, no promotion, quote discipline);
 *   2. the Gift.Seen voice-script runner (AI 帮我说) with GIFT context only.
 *
 * Product boundaries (Founder): each product keeps its OWN prompt door.
 * Mind.Seen's Buddhist/community safeguards live in mind.mjs and are passed
 * in as that product's extraRules — nothing of them exists here, so they can
 * never leak into Gift.Seen output rules.
 */

const clean = (v, max) => (typeof v === "string" ? v.trim().slice(0, max) : "");

/** The product-neutral spoken register — shared verbatim by every product. */
export function spokenRules(lang) {
  return (
    "The text will be READ ALOUD by the creator while recording a voice message — never mention recording tech. " +
    "REGISTER: natural spoken " + (lang === "zh" ? "Simplified Chinese" : "English") + ", like a real person talking; " +
    "warm but restrained; SHORT sentences with easy breathing rhythm; length ~30–60 seconds spoken " +
    "(" + (lang === "zh" ? "roughly 90–170 characters" : "roughly 70–140 words") + "). " +
    "NEVER: exaggerated promotional language; invented facts; invented personal experiences, relationship details or shared memories not present in the supplied context. " +
    "Preserve the creator's actual intended meaning. " +
    "If the style calls for a famous quotation, use one ONLY when you are confident of its real attribution; otherwise deliver the intended tone WITHOUT fabricating a quote. "
  );
}

/**
 * Compose the full system prompt: role line + shared spoken rules + the
 * product's OWN extra rules + optional style direction + the JSON contract.
 */
export function spokenSystemPrompt({ roleLine, lang, extraRules = "", styleHint = "" }) {
  return (
    roleLine + " " +
    spokenRules(lang) +
    (extraRules ? extraRules + " " : "") +
    (styleHint ? "Style direction: " + clean(styleHint, 400) + " " : "") +
    'Return STRICT JSON: {"scripts": ["...", "...", "..."]} — exactly three DIFFERENT alternatives.'
  );
}

/** Parse + sanitize the model's {"scripts": [...]} answer (3 alternatives). */
export function parseScripts(raw) {
  const parsed = typeof raw === "string" ? JSON.parse(raw) : raw;
  return Array.isArray(parsed?.scripts)
    ? parsed.scripts.map((x) => clean(x, 600)).filter(Boolean).slice(0, 3)
    : [];
}

/**
 * Gift.Seen "AI 帮我说" — spoken-script drafting with GIFT context only:
 * the recipient, the occasion surface, the card text already written, the
 * creator's own notes/feeling — so nothing already entered is retyped, and
 * the script COMPLEMENTS the written card rather than duplicating it.
 * Authenticated senders only (never an open model door).
 */
export async function runGiftVoiceScript({ decoded, body, callModel }) {
  if (!decoded?.uid) return { status: 401, body: { error: "unauthorized" } };
  if (!callModel) return { status: 503, body: { error: "draft_unavailable" } };
  const lang = body?.lang === "en" ? "en" : "zh";

  const couple = body?.couple;
  const contextLines = [
    body?.surface === "wedding" ? "Surface: a WEDDING invitation — the couple addressing their guests." : "Surface: a personal gift card with a recorded voice message.",
    couple?.partner1 || couple?.partner2 ? `Couple: ${clean(couple?.partner1, 40)} & ${clean(couple?.partner2, 40)}` : null,
    clean(body?.date, 20) ? `Date: ${clean(body.date, 20)}` : null,
    clean(body?.venueName, 80) ? `Venue: ${clean(body.venueName, 80)}` : null,
    clean(body?.audience, 40) ? `Audience/relationship: ${clean(body.audience, 40)}` : null,
    clean(body?.recipientLabel, 40) ? `Recipient: ${clean(body.recipientLabel, 40)}` : null,
    clean(body?.senderName, 40) ? `Speaker/sender: ${clean(body.senderName, 40)}` : null,
    clean(body?.cardText, 800) ? `The card/invitation text already written: ${clean(body.cardText, 800)}` : null,
    clean(body?.notes, 500) ? `Creator wants this to express: ${clean(body.notes, 500)}` : null,
  ].filter(Boolean).join("\n");

  try {
    const raw = await callModel({
      system: spokenSystemPrompt({
        roleLine:
          "You help someone prepare a SHORT SPOKEN message in their own voice, attached to a gift or invitation they are creating.",
        lang,
        extraRules:
          "The spoken words should COMPLEMENT the written card — same feeling, spoken naturally — never a mechanical re-read of the card text. " +
          "Do not assume a romantic relationship unless the context clearly says so.",
        styleHint: body?.styleHint,
      }),
      user: contextLines || "(no context supplied — a warm, simple personal message)",
      maxTokens: 900,
      temperature: 0.8,
      jsonObject: true,
    });
    const scripts = parseScripts(raw);
    if (scripts.length === 0) return { status: 502, body: { error: "draft_failed" } };
    return { status: 200, body: { scripts } };
  } catch {
    return { status: 502, body: { error: "draft_failed" } };
  }
}
