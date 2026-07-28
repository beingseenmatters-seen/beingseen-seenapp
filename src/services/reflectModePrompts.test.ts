/**
 * Contract tests for the backend prompt layer (lambda/reflectModes.mjs) —
 * the exact module the Lambda handler and the local dev adapter execute.
 *
 * These test meaningful contract fragments and normalisation behaviour, not
 * brittle full-prompt snapshots.
 */
import { describe, expect, it } from 'vitest';
import {
  CANONICAL_MODES,
  normalizeResponseMode,
  resolveRequestMode,
  toLegacyModeField,
  buildModeInstructions,
  analyzeUserText,
} from '../../lambda/reflectModes.mjs';

const calm = { isDistressed: false };

describe('backend mode normalisation', () => {
  it('exposes the six canonical modes', () => {
    expect(CANONICAL_MODES).toEqual(['reflect', 'untangle', 'express', 'connect', 'discover', 'explore']);
  });

  it('explore is canonical and never falls back to another mode', () => {
    expect(normalizeResponseMode('explore')).toBe('explore');
  });

  it('maps every legacy value through the approved mapping', () => {
    expect(normalizeResponseMode('mirror')).toBe('reflect');
    expect(normalizeResponseMode('organizer')).toBe('untangle');
    expect(normalizeResponseMode('helper')).toBe('express');
    expect(normalizeResponseMode('expression_help')).toBe('express');
    expect(normalizeResponseMode('expression')).toBe('express');
    expect(normalizeResponseMode('guide')).toBe('discover');
  });

  it('unknown values fall back to reflect', () => {
    expect(normalizeResponseMode('bogus')).toBe('reflect');
    expect(normalizeResponseMode(undefined)).toBe('reflect');
    expect(normalizeResponseMode(7)).toBe('reflect');
  });

  it('frontend TS mapping and backend mapping agree', async () => {
    const ts = await import('../types/responseMode');
    for (const value of [
      'mirror', 'organizer', 'helper', 'expression_help', 'guide',
      'reflect', 'untangle', 'express', 'connect', 'discover', 'explore', 'junk',
    ]) {
      expect(normalizeResponseMode(value)).toBe(ts.normalizeResponseMode(value));
    }
  });
});

describe('released-client request compatibility (resolveRequestMode)', () => {
  it('prefers canonical responseMode when present', () => {
    expect(resolveRequestMode({ responseMode: 'connect', responseStyle: 'mirror' })).toBe('connect');
    expect(resolveRequestMode({ responseMode: 'explore', responseStyle: 'mirror' })).toBe('explore');
    expect(resolveRequestMode({ responseMode: 'explore' })).toBe('explore');
  });

  it('released mobile clients sending legacy responseStyle keep working', () => {
    expect(resolveRequestMode({ responseStyle: 'mirror' })).toBe('reflect');
    expect(resolveRequestMode({ responseStyle: 'organizer' })).toBe('untangle');
    expect(resolveRequestMode({ responseStyle: 'helper' })).toBe('express');
    expect(resolveRequestMode({ responseStyle: 'guide' })).toBe('discover');
  });

  it('oldest clients sending legacy mode keep working', () => {
    expect(resolveRequestMode({ mode: 'expression' })).toBe('express');
    expect(resolveRequestMode({ mode: 'mirror' })).toBe('reflect');
  });

  it('missing or invalid mode falls back to reflect', () => {
    expect(resolveRequestMode({})).toBe('reflect');
    expect(resolveRequestMode({ responseStyle: 'weird' })).toBe('reflect');
  });

  it('legacy response field vocabulary is preserved for old clients', () => {
    expect(toLegacyModeField('reflect')).toBe('mirror');
    expect(toLegacyModeField('untangle')).toBe('organizer');
    expect(toLegacyModeField('express')).toBe('expression');
    expect(toLegacyModeField('discover')).toBe('guide');
    expect(toLegacyModeField('connect')).toBe('connect');
    expect(toLegacyModeField('explore')).toBe('explore');
  });
});

