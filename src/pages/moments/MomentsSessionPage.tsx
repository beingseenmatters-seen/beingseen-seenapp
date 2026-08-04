import { useEffect, useMemo, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useNavigate, useParams } from 'react-router-dom';
import clsx from 'clsx';
import { useLanguage } from '../../i18n';
import { momentsClient } from '../../services/moments/momentsClient';
import {
  nextQuestionIndex,
  validateSelection,
} from '../../services/moments/momentsService';
import type { MomentsSession } from '../../types/moments';
import MomentRenderer from '../../components/moments/MomentRenderer';
import { localizedText } from '../../services/moments/config';

/**
 * /moments/session/:sessionId — the focused full-screen question flow.
 * One Moment at a time, simple progress, no scores, no internal signals.
 * Every answer persists immediately, so refreshes resume at the right place.
 */
export default function MomentsSessionPage() {
  const navigate = useNavigate();
  const { sessionId } = useParams<{ sessionId: string }>();
  const { t, effectiveLanguage } = useLanguage();

  const [session, setSession] = useState<MomentsSession | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [index, setIndex] = useState(0);
  const [selection, setSelection] = useState<string[]>([]);
  const [busy, setBusy] = useState(false);
  const [confirmRestart, setConfirmRestart] = useState(false);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const active = await momentsClient.loadActiveSession();
      if (cancelled) return;
      if (active && active.id === sessionId) {
        setSession(active);
        setIndex(nextQuestionIndex(active));
      } else {
        // Completed session id → show its result; anything else → entry.
        const completed = sessionId ? await momentsClient.loadSketchDetail(sessionId) : null;
        if (cancelled) return;
        if (completed) {
          navigate(`/moments/result/${sessionId}`, { replace: true });
          return;
        }
        navigate('/moments', { replace: true });
        return;
      }
      setLoaded(true);
    })();
    return () => {
      cancelled = true;
    };
  }, [sessionId, navigate]);

  const snapshot = session?.snapshots[index];

  // Restore any saved answer when arriving at a question.
  useEffect(() => {
    if (!session || !snapshot) return;
    setSelection(session.answers[snapshot.momentId]?.selectedOptionIds ?? []);
  }, [session, snapshot]);

  const selectionValid = useMemo(() => {
    if (!snapshot) return false;
    return selection.length > 0 && validateSelection(snapshot, selection).length === 0;
  }, [snapshot, selection]);

  if (!loaded || !session || !snapshot) {
    return <div className="h-full bg-white" />;
  }

  const total = session.momentIds.length;
  const isLast = index === total - 1;

  const handleBack = () => {
    if (index > 0) setIndex(index - 1);
    else navigate('/moments');
  };

  const handleNext = async () => {
    if (!selectionValid || busy) return;
    setBusy(true);
    try {
      const updated = await momentsClient.saveAnswer(session.id, snapshot.momentId, selection);
      setSession({ ...updated });
      if (isLast) {
        const completed = await momentsClient.completeSession(session.id, effectiveLanguage);
        navigate(`/moments/result/${completed.id}`, { replace: true });
      } else {
        setIndex(index + 1);
      }
    } catch (err) {
      console.error('[Moments] Failed to save answer:', err);
    } finally {
      setBusy(false);
    }
  };

  const handleRestart = async () => {
    if (busy) return;
    setBusy(true);
    try {
      await momentsClient.discardActiveSession();
      navigate('/moments', { replace: true });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="flex flex-col h-full w-full bg-surface relative overflow-hidden text-primary font-sans selection:bg-gray-200">
      <div className="flex flex-col h-full w-full max-w-md mx-auto bg-white shadow-none sm:shadow-2xl relative">
        {/* Header: back + simple progress */}
        <div className="px-6 pt-12 pb-4 flex items-center justify-between bg-white z-10 sticky top-0 shrink-0">
          <button
            onClick={handleBack}
            className="p-2 -ml-2 text-secondary hover:text-primary transition-colors"
            aria-label={t('common.back')}
          >
            <ChevronLeft size={24} strokeWidth={1.5} />
          </button>
          <span className="text-sm font-light text-muted tabular-nums">
            {index + 1} / {total}
          </span>
          <div className="w-8" />
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-6 pb-8 space-y-8">
          <div className="pt-4 space-y-3">
            {snapshot.emoji && <div className="text-3xl">{snapshot.emoji}</div>}
            <h1 className="text-xl font-light text-primary leading-relaxed">
              {localizedText(snapshot.scenario, effectiveLanguage)}
            </h1>
          </div>

          <MomentRenderer
            snapshot={snapshot}
            value={selection}
            onChange={setSelection}
            language={effectiveLanguage}
          />
        </div>

        {/* Footer: next / finish + deliberate restart */}
        <div className="shrink-0 px-6 pb-8 pt-3 bg-white space-y-2">
          <button
            onClick={handleNext}
            disabled={!selectionValid || busy}
            className={clsx(
              'w-full py-4 rounded-2xl text-sm font-medium transition-colors',
              selectionValid && !busy
                ? 'bg-primary text-white hover:bg-black'
                : 'bg-gray-100 text-gray-300 cursor-not-allowed',
            )}
          >
            {isLast ? t('moments.finish') : t('moments.next')}
          </button>
          {!confirmRestart ? (
            <button
              onClick={() => setConfirmRestart(true)}
              className="w-full py-2 text-[11px] font-light text-muted hover:text-secondary transition-colors"
            >
              {t('moments.restart')}
            </button>
          ) : (
            <div className="p-3 bg-gray-50 rounded-2xl space-y-2">
              <p className="text-xs text-secondary font-light leading-relaxed">
                {t('moments.restart_confirm')}
              </p>
              <div className="flex gap-2">
                <button
                  onClick={handleRestart}
                  disabled={busy}
                  className="flex-1 py-2 rounded-xl bg-primary text-white text-xs disabled:opacity-50"
                >
                  {t('moments.restart_yes')}
                </button>
                <button
                  onClick={() => setConfirmRestart(false)}
                  disabled={busy}
                  className="flex-1 py-2 rounded-xl border border-gray-200 bg-white text-xs text-secondary disabled:opacity-50"
                >
                  {t('moments.restart_no')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
