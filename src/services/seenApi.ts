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

// In production (iOS App), use direct AWS API URL
// In development, use proxy path to avoid CORS issues
const API_URL = import.meta.env.PROD 
  ? 'https://rtbzs3sjwe.execute-api.ap-southeast-2.amazonaws.com/reflect/send'
  : '/api/reflect/send';
const APP_KEY = 'test_seen_app_key';

/**
 * 发送 Reflect 请求 - 基础版本（兼容旧代码）
 */
export async function sendReflect(
  text: string, 
  language: string = 'zh', 
  mode: string = 'mirror'
): Promise<ReflectResponse> {
  console.log('[SeenAPI] Sending request to:', API_URL);
  console.log('[SeenAPI] Payload:', { text, language, mode });
  
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), 30000); // 30 second timeout
    
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Seen-App-Key': APP_KEY,
        'Accept': 'application/json'
      },
      body: JSON.stringify({
        text,
        language,
        mode
      }),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);

    console.log('[SeenAPI] Response status:', response.status);
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'No response body');
      console.error('[SeenAPI] Error response:', errorText);
      throw new Error(`API ${response.status}: ${errorText}`);
    }

    const data = await response.json();
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
 * 
 * 新增功能：
 * 1. 前端分析用户状态（情绪、深挖授权）
 * 2. 自动决定 responseStyle 和 questionLevel
 * 3. 传递完整参数给后端
 * 4. 返回 debug 信息（开发环境）
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
    
    const response = await fetch(API_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Seen-App-Key': APP_KEY,
        'Accept': 'application/json'
      },
      body: JSON.stringify(payload),
      signal: controller.signal
    });
    
    clearTimeout(timeoutId);
    
    if (!response.ok) {
      const errorText = await response.text().catch(() => 'No response body');
      console.error('[SeenAPI] Error response:', errorText);
      throw new Error(`API ${response.status}: ${errorText}`);
    }
    
    const data = await response.json();
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
