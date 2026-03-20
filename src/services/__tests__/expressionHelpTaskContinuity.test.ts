/**
 * EXPRESSION_HELP 任务承接不断线 - 单元测试
 * 
 * 测试目标（P0）：
 * - 用户已给过要点后，说"就是我刚才说的1.2.3.4点"时，AI 必须直接产出
 * - 禁止再次进入澄清循环
 * - keepContext=ON 时绝不能像"失忆"一样要求用户复述
 */

import { describe, it, expect } from 'vitest';
import { ResponseStyle, type UserStateAnalysis } from '../../types/responseStyle';
import {
  analyzeUserState,
  isTaskAlreadySpecified,
  isUserClosingSignal,
  hasRequestContentPattern,
  checkAssistantDraft,
  getPolicyConfig
} from '../questionGate';

// 辅助函数：创建模拟的用户状态
function createUserState(overrides: Partial<UserStateAnalysis> = {}): UserStateAnalysis {
  return {
    isDistressed: false,
    isAskingForDeepDive: false,
    isTaskAlreadySpecified: false,
    isUserClosingSignal: false,
    distressedKeywords: [],
    deepDiveKeywords: [],
    taskSpecifiedKeywords: [],
    closingSignalKeywords: [],
    contextSufficient: false,
    ...overrides
  };
}

