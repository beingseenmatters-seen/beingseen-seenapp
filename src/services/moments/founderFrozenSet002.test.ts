/**
 * Founder Frozen Set 002 (approved 2026-08-04) — deterministic validation.
 *
 * Frozen Moment entry gate (founder rule):
 *  1. Natural Chinese version
 *  2. Native English version (not literal translation)
 *  3. Signal mapping complete on the existing ontology
 *  4. Sketch regression test passes
 *
 * Moments: REL-003, REL-004, BUS-002.
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
import { getMappingsForSignal } from '../../data/understanding/signalMovementMap';
import {
  aggregateMomentSessionEvidence,
  createMomentEvidenceFromSession,
} from '../understanding/momentEvidence';
import { validateUnderstandingEvidence } from '../understanding/validateEvidence';
import { generateSketchV2 } from './sketchEngineV2';

export const FROZEN_SET_002_IDS = ['REL-003', 'REL-004', 'BUS-002'] as const;

const setMoments = FROZEN_SET_002_IDS.map(
  (id) => MOMENT_LIBRARY.find((m) => m.id === id)!,
);

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

function buildSession(id: string, answers: Record<string, string[]>): MomentsSession {
  const ids = Object.keys(answers);
  const moments = ids.map((mid) => MOMENT_LIBRARY.find((m) => m.id === mid)!);
  const answerMap: Record<string, MomentAnswer> = {};
  for (const mid of ids) {
    answerMap[mid] = { momentId: mid, selectedOptionIds: answers[mid], answeredAt: 1 };
  }
  return {
    id,
    status: 'completed',
    momentIds: ids,
    momentVersions: Object.fromEntries(moments.map((m) => [m.id, m.version])),
    snapshots: moments.map(snapshot),
    answers: answerMap,
    createdAt: 0,
    updatedAt: 1,
    completedAt: 1,
  };
}

describe('Founder Frozen Set 002 — entry gate', () => {
  it('all three Moments exist, are active single-choice, and pass config validation', () => {
    for (const m of setMoments) {
      expect(m, m?.id).toBeDefined();
      expect(m.status).toBe('active');
      expect(m.interactionType).toBe('single_choice');
      expect(m.version).toBe(1);
      expect(validateMomentConfig(m)).toEqual([]);
    }
  });

  it('Chinese version is present and founder-approved', () => {
    expect(setMoments[0].scenario.zh).toContain('超出了你目前的预算');
    expect(setMoments[1].scenario.zh).toContain('家庭经济条件比较普通');
    expect(setMoments[2].scenario.zh).toContain('公司的下一步发展方向');
    expect(setMoments.map((m) => m.options.length)).toEqual([5, 5, 5]);
  });

  it('native English version is present (not missing, not empty)', () => {
    for (const m of setMoments) {
      expect(m.title.en).toBeTruthy();
      expect(m.scenario.en).toBeTruthy();
      expect(m.scenario.en).not.toBe(m.scenario.zh);
      for (const o of m.options) {
        expect(o.text.en).toBeTruthy();
        expect(o.text.en).not.toBe(o.text.zh);
        expect(o.interpretation?.en).toBeTruthy();
      }
    }
  });

  it('signal mapping is complete on the existing ontology', () => {
    for (const moment of setMoments) {
      for (const option of moment.options) {
        expect(option.signals.length).toBeGreaterThan(0);
        for (const emission of option.signals) {
          expect(SIGNAL_INDEX[emission.signal], `${moment.id} ${option.id} ${emission.signal}`)
            .toBeDefined();
          expect(
            getMappingsForSignal(emission.signal).length,
            `${moment.id} ${option.id} ${emission.signal} unmapped`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it('does not modify any previously approved Moment (M-P01..Set001 unchanged in prefix)', () => {
    const priorIds = MOMENT_LIBRARY.slice(0, 18).map((m) => m.id);
    expect(priorIds).toEqual([
      'M-P01', 'M-P02', 'M-P03', 'M-P04', 'M-P05', 'M-P06',
      'M-P07', 'M-P08', 'M-P09', 'M-P10', 'M-P11', 'M-P12',
      'REL-001', 'SOC-001', 'FRI-001', 'REL-002', 'TRV-001', 'COM-001',
    ]);
  });
});

describe('Founder Frozen Set 002 — Behaviour Understanding', () => {
  it('a session of the three Moments produces valid Behaviour evidence', () => {
    const session = buildSession('ffs2_evidence', {
      'REL-003': ['D'], 'REL-004': ['B'], 'BUS-002': ['D'],
    });
    session.sketch = { number: 1, text: 'x', generatedAt: 1, engineVersion: 'v2', language: 'zh' };
    const aggregates = aggregateMomentSessionEvidence(session);
    expect(aggregates.length).toBeGreaterThan(0);
    const evidence = createMomentEvidenceFromSession(session, {
      userId: 'user_test',
      now: '2026-08-04T00:00:00.000Z',
    });
    expect(evidence.length).toBe(aggregates.length);
    for (const ev of evidence) expect(validateUnderstandingEvidence(ev)).toEqual([]);
  });

  it('different answer profiles surface different Movements', () => {
    const pragmatic = buildSession('ffs2_a', {
      'REL-003': ['C'], 'REL-004': ['B'], 'BUS-002': ['D'],
    });
    const filtering = buildSession('ffs2_b', {
      'REL-003': ['A'], 'REL-004': ['A'], 'BUS-002': ['E'],
    });
    const ms = (s: MomentsSession) =>
      aggregateMomentSessionEvidence(s)
        .map((a) => `${a.movementId}:${a.direction.toFixed(1)}`)
        .join(',');
    expect(ms(pragmatic)).not.toBe(ms(filtering));
  });
});

describe('Founder Frozen Set 002 — Sketch regression', () => {
  it('participates in deterministic V2 sketch generation (zh + en)', () => {
    const session = buildSession('ffs2_sketch', {
      'M-P01': ['D'], 'M-P05': ['C'], 'M-P09': ['D'], 'M-P10': ['D'],
      'REL-001': ['B'], 'REL-003': ['E'], 'REL-004': ['D'], 'BUS-002': ['B'],
      'COM-001': ['A'], 'TRV-001': ['A'],
    });
    const zh = generateSketchV2({
      session, priorSessions: [], recentProvenance: [], sketchNumber: 1, language: 'zh',
    });
    const en = generateSketchV2({
      session, priorSessions: [], recentProvenance: [], sketchNumber: 1, language: 'en',
    });
    expect(zh.audit).toBe('PASSED');
    expect(en.audit).toBe('PASSED');
    expect(zh.text).toBe(
      generateSketchV2({
        session, priorSessions: [], recentProvenance: [], sketchNumber: 1, language: 'zh',
      }).text,
    );
    expect(en.provenance.blockIds).toEqual(zh.provenance.blockIds);
    expect(en.text).not.toMatch(/[\u4e00-\u9fff]/);

    const setOnly = buildSession('ffs2_only', {
      'REL-003': ['E'], 'REL-004': ['D'], 'BUS-002': ['B'],
    });
    const setMovements = new Set(aggregateMomentSessionEvidence(setOnly).map((a) => a.movementId));
    expect(zh.provenance.movementIds.some((m) => setMovements.has(m as never))).toBe(true);
  });

  it('divergent answer combinations produce different sketches', () => {
    const base = {
      'M-P01': ['D'], 'M-P05': ['C'], 'M-P09': ['D'], 'M-P10': ['D'],
      'REL-001': ['B'], 'COM-001': ['A'], 'TRV-001': ['A'],
    };
    const a = generateSketchV2({
      session: buildSession('ffs2_div_a', { ...base, 'REL-003': ['A'], 'REL-004': ['A'], 'BUS-002': ['E'] }),
      priorSessions: [], recentProvenance: [], sketchNumber: 1, language: 'zh',
    });
    const b = generateSketchV2({
      session: buildSession('ffs2_div_b', { ...base, 'REL-003': ['E'], 'REL-004': ['D'], 'BUS-002': ['B'] }),
      priorSessions: [], recentProvenance: [], sketchNumber: 1, language: 'zh',
    });
    expect(a.audit).toBe('PASSED');
    expect(b.audit).toBe('PASSED');
    expect(a.text).not.toBe(b.text);
  });
});
