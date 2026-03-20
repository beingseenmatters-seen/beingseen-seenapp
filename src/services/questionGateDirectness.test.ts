import { describe, expect, it } from 'vitest';
import { analyzeUserState, checkAssistantDraft, getPolicyConfig } from './questionGate';
import { ResponseStyle } from '../types/responseStyle';

describe('questionGate direct-answer behavior', () => {
  it('detects precise direct mode requests', () => {
    const state = analyzeUserState('I am testing your reply. Respond exactly as I asked.', []);

    expect(state.prefersDirectMode).toBe(true);
    expect(state.directModeKeywords?.length).toBeGreaterThan(0);
  });

  it('detects explicit requests for analysis/opinion', () => {
    const state = analyzeUserState('你怎么看这件事？请分析一下。', []);

    expect(state.needsDirectAnswer).toBe(true);
    expect(state.directAnswerKeywords?.length).toBeGreaterThan(0);
  });

  it('rewrites passive mirroring when a direct answer is required', () => {
    const state = analyzeUserState('你怎么看这件事？请直接回答。', []);
    const config = getPolicyConfig(ResponseStyle.GUIDE);
    const check = checkAssistantDraft(
      '你似乎在寻找一个更清楚的判断。',
      state,
      config,
      0,
      ResponseStyle.GUIDE
    );

    expect(check.ok).toBe(false);
    expect(check.action).toBe('rewrite');
    expect(check.reasons.some(reason => reason.includes('直接回答'))).toBe(true);
  });
});
