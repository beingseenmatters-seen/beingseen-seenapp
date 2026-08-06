import { useState, useEffect, useRef, useCallback } from 'react';
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
import { type ReflectDebug } from '../types/responseStyle';
import {
  ResponseMode,
  RESPONSE_MODES,
  type ResponseModeType,
  tryNormalizeResponseMode,
  toLegacyResponseStyle,
  toLegacySelectedMode
} from '../types/responseMode';
import type { RetentionOption } from '../types/insight';
import {
  saveConversation,
  getConversationById,
  disposeCompletedConversation,
  type ConversationStatus,
  type ConversationDecision
} from '../services/recentConversations';
import { useRecentConversations } from '../hooks/useRecentConversations';
import { resolveLegacySessionResponseMode } from '../services/reflectStyle';
import {
  loadLastUsedResponseMode,
  saveLastUsedResponseMode
} from '../services/lastReflectResponseMode';
import { 
  extractSummaryFromConversation, 
  extractSummaryFromBackend,
  hasMeaningfulExtraction, 
  saveApprovedSummary 
} from '../services/userSummary';
import type { ConversationExtraction } from '../types/userSummary';
import { saveKeptReflection } from '../services/keptReflections';
import { getResonateCandidate } from '../services/connections';
import MomentsInvitationCard from '../components/moments/MomentsInvitationCard';
import { useMomentsInvitation } from '../hooks/useMomentsInvitation';
import {
  clearReflectSession,
  loadReflectSessionRaw,
  saveReflectSessionRaw,
} from '../services/reflectSessionStore';

interface Message {
  role: 'user' | 'ai' | 'system';
  text: string;
  debug?: ReflectDebug;
  /**
   * Turn-level mode metadata (Phase 2C), set on AI replies:
   * `requestedMode` = the mode the user selected for that turn;
   * `effectiveMode` = the mode actually applied after distress/question-gate
   * overrides. Internal only — never rendered as visible debug text.
   */
  requestedMode?: ResponseModeType;
  effectiveMode?: ResponseModeType;
}

interface SavedSession {
  messages: Message[];
  step: number;
  keepContext: boolean;
  retention?: RetentionOption;
  sessionId: string;
  /**
   * The response mode currently selected for the NEXT user turn (Phase 2C
   * turn-level model). Editable between completed turns.
   */
  currentResponseMode?: ResponseModeType;
  /**
   * Pre-2C field. Old sessions stored the whole-conversation locked mode here;
   * still written (mirroring currentResponseMode) so older readers keep
   * working, and used as the migration source when currentResponseMode is
   * absent.
   */
  responseMode?: ResponseModeType;
  /** Legacy fields kept so sessions saved before `responseMode` still resolve. */
  sessionStyle?: string;
  consecutiveQuestionTurns: number;
  selectedMode?: number | null;
  timestamp: number;
  /** End-of-conversation lifecycle (Phase 2B). `undefined` = active. */
  status?: ConversationStatus;
  decision?: ConversationDecision;
  /** Extraction awaiting 留下/放下 — survives refresh without re-extracting. */
  pendingExtraction?: ConversationExtraction | null;
}

/**
 * Internal diagnostics are opt-in only: dev build AND an explicit flag.
 * Normal local, preview and production UI must never render debug metadata.
 */
