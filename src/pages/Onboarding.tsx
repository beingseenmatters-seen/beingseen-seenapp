import { useState, useCallback, useEffect } from 'react';
import { ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import { useLanguage } from '../i18n';
import { useAuth } from '../auth';
import type { UnderstandingAnswers } from '../auth';

type Step = 'intro' | 'lifeStory' | 'aiResponse' | 'invite' | 'question' | 'complete';

const QUESTION_KEYS: (keyof UnderstandingAnswers)[] = [
  'proudestMoment',
  'biggestRegret',
  'childhoodDream',
  'selfDescription',
  'biggestInterest',
  'influentialPersonOrQuote',
];

function getAiResponse(lifeStory: string, lang: string): string {
  const hasContent = lifeStory.trim().length > 30;

  if (lang === 'zh') {
    return hasContent
      ? '从你分享的内容来看，你的人生似乎经历了一些重要的转折。\n\n我很好奇——回头看这些变化，你觉得它们更像是你主动做出的选择，还是生活带给你的？'
      : '谢谢你愿意在这里分享。\n\n每个人的旅程都有自己的节奏，我很期待更多地了解你。';
  }

  return hasContent
    ? 'From what you shared, it sounds like your journey has been shaped by some important turning points.\n\nI\'m curious — when you look back, do you feel those changes were something you chose, or something life brought to you?'
    : 'Thank you for being here.\n\nEvery journey has its own rhythm, and I look forward to understanding yours more deeply.';
}

export default function Onboarding() {
  const { t, effectiveLanguage } = useLanguage();
  const { updateProfile, seenUser } = useAuth();
  const lang = effectiveLanguage === 'zh' ? 'zh' : 'en';

  const existingProgress = seenUser?.understandingProgress ?? 0;
  const existingAnswers = seenUser?.understandingAnswers ?? {};

  const [step, setStep] = useState<Step>('intro');
  const [lifeStory, setLifeStory] = useState(seenUser?.lifeStory ?? '');
  const [questionIndex, setQuestionIndex] = useState(existingProgress);
  const [currentAnswer, setCurrentAnswer] = useState('');
  const [answers, setAnswers] = useState<UnderstandingAnswers>(existingAnswers);
  const [saving, setSaving] = useState(false);

  const totalQuestions = QUESTION_KEYS.length;

  const questionTitleKey = (idx: number) => `onboarding.uq_${idx + 1}`;

  useEffect(() => {
    console.log('[Onboarding] mounted, existing progress:', existingProgress);
    return () => console.log('[Onboarding] unmounted');
  }, []);

  const saveField = useCallback(
    async (data: Record<string, unknown>) => {
      console.log('[Onboarding] request started:', Object.keys(data));
      setSaving(true);
      try {
        await Promise.race([
          updateProfile(data as any),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000))
        ]);
        console.log('[Onboarding] request success');
      } catch (err) {
        console.error('[Onboarding] request failed:', err);
      } finally {
        console.log('[Onboarding] clearing loading state');
        setSaving(false);
      }
    },
    [updateProfile],
  );

  const handleLifeStorySubmit = async (skipped: boolean) => {
    console.log('[Onboarding] life story submit clicked, skipped:', skipped);
    const story = skipped ? '' : lifeStory.trim();
    await saveField({
      lifeStory: story,
      onboardingStarted: true,
    });
    if (skipped) {
      console.log('[Onboarding] navigation target: invite');
      setStep('invite');
    } else {
      console.log('[Onboarding] navigation target: aiResponse');
      setStep('aiResponse');
    }
  };

  const handleContinueToQuestions = () => {
    console.log('[Onboarding] continue to questions clicked');
    const key = QUESTION_KEYS[questionIndex];
    setCurrentAnswer(answers[key] ?? '');
    setStep('question');
  };

  const handleMaybeLater = async () => {
    console.log('[Onboarding] skip clicked (maybe later)');
    await saveField({ onboardingCompleted: true });
    console.log('[Onboarding] navigation target: main app (via context)');
  };

  const handleQuestionSubmit = async (skipped: boolean) => {
    console.log(`[Onboarding] question submit clicked (index ${questionIndex}), skipped:`, skipped);
    const key = QUESTION_KEYS[questionIndex];
    const value = skipped ? '' : currentAnswer.trim();

    const updatedAnswers = { ...answers };
    if (value) {
      updatedAnswers[key] = value;
    }
    setAnswers(updatedAnswers);

    const newProgress = questionIndex + 1;

    await saveField({
      understandingAnswers: updatedAnswers,
      understandingProgress: newProgress,
    });

    if (newProgress >= totalQuestions) {
      console.log('[Onboarding] navigation target: complete');
      await saveField({ onboardingCompleted: true });
      setStep('complete');
    } else {
      console.log(`[Onboarding] navigation target: question ${newProgress}`);
      setQuestionIndex(newProgress);
      const nextKey = QUESTION_KEYS[newProgress];
      setCurrentAnswer(updatedAnswers[nextKey] ?? '');
    }
  };

  const handleQuestionStop = async () => {
    console.log('[Onboarding] stop here clicked');
    await saveField({ onboardingCompleted: true });
    console.log('[Onboarding] navigation target: main app (via context)');
  };

  const handleComplete = async () => {
    console.log('[Onboarding] complete clicked');
    await saveField({ onboardingCompleted: true });
    console.log('[Onboarding] navigation target: main app (via context)');
  };

  const fade = {
    initial: { opacity: 0, x: 30 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -30 },
    transition: { duration: 0.3, ease: 'easeOut' as const },
  };

  return (
    <div className="h-full bg-white px-8 pt-12 pb-12 flex flex-col">
      <AnimatePresence mode="wait">
        {/* ========== INTRO ========== */}
        {step === 'intro' && (
          <motion.div key="intro" {...fade} className="flex-1 flex flex-col justify-between">
            <div className="flex-1 flex flex-col justify-center space-y-6">
              <h1 className="text-4xl font-light text-primary leading-tight">
                {t('onboarding.seen_title')}
              </h1>
              <p className="text-lg font-light text-secondary leading-relaxed whitespace-pre-line">
                {t('onboarding.seen_subtitle')}
              </p>
              <p className="text-sm font-light text-muted">
                {t('onboarding.seen_hint')}
              </p>
            </div>
            <button
              onClick={() => setStep('lifeStory')}
              className="w-full py-4 rounded-2xl bg-primary text-white text-lg font-light hover:bg-black transition-colors flex items-center justify-center gap-2"
              style={{ marginBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}
            >
              {t('common.continue')}
              <ChevronRight size={20} />
            </button>
          </motion.div>
        )}

        {/* ========== LIFE STORY ========== */}
        {step === 'lifeStory' && (
          <motion.div key="lifeStory" {...fade} className="flex-1 flex flex-col justify-between">
            <div className="flex-1 flex flex-col justify-center space-y-6 pb-8">
              <h2 className="text-3xl font-light text-primary leading-snug">
                {t('onboarding.life_story_title')}
              </h2>
              <textarea
                value={lifeStory}
                onChange={(e) => setLifeStory(e.target.value)}
                placeholder={t('onboarding.life_story_placeholder')}
                rows={5}
                className="w-full px-4 py-4 rounded-2xl border border-gray-200 focus:border-primary focus:outline-none text-base font-light resize-none"
                autoFocus
              />
            </div>
            <div className="space-y-3" style={{ marginBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}>
              <button
                onClick={() => handleLifeStorySubmit(false)}
                disabled={!lifeStory.trim() || saving}
                className={clsx(
                  'w-full py-4 rounded-2xl text-lg font-light transition-all flex items-center justify-center gap-2',
                  lifeStory.trim() && !saving
                    ? 'bg-primary text-white hover:bg-black'
                    : 'bg-gray-100 text-gray-300 cursor-not-allowed',
                )}
              >
                {saving ? t('common.loading') : t('common.continue')}
              </button>
              <button
                onClick={() => handleLifeStorySubmit(true)}
                disabled={saving}
                className="w-full py-3 text-sm font-light text-muted hover:text-secondary transition-colors"
              >
                {t('onboarding.skip_for_now')}
              </button>
            </div>
          </motion.div>
        )}

        {/* ========== AI RESPONSE ========== */}
        {step === 'aiResponse' && (
          <motion.div key="aiResponse" {...fade} className="flex-1 flex flex-col justify-between">
            <div className="flex-1 flex flex-col justify-center space-y-8 pb-8">
              <div className="bg-gray-50 p-6 rounded-2xl space-y-4">
                <p className="text-base font-light text-primary leading-relaxed whitespace-pre-line">
                  {getAiResponse(lifeStory, lang)}
                </p>
              </div>
            </div>
            <div className="space-y-3" style={{ marginBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}>
              <button
                onClick={() => setStep('invite')}
                className="w-full py-4 rounded-2xl bg-primary text-white text-lg font-light hover:bg-black transition-colors"
              >
                {t('common.continue')}
              </button>
            </div>
          </motion.div>
        )}

        {/* ========== INVITE TO QUESTIONS ========== */}
        {step === 'invite' && (
          <motion.div key="invite" {...fade} className="flex-1 flex flex-col justify-between">
            <div className="flex-1 flex flex-col justify-center space-y-6">
              <p className="text-xl font-light text-primary leading-relaxed whitespace-pre-line">
                {t('onboarding.invite_title')}
              </p>
              <p className="text-sm font-light text-muted leading-relaxed">
                {t('onboarding.invite_subtitle')}
              </p>
            </div>
            <div className="space-y-3" style={{ marginBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}>
              <button
                onClick={handleContinueToQuestions}
                className="w-full py-4 rounded-2xl bg-primary text-white text-lg font-light hover:bg-black transition-colors"
              >
                {t('common.continue')}
              </button>
              <button
                onClick={handleMaybeLater}
                disabled={saving}
                className="w-full py-3 text-sm font-light text-muted hover:text-secondary transition-colors"
              >
                {t('common.later')}
              </button>
            </div>
          </motion.div>
        )}

        {/* ========== UNDERSTANDING QUESTIONS ========== */}
        {step === 'question' && (
          <motion.div key={`q-${questionIndex}`} {...fade} className="flex-1 flex flex-col justify-between">
            <div className="flex items-center justify-between pb-4">
              <span className="text-xs text-muted uppercase tracking-widest">
                {questionIndex + 1} / {totalQuestions}
              </span>
              <button
                onClick={handleQuestionStop}
                disabled={saving}
                className="text-xs text-muted hover:text-secondary transition-colors"
              >
                {t('onboarding.stop_here')}
              </button>
            </div>

            <div className="flex gap-1.5 pb-6">
              {QUESTION_KEYS.map((_, idx) => (
                <div
                  key={idx}
                  className={clsx(
                    'h-1 flex-1 rounded-full transition-colors',
                    idx <= questionIndex ? 'bg-primary' : 'bg-gray-200',
                  )}
                />
              ))}
            </div>

            <div className="flex-1 flex flex-col justify-center space-y-6 pb-8">
              <h2 className="text-2xl font-light text-primary leading-relaxed whitespace-pre-line">
                {t(questionTitleKey(questionIndex))}
              </h2>
              <textarea
                value={currentAnswer}
                onChange={(e) => setCurrentAnswer(e.target.value)}
                placeholder={t('onboarding.life_story_placeholder')}
                rows={4}
                className="w-full px-4 py-4 rounded-2xl border border-gray-200 focus:border-primary focus:outline-none text-base font-light resize-none"
                autoFocus
              />
            </div>

            <div className="space-y-3" style={{ marginBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}>
              <button
                onClick={() => handleQuestionSubmit(false)}
                disabled={!currentAnswer.trim() || saving}
                className={clsx(
                  'w-full py-4 rounded-2xl text-lg font-light transition-all',
                  currentAnswer.trim() && !saving
                    ? 'bg-primary text-white hover:bg-black'
                    : 'bg-gray-100 text-gray-300 cursor-not-allowed',
                )}
              >
                {saving ? t('common.loading') : t('common.continue')}
              </button>
              <button
                onClick={() => handleQuestionSubmit(true)}
                disabled={saving}
                className="w-full py-3 text-sm font-light text-muted hover:text-secondary transition-colors"
              >
                {t('onboarding.skip_for_now')}
              </button>
            </div>
          </motion.div>
        )}

        {/* ========== COMPLETE ========== */}
        {step === 'complete' && (
          <motion.div key="complete" {...fade} className="flex-1 flex flex-col justify-between">
            <div className="flex-1 flex flex-col justify-center items-center text-center space-y-6">
              <h2 className="text-3xl font-light text-primary">
                {t('onboarding.complete_title')}
              </h2>
              <p className="text-base font-light text-secondary leading-relaxed whitespace-pre-line max-w-xs">
                {t('onboarding.complete_subtitle')}
              </p>
            </div>
            <button
              onClick={handleComplete}
              disabled={saving}
              className="w-full py-4 rounded-2xl bg-primary text-white text-lg font-light hover:bg-black transition-colors"
              style={{ marginBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}
            >
              {t('common.begin')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
