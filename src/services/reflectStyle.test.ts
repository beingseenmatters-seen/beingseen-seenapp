import { describe, expect, it } from 'vitest';
import { ResponseStyle } from '../types/responseStyle';
import { resolveResponseStyleForReflect } from './reflectStyle';

describe('resolveResponseStyleForReflect', () => {
  it('Reflect 未选 + Me=EXPRESSION_HELP + keepContext=OFF => EXPRESSION_HELP', () => {
    expect(
      resolveResponseStyleForReflect({
        reflectSelectedStyle: undefined,
        meDefaultStyle: ResponseStyle.EXPRESSION_HELP,
        sessionStyle: undefined,
        keepContext: false,
        isNewSession: true
      })
    ).toBe(ResponseStyle.EXPRESSION_HELP);
  });

  it('Reflect 未选 + keepContext=ON + sessionStyle=ORGANIZER + Me=EXPRESSION_HELP + isNewSession=false => ORGANIZER (locked)', () => {
    expect(
      resolveResponseStyleForReflect({
        reflectSelectedStyle: undefined,
        meDefaultStyle: ResponseStyle.EXPRESSION_HELP,
        sessionStyle: ResponseStyle.ORGANIZER,
        keepContext: true,
        isNewSession: false
      })
    ).toBe(ResponseStyle.ORGANIZER);
  });

  it('Reflect 选了 GUIDE => GUIDE (overrides all)', () => {
    expect(
      resolveResponseStyleForReflect({
        reflectSelectedStyle: ResponseStyle.GUIDE,
        meDefaultStyle: ResponseStyle.EXPRESSION_HELP,
        sessionStyle: ResponseStyle.ORGANIZER,
        keepContext: true,
        isNewSession: false
      })
    ).toBe(ResponseStyle.GUIDE);
  });

  it('Me 未设置 + Reflect 未选 => MIRROR', () => {
    expect(
      resolveResponseStyleForReflect({
        reflectSelectedStyle: undefined,
        meDefaultStyle: undefined,
        sessionStyle: undefined,
        keepContext: false,
        isNewSession: true
      })
    ).toBe(ResponseStyle.MIRROR);
  });
});


