import { useState } from 'react';
import { ChevronRight } from 'lucide-react';
import { motion } from 'framer-motion';
import clsx from 'clsx';
import { useLanguage } from '../i18n';
import { useAuth } from '../auth';

type Step = 'nickname' | 'desire';

export default function Onboarding() {
  const { t } = useLanguage();
  const { updateProfile } = useAuth();

  const [step, setStep] = useState<Step>('nickname');
  const [nickname, setNickname] = useState('');
  const [desire, setDesire] = useState('');
  const [saving, setSaving] = useState(false);

  const handleComplete = async () => {
    setSaving(true);
    try {
      console.log('[Onboarding] Submitting profile…');
      await updateProfile({
        nickname: nickname.trim(),
        desire: desire.trim(),
        onboardingCompleted: true,
      });
      console.log('[Onboarding] Profile saved — routing will switch automatically');
    } catch (err) {
      console.error('[Onboarding] Save failed:', err);
      setSaving(false);
    }
  };

  return (
    <div className="h-full bg-white px-8 pt-12 pb-12 flex flex-col">
      <div className="flex items-center justify-end pb-6">
        <span className="text-xs text-muted uppercase tracking-widest">
          {step === 'nickname' ? '1 / 2' : '2 / 2'}
        </span>
      </div>

      {/* Step 1: Nickname */}
      {step === 'nickname' && (
        <motion.div
          key="nickname"
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
          className="flex-1 flex flex-col justify-between"
        >
          <div className="flex-1 flex flex-col justify-center space-y-8 pb-8">
            <h2 className="text-3xl font-light text-primary">
              {t('onboarding.q1_title')}
            </h2>
            <input
              type="text"
              value={nickname}
              onChange={(e) => setNickname(e.target.value)}
              placeholder={t('onboarding.q1_placeholder')}
              className="w-full px-0 py-4 text-2xl font-light text-primary border-b-2 border-gray-200 focus:border-primary focus:outline-none bg-transparent placeholder:text-gray-300 transition-colors"
              autoFocus
            />
          </div>
          <button
            onClick={() => setStep('desire')}
            disabled={!nickname.trim()}
            className={clsx(
              'w-full py-4 rounded-2xl text-lg font-light transition-all flex items-center justify-center gap-2',
              nickname.trim()
                ? 'bg-primary text-white hover:bg-black'
                : 'bg-gray-100 text-gray-300 cursor-not-allowed',
            )}
            style={{ marginBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}
          >
            {t('common.next')}
            <ChevronRight size={20} />
          </button>
        </motion.div>
      )}

      {/* Step 2: Desire */}
      {step === 'desire' && (
        <motion.div
          key="desire"
          initial={{ opacity: 0, x: 30 }}
          animate={{ opacity: 1, x: 0 }}
          transition={{ duration: 0.3 }}
          className="flex-1 flex flex-col justify-between"
        >
          <div className="flex-1 flex flex-col justify-center space-y-6 pb-8">
            <h2 className="text-3xl font-light text-primary leading-snug">
              {t('onboarding.desire_title')}
            </h2>
            <textarea
              value={desire}
              onChange={(e) => setDesire(e.target.value)}
              placeholder={t('onboarding.desire_placeholder')}
              rows={3}
              className="w-full px-4 py-4 rounded-2xl border border-gray-200 focus:border-primary focus:outline-none text-base font-light resize-none"
              autoFocus
            />
            <p className="text-xs text-muted font-light">
              {t('onboarding.desire_note')}
            </p>
          </div>
          <button
            onClick={handleComplete}
            disabled={saving}
            className="w-full py-4 rounded-2xl bg-primary text-white text-lg font-light hover:bg-black transition-colors disabled:opacity-50"
            style={{ marginBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}
          >
            {saving ? t('common.loading') : t('common.continue')}
          </button>
        </motion.div>
      )}
    </div>
  );
}
