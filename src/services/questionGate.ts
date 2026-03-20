/**
 * Question Gate - 追问刹车策略模块
 * 
 * 核心功能：
 * 1. 按 ResponseStyle 定义追问策略
 * 2. 检测用户情绪状态（isDistressed）
 * 3. 检测用户是否授权深挖（isAskingForDeepDive）
 * 4. 检查 AI 回复是否合规
 * 5. 触发降级逻辑
 * 
 * 注意：实际的 AI 回复重写必须在后端执行，前端只做分析和传参
 */

import { 
  ResponseStyle,
  type ResponseStyleType,
  type QuestionPolicyConfig, 
  type UserStateAnalysis,
  type QuestionLevel
} from '../types/responseStyle';

// ========================
// 情绪词库（触发强制降级到 MIRROR）
// ========================
const DISTRESSED_KEYWORDS_ZH = [
  '乱', '迷茫', '崩溃', '焦虑', '难受', '痛苦', 
  '找不着北', '不知道怎么办', '撑不住', '绝望', 
  '快扛不住', '受不了', '不想活', '活不下去',
  '很累', '好累', '太累了', '心累', '身心俱疲',
  '压力大', '喘不过气', '窒息', '无助'
];

const DISTRESSED_KEYWORDS_EN = [
  'lost', 'overwhelmed', 'anxious', 'panic', 'depressed',
  'confused', "can't cope", 'desperate', 'hopeless',
  'exhausted', 'burned out', 'breaking down', 'falling apart',
  "can't take it", 'suffocating', 'helpless', 'suicidal'
];

// ========================
// 深挖授权词库（用户明确授权才算）
// ========================
const DEEP_DIVE_KEYWORDS_ZH = [
  '继续深挖', '深入聊', '追问我', '问细一点', 
  '帮我拆开', '别停', '往下问', '继续问',
  '再问一下', '想多聊聊', '展开说说', '深入一点'
];

const DEEP_DIVE_KEYWORDS_EN = [
  'go deeper', 'keep digging', 'ask me questions', 'push further',
  'dig deeper', 'keep asking', 'continue questioning', 'explore more',
  "let's dive in", 'ask me more'
];

// ========================
// 直接模式词库 - 用户明确要求精确直答
// ========================
const DIRECT_MODE_KEYWORDS_ZH = [
  '我在测试你的回复', '测试你的回复', '按我说的回答', '就按我说的回答',
  '严格按我要求', '严格按我说的', '直接回答', '精确回答', '准确回答',
  '按我要求回复', '请直接回答', '别绕'
];

const DIRECT_MODE_KEYWORDS_EN = [
  "i'm testing your reply", 'i am testing your reply', 'respond exactly as i asked',
  'answer exactly as i asked', 'answer directly', 'be precise', 'reply precisely',
  'respond directly', "don't hedge", "don't be vague"
];

// ========================
// 直答需求词库 - 用户明确在要观点/分析/解释/评价
// ========================
const DIRECT_ANSWER_KEYWORDS_ZH = [
  '你怎么看', '你觉得', '你的看法', '请分析', '分析一下', '请解释',
  '解释一下', '怎么理解', '你怎么理解', '评价一下', '判断一下',
  '给我结论', '给个判断', '你的意见'
];

const DIRECT_ANSWER_KEYWORDS_EN = [
  'what do you think', 'do you think', 'your view', 'your opinion', 'analyze this',
  'analyze it', 'interpret this', 'interpret it', 'evaluate this', 'evaluate it',
  'explain this', 'explain it', 'give me your analysis', 'give me a direct answer'
];

// ========================
// 任务已指定词库 - EXPRESSION_HELP 下表示用户已给过要点，不需要再问
// ========================
const TASK_SPECIFIED_KEYWORDS_ZH = [
  '就是我刚才说的', '前面说的', '刚才那几条', '刚才那几点',
  '按你理解的', '照你刚才总结的', '你刚才说的那些',
  '帮我整理一下', '润色一下', '改成更适合发给别人',
  '写成一段话', '写成短信', '写成微信', '写成邮件',
  '1.2.3.4点', '1、2、3、4点', '那几点', '这几点',
  '就按这个', '就这样写', '用你总结的'
];

