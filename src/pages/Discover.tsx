import { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Check } from 'lucide-react';
import { Link, useNavigate } from 'react-router-dom';
import { useLanguage } from '../i18n';
import { useAuth } from '../auth/AuthContext';
import { getResonateCandidate, sendConnectionRequest } from '../services/connections';
import { asConnectionOrigin, devPreviewOrigin } from '../services/connectionOrigin';
import type { CandidateProfile } from '../services/connections';
import { doc, getDoc } from 'firebase/firestore';
import { db } from '../services/firebase';
import { markDiscoverOpened } from '../services/discoverAvailability';

/**
 * Discover (Phase 4 · Sprint 4B) — implements the frozen Sprint 4A experience.
 *
 * One meaningful possibility at a time, anonymous, explained in one human
 * sentence. No scores, no traits, no profile/dimensions, no feed. After the
 * person considers a possibility, Discover returns to stillness — it never
 * chains to the next candidate.
 */

type Stage = 'looking' | 'forming' | 'possibility' | 'confirm' | 'sent' | 'still';

export default function Discover() {
  const { t, effectiveLanguage } = useLanguage();
  const { firebaseUser } = useAuth();
  const navigate = useNavigate();
  const isZh = effectiveLanguage === 'zh';

  const [candidate, setCandidate] = useState<CandidateProfile | null>(null);
  const [stage, setStage] = useState<Stage>('looking');
  const [isSending, setIsSending] = useState(false);

  useEffect(() => {
    let cancelled = false;

    async function findPossibility() {
      if (!firebaseUser?.uid) {
        if (!cancelled) setStage('forming');
        return;
      }
      setStage('looking');
      try {
        const found = await getResonateCandidate(firebaseUser.uid);
        if (cancelled) return;

        // Opening Discover clears the tab dot, regardless of what the person does next.
        markDiscoverOpened(found?.uid ?? null);

        if (found) {
          setCandidate(found);
          setStage('possibility');
          return;
        }

        // No possibility right now. Distinguish "still forming" from "a quiet day".
        const myDoc = await getDoc(doc(db, 'users', firebaseUser.uid));
        const myData = myDoc.data();
        const hasUnderstanding =
          myData?.soulProfile?.reflectModel || myData?.soulProfile?.latestInsight;
        if (!cancelled) setStage(hasUnderstanding ? 'still' : 'forming');
      } catch (err) {
        console.error('[Discover] Error finding possibility:', err);
        if (!cancelled) {
          markDiscoverOpened(null);
          setStage('still');
        }
      }
    }

    findPossibility();
    return () => {
      cancelled = true;
    };
  }, [firebaseUser?.uid]);

  const reasons = candidate?.reasonsLocalized || [];
  const hasReasons = reasons.length > 0;
  // Connection Origin (同频遇见) — the primary, emotional explanation of why Seen
  // brought these two together, driven by the dominant understanding channel.
  const origin = devPreviewOrigin() ?? asConnectionOrigin(candidate?.source);

  const fade = {
    initial: { opacity: 0, y: 6 },
    animate: { opacity: 1, y: 0 },
    exit: { opacity: 0, y: -6 },
    transition: { duration: 0.5, ease: 'easeOut' as const },
  };

  const handlePass = () => {
    // Discover is a doorway, not a destination — passing returns home to Reflect,
    // never to another candidate.
    navigate('/');
  };

  const handleReachOut = async () => {
    if (!firebaseUser?.uid || !candidate) return;
    setIsSending(true);
    const reasonStrings = hasReasons
      ? reasons.map((r) => (isZh ? r.zh : r.en))
      : candidate.matchReasons || [];
    const success = await sendConnectionRequest(
      firebaseUser.uid,
      candidate.uid,
      'You both reflect deeply on similar themes.',
      null,
      reasonStrings,
      candidate.source,
    );
    setIsSending(false);
    setStage(success ? 'sent' : 'still');
  };

  return (
    <div className="h-full flex flex-col relative">
      <div className="shrink-0 px-5 pt-3 pb-1">
        <span className="text-[11px] font-semibold tracking-[0.2em] text-gray-500 uppercase">
          {t('nav.discover')}
        </span>
      </div>

      <div className="flex-1 min-h-0 px-6 pb-8 flex flex-col overflow-y-auto no-scrollbar">
        <AnimatePresence mode="wait">
          {/* Looking — quiet attentiveness, never "calculating matches" */}
          {stage === 'looking' && (
            <motion.div key="looking" {...fade} className="flex-1 flex flex-col justify-center items-center text-center">
              <p className="text-sm text-muted font-light">{t('discover.looking')}</p>
            </motion.div>
          )}

          {/* Forming — still coming into focus, non-deficient */}
          {stage === 'forming' && (
            <motion.div key="forming" {...fade} className="flex-1 flex flex-col justify-center items-center text-center space-y-6">
              <div className="space-y-4 max-w-xs">
                <h2 className="text-2xl font-light text-primary leading-snug">{t('discover.forming_title')}</h2>
                <p className="text-secondary font-light leading-relaxed">{t('discover.forming_desc')}</p>
              </div>
              <Link
                to="/"
                className="text-sm text-primary underline underline-offset-4 hover:opacity-70 transition-opacity"
              >
                {t('discover.forming_action')}
              </Link>
            </motion.div>
          )}

          {/* Possibility — one anonymous person, one human reason */}
          {stage === 'possibility' && (
            <motion.div key="possibility" {...fade} className="flex-1 flex flex-col">
              <div className="flex-1 flex flex-col justify-center">
                <p className="text-sm text-secondary font-light mb-5">
                  {t('discover.possibility_label')}
                </p>
                <div className="space-y-5">
                  {candidate?.nickname && (
                    <p className="text-sm text-secondary font-light">{candidate.nickname}</p>
                  )}
                  {origin ? (
                    // Connection Origin (同频遇见): title + emotional explanation
                    // (primary) + category tag (secondary cue).
                    <div className="space-y-3">
                      <p className="text-sm text-secondary font-light tracking-wide">
                        {t('connection_origin.title')}
                      </p>
                      <p className="text-xl text-primary font-light leading-relaxed whitespace-pre-line">
                        {t(`connection_origin.${origin}.explanation`)}
                      </p>
                      <span className="inline-block px-2 py-1 rounded-full border border-gray-100 text-xs text-muted">
                        {t(`connection_origin.${origin}.tag`)}
                      </span>
                    </div>
                  ) : hasReasons ? (
                    reasons.map((r, i) => (
                      <p key={i} className="text-xl text-primary font-light leading-relaxed">
                        {isZh ? r.zh : r.en}
                      </p>
                    ))
                  ) : (
                    <p className="text-xl text-primary font-light leading-relaxed">
                      {t('discover.invite_flourish')}
                    </p>
                  )}
                </div>
              </div>

              <div className="space-y-3 pt-6">
                <button
                  onClick={() => setStage('confirm')}
                  className="w-full py-4 rounded-2xl bg-primary text-white text-base font-light hover:bg-black transition-colors"
                >
                  {t('discover.action_reach_out')}
                </button>
                <button
                  onClick={handlePass}
                  className="w-full py-3 rounded-2xl text-muted text-sm hover:text-secondary transition-colors"
                >
                  {t('discover.action_pass')}
                </button>
              </div>
            </motion.div>
          )}

          {/* Confirm — a quiet hello, mutual consent, no pressure */}
          {stage === 'confirm' && (
            <motion.div key="confirm" {...fade} className="flex-1 flex flex-col justify-center items-center text-center space-y-6 px-2">
              <h2 className="text-2xl font-light text-primary">{t('discover.confirm_title')}</h2>
              <p className="text-secondary font-light leading-relaxed max-w-xs whitespace-pre-line">
                {t('discover.confirm_desc')}
              </p>
              <div className="flex w-full max-w-xs space-x-4 pt-4">
                <button
                  onClick={() => setStage('possibility')}
                  disabled={isSending}
                  className="flex-1 py-4 rounded-2xl border border-gray-200 text-secondary hover:bg-gray-50 transition-colors disabled:opacity-50"
                >
                  {t('common.cancel')}
                </button>
                <button
                  onClick={handleReachOut}
                  disabled={isSending}
                  className="flex-1 py-4 rounded-2xl bg-primary text-white hover:bg-black transition-colors disabled:opacity-50"
                >
                  {t('discover.action_send')}
                </button>
              </div>
            </motion.div>
          )}

          {/* Sent — calm completion, nothing else to do */}
          {stage === 'sent' && (
            <motion.div key="sent" {...fade} className="flex-1 flex flex-col justify-center items-center text-center space-y-6">
              <div className="w-16 h-16 rounded-full bg-gray-50 flex items-center justify-center text-primary">
                <Check size={24} strokeWidth={1.5} />
              </div>
              <h2 className="text-xl font-light text-primary">{t('discover.sent_title')}</h2>
              <p className="text-secondary font-light max-w-xs whitespace-pre-line leading-relaxed">
                {t('discover.sent_desc')}
              </p>
              <Link to="/inbox" className="text-sm text-primary underline underline-offset-4 mt-4 hover:opacity-70 transition-opacity">
                {t('discover.sent_action')}
              </Link>
            </motion.div>
          )}

          {/* Still — a quiet day, restful and complete */}
          {stage === 'still' && (
            <motion.div key="still" {...fade} className="flex-1 flex flex-col justify-center items-center text-center space-y-5">
              <div className="space-y-4 max-w-xs">
                <h2 className="text-2xl font-light text-primary leading-snug whitespace-pre-line">
                  {t('discover.still_title')}
                </h2>
                <p className="text-secondary font-light leading-relaxed">{t('discover.still_desc')}</p>
              </div>
              <p className="text-[10px] text-muted pt-2">{t('discover.still_note')}</p>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </div>
  );
}