const REFLECT_DEBUG_UI =
  import.meta.env.DEV && import.meta.env.VITE_REFLECT_DEBUG === 'on';

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
  const [showDebug, setShowDebug] = useState(false);
  const [lastDebug, setLastDebug] = useState<ReflectDebug | null>(null);
  const [consecutiveQuestionTurns, setConsecutiveQuestionTurns] = useState(0);
  
  const keepContext = true;
  const [retention, setRetention] = useState<RetentionOption>('3days');
  const [retentionDropdownOpen, setRetentionDropdownOpen] = useState(false);
  const [sessionId, setSessionId] = useState<string | undefined>(undefined);
  /**
   * Turn-level response-mode ownership (Phase 2C):
   * `currentResponseMode` = "the response mode currently selected for the
   * next user turn". It is editable between completed turns, snapshotted at
   * send time for that turn, and disabled only while a request is in flight
   * or the conversation is no longer active. Modes describe what kind of help
   * the user wants NEXT — they are not fixed roles locked to a conversation.
   */
  const [currentResponseMode, setCurrentResponseMode] = useState<ResponseModeType>(ResponseMode.REFLECT);
  /** Transient "下一次回复将使用「…」" notice after a mid-conversation switch. */
  const [modeChangeNotice, setModeChangeNotice] = useState<ResponseModeType | null>(null);
  const modeNoticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => {
    if (modeNoticeTimeoutRef.current) clearTimeout(modeNoticeTimeoutRef.current);
  }, []);
  const [hasSavedSession, setHasSavedSession] = useState(false);

  // Response-mode dropdown open/close
  const [roleDropdownOpen, setRoleDropdownOpen] = useState(false);
  const [mobileDrawerOpen, setMobileDrawerOpen] = useState(false);
  const [justCleared, setJustCleared] = useState(false);

  // Recent conversations for desktop sidebar + mobile drawer
  const { conversations: recentConversations, refresh: refreshRecentConversations } = useRecentConversations();

  // Lightweight Moments discovery (post-onboarding, step 0 only). Does not
  // touch Reflect evidence / CU / matching. Me Moments card remains the natural entry.
  const momentsInvite = useMomentsInvitation();

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

  const uid = firebaseUser?.uid;

  const hasUserMessage = messages.some(m => m.role === 'user' && m.text.trim().length > 0);

  // A NEW conversation initialises from the most recently actually-used mode.
  // A restored conversation owns its mode and is never overridden by this
  // (restore effects run after this one and set currentResponseMode directly).
  useEffect(() => {
    if (!uid) return;
    if (hasUserMessage) return;
    setCurrentResponseMode(loadLastUsedResponseMode(uid));
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  const [pendingSummary, setPendingSummary] = useState<ConversationExtraction | null>(null);
  const [showSummaryConfirmation, setShowSummaryConfirmation] = useState(false);
  const [isExtractingSummary, setIsExtractingSummary] = useState(false);
  const [pendingInsightAction, setPendingInsightAction] = useState<'clear' | 'finish' | 'leave' | 'new' | null>(null);

  // ==== Phase 2B: end-of-conversation lifecycle ====
  /** 'active' → 'awaiting_decision' (extraction shown) → 'completed' (留下/放下 made). */
  const [conversationStatus, setConversationStatus] = useState<ConversationStatus>('active');
  const [conversationDecision, setConversationDecision] = useState<ConversationDecision | undefined>(undefined);
  /** Extraction failed (完成 path) — shows the visible retry state. */
  const [summaryError, setSummaryError] = useState(false);
  /** 留下 save failed — retryable, keeps sentence and decision screen intact. */
  const [decisionError, setDecisionError] = useState(false);
  /** Guards 留下/放下 against duplicate clicks and duplicate writes. */
  const [isSavingDecision, setIsSavingDecision] = useState(false);
  /** Quiet notice when a recent-conversation entry no longer resolves. */
  const [staleConversationNotice, setStaleConversationNotice] = useState(false);
  /** Which ?conversation=<id> has already been restored (avoids restore loops). */
  const restoredConvoRef = useRef<string | null>(null);

  const conversationEnded = conversationStatus === 'completed';

  /**
   * Turn-level selector availability (Phase 2C): selection is allowed only
   * while the conversation is active and nothing is in flight. Disabled while
   * an AI reply is generating, extraction is running, a 留下/放下 decision is
   * in progress or pending, or the conversation is completed/read-only.
   */
  const modeSelectorDisabled =
    isLoading ||
    isExtractingSummary ||
    isSavingDecision ||
    showSummaryConfirmation ||
    summaryError ||
    conversationStatus !== 'active';

  // TODO (Spec §九): Lightweight calibration after conversation end
  const [calibrationInsight, setCalibrationInsight] = useState<{ key: string; text: string } | null>(null);

  /**
   * Completion-first (founder decision): after a Reflection, the person feels
   * complete first. Discover is only offered as an optional invitation, and only
   * when a possibility genuinely exists. Checked once when the bridge appears.
   *
   * Founder Architecture Decision — FROZEN (2026-08-06):
   * Reflect is not a messaging app. Unfinished chats may keep full history for
   * Continue. After completion + Understanding Update decision: if kept, only
   * the approved Update is long-term (Me「我留下的理解」); the transcript must
   * not become permanent user-facing history and expires with short-term
   * retention. Moments/Reflect remain independent.
   */
  const [discoveryAvailable, setDiscoveryAvailable] = useState(false);

  /**
   * Restore a retained conversation, honouring its lifecycle status:
   * - active: normal editable chat
   * - awaiting_decision: show the saved extracted sentence + 留下/放下 again
   *   (never re-extract just because the person reopened it)
   * - completed: not restorable (disposed after Keep/Reject)
   * Returns false when the conversation no longer exists / has expired / completed.
   */
  const restoreConversationById = (convoId: string): boolean => {
    const convo = getConversationById(convoId);
    // getConversationById already excludes completed / tombstoned rows.
    if (!convo) return false;

    // The conversation's own current mode wins over the global last-used one.
    // Old whole-session records migrate deterministically: their resolved
    // locked mode becomes the current next-turn mode.
    const restoredMode =
      tryNormalizeResponseMode(convo.responseMode) ??
      resolveLegacySessionResponseMode({
        legacySessionStyle: convo.sessionStyle,
        legacySelectedMode: convo.selectedMode,
        lastUsedResponseMode: loadLastUsedResponseMode(uid),
      });

    const pendingExtraction = convo.pendingExtraction as ConversationExtraction | null | undefined;
    const hasRestorableExtraction =
      convo.status === 'awaiting_decision' &&
      typeof pendingExtraction?.summaryText === 'string' &&
      pendingExtraction.summaryText.trim().length > 0;
    const status: ConversationStatus = hasRestorableExtraction
      ? 'awaiting_decision'
      : 'active';

    setRoleDropdownOpen(false);
    setRetentionDropdownOpen(false);
    setMobileDrawerOpen(false);
    setStaleConversationNotice(false);
    setSummaryError(false);
    setDecisionError(false);
    setIsSavingDecision(false);
    // Restore per-turn mode metadata where present (older messages lack it).
    setMessages(convo.messages.map(m => ({
      role: m.role,
      text: m.text,
      requestedMode: tryNormalizeResponseMode(m.requestedMode) ?? undefined,
      effectiveMode: tryNormalizeResponseMode(m.effectiveMode) ?? undefined,
    })));
    setStep(2);
    setRetention(convo.retention);
    setSessionId(convo.id);
    setCurrentResponseMode(restoredMode);
    setModeChangeNotice(null);
    setConversationStatus(status);
    setConversationDecision(convo.decision);
    if (status === 'awaiting_decision' && hasRestorableExtraction) {
      setPendingSummary(pendingExtraction as ConversationExtraction);
      setPendingInsightAction('finish');
      setShowSummaryConfirmation(true);
    } else {
      setPendingSummary(null);
      setPendingInsightAction(null);
      setShowSummaryConfirmation(false);
    }
    setHasSavedSession(false);
    setJustCleared(false);
    return true;
  };

  // Route-based conversation selection: ?conversation=<id> is the single
  // mechanism used by the desktop Sidebar and the mobile drawer. Watching
  // searchParams (not just mount) makes selection work when the user is
  // already on the Reflect page. The param stays in the URL while the
  // conversation is open, so a browser refresh restores the same one.
  useEffect(() => {
    const convoId = searchParams.get('conversation');
    if (!convoId) {
      restoredConvoRef.current = null;
      return;
    }
    if (restoredConvoRef.current === convoId) return;

    if (restoreConversationById(convoId)) {
      restoredConvoRef.current = convoId;
    } else {
      // Expired / missing / corrupt: no blank screen, no crash — quiet notice,
      // drop the stale param, refresh the list so the entry disappears.
      restoredConvoRef.current = null;
      setStaleConversationNotice(true);
      refreshRecentConversations();
      setSearchParams({}, { replace: true });
    }
  }, [searchParams]); // eslint-disable-line react-hooks/exhaustive-deps

  // Load saved session on mount (uid-scoped; empty when signed out)
  useEffect(() => {
    if (!uid) {
      setHasSavedSession(false);
      return;
    }
    const saved = loadReflectSessionRaw();
    if (saved) {
      try {
        const session: SavedSession = JSON.parse(saved);
        if (session.status === 'completed') {
          disposeCompletedConversation(session.sessionId, session.decision);
          clearReflectSession();
          setHasSavedSession(false);
          refreshRecentConversations();
          return;
        }
        if (session.keepContext) {
          setHasSavedSession(true);
        }
      } catch (e) {
        console.error('Failed to parse saved session', e);
        clearReflectSession();
      }
    } else {
      setHasSavedSession(false);
    }
  }, [uid]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (!sessionId) return;

    // Completed conversations must not be re-mirrored by autosave.
    if (conversationStatus === 'completed') {
      clearReflectSession();
      return;
    }

    // `currentResponseMode` is the turn-level field (mode for the NEXT
    // turn). `responseMode` mirrors it for pre-2C readers, and legacy
    // `sessionStyle` / `selectedMode` are still written (old four-role
    // vocabulary) so any older reader keeps working; CONNECT has no legacy
    // equivalent and writes undefined/null there.
    const legacyStyle = toLegacyResponseStyle(currentResponseMode);
    const legacySelectedMode = toLegacySelectedMode(currentResponseMode);
    const session: SavedSession = {
      messages,
      step,
      keepContext,
      retention,
      sessionId,
      currentResponseMode,
      responseMode: currentResponseMode,
      sessionStyle: legacyStyle,
      consecutiveQuestionTurns,
      selectedMode: legacySelectedMode,
      timestamp: Date.now(),
      status: conversationStatus,
      decision: conversationDecision,
      pendingExtraction: conversationStatus === 'awaiting_decision' ? pendingSummary : null
    };
    saveReflectSessionRaw(JSON.stringify(session));

    if (retention !== 'none' && messages.filter(m => m.role === 'user' && m.text.trim()).length > 0) {
      saveConversation(
        sessionId,
        // Persist per-turn mode metadata with each AI message (never debug).
        messages.map(m => ({
          role: m.role,
          text: m.text,
          requestedMode: m.requestedMode,
          effectiveMode: m.effectiveMode,
        })),
        retention,
        effectiveLanguage === 'zh' ? 'zh' : 'en',
        {
          responseMode: currentResponseMode,
          sessionStyle: legacyStyle,
          selectedMode: legacySelectedMode,
          status: conversationStatus,
          decision: conversationDecision,
          pendingExtraction:
            conversationStatus === 'awaiting_decision' && pendingSummary
              ? (pendingSummary as unknown as Record<string, unknown>)
              : null
        }
      );
    }
  }, [messages, step, keepContext, retention, sessionId, currentResponseMode, consecutiveQuestionTurns, effectiveLanguage, conversationStatus, conversationDecision, pendingSummary]);

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

  useEffect(() => {
    if (step !== 3) return;
    setDiscoveryAvailable(false);
    const uid = firebaseUser?.uid;
    if (!uid) return;
    let cancelled = false;
    getResonateCandidate(uid)
      .then((candidate) => {
        if (!cancelled) setDiscoveryAvailable(Boolean(candidate));
      })
      .catch(() => {
        if (!cancelled) setDiscoveryAvailable(false);
      });
    return () => {
      cancelled = true;
    };
  }, [step, firebaseUser?.uid]);

  const getRecentTurns = () => {
    return messages
      .filter(m => m.role !== 'system')
      .map(m => ({ role: m.role as 'user' | 'ai', text: m.text }));
  };

  const handleContinueSession = () => {
    const saved = loadReflectSessionRaw();
    if (saved) {
      try {
        const session: SavedSession = JSON.parse(saved);
        // Turn-level field first; old whole-session `responseMode` (and older
        // sessionStyle/selectedMode) migrate deterministically to become the
        // conversation's current next-turn mode.
        const restoredMode =
          tryNormalizeResponseMode(session.currentResponseMode) ??
          tryNormalizeResponseMode(session.responseMode) ??
          resolveLegacySessionResponseMode({
            legacySessionStyle: session.sessionStyle,
            legacySelectedMode: session.selectedMode,
            lastUsedResponseMode: loadLastUsedResponseMode(uid),
          });
        const pendingExtraction = session.pendingExtraction ?? null;
        const hasRestorableExtraction =
          session.status === 'awaiting_decision' &&
          typeof pendingExtraction?.summaryText === 'string' &&
          pendingExtraction.summaryText.trim().length > 0;
        // Completed sessions must not reappear via Continue — dispose leftover mirrors.
        if (session.status === 'completed') {
          disposeCompletedConversation(session.sessionId, session.decision);
          clearReflectSession();
          setHasSavedSession(false);
          refreshRecentConversations();
          return;
        }

        const status: ConversationStatus = hasRestorableExtraction
          ? 'awaiting_decision'
          : 'active';

        setMessages(session.messages);
        setStep(session.step === 0 ? 2 : session.step);
        setRetention(session.retention ?? '3days');
        setSessionId(session.sessionId);
        setCurrentResponseMode(restoredMode);
        setModeChangeNotice(null);
        setConsecutiveQuestionTurns(session.consecutiveQuestionTurns);
        setConversationStatus(status);
        setConversationDecision(session.decision);
        setSummaryError(false);
        setDecisionError(false);
        setIsSavingDecision(false);
        if (status === 'awaiting_decision' && hasRestorableExtraction) {
          // Restore the saved sentence and decision screen — never re-extract.
          setPendingSummary(pendingExtraction);
          setPendingInsightAction('finish');
          setShowSummaryConfirmation(true);
        } else {
          setPendingSummary(null);
          setPendingInsightAction(null);
          setShowSummaryConfirmation(false);
        }
        setHasSavedSession(false);
        setJustCleared(false);
        setRoleDropdownOpen(false);
        setRetentionDropdownOpen(false);
        setMobileDrawerOpen(false);
        console.log('[Reflect] continue_session', { sessionId: session.sessionId, responseMode: restoredMode, status });
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

  /**
   * Phase 2B: the 完成 flow extracts whenever there is genuinely something to
   * extract from — at least one real user message and one AI reply. The old
   * `hasMeaningfulExchange` gate (2 user turns) silently skipped extraction
   * and jumped straight to the bridge, which was the founder-verified bug.
   */
  const hasExtractableContent = () => {
    const { userTurns, aiTurns } = getConversationStats();
    return userTurns >= 1 && aiTurns >= 1;
  };

  /**
   * After Keep / Reject (or quiet end): dispose transcript immediately.
   * Preserves kept Understanding Updates (written before this runs on Keep).
   */
  const disposeReflectAfterDecision = (
    decision: ConversationDecision | undefined,
    convoId: string | undefined,
    nextStep: 0 | 1 | 3,
  ) => {
    if (convoId) {
      disposeCompletedConversation(convoId, decision);
    }
    clearReflectSession();
    setHasSavedSession(false);
    setRetention('3days');
    setSessionId(undefined);
    setCurrentResponseMode(loadLastUsedResponseMode(uid));
    setModeChangeNotice(null);
    setMessages([]);
    setConsecutiveQuestionTurns(0);
    setJustCleared(true);
    setPendingSummary(null);
    setPendingInsightAction(null);
    setShowSummaryConfirmation(false);
    setConversationStatus('active');
    setConversationDecision(undefined);
    setSummaryError(false);
    setDecisionError(false);
    setIsSavingDecision(false);
    setStaleConversationNotice(false);
    setRoleDropdownOpen(false);
    setRetentionDropdownOpen(false);
    setMobileDrawerOpen(false);
    restoredConvoRef.current = null;
    if (searchParams.get('conversation')) {
      setSearchParams({}, { replace: true });
    }
    refreshRecentConversations();
    setStep(nextStep);
    console.log('[Reflect] disposed_completed_conversation', { convoId, decision, nextStep });
  };

  /**
   * 'shown'       — extraction succeeded, decision overlay is up
   * 'error'       — extraction failed and the visible retry state is up (完成 path)
   * 'unavailable' — nothing usable to show; caller falls back to its old path
   */
  const openSummaryConfirmation = async (
    action: 'clear' | 'finish' | 'leave' | 'new'
  ): Promise<'shown' | 'error' | 'unavailable'> => {
    if (isExtractingSummary) return 'shown'; // duplicate click — one request only
    setSummaryError(false);
    setIsExtractingSummary(true);
    try {
      const options = {
        preferredResponseStyle: getModeTitle(currentResponseMode),
        language: (effectiveLanguage === 'zh' ? 'zh' : 'en') as 'zh' | 'en',
        uid: firebaseUser?.uid || seenUser?.uid || 'anonymous',
        sessionId: sessionId || 'unknown'
      };

      // The extraction sees only the complete conversation text. Per-turn
      // mode metadata is a tool preference, never personality evidence — it
      // is stripped here and never reaches trait inference.
      const extractionMessages = messages.map(m => ({ role: m.role, text: m.text }));

      // 完成/结束对话 must never pretend extraction succeeded: backend-only,
      // failures surface the retry state. clear/new keep their existing
      // never-blocking behavior (backend, then local gentle fallback).
      const extracted =
        action === 'finish'
          ? await extractSummaryFromBackend(extractionMessages, options)
          : await extractSummaryFromConversation(extractionMessages, options);

      if (!hasMeaningfulExtraction(extracted)) {
        return 'unavailable';
      }

      setPendingSummary(extracted);
      setPendingInsightAction(action);
      setShowSummaryConfirmation(true);
      setConversationStatus('awaiting_decision');
      return 'shown';
    } catch (error) {
      console.error('[Reflect] Failed to extract summary:', error);
      if (action === 'finish') {
        // Transcript and session stay intact; the person can retry or return.
        setSummaryError(true);
        return 'error';
      }
      return 'unavailable';
    } finally {
      setIsExtractingSummary(false);
    }
  };

  const handleClearContext = async () => {
    if (conversationEnded) {
      performClear();
      return;
    }
    if (messages.length > 0 && hasMeaningfulExchange()) {
      const opened = await openSummaryConfirmation('clear');
      if (opened === 'shown') {
        return;
      }
    }
    performClear();
  };

  const handleStartNewConversation = async () => {
    if (conversationEnded) {
      // Ended conversations never re-extract; just begin a fresh one.
      performClear();
      setStep(1);
      return;
    }
    if ((messages.length > 0 || hasSavedSession) && hasMeaningfulExchange()) {
      const opened = await openSummaryConfirmation('new');
      if (opened === 'shown') {
        return;
      }
    }

    performClear();
    setStep(1);
  };

  const handleEndConversation = async () => {
    if (conversationEnded || isExtractingSummary) return;
    if (messages.length > 0 && hasExtractableContent()) {
      const result = await openSummaryConfirmation('finish');
      if (result !== 'unavailable') {
        return; // decision overlay or retry state is showing
      }
    }
    // Nothing to extract from — end quietly and dispose any short-term transcript.
    disposeReflectAfterDecision(undefined, sessionId, 3);
  };

  /** 再试一次 — exactly one new extraction request per retry. */
  const handleRetryExtraction = async () => {
    setSummaryError(false);
    await openSummaryConfirmation('finish');
  };

  /** 返回对话 — dismiss the error, transcript and session untouched. */
  const handleReturnToConversation = () => {
    setSummaryError(false);
  };

  const performClear = () => {
    clearReflectSession();
    setHasSavedSession(false);
    setRetention('3days');
    setSessionId(undefined);
    // The next conversation starts from the most recently actually-used mode.
    setCurrentResponseMode(loadLastUsedResponseMode(uid));
    setModeChangeNotice(null);
    setMessages([]);
    setConsecutiveQuestionTurns(0);
    setJustCleared(true);
    setPendingSummary(null);
    setPendingInsightAction(null);
    setShowSummaryConfirmation(false);
    setConversationStatus('active');
    setConversationDecision(undefined);
    setSummaryError(false);
    setDecisionError(false);
    setIsSavingDecision(false);
    setStaleConversationNotice(false);
    setRoleDropdownOpen(false);
    setRetentionDropdownOpen(false);
    setMobileDrawerOpen(false);
    restoredConvoRef.current = null;
    if (searchParams.get('conversation')) {
      setSearchParams({}, { replace: true });
    }
    
    if (step !== 0) {
      setStep(0);
    }
    console.log('[Reflect] cleared_context (raw chat deleted)');
  };

  const handleConfirmSummary = async () => {
    // 留下 — save exactly once; duplicate clicks are ignored while in flight.
    if (isSavingDecision) return;
    // Capture the current sessionId before it might get cleared
    const currentSessionId = sessionId;
    
    setDecisionError(false);
    setIsSavingDecision(true);
    try {
      if (pendingSummary) {
        await saveApprovedSummary(
          pendingSummary,
          firebaseUser?.uid || seenUser?.uid,
          currentSessionId,
          { aboutMeSignals: seenUser?.soulProfile?.aboutMeSignals },
        );
        // Reflection History (Sprint 2 data capability): keep the approved
        // reflection itself — never the transcript. Surfaced in Me in Sprint 3.
        saveKeptReflection({
          text: pendingSummary.summaryText,
          language: effectiveLanguage === 'zh' ? 'zh' : 'en',
          sessionId: currentSessionId,
        });
      }
    } catch (error) {
      // Never falsely mark it saved — keep the sentence and decision screen.
      console.error('[Reflect] Failed to save kept reflection:', error);
      setDecisionError(true);
      setIsSavingDecision(false);
      return;
    }
    setIsSavingDecision(false);
    // Keep Understanding Update already saved above; dispose transcript now.
    if (pendingInsightAction === 'new') {
      disposeReflectAfterDecision('kept', currentSessionId, 1);
      return;
    }
    if (pendingInsightAction === 'clear') {
      disposeReflectAfterDecision('kept', currentSessionId, 0);
      return;
    }
    disposeReflectAfterDecision('kept', currentSessionId, 3);
  };

  const handleRejectSummary = () => {
    // 放下 — no kept Understanding Update; dispose transcript immediately.
    if (isSavingDecision) return;
    const currentSessionId = sessionId;
    if (pendingInsightAction === 'new') {
      disposeReflectAfterDecision('released', currentSessionId, 1);
      return;
    }
    if (pendingInsightAction === 'clear') {
      disposeReflectAfterDecision('released', currentSessionId, 0);
      return;
    }
    disposeReflectAfterDecision('released', currentSessionId, 3);
  };

  const handleReply = async () => {
    if (!inputValue.trim()) return;
    if (isLoading || conversationEnded) return;

    setRoleDropdownOpen(false);
    setRetentionDropdownOpen(false);
    setModeChangeNotice(null);
    const currentInput = inputValue;
    // Snapshot the mode for THIS turn — changing the selector afterwards can
    // never mutate an in-flight request; it only affects the next turn.
    const modeForTurn = currentResponseMode;
    setMessages(prev => [...prev, { role: 'user', text: currentInput }]);
    setInputValue('');
    setIsLoading(true);
    
    try {
      const recentTurns = getRecentTurns();
      // The message is accepted for sending with this mode — record it as the
      // user's most recently actually-used mode.
      saveLastUsedResponseMode(uid, modeForTurn);

      const response = await sendReflectWithGate(
        currentInput, 
        effectiveLanguage === 'zh' ? 'zh' : 'en', 
        modeForTurn,
        recentTurns,
        keepContext,
        sessionId,
        {
          isNewSession: false,
          action: 'continue',
        }
      );
      
      const hasQuestion = response.reply.includes('?') || response.reply.includes('？');
      if (hasQuestion) {
        setConsecutiveQuestionTurns(prev => prev + 1);
      } else {
        setConsecutiveQuestionTurns(0);
      }
      
      if (response.debug) setLastDebug(response.debug);
      setMessages(prev => [...prev, {
        role: 'ai',
        text: response.reply,
        debug: response.debug,
        requestedMode: response.requestedMode,
        effectiveMode: response.effectiveMode,
      }]);
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
    if (isLoading) return;
    
    setRoleDropdownOpen(false);
    setRetentionDropdownOpen(false);
    setModeChangeNotice(null);
    setStep(2);
    setConsecutiveQuestionTurns(0);
    setJustCleared(false);
    setMessages([{ role: 'user', text: inputValue }]);
    
    const nextSessionId = keepContext ? crypto.randomUUID() : undefined;
    setSessionId(nextSessionId);

    const currentInput = inputValue;
    // Snapshot the mode for this first turn.
    const modeForTurn = currentResponseMode;
    setInputValue('');
    setIsLoading(true);
    
    try {
      // The message is accepted for sending with this mode — record it as the
      // user's most recently actually-used mode.
      saveLastUsedResponseMode(uid, modeForTurn);

      console.log('[Reflect] handleSend', { responseMode: modeForTurn });

      const response = await sendReflectWithGate(
        currentInput, 
        effectiveLanguage === 'zh' ? 'zh' : 'en', 
        modeForTurn,
        [],
        keepContext,
        nextSessionId,
        {
          isNewSession: true,
          action: 'new_session',
        }
      );
      
      const hasQuestion = response.reply.includes('?') || response.reply.includes('？');
      if (hasQuestion) {
        setConsecutiveQuestionTurns(1);
      }
      
      if (response.debug) setLastDebug(response.debug);
      setMessages(prev => [...prev, {
        role: 'ai',
        text: response.reply,
        debug: response.debug,
        requestedMode: response.requestedMode,
        effectiveMode: response.effectiveMode,
      }]);
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

  // Six canonical response modes — user intents, not AI roles.
  const modeOptions = RESPONSE_MODES.map((mode) => ({
    mode,
    title: t(`reflect.mode_${mode}_title`),
    desc: t(`reflect.mode_${mode}_desc`),
  }));

  const getModeTitle = (mode: ResponseModeType): string => t(`reflect.mode_${mode}_title`);

  const sessionCompletionReached = hasMeaningfulExchange();
  const endConversationLabel = effectiveLanguage === 'zh' ? '结束对话' : 'End conversation';

  // EX-001 §1/§4/§5: a Reflection gives back only the smallest true thing, never a
  // report of dimensions/traits. The extraction below still feeds the internal
  // understanding layer (via saveApprovedSummary) but is never shown to the user.

  // =========================================================================
  // Response-mode dropdown (shared logic, rendered per platform; editable
  // between completed turns — the selection applies to the NEXT response)
  // =========================================================================

  /**
   * Select the mode for the next turn. Never touches earlier messages or an
   * in-flight request, and never writes lastUsedResponseMode (that happens
   * only when a message is actually sent). Mid-conversation switches show a
   * transient, non-chat notice.
   */
  const handleSelectMode = (mode: ResponseModeType) => {
    setCurrentResponseMode(mode);
    setRoleDropdownOpen(false);
    if (modeNoticeTimeoutRef.current) {
      clearTimeout(modeNoticeTimeoutRef.current);
      modeNoticeTimeoutRef.current = null;
    }
    if (messages.some(m => m.role === 'ai')) {
      setModeChangeNotice(mode);
      modeNoticeTimeoutRef.current = setTimeout(() => {
        setModeChangeNotice(null);
        modeNoticeTimeoutRef.current = null;
      }, 4000);
    }
  };

  const roleDropdownMenu = (
    <AnimatePresence>
      {roleDropdownOpen && !modeSelectorDisabled && (
        <>
          <div className="fixed inset-0 z-10" onClick={() => setRoleDropdownOpen(false)} />
          <motion.div
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            exit={{ opacity: 0, y: 4 }}
            transition={{ duration: 0.15 }}
            className={`absolute ${isDesktop ? 'bottom-full left-0 mb-2 w-72' : 'top-full left-0 mt-1 w-64'} bg-white border border-gray-100 rounded-xl shadow-lg z-20 overflow-hidden`}
          >
            <div className="p-1.5 space-y-0.5">
              {modeOptions.map((opt) => {
                const isSelected = currentResponseMode === opt.mode;
                return (
                  <button
                    key={opt.mode}
                    onClick={() => handleSelectMode(opt.mode)}
                    className={`w-full px-3 py-2 text-left rounded-lg transition-colors ${
                      isSelected ? 'bg-gray-50 text-gray-900' : 'text-gray-600 hover:bg-gray-50'
                    }`}
                  >
                    <div className="flex items-center justify-between">
                      <span className="text-xs font-medium">{opt.title}</span>
                      {isSelected && <span className="text-gray-400 text-[10px]">✓</span>}
                    </div>
                    <p className="mt-0.5 text-[10px] leading-snug text-gray-400">
                      {opt.desc}
                    </p>
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

  const responseModeLabel = t('reflect.mode_label');

  const composerFooter = isDesktop ? (
    <div className="flex items-center justify-between pt-1">
      {/* Desktop: single response-mode control on the left — editable between
          completed turns, quietly disabled while a request is in flight or the
          conversation is no longer active (turn-level model, Phase 2C) */}
      <div className="relative">
        {modeSelectorDisabled ? (
          <div
            className="flex items-center gap-1.5 px-1.5 py-1 text-[11px]"
            aria-disabled="true"
          >
            <span className="text-gray-400">{responseModeLabel}</span>
            <span className="font-medium text-gray-400">
              {getModeTitle(currentResponseMode)}
            </span>
          </div>
        ) : (
          <button
            onClick={() => setRoleDropdownOpen(!roleDropdownOpen)}
            className="flex items-center gap-1.5 px-1.5 py-1 rounded-md text-[11px] hover:bg-gray-100 transition-colors"
          >
            <span className="text-gray-500">{responseModeLabel}</span>
            <span className="font-medium text-gray-700">
              {getModeTitle(currentResponseMode)}
            </span>
            <ChevronDown
              size={11}
              className={`text-gray-400 transition-transform duration-200 ${roleDropdownOpen ? 'rotate-180' : ''}`}
            />
          </button>
        )}
        {roleDropdownMenu}
      </div>
      {retentionDropdown}
    </div>
  ) : (
    <div className="flex items-center justify-end pt-1">
      {/* Mobile: the response-mode control lives in the page header only;
          the composer footer keeps just the retention control */}
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
          {/* Mobile: single response-mode control next to title — editable
              between completed turns, disabled while a request is in flight
              or the conversation is no longer active (turn-level model) */}
          {!isDesktop && (
            <div className="relative shrink-0">
              {/* Compact control shows only the short mode title so five modes
                  fit the mobile header without colliding with the language
                  selector; the full label lives in the dropdown context. */}
              {modeSelectorDisabled ? (
                <div
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-50 text-[11px]"
                  aria-label={responseModeLabel}
                  aria-disabled="true"
                >
                  <span className="font-medium text-gray-400 max-w-[38vw] truncate">
                    {getModeTitle(currentResponseMode)}
                  </span>
                </div>
              ) : (
                <button
                  onClick={() => setRoleDropdownOpen(!roleDropdownOpen)}
                  className="flex items-center gap-1 px-2 py-1 rounded-lg bg-gray-50 text-[11px] active:bg-gray-100 transition-colors"
                  aria-label={responseModeLabel}
                >
                  <span className="font-medium text-gray-700 max-w-[38vw] truncate">
                    {getModeTitle(currentResponseMode)}
                  </span>
                  <ChevronDown
                    size={11}
                    className={`text-gray-400 transition-transform duration-200 ${roleDropdownOpen ? 'rotate-180' : ''}`}
                  />
                </button>
              )}
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

      {/* Debug Panel — internal only, requires the explicit VITE_REFLECT_DEBUG
          flag; never rendered in normal local, preview or production UI */}
      {REFLECT_DEBUG_UI && lastDebug && (
        <button
          onClick={() => setShowDebug(!showDebug)}
          className="absolute top-2 right-16 z-50 p-1.5 rounded-full bg-gray-100 text-gray-400 hover:bg-gray-200"
        >
          <Info size={14} />
        </button>
      )}
      
      {REFLECT_DEBUG_UI && showDebug && lastDebug && (
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
          onSelectConversation={(id) => setSearchParams({ conversation: id })}
          onNewConversation={handleStartNewConversation}
        />
      )}

      {/* Quiet notice when a recent-conversation entry no longer resolves */}
      {staleConversationNotice && (
        <div className="shrink-0 px-4 pt-1">
          <div className="mx-auto max-w-md px-3 py-2 rounded-lg bg-gray-50 text-gray-500 text-xs text-center">
            {effectiveLanguage === 'zh' ? '这段对话已不再保留。' : 'This conversation is no longer kept.'}
          </div>
        </div>
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
                  onClick={() => navigate('/me/about-you')}
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

              {momentsInvite.visible && (
                <div className={`${isDesktop ? 'mb-3' : 'mx-auto w-full max-w-sm mb-3'}`}>
                  <MomentsInvitationCard
                    onStart={() => void momentsInvite.start()}
                    onDismiss={momentsInvite.dismiss}
                    starting={momentsInvite.starting}
                  />
                </div>
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
                {effectiveLanguage === 'zh' ? '稍等一下…' : 'One moment…'}
              </p>
            </motion.div>
          )}
        </AnimatePresence>

        {/* ==================== Extraction Failed (retryable) ==================== */}
        <AnimatePresence>
          {summaryError && !isExtractingSummary && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 bg-white/95 backdrop-blur-sm flex flex-col justify-center px-6"
            >
              <div className={`space-y-6 ${isDesktop ? 'max-w-lg mx-auto w-full' : ''}`}>
                <p className="text-sm text-gray-700 font-light leading-relaxed text-center">
                  {effectiveLanguage === 'zh'
                    ? '暂时没能整理出这段对话。你的内容还在，可以再试一次。'
                    : "We couldn't gather this conversation just now. Your words are still here — you can try again."}
                </p>
                <div className="space-y-3">
                  <button
                    onClick={handleRetryExtraction}
                    className="w-full py-3 rounded-xl bg-primary text-white text-sm font-medium hover:bg-black transition-colors"
                  >
                    {effectiveLanguage === 'zh' ? '再试一次' : 'Try again'}
                  </button>
                  <button
                    onClick={handleReturnToConversation}
                    className="w-full py-3 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors"
                  >
                    {effectiveLanguage === 'zh' ? '返回对话' : 'Back to the conversation'}
                  </button>
                </div>
              </div>
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
                    {effectiveLanguage === 'zh'
                      ? '这是 Seen 根据我们的交流，对你的一点理解。'
                      : 'From our conversation, this is a small piece of how Seen understands you.'}
                  </h3>
                  <p className="text-xs text-gray-600 leading-relaxed whitespace-pre-line">
                    {effectiveLanguage === 'zh'
                      ? '这是 Seen 根据刚才的交流，结合目前的理解，整理出的一段话。\n它不一定完全正确。\n如果你觉得符合现在的自己，可以留下。\n如果不太符合，也可以不保留。'
                      : "Based on our conversation and what Seen understands so far, this is a short note Seen has put together.\nIt may not be entirely right.\nIf it fits who you are right now, you can keep it.\nIf it doesn't quite fit, you don't have to."}
                  </p>
                </div>

                <div className="bg-gray-50 p-5 rounded-xl">
                  <p className="text-base text-gray-800 font-light leading-relaxed whitespace-pre-line">
                    {pendingSummary.summaryText}
                  </p>
                </div>

                {decisionError && (
                  <p className="text-xs text-red-500 text-center leading-relaxed">
                    {effectiveLanguage === 'zh'
                      ? '没能保存这句话。它还在这里，可以再试一次。'
                      : "Couldn't save this just now. It's still here — please try again."}
                  </p>
                )}

                <div className="space-y-3 pt-2">
                  <button
                    onClick={handleConfirmSummary}
                    disabled={isSavingDecision}
                    className="w-full py-3 rounded-xl bg-primary text-white text-sm font-medium hover:bg-black transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {isSavingDecision
                      ? (effectiveLanguage === 'zh' ? '正在留下…' : 'Keeping…')
                      : (effectiveLanguage === 'zh' ? '符合我，留下' : 'Feels like me — keep it')}
                  </button>
                  <button
                    onClick={handleRejectSummary}
                    disabled={isSavingDecision}
                    className="w-full py-3 rounded-xl border border-gray-200 text-gray-600 text-sm font-medium hover:bg-gray-50 transition-colors disabled:opacity-60 disabled:cursor-not-allowed"
                  >
                    {effectiveLanguage === 'zh' ? '不太符合，不保留' : "Doesn't quite fit — don't keep it"}
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
              {conversationEnded ? (
                <span className="px-2.5 py-1 rounded-full text-[10px] bg-gray-100 text-gray-500">
                  {effectiveLanguage === 'zh' ? '已结束' : 'Ended'}
                </span>
              ) : (
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
                    disabled={isExtractingSummary}
                    className="px-2.5 py-1 rounded-full text-[10px] text-gray-500 hover:text-gray-700 hover:bg-gray-100 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {sessionCompletionReached ? endConversationLabel : t('common.finish')}
                  </button>
                </div>
              )}
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

            {/* Compact composer with role + context footer — or, for an ended
                conversation, a read-only closing state with no editable input */}
            {conversationEnded ? (
              <div className={`shrink-0 bg-white ${isDesktop ? 'px-8 py-4' : 'px-4 py-3'}`}>
                <div className="mx-auto max-w-sm space-y-3 text-center">
                  <p className="text-xs text-gray-500 font-light">
                    {effectiveLanguage === 'zh' ? '这段对话已结束。' : 'This conversation has ended.'}
                  </p>
                  <button
                    onClick={() => {
                      performClear();
                      setStep(1);
                    }}
                    className="w-full rounded-xl bg-primary py-3 text-sm font-medium text-white transition-colors hover:bg-black"
                  >
                    {effectiveLanguage === 'zh' ? '开启新对话' : 'New conversation'}
                  </button>
                </div>
              </div>
            ) : (
              <div className={`shrink-0 bg-white ${isDesktop ? 'px-8 py-3' : 'px-4 py-2.5'}`}>
                {/* Transient, non-chat notice after a mid-conversation mode
                    switch — never persisted as a message */}
                {modeChangeNotice && (
                  <div className="mb-2 px-2.5 py-1.5 rounded-lg bg-gray-50 text-gray-500 text-[10px] text-center">
                    {effectiveLanguage === 'zh'
                      ? `下一次回复将使用「${getModeTitle(modeChangeNotice)}」`
                      : `The next reply will use "${getModeTitle(modeChangeNotice)}"`}
                  </div>
                )}
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
            )}
          </motion.div>
        )}

        {/* ==================== Step 3: Bridge ==================== */}
        {step === 3 && (
          <motion.div key="step3" {...fadeIn} className="flex-1 flex flex-col justify-center items-center text-center px-8 space-y-8">
             <div className="space-y-4 max-w-xs">
               <h2 className="text-2xl font-light text-primary leading-snug whitespace-pre-line">
                 {t('reflect.complete_title')}
               </h2>
               <p className="text-sm text-gray-600 font-light leading-relaxed whitespace-pre-line">
                 {t('reflect.complete_desc')}
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

             {/* Completion-first: Discover is an optional invitation, shown only
                 when a possibility genuinely exists. Never interrupts completion. */}
             {discoveryAvailable && (
               <div className="w-full max-w-xs rounded-2xl border border-stone-200/90 bg-stone-50/80 px-4 py-4 space-y-3">
                 <p className="text-sm text-primary font-light leading-snug">
                   {t('reflect.invite_discover')}
                 </p>
                 <Link
                   to="/discover"
                   className="block w-full py-2.5 rounded-xl bg-primary text-white hover:bg-black transition-colors text-sm font-medium text-center"
                 >
                   {t('reflect.action_discover')}
                 </Link>
               </div>
             )}

             <div className="space-y-2.5 w-full max-w-xs">
                <button
                  onClick={() => setStep(0)}
                  className="block w-full py-3 rounded-xl border border-gray-200 text-gray-600 hover:border-gray-400 transition-colors text-sm font-medium"
                >
                  {t('reflect.action_done')}
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
