import { apiClient } from './apiClient';
import { 
  ResponseStyle,
  type ResponseStyleType,
  type ReflectRequestPayload, 
  type ReflectAction,
  type ReflectDebug,
  type ReflectResponseWithDebug 
} from '../types/responseStyle';
import { analyzeUserState, resolveModeAndLevel } from './questionGate';
import { getReflectDefaultStyle } from './reflectStyle';
import {
  ResponseMode,
  type ResponseModeType,
  fromLegacySelectedMode,
  normalizeResponseMode,
  toLegacyResponseStyle,
} from '../types/responseMode';

export interface ReflectResponse {
  reply: string;
  response_id: string;
}

/**
 * 发送 Reflect 请求 - 基础版本（兼容旧代码）
 */
export async function sendReflect(
  text: string, 
  language: string = 'zh', 
  mode: string = 'mirror'
): Promise<ReflectResponse> {
  console.log('[SeenAPI] Sending request to /reflect/send');
  console.log('[SeenAPI] Payload:', { text, language, mode });
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    
    const data = await apiClient('/reflect/send', {
      method: 'POST',
      data: {
        text,
        language,
        mode
      },
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    console.log('[SeenAPI] Success:', data);
    return data as ReflectResponse;
  } catch (error: unknown) {
    const err = error as Error & { name?: string };
    console.error('[SeenAPI] Fetch error:', err);
    
    // More specific error messages
    if (err.name === 'AbortError') {
      throw new Error('请求超时，请检查网络连接');
    }
    if (err.message?.includes('Load failed') || err.message?.includes('network')) {
      throw new Error('网络连接失败，请检查网络设置');
    }
    
    throw error;
  }
}

/**
 * 发送 Reflect 请求 - 带 Question Gate 增强版本
 */
/**
 * Turn-level mode metadata (Phase 2C): every reply reports which mode the
 * user requested for that turn and which mode was actually applied after
 * distress/question-gate overrides. Stored per turn, never rendered as
 * visible debug text.
 */
export interface ReflectTurnModeMeta {
  requestedMode: ResponseModeType;
  effectiveMode: ResponseModeType;
}

export async function sendReflectWithGate(
  text: string,
  language: string = 'zh',
  /** Canonical response mode requested for THIS turn; legacy numeric selectedMode (0–3) still accepted. */
  mode: ResponseModeType | number | null,
  recentTurns: Array<{ role: 'user' | 'ai'; text: string }> = [],
  keepContext: boolean = false,
  sessionId?: string,
  meta?: {
    isNewSession?: boolean;
    action?: ReflectAction;
  }
): Promise<ReflectResponseWithDebug & ReflectTurnModeMeta> {
  
  // 1. 分析用户状态
  const userState = analyzeUserState(text, recentTurns);
  console.log('[SeenAPI] User state analysis:', userState);
  
  // 2. 归一化为 canonical mode（legacy 数字索引 / legacy 字符串都安全落地）
  const requestedMode: ResponseModeType =
    typeof mode === 'number'
      ? fromLegacySelectedMode(mode) ?? ResponseMode.REFLECT
      : normalizeResponseMode(mode);

  // 3. 决定最终 mode 和 level（distress override 最高优先级）
  const { mode: finalMode, level, downgraded, reason } = resolveModeAndLevel(
    requestedMode,
    userState
  );
  
  if (downgraded) {
    console.log('[SeenAPI] Mode downgraded:', reason);
  }

  const conversationHistory = recentTurns;
  
  // 4. 构建完整的请求 payload。
  // 双写：canonical `responseMode`（新后端）+ legacy `responseStyle`（当前已
  // 部署后端仍按 mirror/organizer/helper/guide 解析）。CONNECT 没有 legacy
  // 等价值 —— 旧后端对未知值会安全回退到 mirror。
  const legacyStyle = toLegacyResponseStyle(finalMode);
  const payload: ReflectRequestPayload = {
    text,
    language,
    responseMode: finalMode,
    ...(legacyStyle ? { responseStyle: legacyStyle } : {}),
    userPreferenceQuestionLevel: level,
    // Always send the full in-session conversation history so continuity is maintained.
    conversationHistory,
    recentTurns: conversationHistory,
    keepContext,
    sessionId,
    clientAnalysis: {
      isDistressed: userState.isDistressed,
      isAskingForDeepDive: userState.isAskingForDeepDive
    }
  };
  
  console.log('[SeenAPI] Full payload:', payload);
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000);
    
    const data = await apiClient('/reflect/send', {
      method: 'POST',
      data: payload,
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    console.log('[SeenAPI] Success with gate:', data);
    
    // Dev: normalize debug shape (questionGate + reflect)
    if (import.meta.env.DEV) {
      const isNewSession = Boolean(meta?.isNewSession);
      const reflectAction: ReflectAction = meta?.action ?? (isNewSession ? 'new_session' : 'continue');

      const fallbackQuestionGate = {
        responseStyle: finalMode,
        originalStyle: requestedMode,
        isDistressed: userState.isDistressed,
        isAskingForDeepDive: userState.isAskingForDeepDive,
        questionCount: 0, // backend may fill
        consecutiveQuestionTurns: 0,
        action: downgraded ? 'downgrade_to_mirror' : 'pass',
        reasons: downgraded && reason ? [reason] : []
      };

      const existingDebug = data?.debug;
      const questionGate =
        existingDebug && typeof existingDebug === 'object' && 'questionGate' in existingDebug
          ? (existingDebug as ReflectDebug).questionGate
          : (existingDebug && typeof existingDebug === 'object' && 'responseStyle' in existingDebug
              ? (existingDebug as any)
              : fallbackQuestionGate);

      data.debug = {
        questionGate,
        reflect: {
          keepContext,
          sessionId,
          conversationId: sessionId,
          isNewSession,
          action: reflectAction,
          responseStyle: finalMode
        }
      } satisfies ReflectDebug;
    }
    
    // Turn-level metadata: requested = user's selection for this turn,
    // effective = what was actually applied after distress/gate overrides.
    return {
      ...(data as ReflectResponseWithDebug),
      requestedMode,
      effectiveMode: finalMode,
    };
  } catch (error: unknown) {
    const err = error as Error & { name?: string };
    console.error('[SeenAPI] Fetch error:', err);
    
    if (err.name === 'AbortError') {
      throw new Error('请求超时，请检查网络连接');
    }
    if (err.message?.includes('Load failed') || err.message?.includes('network')) {
      throw new Error('网络连接失败，请检查网络设置');
    }
    
    throw error;
  }
}

/**
 * 辅助函数：从 selectedMode 获取 ResponseStyle 字符串
 * 用于兼容旧的 sendReflect 函数
 */
export function getModeString(
  selectedMode: number | null,
  aiPreference?: { role?: string; responseStyle?: string } | null,
): string {
  const modeMapping: ResponseStyleType[] = [
    ResponseStyle.MIRROR, 
    ResponseStyle.ORGANIZER, 
    ResponseStyle.GUIDE, 
    ResponseStyle.EXPRESSION_HELP
  ];
  if (selectedMode !== null && selectedMode >= 0 && selectedMode < modeMapping.length) {
    return modeMapping[selectedMode];
  }
  return getReflectDefaultStyle(aiPreference) || ResponseStyle.MIRROR;
}

export interface ExtractSummaryRequest {
  uid: string;
  sessionId: string;
  conversation: Array<{ role: 'user' | 'ai' | 'system'; text: string }>;
  module: 'reflect';
  language: string;
}

export interface ExtractSummaryResponse {
  layers: {
    contentSummary?: string;
    emotion?: string;
    trigger?: string;
    values?: string;
    behaviorPattern?: string;
    decisionModel?: string;
    personalityTraits?: string;
    relationshipNeed?: string;
    motivation?: string;
    coreConflict?: string;
  };
  /** EX-001 gentle reflection — the only user-facing text. */
  reflection?: string;
  /** Internal-only synthesis of the 10 layers. Never shown to the user. */
  summary: string;
}

/**
 * Call backend to extract 10-layer structured summary from conversation
 */
export async function extractReflectSummary(
  request: ExtractSummaryRequest
): Promise<ExtractSummaryResponse> {
  console.log('[SeenAPI] Sending extract request to /reflect/extract');

  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 60000); // 60s timeout for LLM

    const data = await apiClient('/reflect/extract', {
      method: 'POST',
      data: request,
      signal: controller.signal
    });

    clearTimeout(timeoutId);
    console.log('[SeenAPI] Extract success:', data);
    return data as ExtractSummaryResponse;
  } catch (error: unknown) {
    const err = error as Error & { name?: string };
    console.error('[SeenAPI] Extract fetch error:', err);

    if (err.name === 'AbortError') {
      throw new Error('提取超时，请检查网络连接');
    }
    throw error;
  }
}
