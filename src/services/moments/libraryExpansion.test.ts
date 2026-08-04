/**
 * Moment Library expansion — M-P11 (重选伴侣) and M-P12 (创业伙伴), the two
 * founder-approved ranking Moments (2026-07-29, first content added under
 * Architecture Freeze V1).
 *
 * These tests prove the new Moments integrate with the frozen systems exactly
 * like existing Moments: config validation, Summary Engine V1 accumulation,
 * and the Human Understanding Engine's signal → Movement → Behaviour Evidence
 * path. No engine, renderer or selection logic changed.
 */

import { describe, it, expect } from 'vitest';
import type {
  MomentAnswer,
  MomentDefinition,
  MomentSnapshot,
  MomentsSession,
} from '../../types/moments';
import { MOMENT_LIBRARY } from '../../data/moments/library';
import { SIGNAL_INDEX } from '../../data/moments/signals';
import { validateMomentConfig } from './config';
import { accumulateSignals, generateSketch } from './sketchEngine';
import { getMappingsForSignal } from '../../data/understanding/signalMovementMap';
import {
  aggregateMomentSessionEvidence,
  createMomentEvidenceFromSession,
} from '../understanding/momentEvidence';
import { validateUnderstandingEvidence } from '../understanding/validateEvidence';

const p11 = MOMENT_LIBRARY.find((m) => m.id === 'M-P11')!;
const p12 = MOMENT_LIBRARY.find((m) => m.id === 'M-P12')!;

/** Mirror of the service's private toSnapshot (session-locked content copy). */
function snapshot(moment: MomentDefinition): MomentSnapshot {
  return {
    momentId: moment.id,
    version: moment.version,
    interactionType: moment.interactionType,
    title: moment.title,
    scenario: moment.scenario,
    emoji: moment.emoji,
    hint: moment.hint,
    minSelection: moment.minSelection,
    maxSelection: moment.maxSelection,
    maxRank: moment.maxRank,
    options: moment.options.map((o) => ({
      id: o.id,
      text: o.text,
      interpretation: o.interpretation,
      weight: o.weight,
      signals: o.signals,
    })),
  };
}

function rankingSession(rankings: { p11: string[]; p12: string[] }): MomentsSession {
  const answers: Record<string, MomentAnswer> = {
    'M-P11': { momentId: 'M-P11', selectedOptionIds: rankings.p11, answeredAt: 1 },
    'M-P12': { momentId: 'M-P12', selectedOptionIds: rankings.p12, answeredAt: 2 },
  };
  return {
    id: 'sess_expansion_test',
    status: 'completed',
    momentIds: ['M-P11', 'M-P12'],
    momentVersions: { 'M-P11': p11.version, 'M-P12': p12.version },
    snapshots: [snapshot(p11), snapshot(p12)],
    answers,
    createdAt: 0,
    updatedAt: 10,
    completedAt: 10,
    sketch: { number: 1, text: 'x', generatedAt: 10, engineVersion: 'v1', language: 'zh' },
  };
}

describe('M-P11 / M-P12 definitions', () => {
  it('both pass config validation with founder-approved copy and top-3 ranking', () => {
    expect(validateMomentConfig(p11)).toEqual([]);
    expect(validateMomentConfig(p12)).toEqual([]);
    expect(p11.maxRank).toBe(3);
    expect(p12.maxRank).toBe(3);
    expect(p11.options.map((o) => o.id)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G', 'H', 'I']);
    expect(p12.options.map((o) => o.id)).toEqual(['A', 'B', 'C', 'D', 'E', 'F', 'G']);
  });

  it('does not modify any existing Moment (M-P01..M-P10 ids, versions, types unchanged)', () => {
    const existing = MOMENT_LIBRARY.slice(0, 10);
    expect(existing.map((m) => m.id)).toEqual([
      'M-P01', 'M-P02', 'M-P03', 'M-P04', 'M-P05',
      'M-P06', 'M-P07', 'M-P08', 'M-P09', 'M-P10',
    ]);
    expect(existing.every((m) => m.version === 1)).toBe(true);
    expect(existing.every((m) => m.interactionType !== 'ranking')).toBe(true);
  });
});

describe('Human Understanding Engine integration (existing ontology only)', () => {
  it('every emitted signal exists in the signal catalog and maps to a Movement', () => {
    for (const moment of [p11, p12]) {
      for (const option of moment.options) {
        expect(option.signals.length).toBeGreaterThan(0);
        for (const emission of option.signals) {
          expect(SIGNAL_INDEX[emission.signal], `${moment.id} ${option.id} ${emission.signal}`)
            .toBeDefined();
          expect(
            getMappingsForSignal(emission.signal).length,
            `${moment.id} ${option.id} ${emission.signal} has no Movement mapping`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it('a completed session with the new Moments produces valid Behaviour evidence', () => {
    const session = rankingSession({ p11: ['C', 'F', 'B'], p12: ['A', 'D', 'G'] });
    const aggregates = aggregateMomentSessionEvidence(session);
    expect(aggregates.length).toBeGreaterThan(0);

    const evidence = createMomentEvidenceFromSession(session, {
      userId: 'user_test',
      now: '2026-07-29T00:00:00.000Z',
    });
    expect(evidence.length).toBe(aggregates.length);
    for (const ev of evidence) {
      expect(ev.source).toBe('moment');
      expect(validateUnderstandingEvidence(ev)).toEqual([]);
    }
  });

  it('different rankings surface different Movements (the Moments discriminate)', () => {
    const security = rankingSession({ p11: ['C', 'F', 'B'], p12: ['A', 'D', 'G'] });
    const values = rankingSession({ p11: ['I', 'H', 'G'], p12: ['F', 'C', 'G'] });
    const ms = (s: MomentsSession) =>
      aggregateMomentSessionEvidence(s).map((a) => a.movementId).join(',');
    expect(ms(security)).not.toBe(ms(values));
  });
});

describe('Summary Engine V1 contribution', () => {
  it('ranked options accumulate signals exactly like other interaction types', () => {
    const session = rankingSession({ p11: ['E', 'G', 'A'], p12: ['B', 'E', 'C'] });
    const acc = accumulateSignals(session.snapshots, session.answers);
    // Chosen options' signals move off the 0.5 baseline; unchosen ones do not.
    expect(acc['CHG-03']).toBeGreaterThan(0.5); // 有上进心 (chosen)
    expect(acc['MEA-08']).toBeUndefined(); // 经济/安稳 options not chosen
  });

  it('different rankings produce different deterministic sketches', () => {
    const a = rankingSession({ p11: ['C', 'F', 'B'], p12: ['A', 'D', 'G'] });
    const b = rankingSession({ p11: ['E', 'G', 'A'], p12: ['B', 'E', 'C'] });
    const sa = generateSketch(a.snapshots, a.answers);
    const sb = generateSketch(b.snapshots, b.answers);
    expect(sa.audit).toMatch(/^PASSED/);
    expect(sb.audit).toMatch(/^PASSED/);
    expect(sa.text).not.toBe(sb.text);
    // Determinism: same answers, same sketch.
    expect(generateSketch(a.snapshots, a.answers).text).toBe(sa.text);
  });
});
