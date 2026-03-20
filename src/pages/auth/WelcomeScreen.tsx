import { useNavigate } from 'react-router-dom';
import { motion } from 'framer-motion';
import { useLanguage } from '../../i18n';

export default function WelcomeScreen() {
  const navigate = useNavigate();
  const { t } = useLanguage();

  return (
    <motion.div
      initial={{ opacity: 0 }}
      animate={{ opacity: 1 }}
      transition={{ duration: 0.6, ease: 'easeOut' }}
      className="h-full bg-white px-8 pt-12 pb-12 flex flex-col"
    >
      <div className="flex-1 flex flex-col justify-center space-y-8">
        <h1 className="text-4xl font-light text-primary leading-tight">
          {t('auth.welcome_title')}
        </h1>
        <p className="text-lg font-light text-secondary whitespace-pre-line leading-relaxed">
          {t('auth.welcome_subtitle')}
        </p>
      </div>

      <motion.button
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ delay: 0.4, duration: 0.4 }}
        onClick={() => navigate('/auth')}
        className="w-full py-4 rounded-2xl bg-primary text-white text-lg font-light hover:bg-black transition-colors"
        style={{ marginBottom: 'calc(env(safe-area-inset-bottom) + 8px)' }}
      >
        {t('common.continue')}
      </motion.button>
    </motion.div>
  );
}