const TASK_SPECIFIED_KEYWORDS_EN = [
  'as you said', 'as you understood', 'same points as before',
  'what you just summarized', 'those points you mentioned',
  'help me organize', 'polish it', 'rewrite it',
  'make it into a message', 'turn it into an email',
  'the points I mentioned', 'use your summary',
  'based on what I said', 'from what I told you'
];

// ========================
// 用户收尾信号词库 - 表示用户已满意，不需要追问
// ========================
const CLOSING_SIGNAL_KEYWORDS_ZH = [
  '这个可以', '就这样', '可以了', '行了', '好的', '可以发',
  '就用这版', '就用你这版', '这版可以', '谢谢', '感谢',
  '不用改了', '挺好的', '很好', '完美', '就这么发',
  'OK', 'ok', '行', '好'
];

const CLOSING_SIGNAL_KEYWORDS_EN = [
  'looks good', 'works', 'perfect', 'thanks', 'thank you',
  'good enough', 'that works', 'use that', 'use this version',
  "that's good", "that's fine", 'no changes needed', 'send it',
  'ok', 'okay', 'great', 'fine', 'done'
];

// ========================
// 禁止的"索要内容"句式 - EXPRESSION_HELP 下禁止 AI 要求用户复述
// ========================
const REQUEST_CONTENT_PATTERNS_ZH = [
  '请把需要整理的内容发给我',
  '请把你想说的内容发给我',
  '具体内容是什么',
  '你刚才提到的具体内容是',
  '能再说详细一点吗',
  '你指的.*具体是什么',
  '可以告诉我更多吗',
  '请提供.*内容',
  '请发.*内容',
  '你说的.*是指什么',
  '能详细说说吗',
  '请详细描述',
  '需要你提供',
  '麻烦.*发给我'
];

const REQUEST_CONTENT_PATTERNS_EN = [
  'please send the content',
  'please share the content',
  'what are the details',
  'can you elaborate',
  'what do you mean by',
  'could you provide more',
  'please provide the content',
  'what exactly do you mean',
  'can you be more specific',
  'please describe in detail',
  'I need you to provide'
];

// ========================
// 禁止模式（假深度/价值引导/连环追问）
// ========================
const FORBIDDEN_PATTERNS_ZH = [
  '这让你想起什么',
  '这让你感觉如何',
  '你对此有什么感受',
  '你现在是什么感觉',
  '你真正想要的是什么',
  '这背后是什么',
  '你内心深处',
  '原生家庭',
  '童年',
  '你有没有想过',
  '你为什么会这样想',
  '是不是因为'
];

const FORBIDDEN_PATTERNS_EN = [
  'what does this remind you of',
  'how does this make you feel',
  'how do you feel about this',
  'what are you feeling right now',
  'what do you really want',
  "what's behind this",
  'deep down',
  'childhood',
  'your family of origin',
  'have you ever considered',
  'why do you think that',
  'is it because'
];

// ========================
// 策略配置：按 ResponseStyle 硬编码
// ========================
export const QUESTION_POLICY_CONFIGS: Record<ResponseStyleType, QuestionPolicyConfig> = {
  [ResponseStyle.MIRROR]: {
    maxQuestionsPerTurn: 0,
    maxConsecutiveQuestionTurns: 0,
    allowedQuestionTypes: ['none'],
    forbiddenPatterns: ['?', '？', '吗', '呢', ...FORBIDDEN_PATTERNS_ZH, ...FORBIDDEN_PATTERNS_EN],
    outputStructure: '指出用户正在使用的思考角度/命题 -> 轻度回应其 reasoning -> 允许停留，不提问',
    requiresAuthorization: false
  },
  
  [ResponseStyle.ORGANIZER]: {
    maxQuestionsPerTurn: 0,
    maxConsecutiveQuestionTurns: 0,
    allowedQuestionTypes: ['none'],
    forbiddenPatterns: [...FORBIDDEN_PATTERNS_ZH, ...FORBIDDEN_PATTERNS_EN],
    outputStructure: '识别用户思路 -> 提取逻辑链 -> 清晰表达，不提问',
    requiresAuthorization: false
  },
  
  [ResponseStyle.EXPRESSION_HELP]: {
    maxQuestionsPerTurn: 1,
    maxConsecutiveQuestionTurns: 1,
    allowedQuestionTypes: ['scene'],
    forbiddenPatterns: [...FORBIDDEN_PATTERNS_ZH, ...FORBIDDEN_PATTERNS_EN, '童年', '原生家庭'],
    outputStructure: '先确认目标对象与场景 -> 生成可直接复制的话术（多语气版本可选）-> 末尾最多1个澄清问题',
    requiresAuthorization: false
  },
  
  [ResponseStyle.GUIDE]: {
    maxQuestionsPerTurn: 1,  // 默认1问，授权后可到2问
    maxConsecutiveQuestionTurns: 2,
    allowedQuestionTypes: ['authorization', 'retrospect', 'mirror_confirm'],
    forbiddenPatterns: [...FORBIDDEN_PATTERNS_ZH, ...FORBIDDEN_PATTERNS_EN],
    outputStructure: '先确认已看见的 reasoning structure -> 再用1个真正推进推理的问题继续；默认1问，授权后可到2问',
    requiresAuthorization: true
  }
};

