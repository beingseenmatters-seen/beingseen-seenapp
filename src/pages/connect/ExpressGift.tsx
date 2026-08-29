import { ChevronLeft, ArrowUpRight } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import { useLanguage } from '../../i18n';

/** Ecosystem home + full-product escape hatch. */
const SEEN_MATTERS_HOME = 'https://www.beingseenmatters.com';
const GIFT_HOME = 'https://gift.beingseenmatters.com';

/**
 * The four current Gift.Seen "送一份心意 / Send something" families. Tapping a
 * card LEAVES Seen for the CURRENT Gift.Seen product (same-tab) — the real
 * creation flow. There is deliberately NO second composer / taxonomy / prompt /
 * seal / Gift storage here; the route targets mirror gift.beingseenmatters.com
 * (love/wishes/care → /c/:key, write-your-own → /compose/custom). Auth
 * continuity is Gift.Seen's own safe sign-in — no invented cross-origin token.
 */
const SEND_ITEMS = [
  { key: 'love', emoji: '❤️', href: `${GIFT_HOME}/c/love?source=seen` },
  { key: 'wishes', emoji: '🎉', href: `${GIFT_HOME}/c/wishes?source=seen` },
  { key: 'care', emoji: '🌿', href: `${GIFT_HOME}/c/care?source=seen` },
  { key: 'write', emoji: '✍️', href: `${GIFT_HOME}/compose/custom?source=seen` },
] as const;

/**
 * Connect → 有句话，想送给 TA. The legacy standalone composer surface is RETIRED:
 * this is now a lightweight EMBEDDED Gift.Seen entry — the current Send-something
 * catalogue. It only routes into the current Gift.Seen product; the shared
 * services/gift/* stay in place for the Gift reveal (/s/:token) but no seal
 * logic runs here. Seen Matters (upper-left) returns to the ecosystem home;
 * GIFT.SEEN opens the full product.
 */
export default function ExpressGift() {
  const navigate = useNavigate();
  const { t } = useLanguage();
  const P = (k: string) => t(`express.${k}`);

  return (
    <div className="flex flex-col h-full w-full bg-surface text-primary font-sans">
      <div className="flex flex-col h-full w-full max-w-md md:max-w-xl mx-auto bg-white">
        {/* Header — three DISTINCT actions stacked vertically so they can't be
            mis-tapped or conflated: back (return through the Seen journey),
            Seen Matters (ecosystem home), GIFT.SEEN (the full Gift.Seen product). */}
        <div className="px-6 pt-12 pb-4 bg-white z-10 sticky top-0 shrink-0">
          <button
            onClick={() => navigate('/inbox')}
            className="p-2 -ml-2 text-secondary hover:text-primary transition-colors"
            aria-label={t('common.back')}
          >
            <ChevronLeft size={24} strokeWidth={1.5} />
          </button>
          <a
            href={SEEN_MATTERS_HOME}
            aria-label={P('seen_matters_home')}
            data-seen-matters-home
            className="mt-1 flex items-baseline gap-1 w-fit select-none leading-none transition-opacity hover:opacity-70"
          >
            <span className="text-sm font-bold tracking-tight text-[#F4685A]">seen</span>
            <span className="text-[9px] font-medium uppercase tracking-[0.22em] text-stone-500">Matters</span>
          </a>
          <a
            href={GIFT_HOME}
            aria-label={P('open_full_gift')}
            data-open-full-gift
            className="mt-1.5 inline-flex items-center gap-1 w-fit text-[11px] font-medium tracking-[0.2em] text-[#F4685A] uppercase hover:opacity-70 transition-opacity"
          >
            GIFT.SEEN <ArrowUpRight size={12} strokeWidth={2} />
          </a>
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-6 pb-12">
          {/* Content header — the current Gift.Seen Home title/copy. */}
          <div className="pt-4 space-y-2">
            <h1 className="text-2xl font-light text-primary leading-snug">{P('catalogue_title')}</h1>
            <p className="text-sm text-secondary font-light leading-relaxed">{P('catalogue_subtitle')}</p>
          </div>

          {/* The four current Gift.Seen Send families — compact 2-column layout. */}
          <div className="grid grid-cols-2 gap-3 mt-6" data-send-catalogue>
            {SEND_ITEMS.map((item) => (
              <a
                key={item.key}
                href={item.href}
                data-send-card={item.key}
                className="flex flex-col items-start gap-2 p-4 rounded-2xl bg-gray-50 border border-gray-100 hover:border-gray-300 transition-colors text-left"
              >
                <span className="text-xl" aria-hidden>{item.emoji}</span>
                <span className="text-sm text-primary leading-snug">{P(`send_${item.key}`)}</span>
                <span className="text-xs font-light text-muted leading-snug">{P(`send_${item.key}_sub`)}</span>
              </a>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
