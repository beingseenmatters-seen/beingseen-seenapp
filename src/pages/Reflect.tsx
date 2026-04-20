import { useState, useEffect, useRef, useCallback, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, ChevronRight, Info, Menu, RotateCcw, Trash2 } from 'lucide-react';
import { Link, useNavigate, useSearchParams } from 'react-router-dom';
import { useLanguage } from '../i18n';
import { useAuth } from '../auth';
import { usePlatform } from '../hooks/usePlatform';
import ChatInput from '../components/ChatInput';
import VoiceOverlay from '../components/VoiceOverlay';
import ReflectHistoryDrawer from '../components/ReflectHistoryDrawer';
import { sendReflectWithGate } from '../services/seenApi';
import { useVoiceRecorder } from '../hooks/useVoiceRecorder';
import { transcribeAudio } from '../services/voiceApi';
import { analyzeUserState } from '../services/questionGate';
import { ResponseStyle, type ReflectDebug, type ResponseStyleType } from '../types/responseStyle';
import type { RetentionOption } from '../types/insight';
import { saveConversation, getConversationById } from '../services/recentConversations';
import { useRecentConversations } from '../hooks/useRecentConversations';
import {
  mapSelectedModeToStyle,
  mapStyleToSelectedMode,
  getReflectDefaultStyle,
  resolveResponseStyleForReflect
} from '../services/reflectStyle';
import { 
  extractSummaryFromConversation, 
  formatInsightTag,
  hasMeaningfulExtraction, 
  saveApprovedSummary 
} from '../services/userSummary';
import type { ConversationExtraction } from '../types/userSummary';

interface Message {
  role: 'user' | 'ai' | 'system';
  text: string;
  debug?: ReflectDebug;
}

interface SavedSession {
  messages: Message[];
  step: number;
  keepContext: boolean;
  retention?: RetentionOption;
  sessionId: string;
  sessionStyle?: ResponseStyleType;
  consecutiveQuestionTurns: number;
  selectedMode: number | null;
  timestamp: number;
}

const STORAGE_KEY = 'seen_reflect_session';

