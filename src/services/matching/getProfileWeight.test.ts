import { describe, expect, it } from 'vitest';
import { calculateBasicContextSimilarity } from './getProfileWeight';

describe('calculateBasicContextSimilarity (T-102)', () => {
  it('ignores age, location, gender, and zodiac', () => {
    const demographicsOnly = {
      age: '25-34',
      location: 'Shanghai',
      gender: 'woman',
      zodiac: 'virgo',
    };

    const result = calculateBasicContextSimilarity(demographicsOnly, {
      age: '45-54',
      location: 'Beijing',
      gender: 'man',
      zodiac: 'aries',
    });

    expect(result.hasData).toBe(false);
    expect(result.score).toBe(0);
  });

  it('scores matching currentState only', () => {
    const match = calculateBasicContextSimilarity(
      { currentState: 'transition', age: '25-34' },
      { currentState: 'transition', age: '55-64' },
    );
    expect(match.hasData).toBe(true);
    expect(match.score).toBe(1);

    const mismatch = calculateBasicContextSimilarity(
      { currentState: 'transition' },
      { currentState: 'stable' },
    );
    expect(mismatch.hasData).toBe(true);
    expect(mismatch.score).toBe(0);
  });
});
