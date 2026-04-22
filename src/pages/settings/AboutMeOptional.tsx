import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useLocation, useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import { useLanguage } from '../../i18n';
import { useAuth } from '../../auth';
import type { AboutMeQ5Choice, SoulProfileAboutMe } from '../../auth/providers/types';
import {
  computeAboutMeCompletedCount,
  firstIncompleteAboutMeStep,
  normalizeAboutMe,
} from '../../services/aboutMe';
import { extractAboutMeSignals } from '../../services/aboutMeSignals';

const TOTAL_STEPS = 6;

const Q5_KEYS: AboutMeQ5Choice[] = ['alone', 'talk', 'scroll', 'shift', 'other'];

export default function AboutMeOptional() {
  const navigate = useNavigate();
  const location = useLocation();
  const { t } = useLanguage();
  const { seenUser, updateProfile } = useAuth();

  const reviewMode = (location.state as { review?: boolean } | null)?.review === true;

  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<SoulProfileAboutMe>(() => normalizeAboutMe());
  const [saving, setSaving] = useState(false);
  const [toast, setToast] = useState<string | null>(null);
  const initRef = useRef(false);

  const persist = useCallback(
    async (next: SoulProfileAboutMe) => {
      const count = computeAboutMeCompletedCount(next);
      const payload: SoulProfileAboutMe = {
        ...next,
        completedCount: count,
        updatedAt: Date.now(),
      };
      const signals = extractAboutMeSignals(payload);
      setSaving(true);
      try {
        await updateProfile({
          soulProfile: {
            ...seenUser?.soulProfile,
            aboutMe: payload,
            aboutMeSignals: signals,
          },
        });
      } catch (e) {
        console.error('[AboutMeOptional] save failed', e);
        setToast(t('common.error_save'));
      } finally {
        setSaving(false);
      }
    },
    [seenUser?.soulProfile, updateProfile, t],
  );

  useEffect(() => {
    if (!seenUser || initRef.current) return;
    initRef.current = true;
    const normalized = normalizeAboutMe(seenUser.soulProfile?.aboutMe);
    setDraft(normalized);
    if (reviewMode) {
      setStep(0);
    } else {
      setStep(firstIncompleteAboutMeStep(seenUser.soulProfile?.aboutMe));
    }
  }, [seenUser, reviewMode]);

  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(null), 1600);
    return () => clearTimeout(id);
  }, [toast]);

  const updateDraft = useCallback((patch: Partial<SoulProfileAboutMe>) => {
    setDraft((prev) => ({ ...prev, ...patch }));
  }, []);

  const handleContinueLater = async () => {
    await persist(draft);
    setToast(t('common.saved'));
    navigate('/me');
  };

  const handleBackNav = () => {
    if (step <= 0) {
      void persist(draft);
      navigate('/me');
      return;
    }
    setStep((s) => s - 1);
  };

  const handleNext = async () => {
    await persist(draft);
    if (step >= TOTAL_STEPS - 1) {
      setToast(t('common.saved'));
      navigate('/me');
      return;
    }
    setStep((s) => s + 1);
  };

  const q5Label = (key: AboutMeQ5Choice) => t(`me.aboutMe_optional.q5_opt_${key}`);

  return (
    <div className="flex flex-col h-full w-full bg-white text-primary font-sans">
      <div className="shrink-0 px-5 pt-10 pb-3 flex items-center gap-3 border-b border-gray-50">
        <button
          type="button"
          onClick={handleBackNav}
          className="p-2 -ml-2 text-secondary hover:text-primary rounded-lg"
          aria-label={t('common.back')}
        >
          <ChevronLeft size={22} strokeWidth={1.5} />
        </button>
        <div className="flex-1 min-w-0">
          <p className="text-[10px] font-semibold tracking-[0.2em] text-gray-400 uppercase">
            {t('me.aboutMe_optional.header_kicker')}
          </p>
          <h1 className="text-lg font-light text-primary truncate">{t('me.aboutMe_optional.page_title')}</h1>
        </div>
        <span className="text-xs text-muted tabular-nums">
          {step + 1} / {TOTAL_STEPS}
        </span>
      </div>

      <div className="flex-1 min-h-0 overflow-y-auto px-6 py-6 space-y-6">
        {step === 0 && (
          <StepBlock title={t('me.aboutMe_optional.q1_title')} helper={t('me.aboutMe_optional.q1_helper')}>
            <textarea
              value={draft.q1?.text ?? ''}
              onChange={(e) => updateDraft({ q1: { text: e.target.value } })}
              rows={5}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-light text-primary placeholder:text-gray-400 focus:border-gray-400 focus:outline-none resize-none"
              placeholder={t('me.aboutMe_optional.placeholder_short')}
            />
          </StepBlock>
        )}

        {step === 1 && (
          <StepBlock title={t('me.aboutMe_optional.q2_title')} helper={t('me.aboutMe_optional.q2_helper')}>
            <textarea
              value={draft.q2?.text ?? ''}
              onChange={(e) => updateDraft({ q2: { text: e.target.value } })}
              rows={5}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-light text-primary placeholder:text-gray-400 focus:border-gray-400 focus:outline-none resize-none"
              placeholder={t('me.aboutMe_optional.placeholder_short')}
            />
          </StepBlock>
        )}

        {step === 2 && (
          <StepBlock title={t('me.aboutMe_optional.q3_title')} helper={t('me.aboutMe_optional.q3_follow')}>
            <label className="block text-xs text-muted mb-1">{t('me.aboutMe_optional.q3_who')}</label>
            <textarea
              value={draft.q3?.who ?? ''}
              onChange={(e) =>
                updateDraft({ q3: { who: e.target.value, distanceNow: draft.q3?.distanceNow ?? '' } })
              }
              rows={3}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-light mb-4 resize-none"
              placeholder={t('me.aboutMe_optional.placeholder_short')}
            />
            <label className="block text-xs text-muted mb-1">{t('me.aboutMe_optional.q3_distance')}</label>
            <textarea
              value={draft.q3?.distanceNow ?? ''}
              onChange={(e) =>
                updateDraft({ q3: { who: draft.q3?.who ?? '', distanceNow: e.target.value } })
              }
              rows={3}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-light resize-none"
              placeholder={t('me.aboutMe_optional.placeholder_short')}
            />
          </StepBlock>
        )}

        {step === 3 && (
          <StepBlock title={t('me.aboutMe_optional.q4_title')} helper={t('me.aboutMe_optional.q4_follow')}>
            <label className="block text-xs text-muted mb-1">{t('me.aboutMe_optional.q4_sentence')}</label>
            <textarea
              value={draft.q4?.sentence ?? ''}
              onChange={(e) =>
                updateDraft({
                  q4: { sentence: e.target.value, sameAsBefore: draft.q4?.sameAsBefore ?? '' },
                })
              }
              rows={3}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-light mb-4 resize-none"
            />
            <label className="block text-xs text-muted mb-1">{t('me.aboutMe_optional.q4_same')}</label>
            <textarea
              value={draft.q4?.sameAsBefore ?? ''}
              onChange={(e) =>
                updateDraft({
                  q4: { sentence: draft.q4?.sentence ?? '', sameAsBefore: e.target.value },
                })
              }
              rows={3}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-light resize-none"
            />
          </StepBlock>
        )}

        {step === 4 && (
          <StepBlock title={t('me.aboutMe_optional.q5_title')}>
            <div className="space-y-2">
              {Q5_KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  onClick={() =>
                    updateDraft({
                      q5: {
                        choice: key,
                        text: key === 'other' ? draft.q5?.text ?? '' : '',
                      },
                    })
                  }
                  className={clsx(
                    'w-full text-left rounded-xl border px-4 py-3 text-sm font-light transition-colors',
                    draft.q5?.choice === key
                      ? 'border-primary bg-stone-50 text-primary'
                      : 'border-gray-200 text-primary hover:border-gray-300',
                  )}
                >
                  {q5Label(key)}
                </button>
              ))}
            </div>
            {draft.q5?.choice === 'other' && (
              <textarea
                value={draft.q5?.text ?? ''}
                onChange={(e) =>
                  updateDraft({
                    q5: { choice: 'other', text: e.target.value },
                  })
                }
                rows={3}
                className="w-full mt-4 rounded-xl border border-gray-200 px-4 py-3 text-sm font-light resize-none"
                placeholder={t('me.aboutMe_optional.q5_other_placeholder')}
              />
            )}
          </StepBlock>
        )}

        {step === 5 && (
          <StepBlock title={t('me.aboutMe_optional.q6_title')} helper={t('me.aboutMe_optional.q6_helper')}>
            <textarea
              value={draft.q6?.text ?? ''}
              onChange={(e) => updateDraft({ q6: { text: e.target.value } })}
              rows={6}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-light resize-none"
              placeholder={t('me.aboutMe_optional.placeholder_short')}
            />
          </StepBlock>
        )}
      </div>

      <div className="shrink-0 px-6 pb-8 pt-2 space-y-3 border-t border-gray-50 bg-white">
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleNext()}
          className="w-full py-3.5 rounded-2xl bg-primary text-white text-sm font-medium hover:bg-black transition-colors disabled:opacity-50"
        >
          {step >= TOTAL_STEPS - 1 ? t('me.aboutMe_optional.done') : t('me.aboutMe_optional.next')}
        </button>
        <button
          type="button"
          disabled={saving}
          onClick={() => void handleContinueLater()}
          className="w-full py-2.5 text-sm font-light text-muted hover:text-primary transition-colors"
        >
          {t('me.aboutMe_optional.save_later')}
        </button>
        {toast && <p className="text-center text-xs text-secondary">{toast}</p>}
      </div>
    </div>
  );
}

function StepBlock({
  title,
  helper,
  children,
}: {
  title: string;
  helper?: string;
  children: ReactNode;
}) {
  return (
    <div className="space-y-3">
      <h2 className="text-base font-light text-primary leading-snug whitespace-pre-line">{title}</h2>
      {helper && <p className="text-xs text-muted font-light leading-relaxed whitespace-pre-line">{helper}</p>}
      {children}
    </div>
  );
}
