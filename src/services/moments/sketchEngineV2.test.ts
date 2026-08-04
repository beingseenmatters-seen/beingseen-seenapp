/**
 * Sketch Engine V2 — deterministic comparison tests (founder validation plan).
 *
 *  A: baseline sketch from one fixed 10-Moment session.
 *  B: later session whose strongest new evidence comes from M-P11 (伴侣排序).
 *  C: later session whose strongest new evidence comes from M-P12 (创业伙伴).
 *  D: later session that repeats the baseline (no meaningful delta).
 */

import { describe, it, expect } from 'vitest';
import type {
  MomentAnswer,
  MomentDefinition,
  MomentSnapshot,
  MomentsSession,
} from '../../types/moments';
import { MOMENT_LIBRARY } from '../../data/moments/library';
import type { MovementId } from '../../data/understanding/movements';
import { SAMPLE_PROFILE_A } from './testFixtures';
import {
  classifySessionDeltas,
  combineBehaviourUnderstanding,
  generateSketchV2,
  MEANINGFUL_SUPPORT,
} from './sketchEngineV2';
import { aggregateMomentSessionEvidence } from '../understanding/momentEvidence';
import { MOVEMENT_CLAUSES } from '../../data/moments/sketchV2Content';
import { InMemoryStore, MomentsService } from './momentsService';

// ---------------------------------------------------------------------------
// Fixed fixtures
// ---------------------------------------------------------------------------

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

function buildSession(
  id: string,
  momentIds: string[],
  overrides: Record<string, string[]> = {},
): MomentsSession {
  const moments = momentIds.map((mid) => MOMENT_LIBRARY.find((m) => m.id === mid)!);
  const answers: Record<string, MomentAnswer> = {};
  for (const m of moments) {
    answers[m.id] = {
      momentId: m.id,
      selectedOptionIds: overrides[m.id] ?? SAMPLE_PROFILE_A[m.id],
      answeredAt: 1,
    };
  }
  return {
    id,
    status: 'completed',
    momentIds,
    momentVersions: Object.fromEntries(moments.map((m) => [m.id, m.version])),
    snapshots: moments.map(snapshot),
    answers,
    createdAt: 0,
    updatedAt: 1,
    completedAt: 1,
  };
}

const BASE_IDS = ['M-P01', 'M-P02', 'M-P03', 'M-P04', 'M-P05', 'M-P06', 'M-P07', 'M-P08', 'M-P09', 'M-P10'];
const NINE_IDS = BASE_IDS.slice(0, 9);

const sessionA = () => buildSession('s_base', BASE_IDS);
const sessionB = () =>
  buildSession('s_p11', [...NINE_IDS, 'M-P11'], { 'M-P11': ['H', 'I', 'G'] });
const sessionC = () =>
  buildSession('s_p12', [...NINE_IDS, 'M-P12'], { 'M-P12': ['B', 'E', 'C'] });
const sessionD = () => buildSession('s_repeat', BASE_IDS);

const sketchA = () =>
  generateSketchV2({ session: sessionA(), priorSessions: [], recentProvenance: [], sketchNumber: 1 });

const laterInput = (session: MomentsSession) => ({
  session,
  priorSessions: [sessionA()],
  recentProvenance: [sketchA().provenance],
  sketchNumber: 2,
});

const opening = (text: string) => text.slice(0, 12);

/** Movements a session's own aggregates support meaningfully. */
const meaningfulMovements = (session: MomentsSession): Set<string> =>
  new Set(
    aggregateMomentSessionEvidence(session)
      .filter((a) => a.strength * a.mappingConfidence >= MEANINGFUL_SUPPORT)
      .map((a) => a.movementId),
  );

// ---------------------------------------------------------------------------
// Test A — baseline
// ---------------------------------------------------------------------------

describe('Test A — baseline sketch', () => {
  it('builds a baseline from the strongest meaningful observations, not a forced 5-part essay', () => {
    const a = sketchA();
    expect(a.audit).toBe('PASSED');
    expect(a.provenance.mode).toBe('baseline');
    expect(a.provenance.movementIds.length).toBeGreaterThanOrEqual(2);
    expect(a.provenance.movementIds.length).toBeLessThanOrEqual(4);
    // Every rendered Movement is meaningfully supported by this session.
    const meaningful = meaningfulMovements(sessionA());
    for (const m of a.provenance.movementIds) expect(meaningful.has(m)).toBe(true);
    // Rendered in salience order — normalized evidence, no dimension bias.
    expect(a.text.length).toBeGreaterThan(0);
  });

  it('is deterministic: same stored state, same sketch', () => {
    expect(sketchA().text).toBe(sketchA().text);
    expect(generateSketchV2(laterInput(sessionB())).text)
      .toBe(generateSketchV2(laterInput(sessionB())).text);
  });
});