export default function Reflect() {
  const [step, setStep] = useState(0);
  const { t, language, setLanguage, effectiveLanguage } = useLanguage();
  const { seenUser, firebaseUser } = useAuth();
  const { isDesktop, isNative } = usePlatform();
  const navigate = useNavigate();
  const [searchParams, setSearchParams] = useSearchParams();
  /**
   * Legacy banner used `understandingProgress < 6`; new onboarding does not increment that field, so the banner
   * was always on for new users and pushed desktop Web to /me/questions. Disabled — optional questions stay under Me.
   */
  const showUnderstandingBanner = false;
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedMode, setSelectedMode] = useState<number | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [lastDebug, setLastDebug] = useState<ReflectDebug | null>(null);
  const [consecutiveQuestionTurns, setConsecutiveQuestionTurns] = useState(0);
  
  const keepContext = true;
  const [retention, setRetention] = useState<RetentionOption>('3days');
  const [retentionDropdownOpen, setRetentionDropdownOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [sessionStyle, setSessionStyle] = useState<ResponseStyleType | undefined>(undefined);
  const [hasSavedSession, setHasSavedSession] = useState(false);

  // Role dropdown open/close
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [justCleared, setJustCleared] = useState(false);

  // Recent conversations for desktop sidebar + mobile drawer
  const { conversations: recentConversations } = useRecentConversations();

  // Voice input (mobile native only)
  const voice = useVoiceRecorder();
  const showMic = isNative && !isDesktop;

  const handleMicPress = useCallback(() => {
    voice.startRecording();
  }, [voice]);

  const handleMicRelease = useCallback(async () => {
    const result = await voice.stopRecording();
    if (!result) return; // error already set by hook (too short, etc.)
    try {
      const { text } = await transcribeAudio(
        result.base64,
        result.mimeType,
        effectiveLanguage === 'zh' ? 'zh' : 'en'
      );
      if (text) setInputValue(prev => prev ? `${prev} ${text}` : text);
      voice.resetToIdle();
    } catch (err) {
      console.error('[Voice] transcription error:', err);
      voice.setError('voice.error_transcribe');
    }
  }, [voice, effectiveLanguage]);

  const handleMicCancel = useCallback(() => {
    voice.cancelRecording();
  }, [voice]);

  const handleVoiceRetry = useCallback(() => {
    voice.resetToIdle();
    voice.startRecording();
  }, [voice]);

  const [userStatePreview, setUserStatePreview] = useState<{ isDistressed: boolean; isAskingForDeepDive: boolean }>({
    isDistressed: false,
    isAskingForDeepDive: false
  });

  const chatEndRef = useRef<HTMLDivElement>(null);

  const meDefaultStyle = useMemo(
    () => getReflectDefaultStyle(seenUser?.soulProfile?.aiPreference),
    [seenUser?.soulProfile?.aiPreference],
  );
  const effectiveSelectedMode =
    selectedMode !== null
      ? selectedMode
      : meDefaultStyle !== undefined
        ? mapStyleToSelectedMode(meDefaultStyle)
        : null;

  const [pendingSummary, setPendingSummary] = useState<ConversationExtraction | null>(null);
  const [showSummaryConfirmation, setShowSummaryConfirmation] = useState(false);
  const [isExtractingSummary, setIsExtractingSummary] = useState(false);
  const [pendingInsightAction, setPendingInsightAction] = useState<'clear' | 'finish' | 'leave' | 'new' | null>(null);

  // TODO (Spec §九): Lightweight calibration after conversation end
  const [calibrationInsight, setCalibrationInsight] = useState<{ key: string; text: string } | null>(null);

  const restoreConversationById = (convoId: string) => {
    const convo = getConversationById(convoId);
    if (!convo) return;

    setRoleDropdownOpen(false);
    setRetentionDropdownOpen(false);
    setMobileDrawerOpen(false);
    setMessages(convo.messages.map(m => ({ role: m.role, text: m.text })));
    setStep(2);
    setRetention(convo.retention);
    setSessionId(convo.id);
    setSessionStyle(convo.sessionStyle as ResponseStyleType | undefined);
    setSelectedMode(convo.selectedMode ?? null);
    setHasSavedSession(false);
    setJustCleared(false);
  };

  // Restore a retained conversation from URL ?conversation=<id>
  useEffect(() => {
    const convoId = searchParams.get('conversation');
    if (!convoId) return;

    setSearchParams({}, { replace: true });
    restoreConversationById(convoId);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load saved session on mount
  useEffect(() => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const session: SavedSession = JSON.parse(saved);
        if (session.keepContext) {
          setHasSavedSession(true);
        }
      } catch (e) {
        console.error('Failed to parse saved session', e);
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, []);

  useEffect(() => {
    if (sessionId) {
      const session: SavedSession = {
        messages,
        step,
        keepContext,
        retention,
        sessionId,
        sessionStyle,
        consecutiveQuestionTurns,
        selectedMode,
        timestamp: Date.now()
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));

      if (retention !== 'none' && messages.filter(m => m.role === 'user' && m.text.trim()).length > 0) {
        saveConversation(
          sessionId,
          messages.map(m => ({ role: m.role, text: m.text })),
          retention,
          effectiveLanguage === 'zh' ? 'zh' : 'en',
          { sessionStyle, selectedMode }
        );
      }
    }
  }, [messages, step, keepContext, retention, sessionId, sessionStyle, consecutiveQuestionTurns, selectedMode, effectiveLanguage]);

  useEffect(() => {
    if (inputValue.trim()) {
      const recentTurns = messages
        .filter(m => m.role !== 'system')
        .map(m => ({ role: m.role as 'user' | 'ai', text: m.text }));
      const state = analyzeUserState(inputValue, recentTurns);
      setUserStatePreview({
        isDistressed: state.isDistressed,
        isAskingForDeepDive: state.isAskingForDeepDive
      });
    } else {
      setUserStatePreview({ isDistressed: false, isAskingForDeepDive: false });
    }
  }, [inputValue, messages]);

  useEffect(() => {
    chatEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, isLoading]);

  const getRecentTurns = () => {
    return messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role as 'user' | 'ai', text: m.text }));
  };

  const handleContinueSession = () => {
    const saved = localStorage.getItem(STORAGE_KEY);
    if (saved) {
      try {
        const session: SavedSession = JSON.parse(saved);
        setMessages(session.messages);
        setStep(session.step === 0 ? 2 : session.step);
        setRetention(session.retention ?? '3days');
        setSessionId(session.sessionId);
        setSessionStyle(session.sessionStyle);
        setConsecutiveQuestionTurns(session.consecutiveQuestionTurns);
        setSelectedMode(session.selectedMode);
        setHasSavedSession(false);
        setJustCleared(false);
        setRoleDropdownOpen(false);
        setRetentionDropdownOpen(false);
        setMobileDrawerOpen(false);
        console.log('[Reflect] continue_session', { sessionId: session.sessionId, sessionStyle: session.sessionStyle });
      } catch (e) {
        console.error('Failed to restore session', e);
        handleClearContext();
      }
    }
  };

  const getConversationStats = () => {
    const userTurns = messages.filter(m => m.role === 'user' && m.text.trim()).length;
    const aiTurns = messages.filter(m => m.role === 'ai' && m.text.trim()).length;
    const meaningfulTurns = messages.filter(m => m.role !== 'system' && m.text.trim()).length;
    return { userTurns, aiTurns, meaningfulTurns };
  };

  const hasMeaningfulExchange = () => {
    const { userTurns, aiTurns, meaningfulTurns } = getConversationStats();
    return userTurns >= 2 && aiTurns >= 1 && meaningfulTurns >= 3;
  };

  const openSummaryConfirmation = async (action: 'clear' | 'finish' | 'leave' | 'new') => {
    setIsExtractingSummary(true);
    try {
      const extracted = await extractSummaryFromConversation(messages, {
        preferredResponseStyle: getStyleDisplayName(effectiveSelectedMode),
        language: effectiveLanguage === 'zh' ? 'zh' : 'en',
        uid: firebaseUser?.uid || seenUser?.uid || 'anonymous',
        sessionId: sessionId || 'unknown'
      });

      if (!hasMeaningfulExtraction(extracted)) {
        return false;
      }

      setPendingSummary(extracted);
      setPendingInsightAction(action);
      setShowSummaryConfirmation(true);
      return true;
    } catch (error) {
      console.error('[Reflect] Failed to extract summary:', error);
      return false;
    } finally {
      setIsExtractingSummary(false);
    }
  };

  const handleClearContext = async () => {
    if (messages.length > 0 && hasMeaningfulExchange()) {
      const opened = await openSummaryConfirmation('clear');
      if (opened) {
        return;
      }
    }
    performClear();
  };

  const handleStartNewConversation = async () => {
    if ((messages.length > 0 || hasSavedSession) && hasMeaningfulExchange()) {
      const opened = await openSummaryConfirmation('new');
      if (opened) {
        return;
      }
    }

    performClear();
    setStep(1);
  };

  const handleEndConversation = async () => {
    if (messages.length > 0 && hasMeaningfulExchange()) {
      const opened = await openSummaryConfirmation('finish');
      if (opened) {
        return;
      }
    }
    setStep(3);
  };

  const performClear = () => {
    localStorage.removeItem(STORAGE_KEY);
    setHasSavedSession(false);
    setRetention('3days');
    setSessionId(undefined);
    setSessionStyle(undefined);
    setMessages([]);
    setConsecutiveQuestionTurns(0);
    setJustCleared(true);
    setPendingSummary(null);
    setPendingInsightAction(null);
    setShowSummaryConfirmation(false);
    setRoleDropdownOpen(false);
    setRetentionDropdownOpen(false);
    setMobileDrawerOpen(false);
    
    if (step !== 0) {
      setStep(0);
    }
    console.log('[Reflect] cleared_context (raw chat deleted)');
  };

  const handleConfirmSummary = async () => {
    // Capture the current sessionId before it might get cleared
    const currentSessionId = sessionId;
    
    if (pendingSummary) {
      await saveApprovedSummary(
        pendingSummary,
        firebaseUser?.uid || seenUser?.uid,
        currentSessionId
      );
    }
    if (pendingInsightAction === 'new') {
      performClear();
      setStep(1);
      return;
    }
    if (pendingInsightAction === 'clear') {
      performClear();
      return;
    }
    setPendingSummary(null);
    setPendingInsightAction(null);
    setShowSummaryConfirmation(false);
    setStep(3);
  };

  const handleRejectSummary = () => {
    if (pendingInsightAction === 'new') {
      performClear();
      setStep(1);
      return;
    }
    if (pendingInsightAction === 'clear') {
      performClear();
      return;
    }
    setPendingSummary(null);
    setPendingInsightAction(null);
    setShowSummaryConfirmation(false);
    setStep(3);
  };

  const getResolvedStyleForRequest = (args: { isNewSession: boolean }) => {
    const reflectSelectedStyle = mapSelectedModeToStyle(selectedMode);
    const meDefault = getReflectDefaultStyle(seenUser?.soulProfile?.aiPreference);
    const resolvedStyle = resolveResponseStyleForReflect({
      reflectSelectedStyle,
      meDefaultStyle: meDefault,
      sessionStyle,
      keepContext,
      isNewSession: args.isNewSession
    });
    return { resolvedStyle, reflectSelectedStyle, meDefaultStyle: meDefault };
  };

  const handleReply = async () => {
    if (!inputValue.trim()) return;

    setRoleDropdownOpen(false);
    setRetentionDropdownOpen(false);
    const currentInput = inputValue;
    setMessages(prev => [...prev, { role: 'user', text: currentInput }]);
    setInputValue('');
    setIsLoading(true);
    
    try {
      const recentTurns = getRecentTurns();
      const { resolvedStyle } = getResolvedStyleForRequest({ isNewSession: false });
      const selectedModeForRequest = effectiveSelectedMode !== null 
        ? effectiveSelectedMode 
        : mapStyleToSelectedMode(resolvedStyle);

      const response = await sendReflectWithGate(
        currentInput, 
        effectiveLanguage === 'zh' ? 'zh' : 'en', 
        selectedModeForRequest,
        recentTurns,
        keepContext,
        sessionId,
        {
          isNewSession: false,
          action: 'continue',
          resolvedStyle,
          aiPreference: seenUser?.soulProfile?.aiPreference,
        }
      );
      
      const hasQuestion = response.reply.includes('?') || response.reply.includes('？');
      if (hasQuestion) {
        setConsecutiveQuestionTurns(prev => prev + 1);
      } else {
        setConsecutiveQuestionTurns(0);
      }
      
      if (response.debug) setLastDebug(response.debug);
      setMessages(prev => [...prev, { role: 'ai', text: response.reply, debug: response.debug }]);
    } catch (error: unknown) {
      console.error('API Error:', error);
      const errorMessage = (error as Error)?.message || 'Unknown error';
      setMessages(prev => [...prev, { role: 'system', text: `请稍后再试: ${errorMessage}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const handleSend = async () => {
    if (!inputValue.trim()) return;
    
    setRoleDropdownOpen(false);
    setRetentionDropdownOpen(false);
    setStep(2);
    setConsecutiveQuestionTurns(0);
    setJustCleared(false);
    setMessages([{ role: 'user', text: inputValue }]);
    
    const nextSessionId = keepContext ? crypto.randomUUID() : undefined;
    setSessionId(nextSessionId);

    const currentInput = inputValue;
    setInputValue('');
    setIsLoading(true);
    
    try {
      const { resolvedStyle, reflectSelectedStyle } = getResolvedStyleForRequest({ isNewSession: true });
      const selectedModeForRequest = effectiveSelectedMode !== null 
        ? effectiveSelectedMode 
        : mapStyleToSelectedMode(resolvedStyle);
      
      console.log('[Reflect] handleSend', { 
        selectedMode, 
        effectiveSelectedMode, 
        meDefaultStyle, 
        resolvedStyle, 
        selectedModeForRequest 
      });

      if (keepContext) {
        const toLock = reflectSelectedStyle ?? resolvedStyle ?? ResponseStyle.MIRROR;
        setSessionStyle(toLock);
      } else {
        setSessionStyle(undefined);
      }

      const response = await sendReflectWithGate(
        currentInput, 
        effectiveLanguage === 'zh' ? 'zh' : 'en', 
        selectedModeForRequest,
        [],
        keepContext,
        nextSessionId,
        {
          isNewSession: true,
          action: 'new_session',
          resolvedStyle,
          aiPreference: seenUser?.soulProfile?.aiPreference,
        }
      );
      
      const hasQuestion = response.reply.includes('?') || response.reply.includes('？');
      if (hasQuestion) {
        setConsecutiveQuestionTurns(1);
      }
      
      if (response.debug) setLastDebug(response.debug);
      setMessages(prev => [...prev, { role: 'ai', text: response.reply, debug: response.debug }]);
    } catch (error: unknown) {
      console.error('API Error:', error);
      const errorMessage = (error as Error)?.message || 'Unknown error';
      setMessages(prev => [...prev, { role: 'system', text: `Debug Error: ${errorMessage}` }]);
    } finally {
      setIsLoading(false);
    }
  };

  const fadeIn = {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -6 },
    transition: { duration: 0.4, ease: "easeOut" as const }
  };

  const roleOptions = [
    { label: t('reflect.opt_listen') },
    { label: t('reflect.opt_clarify') },
    { label: t('reflect.opt_blindspot') },
    { label: t('reflect.opt_polish') }
  ];

  const getStyleDisplayName = (mode: number | null): string => {
    if (mode === null) return effectiveLanguage === 'zh' ? '镜子' : 'Mirror';
    const styleNames = effectiveLanguage === 'zh' 
      ? ['镜子', '整理者', '引导者', '表达辅助']
      : ['Mirror', 'Organizer', 'Guide', 'Expression Helper'];
    return styleNames[mode] || styleNames[0];
  };

  const sessionCompletionReached = hasMeaningfulExchange();
  const endConversationLabel = effectiveLanguage === 'zh' ? '结束对话' : 'End conversation';

  const formatSummaryTag = (key: string): string =>
    formatInsightTag(key, effectiveLanguage === 'zh' ? 'zh' : 'en');

  const summarySections = pendingSummary
    ? [
        // Legacy local extraction fields
        { key: 'thinkingPath', label: effectiveLanguage === 'zh' ? '你的思考路径' : 'Your Thinking Path', values: pendingSummary.thinkingPath },
        { key: 'thinkingStyle', label: effectiveLanguage === 'zh' ? '你的思考方式' : 'Your Thinking Style', values: pendingSummary.thinkingStyle },
        { key: 'coreQuestions', label: effectiveLanguage === 'zh' ? '你的核心问题' : 'Your Core Questions', values: pendingSummary.coreQuestions },
        { key: 'worldview', label: effectiveLanguage === 'zh' ? '你的世界观' : 'Your Worldview', values: pendingSummary.worldview },
        { key: 'relationshipPhilosophy', label: effectiveLanguage === 'zh' ? '你的关系哲学' : 'Your Relationship Philosophy', values: pendingSummary.relationshipPhilosophy },
        { key: 'conversationStyle', label: effectiveLanguage === 'zh' ? '你的对话风格' : 'Your Conversation Style', values: pendingSummary.conversationStyle },
        
        // New 10-layer LLM extraction fields
        { key: 'emotion', label: effectiveLanguage === 'zh' ? '情绪状态' : 'Emotion', values: pendingSummary.emotion ? [pendingSummary.emotion] : [] },
        { key: 'trigger', label: effectiveLanguage === 'zh' ? '核心触发点' : 'Trigger', values: pendingSummary.trigger ? [pendingSummary.trigger] : [] },
        { key: 'values', label: effectiveLanguage === 'zh' ? '底层价值观' : 'Values', values: pendingSummary.values ? [pendingSummary.values] : [] },
        { key: 'behaviorPattern', label: effectiveLanguage === 'zh' ? '行为模式' : 'Behavior Pattern', values: pendingSummary.behaviorPattern ? [pendingSummary.behaviorPattern] : [] },
        { key: 'decisionModel', label: effectiveLanguage === 'zh' ? '决策模型' : 'Decision Model', values: pendingSummary.decisionModel ? [pendingSummary.decisionModel] : [] },
        { key: 'personalityTraits', label: effectiveLanguage === 'zh' ? '性格特质' : 'Personality Traits', values: pendingSummary.personalityTraits ? [pendingSummary.personalityTraits] : [] },
        { key: 'relationshipNeed', label: effectiveLanguage === 'zh' ? '关系需求' : 'Relationship Need', values: pendingSummary.relationshipNeed ? [pendingSummary.relationshipNeed] : [] },
        { key: 'motivation', label: effectiveLanguage === 'zh' ? '深层动机' : 'Motivation', values: pendingSummary.motivation ? [pendingSummary.motivation] : [] },
        { key: 'coreConflict', label: effectiveLanguage === 'zh' ? '核心冲突' : 'Core Conflict', values: pendingSummary.coreConflict ? [pendingSummary.coreConflict] : [] },
      ].filter(section => section.values.length > 0)
    : [];

  // =========================================================================
  // Role dropdown (shared logic, rendered in different positions per platform)
  // =========================================================================

  const roleDropdownMenu = (
    <AnimatePresence>
      {roleDropdownOpen && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setRoleDropdownOpen(false)} />
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className={`absolute ${isDesktop ? 'bottom-full left-0 mb-2' : 'top-full left-0 mt-1'} w-64 bg-white border border-gray-100 rounded-xl shadow-lg z-20 overflow-hidden`}
          >
            <div className="p-1.5 space-y-0.5">
              {roleOptions.map((opt, i) => {
                const isSelected = effectiveSelectedMode === i;
                return (
                  <button
                    key={i}
                    onClick={() => {
                      setSelectedMode(i);
                      setRoleDropdownOpen(false);
                    }}
                    className={`w-full px-3 py-2 text-left rounded-lg transition-colors ${
                      isSelected ? 'bg-gray-50 text-gray-900' : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">{opt.label}</span>
                      {isSelected && <span className="text-gray-400 text-[10px]">✓</span>}
                    </div>
                  </button>
                );
              })}
            </div>
          </motion.div>
        </>
      )}
    </AnimatePresence>
  );

  // =========================================================================
  // Retention dropdown (shared)
  // =========================================================================

  const retentionDropdown = (
    <div className="relative">
      <button
        onClick={() => setRetentionDropdownOpen(!retentionDropdownOpen)}
        className="flex items-center gap-1.5 px-1.5 py-1 rounded-md text-[11px] hover:bg-gray-100 transition-colors"
      >
        <span className="text-gray-500">
          {t('reflect.retention_label')}
        </span>
        <span className="font-medium text-gray-700">
          {retention === '3days' ? t('reflect.retention_3days')
            : retention === '7days' ? t('reflect.retention_7days')
            : t('reflect.retention_none')}
        </span>
        <ChevronDown
          size={11}
          className={`text-gray-400 transition-transform duration-200 ${retentionDropdownOpen ? 'rotate-180' : ''}`}
        />
      </button>

      <AnimatePresence>
        {retentionDropdownOpen && (
          <>
            <div className="fixed inset-0 z-10" onClick={() => setRetentionDropdownOpen(false)} />
            <motion.div
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 4 }}
              transition={{ duration: 0.15 }}
              className="absolute bottom-full right-0 mb-2 w-56 bg-white border border-gray-100 rounded-xl shadow-lg z-20 overflow-hidden"
            >
              <div className="p-1.5 space-y-0.5">
                {([
                  { key: '3days' as RetentionOption, label: t('reflect.retention_3days') },
                  { key: '7days' as RetentionOption, label: t('reflect.retention_7days') },
                  { key: 'none' as RetentionOption, label: t('reflect.retention_none') },
                ]).map((opt) => {
                  const isSelected = retention === opt.key;
                  return (
                    <button
                      key={opt.key}
                      onClick={() => {
                        setRetention(opt.key);
                        setRetentionDropdownOpen(false);
                      }}
                      className={`w-full px-3 py-2 text-left rounded-lg transition-colors ${
                        isSelected ? 'bg-gray-50 text-gray-900' : 'text-gray-600 hover:bg-gray-50'
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span className="text-xs font-medium">{opt.label}</span>
                        {isSelected && <span className="text-gray-400 text-[10px]">✓</span>}
                      </div>
                    </button>
                  );
                })}
              </div>
              <div className="px-3 pb-2 pt-1 border-t border-gray-50">
                <p className="text-[9px] text-gray-500 leading-snug">
                  {t('reflect.retention_note')}
                </p>
              </div>
            </motion.div>
          </>
        )}
      </AnimatePresence>
    </div>
  );

  // =========================================================================
  // Composer footer — platform-aware
  // =========================================================================

  const meDefaultStyleName = (() => {
    const names = effectiveLanguage === 'zh'
      ? ['镜子', '整理者', '引导者', '表达辅助']
      : ['Mirror', 'Organizer', 'Guide', 'Expression Helper'];
    const idx = meDefaultStyle ? mapStyleToSelectedMode(meDefaultStyle) : null;
    return idx !== null ? names[idx] : names[0];
  })();

  const composerFooter = isDesktop ? (
    <div className="flex items-center justify-between pt-1">
      {/* Desktop: role dropdown on left */}
      <div className="relative">
        <button
          onClick={() => setRoleDropdownOpen(!roleDropdownOpen)}
          className="flex items-center gap-1.5 px-1.5 py-1 rounded-md text-[11px] hover:bg-gray-100 transition-colors"
        >
          <span className="text-gray-500">
            {effectiveLanguage === 'zh' ? '角色' : 'Role'}
          </span>
          <span className="font-medium text-gray-700">
            {getStyleDisplayName(effectiveSelectedMode)}
          </span>
          <ChevronDown
            size={11}
            className={`text-gray-400 transition-transform duration-200 ${roleDropdownOpen ? 'rotate-180' : ''}`}
          />
        </button>
        {roleDropdownMenu}
      </div>
      {retentionDropdown}
    </div>
  ) : (
    <div className="flex items-center justify-between pt-1">
      {/* Mobile: AI preference (read-only) on left */}
      <div className="flex items-center gap-1 px-1 py-0.5 text-[11px]">
        <span className="text-gray-500">
          {effectiveLanguage === 'zh' ? '偏好' : 'Style'}
        </span>
        <span className="font-medium text-gray-600">
          {meDefaultStyleName}
        </span>
      </div>
      {/* Mobile: retention on right */}
      {retentionDropdown}
    </div>
  );

  // =========================================================================
  // Render
  // =========================================================================

  return (
    <div className="h-full flex flex-col relative">
      {/* Page sub-header — full width, outside max-w container */}
      <div className="shrink-0 flex items-center justify-between px-4 pt-2 pb-1.5">
        <div className="flex min-w-0 items-center gap-2">
          {!isDesktop && (
            <button
              type="button"
              onClick={() => {
                setRoleDropdownOpen(false);
                setRetentionDropdownOpen(false);
                setMobileDrawerOpen((open) => !open);
              }}
              className="-ml-2 rounded-lg p-2 text-gray-500 transition-colors hover:bg-gray-50 hover:text-gray-800"
              aria-label={effectiveLanguage === 'zh' ? '打开菜单' : 'Open menu'}
            >
              <Menu size={18} strokeWidth={1.75} />
            </button>
          )}
          <span className="text-[11px] font-semibold tracking-[0.2em] text-gray-500 uppercase">
            {t('nav.reflect')}
          </span>
          {/* Mobile: role selector next to title */}
          {!isDesktop && (
            <div className="relative shrink-0">
              <button
                onClick={() => setRoleDropdownOpen(!roleDropdownOpen)}
                className="flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-50 text-[11px] active:bg-gray-100 transition-colors"
              >
                <span className="font-medium text-gray-700">
                  {getStyleDisplayName(effectiveSelectedMode)}
                </span>
                <ChevronDown
                  size={11}
                  className={`text-gray-400 transition-transform duration-200 ${roleDropdownOpen ? 'rotate-180' : ''}`}
                />
              </button>
              {roleDropdownMenu}
            </div>
          )}
        </div>
        <select
          value={language}
          onChange={(e) => setLanguage(e.target.value as any)}
          className="bg-transparent text-[10px] font-semibold uppercase tracking-wider text-gray-500 border-none focus:ring-0 cursor-pointer hover:text-gray-700 transition-colors appearance-none text-right outline-none pr-1"
          style={{ WebkitAppearance: 'none', MozAppearance: 'none', textAlignLast: 'right' }}
        >
          <option value="auto">Auto</option>
          <option value="zh">中文</option>
          <option value="en">EN</option>
        </select>
      </div>

      {/* Debug Panel (dev only) */}
      {import.meta.env.DEV && lastDebug && (
        <button
          onClick={() => setShowDebug(!showDebug)}
          className="absolute top-2 right-16 z-50 p-1.5 rounded-full bg-gray-100 text-gray-400 hover:bg-gray-200"
        >
          <Info size={14} />
        </button>
      )}
      
      {showDebug && lastDebug && (
        <div className="absolute top-10 right-4 z-50 w-72 p-3 rounded-xl bg-gray-900 text-white text-[10px] font-mono shadow-2xl max-h-[70vh] overflow-y-auto">
          <div className="font-bold mb-2 text-yellow-400">Question Gate Debug</div>
          <div className="space-y-0.5">
            <div>KeepContext: <span className={keepContext ? 'text-green-400' : 'text-gray-400'}>{String(keepContext)}</span></div>
            <div>Style: <span className="text-green-400">{lastDebug.questionGate.responseStyle}</span></div>
            <div>gate.action: <span className={
              lastDebug.questionGate.action === 'force_generate' ? 'text-orange-400' :
              lastDebug.questionGate.action === 'force_close' ? 'text-purple-400' :
              lastDebug.questionGate.action === 'rewrite' ? 'text-yellow-400' :
              'text-blue-400'
            }>{lastDebug.questionGate.action}</span></div>
            <div>reflect.action: <span className="text-blue-400">{lastDebug.reflect.action}</span></div>
            <div>reflect.isNewSession: <span className={lastDebug.reflect.isNewSession ? 'text-yellow-400' : 'text-gray-400'}>{String(lastDebug.reflect.isNewSession)}</span></div>
            <div>reflect.sessionId: <span className="text-gray-300 break-all">{lastDebug.reflect.sessionId?.slice(0, 8) || '-'}</span></div>
            <div className="border-t border-gray-700 pt-1 mt-1">
              <div className="text-gray-500 mb-0.5">User State:</div>
              <div>isDistressed: <span className={lastDebug.questionGate.isDistressed ? 'text-red-400' : 'text-gray-400'}>{String(lastDebug.questionGate.isDistressed)}</span></div>
              <div>isAskingForDeepDive: <span className={lastDebug.questionGate.isAskingForDeepDive ? 'text-blue-400' : 'text-gray-400'}>{String(lastDebug.questionGate.isAskingForDeepDive)}</span></div>
              <div>isTaskAlreadySpecified: <span className={lastDebug.questionGate.isTaskAlreadySpecified ? 'text-orange-400' : 'text-gray-400'}>{String(lastDebug.questionGate.isTaskAlreadySpecified ?? false)}</span></div>
              <div>isUserClosingSignal: <span className={lastDebug.questionGate.isUserClosingSignal ? 'text-purple-400' : 'text-gray-400'}>{String(lastDebug.questionGate.isUserClosingSignal ?? false)}</span></div>
            </div>
            <div className="border-t border-gray-700 pt-1 mt-1">
              <div className="text-gray-500 mb-0.5">Response Stats:</div>
              <div>questionCount: {lastDebug.questionGate.questionCount}</div>
              <div>consecutiveQTurns: {lastDebug.questionGate.consecutiveQuestionTurns}</div>
            </div>
            {lastDebug.questionGate.reasons.length > 0 && (
              <div className="mt-1 pt-1 border-t border-gray-700">
                <div className="text-yellow-400">Reasons:</div>
                {lastDebug.questionGate.reasons.map((r, i) => (
                  <div key={i} className="text-red-300 break-words">• {r}</div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {!isDesktop && (
        <ReflectHistoryDrawer
          open={mobileDrawerOpen}
          conversations={recentConversations}
          activeConversationId={sessionId}
          effectiveLanguage={effectiveLanguage === 'zh' ? 'zh' : 'en'}
          onClose={() => setMobileDrawerOpen(false)}
          onSelectConversation={restoreConversationById}
          onNewConversation={handleStartNewConversation}
        />
      )}

      {/* Main content area — centered on desktop */}
      <div className={`flex-1 min-h-0 flex flex-col ${isDesktop ? 'max-w-3xl mx-auto w-full' : ''}`}>
      <AnimatePresence mode="wait">
        
        {/* ==================== Step 0: Home ==================== */}
        {step === 0 && (
          <motion.div key="step0" {...fadeIn} className="flex-1 flex flex-col overflow-hidden">
            <div className="flex-1 flex flex-col justify-center items-center px-6">
              <div className="space-y-3 text-center">
                <h2 className={`font-light leading-snug text-primary ${isDesktop ? 'text-2xl' : 'text-[28px]'}`}>
                  {t('reflect.step0_title')}
                </h2>
                {isDesktop && (
                  <p className="text-sm text-gray-600 font-light">
                    {t('reflect.step0_subtitle')}
                  </p>
                )}
              </div>
            </div>

            <div className="shrink-0 px-5 pb-4">
              {isDesktop && showUnderstandingBanner && (
                <button
                  onClick={() => navigate('/me/questions')}
                  className="w-full px-3 py-2.5 rounded-lg bg-gray-50 border border-gray-100 text-left mb-2 hover:border-gray-200 transition-colors group flex items-center justify-between"
                >
                  <p className="text-[11px] text-gray-600 font-light leading-snug">
                    {effectiveLanguage === 'zh'
                      ? '我越了解你，就越能真正地与你同频。'
                      : 'The more I understand you, the more I can truly resonate with you.'}
                  </p>
                  <span className="text-[11px] text-primary font-medium shrink-0 ml-3 group-hover:translate-x-0.5 transition-transform">
                    {effectiveLanguage === 'zh' ? '继续了解 →' : 'Continue understanding →'}
                  </span>
                </button>
              )}

              <div className={`${isDesktop ? 'space-y-2 pb-3' : 'mx-auto w-full max-w-sm space-y-2.5'}`}>
                {hasSavedSession ? (
                  <>
                    {isDesktop ? (
                      <>
                        <button 
                          onClick={handleContinueSession}
                          className="w-full py-2.5 rounded-xl bg-primary text-white flex items-center justify-center space-x-2 hover:bg-black transition-colors text-sm font-medium"
                        >
                          <RotateCcw size={14} strokeWidth={1.5} />
                          <span>{t('reflect.action_continue')}</span>
                        </button>
                        <button 
                          onClick={handleClearContext}
                          className="w-full py-2 rounded-lg text-gray-500 flex items-center justify-center space-x-1 hover:bg-gray-50 text-[11px]"
                        >
                          <Trash2 size={12} />
                          <span>{t('reflect.action_clear_context')}</span>
                        </button>
                      </>
                    ) : (
                      <>
                        <button 
                          onClick={handleContinueSession}
                          className="w-full rounded-2xl bg-primary py-3 text-sm font-medium text-white transition-colors hover:bg-black"
                        >
                          {effectiveLanguage === 'zh' ? '继续表达' : 'Continue reflecting'}
                        </button>
                        <button 
                          onClick={handleStartNewConversation}
                          className="w-full rounded-2xl border border-gray-200 py-3 text-sm font-medium text-gray-600 transition-colors hover:bg-gray-50"
                        >
                          {effectiveLanguage === 'zh' ? '开启新对话' : 'New conversation'}
                        </button>
                      </>
                    )}
                  </>
                ) : (
                  <>
                    {isDesktop ? (
                      <button 
                        onClick={() => setStep(1)}
                        className="w-full py-3 rounded-xl bg-primary text-white flex items-center justify-center space-x-2 hover:bg-black transition-colors text-sm font-medium"
                      >
                        <span>{t('reflect.action_write')}</span>
                        <ChevronRight size={14} strokeWidth={2} />
                      </button>
                    ) : (
                      <button 
                        onClick={() => setStep(1)}
                        className="w-full rounded-2xl bg-primary py-3 text-sm font-medium text-white transition-colors hover:bg-black"
                      >
                        {effectiveLanguage === 'zh' ? '开始表达' : 'Start reflecting'}
                      </button>
                    )}
                  </>
                )}
                {isDesktop && justCleared && (
                  <p className="text-[10px] text-gray-500 font-light leading-relaxed text-center pt-2 px-2">
                    {effectiveLanguage === 'zh'
                      ? '你可以清除聊天内容，但不必从零开始。我们不会保留具体对话，只会留下关于你如何思考的一点点理解，用于更准确地发现与你同频的人。'
                      : 'You can clear your chat, but you don\'t have to start from scratch. We don\'t keep the conversation — only a small understanding of how you think, to better find those who resonate with you.'}
                  </p>
                )}
              </div>
            </div>
          </motion.div>
        )}

        {/* ==================== Extracting Summary Overlay ==================== */}
        <AnimatePresence>
          {isExtractingSummary && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-white/95 backdrop-blur-sm flex flex-col items-center justify-center px-6"
            >
              <div className="w-8 h-8 border-2 border-primary border-t-transparent rounded-full animate-spin mb-4" />
              <p className="text-sm text-gray-500 font-light">
                {effectiveLanguage === 'zh' ? '正在提取对话洞察...' : 'Extracting insights...'}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ==================== Summary Confirmation Overlay ==================== */}
        <AnimatePresence>
          {showSummaryConfirmation && pendingSummary && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-white/95 backdrop-blur-sm flex flex-col justify-center px-6"
            >
              <div className={`space-y-6 ${isDesktop ? 'max-w-lg mx-auto' : ''}`}>
                <div className="space-y-2">
                  <h3 className="text-xl font-light text-primary">
                    {effectiveLanguage === 'zh' ? '这份总结，像你吗？' : 'Does this sound like you?'}
                  </h3>
                  <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-line">
                    {effectiveLanguage === 'zh'
                      ? '聊天内容可以清除，但理解不必从零开始。\n如果你认可这份总结，我们会保留这次对话中显现出的思考方式，用于更准确的同频匹配。\n如果你不认可，它不会被保留。'
                      : 'Chat history can be cleared, but understanding doesn\'t have to start from zero.\nIf you approve this summary, we\'ll keep the thinking patterns that emerged here for better matching.\nIf not, it will be discarded.'}
                  </p>
                </div>

                <div className="bg-gray-50 p-4 rounded-xl space-y-3 max-h-[40vh] overflow-y-auto">
                  <p className="text-sm text-gray-700 font-light leading-relaxed whitespace-pre-line">
                    {pendingSummary.summaryText}
                  </p>
                  {summarySections.map(section => (
                    <div key={section.key}>
                      <span className="text-[10px] uppercase tracking-wider text-gray-500 block mb-1">
                        {section.label}
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        {section.values.map(value => (
                          <span key={`${section.key}-${value}`} className="text-xs bg-white px-2 py-1 rounded-md text-primary border border-gray-100">
                            {formatSummaryTag(value)}
                          </span>
                        ))}
                      </div>
                    </div>
                  ))}
                  {pendingSummary.preferredResponseStyle && (
                    <div>
                      <span className="text-[10px] uppercase tracking-wider text-gray-500 block mb-1">
                        {effectiveLanguage === 'zh' ? '偏好回应方式' : 'Response Style'}
                      </span>
                      <div className="flex flex-wrap gap-1.5">
                        <span className="text-xs bg-white px-2 py-1 rounded-md text-primary border border-gray-100">
                          {pendingSummary.preferredResponseStyle}
                        </span>
                      </div>
                    </div>
                  )}
                </div>

                <div className="space-y-3 pt-2">
                  <button
                    onClick={handleConfirmSummary}
                    className="w-full py-3 rounded-xl bg-primary text-white text-sm font-medium hover:bg-black transition-colors"
                  >
                    {effectiveLanguage === 'zh' ? '认可并保存' : 'Approve & Save'}
                  </button>
                  <button
                    onClick={handleRejectSummary}
                    className="w-full py-3 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
                  >
                    {effectiveLanguage === 'zh' ? '删除此次总结' : 'Discard Summary'}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ==================== Step 1: Compose (ChatGPT-style) ==================== */}
        {step === 1 && (
          <motion.div key="step1" {...fadeIn} className="flex-1 flex flex-col overflow-hidden">
            {/* Centered prompt — takes remaining space */}
            <div className="flex-1 flex flex-col justify-center items-center px-8">
              <h2 className={`font-light leading-snug text-primary text-center ${isDesktop ? 'text-2xl' : 'text-[28px]'}`}>
                {t('reflect.step0_title')}
              </h2>
              {isDesktop && (
                <p className="text-sm text-gray-600 font-light mt-2 text-center">
                  {t('reflect.step0_subtitle')}
                </p>
              )}
            </div>

            {/* Distress warning */}
            {userStatePreview.isDistressed && inputValue.trim() && (
              <div className={`${isDesktop ? 'px-8' : 'px-4'} pb-2`}>
                <div className="px-3 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-[10px] text-center">
                  {effectiveLanguage === 'zh' ? '我感受到你可能有些不安，会以更温和的方式回应' : 'I sense you may be distressed. I\'ll respond gently.'}
                </div>
              </div>
            )}

            {/* Bottom-floating compact composer */}
            <div className={`shrink-0 ${isDesktop ? 'px-8 pb-4' : 'px-4 pb-3'}`}>
              <ChatInput
                value={inputValue}
                onChange={setInputValue}
                onSend={handleSend}
                placeholder={effectiveLanguage === 'zh' ? '在这里输入...' : 'Type here...'}
                autoFocus
                footer={composerFooter}
                showMic={showMic}
                onMicPress={handleMicPress}
                onMicRelease={handleMicRelease}
                onMicCancel={handleMicCancel}
              />
            </div>
          </motion.div>
        )}

        {/* ==================== Step 2: Chat / Conversation ==================== */}
        {step === 2 && (
          <motion.div key="step2" {...fadeIn} className="flex-1 flex flex-col overflow-hidden">
            {/* Minimal toolbar — actions only, no style label */}
            <div className="shrink-0 flex items-center justify-end px-5 py-1.5 border-b border-gray-50">
              <div className="flex items-center space-x-1">
                <button 
                  onClick={() => {
                    if (confirm(effectiveLanguage === 'zh' ? '确定要清空当前对话吗？' : 'Clear this conversation?')) {
                      handleClearContext();
                    }
                  }}
                  className="p-1.5 text-gray-400 hover:text-red-400 transition-colors"
                  title={t('reflect.action_clear_context')}
                >
                  <Trash2 size={14} />
                </button>
                <button 
                  onClick={handleEndConversation}
                  className="px-2.5 py-1 rounded-full text-[10px] text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  {sessionCompletionReached ? endConversationLabel : t('common.finish')}
                </button>
              </div>
            </div>

            {/* Chat messages */}
            <div className={`flex-1 overflow-y-auto no-scrollbar py-4 space-y-4 ${isDesktop ? 'px-8' : 'px-5'}`}>
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex ${msg.role === 'user' ? 'justify-end' : 'justify-start'}`}>
                  <div className={`rounded-2xl max-w-[80%] ${
                    msg.role === 'user'
                      ? 'bg-gray-900 text-white px-4 py-3'
                      : msg.role === 'system'
                        ? 'bg-amber-50 text-amber-700 px-4 py-3'
                        : 'bg-gray-50 text-gray-800 px-4 py-3'
                  }`}>
                    <p className="text-sm font-light leading-relaxed whitespace-pre-wrap">{msg.text}</p>
                  </div>
                  {import.meta.env.DEV && msg.role === 'ai' && msg.debug && (
                    <div className="mt-0.5 px-2 py-0.5 rounded text-[9px] font-mono text-gray-300">
                      [{msg.debug.questionGate.responseStyle}] Q:{msg.debug.questionGate.questionCount} | {msg.debug.reflect.action}
                    </div>
                  )}
                </div>
              ))}

              {isLoading && (
                <div className="flex justify-start">
                  <div className="px-4 py-3 rounded-2xl bg-gray-50">
                    <div className="flex space-x-1">
                      <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0s' }}></div>
                      <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0.2s' }}></div>
                      <div className="w-1.5 h-1.5 bg-gray-300 rounded-full animate-bounce" style={{ animationDelay: '0.4s' }}></div>
                    </div>
                  </div>
                </div>
              )}
              <div ref={chatEndRef} />
            </div>

            {/* Compact composer with role + context footer */}
            <div className={`shrink-0 bg-white ${isDesktop ? 'px-8 py-3' : 'px-4 py-2.5'}`}>
              {userStatePreview.isDistressed && inputValue.trim() && (
                <div className="mb-2 px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-[10px]">
                  {effectiveLanguage === 'zh' ? '我会以更温和的方式回应你' : 'I\'ll respond gently to you'}
                </div>
              )}
              <ChatInput
                value={inputValue}
                onChange={setInputValue}
                onSend={handleReply}
                placeholder={effectiveLanguage === 'zh' ? '继续说...' : 'Continue...'}
                disabled={isLoading}
                footer={composerFooter}
                showMic={showMic}
                onMicPress={handleMicPress}
                onMicRelease={handleMicRelease}
                onMicCancel={handleMicCancel}
              />
              <p className="text-[9px] text-gray-500 text-center mt-2">{t('reflect.mirror_footer')}</p>
            </div>
          </motion.div>
        )}

        {/* ==================== Step 3: Bridge ==================== */}
        {step === 3 && (
          <motion.div key="step3" {...fadeIn} className="flex-1 flex flex-col justify-center items-center text-center px-8 space-y-8">
             <div className="space-y-4 max-w-xs">
               <h2 className="text-2xl font-light text-primary leading-snug whitespace-pre-line">
                 {t('reflect.bridge_title')}
               </h2>
               <p className="text-sm text-gray-600 font-light leading-relaxed whitespace-pre-line">
                 {t('reflect.bridge_desc')}
               </p>
             </div>

             {/* Calibration prompt (Spec §九) — only shown when a new insight is detected */}
             {calibrationInsight && (
               <div className="w-full max-w-xs bg-gray-50 rounded-xl p-4 space-y-3">
                 <p className="text-xs text-gray-600 leading-relaxed">
                   {effectiveLanguage === 'zh' ? '我对你的一个理解是：' : 'One thing I noticed about you:'}
                 </p>
                 <p className="text-sm text-primary font-light leading-relaxed">
                   {calibrationInsight.text}
                 </p>
                 <div className="flex gap-2">
                   <button
                     onClick={() => {
                       // TODO: feed back into confidence scoring
                       console.log('[Calibration] like_me:', calibrationInsight.key);
                       setCalibrationInsight(null);
                     }}
                     className="flex-1 py-2 rounded-lg border border-gray-200 text-xs text-primary hover:bg-white transition-colors"
                   >
                     {effectiveLanguage === 'zh' ? '这很像我' : 'That sounds like me'}
                   </button>
                   <button
                     onClick={() => {
                       // TODO: feed back into confidence scoring
                       console.log('[Calibration] not_like_me:', calibrationInsight.key);
                       setCalibrationInsight(null);
                     }}
                     className="flex-1 py-2 rounded-lg border border-gray-200 text-xs text-gray-600 hover:bg-white transition-colors"
                   >
                     {effectiveLanguage === 'zh' ? '不太像' : 'Not really'}
                   </button>
                 </div>
               </div>
             )}

             <div className="space-y-2.5 w-full max-w-xs">
                <Link to="/resonate" className="block w-full py-3 rounded-xl bg-primary text-white hover:bg-black transition-colors text-sm font-medium text-center">
                  {t('reflect.bridge_action_resonate')}
                </Link>
                <button 
                  onClick={() => setStep(0)}
                  className="block w-full py-3 rounded-xl border border-gray-200 text-gray-600 hover:border-gray-400 transition-colors text-sm font-medium"
                >
                  {t('reflect.bridge_action_reflect')}
                </button>
             </div>
             
             <p className="text-[10px] text-gray-500 font-light">{t('reflect.bridge_footer')}</p>
          </motion.div>
        )}

      </AnimatePresence>
      </div>

      {/* Voice recording overlay (mobile native only) */}
      {showMic && (
        <VoiceOverlay
          state={voice.state}
          elapsedMs={voice.elapsedMs}
          errorKey={voice.errorKey}
          t={t}
          onStop={handleMicRelease}
          onCancel={handleMicCancel}
          onRetry={handleVoiceRetry}
        />
      )}
    </div>
  );
}
