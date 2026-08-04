/**
 * Founder Frozen Set 001 (approved 2026-08-04) — deterministic validation.
 *
 * Six everyday-scene Moments: REL-001, SOC-001, FRI-001, REL-002, TRV-001,
 * COM-001. These tests prove the set integrates with the frozen systems
 * exactly like existing Moments: config validation, existing signal ontology
 * only, Movement mapping coverage, Behaviour evidence creation, and Sketch
 * Engine V2 participation. No engine, renderer or selection logic changed.
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

export const FROZEN_SET_001_IDS = [
  'REL-001', 'SOC-001', 'FRI-001', 'REL-002', 'TRV-001', 'COM-001',
] as const;

const setMoments = FROZEN_SET_001_IDS.map(
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

describe('Founder Frozen Set 001 — definitions', () => {
  it('all six Moments exist, are active single-choice, and pass config validation', () => {
    for (const m of setMoments) {
      expect(m, m?.id).toBeDefined();
      expect(m.status).toBe('active');
      expect(m.interactionType).toBe('single_choice');
      expect(m.version).toBe(1);
      expect(validateMomentConfig(m)).toEqual([]);
    }
  });

  it('keeps founder option counts (5/5/5/5/4/4) and verbatim scenarios', () => {
    expect(setMoments.map((m) => m.options.length)).toEqual([5, 5, 5, 5, 4, 4]);
    expect(setMoments[0].scenario.zh).toContain('“随便。”');
    expect(setMoments[1].scenario.zh).toContain('“快了快了。”');
    expect(setMoments[2].scenario.zh).toContain('“在吗？”');
    expect(setMoments[3].scenario.zh).toContain('服务员上错了一道菜');
    expect(setMoments[4].scenario.zh).toContain('收拾行李');
    expect(setMoments[5].scenario.zh).toContain('明天就要交');
  });

  it('does not modify any previously approved Moment (M-P01..M-P12 unchanged)', () => {
    const prior = MOMENT_LIBRARY.slice(0, 12);
    expect(prior.map((m) => m.id)).toEqual([
      'M-P01', 'M-P02', 'M-P03', 'M-P04', 'M-P05', 'M-P06',
      'M-P07', 'M-P08', 'M-P09', 'M-P10', 'M-P11', 'M-P12',
    ]);
    expect(prior.every((m) => m.version === 1)).toBe(true);
  });
});

describe('Founder Frozen Set 001 — Human Understanding Engine integration', () => {
  it('uses only existing catalog signals, each mapped to a Movement', () => {
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

  it('a session of the six Moments produces valid Behaviour evidence', () => {
    const session = buildSession('ffs1_evidence', {
      'REL-001': ['B'], 'SOC-001': ['E'], 'FRI-001': ['B'],
      'REL-002': ['B'], 'TRV-001': ['C'], 'COM-001': ['A'],
    });
    // Evidence creation requires a retained (sketch-bearing) session.
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
    const caring = buildSession('ffs1_a', {
      'REL-001': ['B'], 'SOC-001': ['E'], 'FRI-001': ['A'],
      'REL-002': ['B'], 'TRV-001': ['D'], 'COM-001': ['A'],
    });
    const boundaried = buildSession('ffs1_b', {
      'REL-001': ['D'], 'SOC-001': ['B'], 'FRI-001': ['C'],
      'REL-002': ['D'], 'TRV-001': ['B'], 'COM-001': ['D'],
    });
    const ms = (s: MomentsSession) =>
      aggregateMomentSessionEvidence(s)
        .map((a) => `${a.movementId}:${a.direction.toFixed(1)}`)
        .join(',');
    expect(ms(caring)).not.toBe(ms(boundaried));
  });
});

describe('Founder Frozen Set 001 — sketch participation', () => {
  it('a session including the set generates a deterministic, audited V2 sketch', () => {
    const session = buildSession('ffs1_sketch', {
      'M-P01': ['A'], 'M-P05': ['C'], 'M-P09': ['D'], 'M-P10': ['D'],
      'REL-001': ['B'], 'SOC-001': ['E'], 'FRI-001': ['B'],
      'REL-002': ['B'], 'TRV-001': ['C'], 'COM-001': ['A'],
    });
    const one = generateSketchV2({ session, priorSessions: [], recentProvenance: [], sketchNumber: 1 });
    const two = generateSketchV2({ session, priorSessions: [], recentProvenance: [], sketchNumber: 1 });
    expect(one.audit).toBe('PASSED');
    expect(one.text).toBe(two.text);
    expect(one.text.length).toBeGreaterThan(0);
    // The set contributes: at least one rendered Movement must be supported
    // by the six new Moments' own evidence.
    const setOnly = buildSession('ffs1_only', {
      'REL-001': ['B'], 'SOC-001': ['E'], 'FRI-001': ['B'],
      'REL-002': ['B'], 'TRV-001': ['C'], 'COM-001': ['A'],
    });
    const setMovements = new Set(aggregateMomentSessionEvidence(setOnly).map((a) => a.movementId));
    expect(one.provenance.movementIds.some((m) => setMovements.has(m as never))).toBe(true);
  });
});
