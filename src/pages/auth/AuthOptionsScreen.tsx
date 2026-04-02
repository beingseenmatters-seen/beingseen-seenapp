import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { Mail, ChevronLeft } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { useAuth, isGoogleAvailable, isAppleAvailable } from '../../auth';
import { usePlatform } from '../../hooks/usePlatform';

function AppleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className} width="20" height="20">
      <path d="M17.05 20.28c-.98.95-2.05.88-3.08.4-1.09-.5-2.08-.48-3.24 0-1.44.62-2.2.44-3.06-.4C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.8 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.53 4.09zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z" />
    </svg>
  );
}

function GoogleIcon({ className }: { className?: string }) {
  return (
    <svg viewBox="0 0 24 24" className={className} width="20" height="20">
      <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z" fill="#4285F4" />
      <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853" />
      <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="#FBBC05" />
      <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335" />
    </svg>
  );
}

function ComingSoonBadge({ label }: { label: string }) {
  return (
    <span className="absolute -top-2 right-3 text-[10px] font-medium tracking-wide uppercase text-muted bg-white px-2 py-0.5 rounded-full border border-gray-200">
      {label}
    </span>
  );
}

export default function AuthOptionsScreen() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const { signInWithGoogle, signInWithApple, isLoading, error, clearError } = useAuth();
  const { isAndroid } = usePlatform();

  const googleActive = isGoogleAvailable();
  const appleActive = isAppleAvailable();

  const handleGoogle = async () => {
    clearError();
    try {
      await signInWithGoogle();
    } catch {
      // Error handled by context
    }
  };

  const handleApple = async () => {
    clearError();
    try {
      await signInWithApple();
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
        onClick={() => navigate('/welcome')}
        className="p-2 -ml-2 text-secondary hover:text-primary transition-colors self-start"
        aria-label={t('common.back')}
      >
        <ChevronLeft size={22} strokeWidth={1.5} />
      </button>

      <div className="flex-1 flex flex-col justify-center space-y-6">
        <div className="space-y-2 mb-4">
          <h2 className="text-3xl font-light text-primary">
            {t('auth.options_title')}
          </h2>
          <p className="text-sm font-light text-muted">
            {t('auth.options_subtitle')}
          </p>
        </div>

        {/* Email — always first, always active on every platform */}
        <button
          onClick={() => navigate('/auth/email')}
          disabled={isLoading}
          className="w-full py-4 rounded-2xl bg-primary text-white text-base font-light flex items-center justify-center gap-3 hover:bg-black transition-colors disabled:opacity-50"
        >
          <Mail size={20} strokeWidth={1.5} />
          {t('auth.continue_email')}
        </button>

        {/* Apple — available on iOS and Web, hidden on Android */}
        {!isAndroid && (
          appleActive ? (
            <button
              onClick={handleApple}
              disabled={isLoading}
              className="w-full py-4 rounded-2xl border border-border text-primary text-base font-light flex items-center justify-center gap-3 hover:bg-highlight transition-colors disabled:opacity-50"
            >
              <AppleIcon />
              {t('auth.continue_apple')}
            </button>
          ) : (
            <div className="relative">
              <button
                disabled
                className="w-full py-4 rounded-2xl bg-gray-50 text-gray-300 text-base font-light flex items-center justify-center gap-3 cursor-not-allowed"
              >
                <AppleIcon className="text-gray-300" />
                {t('auth.continue_apple')}
              </button>
              <ComingSoonBadge label={t('common.feature_coming_soon')} />
            </div>
          )
        )}

        {/* Google — active on web, disabled on native with explanation */}
        {googleActive ? (
          <button
            onClick={handleGoogle}
            disabled={isLoading}
            className="w-full py-4 rounded-2xl border border-border text-primary text-base font-light flex items-center justify-center gap-3 hover:bg-highlight transition-colors disabled:opacity-50"
          >
            <GoogleIcon />
            {t('auth.continue_google')}
          </button>
        ) : (
          <div className="relative">
            <button
              disabled
              className="w-full py-4 rounded-2xl bg-gray-50 text-gray-300 text-base font-light flex items-center justify-center gap-3 cursor-not-allowed"
            >
              <GoogleIcon className="opacity-30" />
              {t('auth.continue_google')}
            </button>
            <ComingSoonBadge label={t('auth.google_web_only')} />
          </div>
        )}


        {error && (
          <motion.p
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-sm text-center text-secondary font-light pt-2"
          >
            {t(error)}
          </motion.p>
        )}
      </div>
    </motion.div>
  );
}