// ========================
// 核心函数：分析用户状态
// ========================
export function analyzeUserState(
  userText: string, 
  recentTurns: Array<{ role: 'user' | 'ai'; text: string }> = []
): UserStateAnalysis {
  const textLower = userText.toLowerCase();
  const allUserText = [userText, ...recentTurns.filter(t => t.role === 'user').map(t => t.text)].join(' ').toLowerCase();
  
  // 检测情绪词
  const distressedKeywords: string[] = [];
  for (const keyword of DISTRESSED_KEYWORDS_ZH) {
    if (allUserText.includes(keyword)) {
      distressedKeywords.push(keyword);
    }
  }
  for (const keyword of DISTRESSED_KEYWORDS_EN) {
    if (allUserText.includes(keyword)) {
      distressedKeywords.push(keyword);
    }
  }
  
  // 检测深挖授权词（只看当前这句）
  const deepDiveKeywords: string[] = [];
  for (const keyword of DEEP_DIVE_KEYWORDS_ZH) {
    if (textLower.includes(keyword)) {
      deepDiveKeywords.push(keyword);
    }
  }
  for (const keyword of DEEP_DIVE_KEYWORDS_EN) {
    if (textLower.includes(keyword)) {
      deepDiveKeywords.push(keyword);
    }
  }
  
  // 检测任务已指定信号（EXPRESSION_HELP 专用）
  const taskSpecified = isTaskAlreadySpecified(userText, recentTurns);
  
  // 检测用户收尾信号
  const closingSignal = isUserClosingSignal(userText);
  const directMode = detectDirectMode(userText);
  const directAnswer = detectDirectAnswerNeed(userText);
  
  return {
    isDistressed: distressedKeywords.length > 0,
    isAskingForDeepDive: deepDiveKeywords.length > 0,
    isTaskAlreadySpecified: taskSpecified.isSpecified,
    isUserClosingSignal: closingSignal.isClosing,
    prefersDirectMode: directMode.keywords.length > 0,
    needsDirectAnswer: directAnswer.keywords.length > 0,
    distressedKeywords,
    deepDiveKeywords,
    taskSpecifiedKeywords: taskSpecified.keywords,
    closingSignalKeywords: closingSignal.keywords,
    directModeKeywords: directMode.keywords,
    directAnswerKeywords: directAnswer.keywords,
    contextSufficient: taskSpecified.contextSufficient
  };
}

function detectDirectMode(userText: string): { keywords: string[] } {
  const textLower = userText.toLowerCase();
  const keywords = [
    ...DIRECT_MODE_KEYWORDS_ZH.filter(keyword => textLower.includes(keyword.toLowerCase())),
    ...DIRECT_MODE_KEYWORDS_EN.filter(keyword => textLower.includes(keyword.toLowerCase())),
  ];
  return { keywords };
}

