/**
 * Moment channel resonance (server) + additive-combine sanity.
 * Imports the real matching engine so the Moment channel is verified exactly as
 * the Lambda runs it, and that the Reflect channel is untouched/independent.
 */
import { describe, expect, it } from 'vitest';
import {
  assembleMomentProfile,
  isMomentEligible,
  computeMomentResonance,
  assembleRIProfile,
  computeResonance,
} from '../../../lambda/resonance.mjs';

const mp = (movements: Array<{ movementId: string; direction: number; weight: number }>) => ({
  movements,
});

describe('Moment channel — eligibility', () => {
  it('needs at least two movements', () => {
    expect(isMomentEligible(assembleMomentProfile(mp([{ movementId: 'a', direction: 0.6, weight: 0.5 }])))).toBe(false);
    expect(
      isMomentEligible(
        assembleMomentProfile(
          mp([
            { movementId: 'direct_expression', direction: 0.6, weight: 0.5 },
            { movementId: 'trust_openness', direction: 0.7, weight: 0.6 },
          ]),
        ),
      ),
    ).toBe(true);
  });

  it('drops zero/negative weights when assembling', () => {
    const a = assembleMomentProfile(mp([{ movementId: 'x', direction: 0.9, weight: 0 }]));
    expect(a.movements).toHaveLength(0);
  });
});

describe('Moment channel — resonance', () => {
  it('shared movements in the SAME direction resonate', () => {
    const a = assembleMomentProfile(
      mp([
        { movementId: 'direct_expression', direction: 0.8, weight: 0.6 },
        { movementId: 'trust_openness', direction: 0.7, weight: 0.5 },
      ]),
    );
    const b = assembleMomentProfile(
      mp([
        { movementId: 'direct_expression', direction: 0.6, weight: 0.4 },
        { movementId: 'meaning_orientation', direction: 0.9, weight: 0.5 },
      ]),
    );
    const { momentScore, detail } = computeMomentResonance(a, b);
    expect(momentScore).toBeGreaterThan(0);
    expect(detail.sharedHits.map((h: { movementId: string }) => h.movementId)).toEqual(['direct_expression']);
  });

  it('opposite direction on the same movement does NOT resonate', () => {
    const a = assembleMomentProfile(mp([{ movementId: 'direct_expression', direction: 0.8, weight: 0.6 }]));
    const b = assembleMomentProfile(mp([{ movementId: 'direct_expression', direction: -0.8, weight: 0.6 }]));
    expect(computeMomentResonance(a, b).momentScore).toBe(0);
  });

  it('no shared movements → zero', () => {
    const a = assembleMomentProfile(mp([{ movementId: 'direct_expression', direction: 0.8, weight: 0.6 }]));
    const b = assembleMomentProfile(mp([{ movementId: 'meaning_orientation', direction: 0.8, weight: 0.6 }]));
    expect(computeMomentResonance(a, b).momentScore).toBe(0);
  });
});

describe('additive combine — progressive understanding', () => {
  it('a Moments-only pair scores on Moments alone (Reflect contributes 0)', () => {
    // No emergent traits → reflect resonance is 0, so rankingScore = momentScore.
    const reflect = computeResonance(assembleRIProfile([]), assembleRIProfile([])).resonanceScore;
    const a = assembleMomentProfile(mp([
      { movementId: 'direct_expression', direction: 0.8, weight: 0.6 },
      { movementId: 'trust_openness', direction: 0.7, weight: 0.6 },
    ]));
    const moment = computeMomentResonance(a, a).momentScore;
    expect(reflect).toBe(0);
    expect(moment).toBeGreaterThan(0);
    // The handler computes reflect + moment; here that equals the moment score.
    expect(reflect + moment).toBeGreaterThan(0);
  });
});
