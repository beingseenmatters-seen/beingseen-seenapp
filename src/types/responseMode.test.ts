import { describe, expect, it } from 'vitest';
import {
  ResponseMode,
  RESPONSE_MODES,
  isResponseModeType,
  tryNormalizeResponseMode,
  normalizeResponseMode,
  toLegacyResponseStyle,
  toLegacySelectedMode,
  fromLegacySelectedMode,
} from './responseMode';

describe('canonical ResponseMode model', () => {
  it('exposes exactly the five canonical values', () => {
    expect(RESPONSE_MODES).toEqual(['reflect', 'untangle', 'express', 'connect', 'discover']);
    expect(ResponseMode.REFLECT).toBe('reflect');
    expect(ResponseMode.UNTANGLE).toBe('untangle');
    expect(ResponseMode.EXPRESS).toBe('express');
    expect(ResponseMode.CONNECT).toBe('connect');
    expect(ResponseMode.DISCOVER).toBe('discover');
  });

  it('isResponseModeType accepts only canonical values', () => {
    for (const mode of RESPONSE_MODES) expect(isResponseModeType(mode)).toBe(true);
    for (const legacy of ['mirror', 'organizer', 'helper', 'expression_help', 'guide', '', null, undefined, 3]) {
      expect(isResponseModeType(legacy)).toBe(false);
    }
  });
});

describe('legacy normalisation (approved mapping)', () => {
  it('mirror → reflect', () => {
    expect(normalizeResponseMode('mirror')).toBe(ResponseMode.REFLECT);
  });

  it('organizer → untangle', () => {
    expect(normalizeResponseMode('organizer')).toBe(ResponseMode.UNTANGLE);
  });

  it('helper and expression_help → express', () => {
    expect(normalizeResponseMode('helper')).toBe(ResponseMode.EXPRESS);
    expect(normalizeResponseMode('expression_help')).toBe(ResponseMode.EXPRESS);
    expect(normalizeResponseMode('expression')).toBe(ResponseMode.EXPRESS);
  });

  it('guide → discover', () => {
    expect(normalizeResponseMode('guide')).toBe(ResponseMode.DISCOVER);
  });

  it('no legacy value maps to CONNECT', () => {
    for (const legacy of ['mirror', 'organizer', 'helper', 'expression_help', 'expression', 'guide']) {
      expect(normalizeResponseMode(legacy)).not.toBe(ResponseMode.CONNECT);
    }
  });

  it('canonical values pass through unchanged', () => {
    for (const mode of RESPONSE_MODES) expect(normalizeResponseMode(mode)).toBe(mode);
  });

  it('invalid or missing values fall back to REFLECT', () => {
    for (const bad of ['bogus', '', null, undefined, 42, {}, []]) {
      expect(normalizeResponseMode(bad)).toBe(ResponseMode.REFLECT);
    }
  });

  it('tryNormalizeResponseMode returns undefined for unknowns so callers can fall through', () => {
    expect(tryNormalizeResponseMode('bogus')).toBeUndefined();
    expect(tryNormalizeResponseMode(undefined)).toBeUndefined();
    expect(tryNormalizeResponseMode('guide')).toBe(ResponseMode.DISCOVER);
    expect(tryNormalizeResponseMode('connect')).toBe(ResponseMode.CONNECT);
  });
});

describe('legacy wire-format helpers', () => {
  it('toLegacyResponseStyle maps four modes back; CONNECT has no legacy value', () => {
    expect(toLegacyResponseStyle(ResponseMode.REFLECT)).toBe('mirror');
    expect(toLegacyResponseStyle(ResponseMode.UNTANGLE)).toBe('organizer');
    expect(toLegacyResponseStyle(ResponseMode.EXPRESS)).toBe('helper');
    expect(toLegacyResponseStyle(ResponseMode.DISCOVER)).toBe('guide');
    expect(toLegacyResponseStyle(ResponseMode.CONNECT)).toBeUndefined();
  });

  it('legacy numeric selectedMode round-trips through the mapping', () => {
    expect(fromLegacySelectedMode(0)).toBe(ResponseMode.REFLECT);
    expect(fromLegacySelectedMode(1)).toBe(ResponseMode.UNTANGLE);
    expect(fromLegacySelectedMode(2)).toBe(ResponseMode.DISCOVER);
    expect(fromLegacySelectedMode(3)).toBe(ResponseMode.EXPRESS);
    expect(fromLegacySelectedMode(null)).toBeUndefined();
    expect(fromLegacySelectedMode(99)).toBeUndefined();

    expect(toLegacySelectedMode(ResponseMode.REFLECT)).toBe(0);
    expect(toLegacySelectedMode(ResponseMode.UNTANGLE)).toBe(1);
    expect(toLegacySelectedMode(ResponseMode.DISCOVER)).toBe(2);
    expect(toLegacySelectedMode(ResponseMode.EXPRESS)).toBe(3);
    expect(toLegacySelectedMode(ResponseMode.CONNECT)).toBeNull();
  });
});
