import { ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { motion, AnimatePresence } from 'framer-motion';
import { useLanguage } from '../../i18n';
import { useKeptReflections } from '../../hooks/useKeptReflections';

/**
 * Kept Reflect Understanding Updates (Me surface).
 *
 * Source of truth: keptReflections store
 *   - Firestore: users/{uid}/keptReflections/{id}
 *   - Offline: seen_kept_reflections
 *
 * Founder Decision (2026-08-05):
 * 「我留下的理解」is a temporary user surface — a history of user-approved
 * Reflect Understanding Updates only. It is NOT Current Understanding.
 * When Current Understanding ships later, these records remain historical
 * and must not automatically become Current Understanding (which is derived,
 * not equal to saved updates).
 *
 * Reads only user-approved kept reflections (text + date).
 * Delete is not exposed here — remote delete is best-effort and can
 * reappear after hydrate if it fails (report separately).
 */
export default function ReflectionHistory() {
  const navigate = useNavigate();
  const { t, effectiveLanguage } = useLanguage();
  const { reflections } = useKeptReflections();
  const locale = effectiveLanguage === 'zh' ? 'zh-CN' : 'en-US';

  return (
    <div className="flex flex-col h-screen w-full bg-surface relative overflow-hidden text-primary font-sans selection:bg-gray-200">
      <div className="flex flex-col h-full w-full max-w-md mx-auto bg-white shadow-none sm:shadow-2xl relative">
        <div className="px-6 pt-12 pb-4 flex items-center justify-between bg-white z-10 sticky top-0 shrink-0">
          <button
            onClick={() => navigate('/me')}
            className="p-2 -ml-2 text-secondary hover:text-primary transition-colors"
            aria-label={t('common.back')}
          >
            <ChevronLeft size={24} strokeWidth={1.5} />
          </button>
          <span className="text-sm font-medium tracking-widest text-muted uppercase">
            {t('me.reflections.page_header')}
          </span>
          <div className="w-8" />
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-6 pb-16">
          <div className="pt-2 pb-6">
            <h1 className="text-2xl font-light text-primary mb-3">{t('me.reflections.page_title')}</h1>
            <p className="text-secondary font-light text-sm leading-relaxed">
              {t('me.reflections.page_desc')}
            </p>
          </div>

          {reflections.length === 0 ? (
            <div className="flex flex-col items-center text-center py-16 space-y-5">
              <div className="space-y-2 max-w-xs">
                <h2 className="text-lg font-light text-primary">{t('me.reflections.empty_title')}</h2>
                <p className="text-sm text-secondary font-light leading-relaxed">
                  {t('me.reflections.empty_desc')}
                </p>
              </div>
              <button
                onClick={() => navigate('/')}
                className="text-sm text-primary underline underline-offset-4 hover:opacity-70 transition-opacity"
              >
                {t('me.reflections.empty_action')}
              </button>
            </div>
          ) : (
            <div className="space-y-4">
              <AnimatePresence initial={false}>
                {reflections.map((r) => (
                  <motion.div
                    key={r.id}
                    layout
                    initial={{ opacity: 0, y: 6 }}
                    animate={{ opacity: 1, y: 0 }}
                    exit={{ opacity: 0, height: 0, marginBottom: 0 }}
                    transition={{ duration: 0.3, ease: 'easeOut' }}
                    className="bg-white border border-stone-200/90 rounded-2xl p-5 shadow-sm"
                  >
                    <p className="text-base text-primary font-light leading-relaxed whitespace-pre-line">
                      {r.text}
                    </p>
                    <p className="mt-3 text-[11px] text-muted tabular-nums">
                      {new Date(r.createdAt).toLocaleDateString(locale, {
                        year: 'numeric',
                        month: 'long',
                        day: 'numeric',
                      })}
                    </p>
                  </motion.div>
                ))}
              </AnimatePresence>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