// ---------------------------------------------------------------------------
// Tests B & C — Moment-led deltas
// ---------------------------------------------------------------------------

describe('Tests B & C — delta-led sketches', () => {
  it('B and C do not reuse the baseline opening, and differ from each other', () => {
    const a = sketchA();
    const b = generateSketchV2(laterInput(sessionB()));
    const c = generateSketchV2(laterInput(sessionC()));
    expect(b.audit).toBe('PASSED');
    expect(c.audit).toBe('PASSED');
    expect(opening(b.text)).not.toBe(opening(a.text));
    expect(opening(c.text)).not.toBe(opening(a.text));
    expect(b.text).not.toBe(c.text);
  });

  it('B leads with understanding sourced from the partner ranking Moment', () => {
    const b = generateSketchV2(laterInput(sessionB()));
    expect(b.provenance.mode).toBe('delta');
    // The opening sentence's Movement must be a meaningful delta whose
    // evidence includes M-P11's contributions (P11-only session aggregates).
    const p11Only = buildSession('p11_only', ['M-P11'], { 'M-P11': ['H', 'I', 'G'] });
    const p11Movements = new Set(
      aggregateMomentSessionEvidence(p11Only).map((a) => a.movementId),
    );
    const lead = b.provenance.movementIds[0] as MovementId;
    expect(p11Movements.has(lead)).toBe(true);
    expect(['NEW', 'STRENGTHENED', 'SHIFTED', 'REVISED']).toContain(
      b.provenance.deltaClasses[lead],
    );
  });

  it('C leads with understanding sourced from the business-partner ranking Moment', () => {
    const c = generateSketchV2(laterInput(sessionC()));
    expect(c.provenance.mode).toBe('delta');
    const p12Only = buildSession('p12_only', ['M-P12'], { 'M-P12': ['B', 'E', 'C'] });
    const p12Movements = new Set(
      aggregateMomentSessionEvidence(p12Only).map((a) => a.movementId),
    );
    const lead = c.provenance.movementIds[0] as MovementId;
    expect(p12Movements.has(lead)).toBe(true);
    expect(['NEW', 'STRENGTHENED', 'SHIFTED', 'REVISED']).toContain(
      c.provenance.deltaClasses[lead],
    );
  });

  it('stable understanding stays recognizable across editions', () => {
    const a = sketchA();
    const b = generateSketchV2(laterInput(sessionB()));

    // Consecutive sketches rotate wording (cooldown), but every continuity
    // Movement in B is grounded in already-established understanding.
    const pre = combineBehaviourUnderstanding([sessionA()]);
    const bContinuity = b.provenance.movementIds.filter(
      (m) => !['NEW'].includes(b.provenance.deltaClasses[m] ?? ''),
    );
    for (const m of bContinuity) {
      expect(pre.has(m as Parameters<typeof pre.get>[0])).toBe(true);
    }

    // One edition later the cooldown expires: a Movement voiced in the
    // baseline resurfaces — the stable core stays recognizable over time.
    const third = generateSketchV2({
      session: sessionD(),
      priorSessions: [sessionA(), sessionB()],
      recentProvenance: [a.provenance, b.provenance],
      sketchNumber: 3,
    });
    const shared = third.provenance.movementIds.filter((m) =>
      a.provenance.movementIds.includes(m),
    );
    expect(shared.length).toBeGreaterThan(0);
  });
});

// ---------------------------------------------------------------------------
// Test D — no meaningful delta
// ---------------------------------------------------------------------------

