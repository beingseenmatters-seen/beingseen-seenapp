import { apiClient } from './apiClient';
import { 
  ResponseStyle,
  type ResponseStyleType,
  type ReflectRequestPayload, 
  type ReflectAction,
  type ReflectDebug,
  type ReflectResponseWithDebug 
} from '../types/responseStyle';
import { analyzeUserState, resolveStyleAndLevel } from './questionGate';
import { mapStyleToSelectedMode } from './reflectStyle';

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
export async function sendReflectWithGate(
  text: string,
  language: string = 'zh',
  selectedMode: number | null,
  recentTurns: Array<{ role: 'user' | 'ai'; text: string }> = [],
  keepContext: boolean = false,
  sessionId?: string,
  meta?: { isNewSession?: boolean; action?: ReflectAction; resolvedStyle?: ResponseStyleType }
): Promise<ReflectResponseWithDebug> {
  
  // 1. 分析用户状态
  const userState = analyzeUserState(text, recentTurns);
  console.log('[SeenAPI] User state analysis:', userState);
  
  // 2. 获取存储的偏好
  const savedPreference = JSON.parse(localStorage.getItem('seen_ai_preference') || '{}');

  // If caller provides a resolvedStyle, force it via selectedMode mapping
  const selectedModeForGate = meta?.resolvedStyle ? mapStyleToSelectedMode(meta.resolvedStyle) : selectedMode;
  
  // 3. 决定最终 style 和 level（包括降级逻辑）
  const { style, level, downgraded, reason } = resolveStyleAndLevel(
    selectedModeForGate, 
    savedPreference, 
    userState
  );
  
  if (downgraded) {
    console.log('[SeenAPI] Style downgraded:', reason);
  }

  const conversationHistory = recentTurns;
  
  // 4. 构建完整的请求 payload
  const payload: ReflectRequestPayload = {
    text,
    language,
    responseStyle: style,
    userPreferenceQuestionLevel: level,
    // Always send the full in-session conversation history so Mirror can maintain continuity.
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
        responseStyle: style,
        originalStyle: style,
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
          responseStyle: style
        }
      } satisfies ReflectDebug;
    }
    
    return data as ReflectResponseWithDebug;
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
export function getModeString(selectedMode: number | null): string {
  const modeMapping: ResponseStyleType[] = [
    ResponseStyle.MIRROR, 
    ResponseStyle.ORGANIZER, 
    ResponseStyle.GUIDE, 
    ResponseStyle.EXPRESSION_HELP
  ];
  if (selectedMode !== null && selectedMode >= 0 && selectedMode < modeMapping.length) {
    return modeMapping[selectedMode];
  }
  // Fallback to saved preference or default
  const savedPref = JSON.parse(localStorage.getItem('seen_ai_preference') || '{}');
  return savedPref.role || 'mirror';
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
