/**
 * Question Gate - 后端策略模块（Lambda 代码模板）
 * 
 * ⚠️ 这是需要部署到 AWS Lambda 的代码模板
 * 请将此文件复制到你的后端项目中使用
 * 
 * 核心功能：
 * 1. 在模型调用前：分析用户状态，决定追问策略
 * 2. 在模型调用后：检查 AI 回复是否合规，不合规则重写
 * 3. 强制降级：用户情绪不稳时强制降级到 MIRROR
 */

// ========================
// 类型定义
// ========================

export enum ResponseStyle {
  MIRROR = 'mirror',
  ORGANIZER = 'organizer',
  EXPRESSION_HELP = 'helper',
  GUIDE = 'guide'
}

export type QuestionLevel = 'no_questions' | 'light' | 'deep';

export type QuestionType = 
  | 'none'
  | 'clarify'
  | 'scene'
  | 'authorization'
  | 'retrospect'
  | 'mirror_confirm';

export interface QuestionPolicyConfig {
  maxQuestionsPerTurn: number;
  maxConsecutiveQuestionTurns: number;
  allowedQuestionTypes: QuestionType[];
  forbiddenPatterns: string[];
  outputStructure: string;
  requiresAuthorization: boolean;
}

export interface UserStateAnalysis {
  isDistressed: boolean;
  isAskingForDeepDive: boolean;
  isTaskAlreadySpecified: boolean;
  isUserClosingSignal: boolean;
  prefersDirectMode: boolean;
  needsDirectAnswer: boolean;
  distressedKeywords: string[];
  deepDiveKeywords: string[];
  taskSpecifiedKeywords: string[];
  closingSignalKeywords: string[];
  directModeKeywords: string[];
  directAnswerKeywords: string[];
  contextSufficient: boolean;
}

export interface PolicyState {
  responseStyle: ResponseStyle;
  originalStyle: ResponseStyle;
  questionLevel: QuestionLevel;
  userState: UserStateAnalysis;
  consecutiveQuestionTurns: number;
  downgraded: boolean;
  downgradeReason?: string;
}

export interface CheckResult {
  ok: boolean;
  reasons: string[];
  questionCount: number;
  action: 'pass' | 'rewrite' | 'force_generate' | 'force_close';
}

export interface QuestionGateResult {
  responseStyle: ResponseStyle;
  originalStyle: ResponseStyle;
  isDistressed: boolean;
  isAskingForDeepDive: boolean;
  isTaskAlreadySpecified: boolean;
  isUserClosingSignal: boolean;
  questionCount: number;
  consecutiveQuestionTurns: number;
  action: 'pass' | 'rewrite' | 'downgrade_to_mirror' | 'force_generate' | 'force_close';
  reasons: string[];
  rewrittenText?: string;
}

// ========================
// 情绪词库
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
// 深挖授权词库
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
// 任务已指定词库 - EXPRESSION_HELP 下表示用户已给过要点
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
// 用户收尾信号词库
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
// 禁止模式
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
// 策略配置
// ========================

