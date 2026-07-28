import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import zh from './zh.json';
import en from './en.json';

type Dict = Record<string, Record<string, string>>;
const zhReflect = (zh as unknown as Dict).reflect;
const enReflect = (en as unknown as Dict).reflect;

describe('six-mode user-facing labels', () => {
  it('uses the approved Chinese titles and descriptions', () => {
    expect(zhReflect.mode_reflect_title).toBe('听见我');
    expect(zhReflect.mode_reflect_desc).toBe('先理解我的感受，不急着分析或建议');
    expect(zhReflect.mode_untangle_title).toBe('帮我理清');
    expect(zhReflect.mode_untangle_desc).toBe('把混在一起的事实、感受和选择理顺');
    expect(zhReflect.mode_express_title).toBe('帮我表达');
    expect(zhReflect.mode_express_desc).toBe('把我想说的话整理成自然、可使用的表达');
    expect(zhReflect.mode_connect_title).toBe('看懂关系');
    expect(zhReflect.mode_connect_desc).toBe('看见双方视角，找到更合适的沟通落点');
    expect(zhReflect.mode_discover_title).toBe('换个角度');
    expect(zhReflect.mode_discover_desc).toBe('温和指出我可能还没有看见的另一面');
  });

  it('uses the exact approved copy for 一起想想 (EXPLORE)', () => {
    expect(zhReflect.mode_explore_title).toBe('一起想想');
    expect(zhReflect.mode_explore_desc).toBe('一起聊聊生活中值得思考的事，看看有没有新的理解和方向。');
  });

  it('uses the approved English titles', () => {
    expect(enReflect.mode_reflect_title).toBe('Hear me');
    expect(enReflect.mode_untangle_title).toBe('Help me untangle');
    expect(enReflect.mode_express_title).toBe('Help me express it');
    expect(enReflect.mode_connect_title).toBe('Understand the relationship');
    expect(enReflect.mode_discover_title).toBe('Show me another angle');
    expect(enReflect.mode_explore_title).toBe('Think it through together');
    for (const mode of ['reflect', 'untangle', 'express', 'connect', 'discover', 'explore']) {
      expect(enReflect[`mode_${mode}_desc`]).toBeTruthy();
    }
  });

  it('keeps the control label 回应方式 / Response mode', () => {
    expect(zhReflect.mode_label).toBe('回应方式');
    expect(enReflect.mode_label).toBe('Response mode');
  });
});

describe('selector wiring', () => {
  it('the Reflect selector renders every canonical mode (EXPLORE included) from RESPONSE_MODES', async () => {
    const source = readFileSync(resolve(__dirname, '..', 'pages/Reflect.tsx'), 'utf8');
    // The dropdown maps over the canonical array with shared typography /
    // checkmark markup, so all six modes render identically and in order.
    expect(source).toContain('RESPONSE_MODES.map((mode) => ({');
    expect(source).toContain('t(`reflect.mode_${mode}_title`)');
    expect(source).toContain('t(`reflect.mode_${mode}_desc`)');
    const { RESPONSE_MODES } = await import('../types/responseMode');
    expect(RESPONSE_MODES).toContain('explore');
    expect(RESPONSE_MODES.indexOf('explore')).toBe(RESPONSE_MODES.indexOf('discover') + 1);
  });
});

describe('no legacy role terms in the active UI', () => {
  const read = (rel: string) =>
    readFileSync(resolve(__dirname, '..', rel), 'utf8');

  it('Reflect no longer renders the four legacy role labels or role options', () => {
    const source = read('pages/Reflect.tsx');
    for (const banned of [
      "t('reflect.opt_listen')",
      "t('reflect.opt_clarify')",
      "t('reflect.opt_blindspot')",
      "t('reflect.opt_polish')",
      '镜子',
      '整理者',
      '引导者',
      '表达辅助',
      'AI 角色',
      '默认角色',
    ]) {
      expect(source.includes(banned), `Reflect.tsx should not contain "${banned}"`).toBe(false);
    }
  });

  it('Sidebar has no default-role block', () => {
    const source = read('components/Sidebar.tsx');
    for (const banned of ['默认角色', 'Default Role', 'aiPreference']) {
      expect(source.includes(banned), `Sidebar.tsx should not contain "${banned}"`).toBe(false);
    }
  });

  it('Reflect chat bubbles no longer render internal question-gate metadata', () => {
    const source = read('pages/Reflect.tsx');
    // The old visible fragment looked like: [helper] Q:0 | new_session
    expect(source.includes('Q:{msg.debug')).toBe(false);
    expect(source.includes('msg.debug.questionGate.responseStyle')).toBe(false);
    // The internal debug panel must require the explicit opt-in flag.
    expect(source.includes("import.meta.env.VITE_REFLECT_DEBUG === 'on'")).toBe(true);
  });

  it('Reflect does not read soulProfile.aiPreference', () => {
    const source = read('pages/Reflect.tsx');
    expect(source.includes('aiPreference')).toBe(false);
  });
});
