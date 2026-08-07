import { describe, it, expect } from 'vitest';
import { isWeakHeartKey, generateHeartKey, formatHeartKey } from './heartKey';

describe('isWeakHeartKey', () => {
  it('rejects weak values', () => {
    for (const w of ['000000', '111111', '222222', '999999', '123456', '654321', '012345', '987654', '12345', 'abcdef']) {
      expect(isWeakHeartKey(w)).toBe(true);
    }
  });
  it('accepts normal keys', () => {
    for (const ok of ['432540', '080216', '314159', '271828']) {
      expect(isWeakHeartKey(ok)).toBe(false);
    }
  });
});

describe('generateHeartKey', () => {
  it('always returns a non-weak six-digit key', () => {
    for (let i = 0; i < 300; i++) {
      const k = generateHeartKey();
      expect(k).toMatch(/^\d{6}$/);
      expect(isWeakHeartKey(k)).toBe(false);
    }
  });
});

describe('formatHeartKey', () => {
  it('spaces a six-digit key as NNN NNN', () => {
    expect(formatHeartKey('432540')).toBe('432 540');
  });
});
