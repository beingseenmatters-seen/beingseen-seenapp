/**
 * Developer diagnostics — proves the snapshot captures every pipeline stage:
 * Session → Signals → Movement Mapping → Evidence → momentProfile → momentReady
 * → Matching Eligibility.
 */
import { describe, expect, it } from 'vitest';
import type { MomentsSession } from '../../types/moments';
import { createMomentEvidenceFromSession } from './momentEvidence';
import { buildMomentProfileFromEvidence } from './momentMatchingProfile';
import { buildMomentPipelineDiagnostics } from './momentDiagnostics';

/** A completed 2-question session whose choices emit EXP-01 and TRU-01. */
function makeSession(): MomentsSession {
  return {
    id: 's1',
    status: 'completed',
    completedAt: 1000,
    updatedAt: 1000,
    momentIds: ['m1', 'm2'],
    momentVersions: {},
    sketch: { number: 1, text: 'x', generatedAt: 1000, engineVersion: 'sketch_v2', language: 'zh' },
    answers: {
      m1: { momentId: 'm1', selectedOptionIds: ['o1'], answeredAt: 1000 },
      m2: { momentId: 'm2', selectedOptionIds: ['o2'], answeredAt: 1000 },
    },
    snapshots: [
      { momentId: 'm1', options: [{ id: 'o1', signals: [{ signal: 'EXP-01', delta: 1, confidence: 'high' }] }] },
      { momentId: 'm2', options: [{ id: 'o2', signals: [{ signal: 'TRU-01', delta: 1, confidence: 'high' }] }] },
    ],
  } as unknown as MomentsSession;
}

describe('buildMomentPipelineDiagnostics', () => {
  it('captures all seven stages for a completed session', () => {
    const session = makeSession();
    const evidence = createMomentEvidenceFromSession(session, { userId: 'u1', now: '2026-08-08T00:00:00.000Z' });
    const profile = buildMomentProfileFromEvidence(evidence);

    const diag = buildMomentPipelineDiagnostics('u1', [session], profile);

    expect(diag.uid).toBe('u1');
    expect(diag.sessions).toHaveLength(1);
    const s = diag.sessions[0];

    // Stage 1→2: raw signals.
    expect(s.signals.map((x) => x.signal).sort()).toEqual(['EXP-01', 'TRU-01']);
    // Stage 2→3: movement mappings.
    const mapped = Object.fromEntries(s.mappings.map((m) => [m.signal, m.movementId]));
    expect(mapped['EXP-01']).toBe('direct_expression');
    expect(mapped['TRU-01']).toBe('trust_openness');
    // Stage 3: per-session aggregates.
    expect(s.aggregates.map((a) => a.movementId).sort()).toEqual(['direct_expression', 'trust_openness']);
    // Stage 4: evidence.
    expect(s.evidence.map((e) => e.id).sort()).toEqual([
      'ev_moment_s1_direct_expression',
      'ev_moment_s1_trust_openness',
    ]);

    // Stages 5–7: profile, readiness, eligibility.
    expect(diag.momentProfile.meaningfulCount).toBe(2);
    expect(diag.momentReady).toBe(true);
    expect(diag.matchingEligible).toBe(true);
    expect(diag.thresholds.minMovements).toBe(2);
  });
});
