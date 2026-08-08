import { useEffect, useState } from 'react';
import { ChevronLeft } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../i18n';
import {
  readCurrentUnderstanding,
  refreshCurrentUnderstanding,
} from '../../services/understanding/currentUnderstandingStore';
import { assembleLetter } from '../../services/understanding/understandingLetter';
import {
  emptyCurrentUnderstanding,
  type CurrentUnderstanding,
} from '../../services/understanding/currentUnderstanding';

/**
 * 查看我的理解 — "How Seen understands you today".
 *
 * A letter, never a report. This page renders ONLY the assembled letter — no
 * Movement, Facet, Evidence, score or confidence ever reaches the screen. Its
 * length is whatever the evidence honestly supports; a new user sees one quiet
 * line, and it grows as understanding does.
 */
export default function CurrentUnderstandingPage() {
  const navigate = useNavigate();
  const { t, effectiveLanguage } = useLanguage();
  const [cu, setCu] = useState<CurrentUnderstanding | null>(() => readCurrentUnderstanding());

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const fresh = await refreshCurrentUnderstanding();
      if (!cancelled && fresh) setCu(fresh);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  const lang = effectiveLanguage === 'zh' ? 'zh' : 'en';
  const letter = assembleLetter(cu ?? emptyCurrentUnderstanding(), lang);

  return (
    <div className="flex flex-col h-full w-full bg-surface text-primary font-sans">
      <div className="flex flex-col h-full w-full max-w-md mx-auto bg-white">
        <div className="px-6 pt-12 pb-2 flex items-center shrink-0">
          <button
            onClick={() => navigate('/me')}
            className="p-2 -ml-2 text-secondary hover:text-primary transition-colors"
            aria-label={t('common.back')}
          >
            <ChevronLeft size={24} strokeWidth={1.5} />
          </button>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-7 pb-16">
          <div className="pt-8 space-y-7">
            <p className="text-sm text-secondary font-light tracking-wide">{letter.title}</p>

            <div className="space-y-4">
              {letter.lines.map((line, i) => (
                <p key={i} className="text-xl text-primary font-light leading-loose">
                  {line}
                </p>
              ))}
            </div>

            <p className="pt-6 text-xs text-muted font-light leading-relaxed">
              {letter.provenance}
            </p>
          </div>
        </div>
      </div>
    </div>
  );
}