describe('EXPRESSION_HELP 任务承接不断线', () => {
  
  // ========================
  // 测试 1: EXPRESSION_HELP + user: "就是我刚才说的1.2.3.4点"
  // => assistant 不得出现"请把内容发给我/具体内容是/能再说"
  // ========================
  describe('测试 1: 用户说"就是我刚才说的1.2.3.4点"', () => {
    it('应该检测到 isTaskAlreadySpecified=true', () => {
      const result = isTaskAlreadySpecified('就是我刚才说的1.2.3.4点', []);
      expect(result.isSpecified).toBe(true);
      expect(result.keywords.length).toBeGreaterThan(0);
    });

    it('应该检测"按你理解的"为任务已指定', () => {
      const result = isTaskAlreadySpecified('按你理解的写一段', []);
      expect(result.isSpecified).toBe(true);
    });

    it('应该检测"帮我润色一下"为任务已指定', () => {
      const result = isTaskAlreadySpecified('帮我润色一下', []);
      expect(result.isSpecified).toBe(true);
    });

    it('英文: "as you understood" 应该触发 isTaskAlreadySpecified', () => {
      const result = isTaskAlreadySpecified('just as you understood it', []);
      expect(result.isSpecified).toBe(true);
    });
  });

  // ========================
  // 测试 2: EXPRESSION_HELP + isTaskAlreadySpecified=true + draft 含问号
  // => rewrite 后无问号且直接产出成稿
  // ========================
  describe('测试 2: 任务已指定时 draft 含问号应触发 force_generate', () => {
    it('draft 含问号时应返回 action=force_generate', () => {
      const config = getPolicyConfig(ResponseStyle.EXPRESSION_HELP);
      const userState = createUserState({
        isTaskAlreadySpecified: true,
        taskSpecifiedKeywords: ['就是我刚才说的']
      });
      
      const draftWithQuestion = '好的，你刚才提到的1.2.3.4点具体内容是什么？';
      const check = checkAssistantDraft(
        draftWithQuestion,
        userState,
        config,
        0,
        ResponseStyle.EXPRESSION_HELP
      );
      
      expect(check.ok).toBe(false);
      expect(check.action).toBe('force_generate');
      expect(check.reasons.some(r => r.includes('任务已指定'))).toBe(true);
    });

    it('draft 含"请把内容发给我"应触发 force_generate', () => {
      const config = getPolicyConfig(ResponseStyle.EXPRESSION_HELP);
      const userState = createUserState({
        isTaskAlreadySpecified: true,
        taskSpecifiedKeywords: ['刚才那几点']
      });
      
      const badDraft = '好的，请把需要整理的内容发给我。';
      const check = checkAssistantDraft(
        badDraft,
        userState,
        config,
        0,
        ResponseStyle.EXPRESSION_HELP
      );
      
      expect(check.ok).toBe(false);
      expect(check.action).toBe('force_generate');
    });
  });

  // ========================
  // 测试 3: keepContext=ON + recentTurns 含 assistant 总结
  // => user "按你理解的" => 直接生成，不索要复述
  // ========================
  describe('测试 3: keepContext=ON 上下文足够时直接生成', () => {
    it('recentTurns 含 AI 总结时，contextSufficient 应为 true', () => {
      const recentTurns = [
        { role: 'user' as const, text: '我想和领导说涨薪的事，主要有几点：1. 工作三年了 2. 业绩不错 3. 市场薪资涨了' },
        { role: 'ai' as const, text: '我听到你提到了三个要点：工作年限、业绩表现、市场薪资水平。' }
      ];
      
      const result = isTaskAlreadySpecified('按你理解的帮我写一段', recentTurns);
      expect(result.isSpecified).toBe(true);
      expect(result.contextSufficient).toBe(true);
    });

    it('用户曾给过列表时，contextSufficient 应为 true', () => {
      const recentTurns = [
        { role: 'user' as const, text: '1. 工作量大 2. 加班多 3. 薪资不匹配' },
        { role: 'ai' as const, text: '好的，我来帮你整理。' }
      ];
      
      const result = isTaskAlreadySpecified('就按这个写', recentTurns);
      expect(result.contextSufficient).toBe(true);
    });

    it('contextSufficient=true 时，draft 含问号应触发 force_generate', () => {
      const config = getPolicyConfig(ResponseStyle.EXPRESSION_HELP);
      const userState = createUserState({
        isTaskAlreadySpecified: true,
        contextSufficient: true,
        taskSpecifiedKeywords: ['按你理解的']
      });
      
      const draftWithQuestion = '好的，你是想发给谁呢？';
      const check = checkAssistantDraft(
        draftWithQuestion,
        userState,
        config,
        0,
        ResponseStyle.EXPRESSION_HELP
      );
      
      expect(check.ok).toBe(false);
      expect(check.action).toBe('force_generate');
    });
  });

  // ========================
  // 测试 4: closingSignal: "这个可以"
  // => assistant 只收尾，不问"这个指什么"
  // ========================
  describe('测试 4: 用户收尾信号', () => {
    it('"这个可以" 应触发 isUserClosingSignal=true', () => {
      const result = isUserClosingSignal('这个可以');
      expect(result.isClosing).toBe(true);
      expect(result.keywords).toContain('这个可以');
    });

    it('"就这样" 应触发收尾信号', () => {
      const result = isUserClosingSignal('就这样');
      expect(result.isClosing).toBe(true);
    });

    it('"OK" 应触发收尾信号', () => {
      const result = isUserClosingSignal('OK');
      expect(result.isClosing).toBe(true);
    });

    it('英文 "looks good" 应触发收尾信号', () => {
      const result = isUserClosingSignal('looks good');
      expect(result.isClosing).toBe(true);
    });

    it('收尾信号时 draft 含问号应返回 action=force_close', () => {
      const config = getPolicyConfig(ResponseStyle.EXPRESSION_HELP);
      const userState = createUserState({
        isUserClosingSignal: true,
        closingSignalKeywords: ['这个可以']
      });
      
      const draftWithQuestion = '好的，你说的"这个"具体是指哪个版本呢？';
      const check = checkAssistantDraft(
        draftWithQuestion,
        userState,
        config,
        0,
        ResponseStyle.EXPRESSION_HELP
      );
      
      expect(check.ok).toBe(false);
      expect(check.action).toBe('force_close');
      expect(check.reasons.some(r => r.includes('收尾信号'))).toBe(true);
    });

    it('收尾信号时即使 draft 无问号也返回 action=force_close', () => {
      const config = getPolicyConfig(ResponseStyle.EXPRESSION_HELP);
      const userState = createUserState({
        isUserClosingSignal: true,
        closingSignalKeywords: ['OK']
      });
      
      const goodDraft = '好的，你可以直接发这段。';
      const check = checkAssistantDraft(
        goodDraft,
        userState,
        config,
        0,
        ResponseStyle.EXPRESSION_HELP
      );
      
      expect(check.action).toBe('force_close');
    });
  });

  // ========================
  // 测试 5: ORGANIZER 不受此规则影响（不触发 force_generate，但自身也不提问）
  // ========================
  describe('测试 5: ORGANIZER 模式不受 EXPRESSION_HELP 规则影响', () => {
    it('ORGANIZER 模式下即使 isTaskAlreadySpecified=true 也不会触发 force_generate，而是按自身规则改写', () => {
      const config = getPolicyConfig(ResponseStyle.ORGANIZER);
      const userState = createUserState({
        isTaskAlreadySpecified: true,
        taskSpecifiedKeywords: ['按你理解的']
      });
      
      const draftWithOneQuestion = '你提到了三个要点。你希望我重点展开哪一个？';
      const check = checkAssistantDraft(
        draftWithOneQuestion,
        userState,
        config,
        0,
        ResponseStyle.ORGANIZER
      );
      
      // ORGANIZER 不应用 EXPRESSION_HELP 的规则
      expect(check.action).not.toBe('force_generate');
      expect(check.questionCount).toBe(1);
      // 但 ORGANIZER 现在本身就是纯结构化角色，不允许提问
      expect(check.action).toBe('rewrite');
      expect(check.ok).toBe(false);
    });
  });

  // ========================
  // 测试 6: GUIDE 不受此规则影响（仍按授权规则）
  // ========================
  describe('测试 6: GUIDE 模式不受 EXPRESSION_HELP 规则影响', () => {
    it('GUIDE 模式下 isTaskAlreadySpecified 不触发 force_generate', () => {
      const config = getPolicyConfig(ResponseStyle.GUIDE);
      const userState = createUserState({
        isTaskAlreadySpecified: true,
        taskSpecifiedKeywords: ['就是我刚才说的']
      });
      
      const draftWithQuestion = '你希望我继续深入这个点吗？';
      const check = checkAssistantDraft(
        draftWithQuestion,
        userState,
        config,
        0,
        ResponseStyle.GUIDE
      );
      
      // GUIDE 不应用 EXPRESSION_HELP 的规则
      expect(check.action).not.toBe('force_generate');
    });

    it('GUIDE 授权深挖后允许 2 个问题', () => {
      const config = getPolicyConfig(ResponseStyle.GUIDE);
      const userState = createUserState({
        isAskingForDeepDive: true,
        deepDiveKeywords: ['继续深挖']
      });
      
      const draftWithTwoQuestions = '你为什么会这样想？这让你有什么感受？';
      const check = checkAssistantDraft(
        draftWithTwoQuestions,
        userState,
        config,
        0,
        ResponseStyle.GUIDE
      );
      
      // 授权后 2 问在限制内
      expect(check.questionCount).toBe(2);
    });
  });

  // ========================
  // 额外测试：hasRequestContentPattern
  // ========================
  describe('hasRequestContentPattern 检测', () => {
    it('应检测到"请把需要整理的内容发给我"', () => {
      const result = hasRequestContentPattern('请把需要整理的内容发给我');
      expect(result.hasPattern).toBe(true);
    });

    it('应检测到"能再说详细一点吗"', () => {
      const result = hasRequestContentPattern('能再说详细一点吗？');
      expect(result.hasPattern).toBe(true);
    });

    it('应检测到英文 "can you elaborate"', () => {
      const result = hasRequestContentPattern('Can you elaborate on that?');
      expect(result.hasPattern).toBe(true);
    });

    it('正常回复不应触发', () => {
      const result = hasRequestContentPattern('好的，这是一段可以直接发的话：...');
      expect(result.hasPattern).toBe(false);
    });
  });

  // ========================
  // 额外测试：analyzeUserState 整合
  // ========================
  describe('analyzeUserState 整合测试', () => {
    it('完整分析"就是我刚才说的1.2.3.4点"', () => {
      const recentTurns = [
        { role: 'user' as const, text: '1. 点一 2. 点二 3. 点三 4. 点四' },
        { role: 'ai' as const, text: '你提到了四个要点...' }
      ];
      
      const state = analyzeUserState('就是我刚才说的1.2.3.4点', recentTurns);
      
      expect(state.isTaskAlreadySpecified).toBe(true);
      expect(state.contextSufficient).toBe(true);
      expect(state.isDistressed).toBe(false);
      expect(state.isUserClosingSignal).toBe(false);
    });

    it('完整分析"这个可以，谢谢"', () => {
      const state = analyzeUserState('这个可以，谢谢', []);
      
      expect(state.isUserClosingSignal).toBe(true);
      expect(state.closingSignalKeywords?.length).toBeGreaterThan(0);
    });
  });
});