const QUESTION_POLICY_CONFIGS: Record<ResponseStyle, QuestionPolicyConfig> = {
  [ResponseStyle.MIRROR]: {
    maxQuestionsPerTurn: 0,
    maxConsecutiveQuestionTurns: 0,
    allowedQuestionTypes: ['none'],
    forbiddenPatterns: ['?', '？', '吗', '呢', ...FORBIDDEN_PATTERNS_ZH, ...FORBIDDEN_PATTERNS_EN],
    outputStructure: '映射用户观点 -> 表达理解 -> 轻微确认，不推进',
    requiresAuthorization: false
  },
  
  [ResponseStyle.ORGANIZER]: {
    maxQuestionsPerTurn: 0,
    maxConsecutiveQuestionTurns: 0,
    allowedQuestionTypes: ['none'],
    forbiddenPatterns: [...FORBIDDEN_PATTERNS_ZH, ...FORBIDDEN_PATTERNS_EN],
    outputStructure: '识别思路 -> 提取逻辑链 -> 清晰表达，不提问',
    requiresAuthorization: false
  },
  
  [ResponseStyle.EXPRESSION_HELP]: {
    maxQuestionsPerTurn: 1,
    maxConsecutiveQuestionTurns: 1,
    allowedQuestionTypes: ['scene'],
    forbiddenPatterns: [...FORBIDDEN_PATTERNS_ZH, ...FORBIDDEN_PATTERNS_EN, '童年', '原生家庭'],
    outputStructure: '识别用户表达 -> 优化语言 -> 提供表达版本',
    requiresAuthorization: false
  },
  
  [ResponseStyle.GUIDE]: {
    maxQuestionsPerTurn: 1,
    maxConsecutiveQuestionTurns: 2,
    allowedQuestionTypes: ['authorization', 'retrospect', 'mirror_confirm'],
    forbiddenPatterns: [...FORBIDDEN_PATTERNS_ZH, ...FORBIDDEN_PATTERNS_EN],
    outputStructure: '理解观点 -> 提出更深问题 -> 扩展思考',
    requiresAuthorization: true
  }
};

// ========================
// 核心函数
// ========================

/**
 * 分析用户状态
 */
