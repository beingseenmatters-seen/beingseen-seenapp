/**
 * Founder Frozen Set 003 — FRI-002 + PAR-001.
 * Validates config, signal ontology, and five simulated Behaviour Understanding sketches.
 */
import { describe, expect, it } from 'vitest';
import { MOMENT_LIBRARY } from '../../data/moments/library';
import { SIGNAL_INDEX } from '../../data/moments/signals';
import { validateMomentConfig, getActiveMoments } from './config';
import { generateSketchV2 } from './sketchEngineV2';
import { getMappingsForSignal } from '../../data/understanding/signalMovementMap';
import type { MomentDefinition, MomentsSession } from '../../types/moments';

function requireMoment(id: string): MomentDefinition {
  const m = MOMENT_LIBRARY.find((x) => x.id === id);
  if (!m) throw new Error(`Missing Moment ${id}`);
  return m;
}

function buildSession(
  id: string,
  answers: Record<string, string[]>,
): MomentsSession {
  const momentIds = Object.keys(answers);
  const moments = momentIds.map((mid) => requireMoment(mid));
  return {
    id,
    status: 'completed',
    momentIds,
    momentVersions: Object.fromEntries(moments.map((m) => [m.id, m.version])),
    snapshots: moments.map((m) => ({
      momentId: m.id,
      version: m.version,
      interactionType: m.interactionType,
      title: m.title,
      scenario: m.scenario,
      emoji: m.emoji,
      hint: m.hint,
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
    })),
    answers: Object.fromEntries(
      momentIds.map((mid) => [
        mid,
        {
          momentId: mid,
          selectedOptionIds: answers[mid]!,
          answeredAt: 1,
        },
      ]),
    ),
    createdAt: 1,
    updatedAt: 1,
    completedAt: 1,
  };
}

function emissionsFor(momentId: string, optionIds: string[]) {
  const m = requireMoment(momentId);
  return optionIds.flatMap((oid) => {
    const opt = m.options.find((o) => o.id === oid)!;
    return opt.signals.map((s) => ({
      optionId: oid,
      signal: s.signal,
      delta: s.delta,
      confidence: s.confidence,
    }));
  });
}

describe('Founder Frozen Set 003 — library presence', () => {
  it('FRI-002 and PAR-001 are active and valid', () => {
    const fri = requireMoment('FRI-002');
    const par = requireMoment('PAR-001');
    expect(validateMomentConfig(fri)).toEqual([]);
    expect(validateMomentConfig(par)).toEqual([]);
    expect(fri.interactionType).toBe('single_choice');
    expect(par.interactionType).toBe('ranking');
    expect(par.maxRank).toBe(6);
    expect(par.options).toHaveLength(6);
    expect(getActiveMoments().some((m) => m.id === 'FRI-002')).toBe(true);
    expect(getActiveMoments().some((m) => m.id === 'PAR-001')).toBe(true);
  });

  it('uses only existing Signal IDs mapped to Movements', () => {
    for (const id of ['FRI-002', 'PAR-001']) {
      const m = requireMoment(id);
      for (const o of m.options) {
        expect(o.signals.length).toBeGreaterThan(0);
        for (const s of o.signals) {
          expect(SIGNAL_INDEX[s.signal], `${id}/${o.id}/${s.signal}`).toBeTruthy();
          expect(
            getMappingsForSignal(s.signal).length,
            `${id}/${o.id}/${s.signal} unmapped`,
          ).toBeGreaterThan(0);
        }
      }
    }
  });

  it('does not mutate earlier frozen Moment ids', () => {
    expect(requireMoment('FRI-001').version).toBe(1);
    expect(requireMoment('REL-003').options).toHaveLength(5);
    expect(requireMoment('BUS-002').id).toBe('BUS-002');
  });
});

describe('Founder Frozen Set 003 — five simulated users', () => {
  const users: Array<{
    name: string;
    answers: Record<string, string[]>;
  }> = [
    {
      name: 'U1 Direct Clarifier',
      answers: {
        'FRI-002': ['A'],
        'PAR-001': ['F', 'B', 'E', 'A', 'D', 'C'],
      },
    },
    {
      name: 'U2 Selective Explainer',
      answers: {
        'FRI-002': ['B'],
        'PAR-001': ['A', 'C', 'E', 'D', 'F', 'B'],
      },
    },
    {
      name: 'U3 Trust-the-Bond',
      answers: {
        'FRI-002': ['C'],
        'PAR-001': ['D', 'F', 'B', 'E', 'A', 'C'],
      },
    },
    {
      name: 'U4 Time-and-Actions',
      answers: {
        'FRI-002': ['D'],
        'PAR-001': ['E', 'F', 'A', 'C', 'D', 'B'],
      },
    },
    {
      name: 'U5 Listen-First',
      answers: {
        'FRI-002': ['E'],
        'PAR-001': ['B', 'F', 'D', 'E', 'A', 'C'],
      },
    },
  ];

  for (const user of users) {
    it(`${user.name}: emits mapped signals and a Sketch V2`, () => {
      const friSignals = emissionsFor('FRI-002', user.answers['FRI-002']!);
      const parSignals = emissionsFor('PAR-001', user.answers['PAR-001']!);
      expect(friSignals.length).toBeGreaterThan(0);
      expect(parSignals.length).toBeGreaterThan(0);

      const session = buildSession(`sim_${user.name}`, user.answers);
      const sketch = generateSketchV2({
        session,
        priorSessions: [],
        recentProvenance: [],
        sketchNumber: 1,
        language: 'zh',
      });

      expect(sketch.audit).toBe('PASSED');
      expect(sketch.text.trim().length).toBeGreaterThan(10);
      expect(sketch.provenance.engineVersion).toBeTruthy();

      // Surface for Founder review (visible in vitest reporter).
      console.log(`\n=== ${user.name} ===`);
      console.log('FRI-002:', user.answers['FRI-002']);
      console.log('PAR-001:', user.answers['PAR-001']);
      console.log(
        'Signals:',
        [...friSignals, ...parSignals]
          .map((s) => `${s.signal}(${s.delta})`)
          .join(', '),
      );
      console.log('Sketch:', sketch.text);
    });
  }
});
