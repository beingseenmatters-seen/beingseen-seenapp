/**
 * Question Gate 测试用例
 * 
 * 这些测试用例需要在后端项目中运行
 * 请将此文件复制到你的后端测试目录
 * 
 * 运行方式（以 Jest 为例）:
 *   npm test questionGate.test.ts
 * 
 * 或 Vitest:
 *   npx vitest run questionGate.test.ts
 */

// 注意：以下是测试用例的伪代码/规范
// 实际运行需要导入你后端的 Question Gate 模块

/*
import { describe, it, expect } from 'vitest'; // 或 jest
import {
  analyzeUserState,
  getPolicyConfig,
  checkAssistantDraft,
  countQuestions,
  checkForbiddenPatterns,
  ResponseStyle
} from './questionGate';

// ========================
// 测试 1: MIRROR 模式 - 任何问句都会被标记
// ========================
describe('MIRROR mode', () => {
  it('should flag any question mark in MIRROR mode', () => {
    const config = getPolicyConfig(ResponseStyle.MIRROR);
    const userState = analyzeUserState('今天天气不错', []);
    
    const draft1 = '我听到你说今天天气不错。你感觉很舒适。';
    const check1 = checkAssistantDraft(draft1, policyState(config, userState, 0), config);
    expect(check1.ok).toBe(true);
    expect(check1.questionCount).toBe(0);
    
    const draft2 = '我听到你说今天天气不错。你为什么这么说？';
    const check2 = checkAssistantDraft(draft2, policyState(config, userState, 0), config);
    expect(check2.ok).toBe(false);
    expect(check2.reasons).toContain('问题数超限: 1 > 0');
  });
});

// ========================
// 测试 2: ORGANIZER 模式 - draft 含 2 个问号 => rewrite 为最多1问
// ========================
describe('ORGANIZER mode', () => {
  it('should rewrite draft with 2+ questions to max 1', () => {
    const config = getPolicyConfig(ResponseStyle.ORGANIZER);
    const userState = analyzeUserState('我工作上遇到了一些问题', []);
    
    const draft = '你工作怎么了？是同事问题还是任务问题？';
    const check = checkAssistantDraft(draft, policyState(config, userState, 0), config);
    
    expect(check.ok).toBe(false);
    expect(check.questionCount).toBe(2);
    // 应该触发 rewrite
  });
});

// ========================
// 测试 3: GUIDE 未授权 - 问题必须变成授权式
// ========================
describe('GUIDE mode - unauthorized', () => {
  it('should convert question to authorization-style when not authorized', () => {
    const config = getPolicyConfig(ResponseStyle.GUIDE);
    const userState = analyzeUserState('我最近在想一些事情', []);
    
    expect(userState.isAskingForDeepDive).toBe(false);
    
    // 非授权式问题应该被标记
    const draft = '你在想什么？是什么让你开始思考这些？';
    const check = checkAssistantDraft(draft, policyState(config, userState, 0), config);
    
    expect(check.ok).toBe(false);
  });
});

// ========================
// 测试 4: GUIDE 授权 - 允许最多2问
// ========================
describe('GUIDE mode - authorized', () => {
  it('should allow up to 2 questions when user explicitly asks', () => {
    const config = getPolicyConfig(ResponseStyle.GUIDE);
    const userState = analyzeUserState('继续深挖，帮我看看', []);
    
    expect(userState.isAskingForDeepDive).toBe(true);
    
    // 授权后，2问应该是允许的
    // 注意：需要在 checkAssistantDraft 中考虑授权状态
  });
});

// ========================
// 测试 5: isDistressed - 强制降级到 MIRROR
// ========================
describe('isDistressed detection', () => {
  it('should downgrade to MIRROR when user is distressed', () => {
    const state1 = analyzeUserState('我很乱，不知道怎么办', []);
    expect(state1.isDistressed).toBe(true);
    
    const state2 = analyzeUserState('我找不着北了', []);
    expect(state2.isDistressed).toBe(true);
    
    const state3 = analyzeUserState("I feel so lost and overwhelmed", []);
    expect(state3.isDistressed).toBe(true);
  });
});

// ========================
// 测试 6: 禁止模板 - "这让你想起什么" => rewrite
// ========================
describe('forbidden patterns', () => {
  it('should flag "这让你想起什么" pattern', () => {
    const config = getPolicyConfig(ResponseStyle.GUIDE);
    const matches = checkForbiddenPatterns(
      '这让你想起什么童年往事吗？', 
      config.forbiddenPatterns
    );
    
    expect(matches.length).toBeGreaterThan(0);
    expect(matches).toContain('这让你想起什么');
  });
});

// ========================
// 测试 7: 连续追问 - 超过上限 => rewrite
// ========================
describe('consecutive question turns', () => {
  it('should flag when consecutive turns exceed limit', () => {
    const config = getPolicyConfig(ResponseStyle.ORGANIZER); // max 1
    const userState = analyzeUserState('继续说', []);
    
    // 已经连续 1 轮有问句，再来一轮应该被标记
    const draft = '你还有什么想补充的吗？';
    const check = checkAssistantDraft(draft, policyState(config, userState, 1), config);
    
    expect(check.ok).toBe(false);
    expect(check.reasons.some(r => r.includes('连续追问超限'))).toBe(true);
  });
});

// ========================
// 测试 8: EXPRESSION_HELP - 禁止深挖动机
// ========================
describe('EXPRESSION_HELP restrictions', () => {
  it('should forbid deep dive keywords like 童年/原生家庭', () => {
    const config = getPolicyConfig(ResponseStyle.EXPRESSION_HELP);
    
    const draft = '是因为童年的什么经历让你这样想的吗？';
    const forbidden = checkForbiddenPatterns(draft, config.forbiddenPatterns);
    
    expect(forbidden).toContain('童年');
  });
});

// ========================
// 辅助函数
// ========================
function policyState(config, userState, consecutiveTurns) {
  return {
    responseStyle: config.style,
    originalStyle: config.style,
    questionLevel: config.maxQuestionsPerTurn === 0 ? 'no_questions' : 'light',
    userState,
    consecutiveQuestionTurns: consecutiveTurns,
    downgraded: false
  };
}
*/

