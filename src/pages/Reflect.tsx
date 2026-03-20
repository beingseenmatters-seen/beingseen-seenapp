import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronRight, ChevronDown, Info, RotateCcw, Trash2, ToggleLeft, ToggleRight, Send } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useLanguage } from '../i18n';
import { useAuth } from '../auth';
import { sendReflectWithGate } from '../services/seenApi';
import { analyzeUserState } from '../services/questionGate';
import { ResponseStyle, type ReflectDebug, type ResponseStyleType } from '../types/responseStyle';
import {
  mapSelectedModeToStyle,
  mapStyleToSelectedMode,
  readMeDefaultStyle,
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
  const { seenUser } = useAuth();
  const navigate = useNavigate();
  const understandingProgress = seenUser?.understandingProgress ?? 0;
  const showUnderstandingBanner = understandingProgress < 6;
  const [inputValue, setInputValue] = useState('');
  const [messages, setMessages] = useState<Message[]>([]);
  const [isLoading, setIsLoading] = useState(false);
  const [selectedMode, setSelectedMode] = useState<number | null>(null);
  const [showDebug, setShowDebug] = useState(false);
  const [lastDebug, setLastDebug] = useState<ReflectDebug | null>(null);
  const [consecutiveQuestionTurns, setConsecutiveQuestionTurns] = useState(0);
  
  // Context Retention State
  const [keepContext, setKeepContext] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  const [sessionStyle, setSessionStyle] = useState<ResponseStyleType | undefined>(undefined);
  const [hasSavedSession, setHasSavedSession] = useState(false);

  // Collapsible response style
  const [styleExpanded, setStyleExpanded] = useState(false);

  // User state preview
  const [userStatePreview, setUserStatePreview] = useState<{ isDistressed: boolean; isAskingForDeepDive: boolean }>({
    isDistressed: false,
    isAskingForDeepDive: false
  });

  // Chat scroll ref
  const chatEndRef = useRef<HTMLDivElement>(null);

  // Read Me default style and compute effective style for UI display
  const meDefaultStyle = readMeDefaultStyle();
  const effectiveSelectedMode = selectedMode !== null 
    ? selectedMode 
    : meDefaultStyle 
      ? mapStyleToSelectedMode(meDefaultStyle)
      : null;

  // Confirmed summary flow state
  const [pendingSummary, setPendingSummary] = useState<ConversationExtraction | null>(null);
  const [showSummaryConfirmation, setShowSummaryConfirmation] = useState(false);
  const [pendingInsightAction, setPendingInsightAction] = useState<'clear' | 'finish' | 'leave' | null>(null);

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

  // Persist session when keepContext is ON
  useEffect(() => {
    if (keepContext && sessionId) {
      const session: SavedSession = {
        messages,
        step,
        keepContext,
        sessionId,
        sessionStyle,
        consecutiveQuestionTurns,
        selectedMode,
        timestamp: Date.now()
      };
      localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    } else if (!keepContext && !hasSavedSession) {
      if (step !== 0) {
        localStorage.removeItem(STORAGE_KEY);
      }
    }
  }, [messages, step, keepContext, sessionId, sessionStyle, consecutiveQuestionTurns, selectedMode, hasSavedSession]);

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

  // Auto-scroll chat to bottom
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
        setKeepContext(session.keepContext);
        setSessionId(session.sessionId);
        setSessionStyle(session.sessionStyle);
        setConsecutiveQuestionTurns(session.consecutiveQuestionTurns);
        setSelectedMode(session.selectedMode);
        setHasSavedSession(false);
        setJustCleared(false);
        console.log('[Reflect] continue_session', { sessionId: session.sessionId, sessionStyle: session.sessionStyle });
      } catch (e) {
        console.error('Failed to restore session', e);
        handleClearContext();
      }
    }
  };

  // Track whether user just cleared a conversation (to show trust message)
  const [justCleared, setJustCleared] = useState(false);

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

  const openSummaryConfirmation = (action: 'clear' | 'finish' | 'leave') => {
    const extracted = extractSummaryFromConversation(messages, {
      preferredResponseStyle: getStyleDisplayName(effectiveSelectedMode),
      language: effectiveLanguage === 'zh' ? 'zh' : 'en',
    });

    if (!hasMeaningfulExtraction(extracted)) {
      return false;
    }

    setPendingSummary(extracted);
    setPendingInsightAction(action);
    setShowSummaryConfirmation(true);
    return true;
  };

  // NOTE: useBlocker removed — requires data router (createBrowserRouter).
  // Navigation-away interception is disabled until router migration.

  const handleClearContext = () => {
    if (messages.length > 0 && hasMeaningfulExchange()) {
      if (openSummaryConfirmation('clear')) {
        return;
      }
    }

    performClear();
  };

  const handleEndConversation = () => {
    if (messages.length > 0 && hasMeaningfulExchange()) {
      if (openSummaryConfirmation('finish')) {
        return;
      }
    }

    setStep(3);
  };

  const performClear = () => {
    localStorage.removeItem(STORAGE_KEY);
    setHasSavedSession(false);
    setKeepContext(false);
    setSessionId(undefined);
    setSessionStyle(undefined);
    setMessages([]);
    setConsecutiveQuestionTurns(0);
    setJustCleared(true);
    setPendingSummary(null);
    setPendingInsightAction(null);
    setShowSummaryConfirmation(false);
    
    if (step !== 0) {
      setStep(0);
    }
    console.log('[Reflect] cleared_context (raw chat deleted)');
  };

  const handleConfirmSummary = () => {
    if (pendingSummary) {
      saveApprovedSummary(pendingSummary);
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
    const meDefault = readMeDefaultStyle();
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
        { isNewSession: false, action: 'continue', resolvedStyle }
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
    
    setJustCleared(false);
    setStep(2);
    setConsecutiveQuestionTurns(0);
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
        { isNewSession: true, action: 'new_session', resolvedStyle }
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

  const options = [
    { label: t('reflect.opt_listen'), hint: effectiveLanguage === 'zh' ? '照见你的想法，让你被理解' : 'Reflect your thinking so you feel understood' },
    { label: t('reflect.opt_clarify'), hint: effectiveLanguage === 'zh' ? '提取逻辑链，帮你理清思路' : 'Extract the logic chain and clarify your thinking' },
    { label: t('reflect.opt_blindspot'), hint: effectiveLanguage === 'zh' ? '提出更深问题，扩展思考' : 'Ask deeper questions and expand the thinking' },
    { label: t('reflect.opt_polish'), hint: effectiveLanguage === 'zh' ? '优化语言，提供表达版本' : 'Refine language and offer better phrasing' }
  ];

  const guideWarning = effectiveLanguage === 'zh' 
    ? '引导者会用问题推进思考，但不会替你下结论；你随时可以切换为「镜子」。'
    : 'Guide deepens the thinking through questions, but never decides for you; you can switch to "Mirror" anytime.';

  const getStyleDisplayName = (mode: number | null): string => {
    if (mode === null) return effectiveLanguage === 'zh' ? '镜子' : 'Mirror';
    const styleNames = effectiveLanguage === 'zh' 
      ? ['镜子', '整理者', '引导者', '表达辅助']
      : ['Mirror', 'Organizer', 'Guide', 'Expression Helper'];
    return styleNames[mode] || styleNames[0];
  };

  const currentStyleName = sessionStyle 
    ? getStyleDisplayName(mapStyleToSelectedMode(sessionStyle))
    : getStyleDisplayName(effectiveSelectedMode);
  const sessionCompletionReached = hasMeaningfulExchange();
  const endConversationLabel = effectiveLanguage === 'zh' ? '结束对话' : 'End conversation';

  const formatSummaryTag = (key: string): string =>
    formatInsightTag(key, effectiveLanguage === 'zh' ? 'zh' : 'en');

  const summarySections = pendingSummary
    ? [
        {
          key: 'thinkingPath',
          label: effectiveLanguage === 'zh' ? '你的思考路径' : 'Your Thinking Path',
          values: pendingSummary.thinkingPath,
        },
        {
          key: 'thinkingStyle',
          label: effectiveLanguage === 'zh' ? '你的思考方式' : 'Your Thinking Style',
          values: pendingSummary.thinkingStyle,
        },
        {
          key: 'coreQuestions',
          label: effectiveLanguage === 'zh' ? '你的核心问题' : 'Your Core Questions',
          values: pendingSummary.coreQuestions,
        },
        {
          key: 'worldview',
          label: effectiveLanguage === 'zh' ? '你的世界观' : 'Your Worldview',
          values: pendingSummary.worldview,
        },
        {
          key: 'relationshipPhilosophy',
          label: effectiveLanguage === 'zh' ? '你的关系哲学' : 'Your Relationship Philosophy',
          values: pendingSummary.relationshipPhilosophy,
        },
        {
          key: 'conversationStyle',
          label: effectiveLanguage === 'zh' ? '你的对话风格' : 'Your Conversation Style',
          values: pendingSummary.conversationStyle,
        },
      ].filter(section => section.values.length > 0)
    : [];

  return (
    <div className="h-full flex flex-col relative">
      {/* Page sub-header: REFLECT label (left) + Language switch (right) */}
      <div className="shrink-0 flex items-center justify-between px-5 pt-2 pb-0.5">
        <span className="text-[10px] font-semibold tracking-[0.2em] text-gray-500 uppercase">
          {t('reflect.title')}
        </span>
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

      {/* Main content area */}
      <AnimatePresence mode="wait">
        
        {/* ==================== Step 0: Home ==================== */}
        {step === 0 && (
          <motion.div key="step0" {...fadeIn} className="flex-1 flex flex-col px-5 overflow-hidden">
            {/* Centered hero */}
            <div className="flex-1 flex flex-col justify-center">
              <div className="space-y-2">
                <h2 className="text-xl font-light leading-snug text-primary">
                  {t('reflect.step0_title')}
                </h2>
                <p className="text-xs text-gray-500 font-light">
                  {effectiveLanguage === 'zh' 
                    ? '这里不是社交场合，你不需要表演。' 
                    : 'This is not a stage. You don\'t need to perform.'}
                </p>
              </div>
            </div>

            {/* Understanding reminder */}
            {showUnderstandingBanner && (
              <button
                onClick={() => navigate('/me/questions')}
                className="shrink-0 w-full p-4 rounded-xl bg-gray-50 border border-gray-100 text-left mb-3 hover:border-gray-200 transition-colors group"
              >
                <p className="text-xs text-secondary font-light leading-relaxed">
                  {effectiveLanguage === 'zh'
                    ? '我越了解你，就越能真正地与你同频。'
                    : 'The more I understand you, the more I can truly resonate with you.'}
                </p>
                <span className="text-xs text-primary font-medium mt-1.5 inline-flex items-center gap-1 group-hover:gap-2 transition-all">
                  {effectiveLanguage === 'zh' ? '继续了解 →' : 'Continue understanding →'}
                </span>
              </button>
            )}

            {/* Action buttons */}
            <div className="shrink-0 space-y-2 pb-3">
              {hasSavedSession ? (
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
                <button 
                  onClick={() => setStep(1)}
                  className="w-full py-3 rounded-xl bg-primary text-white flex items-center justify-center space-x-2 hover:bg-black transition-colors text-sm font-medium"
                >
                  <span>{t('reflect.action_write')}</span>
                  <ChevronRight size={14} strokeWidth={2} />
                </button>
              )}
              <p className="text-[10px] text-center text-gray-500">{t('reflect.privacy_note')}</p>

              {/* Trust / memory explanation — shown after clear or always as subtle footer */}
              {justCleared && (
                <p className="text-[10px] text-gray-500 font-light leading-relaxed text-center pt-2 px-2">
                  {effectiveLanguage === 'zh'
                    ? '你可以清除聊天内容，但不必从零开始。我们不会保留具体对话，只会留下关于你如何思考的一点点理解，用于更准确地发现与你同频的人。'
                    : 'You can clear your chat, but you don\'t have to start from scratch. We don\'t keep the conversation — only a small understanding of how you think, to better find those who resonate with you.'}
                </p>
              )}
            </div>
          </motion.div>
        )}

        {/* ==================== Summary Confirmation Overlay ==================== */}
        <AnimatePresence>
          {showSummaryConfirmation && pendingSummary && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-white/95 backdrop-blur-sm flex flex-col justify-center px-6"
            >
              <div className="space-y-6">
                <div className="space-y-2">
                  <h3 className="text-xl font-light text-primary">
                    {effectiveLanguage === 'zh' ? '这份总结，像你吗？' : 'Does this sound like you?'}
                  </h3>
                  <p className="text-xs text-gray-500 leading-relaxed whitespace-pre-line">
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
                    className="w-full py-3 rounded-xl border border-gray-200 text-gray-500 text-sm hover:bg-gray-50 transition-colors"
                  >
                    {effectiveLanguage === 'zh' ? '删除此次总结' : 'Discard Summary'}
                  </button>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ==================== Step 1: Input + Preferences ==================== */}
        {step === 1 && (
          <motion.div key="step1" {...fadeIn} className="flex-1 flex flex-col px-5 overflow-hidden">
            {/* Small prompt */}
            <p className="shrink-0 text-sm font-light text-gray-500 pt-1 pb-1.5">
              {t('reflect.step0_title')}
            </p>
            
            {/* Large textarea — fills available space */}
            <div className="relative flex-1 min-h-0 pb-1">
              <textarea
                className="w-full h-full p-3 rounded-xl border border-gray-200 focus:border-primary text-base font-light text-primary placeholder:text-gray-300 bg-white transition-all resize-none focus:outline-none"
                placeholder={effectiveLanguage === 'zh' ? '在这里输入...' : 'Type here...'} 
                value={inputValue}
                onChange={(e) => setInputValue(e.target.value)}
                autoFocus
              />
              {userStatePreview.isDistressed && (
                <div className="absolute bottom-3 left-3 px-2 py-1 rounded-md bg-amber-100 text-amber-700 text-[10px]">
                  {effectiveLanguage === 'zh' ? '我感受到你可能有些不安，会以更温和的方式回应' : 'I sense you may be distressed. I\'ll respond gently.'}
                </div>
              )}
            </div>

            {/* Compact controls row: Keep Context + Style dropdown */}
            <div className="shrink-0 flex items-center justify-between py-1.5 gap-3">
              {/* Keep Context toggle */}
              <button 
                onClick={() => setKeepContext(!keepContext)}
                className="flex items-center space-x-1.5"
              >
                <span className={`transition-colors duration-200 ${keepContext ? 'text-primary' : 'text-gray-300'}`}>
                  {keepContext ? <ToggleRight size={22} /> : <ToggleLeft size={22} />}
                </span>
                <span className="text-[10px] text-gray-500 whitespace-nowrap">
                  {effectiveLanguage === 'zh' ? '保留上下文' : 'Keep context'}
                </span>
              </button>

              {/* Style dropdown trigger */}
              <div className="relative">
                <button
                  onClick={() => setStyleExpanded(!styleExpanded)}
                  className="flex items-center space-x-1 px-2 py-1 rounded-md hover:bg-gray-50 transition-colors"
                >
                  <span className="text-[10px] text-gray-500 uppercase tracking-wider">
                    {effectiveLanguage === 'zh' ? '方式' : 'Style'}
                  </span>
                  <span className="text-[11px] font-medium text-primary">
                    {getStyleDisplayName(effectiveSelectedMode)}
                  </span>
                  <ChevronDown 
                    size={12} 
                    className={`text-gray-500 transition-transform duration-200 ${styleExpanded ? 'rotate-180' : ''}`} 
                  />
                </button>
                
                {/* Dropdown panel */}
                <AnimatePresence>
                  {styleExpanded && (
                    <motion.div
                      initial={{ opacity: 0, y: 4 }}
                      animate={{ opacity: 1, y: 0 }}
                      exit={{ opacity: 0, y: 4 }}
                      transition={{ duration: 0.15 }}
                      className="absolute bottom-full right-0 mb-1 w-56 bg-white border border-gray-100 rounded-lg shadow-lg z-20 overflow-hidden"
                    >
                      <div className="p-1.5 space-y-0.5">
                        {options.map((opt, i) => {
                          const isSelected = effectiveSelectedMode === i;
                          return (
                            <button 
                              key={i} 
                              onClick={() => {
                                setSelectedMode(i);
                                setStyleExpanded(false);
                              }}
                              className={`w-full px-2.5 py-1.5 text-left rounded-md transition-all duration-150 ${
                                isSelected 
                                  ? 'bg-primary/5 text-primary' 
                                  : 'hover:bg-gray-50 text-gray-600'
                              }`}
                            >
                              <div className="flex items-center justify-between">
                                <span className="text-xs">{opt.label}</span>
                                {isSelected && <span className="text-primary text-[10px]">✓</span>}
                              </div>
                              <span className="block text-[9px] text-gray-500 mt-0.5">{opt.hint}</span>
                              {i === 2 && isSelected && (
                                <span className="block text-[9px] text-amber-600 mt-0.5 leading-snug">
                                  {guideWarning}
                                </span>
                              )}
                            </button>
                          );
                        })}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
            </div>

            {/* Send button */}
            <div className="shrink-0 pb-2 pt-0.5">
              <button 
                onClick={handleSend}
                disabled={!inputValue.trim()}
                className={`w-full py-2.5 rounded-xl flex items-center justify-center space-x-2 text-white transition-all text-sm font-medium ${
                  !inputValue.trim() ? 'bg-gray-200 cursor-not-allowed' : 'bg-primary hover:bg-black'
                }`}
              >
                <span>{t('common.send')}</span>
                <Send size={14} strokeWidth={2} />
              </button>
            </div>
          </motion.div>
        )}

        {/* ==================== Step 2: Chat / Conversation ==================== */}
        {step === 2 && (
          <motion.div key="step2" {...fadeIn} className="flex-1 flex flex-col overflow-hidden">
            {/* Mini toolbar row */}
            <div className="shrink-0 flex items-center justify-between px-5 py-1.5 border-b border-gray-50">
              <span className="text-[11px] text-gray-500 font-medium tracking-wider uppercase">
                {currentStyleName}
              </span>
              <div className="flex items-center space-x-1">
                {keepContext && (
                  <button 
                    onClick={() => {
                      if (confirm(effectiveLanguage === 'zh' ? '确定要清空当前对话吗？' : 'Clear this conversation?')) {
                        handleClearContext();
                      }
                    }}
                    className="p-1.5 text-gray-300 hover:text-red-400 transition-colors"
                    title={t('reflect.action_clear_context')}
                  >
                    <Trash2 size={14} />
                  </button>
                )}
                <button 
                  onClick={handleEndConversation}
                  className="px-2.5 py-1 rounded-full text-[10px] text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors"
                >
                  {sessionCompletionReached ? endConversationLabel : t('common.finish')}
                </button>
              </div>
            </div>

            {/* Chat messages — takes maximum space */}
            <div className="flex-1 overflow-y-auto no-scrollbar px-5 py-3 space-y-3">
              {messages.map((msg, idx) => (
                <div key={idx} className={`flex flex-col ${msg.role === 'user' ? 'items-end' : 'items-start'}`}>
                  <div className={`px-3.5 py-2.5 rounded-2xl max-w-[82%] ${
                    msg.role === 'user' 
                      ? 'bg-primary text-white' 
                      : msg.role === 'system'
                        ? 'bg-amber-50 text-amber-700'
                        : 'bg-gray-100 text-gray-700'
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
                <div className="flex flex-col items-start">
                  <div className="px-4 py-3 rounded-2xl bg-gray-100">
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

            {/* Input bar — fixed at bottom of chat area */}
            <div className="shrink-0 px-4 py-2.5 border-t border-gray-100 bg-white">
              {userStatePreview.isDistressed && inputValue.trim() && (
                <div className="mb-2 px-2.5 py-1.5 rounded-lg bg-amber-50 text-amber-700 text-[10px]">
                  {effectiveLanguage === 'zh' ? '我会以更温和的方式回应你' : 'I\'ll respond gently to you'}
                </div>
              )}
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={inputValue}
                  onChange={(e) => setInputValue(e.target.value)}
                  onKeyDown={(e) => e.key === 'Enter' && !e.shiftKey && handleReply()}
                  placeholder={effectiveLanguage === 'zh' ? '继续说...' : 'Continue...'}
                  disabled={isLoading}
                  className="flex-1 px-4 py-2.5 rounded-full border border-gray-200 focus:border-primary focus:outline-none bg-gray-50 text-sm font-light"
                />
                <button 
                  onClick={handleReply}
                  disabled={!inputValue.trim() || isLoading}
                  className="p-2.5 text-white bg-primary rounded-full disabled:opacity-30 disabled:bg-gray-300 shrink-0"
                >
                  <Send size={16} />
                </button>
              </div>
              <p className="text-[9px] text-gray-400 text-center mt-1.5">{t('reflect.mirror_footer')}</p>

              {/* Trust copy shown after clearing within chat */}
              {justCleared && messages.length === 0 && (
                <p className="text-[10px] text-gray-500 font-light leading-relaxed text-center pt-1.5 px-2">
                  {effectiveLanguage === 'zh'
                    ? '你可以清除聊天内容，但不必从零开始。我们不会保留具体对话，只会留下关于你如何思考的一点点理解，用于更准确地发现与你同频的人。'
                    : 'You can clear your chat, but you don\'t have to start from scratch. We don\'t keep the conversation — only a small understanding of how you think, to better find those who resonate with you.'}
                </p>
              )}
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
               <p className="text-sm text-gray-500 font-light leading-relaxed whitespace-pre-line">
                 {t('reflect.bridge_desc')}
               </p>
             </div>

             <div className="space-y-2.5 w-full max-w-xs">
                <Link to="/resonate" className="block w-full py-3 rounded-xl bg-primary text-white hover:bg-black transition-colors text-sm font-medium text-center">
                  {t('reflect.bridge_action_resonate')}
                </Link>
                <button 
                  onClick={() => setStep(0)}
                  className="block w-full py-3 rounded-xl border border-gray-200 text-gray-500 hover:border-gray-400 transition-colors text-sm"
                >
                  {t('reflect.bridge_action_reflect')}
                </button>
             </div>
             
             <p className="text-[10px] text-gray-400 font-light">{t('reflect.bridge_footer')}</p>
          </motion.div>
        )}

      </AnimatePresence>
    </div>
  );
}