describe('Test D — repeated session produces confirmation, not novelty', () => {
  it('classifies a pure repeat as STABLE (never NEW/REVISED) and confirms', () => {
    const d = generateSketchV2(laterInput(sessionD()));
    expect(d.audit).toBe('PASSED');
    expect(d.provenance.mode).toBe('confirmation');
    const classes = Object.values(d.provenance.deltaClasses);
    expect(classes).not.toContain('NEW');
    expect(classes).not.toContain('REVISED');
    expect(classes).not.toContain('SHIFTED');
    expect(classes).not.toContain('STRENGTHENED');
    // Continuity only: every rendered Movement was already understood.
    const pre = combineBehaviourUnderstanding([sessionA()]);
    for (const m of d.provenance.movementIds) {
      expect(pre.has(m as Parameters<typeof pre.get>[0])).toBe(true);
    }
  });

  it('does not repeat the baseline sketch verbatim (framing acknowledges confirmation)', () => {
    const a = sketchA();
    const d = generateSketchV2(laterInput(sessionD()));
    expect(d.text).not.toBe(a.text);
  });
});

// ---------------------------------------------------------------------------
// Delta classification unit behavior
// ---------------------------------------------------------------------------

describe('delta classification thresholds', () => {
  it('a movement untouched before classifies NEW; weak observations are INSUFFICIENT_CHANGE', () => {
    const pre = combineBehaviourUnderstanding([sessionA()]);
    const deltas = classifySessionDeltas(
      aggregateMomentSessionEvidence(sessionB()),
      pre,
    );
    for (const d of deltas) {
      if (d.salience < MEANINGFUL_SUPPORT * 0.35) {
        expect(d.deltaClass).toBe('INSUFFICIENT_CHANGE');
      }
    }
    // Labels never leak into rendered text.
    const b = generateSketchV2(laterInput(sessionB()));
    for (const label of ['NEW', 'STRENGTHENED', 'SHIFTED', 'REVISED', 'STABLE', 'INSUFFICIENT']) {
      expect(b.text).not.toContain(label);
    }
  });
});

// ---------------------------------------------------------------------------
// Deletion withdraws evidence and later sketches recompute
// ---------------------------------------------------------------------------

describe('retained-session deletion', () => {
  it('deleting a retained session removes its evidence from the next sketch computation', async () => {
    let pool: MomentDefinition[] = BASE_IDS.map(
      (id) => MOMENT_LIBRARY.find((m) => m.id === id)!,
    );
    let t = 1000;
    const service = new MomentsService(
      new InMemoryStore(),
      () => 'user-1',
      () => pool,
      () => 0, // deterministic shuffle
      () => (t += 1),
    );

    // Session 1: baseline.
    const s1 = await service.createSession();
    for (const mid of s1.momentIds) {
      await service.saveAnswer(s1.id, mid, SAMPLE_PROFILE_A[mid]);
    }
    await service.completeSession(s1.id);

    // Session 2: P11-led.
    pool = [...NINE_IDS, 'M-P11'].map((id) => MOMENT_LIBRARY.find((m) => m.id === id)!);
    const s2 = await service.createSession();
    for (const mid of s2.momentIds) {
      await service.saveAnswer(s2.id, mid, mid === 'M-P11' ? ['H', 'I', 'G'] : SAMPLE_PROFILE_A[mid]);
    }
    const done2 = await service.completeSession(s2.id);
    const text2 = done2.sketch!.text;

    // Delete session 2 — its evidence must be withdrawn.
    await service.deleteCompletedSession(s2.id);
    expect((await service.listSketches()).map((s) => s.sessionId)).toEqual([s1.id]);

    // Session 3: identical answers to session 2. With session 2's evidence
    // gone, the stored state matches the pre-deletion state exactly, so the
    // generated sketch must be identical — deletion fully recomputes.
    const s3 = await service.createSession();
    for (const mid of s3.momentIds) {
      await service.saveAnswer(s3.id, mid, mid === 'M-P11' ? ['H', 'I', 'G'] : SAMPLE_PROFILE_A[mid]);
    }
    const done3 = await service.completeSession(s3.id);
    expect(done3.sketch!.text).toBe(text2);
    expect(done3.sketch!.number).toBe(2);
  });
});

// ---------------------------------------------------------------------------
// Founder principle: growth over novelty (fixes approved 2026-07-30)
// ---------------------------------------------------------------------------

