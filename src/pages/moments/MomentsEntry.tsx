import { useEffect, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../i18n';
import {
  momentsClient,
  refreshMomentLibraryFromRemote,
} from '../../services/moments/momentsClient';
import type { MomentsOverview } from '../../services/moments/momentsService';
import { MOMENTS_META } from '../../data/moments/library';
import { localizedText } from '../../services/moments/config';

/**
 * /moments — quiet entry to a set of Moments. Continues an unfinished session
 * when one exists; never silently replaces it.
 */
export default function MomentsEntry() {
  const navigate = useNavigate();
  const { t, effectiveLanguage } = useLanguage();
  const [overview, setOverview] = useState<MomentsOverview | null>(null);
  const [busy, setBusy] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      await refreshMomentLibraryFromRemote();
      if (cancelled) return;
      try {
        setOverview(await momentsClient.getOverview());
      } catch {
        setOverview(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleStart = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await refreshMomentLibraryFromRemote();
      const session = await momentsClient.createSession();
      navigate(`/moments/session/${session.id}`);
    } finally {
      setBusy(false);
    }
  };

  const handleRestart = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await refreshMomentLibraryFromRemote();
      await momentsClient.discardActiveSession();
      const session = await momentsClient.createSession();
      navigate(`/moments/session/${session.id}`);
    } finally {
      setBusy(false);
    }
  };

  const slogan = localizedText(MOMENTS_META.intro.sloganTemplate, effectiveLanguage).replace(
    '{n}',
    String(overview?.sessionSize ?? 10),
  );
  const sub = localizedText(MOMENTS_META.intro.sub, effectiveLanguage);
  const hasActive = !!overview?.activeSession;

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

        <div className="flex-1 overflow-y-auto no-scrollbar px-6 pb-12 flex flex-col justify-center">
          <div className="space-y-8 pb-16">
            <div className="space-y-4">
              <h1 className="text-2xl font-light text-primary leading-relaxed whitespace-pre-line">
                {slogan}
              </h1>
              <p className="text-sm text-secondary font-light leading-relaxed whitespace-pre-line">
                {sub}
              </p>
            </div>

            {hasActive ? (
              <div className="space-y-4">
                <p className="text-xs text-muted font-light tabular-nums">
                  {t('moments.progress_line')
                    .replace('{{n}}', String(overview?.answeredCount ?? 0))
                    .replace('{{total}}', String(overview?.sessionSize ?? 10))}
                </p>
                <button
                  onClick={() => navigate(`/moments/session/${overview!.activeSession!.id}`)}
                  className="w-full py-4 rounded-2xl bg-primary text-white text-sm font-medium hover:bg-black transition-colors"
                >
                  {t('moments.continue')}
                </button>
                {!confirmRestart ? (
                  <button
                    onClick={() => setConfirmRestart(true)}
                    className="w-full py-3 text-xs font-light text-muted hover:text-secondary transition-colors"
                  >
                    {t('moments.restart')}
                  </button>
                ) : (
                  <div className="p-4 bg-gray-50 rounded-2xl space-y-3">
                    <p className="text-xs text-secondary font-light leading-relaxed">
                      {t('moments.restart_confirm')}
                    </p>
                    <div className="flex gap-2">
                      <button
                        onClick={handleRestart}
                        disabled={busy}
                        className="flex-1 py-2.5 rounded-xl bg-primary text-white text-xs disabled:opacity-50"
                      >
                        {t('moments.restart_yes')}
                      </button>
                      <button
                        onClick={() => setConfirmRestart(false)}
                        disabled={busy}
                        className="flex-1 py-2.5 rounded-xl border border-gray-200 bg-white text-xs text-secondary disabled:opacity-50"
                      >
                        {t('moments.restart_no')}
                      </button>
                    </div>
                  </div>
                )}
              </div>
            ) : (
              <button
                onClick={handleStart}
                disabled={busy || !overview}
                className="w-full py-4 rounded-2xl bg-primary text-white text-sm font-medium hover:bg-black transition-colors disabled:opacity-50"
              >
                {t('moments.start')}
              </button>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
