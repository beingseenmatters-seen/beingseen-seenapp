import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronDown } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { useLanguage } from '../../i18n';
import { momentsClient } from '../../services/moments/momentsClient';
import type { MomentsSession } from '../../types/moments';
import { localizedText } from '../../services/moments/config';

function formatDate(ts: number, language: 'zh' | 'en'): string {
  return new Date(ts).toLocaleDateString(language === 'zh' ? 'zh-CN' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });
}

/**
 * /me/sketches/:sessionId — one stored sketch, with an optional collapsed
 * 回看这次选择 section rendered from the session's immutable content snapshots.
 */
export default function SketchDetail() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();
  const { t, effectiveLanguage } = useLanguage();
  const [session, setSession] = useState<MomentsSession | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [showChoices, setShowChoices] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const detail = sessionId ? await momentsClient.loadSketchDetail(sessionId) : null;
      if (cancelled) return;
      if (!detail || !detail.sketch) {
        navigate('/me/sketches', { replace: true });
        return;
      }
      setSession(detail);
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, navigate]);

  if (!loaded || !session?.sketch) {
    return <div className="h-full bg-white" />;
  }

  const sketch = session.sketch;

  return (
    <div className="flex flex-col h-full w-full bg-surface relative overflow-hidden text-primary font-sans selection:bg-gray-200">
      <div className="flex flex-col h-full w-full max-w-md mx-auto bg-white shadow-none sm:shadow-2xl relative">
        {/* Header */}
        <div className="px-6 pt-12 pb-4 flex items-center justify-between bg-white z-10 sticky top-0 shrink-0">
          <button
            onClick={() => navigate(-1)}
            className="p-2 -ml-2 text-secondary hover:text-primary transition-colors"
            aria-label={t('common.back')}
          >
            <ChevronLeft size={24} strokeWidth={1.5} />
          </button>
          <span className="text-sm font-medium tracking-widest text-muted uppercase">
            {t('moments.header')}
          </span>
          <div className="w-8" />
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-6 pb-12 space-y-8">
          <div className="pt-4 space-y-2">
            <h1 className="text-2xl font-light text-primary">
              {t('moments.sketch_title').replace('{{n}}', String(sketch.number).padStart(2, '0'))}
            </h1>
            <p className="text-xs text-muted">
              {formatDate(session.completedAt ?? sketch.generatedAt, effectiveLanguage)}
            </p>
          </div>

          <div className="p-5 bg-gray-50 rounded-2xl border border-gray-100">
            <p className="text-sm text-primary font-light leading-loose">{sketch.text}</p>
          </div>

          {/* Collapsed review of the choices, from immutable snapshots */}
          <div className="border border-gray-100 rounded-2xl overflow-hidden">
            <button
              onClick={() => setShowChoices(!showChoices)}
              className="w-full flex items-center justify-between p-4 text-left hover:bg-gray-50 transition-colors"
            >
              <span className="text-sm font-light text-primary">{t('moments.review_choices')}</span>
              <ChevronDown
                size={16}
                className={clsx('text-gray-400 transition-transform', showChoices && 'rotate-180')}
              />
            </button>
            {showChoices && (
              <div className="px-4 pb-4 space-y-5">
                {session.momentIds.map((momentId, i) => {
                  const snap = session.snapshots.find((s) => s.momentId === momentId);
                  const answer = session.answers[momentId];
                  if (!snap || !answer) return null;
                  return (
                    <div key={momentId} className="space-y-1.5 pt-2 border-t border-gray-50 first:border-t-0">
                      <p className="text-xs text-muted font-light leading-relaxed">
                        {i + 1} · {localizedText(snap.scenario, effectiveLanguage)}
                      </p>
                      {answer.selectedOptionIds.map((optId) => {
                        const opt = snap.options.find((o) => o.id === optId);
                        if (!opt) return null;
                        return (
                          <div key={optId} className="space-y-0.5">
                            <p className="text-sm font-light text-primary leading-relaxed">
                              {localizedText(opt.text, effectiveLanguage)}
                            </p>
                            {opt.interpretation && (
                              <p className="text-[11px] text-secondary font-light leading-relaxed">
                                {localizedText(opt.interpretation, effectiveLanguage)}
                              </p>
                            )}
                          </div>
                        );
                      })}
                    </div>
                  );
                })}
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
