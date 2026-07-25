import clsx from 'clsx';
import type { MomentRendererProps } from './MomentRenderer';
import { localizedText } from '../../services/moments/config';

/**
 * Generic ranking renderer — tap options in preference order; tapping a ranked
 * option removes it (and everything ranked after it keeps its relative order).
 * No drag-and-drop dependency. There is currently no production ranking
 * Moment; this renderer is exercised via test fixtures only.
 */
export default function RankingMoment({ snapshot, value, onChange, language }: MomentRendererProps) {
  const maxRank = snapshot.maxRank ?? snapshot.options.length;

  const tap = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
    } else if (value.length < maxRank) {
      onChange([...value, id]);
    }
  };

  return (
    <div className="space-y-3">
      {snapshot.hint && (
        <p className="text-xs text-muted font-light pl-1">{localizedText(snapshot.hint, language)}</p>
      )}
      <div className="grid grid-cols-1 gap-3">
        {snapshot.options.map((opt) => {
          const rank = value.indexOf(opt.id);
          const isRanked = rank !== -1;
          const atLimit = !isRanked && value.length >= maxRank;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => tap(opt.id)}
              className={clsx(
                'p-4 rounded-2xl border transition-all text-left flex items-center gap-3',
                isRanked
                  ? 'border-primary bg-primary text-white'
                  : atLimit
                    ? 'border-gray-100 text-gray-300 cursor-default'
                    : 'border-gray-200 hover:border-primary hover:bg-gray-50 text-primary',
              )}
            >
              <span
                className={clsx(
                  'shrink-0 w-6 h-6 rounded-full border flex items-center justify-center text-xs',
                  isRanked ? 'border-white/60 text-white' : 'border-gray-200 text-gray-300',
                )}
              >
                {isRanked ? rank + 1 : ''}
              </span>
              <span className="text-sm font-light leading-relaxed">{localizedText(opt.text, language)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
