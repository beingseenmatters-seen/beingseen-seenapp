import { describe, it, expect } from 'vitest';
import type { MomentDefinition } from '../../types/moments';
import { MOMENT_LIBRARY } from '../../data/moments/library';
import {
  getActiveMoments,
  validateMomentConfig,
  validateMomentLibrary,
} from './config';
import { RANKING_TEST_FIXTURE } from './testFixtures';

function baseMoment(overrides: Partial<MomentDefinition> = {}): MomentDefinition {
  return {
    id: 'TEST-01',
    version: 1,
    status: 'active',
    interactionType: 'single_choice',
    title: { zh: '标题' },
    scenario: { zh: '场景' },
    options: [
      { id: 'A', text: { zh: '甲' }, signals: [{ signal: 'CHG-01', delta: 0.5, confidence: 'medium' }] },
      { id: 'B', text: { zh: '乙' }, signals: [{ signal: 'TRU-01', delta: 0.4, confidence: 'low' }] },
    ],
    ...overrides,
  };
}

describe('Moment config validation', () => {
  it('accepts the full production library without errors', () => {
    expect(validateMomentLibrary(MOMENT_LIBRARY)).toEqual([]);
  });

  it('accepts the ranking test fixture', () => {
    expect(validateMomentConfig(RANKING_TEST_FIXTURE)).toEqual([]);
  });

  it('rejects a missing id', () => {
    const errs = validateMomentConfig(baseMoment({ id: '' }));
    expect(errs.length).toBeGreaterThan(0);
  });

  it('rejects an invalid interaction type', () => {
    const bad = baseMoment({ interactionType: 'slider' as MomentDefinition['interactionType'] });
    expect(validateMomentConfig(bad).some((e) => e.includes('interactionType'))).toBe(true);
  });

  it('rejects duplicate option ids', () => {
    const bad = baseMoment({
      options: [
        { id: 'A', text: { zh: '甲' }, signals: [] },
        { id: 'A', text: { zh: '乙' }, signals: [] },
      ],
    });
    expect(validateMomentConfig(bad).some((e) => e.includes('duplicate option id'))).toBe(true);
  });

  it('rejects unknown Signal IDs', () => {
    const bad = baseMoment({
      options: [
        { id: 'A', text: { zh: '甲' }, signals: [{ signal: 'XXX-99', delta: 0.5, confidence: 'low' }] },
        { id: 'B', text: { zh: '乙' }, signals: [] },
      ],
    });
    expect(validateMomentConfig(bad).some((e) => e.includes('XXX-99'))).toBe(true);
  });

  it('rejects invalid multiple-choice selection constraints', () => {
    const bad = baseMoment({ interactionType: 'multiple_choice', minSelection: 3, maxSelection: 2 });
    expect(validateMomentConfig(bad).some((e) => e.includes('selection constraints'))).toBe(true);

    const missing = baseMoment({ interactionType: 'multiple_choice' });
    expect(validateMomentConfig(missing).length).toBeGreaterThan(0);
  });

  it('rejects ranking maxRank outside the option count', () => {
    const bad = baseMoment({ interactionType: 'ranking', maxRank: 5 });
    expect(validateMomentConfig(bad).some((e) => e.includes('maxRank'))).toBe(true);
  });

  it('rejects missing Chinese copy', () => {
    const bad = baseMoment({ scenario: { zh: '  ' } });
    expect(validateMomentConfig(bad).some((e) => e.includes('scenario.zh'))).toBe(true);
  });

  it('rejects duplicate Moment ids across a library', () => {
    const errs = validateMomentLibrary([baseMoment(), baseMoment()]);
    expect(errs.some((e) => e.includes('Duplicate Moment id'))).toBe(true);
  });
});

describe('active/draft/retired filtering', () => {
  it('returns only active, valid Moments', () => {
    const library = [
      baseMoment({ id: 'ACT-1', status: 'active' }),
      baseMoment({ id: 'DRAFT-1', status: 'draft' }),
      baseMoment({ id: 'RET-1', status: 'retired' }),
      baseMoment({ id: 'BROKEN-1', status: 'active', options: [] }),
    ];
    expect(getActiveMoments(library).map((m) => m.id)).toEqual(['ACT-1']);
  });

  it('production library exposes all 23 approved Moments as active', () => {
    const active = getActiveMoments();
    expect(active.map((m) => m.id)).toEqual([
      'M-P01', 'M-P02', 'M-P03', 'M-P04', 'M-P05',
      'M-P06', 'M-P07', 'M-P08', 'M-P09', 'M-P10',
      'M-P11', 'M-P12',
      // Founder Frozen Set 001 (2026-08-04)
      'REL-001', 'SOC-001', 'FRI-001', 'REL-002', 'TRV-001', 'COM-001',
      // Founder Frozen Set 002 (2026-08-04)
      'REL-003', 'REL-004', 'BUS-002',
      // Founder Frozen Set 003 (2026-08-06) — Moment Library v2
      'FRI-002', 'PAR-001',
    ]);
  });

  // Founder requirement (2026-08-04): the Chinese and English Moment
  // Libraries evolve together as one product. Every approved Moment must
  // carry native English copy for all user-facing fields.
  it('every active Moment carries native English copy (bilingual library)', () => {
    for (const m of getActiveMoments()) {
      expect(m.title.en, `${m.id} title.en`).toBeTruthy();
      expect(m.scenario.en, `${m.id} scenario.en`).toBeTruthy();
      if (m.hint) expect(m.hint.en, `${m.id} hint.en`).toBeTruthy();
      for (const o of m.options) {
        expect(o.text.en, `${m.id} ${o.id} text.en`).toBeTruthy();
        expect(o.interpretation?.en, `${m.id} ${o.id} interpretation.en`).toBeTruthy();
      }
    }
  });
});

describe('production content guarantees', () => {
  it('keeps the approved ranking constraints on M-P11 and M-P12 (founder-approved 2026-07-29)', () => {
    const p11 = MOMENT_LIBRARY.find((x) => x.id === 'M-P11')!;
    expect(p11.interactionType).toBe('ranking');
    expect(p11.maxRank).toBe(3);
    expect(p11.options).toHaveLength(9);
    expect(p11.scenario.zh).toBe('如果重新选择一位长期人生伴侣，下面哪些条件对你来说更重要？');

    const p12 = MOMENT_LIBRARY.find((x) => x.id === 'M-P12')!;
    expect(p12.interactionType).toBe('ranking');
    expect(p12.maxRank).toBe(3);
    expect(p12.options).toHaveLength(7);
    expect(p12.scenario.zh).toContain('长期合作伙伴');

    // The generic ranking test fixture must never leak into the library.
    expect(MOMENT_LIBRARY.some((m) => m.id === RANKING_TEST_FIXTURE.id)).toBe(false);
  });

  it('keeps the approved multiple-choice constraints on M-P04', () => {
    const m = MOMENT_LIBRARY.find((x) => x.id === 'M-P04')!;
    expect(m.interactionType).toBe('multiple_choice');
    expect(m.minSelection).toBe(1);
    expect(m.maxSelection).toBe(3);
    expect(m.options).toHaveLength(7);
  });
});