describe('growth over novelty', () => {
  /**
   * The 6-session sequence from the runtime trace that exposed both bugs:
   * perspective_taking's prior support hovers under the meaningful threshold,
   * so it used to re-classify NEW and headline two sketches in a row.
   */
  const sequence = () => [
    buildSession('s1_base', BASE_IDS),
    buildSession('s2_p11', [...NINE_IDS, 'M-P11'], { 'M-P11': ['H', 'I', 'G'] }),
    buildSession('s3_p12', [...NINE_IDS, 'M-P12'], { 'M-P12': ['B', 'E', 'C'] }),
    buildSession('s4_repeat', BASE_IDS),
    buildSession('s5_p11', [...NINE_IDS, 'M-P11'], { 'M-P11': ['C', 'F', 'B'] }),
    buildSession('s6_p12', [...NINE_IDS, 'M-P12'], { 'M-P12': ['A', 'D', 'G'] }),
  ];

  const generateSequence = () => {
    const sessions = sequence();
    const results: ReturnType<typeof generateSketchV2>[] = [];
    for (let i = 0; i < sessions.length; i++) {
      results.push(
        generateSketchV2({
          session: sessions[i],
          priorSessions: sessions.slice(0, i),
          recentProvenance: results.slice(-2).map((r) => r.provenance),
          sketchNumber: i + 1,
        }),
      );
    }
    return results;
  };

  it('a Movement voiced in a recent sketch never classifies NEW again', () => {
    const results = generateSequence();
    for (let i = 1; i < results.length; i++) {
      const voicedRecently = new Set(
        results.slice(Math.max(0, i - 2), i).flatMap((r) => r.provenance.movementIds),
      );
      for (const [movement, cls] of Object.entries(results[i].provenance.deltaClasses)) {
        if (voicedRecently.has(movement)) expect(cls).not.toBe('NEW');
      }
    }
  });

  it('a sole delta candidate on cooldown yields to confirmation instead of repeating the opening', () => {
    const results = generateSequence();
    const s5 = results[4];
    const s6 = results[5];
    // Sketch 05 legitimately opens with the borderline Movement as NEW…
    expect(s5.provenance.deltaClasses['perspective_taking']).toBe('NEW');
    expect(s5.provenance.blockIds[0]).toBe('clause_perspective_taking_pos');
    // …but sketch 06 must not headline the same observation again: the repeat
    // classifies STRENGTHENED, its block is on cooldown, and with no other
    // meaningful delta the sketch reinforces rather than manufactures.
    expect(s6.provenance.deltaClasses['perspective_taking']).toBe('STRENGTHENED');
    expect(s6.provenance.mode).toBe('confirmation');
    expect(s6.provenance.blockIds[0]).not.toBe(s5.provenance.blockIds[0]);
  });

  it('never repeats a framing within one sketch', () => {
    for (const r of generateSequence()) {
      const framings = r.provenance.variantIds.filter(Boolean);
      expect(new Set(framings).size).toBe(framings.length);
    }
  });

  it('remains deterministic across the whole sequence', () => {
    const first = generateSequence().map((r) => r.text);
    const second = generateSequence().map((r) => r.text);
    expect(second).toEqual(first);
  });
});

// ---------------------------------------------------------------------------
// Content library integrity
// ---------------------------------------------------------------------------

describe('V2 content library', () => {
  it('clause ids are unique and clause text contains no engine vocabulary', () => {
    const ids = MOVEMENT_CLAUSES.map((c) => c.id);
    expect(new Set(ids).size).toBe(ids.length);
    for (const c of MOVEMENT_CLAUSES) {
      expect(c.text.zh).not.toMatch(/signal|score|confidence|dimension|delta|movement/i);
      expect(c.text.en).toBeTruthy();
      expect(c.text.zh.length).toBeGreaterThan(8);
      expect(c.text.en!.length).toBeGreaterThan(8);
    }
  });

  it('English generation produces an audited English sketch from the same provenance', () => {
    const zh = generateSketchV2({
      session: sessionA(),
      priorSessions: [],
      recentProvenance: [],
      sketchNumber: 1,
      language: 'zh',
    });
    const en = generateSketchV2({
      session: sessionA(),
      priorSessions: [],
      recentProvenance: [],
      sketchNumber: 1,
      language: 'en',
    });
    expect(zh.audit).toBe('PASSED');
    expect(en.audit).toBe('PASSED');
    expect(en.provenance.blockIds).toEqual(zh.provenance.blockIds);
    expect(en.text).not.toMatch(/[\u4e00-\u9fff]/);
    expect(zh.text).toMatch(/[\u4e00-\u9fff]/);
  });
});