describe('mode-specific prompt contracts (zh)', () => {
  it('all six modes produce genuinely different instructions', () => {
    const prompts = CANONICAL_MODES.map((m: string) => buildModeInstructions(m, 'zh', calm));
    expect(new Set(prompts).size).toBe(6);
  });

  it('every mode shares the universal layer (mirror-not-oracle, no diagnosis, no fixed labels)', () => {
    for (const mode of CANONICAL_MODES) {
      const p = buildModeInstructions(mode, 'zh', calm);
      expect(p).toContain('思考伙伴');
      expect(p).toContain('不诊断用户');
      expect(p).toContain('不对第三方的动机下定论');
      expect(p).toContain('不连环追问');
      expect(p).toContain('用户永远可以拒绝你给出的任何解读');
    }
  });

  it('the mode instruction applies per-turn: earlier turns in another mode must not be imitated (Phase 2C)', () => {
    for (const mode of CANONICAL_MODES) {
      const zh = buildModeInstructions(mode, 'zh', calm);
      expect(zh).toContain('严格按照"本次回复"所选的回应方式来回应');
      expect(zh).toContain('不要模仿');
      const en = buildModeInstructions(mode, 'en', calm);
      expect(en).toContain('Follow the response mode selected for THIS response');
      expect(en).toContain('do not imitate their style when it conflicts with the current mode');
    }
  });

  it('REFLECT does not default to advice or questions', () => {
    const p = buildModeInstructions('reflect', 'zh', calm);
    expect(p).toContain('被准确地听见');
    expect(p).toContain('不急着给建议');
    expect(p).toContain('默认不提问');
    expect(p).toContain('短的回应往往更好');
  });

  it('UNTANGLE separates facts, feelings and choices', () => {
    const p = buildModeInstructions('untangle', 'zh', calm);
    expect(p).toContain('事实');
    expect(p).toContain('情绪');
    expect(p).toContain('选择');
    expect(p).toContain('不替用户做决定');
    expect(p).toContain('最多问一个澄清问题');
  });

  it('EXPRESS prioritises usable wording over interpretation', () => {
    const p = buildModeInstructions('express', 'zh', calm);
    expect(p).toContain('可以直接使用的语言');
    expect(p).toContain('保留用户的本意');
    expect(p).toContain('三个语气明显不同的版本');
    expect(p).toContain('不做不必要的解读');
    expect(p).toContain('直接先给一版草稿');
  });

  it('CONNECT never claims third-party motives as facts', () => {
    const p = buildModeInstructions('connect', 'zh', calm);
    expect(p).toContain('绝不能说成事实');
    expect(p).toContain('可能');
    expect(p).toContain('不预设每段关系都应该维持');
    expect(p).toContain('权力差距');
  });

  it('DISCOVER frames interpretations as hypotheses, opening not corrective', () => {
    const p = buildModeInstructions('discover', 'zh', calm);
    expect(p).toContain('假设');
    expect(p).toContain('也许');
    expect(p).toContain('不把单一事件放大成人格判断');
    expect(p).toContain('打开');
    expect(p).toContain('不是"纠正"');
  });

  it('EXPLORE analyses real problems collaboratively and offers practical next steps', () => {
    const p = buildModeInstructions('explore', 'zh', calm);
    expect(p).toContain('一起想想（EXPLORE）');
    expect(p).toContain('现实问题');
    expect(p).toContain('我们可以一起看看');
    expect(p).toContain('可行的选项或下一步');
    expect(p).toContain('不把假设说成定论');
    expect(p).toContain('不把每个话题都往关系分析上引');
    expect(p).toContain('只在缺少关键信息时才问');
  });

  it('EXPLORE and DISCOVER stay functionally distinct (perspective vs practical solution)', () => {
    const discover = buildModeInstructions('discover', 'zh', calm);
    const explore = buildModeInstructions('explore', 'zh', calm);
    expect(explore).not.toBe(discover);
    // DISCOVER opens another interpretation and never focuses on building solutions.
    expect(discover).toContain('另一种解读');
    expect(discover).not.toContain('可行的选项或下一步');
    // EXPLORE builds practical options and is not limited to relationships.
    expect(explore).toContain('可行的选项或下一步');
    expect(explore).toContain('工作、家庭、学业、职业、人生方向');
  });
});

describe('mode-specific prompt contracts (en)', () => {
  it('all five modes are distinct and carry their core contract', () => {
    const reflect = buildModeInstructions('reflect', 'en', calm);
    expect(reflect).toContain('accurately heard');
    expect(reflect).toContain('Ask no question by default');

    const untangle = buildModeInstructions('untangle', 'en', calm);
    expect(untangle).toContain('facts, interpretations, emotions, needs, tensions, and choices');
    expect(untangle).toContain('Do not make the decision for the user');

    const express = buildModeInstructions('express', 'en', calm);
    expect(express).toContain('usable language');
    expect(express).toContain('up to three clearly different tones');

    const connect = buildModeInstructions('connect', 'en', calm);
    expect(connect).toContain('Never present guesses about the other person as facts');
    expect(connect).toContain('power imbalance');

    const discover = buildModeInstructions('discover', 'en', calm);
    expect(discover).toContain('hypotheses, not conclusions');
    expect(discover).toContain('opening, not corrective');

    const explore = buildModeInstructions('explore', 'en', calm);
    expect(explore).toContain('Think it through together (EXPLORE)');
    expect(explore).toContain('practical problem');
    expect(explore).toContain('realistic, concrete options or next steps');
    expect(explore).toContain('never present assumptions as certainty');
  });
});

describe('distress override', () => {
  it('overrides every selected mode with the gentle safety layer', () => {
    for (const mode of CANONICAL_MODES) {
      const p = buildModeInstructions(mode, 'zh', { isDistressed: true });
      expect(p).toContain('情绪不稳');
      expect(p).toContain('不分析、不评判、不提问');
      // Mode-specific content must NOT survive the override.
      expect(p).not.toContain('当前回应方式');
    }
  });

  it('analyzeUserText detects distress signals used by the override', () => {
    expect(analyzeUserText('我快崩溃了').isDistressed).toBe(true);
    expect(analyzeUserText('I feel hopeless').isDistressed).toBe(true);
    expect(analyzeUserText('今天天气不错').isDistressed).toBe(false);
  });

  it('legacy modes get the new canonical prompt after normalisation', () => {
    expect(buildModeInstructions('mirror', 'zh', calm)).toBe(buildModeInstructions('reflect', 'zh', calm));
    expect(buildModeInstructions('guide', 'zh', calm)).toBe(buildModeInstructions('discover', 'zh', calm));
  });
});