function detectDirectAnswerNeed(userText: string): { keywords: string[] } {
  const textLower = userText.toLowerCase();
  const keywords = [
    ...DIRECT_ANSWER_KEYWORDS_ZH.filter(keyword => textLower.includes(keyword.toLowerCase())),
    ...DIRECT_ANSWER_KEYWORDS_EN.filter(keyword => textLower.includes(keyword.toLowerCase())),
  ];
  return { keywords };
}

function hasPassiveReflectionLead(text: string): boolean {
  const normalized = text.trim().toLowerCase();
  return /^(你似乎|你好像|你在意|也许你|听起来你|我听到你|你像是在|it seems like|you seem to|maybe you|it sounds like|i hear that|you appear to)/i.test(normalized);
}

// ========================
// 新增：检测任务是否已充分给定（EXPRESSION_HELP 专用）
// ========================
export function isTaskAlreadySpecified(
  userText: string,
  recentTurns: Array<{ role: 'user' | 'ai'; text: string }> = []
): { isSpecified: boolean; keywords: string[]; contextSufficient: boolean } {
  const textLower = userText.toLowerCase();
  const keywords: string[] = [];
  
  // 检测用户当前输入是否包含"任务已指定"关键词
  for (const kw of TASK_SPECIFIED_KEYWORDS_ZH) {
    if (textLower.includes(kw.toLowerCase())) {
      keywords.push(kw);
    }
  }
  for (const kw of TASK_SPECIFIED_KEYWORDS_EN) {
    if (textLower.includes(kw.toLowerCase())) {
      keywords.push(kw);
    }
  }
  
  // 检查上下文是否足够（最近 1-3 轮）
  let contextSufficient = false;
  const recentThree = recentTurns.slice(-6); // 最近 3 轮 = 6 条消息
  
  for (const turn of recentThree) {
    if (turn.role === 'ai') {
      // AI 曾经总结过要点
      const summaryPatterns = [
        '你提到', '你说', '你表示', '核心包括', '要点包括', '总结一下',
        '你想表达', '你的意思是', '我理解你', '听起来你',
        'you mentioned', 'you said', 'your points', 'to summarize',
        'you want to', 'it sounds like', 'I understand that'
      ];
      if (summaryPatterns.some(p => turn.text.toLowerCase().includes(p.toLowerCase()))) {
        contextSufficient = true;
        break;
      }
    } else if (turn.role === 'user') {
      // 用户曾经以列表/编号形式给过信息
      const listPatterns = [
        /\d+[.、:：)）]/,  // 1. 2. 3. 或 1、2、3
        /[一二三四五六七八九十][、:：]/,  // 一、二、三
        /第[一二三四五六七八九十]/,  // 第一、第二
        /首先|其次|然后|最后|另外/,  // 顺序词
        /first|second|third|finally|also|additionally/i
      ];
      if (listPatterns.some(p => p.test(turn.text))) {
        contextSufficient = true;
        break;
      }
    }
  }
  
  return {
    isSpecified: keywords.length > 0,
    keywords,
    contextSufficient
  };
}

// ========================
// 新增：检测用户收尾信号
// ========================
export function isUserClosingSignal(
  userText: string
): { isClosing: boolean; keywords: string[] } {
  const textLower = userText.toLowerCase().trim();
  const keywords: string[] = [];
  
  // 检测收尾信号词
  for (const kw of CLOSING_SIGNAL_KEYWORDS_ZH) {
    if (textLower.includes(kw.toLowerCase())) {
      keywords.push(kw);
    }
  }
  for (const kw of CLOSING_SIGNAL_KEYWORDS_EN) {
    if (textLower.includes(kw.toLowerCase())) {
      keywords.push(kw);
    }
  }
  
  // 短消息（<10字符）且包含肯定词，视为收尾信号
  const isShortAffirmative = textLower.length < 15 && keywords.length > 0;
  
  return {
    isClosing: isShortAffirmative || keywords.length >= 1,
    keywords
  };
}

