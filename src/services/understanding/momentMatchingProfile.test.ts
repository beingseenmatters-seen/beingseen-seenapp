/**
 * Moment matching profile — cross-session aggregation from durable evidence.
 */
import { describe, expect, it } from 'vitest';
import {
  buildMomentProfileFromEvidence,
  isMomentReady,
  MIN_MOMENT_MOVEMENTS,
} from './momentMatchingProfile';
import type { UnderstandingEvidence } from '../../types/evidence';

/** Minimal moment evidence item carrying just what the builder reads. */
function ev(
  movementId: string,
  direction: number,
  strength: number,
  mappingConfidence: number,
  over: Partial<UnderstandingEvidence> = {},
): UnderstandingEvidence {
  return {
    id: `ev_${movementId}_${Math.abs(direction)}_${strength}`,
    source: 'moment',
    movementId,
    direction,
    strength,
    mappingConfidence,
    lifecycleStatus: 'active',
    ...over,
  } as unknown as UnderstandingEvidence;
}

describe('buildMomentProfileFromEvidence', () => {
  it('keeps movements above the meaningful bar and drops weak ones', () => {
    const profile = buildMomentProfileFromEvidence([
      ev('direct_expression', 0.8, 0.8, 0.9), // support .72, |dir| .8 → meaningful
      ev('trust_openness', 0.6, 0.7, 0.9), // support .63 → meaningful
      ev('structure_seeking', 0.9, 0.1, 0.2), // support .02 < 0.09 → dropped
      ev('boundary_preservation', 0.2, 0.8, 0.9), // |dir| .2 < 0.35 → dropped
    ]);

    const ids = profile.movements.map((m) => m.movementId).sort();
    expect(ids).toEqual(['direct_expression', 'trust_openness']);
    expect(profile.meaningfulCount).toBe(2);
    expect(profile.movements.every((m) => m.weight > 0 && m.weight <= 1)).toBe(true);
  });

  it('aggregates repeated evidence for a movement (support-weighted direction)', () => {
    // Two sessions both positive on the same movement → stays positive, reinforced.
    const profile = buildMomentProfileFromEvidence([
      ev('meaning_orientation', 0.9, 0.8, 0.9),
      ev('meaning_orientation', 0.7, 0.6, 0.9),
    ]);
    const m = profile.movements.find((x) => x.movementId === 'meaning_orientation');
    expect(m).toBeDefined();
    expect(m!.direction).toBeGreaterThan(0.35);
    expect(profile.meaningfulCount).toBe(1);
  });

  it('ignores withdrawn/expired and non-moment evidence', () => {
    const profile = buildMomentProfileFromEvidence([
      ev('direct_expression', 0.8, 0.8, 0.9, { lifecycleStatus: 'withdrawn' }),
      ev('trust_openness', 0.8, 0.8, 0.9, { source: 'reflect' } as Partial<UnderstandingEvidence>),
      ev('autonomy_orientation', 0.8, 0.8, 0.9),
    ]);
    expect(profile.movements.map((m) => m.movementId)).toEqual(['autonomy_orientation']);
  });

  it('isMomentReady requires the minimum meaningful movements', () => {
    const one = buildMomentProfileFromEvidence([ev('direct_expression', 0.8, 0.8, 0.9)]);
    const two = buildMomentProfileFromEvidence([
      ev('direct_expression', 0.8, 0.8, 0.9),
      ev('trust_openness', 0.8, 0.8, 0.9),
    ]);
    expect(MIN_MOMENT_MOVEMENTS).toBe(2);
    expect(isMomentReady(one)).toBe(false);
    expect(isMomentReady(two)).toBe(true);
  });
});
