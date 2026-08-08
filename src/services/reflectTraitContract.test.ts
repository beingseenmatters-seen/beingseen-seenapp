/**
 * Reflect → emergent-trait producer/consumer contract (regression fix).
 *
 * Proves the successful backend extraction path now populates the six
 * categorical signal arrays that trait inference consumes (previously hardcoded
 * to []), using the existing controlled-vocabulary inferers, while preserving
 * the backend prose fields — and that recurring evidence across two sessions
 * yields a non-candidate (matchable) trait.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./seenApi', () => ({
  extractReflectSummary: vi.fn(),
}));
// The tested extraction functions never touch Firestore; stub it so the module
// graph loads without a live Firebase config (mirrors the extract test's env need).
vi.mock('./firebase', () => ({ auth: { currentUser: null }, db: {} }));

import { extractReflectSummary } from './seenApi';
import { extractSummaryFromBackend, extractSummaryFromConversation } from './userSummary';
import { buildSessionPatterns } from './sessionPattern';
import { inferEmergentTraits } from './emergentTraitInference';
import { TRAIT_DEFINITIONS } from '../data/emergentTraits';
import type { SessionInsight } from '../types/userSummary';

const mockedExtract = vi.mocked(extractReflectSummary);

// Conversation carrying recognizable trait evidence for the deterministic inferers.
const EVIDENCE_MESSAGES = [
  { role: 'user' as const, text: '我一直在想，为什么人会不断聚合成群体，最后又走向瓦解？' },
  { role: 'ai' as const, text: '你在追问秩序背后的规律。' },
  { role: 'user' as const, text: '秩序的本质到底是什么？熵是不是让一切终将分散？' },
];

// Backend returns ONLY prose "layers" (no categorical arrays) — the real shape.
const BACKEND_RESPONSE = {
  reflection: '你在追问秩序与聚合背后的意义。',
  layers: {
    contentSummary: '关于秩序与熵的追问',
    emotion: '好奇、思辨',
    trigger: '',
    values: '重视理性与逻辑',
    behaviorPattern: '善于分析与归纳',
    decisionModel: '基于逻辑推理',
    personalityTraits: '',
    relationshipNeed: '',
    motivation: '追求对本质的理解',
    coreConflict: '',
  },
};

// The controlled vocabulary = every signal slug referenced by the taxonomy.
const VOCAB = new Set<string>();
for (const def of TRAIT_DEFINITIONS) {
  for (const rule of def.rules) {
    for (const s of rule.signals) if (s !== '*') VOCAB.add(s);
  }
}

// All six categorical fields inference consumes.
const SIGNAL_FIELDS = [
  'thinkingStyle',
  'coreQuestions',
  'worldview',
  'relationshipPhilosophy',
  'conversationStyle',
  'thinkingPath',
] as const;

// The five pure controlled-vocab slug fields. `coreQuestions` is intentionally a
// MIXED field (keyword slugs + raw extracted question text) per inferCoreQuestions,
// and the taxonomy consumes it via the wildcard '*' rule — so it is excluded from
// the strict slug-format check.
const SLUG_FIELDS = [
  'thinkingStyle',
  'worldview',
  'relationshipPhilosophy',
  'conversationStyle',
  'thinkingPath',
] as const;

function pureSlugs(ex: { [k: string]: unknown }): string[] {
  return SLUG_FIELDS.flatMap(f => (Array.isArray(ex[f]) ? (ex[f] as string[]) : []));
}

function insight(id: string, approvedAt: number, over: Partial<SessionInsight>): SessionInsight {
  return {
    id,
    source: 'reflect',
    approvedByUser: true,
    createdAt: approvedAt,
    approvedAt,
    summaryText: '',
    thinkingStyle: [],
    coreQuestions: [],
    worldview: [],
    relationshipPhilosophy: [],
    conversationStyle: [],
    thinkingPath: [],
    ...over,
  } as SessionInsight;
}

beforeEach(() => {
  vi.clearAllMocks();
  mockedExtract.mockResolvedValue(BACKEND_RESPONSE as never);
});

describe('successful backend extraction — signal contract', () => {
  it('no longer produces six empty categorical arrays when evidence is present', async () => {
    const ex = await extractSummaryFromBackend(EVIDENCE_MESSAGES, {});
    const totalSignals = SIGNAL_FIELDS.reduce((n, f) => n + (ex as any)[f].length, 0);
    expect(totalSignals).toBeGreaterThan(0);
    // The evidence "为什么/到底" deterministically yields this taxonomy signal.
    expect(ex.thinkingStyle).toContain('philosophical_reasoning');
  });

  it('every generated slug is controlled-vocabulary form, and at least one is a taxonomy signal', async () => {
    const ex = await extractSummaryFromBackend(EVIDENCE_MESSAGES, {});
    const slugs = pureSlugs(ex as any);
    expect(slugs.length).toBeGreaterThan(0);
    for (const s of slugs) expect(s).toMatch(/^[a-z][a-z0-9_]*$/); // snake_case, not prose
    expect(slugs.every(s => VOCAB.has(s))).toBe(true); // all pure-slug values are taxonomy vocabulary
    expect(VOCAB.has('philosophical_reasoning')).toBe(true);
    expect(slugs).toContain('philosophical_reasoning'); // a real taxonomy signal was emitted
  });

  it('preserves the backend prose fields exactly (no regression)', async () => {
    const ex = await extractSummaryFromBackend(EVIDENCE_MESSAGES, {});
    expect(ex.summaryText).toBe(BACKEND_RESPONSE.reflection);
    expect(ex.contentSummary).toBe(BACKEND_RESPONSE.layers.contentSummary);
    expect(ex.emotion).toBe(BACKEND_RESPONSE.layers.emotion);
    expect(ex.values).toBe(BACKEND_RESPONSE.layers.values);
    expect(ex.behaviorPattern).toBe(BACKEND_RESPONSE.layers.behaviorPattern);
    expect(ex.decisionModel).toBe(BACKEND_RESPONSE.layers.decisionModel);
    expect(ex.motivation).toBe(BACKEND_RESPONSE.layers.motivation);
  });

  it('makes only exactly one extraction request', async () => {
    await extractSummaryFromBackend(EVIDENCE_MESSAGES, {});
    expect(mockedExtract).toHaveBeenCalledTimes(1);
  });
});

describe('two recurring sessions → a non-candidate matchable trait', () => {
  it('pattern_noticer (low) reaches emergent/established across two sessions', () => {
    const patterns = buildSessionPatterns([
      insight('s1', 1000, { thinkingStyle: ['pattern_mapping'] }),
      insight('s2', 2000, { thinkingStyle: ['pattern_mapping'] }),
    ]);
    const { traits } = inferEmergentTraits(patterns);
    const pn = traits.find(t => t.traitId === 'pattern_noticer');
    expect(pn).toBeDefined();
    expect(['emergent', 'established']).toContain(pn!.status);
    expect(pn!.matchingEligible).toBe(true);
  });

  it('a single session yields at most a (dropped) candidate — proving recurrence is required', () => {
    const patterns = buildSessionPatterns([insight('only', 1000, { thinkingStyle: ['pattern_mapping'] })]);
    const { traits } = inferEmergentTraits(patterns);
    const pn = traits.find(t => t.traitId === 'pattern_noticer');
    // one session → not yet emergent/established
    expect(pn?.status ?? 'candidate').not.toBe('established');
    expect(pn?.status ?? 'candidate').not.toBe('emergent');
  });
});

describe('local fallback behaviour remains intact', () => {
  it('on backend failure, still returns populated arrays + a gentle summary', async () => {
    mockedExtract.mockRejectedValueOnce(new Error('backend down'));
    const ex = await extractSummaryFromConversation(EVIDENCE_MESSAGES, {});
    const totalSignals = SIGNAL_FIELDS.reduce((n, f) => n + (ex as any)[f].length, 0);
    expect(totalSignals).toBeGreaterThan(0);
    expect(ex.summaryText.length).toBeGreaterThan(0);
  });
});
