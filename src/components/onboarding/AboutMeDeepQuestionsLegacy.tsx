/**
 * Legacy first-login "About Me" flow: invite screen + six `understandingAnswers` (uq_1–uq_6) + thank-you.
 * Removed from the initial onboarding route; keep for reuse (e.g. optional entry from Me / Reflect).
 *
 * Data model: `UnderstandingAnswers` on SeenUser (`understandingAnswers`, `understandingProgress`).
 * To re-attach: mount these steps in a route or modal, wire `updateProfile` + navigation like the old Onboarding flow.
 */
import { motion } from 'framer-motion';
import clsx from 'clsx';
import type { UnderstandingAnswers } from '../../auth';

export const ABOUT_ME_ONBOARDING_QUESTION_KEYS: (keyof UnderstandingAnswers)[] = [
  'proudestMoment',
  'biggestRegret',
  'childhoodDream',
  'selfDescription',
  'biggestInterest',
  'influentialPersonOrQuote',
];

export function aboutMeQuestionTitleKey(idx: number): string {
  return `onboarding.uq_${idx + 1}`;
}

const defaultFade = {
  initial: { opacity: 0, x: 30 },
  animate: { opacity: 1, x: 0 },
  exit: { opacity: 0, x: -30 },
  transition: { duration: 0.3, ease: 'easeOut' as const },
};

type TFn = (path: string) => string;

export function AboutMeOnboardingInviteStep({
  t,
  fade = defaultFade,
  onContinue,
  onMaybeLater,
  saving,
}: {
  t: TFn;
  fade?: typeof defaultFade;
  onContinue: () => void;
  onMaybeLater: () => void;
  saving: boolean;
}) {
  return (
    <motion.div key="invite" {...fade} className="flex-1 flex flex-col justify-between">
      <div className="flex-1 flex flex-col justify-center space-y-6">
        <p className="text-xl font-light text-primary leading-relaxed whitespace-pre-line">{t('onboarding.invite_title')}</p>
        <p className="text-sm font-light text-muted leading-relaxed">{t('onboarding.invite_subtitle')}</p>
      </div>
      <div className="space-y-3" style={{ marginBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}>
        <button
          type="button"
          onClick={onContinue}
          className="w-full py-4 rounded-2xl bg-primary text-white text-lg font-light hover:bg-black transition-colors"
        >
          {t('common.continue')}
        </button>
        <button
          type="button"
          onClick={onMaybeLater}
          disabled={saving}
          className="w-full py-3 text-sm font-light text-muted hover:text-secondary transition-colors"
        >
          {t('common.later')}
        </button>
      </div>
    </motion.div>
  );
}

export function AboutMeOnboardingQuestionStep({
  t,
  fade = defaultFade,
  questionIndex,
  totalQuestions,
  questionKeys,
  currentAnswer,
  onAnswerChange,
  onSubmit,
  onStopHere,
  saving,
}: {
  t: TFn;
  fade?: typeof defaultFade;
  questionIndex: number;
  totalQuestions: number;
  questionKeys: (keyof UnderstandingAnswers)[];
  currentAnswer: string;
  onAnswerChange: (v: string) => void;
  onSubmit: (skipped: boolean) => void;
  onStopHere: () => void;
  saving: boolean;
}) {
  return (
    <motion.div key={`q-${questionIndex}`} {...fade} className="flex-1 flex flex-col justify-between">
      <div className="flex items-center justify-between pb-4">
        <span className="text-xs text-muted uppercase tracking-widest">
          {questionIndex + 1} / {totalQuestions}
        </span>
        <button
          type="button"
          onClick={onStopHere}
          disabled={saving}
          className="text-xs text-muted hover:text-secondary transition-colors"
        >
          {t('onboarding.stop_here')}
        </button>
      </div>

      <div className="flex gap-1.5 pb-6">
        {questionKeys.map((_, idx) => (
          <div
            key={idx}
            className={clsx('h-1 flex-1 rounded-full transition-colors', idx <= questionIndex ? 'bg-primary' : 'bg-gray-200')}
          />
        ))}
      </div>

      <div className="flex-1 flex flex-col justify-center space-y-6 pb-8">
        <h2 className="text-2xl font-light text-primary leading-relaxed whitespace-pre-line">{t(aboutMeQuestionTitleKey(questionIndex))}</h2>
        <textarea
          value={currentAnswer}
          onChange={(e) => onAnswerChange(e.target.value)}
          placeholder={t('onboarding.life_story_placeholder')}
          rows={4}
          className="w-full px-4 py-4 rounded-2xl border border-gray-200 focus:border-primary focus:outline-none text-base font-light resize-none"
          autoFocus
        />
      </div>

      <div className="space-y-3" style={{ marginBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}>
        <button
          type="button"
          onClick={() => onSubmit(false)}
          disabled={!currentAnswer.trim() || saving}
          className={clsx(
            'w-full py-4 rounded-2xl text-lg font-light transition-all',
            currentAnswer.trim() && !saving ? 'bg-primary text-white hover:bg-black' : 'bg-gray-100 text-gray-300 cursor-not-allowed',
          )}
        >
          {saving ? t('common.loading') : t('common.continue')}
        </button>
        <button
          type="button"
          onClick={() => onSubmit(true)}
          disabled={saving}
          className="w-full py-3 text-sm font-light text-muted hover:text-secondary transition-colors"
        >
          {t('onboarding.skip_for_now')}
        </button>
      </div>
    </motion.div>
  );
}

export function AboutMeOnboardingCompleteStep({
  t,
  fade = defaultFade,
  onBegin,
  saving,
}: {
  t: TFn;
  fade?: typeof defaultFade;
  onBegin: () => void;
  saving: boolean;
}) {
  return (
    <motion.div key="complete" {...fade} className="flex-1 flex flex-col justify-between">
      <div className="flex-1 flex flex-col justify-center items-center text-center space-y-6">
        <h2 className="text-3xl font-light text-primary">{t('onboarding.complete_title')}</h2>
        <p className="text-base font-light text-secondary leading-relaxed whitespace-pre-line max-w-xs">{t('onboarding.complete_subtitle')}</p>
      </div>
      <button
        type="button"
        onClick={onBegin}
        disabled={saving}
        className="w-full py-4 rounded-2xl bg-primary text-white text-lg font-light hover:bg-black transition-colors"
        style={{ marginBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}
      >
        {t('common.begin')}
      </button>
    </motion.div>
  );
}
