/**
 * Phase 2B — /reflect/extract shared contract tests.
 *
 * The extraction prompt, parsing and response shaping live in
 * lambda/reflectModes.mjs and are used by BOTH lambda/index.mjs and the
 * local dev adapter, so testing the shared module tests the actual path.
 * Also asserts the local adapter's safety envelope (routes, no DB, no deps).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  formatExtractTranscript,
  buildExtractPrompt,
  parseExtractionContent,
  toExtractResponsePayload,
} from '../../lambda/reflectModes.mjs';

const VALID_PARSED = {
  layers: {
    contentSummary: 'a',
    emotion: 'b',
    trigger: 'c',
    values: 'd',
    behaviorPattern: 'e',
    decisionModel: 'f',
    personalityTraits: 'g',
    relationshipNeed: 'h',
    motivation: 'i',
    coreConflict: 'j',
  },
  reflection: '你怕选错，但也怕停在原地。',
  summary: 'internal',
};

describe('formatExtractTranscript', () => {
  it('keeps only user/ai turns in User:/AI: format', () => {
    const transcript = formatExtractTranscript([
      { role: 'user', text: '你好' },
      { role: 'system', text: 'internal note' },
      { role: 'ai', text: '你好，想聊点什么？' },
    ]);
    expect(transcript).toBe('User: 你好\nAI: 你好，想聊点什么？');
  });

  it('tolerates a non-array input', () => {
    expect(formatExtractTranscript(undefined)).toBe('');
  });
});

describe('buildExtractPrompt', () => {
  it('contains both jobs and embeds the transcript', () => {
    const prompt = buildExtractPrompt('zh', 'User: 我在想工作的事');
    expect(prompt).toContain('JOB 1 — INTERNAL PROFILE');
    expect(prompt).toContain('JOB 2 — THE UNDERSTANDING UPDATE');
    expect(prompt).toContain('User: 我在想工作的事');
    expect(prompt).toContain('Chinese (Simplified)');
  });

  it('switches the output language for English', () => {
    const prompt = buildExtractPrompt('en', 'User: thinking about work');
    expect(prompt).toContain('Output language for ALL fields: English');
  });

  it('JOB 2 is an Understanding Update, not a one-sentence summary (founder decision)', () => {
    const zh = buildExtractPrompt('zh', 'User: 随便聊聊');
    // Guiding principle: improve understanding, never summarize.
    expect(zh).toContain("the goal is NOT to summarize today's conversation");
    expect(zh).toContain("improve Seen's current understanding of the user");
    // Answers exactly one question — what understanding should be updated.
    expect(zh).toContain('What understanding should be updated after today');
    // Updates may be new, refined, strengthened, or revised — not only new.
    expect(zh).toContain('REFINEMENT, STRENGTHENING, or REVISION');
    // One short paragraph, approximately 100 Chinese characters (soft range).
    expect(zh).toContain('Exactly one short paragraph');
    expect(zh).toContain('approximately 100 Chinese characters');
    expect(zh).toContain('roughly 60–120 when needed');
    expect(zh).toContain('Clarity matters more than fitting a number');
    // Forbidden behaviours from the decision.
    expect(zh).toContain('Do NOT summarize the conversation');
    expect(zh).toContain('Do NOT restate or quote');
    expect(zh).toContain('Do NOT define personality');
    expect(zh).toContain('Do NOT try to cover everything');
    // Humble, user-approved inference.
    expect(zh).toContain('tentative understanding, not fact');
    // Writing calibration (founder, 2026-07-28): varied openings, update
    // framing, and openness to future refinement.
    expect(zh).toContain('VARY the opening');
    expect(zh).toContain('Do NOT default to one fixed formula');
    expect(zh).toContain("moved one small step forward");
    expect(zh).toContain('never "here is who you are"');
    expect(zh).toContain('leave the understanding open');
    expect(zh).toContain('NEVER paste a stock closing line');
    // The old concepts are gone: one-sentence reflection and hard 60–100 limit.
    expect(zh).not.toContain('THE REFLECTION (');
    expect(zh).not.toContain('THEIR OWN WORDS');
    expect(zh).not.toContain('One or two short sentences');
    expect(zh).not.toContain('60–100 Chinese characters.');
  });

  it('English prompt carries an equivalent soft length rule', () => {
    const en = buildExtractPrompt('en', 'User: thinking about work');
    expect(en).toContain('approximately 70 words');
    expect(en).toContain('roughly 40–90 when needed');
    expect(en).not.toContain('approximately 100 Chinese characters');
  });
});

describe('parseExtractionContent', () => {
  const rawJson = JSON.stringify(VALID_PARSED);

  it('parses plain JSON', () => {
    expect(parseExtractionContent(rawJson)).toEqual(VALID_PARSED);
  });

  it('parses JSON wrapped in ```json fences', () => {
    expect(parseExtractionContent('```json\n' + rawJson + '\n```')).toEqual(VALID_PARSED);
  });

  it('parses JSON wrapped in bare ``` fences', () => {
    expect(parseExtractionContent('```\n' + rawJson + '\n```')).toEqual(VALID_PARSED);
  });

  it('recovers an embedded JSON object from surrounding prose', () => {
    expect(parseExtractionContent('Here is the result: ' + rawJson + ' Done.')).toEqual(
      VALID_PARSED
    );
  });

  it('returns null for unrecoverable content instead of throwing', () => {
    expect(parseExtractionContent('completely not json')).toBeNull();
    expect(parseExtractionContent('')).toBeNull();
  });
});

describe('toExtractResponsePayload (production response contract)', () => {
  it('shapes a valid extraction into the exact contract', () => {
    const payload = toExtractResponsePayload(VALID_PARSED, 'gpt-4.1');
    expect(payload).not.toBeNull();
    expect(payload!.reflection).toBe(VALID_PARSED.reflection);
    expect(payload!.summary).toBe('internal');
    expect(payload!.model).toBe('gpt-4.1');
    expect(Object.keys(payload!.layers)).toEqual([
      'contentSummary',
      'emotion',
      'trigger',
      'values',
      'behaviorPattern',
      'decisionModel',
      'personalityTraits',
      'relationshipNeed',
      'motivation',
      'coreConflict',
    ]);
  });

  it('rejects an extraction with no layers', () => {
    expect(toExtractResponsePayload({ reflection: 'x' }, 'm')).toBeNull();
  });

  it('rejects an extraction with neither reflection nor summary', () => {
    expect(toExtractResponsePayload({ layers: {} }, 'm')).toBeNull();
  });

  it('accepts summary-only output from older models', () => {
    const payload = toExtractResponsePayload({ layers: {}, summary: 'only summary' }, 'm');
    expect(payload).not.toBeNull();
    expect(payload!.reflection).toBe('');
    expect(payload!.summary).toBe('only summary');
  });

  it('defaults missing layer fields to empty strings', () => {
    const payload = toExtractResponsePayload({ layers: {}, reflection: 'r' }, 'm')!;
    expect(payload.layers.emotion).toBe('');
    expect(payload.layers.coreConflict).toBe('');
  });
});

describe('local adapter safety envelope', () => {
  const source = readFileSync(
    resolve(__dirname, '../../lambda/local-reflect-server.mjs'),
    'utf-8'
  );

  it('recognises POST /reflect/extract and still rejects unsupported routes', () => {
    expect(source).toContain('"/reflect/extract"');
    expect(source).toContain('SUPPORTED_ROUTES.includes(url.pathname)');
    expect(source).toContain('not_found');
  });

  it('performs no database or matching writes and uses built-in modules only', () => {
    // Only imports: node:http and the shared prompt module — no firebase,
    // firestore, aws-sdk or any other dependency can be reached.
    const imports = source.match(/^import[\s\S]*?from ["'].+["'];?$/gm) || [];
    const sources = imports.map((line) => line.match(/from ["'](.+)["']/)![1]);
    expect(sources.sort()).toEqual(['./reflectModes.mjs', 'node:http']);
    expect(source).not.toContain('require(');
  });

  it('refuses to start without the model credential and never fakes extraction', () => {
    expect(source).toContain('if (!API_KEY)');
    expect(source).toContain('process.exit(1)');
    // Extraction must call the real model endpoint, not fabricate a response.
    expect(source).toContain('https://api.openai.com/v1/chat/completions');
  });

  it('uses the shared extraction path (same prompt and contract as the Lambda)', () => {
    expect(source).toContain('buildExtractPrompt');
    expect(source).toContain('parseExtractionContent');
    expect(source).toContain('toExtractResponsePayload');
    expect(source).toContain('formatExtractTranscript');
  });
});

describe('Lambda extract route uses the same shared path', () => {
  const source = readFileSync(resolve(__dirname, '../../lambda/index.mjs'), 'utf-8');

  it('imports and applies the shared extraction helpers', () => {
    expect(source).toContain('buildExtractPrompt');
    expect(source).toContain('parseExtractionContent');
    expect(source).toContain('toExtractResponsePayload');
    expect(source).toContain('"/reflect/extract"');
  });
});
