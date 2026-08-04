import { useEffect, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import { useLanguage } from '../../i18n';
import { momentsClient } from '../../services/moments/momentsClient';
import type { MomentsSession } from '../../types/moments';
import { MOMENTS_META } from '../../data/moments/library';
import { localizedText } from '../../services/moments/config';
import { displaySketchText } from '../../services/moments/sketchEngineV2';

/**
 * /moments/result/:sessionId — the stored sketch for a completed session.
 * Selection is frozen at completion; wording follows the active UI language
 * when Sketch V2 provenance is present.
 */
export default function MomentsResultPage() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();
  const { t, effectiveLanguage } = useLanguage();
  const [session, setSession] = useState<MomentsSession | null>(null);
  const [loaded, setLoaded] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const detail = sessionId ? await momentsClient.loadSketchDetail(sessionId) : null;
      if (cancelled) return;
      if (!detail || !detail.sketch) {
        // Unfinished session → back into the flow; unknown → entry.
        const active = await momentsClient.loadActiveSession();
        if (cancelled) return;
        if (active && active.id === sessionId) {
          navigate(`/moments/session/${sessionId}`, { replace: true });
        } else {
          navigate('/moments', { replace: true });
        }
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
  const numberLabel = String(sketch.number).padStart(2, '0');
  const footer = localizedText(MOMENTS_META.footerTemplate, effectiveLanguage).replace(
    '{n}',
    String(session.momentIds.length),
  );

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
            {t('moments.header')}
          </span>
          <div className="w-8" />
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-6 pb-12 space-y-8">
          <div className="pt-4 space-y-3">
            <h1 className="text-2xl font-light text-primary">
              {t('moments.sketch_title').replace('{{n}}', numberLabel)}
            </h1>
            <p className="text-xs text-muted font-light leading-relaxed whitespace-pre-line">
              {localizedText(MOMENTS_META.resultSub, effectiveLanguage)}
            </p>
          </div>

          <div className="p-5 bg-gray-50 rounded-2xl border border-gray-100">
            <p className="text-sm text-primary font-light leading-loose">
              {displaySketchText(sketch, effectiveLanguage)}
            </p>
          </div>

          <p className="text-[11px] text-muted font-light leading-relaxed whitespace-pre-line">
            {footer}
          </p>

          <div className="space-y-3 pt-2">
            <button
              onClick={() => navigate('/me/sketches')}
              className="w-full py-3.5 rounded-2xl bg-primary text-white text-sm font-medium hover:bg-black transition-colors"
            >
              {t('moments.view_all_sketches')}
            </button>
            <button
              onClick={() => navigate('/me')}
              className="w-full py-3 rounded-2xl border border-gray-200 text-secondary text-sm hover:bg-gray-50 transition-colors"
            >
              {t('moments.back_to_me')}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
