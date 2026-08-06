import { describe, expect, it } from 'vitest';
import { resolveDataRegion, suggestRegionFromLocale } from './dataRegion';

describe('resolveDataRegion', () => {
  it('uses account.dataRegion when signed in', () => {
    const r = resolveDataRegion({
      isSignedIn: true,
      accountDataRegion: 'CN',
      suggestedRegion: 'GLOBAL',
      suggestionSource: 'locale',
    });
    expect(r).toEqual({ region: 'CN', source: 'account' });
  });

  it('does not let locale override account GLOBAL', () => {
    const r = resolveDataRegion({
      isSignedIn: true,
      accountDataRegion: 'GLOBAL',
      suggestedRegion: 'CN',
      suggestionSource: 'locale',
    });
    expect(r.region).toBe('GLOBAL');
    expect(r.source).toBe('account');
  });

  it('allows locale suggestion only when signed out', () => {
    const r = resolveDataRegion({
      isSignedIn: false,
      suggestedRegion: 'CN',
      suggestionSource: 'locale',
    });
    expect(r).toEqual({ region: 'CN', source: 'locale' });
  });

  it('defaults GLOBAL when signed in without dataRegion', () => {
    const r = resolveDataRegion({
      isSignedIn: true,
      accountDataRegion: null,
      suggestedRegion: 'CN',
    });
    expect(r).toEqual({ region: 'GLOBAL', source: 'default' });
  });
});

describe('suggestRegionFromLocale', () => {
  it('maps zh* to CN', () => {
    expect(suggestRegionFromLocale('zh')).toBe('CN');
    expect(suggestRegionFromLocale('zh-Hans-CN')).toBe('CN');
  });

  it('maps other locales to GLOBAL', () => {
    expect(suggestRegionFromLocale('en-US')).toBe('GLOBAL');
  });
});
