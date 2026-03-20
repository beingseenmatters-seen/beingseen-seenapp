import { describe, expect, it } from 'vitest';
import { getPolicyConfig, getSystemPromptInjection } from './questionGate';
import { getCognitiveFunctionForStyle, ResponseStyle } from '../types/responseStyle';

describe('AI role cognitive functions', () => {
  it('maps each response style to a distinct cognitive function', () => {
    expect(getCognitiveFunctionForStyle(ResponseStyle.MIRROR)).toBe('reflect');
    expect(getCognitiveFunctionForStyle(ResponseStyle.ORGANIZER)).toBe('structure');
    expect(getCognitiveFunctionForStyle(ResponseStyle.EXPRESSION_HELP)).toBe('expression');
    expect(getCognitiveFunctionForStyle(ResponseStyle.GUIDE)).toBe('exploration');
  });

  it('keeps organizer as a pure structuring role without questions', () => {
    const organizerConfig = getPolicyConfig(ResponseStyle.ORGANIZER);

    expect(organizerConfig.maxQuestionsPerTurn).toBe(0);
    expect(organizerConfig.allowedQuestionTypes).toEqual(['none']);
    expect(organizerConfig.outputStructure).toContain('逻辑链');
  });

  it('uses role prompts aligned with the four cognitive behaviors', () => {
    expect(getSystemPromptInjection(ResponseStyle.MIRROR, 'no_questions')).toContain('你是“镜子”');
    expect(getSystemPromptInjection(ResponseStyle.ORGANIZER, 'no_questions')).toContain('你是“整理者”');
    expect(getSystemPromptInjection(ResponseStyle.EXPRESSION_HELP, 'light')).toContain('你是“表达辅助”');
    expect(getSystemPromptInjection(ResponseStyle.GUIDE, 'light')).toContain('你是“引导者”');
  });
});
