import { useState, useCallback, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { ChevronRight } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import clsx from 'clsx';
import { useLanguage } from '../i18n';
import { useAuth } from '../auth';
import type { AiResponseStyleId, SeenUser } from '../auth';
import { UNDERSTANDING_SLIDER_CARD_DEFS } from '../data/understandingSliderCards';

/** First-login flow: 3 steps (basic info → understanding style sliders → AI response), then complete. */
type ActiveStep = 'basicInfo' | 'understandingStyle' | 'aiResponse';

const TOTAL_ONBOARDING_STEPS = 3;

const AGE_RANGE_VALUES = ['18-24', '25-34', '35-44', '45-54', '55+'] as const;

const AGE_RANGE_LABEL_KEYS: Record<(typeof AGE_RANGE_VALUES)[number], string> = {
  '18-24': 'onboarding.age_18_24',
  '25-34': 'onboarding.age_25_34',
  '35-44': 'onboarding.age_35_44',
  '45-54': 'onboarding.age_45_54',
  '55+': 'onboarding.age_55_plus',
};

const GENDER_OPTIONS = [
  { value: 'female', labelKey: 'onboarding.gender_female' },
  { value: 'male', labelKey: 'onboarding.gender_male' },
  { value: 'non_binary', labelKey: 'onboarding.gender_non_binary' },
  { value: 'prefer_not', labelKey: 'onboarding.gender_prefer_not' },
] as const;

/** Stored in `basic.currentState` */
const CURRENT_STATE_OPTIONS = [
  { value: 'looking_for_connection', labelKey: 'onboarding.state_connection' },
  { value: 'healing_or_processing', labelKey: 'onboarding.state_healing' },
  { value: 'space_to_talk', labelKey: 'onboarding.state_talk' },
  { value: 'unsure', labelKey: 'onboarding.state_unsure' },
] as const;

function stepOrdinal(step: ActiveStep): number {
  if (step === 'basicInfo') return 1;
  if (step === 'understandingStyle') return 2;
  return 3;
}

/** Maps onboarding `responseStyle` to legacy `role` used in settings/Reflect (Sidebar, AIResponse). */
function mapResponseStyleToLegacyRole(style: AiResponseStyleId): string {
  switch (style) {
    case 'listener':
      return 'mirror';
    case 'organizer':
      return 'organizer';
    case 'challenger':
      return 'guide';
    case 'supporter':
      return 'helper';
    default:
      return 'mirror';
  }
}

const AI_STYLE_OPTIONS: { id: AiResponseStyleId; titleKey: string; descKey: string }[] = [
  { id: 'listener', titleKey: 'onboarding.ai_listener', descKey: 'onboarding.ai_listener_desc' },
  { id: 'organizer', titleKey: 'onboarding.ai_organizer', descKey: 'onboarding.ai_organizer_desc' },
  { id: 'challenger', titleKey: 'onboarding.ai_challenger', descKey: 'onboarding.ai_challenger_desc' },
  { id: 'supporter', titleKey: 'onboarding.ai_supporter', descKey: 'onboarding.ai_supporter_desc' },
];

/**
 * Legacy lifeStory-based preview text — kept for possible reuse; first-login Step 3 no longer calls this.
 */
export function getAiResponse(lifeStory: string, lang: string): string {
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

function buildInitialSliderAnswers(seen: SeenUser | null): Record<string, number> {
  const u = seen?.soulProfile?.understanding || {};
  const out: Record<string, number> = {};
  for (const c of UNDERSTANDING_SLIDER_CARD_DEFS) {
    const v = u[c.id as keyof typeof u];
    out[c.id] = typeof v === 'number' && !Number.isNaN(v) ? v : 50;
  }
  return out;
}

function getStringArray(t: (path: string) => unknown, key: string): string[] {
  const v = t(key);
  return Array.isArray(v) ? (v as string[]) : [];
}

function SelectChip({
  selected,
  onClick,
  children,
  className,
}: {
  selected: boolean;
  onClick: () => void;
  children: ReactNode;
  className?: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={clsx(
        'rounded-xl border px-3 py-2.5 text-sm font-light text-left transition-colors',
        selected ? 'border-primary bg-stone-50 text-primary' : 'border-gray-200 bg-white text-primary hover:border-gray-300',
        className,
      )}
    >
      {children}
    </button>
  );
}

export default function Onboarding() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { updateProfile, seenUser } = useAuth();

  const [step, setStep] = useState<ActiveStep>('basicInfo');
  const [ageRange, setAgeRange] = useState('');
  const [gender, setGender] = useState('');
  const [currentState, setCurrentState] = useState('');
  const [sliderAnswers, setSliderAnswers] = useState<Record<string, number>>(() => buildInitialSliderAnswers(seenUser));
  const [responseStyle, setResponseStyle] = useState<AiResponseStyleId | ''>(
    () => (seenUser?.soulProfile?.aiPreference?.responseStyle as AiResponseStyleId) || '',
  );
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!seenUser?.basic) return;
    setAgeRange((a) => a || seenUser.basic!.age || '');
    setGender((g) => g || seenUser.basic!.gender || '');
    setCurrentState((c) => c || seenUser.basic!.currentState || '');
  }, [seenUser]);

  useEffect(() => {
    if (!seenUser?.soulProfile?.understanding) return;
    setSliderAnswers((prev) => {
      const next = { ...prev };
      for (const c of UNDERSTANDING_SLIDER_CARD_DEFS) {
        const v = seenUser.soulProfile?.understanding?.[c.id];
        if (typeof v === 'number' && !Number.isNaN(v)) next[c.id] = v;
      }
      return next;
    });
  }, [seenUser]);

  useEffect(() => {
    const rs = seenUser?.soulProfile?.aiPreference?.responseStyle as AiResponseStyleId | undefined;
    if (rs && ['listener', 'organizer', 'challenger', 'supporter'].includes(rs)) {
      setResponseStyle((prev) => prev || rs);
    }
  }, [seenUser]);

  useEffect(() => {
    console.log('[Onboarding] mounted (3-step flow)');
    return () => console.log('[Onboarding] unmounted');
  }, []);

  const saveField = useCallback(
    async (data: Record<string, unknown>) => {
      console.log('[Onboarding] request started:', Object.keys(data));
      setSaving(true);
      try {
        await Promise.race([
          updateProfile(data as any),
          new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 5000)),
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

  const finishOnboardingWithAiStyle = useCallback(async () => {
    if (!responseStyle || saving) return;
    const style = responseStyle as AiResponseStyleId;
    await saveField({
      soulProfile: {
        ...seenUser?.soulProfile,
        aiPreference: {
          ...seenUser?.soulProfile?.aiPreference,
          responseStyle: style,
          role: mapResponseStyleToLegacyRole(style),
        },
      },
      onboardingCompleted: true,
    });
    console.log('[Onboarding] navigation target: main app');
    navigate('/', { replace: true });
  }, [navigate, saveField, seenUser, responseStyle, saving]);

  const basicInfoComplete = Boolean(ageRange && currentState);

  const handleBasicInfoNext = async () => {
    if (!basicInfoComplete || saving) return;
    await saveField({
      basic: {
        ...(seenUser?.basic || {}),
        age: ageRange,
        currentState,
        ...(gender ? { gender } : {}),
      },
    });
    setStep('understandingStyle');
  };

  const handleSliderChange = (id: string, value: number) => {
    setSliderAnswers((prev) => ({ ...prev, [id]: value }));
  };

  const handleUnderstandingNext = async () => {
    const mergedUnderstanding = {
      ...(seenUser?.soulProfile?.understanding || {}),
      ...sliderAnswers,
    };
    await saveField({
      soulProfile: {
        ...seenUser?.soulProfile,
        understanding: mergedUnderstanding,
      },
      onboardingStarted: true,
    });
    setStep('aiResponse');
  };

  const handleUnderstandingSkip = async () => {
    await saveField({ onboardingStarted: true });
    setStep('aiResponse');
  };

  const fade = {
    initial: { opacity: 0, x: 30 },
    animate: { opacity: 1, x: 0 },
    exit: { opacity: 0, x: -30 },
    transition: { duration: 0.3, ease: 'easeOut' as const },
  };

  const progressLabel = t('onboarding.step_of_total').replace('{{n}}', String(stepOrdinal(step)));

  return (
    <div className="h-full bg-white px-8 pt-12 pb-12 flex flex-col">
      <div className="pb-6 space-y-2 shrink-0">
        <span className="text-xs text-muted uppercase tracking-widest">{progressLabel}</span>
        <div className="flex gap-1.5">
          {Array.from({ length: TOTAL_ONBOARDING_STEPS }, (_, idx) => (
            <div
              key={idx}
              className={clsx(
                'h-1 flex-1 rounded-full transition-colors',
                idx < stepOrdinal(step) ? 'bg-primary' : 'bg-gray-200',
              )}
            />
          ))}
        </div>
      </div>

      <AnimatePresence mode="wait">
        {/* Step 1 — Basic Info */}
        {step === 'basicInfo' && (
          <motion.div key="basicInfo" {...fade} className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto min-h-0 space-y-5 pb-4">
              <div className="space-y-2">
                <h1 className="text-2xl font-light text-primary leading-snug">{t('onboarding.basic_info_title')}</h1>
                <p className="text-sm font-light text-secondary leading-relaxed">{t('onboarding.basic_info_subtitle')}</p>
              </div>

              <section className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted">{t('onboarding.age_range')}</p>
                <div className="flex flex-wrap gap-2">
                  {AGE_RANGE_VALUES.map((value) => (
                    <SelectChip key={value} selected={ageRange === value} onClick={() => setAgeRange(value)}>
                      {t(AGE_RANGE_LABEL_KEYS[value])}
                    </SelectChip>
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <div className="flex items-baseline gap-2">
                  <p className="text-xs font-medium uppercase tracking-wider text-muted">{t('onboarding.gender')}</p>
                  <span className="text-xs text-muted font-light">({t('onboarding.gender_optional_hint')})</span>
                </div>
                <div className="grid grid-cols-2 gap-2">
                  {GENDER_OPTIONS.map(({ value, labelKey }) => (
                    <SelectChip key={value} selected={gender === value} onClick={() => setGender((g) => (g === value ? '' : value))}>
                      {t(labelKey)}
                    </SelectChip>
                  ))}
                </div>
              </section>

              <section className="space-y-2">
                <p className="text-xs font-medium uppercase tracking-wider text-muted">{t('onboarding.current_state')}</p>
                <p className="text-sm font-light text-primary leading-snug">{t('onboarding.current_state_prompt')}</p>
                <div className="flex flex-col gap-2">
                  {CURRENT_STATE_OPTIONS.map(({ value, labelKey }) => (
                    <SelectChip key={value} selected={currentState === value} onClick={() => setCurrentState(value)} className="w-full">
                      {t(labelKey)}
                    </SelectChip>
                  ))}
                </div>
              </section>
            </div>

            {!basicInfoComplete && (
              <p className="text-xs text-center text-muted font-light pb-2 shrink-0">{t('onboarding.basic_info_incomplete')}</p>
            )}

            <button
              type="button"
              onClick={() => handleBasicInfoNext()}
              disabled={!basicInfoComplete || saving}
              className={clsx(
                'w-full py-3.5 rounded-2xl text-lg font-light transition-all flex items-center justify-center gap-2 shrink-0',
                basicInfoComplete && !saving ? 'bg-primary text-white hover:bg-black' : 'bg-gray-100 text-gray-300 cursor-not-allowed',
              )}
              style={{ marginBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}
            >
              {saving ? t('common.loading') : t('common.next')}
              {!saving && <ChevronRight size={20} />}
            </button>
          </motion.div>
        )}

        {/* Step 2 — My Understanding Style (7 sliders, same model as Me → Understanding) */}
        {step === 'understandingStyle' && (
          <motion.div key="understandingStyle" {...fade} className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto min-h-0 space-y-8 pb-4">
              <div className="space-y-2">
                <h2 className="text-2xl font-light text-primary leading-snug">{t('onboarding.understanding_style_title')}</h2>
                <p className="text-sm font-light text-secondary leading-relaxed">{t('onboarding.understanding_style_subtitle')}</p>
              </div>

              {UNDERSTANDING_SLIDER_CARD_DEFS.map((card, index) => {
                const labels = getStringArray(t, card.labelsKey);
                const currentValue = sliderAnswers[card.id] ?? 50;

                return (
                  <div
                    key={card.id}
                    className="space-y-4 border-t border-dashed border-gray-200 pt-6 first:border-t-0 first:pt-0"
                  >
                    <div className="space-y-1">
                      <span className="text-[10px] text-muted tracking-widest uppercase">0{index + 1}</span>
                      <h3 className="text-base font-medium text-primary leading-snug">{t(card.titleKey)}</h3>
                    </div>
                    <div className="space-y-3 py-1">
                      <input
                        type="range"
                        min={0}
                        max={100}
                        value={currentValue}
                        onChange={(e) => handleSliderChange(card.id, parseInt(e.target.value, 10))}
                        className="w-full h-2 bg-gray-200 rounded-lg appearance-none cursor-pointer accent-primary focus:outline-none touch-pan-x"
                        style={{ touchAction: 'pan-x' }}
                      />
                      <div className="flex justify-between gap-3 text-xs text-secondary font-light">
                        <span className="text-left flex-1">{labels[0]}</span>
                        <span className="text-right flex-1">{labels[1]}</span>
                      </div>
                    </div>
                    <div className="bg-gray-50/80 rounded-lg p-3">
                      <p className="text-xs text-muted font-light leading-relaxed">{t(card.descKey)}</p>
                    </div>
                  </div>
                );
              })}
            </div>

            <div className="space-y-3 shrink-0" style={{ marginBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}>
              <button
                type="button"
                onClick={() => handleUnderstandingNext()}
                disabled={saving}
                className="w-full py-3.5 rounded-2xl text-lg font-light transition-all flex items-center justify-center gap-2 bg-primary text-white hover:bg-black disabled:bg-gray-100 disabled:text-gray-300 disabled:cursor-not-allowed"
              >
                {saving ? t('common.loading') : t('common.next')}
                {!saving && <ChevronRight size={20} />}
              </button>
              <button
                type="button"
                onClick={() => handleUnderstandingSkip()}
                disabled={saving}
                className="w-full py-3 text-sm font-light text-muted hover:text-secondary transition-colors"
              >
                {t('onboarding.skip_for_now')}
              </button>
            </div>
          </motion.div>
        )}

        {/* Step 3 — How AI responds (style picker; legacy text preview not used here) */}
        {step === 'aiResponse' && (
          <motion.div key="aiResponse" {...fade} className="flex-1 flex flex-col min-h-0">
            <div className="flex-1 overflow-y-auto min-h-0 space-y-4 pb-4">
              <div className="space-y-2">
                <h2 className="text-2xl font-light text-primary leading-snug">{t('onboarding.ai_style_title')}</h2>
                <p className="text-sm font-light text-secondary leading-relaxed">{t('onboarding.ai_style_subtitle')}</p>
              </div>
              <div className="flex flex-col gap-3" role="radiogroup" aria-label={t('onboarding.ai_style_title')}>
                {AI_STYLE_OPTIONS.map((opt) => {
                  const selected = responseStyle === opt.id;
                  return (
                    <button
                      key={opt.id}
                      type="button"
                      role="radio"
                      aria-checked={selected}
                      onClick={() => setResponseStyle(opt.id)}
                      className={clsx(
                        'w-full text-left rounded-2xl border-2 px-4 py-4 transition-colors',
                        selected ? 'border-primary bg-stone-50' : 'border-gray-200 bg-white hover:border-gray-300',
                      )}
                    >
                      <span className="block text-base font-medium text-primary leading-snug">{t(opt.titleKey)}</span>
                      <span className="mt-2 block text-xs font-light text-secondary whitespace-pre-line leading-relaxed">
                        {t(opt.descKey)}
                      </span>
                    </button>
                  );
                })}
              </div>
            </div>
            <button
              type="button"
              onClick={() => finishOnboardingWithAiStyle()}
              disabled={!responseStyle || saving}
              className={clsx(
                'w-full py-4 rounded-2xl text-lg font-light transition-colors shrink-0',
                responseStyle && !saving ? 'bg-primary text-white hover:bg-black' : 'bg-gray-100 text-gray-300 cursor-not-allowed',
              )}
              style={{ marginBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}
            >
              {saving ? t('common.loading') : t('common.finish')}
            </button>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}