// ========================
// 新增：检测 AI 回复是否包含"索要内容"句式
// ========================
export function hasRequestContentPattern(text: string): { hasPattern: boolean; matches: string[] } {
  const textLower = text.toLowerCase();
  const matches: string[] = [];
  
  // 检测中文模式
  for (const pattern of REQUEST_CONTENT_PATTERNS_ZH) {
    try {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(text)) {
        matches.push(pattern);
      }
    } catch {
      // 如果正则失败，退化为包含检测
      if (textLower.includes(pattern.toLowerCase())) {
        matches.push(pattern);
      }
    }
  }
  
  // 检测英文模式
  for (const pattern of REQUEST_CONTENT_PATTERNS_EN) {
    if (textLower.includes(pattern.toLowerCase())) {
      matches.push(pattern);
    }
  }
  
  return {
    hasPattern: matches.length > 0,
    matches
  };
}

// ========================
// 获取策略配置
// ========================
export function getPolicyConfig(responseStyle: ResponseStyleType): QuestionPolicyConfig {
  return QUESTION_POLICY_CONFIGS[responseStyle];
}

// ========================
// 计算问号数量
// ========================
export function countQuestions(text: string): number {
  const questionMarks = (text.match(/[?？]/g) || []).length;
  return questionMarks;
}

// ========================
// 检查是否命中禁止模式
// ========================
export function checkForbiddenPatterns(text: string, patterns: string[]): string[] {
  const textLower = text.toLowerCase();
  const matches: string[] = [];
  
  for (const pattern of patterns) {
    if (textLower.includes(pattern.toLowerCase())) {
      matches.push(pattern);
    }
  }
  
  return matches;
}

// ========================
// 检查 AI 回复是否合规（前端预检，实际检查在后端）
// ========================
export function checkAssistantDraft(
  draftText: string,
  userState: UserStateAnalysis,
  config: QuestionPolicyConfig,
  consecutiveQuestionTurns: number,
  responseStyle?: ResponseStyleType
): { 
  ok: boolean; 
  reasons: string[]; 
  questionCount: number; 
  action: 'pass' | 'rewrite' | 'force_generate' | 'force_close';
} {
  const reasons: string[] = [];
  const questionCount = countQuestions(draftText);
  let action: 'pass' | 'rewrite' | 'force_generate' | 'force_close' = 'pass';
  
  // ========================
  // EXPRESSION_HELP 专属规则（P0 优先级）
  // ========================
  if (responseStyle === ResponseStyle.EXPRESSION_HELP) {
    // 规则 EH-1: 用户收尾信号 => 禁止任何追问
    if (userState.isUserClosingSignal) {
      if (questionCount > 0) {
        reasons.push(`EXPRESSION_HELP 收尾信号: 用户已满意(${userState.closingSignalKeywords?.join(', ')}), 禁止追问`);
        action = 'force_close';
      }
      // 即使没问号，也标记为 force_close 确保收口
      if (action !== 'force_close') action = 'force_close';
      return { ok: reasons.length === 0, reasons, questionCount, action };
    }
    
    // 规则 EH-2: 任务已指定 => 强制直接产出，禁止索要复述
    if (userState.isTaskAlreadySpecified || userState.contextSufficient) {
      // 检测是否包含"索要内容"句式
      const requestContent = hasRequestContentPattern(draftText);
      if (requestContent.hasPattern) {
        reasons.push(`EXPRESSION_HELP 禁止索要复述: 用户已指定任务(${userState.taskSpecifiedKeywords?.join(', ')}), AI 不应要求重复内容`);
        action = 'force_generate';
      }
      
      // 任务已指定时，强制 maxQuestionsPerTurn = 0
      if (questionCount > 0) {
        reasons.push(`EXPRESSION_HELP 任务已指定: 强制 maxQuestionsPerTurn=0, 但检测到 ${questionCount} 个问号`);
        action = 'force_generate';
      }
      
      if (action === 'force_generate') {
        return { ok: false, reasons, questionCount, action };
      }
    }
    
    // 规则 EH-3: 即使任务未指定，也禁止"索要内容"句式
    const requestContent = hasRequestContentPattern(draftText);
    if (requestContent.hasPattern) {
      reasons.push(`EXPRESSION_HELP 禁止索要内容: 命中句式(${requestContent.matches.join(', ')})`);
      action = 'rewrite';
    }
  }
  
  // ========================
  // 通用规则
  // ========================
  
  // 规则1: 问题数超限
  if (questionCount > config.maxQuestionsPerTurn) {
    reasons.push(`问题数超限: ${questionCount} > ${config.maxQuestionsPerTurn}`);
    if (action === 'pass') action = 'rewrite';
  }
  
  // 规则2: 连续追问超限
  if (consecutiveQuestionTurns >= config.maxConsecutiveQuestionTurns && questionCount > 0) {
    reasons.push(`连续追问超限: 已连续 ${consecutiveQuestionTurns} 轮有问句`);
    if (action === 'pass') action = 'rewrite';
  }
  
  // 规则3: 命中禁止模式
  const forbiddenMatches = checkForbiddenPatterns(draftText, config.forbiddenPatterns);
  if (forbiddenMatches.length > 0) {
    reasons.push(`命中禁止模式: ${forbiddenMatches.join(', ')}`);
    if (action === 'pass') action = 'rewrite';
  }

  // 规则4: 用户明确要观点/分析/精确回答时，不能用被动映射开头来替代答案
  if ((userState.prefersDirectMode || userState.needsDirectAnswer) && hasPassiveReflectionLead(draftText)) {
    reasons.push('用户要求直接回答时，回复不应以被动映射开头替代答案');
    if (action === 'pass') action = 'rewrite';
  }
  
  // 规则5: GUIDE 模式下未授权深挖但出现多个问题
  if (config.requiresAuthorization && !userState.isAskingForDeepDive && questionCount > 1) {
    reasons.push('GUIDE 模式下用户未授权深挖，问题数应限制为 1');
    if (action === 'pass') action = 'rewrite';
  }
  
  return {
    ok: reasons.length === 0,
    reasons,
    questionCount,
    action
  };
}

