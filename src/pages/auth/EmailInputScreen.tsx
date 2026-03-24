import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronLeft } from 'lucide-react';
import clsx from 'clsx';
import { useLanguage } from '../../i18n';
import { useAuth } from '../../auth';

export default function EmailInputScreen() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { sendEmailLink, isLoading, error, clearError } = useAuth();
  const [email, setEmail] = useState('');

  const isValid = /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);

  const handleSend = async () => {
    if (!isValid || isLoading) return;
    clearError();
    try {
      await sendEmailLink(email.trim());
      navigate('/auth/verify');
    } catch {
      // Error handled by context
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === 'Enter') handleSend();
  };

  return (
    <motion.div
      initial={{ opacity: 0, x: 40 }}
      animate={{ opacity: 1, x: 0 }}
      exit={{ opacity: 0, x: -40 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="h-full bg-white px-8 pt-12 pb-12 flex flex-col"
    >
      <button
        onClick={() => navigate('/auth')}
        className="p-2 -ml-2 text-secondary hover:text-primary transition-colors self-start"
        aria-label={t('common.back')}
      >
        <ChevronLeft size={22} strokeWidth={1.5} />
      </button>

      <div className="flex-1 flex flex-col justify-between">
        <div className="flex-1 flex flex-col justify-center space-y-8 pb-8">
          <h2 className="text-3xl font-light text-primary">
            {t('auth.email_title')}
          </h2>
          <input
            type="email"
            inputMode="email"
            autoComplete="email"
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={t('auth.email_placeholder')}
            className="w-full px-0 py-4 text-2xl font-light text-primary border-b-2 border-gray-200 focus:border-primary focus:outline-none bg-transparent placeholder:text-gray-300 transition-colors"
            autoFocus
          />
          {error && (
            <motion.p
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-sm text-secondary font-light"
            >
              {t(error)}
            </motion.p>
          )}

          <div className="pt-4">
            <p className="text-xs text-muted font-light leading-relaxed">
              {t('auth.email_warning')}
            </p>
          </div>
        </div>

        <button
          onClick={handleSend}
          disabled={!isValid || isLoading}
          className={clsx(
            'w-full py-4 rounded-2xl text-lg font-light transition-all',
            isValid && !isLoading
              ? 'bg-primary text-white hover:bg-black'
              : 'bg-gray-100 text-gray-300 cursor-not-allowed',
          )}
          style={{ marginBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}
        >
          {isLoading ? t('common.loading') : t('auth.send_link')}
        </button>
      </div>
    </motion.div>
  );
}
