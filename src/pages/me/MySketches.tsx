import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../i18n';
import { momentsClient } from '../../services/moments/momentsClient';
import type { SketchSummary } from '../../types/moments';

function formatDate(ts: number, language: 'zh' | 'en'): string {
  return new Date(ts).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/** /me/sketches — quiet history of completed sketches. */
export default function MySketches() {
  const navigate = useNavigate();
  const { t, effectiveLanguage } = useLanguage();
  const [sketches, setSketches] = useState<SketchSummary[] | null>(null);

  useEffect(() => {
    momentsClient.listSketches().then(setSketches).catch(() => setSketches([]));
  }, []);

  return (
    <div className="flex flex-col h-full w-full bg-surface relative overflow-hidden text-primary font-sans selection:bg-gray-200">
      <div className="flex flex-col h-full w-full max-w-md mx-auto bg-white shadow-none sm:shadow-2xl relative">
        {/* Header */}
        <div className="px-6 pt-12 pb-4 flex items-center justify-between bg-white z-10 sticky top-0 shrink-0">
          <button
            onClick={() => navigate('/me')}
            className="p-2 -ml-2 text-secondary hover:text-primary transition-colors"
            aria-label={t('common.back')}
          >
            <ChevronLeft size={24} strokeWidth={1.5} />
          </button>
          <span className="text-sm font-medium tracking-widest text-muted uppercase">
            {t('moments.my_sketches')}
          </span>
          <div className="w-8" />
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-6 pb-12 space-y-4">
          <div className="pt-2 pb-2">
            <h1 className="text-2xl font-light text-primary">{t('moments.my_sketches')}</h1>
          </div>

          {sketches && sketches.length === 0 && (
            <div className="pt-8 text-center space-y-4">
              <p className="text-sm text-secondary font-light leading-relaxed">
                {t('moments.history_empty')}
              </p>
              <button
                onClick={() => navigate('/moments')}
                className="px-6 py-3 rounded-2xl bg-primary text-white text-sm font-medium hover:bg-black transition-colors"
              >
                {t('moments.start')}
              </button>
            </div>
          )}

          {sketches?.map((s) => (
            <button
              key={s.sessionId}
              onClick={() => navigate(`/me/sketches/${s.sessionId}`)}
              className="w-full flex items-center justify-between p-5 bg-white border border-gray-100 rounded-2xl hover:border-gray-300 transition-all duration-300 group shadow-sm text-left"
            >
              <div className="min-w-0 space-y-1.5">
                <div className="flex items-baseline gap-3">
                  <h4 className="text-base font-medium text-primary">
                    {t('moments.sketch_title').replace('{{n}}', String(s.number).padStart(2, '0'))}
                  </h4>
                  <span className="text-[10px] text-muted uppercase tracking-wider">
                    {t('moments.completed')}
                  </span>
                </div>
                <p className="text-xs text-muted">{formatDate(s.completedAt, effectiveLanguage)}</p>
                <p className="text-xs text-secondary font-light truncate">{s.preview}</p>
              </div>
              <ChevronRight size={18} className="shrink-0 ml-3 text-gray-400 group-hover:text-primary transition-colors" />
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