// ========================
// 决定最终 ResponseStyle 和 QuestionLevel
// ========================
export function resolveStyleAndLevel(
  selectedMode: number | null,
  savedPreference: { role?: string } | null,
  userState: UserStateAnalysis
): { style: ResponseStyleType; level: QuestionLevel; downgraded: boolean; reason?: string } {
  
  // 1. 先确定原始 style：Reflect 选择 > Me 默认偏好
  const modeMapping: ResponseStyleType[] = [
    ResponseStyle.MIRROR,       // 0: 只被倾听
    ResponseStyle.ORGANIZER,    // 1: 帮我理清思路
    ResponseStyle.GUIDE,        // 2: 帮我看见盲点
    ResponseStyle.EXPRESSION_HELP // 3: 帮我整理成表达
  ];
  
  let originalStyle: ResponseStyleType;
  if (selectedMode !== null && selectedMode >= 0 && selectedMode < modeMapping.length) {
    originalStyle = modeMapping[selectedMode];
  } else if (savedPreference?.role) {
    originalStyle = savedPreference.role as ResponseStyleType;
  } else {
    originalStyle = ResponseStyle.MIRROR;
  }
  
  // 2. 检查是否需要降级
  // update: 仅当 GUIDE 模式且情绪不稳时强制降级；其他模式保留 style 但禁止提问
  if (userState.isDistressed) {
    if (originalStyle === ResponseStyle.GUIDE) {
      return {
        style: ResponseStyle.MIRROR,
        level: 'no_questions',
        downgraded: true,
        reason: `用户情绪不稳（命中: ${userState.distressedKeywords.join(', ')}），GUIDE 模式强制降级到 MIRROR`
      };
    } else {
      // 保持原 Style (Organizer / Expression Help / Mirror)，但强制 level = no_questions
      return {
        style: originalStyle,
        level: 'no_questions',
        downgraded: false, // 严格来说不是降级 style，只是降级 question level
        reason: `用户情绪不稳（命中: ${userState.distressedKeywords.join(', ')}），保持 ${originalStyle} 但禁止提问`
      };
    }
  }
  
  // 3. 根据 style 和用户授权决定 level
  let level: QuestionLevel;
  const config = getPolicyConfig(originalStyle);
  
  if (config.maxQuestionsPerTurn === 0) {
    level = 'no_questions';
  } else if (config.requiresAuthorization && userState.isAskingForDeepDive) {
    level = 'deep';
  } else {
    level = 'light';
  }
  
  return {
    style: originalStyle,
    level,
    downgraded: false
  };
}

