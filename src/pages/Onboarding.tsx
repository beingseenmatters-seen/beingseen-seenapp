import { useState, useCallback, useEffect, type ReactNode } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { useLanguage } from '../i18n';
import { useAuth } from '../auth';
import { ZODIAC_SIGNS } from '../data/zodiac';

/**
 * First-login flow — single Basic Info step ending in 进入 Seen.
 *
 * Onboarding philosophy (founder decision): collect only information that
 * cannot naturally emerge from later interaction — nickname, age range,
 * gender and zodiac. Reflect and Moments are the primary understanding
 * mechanisms; anything they can surface over time (current state, interests,
 * understanding style, response preferences) is never requested up front.
 *
 * `basic.currentState` and `basic.interests` still exist as legacy schema
 * fields — existing users' values are preserved untouched — but onboarding
 * no longer collects or writes them.
 */

const AGE_RANGE_VALUES = ['18-24', '25-34', '35-44', '45-54', '55+'] as const;

const AGE_RANGE_LABEL_KEYS: Record<(typeof AGE_RANGE_VALUES)[number], string> = {
  '18-24': 'onboarding.age_18_24',
  '25-34': 'onboarding.age_25_34',
  '35-44': 'onboarding.age_35_44',
  '45-54': 'onboarding.age_45_54',
  '55+': 'onboarding.age_55_plus',
};

/**
 * Founder decision: gender is required, and onboarding shows only these two
 * active values (existing stored schema values). Gender is presentation /
 * Moment-routing metadata only — it must never be used to assume the gender
 * of a user's desired partner, and it never enters matching or Reflect
 * prompts as personality evidence.
 */
const GENDER_OPTIONS = [
  { value: 'female', labelKey: 'onboarding.gender_female' },
  { value: 'male', labelKey: 'onboarding.gender_male' },
] as const;

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

  const [nickname, setNickname] = useState('');
  const [ageRange, setAgeRange] = useState('');
  const [gender, setGender] = useState('');
  const [zodiac, setZodiac] = useState('');
  const [saving, setSaving] = useState(false);

  useEffect(() => {
    if (!seenUser?.basic) return;
    setNickname((n) => n || seenUser.basic!.nickname || '');
    setAgeRange((a) => a || seenUser.basic!.age || '');
    setGender((g) => g || seenUser.basic!.gender || '');
    setZodiac((z) => z || seenUser.basic!.zodiac || '');
  }, [seenUser]);

  useEffect(() => {
    console.log('[Onboarding] mounted (single-step flow)');
    return () => console.log('[Onboarding] unmounted');
  }, []);

  /**
   * Founder decision: exactly four fields are collected — nickname, age
   * range, gender and zodiac. 进入 Seen stays disabled until they are valid.
   */
  const demographicsComplete = Boolean(nickname.trim() && ageRange && gender && zodiac);

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

  const handleEnterSeen = useCallback(async () => {
    if (!demographicsComplete || saving) return;
    // The `...basic` spread preserves any legacy fields an existing user
    // already has (currentState, interests, location, …) — onboarding writes
    // only the four collected values and never replaces legacy data.
    await saveField({
      nickname: nickname.trim(), // Keep top-level nickname for legacy/auth compatibility if needed
      basic: {
        ...(seenUser?.basic || {}),
        nickname: nickname.trim(),
        age: ageRange,
        gender,
        // Canonical sign value only — the date range is display metadata and
        // is never written to the profile.
        zodiac,
      },
      onboardingStarted: true,
      onboardingCompleted: true,
    });
    console.log('[Onboarding] navigation target: main app');
    navigate('/', { replace: true });
  }, [demographicsComplete, saving, saveField, nickname, seenUser, ageRange, gender, zodiac, navigate]);

  return (
    <div className="h-full bg-white px-8 pt-12 pb-12 flex flex-col">
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.3, ease: 'easeOut' }}
        className="flex-1 flex flex-col min-h-0"
      >
        <div className="flex-1 overflow-y-auto min-h-0 space-y-5 pb-4">
          <div className="space-y-2">
            <h1 className="text-2xl font-light text-primary leading-snug">{t('onboarding.basic_info_title')}</h1>
            <p className="text-sm font-light text-secondary leading-relaxed">{t('onboarding.basic_info_subtitle')}</p>
          </div>

          <section className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">{t('onboarding.nickname')}</p>
            <p className="text-xs text-secondary font-light">{t('onboarding.nickname_desc')}</p>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              maxLength={30}
              placeholder={t('onboarding.nickname_placeholder')}
              className="w-full rounded-xl border border-gray-200 px-4 py-3 text-sm font-light text-primary placeholder:text-gray-400 focus:border-gray-400 focus:outline-none"
            />
          </section>

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
            <p className="text-xs font-medium uppercase tracking-wider text-muted">{t('onboarding.gender')}</p>
            <div className="grid grid-cols-2 gap-2">
              {GENDER_OPTIONS.map(({ value, labelKey }) => (
                <SelectChip key={value} selected={gender === value} onClick={() => setGender(value)}>
                  {t(labelKey)}
                </SelectChip>
              ))}
            </div>
          </section>

          <section className="space-y-2">
            <p className="text-xs font-medium uppercase tracking-wider text-muted">{t('onboarding.zodiac')}</p>
            {/* 12-sign card grid: 2 columns on mobile, 3/4 on wider layouts.
                Date ranges are display metadata only — never stored. */}
            <div
              className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-2"
              role="radiogroup"
              aria-label={t('onboarding.zodiac')}
            >
              {ZODIAC_SIGNS.map(({ value, labelKey, range }) => {
                const selected = zodiac === value;
                return (
                  <button
                    key={value}
                    type="button"
                    role="radio"
                    aria-checked={selected}
                    onClick={() => setZodiac(value)}
                    className={clsx(
                      'rounded-xl border px-3 py-2.5 text-left transition-colors',
                      selected
                        ? 'border-primary bg-stone-50 text-primary'
                        : 'border-gray-200 bg-white text-primary hover:border-gray-300',
                    )}
                  >
                    <span className="block text-sm font-light leading-snug">{t(labelKey)}</span>
                    <span className="mt-0.5 block text-[10px] font-light text-muted">{range}</span>
                  </button>
                );
              })}
            </div>
          </section>
        </div>

        {!demographicsComplete && (
          <p className="text-xs text-center text-muted font-light pb-2 shrink-0">{t('onboarding.basic_info_incomplete')}</p>
        )}

        {/* 进入 Seen — primary completion action; stays disabled until all
            four required demographics (nickname/age/gender/zodiac) are valid */}
        <button
          type="button"
          onClick={() => handleEnterSeen()}
          disabled={!demographicsComplete || saving}
          className={clsx(
            'w-full py-4 rounded-2xl text-lg font-light transition-colors shrink-0',
            demographicsComplete && !saving ? 'bg-primary text-white hover:bg-black' : 'bg-gray-100 text-gray-300 cursor-not-allowed',
          )}
          style={{ marginBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}
        >
          {saving ? t('common.loading') : t('onboarding.enter_seen')}
        </button>
      </motion.div>
    </div>
  );
}