// ========================
// 手动验证步骤（在 App 中测试）
// ========================

/**
 * 手动验证步骤
 * 
 * 1. MIRROR 模式验证：
 *    - 选择 "只被倾听"
 *    - 输入: "今天工作很累"
 *    - 预期: AI 回复不包含任何问号
 * 
 * 2. ORGANIZER 模式验证：
 *    - 选择 "帮我理清思路"
 *    - 输入: "我在纠结要不要换工作"
 *    - 预期: AI 回复最多 1 个问号，且是澄清型问题
 * 
 * 3. GUIDE 模式 - 未授权验证：
 *    - 选择 "帮我看见盲点"
 *    - 输入: "最近在想一些事情"
 *    - 预期: AI 回复最多 1 个问号，且是授权式问题
 *            例如: "你希望我继续追问一个点，还是先停一下？"
 * 
 * 4. GUIDE 模式 - 授权验证：
 *    - 选择 "帮我看见盲点"
 *    - 输入: "继续深挖，帮我看看"
 *    - 预期: AI 回复最多 2 个问号
 * 
 * 5. 情绪降级验证：
 *    - 选择 "帮我看见盲点"
 *    - 输入: "我很乱，不知道怎么办"
 *    - 预期: 
 *      - 界面显示 "我感受到你可能有些不安..."
 *      - AI 回复不包含问号（自动降级到 MIRROR）
 *      - Debug 面板显示 action: "downgrade_to_mirror"
 * 
 * 6. 禁止模式验证：
 *    - 如果 AI 回复包含 "这让你想起什么"，应该被 rewrite
 *    - Debug 面板显示 reasons 包含 "命中禁止模式"
 * 
 * 7. EXPRESSION_HELP 验证：
 *    - 选择 "帮我整理成表达"
 *    - 输入: "我想和老板谈加薪"
 *    - 预期: AI 回复提供可复制的话术，不深挖动机
 */

console.log('Question Gate 测试用例模板');
console.log('请参考上方的手动验证步骤在 App 中测试');