// ========================
// 为后端生成 system prompt 注入片段
// ========================
export function getSystemPromptInjection(style: ResponseStyleType, level: QuestionLevel): string {
  switch (style) {
    case ResponseStyle.MIRROR:
      return `【角色】你是“镜子”。
【核心任务】照见用户的想法，让用户感到被理解。
【规则】
- 如果用户在问具体问题、索要观点、评价、解释或分析，先直接回答问题，再补一层理解
- 理解与共情可以跟在答案后面，但不能替代答案
- 如果用户说“我在测试你的回复”或“按我要求回答”，切换到精确直答模式：直接答，不加铺垫
- 不要推进话题
- 不要分析用户人格
- 不要提出复杂问题，也不要出现问号
- 不要给建议或结论
- 不要机械重复用户原句
- 减少套话开头，例如“你似乎 / 你好像 / 你在意 / 也许你”
【只需做到】
- 先回答用户实际在问什么
- 再映射用户的观点
- 再表达你已经理解
- 允许用户停留在当前思路里`;
      
    case ResponseStyle.ORGANIZER:
      return `【角色】你是“整理者”。
【核心任务】把用户的想法整理成清晰结构。
【规则】
- 提取逻辑链
- 归纳思路
- 用清晰结构表达出来
- 不进行心理分析
- 不推进情绪探索
- 不出现问号
【输出形态示例】
可以使用：
A -> B -> C
或
1. 命题
2. 推演
3. 更大的结构`;
      
    case ResponseStyle.EXPRESSION_HELP:
      return `【角色】你是“表达辅助”。
【核心任务】帮助用户把想法表达得更清晰、更有力量。
【规则】
- 优化语言
- 提供表达版本
- 不改变用户观点
- 不替用户换思想，只帮用户换表达
- 如果上下文已足够，直接给版本
- 信息不完整时，先给一个可用版本，而不是要求用户从头再说
- 最多只能问 1 个场景补全问题（对象/目的/语气）
- 禁止索要重复内容`;
      
    case ResponseStyle.GUIDE:
      if (level === 'deep') {
        return `【角色】你是“引导者”。
【核心任务】帮助用户更深入思考问题。
【规则】
- 如果用户在问你的观点、判断、解释或分析，先给出你的直接回答，再继续追问
- 理解与共情要放在答案之后，不能代替答案
- 如果用户说“我在测试你的回复”或“按我要求回答”，切换到精确直答模式：先准确回答，再决定是否补一个问题
- 先理解观点，再提出更深问题
- 问题必须扩展思考维度，而不是重复用户原话
- 可以最多问 2 个问题，但都必须真正推进思考
- 不给结论
- 不做心理分析
- 禁止浅层情绪问题
- 减少套话开头，例如“你似乎 / 你好像 / 你在意 / 也许你”
- 禁止假深度开放题`;
      } else {
        return `【角色】你是“引导者”。
【核心任务】帮助用户更深入思考问题。
【规则】
- 如果用户在问你的观点、判断、解释或分析，先给出你的直接回答，再继续追问
- 理解与共情要放在答案之后，不能代替答案
- 如果用户说“我在测试你的回复”或“按我要求回答”，切换到精确直答模式：直接而准确地回答
- 先理解观点，再提出 1 个更深的问题
- 这个问题必须推进思考，而不是重复原观点
- 不给结论
- 不做心理分析
- 禁止浅层情绪问题
- 减少套话开头，例如“你似乎 / 你好像 / 你在意 / 也许你”
- 禁止假深度开放题`;
      }
      
    default:
      return '';
  }
}

// ========================
// 导出默认实例
// ========================
export default {
  analyzeUserState,
  getPolicyConfig,
  checkAssistantDraft,
  resolveStyleAndLevel,
  getSystemPromptInjection,
  countQuestions,
  isTaskAlreadySpecified,
  isUserClosingSignal,
  hasRequestContentPattern,
  QUESTION_POLICY_CONFIGS,
  DISTRESSED_KEYWORDS_ZH,
  DISTRESSED_KEYWORDS_EN,
  DEEP_DIVE_KEYWORDS_ZH,
  DEEP_DIVE_KEYWORDS_EN
};
