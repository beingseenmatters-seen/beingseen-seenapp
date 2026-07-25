import { describe, it, expect } from 'vitest';
import type { MomentAnswer, MomentSnapshot } from '../../types/moments';
import { MOMENT_LIBRARY } from '../../data/moments/library';
import { SUMMARY_ENGINE_CONFIG } from '../../data/moments/summaryConfig';
import { accumulateSignals, generateSketch } from './sketchEngine';
import { RANKING_TEST_FIXTURE, SAMPLE_PROFILE_A, SAMPLE_PROFILE_B } from './testFixtures';

function librarySnapshots(): MomentSnapshot[] {
  return MOMENT_LIBRARY.map((m) => ({
    momentId: m.id,
    version: m.version,
    interactionType: m.interactionType,
    title: m.title,
    scenario: m.scenario,
    minSelection: m.minSelection,
    maxSelection: m.maxSelection,
    maxRank: m.maxRank,
    options: m.options.map((o) => ({
      id: o.id,
      text: o.text,
      interpretation: o.interpretation,
      weight: o.weight,
      signals: o.signals,
    })),
  }));
}

function toAnswers(profile: Record<string, string[]>): Record<string, MomentAnswer> {
  return Object.fromEntries(
    Object.entries(profile).map(([momentId, ids]) => [
      momentId,
      { momentId, selectedOptionIds: ids, answeredAt: 0 },
    ]),
  );
}

describe('signal accumulation (approved model)', () => {
  it('applies delta * weightFactor * 2 on a 0.5 baseline', () => {
    const snaps = librarySnapshots().filter((s) => s.momentId === 'M-P01');
    const acc = accumulateSignals(snaps, toAnswers({ 'M-P01': ['A'] }));
    // Option A (Light = 0.15): CHG-01 0.6 → 0.5 + 0.18 = 0.68
    expect(acc['CHG-01']).toBeCloseTo(0.68, 10);
    expect(acc['CHG-02']).toBeCloseTo(0.59, 10);
    expect(acc['CHG-03']).toBeCloseTo(0.575, 10);
  });

  it('clamps accumulated values to [0.02, 0.98]', () => {
    const snap: MomentSnapshot = {
      momentId: 'X',
      version: 1,
      interactionType: 'multiple_choice',
      title: { zh: 'x' },
      scenario: { zh: 'x' },
      minSelection: 1,
      maxSelection: 3,
      options: [
        { id: 'A', text: { zh: 'a' }, weight: 'Moderate', signals: [{ signal: 'CHG-01', delta: 0.9, confidence: 'medium' }] },
        { id: 'B', text: { zh: 'b' }, weight: 'Moderate', signals: [{ signal: 'CHG-01', delta: 0.9, confidence: 'medium' }] },
        { id: 'C', text: { zh: 'c' }, weight: 'Moderate', signals: [{ signal: 'CHG-01', delta: -9, confidence: 'medium' }] },
      ],
    };
    const high = accumulateSignals([snap], toAnswers({ X: ['A', 'B'] }));
    expect(high['CHG-01']).toBe(0.98);
    const low = accumulateSignals([snap], toAnswers({ X: ['C'] }));
    expect(low['CHG-01']).toBe(0.02);
  });

  it('counts every ranked option of a ranking answer (rank recorded, not weighted)', () => {
    const snap: MomentSnapshot = {
      momentId: RANKING_TEST_FIXTURE.id,
      version: 1,
      interactionType: 'ranking',
      title: RANKING_TEST_FIXTURE.title,
      scenario: RANKING_TEST_FIXTURE.scenario,
      maxRank: RANKING_TEST_FIXTURE.maxRank,
      options: RANKING_TEST_FIXTURE.options.map((o) => ({
        id: o.id,
        text: o.text,
        weight: o.weight,
        signals: o.signals,
      })),
    };
    const acc = accumulateSignals([snap], toAnswers({ [RANKING_TEST_FIXTURE.id]: ['B', 'A'] }));
    expect(acc['CHG-01']).toBeCloseTo(0.65, 10); // option A
    expect(acc['TRU-01']).toBeCloseTo(0.62, 10); // option B
    expect(acc['MEA-08']).toBeUndefined(); // option C not ranked
  });

  it('ignores answers whose option ids are missing from the snapshot', () => {
    const snaps = librarySnapshots().filter((s) => s.momentId === 'M-P01');
    const acc = accumulateSignals(snaps, toAnswers({ 'M-P01': ['Z'] }));
    expect(Object.keys(acc)).toHaveLength(0);
  });
});

describe('deterministic sketch generation (Summary Engine V1 port)', () => {
  it('always produces the same text for the same answers', () => {
    const snaps = librarySnapshots();
    const answers = toAnswers(SAMPLE_PROFILE_A);
    const first = generateSketch(snaps, answers);
    const second = generateSketch(snaps, answers);
    expect(first.text).toBe(second.text);
    expect(first.text.length).toBeGreaterThan(0);
    expect(first.engineVersion).toBe(SUMMARY_ENGINE_CONFIG.engineVersion);
  });

  it('distinguishes the two approved sample profiles', () => {
    const snaps = librarySnapshots();
    const a = generateSketch(snaps, toAnswers(SAMPLE_PROFILE_A));
    const b = generateSketch(snaps, toAnswers(SAMPLE_PROFILE_B));
    expect(a.text).not.toBe(b.text);
  });

  it('passes the assembly audit (output is exactly approved variants ⊕ connectives)', () => {
    const snaps = librarySnapshots();
    expect(generateSketch(snaps, toAnswers(SAMPLE_PROFILE_A)).audit).toBe('PASSED');
    expect(generateSketch(snaps, toAnswers(SAMPLE_PROFILE_B)).audit).toBe('PASSED');
  });

  it('never leaks internal signal IDs, scores or percentages into the text', () => {
    const snaps = librarySnapshots();
    for (const profile of [SAMPLE_PROFILE_A, SAMPLE_PROFILE_B]) {
      const { text } = generateSketch(snaps, toAnswers(profile));
      expect(text).not.toMatch(/(EMW|CHG|CAR|REL|MEA|TRU|EXP)-\d{2}/);
      expect(text).not.toMatch(/SB-[A-Z]{3}/);
      expect(text).not.toMatch(/\d+\s*%/);
      expect(text).not.toMatch(/\d+\s*分/);
    }
  });

  it('falls back to per-dimension fallback blocks when nothing is answered', () => {
    const snaps = librarySnapshots();
    const result = generateSketch(snaps, {});
    expect(result.audit).toBe('PASSED');
    const fallbackTexts = SUMMARY_ENGINE_CONFIG.blocks
      .filter((b) => b.fallback)
      .flatMap((b) => b.variants.map((v) => v.text));
    // Every dimension should resolve to one of its approved fallback variants.
    expect(fallbackTexts.some((ft) => result.text.includes(ft))).toBe(true);
  });
});
