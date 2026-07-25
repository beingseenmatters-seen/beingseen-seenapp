import clsx from 'clsx';
import type { MomentRendererProps } from './MomentRenderer';
import { localizedText } from '../../services/moments/config';

/** Generic single-choice renderer — works for any single_choice Moment config. */
export default function SingleChoiceMoment({ snapshot, value, onChange, language }: MomentRendererProps) {
  const selected = value[0];
  return (
    <div className="grid grid-cols-1 gap-3">
      {snapshot.options.map((opt) => (
        <button
          key={opt.id}
          type="button"
          onClick={() => onChange([opt.id])}
          className={clsx(
            'p-4 rounded-2xl border transition-all text-left',
            selected === opt.id
              ? 'border-primary bg-primary text-white'
              : 'border-gray-200 hover:border-primary hover:bg-gray-50 text-primary',
          )}
        >
          <span className="text-sm font-light leading-relaxed">{localizedText(opt.text, language)}</span>
        </button>
      ))}
    </div>
  );
}
