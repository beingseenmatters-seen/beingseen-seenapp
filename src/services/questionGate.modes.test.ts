import { describe, expect, it } from 'vitest';
import { ResponseMode, RESPONSE_MODES } from '../types/responseMode';
import {
  MODE_QUESTION_POLICIES,
  getModePolicyConfig,
  resolveModeAndLevel,
  analyzeUserState,
} from './questionGate';

describe('question-gate policies for the six canonical modes', () => {
  it('every canonical mode has a policy', () => {
    for (const mode of RESPONSE_MODES) {
      expect(MODE_QUESTION_POLICIES[mode]).toBeDefined();
      expect(getModePolicyConfig(mode)).toBe(MODE_QUESTION_POLICIES[mode]);
    }
  });

  it('REFLECT: zero questions by default', () => {
    expect(MODE_QUESTION_POLICIES[ResponseMode.REFLECT].maxQuestionsPerTurn).toBe(0);
  });

  it('UNTANGLE: at most one clarifying question', () => {
    const config = MODE_QUESTION_POLICIES[ResponseMode.UNTANGLE];
    expect(config.maxQuestionsPerTurn).toBe(1);
    expect(config.allowedQuestionTypes).toContain('clarify');
    expect(config.requiresAuthorization).toBe(false);
  });

  it('EXPRESS: at most one scene question (audience/intention/tone)', () => {
    const config = MODE_QUESTION_POLICIES[ResponseMode.EXPRESS];
    expect(config.maxQuestionsPerTurn).toBe(1);
    expect(config.allowedQuestionTypes).toContain('scene');
  });

  it('CONNECT: at most one question for essential relationship context', () => {
    const config = MODE_QUESTION_POLICIES[ResponseMode.CONNECT];
    expect(config.maxQuestionsPerTurn).toBe(1);
    expect(config.requiresAuthorization).toBe(false);
  });

  it('DISCOVER: at most one exploratory question per turn', () => {
    expect(MODE_QUESTION_POLICIES[ResponseMode.DISCOVER].maxQuestionsPerTurn).toBe(1);
  });

  it('EXPLORE (一起想想): at most one clarifying question, no authorization needed', () => {
    const config = MODE_QUESTION_POLICIES[ResponseMode.EXPLORE];
    expect(config.maxQuestionsPerTurn).toBe(1);
    expect(config.allowedQuestionTypes).toContain('clarify');
    expect(config.requiresAuthorization).toBe(false);
  });

  it('no mode allows more than one question per turn — no interview chains', () => {
    for (const mode of RESPONSE_MODES) {
      expect(MODE_QUESTION_POLICIES[mode].maxQuestionsPerTurn).toBeLessThanOrEqual(1);
    }
  });
});

describe('resolveModeAndLevel', () => {
  const calmState = analyzeUserState('今天想聊聊工作上的一个决定');
  const distressedState = analyzeUserState('我快崩溃了，撑不住了');
  const deepDiveState = analyzeUserState('继续深挖，往下问');

  it('REFLECT resolves to no_questions by default', () => {
    const result = resolveModeAndLevel(ResponseMode.REFLECT, calmState);
    expect(result).toMatchObject({ mode: ResponseMode.REFLECT, level: 'no_questions', downgraded: false });
  });

  it('UNTANGLE / EXPRESS / CONNECT / EXPLORE resolve to light questioning', () => {
    for (const mode of [ResponseMode.UNTANGLE, ResponseMode.EXPRESS, ResponseMode.CONNECT, ResponseMode.EXPLORE]) {
      const result = resolveModeAndLevel(mode, calmState);
      expect(result).toMatchObject({ mode, level: 'light', downgraded: false });
    }
  });

  it('DISCOVER resolves to light by default and deep only with explicit authorization', () => {
    expect(resolveModeAndLevel(ResponseMode.DISCOVER, calmState).level).toBe('light');
    expect(resolveModeAndLevel(ResponseMode.DISCOVER, deepDiveState).level).toBe('deep');
  });

  it('distress override outranks every mode: DISCOVER downgrades to REFLECT', () => {
    const result = resolveModeAndLevel(ResponseMode.DISCOVER, distressedState);
    expect(result.mode).toBe(ResponseMode.REFLECT);
    expect(result.level).toBe('no_questions');
    expect(result.downgraded).toBe(true);
  });

  it('distress override forces no_questions in all other modes without changing the mode', () => {
    for (const mode of [ResponseMode.REFLECT, ResponseMode.UNTANGLE, ResponseMode.EXPRESS, ResponseMode.CONNECT, ResponseMode.EXPLORE]) {
      const result = resolveModeAndLevel(mode, distressedState);
      expect(result.mode).toBe(mode);
      expect(result.level).toBe('no_questions');
    }
  });

  it('distress override wins even when the user also authorizes deep dive', () => {
    const conflicted = analyzeUserState('我快崩溃了，但你继续深挖，往下问');
    const result = resolveModeAndLevel(ResponseMode.DISCOVER, conflicted);
    expect(result.mode).toBe(ResponseMode.REFLECT);
    expect(result.level).toBe('no_questions');
  });
});