export function analyzeUserState(
  userText: string,
  recentTurns: Array<{ role: string; text: string }> = []
): UserStateAnalysis {
  const textLower = userText.toLowerCase();
  const allUserText = [
    userText, 
    ...recentTurns.filter(t => t.role === 'user').map(t => t.text)
  ].join(' ').toLowerCase();
  
  const distressedKeywords: string[] = [];
  for (const kw of [...DISTRESSED_KEYWORDS_ZH, ...DISTRESSED_KEYWORDS_EN]) {
    if (allUserText.includes(kw.toLowerCase())) {
      distressedKeywords.push(kw);
    }
  }
  
  const deepDiveKeywords: string[] = [];
  for (const kw of [...DEEP_DIVE_KEYWORDS_ZH, ...DEEP_DIVE_KEYWORDS_EN]) {
    if (textLower.includes(kw.toLowerCase())) {
      deepDiveKeywords.push(kw);
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

/**
 * 检测任务是否已充分给定（EXPRESSION_HELP 专用）
 */
export function isTaskAlreadySpecified(
  userText: string,
  recentTurns: Array<{ role: string; text: string }> = []
): { isSpecified: boolean; keywords: string[]; contextSufficient: boolean } {
  const textLower = userText.toLowerCase();
  const keywords: string[] = [];
  
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
  
  // 检查上下文是否足够
  let contextSufficient = false;
  const recentThree = recentTurns.slice(-6);
  
  for (const turn of recentThree) {
    if (turn.role === 'assistant' || turn.role === 'ai') {
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
      const listPatterns = [
        /\d+[.、:：)）]/,
        /[一二三四五六七八九十][、:：]/,
        /第[一二三四五六七八九十]/,
        /首先|其次|然后|最后|另外/,
        /first|second|third|finally|also|additionally/i
      ];
      if (listPatterns.some(p => p.test(turn.text))) {
        contextSufficient = true;
        break;
      }
    }
  }
  
  return { isSpecified: keywords.length > 0, keywords, contextSufficient };
}

/**
 * 检测用户收尾信号
 */
export function isUserClosingSignal(
  userText: string
): { isClosing: boolean; keywords: string[] } {
  const textLower = userText.toLowerCase().trim();
  const keywords: string[] = [];
  
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
  
  const isShortAffirmative = textLower.length < 15 && keywords.length > 0;
  
  return {
    isClosing: isShortAffirmative || keywords.length >= 1,
    keywords
  };
}

/**
 * 检测 AI 回复是否包含"索要内容"句式
 */
export function hasRequestContentPattern(text: string): { hasPattern: boolean; matches: string[] } {
  const textLower = text.toLowerCase();
  const matches: string[] = [];
  
  for (const pattern of REQUEST_CONTENT_PATTERNS_ZH) {
    try {
      const regex = new RegExp(pattern, 'i');
      if (regex.test(text)) {
        matches.push(pattern);
      }
    } catch {
      if (textLower.includes(pattern.toLowerCase())) {
        matches.push(pattern);
      }
    }
  }
  
  for (const pattern of REQUEST_CONTENT_PATTERNS_EN) {
    if (textLower.includes(pattern.toLowerCase())) {
      matches.push(pattern);
    }
  }
  
  return { hasPattern: matches.length > 0, matches };
}

/**
 * 获取策略配置
 */
export function getPolicyConfig(style: ResponseStyle): QuestionPolicyConfig {
  return QUESTION_POLICY_CONFIGS[style] || QUESTION_POLICY_CONFIGS[ResponseStyle.MIRROR];
}

/**
 * 计算问号数量
 */
export function countQuestions(text: string): number {
  return (text.match(/[?？]/g) || []).length;
}

/**
 * 检查禁止模式
 */
export function checkForbiddenPatterns(text: string, patterns: string[]): string[] {
  const textLower = text.toLowerCase();
  return patterns.filter(p => textLower.includes(p.toLowerCase()));
}

/**
 * 检查 AI 回复是否合规
 */
export function checkAssistantDraft(
  draftText: string,
  policyState: PolicyState,
  config: QuestionPolicyConfig
): CheckResult {
  const reasons: string[] = [];
  const questionCount = countQuestions(draftText);
  let action: 'pass' | 'rewrite' | 'force_generate' | 'force_close' = 'pass';
  
  // ========================
  // EXPRESSION_HELP 专属规则（P0 优先级）
  // ========================
  if (policyState.responseStyle === ResponseStyle.EXPRESSION_HELP) {
    // 规则 EH-1: 用户收尾信号 => 禁止任何追问
    if (policyState.userState.isUserClosingSignal) {
      if (questionCount > 0) {
        reasons.push(`EXPRESSION_HELP 收尾信号: 用户已满意(${policyState.userState.closingSignalKeywords.join(', ')}), 禁止追问`);
        action = 'force_close';
      }
      if (action !== 'force_close') action = 'force_close';
      return { ok: reasons.length === 0, reasons, questionCount, action };
    }
    
    // 规则 EH-2: 任务已指定 => 强制直接产出，禁止索要复述
    if (policyState.userState.isTaskAlreadySpecified || policyState.userState.contextSufficient) {
      const requestContent = hasRequestContentPattern(draftText);
      if (requestContent.hasPattern) {
        reasons.push(`EXPRESSION_HELP 禁止索要复述: 用户已指定任务(${policyState.userState.taskSpecifiedKeywords.join(', ')}), AI 不应要求重复内容`);
        action = 'force_generate';
      }
      
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
  const maxQ = policyState.userState.isAskingForDeepDive && config.requiresAuthorization 
    ? 2 
    : config.maxQuestionsPerTurn;
  
  if (questionCount > maxQ) {
    reasons.push(`问题数超限: ${questionCount} > ${maxQ}`);
    if (action === 'pass') action = 'rewrite';
  }
  
  // 规则2: 连续追问超限
  if (policyState.consecutiveQuestionTurns >= config.maxConsecutiveQuestionTurns && questionCount > 0) {
    reasons.push(`连续追问超限: 已连续 ${policyState.consecutiveQuestionTurns} 轮`);
    if (action === 'pass') action = 'rewrite';
  }
  
  // 规则3: 禁止模式
  const forbidden = checkForbiddenPatterns(draftText, config.forbiddenPatterns);
  if (forbidden.length > 0) {
    reasons.push(`命中禁止模式: ${forbidden.join(', ')}`);
    if (action === 'pass') action = 'rewrite';
  }

  // 规则4: 用户明确要观点/分析/精确回答时，不能用被动映射开头来替代答案
  if ((policyState.userState.prefersDirectMode || policyState.userState.needsDirectAnswer) && hasPassiveReflectionLead(draftText)) {
    reasons.push('用户要求直接回答时，回复不应以被动映射开头替代答案');
    if (action === 'pass') action = 'rewrite';
  }
  
  // 规则5: GUIDE 未授权深挖时问题类型检查
  if (config.requiresAuthorization && !policyState.userState.isAskingForDeepDive && questionCount > 0) {
    const authPatterns = [
      '你希望我继续', '你想继续', '要不要继续', '是否继续',
      'would you like', 'do you want', 'shall I continue'
    ];
    const hasAuthQuestion = authPatterns.some(p => draftText.toLowerCase().includes(p.toLowerCase()));
    if (!hasAuthQuestion) {
      reasons.push('GUIDE 模式下用户未授权深挖，问题必须是授权式');
      if (action === 'pass') action = 'rewrite';
    }
  }
  
  return { ok: reasons.length === 0, reasons, questionCount, action };
}

/**
 * 重写不合规的 AI 回复
 * 
 * ⚠️ 这里需要调用 OpenAI 进行重写
 * 以下是简化版本，实际生产中应该调用 LLM
 */
export async function rewriteToCompliant(
  draftText: string,
  policyState: PolicyState,
  config: QuestionPolicyConfig,
  lastUserText: string,
  openaiClient: any, // 传入你的 OpenAI client
  action: 'rewrite' | 'force_generate' | 'force_close',
  recentTurns: Array<{ role: string; text: string }> = []
): Promise<string> {
  
  const systemPrompt = getRewriteSystemPrompt(
    policyState.responseStyle, 
    policyState.questionLevel, 
    action,
    policyState.userState
  );
  
  // 构建上下文信息（用于 force_generate 时引用已有内容）
  let contextInfo = '';
  if (action === 'force_generate' && recentTurns.length > 0) {
    const recentContext = recentTurns.slice(-4).map(t => `${t.role}: ${t.text}`).join('\n');
    contextInfo = `\n\n【对话上下文（用户已给过的要点）】:\n${recentContext}`;
  }
  
  // 调用 OpenAI 重写
  const response = await openaiClient.chat.completions.create({
    model: 'gpt-4.1',
    messages: [
      { role: 'system', content: systemPrompt },
      { 
        role: 'user', 
        content: `原始回复：\n${draftText}\n\n用户原文：\n${lastUserText}${contextInfo}\n\n请按照要求重写，确保合规。`
      }
    ],
    temperature: 0.6,
    max_tokens: 500
  });
  
  return response.choices[0]?.message?.content || draftText;
}

/**
 * 获取重写用的 system prompt
 */
function getRewriteSystemPrompt(
  style: ResponseStyle, 
  level: QuestionLevel,
  action?: 'rewrite' | 'force_generate' | 'force_close',
  userState?: UserStateAnalysis
): string {
  // EXPRESSION_HELP 特殊处理：force_generate 和 force_close
  if (style === ResponseStyle.EXPRESSION_HELP) {
    if (action === 'force_close') {
      return `你需要重写一段回复，作为"表达辅助-收尾确认"：
用户已经表示满意（说了"${userState?.closingSignalKeywords?.join('、') || '可以/OK'}"）。
- 禁止出现任何问号
- 禁止问"这个指什么"、"具体是什么"
- 只需简单确认收口，例如：
  - "好的，你可以直接发这段。"
  - "收到，需要的话可以随时找我微调。"
- 可选提供 1-2 个无问号的微调选项（更柔和/更直接/更简短），但不强求
输出要求：简洁、温和、不追问`;
    }
    
    if (action === 'force_generate') {
      return `你需要重写一段回复，作为"表达辅助-直接产出"：
用户已经给过要点（说了"${userState?.taskSpecifiedKeywords?.join('、') || '刚才说的'}"），上下文已足够。
- 禁止出现任何问号
- 禁止要求用户复述内容（禁止说"请把内容发给我"、"具体内容是什么"）
- 直接根据对话上下文中用户已提供的要点，产出成稿
- 如果信息不完整，用括号占位符提示可选补充（不提问），例如：
  "（如果需要，我可以再加一句更柔和的开头）"
- 输出可直接复制使用的话术
输出要求：直接给成稿，温和但不提问`;
    }
    
    // 默认 EXPRESSION_HELP rewrite
    return `你需要重写一段回复，使其符合"表达辅助"模式：
- 最多只能有 1 个问号
- 这个问题必须是场景补全型（对象/目的/语气）
- 先识别用户原意，再给更清晰的表达版本
- 禁止深挖动机、童年、原生家庭
- 禁止要求用户复述已说过的内容
- 不改变用户观点`;
  }

  const directnessReminder = `
- 如果用户在问具体问题、索要观点、评价、解释或分析，先直接回答，再补理解
- 理解/共情只能跟在答案后面，不能代替答案
- 如果用户说“我在测试你的回复”或“respond exactly as I asked”，切换到精确直答模式
- 减少套话开头，例如“你似乎 / 你好像 / 你在意 / 也许你 / you seem to / it seems like”`;

  switch (style) {
    case ResponseStyle.MIRROR:
      return `你需要重写一段回复，使其符合“镜子”模式：
- 禁止出现任何问号（?/?）
- 不推进话题
- 不做人格判断
- 不给建议
- 不机械复述用户原句
- 只映射用户观点，并表达理解
- 当用户明确在提问时，要先答问题，再做轻度映射
${directnessReminder}
输出要求：纯陈述句，贴近用户原意，让用户感到被理解`;

    case ResponseStyle.ORGANIZER:
      return `你需要重写一段回复，使其符合“整理者”模式：
- 禁止出现问号
- 提取逻辑链
- 归纳思路
- 用清晰结构表达
- 不进行心理分析
输出要求：结构清晰，可以使用箭头、层次或要点`;

    case ResponseStyle.GUIDE:
      if (level === 'deep') {
        return `你需要重写一段回复，使其符合“引导者”模式：
- 最多 2 个问号
- 先理解观点，再提出更深问题
- 问题必须扩展思考维度，而不是重复用户原话
- 禁止浅层情绪问题（例如"你感觉如何"）
- 禁止假深度开放题（"这让你想起什么"）
- 当用户明确在提问时，要先答问题，再继续推进
${directnessReminder}
- 不给结论`;
      }
      return `你需要重写一段回复，使其符合“引导者”模式：
- 最多 1 个问号
- 先理解观点，再提出 1 个更深的问题
- 这个问题必须推进思考，而不是重复原观点
- 禁止浅层情绪问题
- 禁止假深度开放题
- 当用户明确在提问时，要先答问题，再继续推进
${directnessReminder}
- 不给结论`;

    default:
      return '请简化回复，移除所有问句。';
  }
}

/**
 * 获取 system prompt 注入片段
 */
export function getSystemPromptInjection(style: ResponseStyle, level: QuestionLevel): string {
  const directnessRules = `- 如果用户在问具体问题、索要观点、评价、解释或分析，必须先直接回答问题
- 理解与共情只能放在答案之后，不能替代答案
- 如果用户说“我在测试你的回复”或“respond exactly as I asked”，切换到精确直答模式：直接、准确、少铺垫
- 减少公式化开头，例如“你似乎 / 你好像 / 你在意 / 也许你 / you seem to / it seems like”`;

  switch (style) {
    case ResponseStyle.MIRROR:
      return `【回应要求 - 严格执行】
你是“镜子”。
- 任务：照见用户的想法，让用户感到被理解
- 回答原则：当用户在提问时，先答问题，再做轻度映射
- ${directnessRules}
- 不要推进话题
- 不要分析用户人格
- 不要提出复杂问题，也不要出现问号
- 不要给建议或结论
- 不要机械重复用户原句
- 只需映射用户的观点，并表达理解
违反以上任一条将被系统拦截重写。`;

    case ResponseStyle.ORGANIZER:
      return `【回应要求 - 严格执行】
你是“整理者”。
- 任务：把用户的想法整理成清晰结构
- 提取逻辑链
- 归纳思路
- 清晰表达
- 不进行心理分析
- 不出现问号
违反以上任一条将被系统拦截重写。`;

    case ResponseStyle.EXPRESSION_HELP:
      return `【回应要求 - 严格执行】
你是“表达辅助”。
- 任务：帮助用户把想法表达得更清晰、更有力量
- 优化语言
- 提供表达版本
- 不改变用户观点
- 不替用户换思想，只帮用户换表达
- 如果上下文已足够，直接给版本，不要索要重复内容
- 信息不完整时，先给一个可用版本
- 最多只能问 1 个场景补全问题
违反以上任一条将被系统拦截重写。`;

    case ResponseStyle.GUIDE:
      if (level === 'deep') {
        return `【回应要求 - 严格执行】
你是“引导者”。
- 任务：帮助用户更深入思考问题
- 回答原则：如果用户在问你的观点、判断、解释或分析，先直接回答，再继续推进
- ${directnessRules}
- 先理解观点，再提出更深问题
- 问题必须扩展思考维度，而不是重复用户原话
- 允许最多 2 个问题
- 不给结论
- 不做心理分析
- 禁止浅层情绪问题
- 禁止假深度开放题
违反以上任一条将被系统拦截重写。`;
      }
      return `【回应要求 - 严格执行】
你是“引导者”。
- 任务：帮助用户更深入思考问题
- 回答原则：如果用户在问你的观点、判断、解释或分析，先直接回答，再继续推进
- ${directnessRules}
- 先理解观点，再提出 1 个更深的问题
- 这个问题必须推进思考，而不是重复原观点
- 不给结论
- 不做心理分析
- 禁止浅层情绪问题
- 禁止假深度开放题
违反以上任一条将被系统拦截重写。`;

    default:
      return '';
  }
}

// ========================
// 主处理流程
// ========================

/**
 * Question Gate 主处理函数
 * 
 * 在 Lambda handler 中调用：
 * 1. pre-process: 分析用户状态，决定策略
 * 2. call OpenAI
 * 3. post-process: 检查回复，必要时重写
 */
export async function processWithQuestionGate(
  userText: string,
  recentTurns: Array<{ role: string; text: string }>,
  requestedStyle: ResponseStyle,
  consecutiveQuestionTurns: number,
  openaiClient: any,
  baseSystemPrompt: string
): Promise<{
  reply: string;
  debug: QuestionGateResult;
}> {
  
  // Step 1: 分析用户状态
  const userState = analyzeUserState(userText, recentTurns);
  
  // Step 2: 决定最终 style（降级逻辑）
  let finalStyle = requestedStyle;
  let downgraded = false;
  let downgradeReason: string | undefined;
  
  if (userState.isDistressed) {
    finalStyle = ResponseStyle.MIRROR;
    downgraded = true;
    downgradeReason = `用户情绪不稳（命中: ${userState.distressedKeywords.join(', ')}）`;
  }
  
  // Step 3: 获取配置
  const config = getPolicyConfig(finalStyle);
  const questionLevel: QuestionLevel = config.maxQuestionsPerTurn === 0 
    ? 'no_questions' 
    : (userState.isAskingForDeepDive ? 'deep' : 'light');
  
  // Step 4: 构建 system prompt
  const styleInjection = getSystemPromptInjection(finalStyle, questionLevel);
  const fullSystemPrompt = `${baseSystemPrompt}\n\n${styleInjection}`;
  
  // Step 5: 调用 OpenAI
  const messages = [
    { role: 'system', content: fullSystemPrompt },
    ...recentTurns.map(t => ({ role: t.role, content: t.text })),
    { role: 'user', content: userText }
  ];
  
  const completion = await openaiClient.chat.completions.create({
    model: 'gpt-4.1',
    messages,
    temperature: 0.6,
    max_tokens: 800
  });
  
  let reply = completion.choices[0]?.message?.content || '';
  
  // Step 6: 检查合规性
  const policyState: PolicyState = {
    responseStyle: finalStyle,
    originalStyle: requestedStyle,
    questionLevel,
    userState,
    consecutiveQuestionTurns,
    downgraded,
    downgradeReason
  };
  
  const check = checkAssistantDraft(reply, policyState, config);
  
  // Step 7: 不合规则重写
  let action: 'pass' | 'rewrite' | 'downgrade_to_mirror' | 'force_generate' | 'force_close' = check.action;
  
  if (downgraded) {
    action = 'downgrade_to_mirror';
  }
  
  if (!check.ok) {
    // 根据 check.action 决定如何重写
    if (check.action === 'force_generate' || check.action === 'force_close' || check.action === 'rewrite') {
      reply = await rewriteToCompliant(
        reply, 
        policyState, 
        config, 
        userText, 
        openaiClient,
        check.action,
        recentTurns
      );
      action = check.action;
    }
  }
  
  // Step 8: 返回结果
  const debug: QuestionGateResult = {
    responseStyle: finalStyle,
    originalStyle: requestedStyle,
    isDistressed: userState.isDistressed,
    isAskingForDeepDive: userState.isAskingForDeepDive,
    isTaskAlreadySpecified: userState.isTaskAlreadySpecified,
    isUserClosingSignal: userState.isUserClosingSignal,
    questionCount: countQuestions(reply),
    consecutiveQuestionTurns,
    action,
    reasons: check.reasons
  };
  
  return { reply, debug };
}

// ========================
// Lambda Handler 示例
// ========================

/*
import { APIGatewayProxyHandler } from 'aws-lambda';
import OpenAI from 'openai';

const openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY });

export const handler: APIGatewayProxyHandler = async (event) => {
  const body = JSON.parse(event.body || '{}');
  const { 
    text, 
    language, 
    responseStyle, 
    userPreferenceQuestionLevel,
    recentTurns = [],
    conversationHistory = recentTurns,
    clientAnalysis 
  } = body;
  
  // 从 session 或数据库获取 consecutiveQuestionTurns
  const consecutiveQuestionTurns = 0; // TODO: 从存储获取
  
  const baseSystemPrompt = language === 'zh' 
    ? '你是 Seen App 的 AI 助手，用温和、不评判的方式陪伴用户表达。'
    : 'You are Seen App AI assistant, accompanying users with warmth and without judgment.';
  
  const result = await processWithQuestionGate(
    text,
    conversationHistory,
    responseStyle as ResponseStyle,
    consecutiveQuestionTurns,
    openai,
    baseSystemPrompt
  );
  
  // 更新 consecutiveQuestionTurns 到存储
  // TODO: 保存 countQuestions(result.reply) > 0 ? consecutiveQuestionTurns + 1 : 0
  
  return {
    statusCode: 200,
    headers: {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*'
    },
    body: JSON.stringify({
      reply: result.reply,
      response_id: `${Date.now()}`,
      // 开发环境返回 debug 信息
      debug: process.env.NODE_ENV === 'development' ? result.debug : undefined
    })
  };
};
*/

export default {
  analyzeUserState,
  getPolicyConfig,
  checkAssistantDraft,
  rewriteToCompliant,
  getSystemPromptInjection,
  processWithQuestionGate,
  isTaskAlreadySpecified,
  isUserClosingSignal,
  hasRequestContentPattern
};

