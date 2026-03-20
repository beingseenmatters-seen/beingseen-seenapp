/**
 * ResponseStyle - 与 UI 四个站位完全一致
 * 
 * Reflect 页按钮映射:
 *   只被倾听（不分析） => MIRROR
 *   帮我理清思路       => ORGANIZER
 *   帮我看见盲点       => GUIDE
 *   帮我整理成更适合与他人沟通的表达 => EXPRESSION_HELP
 * 
 * Me 页默认偏好映射:
 *   镜子     => MIRROR
 *   整理者   => ORGANIZER
 *   表达辅助 => EXPRESSION_HELP
 *   引导者   => GUIDE
 */

export const ResponseStyle = {
  MIRROR: 'mirror',           // 镜子：Reflect，让用户被理解
  ORGANIZER: 'organizer',     // 整理者：Structure，帮用户理清思路
  EXPRESSION_HELP: 'helper',  // 表达辅助：Expression，帮用户表达更好
  GUIDE: 'guide'              // 引导者：Exploration，帮用户深入思考
} as const;

export type ResponseStyleType = typeof ResponseStyle[keyof typeof ResponseStyle];
export type CognitiveFunction = 'reflect' | 'structure' | 'expression' | 'exploration';

export function getCognitiveFunctionForStyle(style: ResponseStyleType): CognitiveFunction {
  switch (style) {
    case ResponseStyle.MIRROR:
      return 'reflect';
    case ResponseStyle.ORGANIZER:
      return 'structure';
    case ResponseStyle.EXPRESSION_HELP:
      return 'expression';
    case ResponseStyle.GUIDE:
      return 'exploration';
  }
}

/**
 * 用户授权深挖的级别
 */
export type QuestionLevel = 'no_questions' | 'light' | 'deep';

export type ReflectAction = 'continue' | 'cleared' | 'new_session';

/**
 * 单个站位的追问策略配置
 */
export interface QuestionPolicyConfig {
  maxQuestionsPerTurn: number;          // 本轮允许问题数
  maxConsecutiveQuestionTurns: number;  // 连续含问句轮数上限
  allowedQuestionTypes: QuestionType[]; // 允许的问题类型
  forbiddenPatterns: string[];          // 禁止的输出模式
  outputStructure: string;              // 输出结构要求
  requiresAuthorization: boolean;       // 是否需要用户授权才能深挖
}

/**
 * 问题类型
 */
export type QuestionType = 
  | 'none'           // 不允许问句
  | 'clarify'        // 澄清型（二选一/是否/补充事实）
  | 'scene'          // 场景补全型（对象/目的/语气）
  | 'authorization'  // 授权式（你想继续深挖还是先停？）
  | 'retrospect'     // 回望式（是/否或二选一，不能开放发散）
  | 'mirror_confirm'; // 镜像式确认

/**
 * 用户状态分析结果
 */
export interface UserStateAnalysis {
  isDistressed: boolean;            // 用户情绪是否不稳
  isAskingForDeepDive: boolean;     // 用户是否明确授权深挖
  isTaskAlreadySpecified?: boolean; // EXPRESSION_HELP: 用户已给过要点，不需要再问
  isUserClosingSignal?: boolean;    // 用户发出收尾信号（满意/不需要修改）
  prefersDirectMode?: boolean;      // 用户要求精确、直接回答
  needsDirectAnswer?: boolean;      // 用户明确在要观点/分析/评价/解释
  distressedKeywords: string[];     // 命中的情绪词
  deepDiveKeywords: string[];       // 命中的深挖授权词
  taskSpecifiedKeywords?: string[]; // 命中的"任务已指定"词
  closingSignalKeywords?: string[]; // 命中的收尾信号词
  directModeKeywords?: string[];    // 命中的直接模式词
  directAnswerKeywords?: string[];  // 命中的直答意图词
  contextSufficient?: boolean;      // 上下文是否已足够（AI曾总结/用户曾给列表）
}

/**
 * Question Gate 处理结果
 */
export interface QuestionGateResult {
  responseStyle: ResponseStyleType;
  originalStyle: ResponseStyleType;
  isDistressed: boolean;
  isAskingForDeepDive: boolean;
  isTaskAlreadySpecified?: boolean;  // EXPRESSION_HELP: 任务已充分给定
  isUserClosingSignal?: boolean;     // 用户发出收尾信号
  questionCount: number;
  consecutiveQuestionTurns: number;
  action: 'pass' | 'rewrite' | 'downgrade_to_mirror' | 'force_generate' | 'force_close';
  reasons: string[];
  rewrittenText?: string;
}

export interface ReflectDebugInfo {
  keepContext: boolean;
  sessionId?: string;
  conversationId?: string;
  isNewSession: boolean;
  action: ReflectAction;
  responseStyle: ResponseStyleType;
}

export interface ReflectDebug {
  questionGate: QuestionGateResult;
  reflect: ReflectDebugInfo;
}

/**
 * 聊天请求 payload（发送给后端）
 */
export interface ReflectRequestPayload {
  text: string;
  language: string;
  responseStyle: ResponseStyleType;
  userPreferenceQuestionLevel: QuestionLevel;
  // Full conversation history before the current user turn.
  conversationHistory?: Array<{ role: 'user' | 'ai'; text: string }>;
  recentTurns?: Array<{ role: 'user' | 'ai'; text: string }>;
  keepContext?: boolean;
  sessionId?: string;
  // Debug 信息（前端预分析）
  clientAnalysis?: {
    isDistressed: boolean;
    isAskingForDeepDive: boolean;
  };
}

/**
 * API 响应（包含 debug 信息）
 */
export interface ReflectResponseWithDebug {
  reply: string;
  response_id: string;
  debug?: ReflectDebug;
}
