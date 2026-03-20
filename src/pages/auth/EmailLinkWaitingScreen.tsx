import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { ChevronLeft, Mail } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { useAuth, getStoredEmail, isEmailLink, isNative } from '../../auth';

export default function EmailLinkWaitingScreen() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { completeEmailSignIn, sendEmailLink, isLoading, error, clearError } =
    useAuth();
  const storedEmail = getStoredEmail() || '';
  const [resent, setResent] = useState(false);
  const [manualEmail, setManualEmail] = useState('');
  const [needsEmail, setNeedsEmail] = useState(false);
  const attemptedRef = useRef(false);

  useEffect(() => {
    if (attemptedRef.current) return;

    // On native, email link completion is handled by the deep link listener
    // in AuthContext — not by checking window.location.href.
    if (isNative()) {
      console.log('[EmailLinkWaiting] Native platform — waiting for deep link callback');
      return;
    }

    const href = window.location.href;
    const isLink = isEmailLink(href);
    const email = getStoredEmail();

    console.log('[EmailLinkWaiting] Mount check', { isLink, storedEmail: email ?? '(none)', href });

    if (!isLink) return;

    if (!email) {
      console.log('[EmailLinkWaiting] Email link detected but no stored email — prompting user');
      setNeedsEmail(true);
      return;
    }

    attemptedRef.current = true;
    console.log('[EmailLinkWaiting] Completing sign-in with stored email:', email);
    completeEmailSignIn();
  }, [completeEmailSignIn]);

  // On native, if the deep link handler set error_missing_email, show the input
  useEffect(() => {
    if (error === 'auth.error_missing_email') {
      setNeedsEmail(true);
    }
  }, [error]);

  const handleManualEmailSubmit = async () => {
    const email = manualEmail.trim();
    if (!email) return;

    console.log('[EmailLinkWaiting] Completing sign-in with manually entered email:', email);
    attemptedRef.current = true;
    clearError();
    await completeEmailSignIn(email);
  };

  const handleResend = async () => {
    const email = storedEmail || manualEmail.trim();
    if (!email) return;
    clearError();
    try {
      await sendEmailLink(email);
      setResent(true);
      setTimeout(() => setResent(false), 3000);
    } catch {
      // Error handled by context
    }
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
        onClick={() => navigate('/auth/email')}
        className="p-2 -ml-2 text-secondary hover:text-primary transition-colors self-start"
        aria-label={t('common.back')}
      >
        <ChevronLeft size={22} strokeWidth={1.5} />
      </button>

      <div className="flex-1 flex flex-col justify-between">
        <div className="flex-1 flex flex-col justify-center items-center space-y-6 pb-8">
          <div className="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center">
            <Mail size={28} strokeWidth={1.2} className="text-primary" />
          </div>

          <div className="space-y-2 text-center">
            <h2 className="text-3xl font-light text-primary">
              {t('auth.verify_title')}
            </h2>
            {needsEmail ? (
              <p className="text-base font-light text-secondary">
                {t('auth.verify_enter_email')}
              </p>
            ) : (
              <p className="text-base font-light text-secondary">
                {t('auth.verify_subtitle')}{' '}
                <span className="text-primary">{storedEmail}</span>
              </p>
            )}
          </div>

          {needsEmail && (
            <div className="w-full max-w-[300px] space-y-3">
              <input
                type="email"
                value={manualEmail}
                onChange={(e) => setManualEmail(e.target.value)}
                onKeyDown={(e) => e.key === 'Enter' && handleManualEmailSubmit()}
                placeholder={t('auth.email_placeholder')}
                className="w-full px-4 py-3 rounded-xl border border-gray-200 text-base font-light text-primary placeholder:text-muted focus:outline-none focus:border-gray-400 transition-colors"
                autoFocus
              />
              <button
                onClick={handleManualEmailSubmit}
                disabled={isLoading || !manualEmail.trim()}
                className="w-full py-3 rounded-2xl bg-primary text-white text-base font-light hover:bg-black transition-colors disabled:opacity-50"
              >
                {isLoading ? t('common.loading') : t('auth.verify_submit_email')}
              </button>
            </div>
          )}

          {!needsEmail && (
            <p className="text-sm text-center text-muted font-light max-w-[260px]">
              {t('auth.verify_hint')}
            </p>
          )}

          {error && error !== 'auth.error_missing_email' && (
            <motion.p
              initial={{ opacity: 0, y: 4 }}
              animate={{ opacity: 1, y: 0 }}
              className="text-sm text-center text-secondary font-light"
            >
              {t(error)}
            </motion.p>
          )}

          {resent && (
            <motion.p
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              className="text-sm text-center text-secondary font-light"
            >
              {t('auth.verify_resent')}
            </motion.p>
          )}
        </div>

        <div className="space-y-3" style={{ marginBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}>
          {!needsEmail && (
            <button
              onClick={handleResend}
              disabled={isLoading}
              className="w-full py-3 text-base font-light text-secondary hover:text-primary transition-colors disabled:opacity-50"
            >
              {t('auth.verify_resend_btn')}
            </button>
          )}
          <button
            onClick={() => navigate('/auth/email')}
            className="w-full py-3 text-sm font-light text-muted hover:text-secondary transition-colors"
          >
            {t('auth.verify_different')}
          </button>
        </div>
      </div>
    </motion.div>
  );
}
