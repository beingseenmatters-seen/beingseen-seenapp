/**
 * Connection Origin (同频遇见) — classification, guard, and copy coverage.
 */
import { describe, expect, it } from 'vitest';
import { classifyOrigin } from '../../lambda/resonance.mjs';
import {
  asConnectionOrigin,
  connectionOriginExplanationKey,
  connectionOriginTagKey,
  type ConnectionOrigin,
} from './connectionOrigin';
import zh from '../i18n/zh.json';
import en from '../i18n/en.json';

describe('classifyOrigin (server, explainability only)', () => {
  it('classifies from the two channel scores', () => {
    expect(classifyOrigin(0.5, 0.5)).toBe('both');
    expect(classifyOrigin(0, 0.5)).toBe('moment');
    expect(classifyOrigin(0.5, 0)).toBe('reflect');
    expect(classifyOrigin(0, 0)).toBe('none');
  });
});

describe('asConnectionOrigin (client guard)', () => {
  it('accepts the three real channels, rejects none/unknown/undefined', () => {
    expect(asConnectionOrigin('moment')).toBe('moment');
    expect(asConnectionOrigin('reflect')).toBe('reflect');
    expect(asConnectionOrigin('both')).toBe('both');
    expect(asConnectionOrigin('none')).toBeUndefined();
    expect(asConnectionOrigin(undefined)).toBeUndefined();
    expect(asConnectionOrigin('xyz')).toBeUndefined();
  });
});

describe('user-facing copy exists for every channel (zh + en)', () => {
  const origins: ConnectionOrigin[] = ['moment', 'reflect', 'both'];
  const get = (obj: Record<string, any>, dotted: string) =>
    dotted.split('.').reduce<any>((o, k) => (o == null ? undefined : o[k]), obj);

  it('branded title is present', () => {
    expect(get(zh, 'connection_origin.title')).toBe('同频遇见');
    expect(get(en, 'connection_origin.title')).toBeTruthy();
  });

  it('explanation + tag exist for each origin in both locales', () => {
    for (const origin of origins) {
      for (const locale of [zh, en]) {
        expect(get(locale, connectionOriginExplanationKey(origin))).toBeTruthy();
        expect(get(locale, connectionOriginTagKey(origin))).toBeTruthy();
      }
    }
  });

  it('the finalized zh emotional copy matches the founder decision', () => {
    expect(get(zh, 'connection_origin.moment.explanation')).toContain('生活中的选择');
    expect(get(zh, 'connection_origin.reflect.explanation')).toContain('理解世界的方式');
    expect(get(zh, 'connection_origin.both.explanation')).toContain('既有相似的生活选择');
    expect(get(zh, 'connection_origin.moment.tag')).toBe('生活场景');
    expect(get(zh, 'connection_origin.reflect.tag')).toBe('理解方式');
    expect(get(zh, 'connection_origin.both.tag')).toBe('共同形成');
  });
});
