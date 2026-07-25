import clsx from 'clsx';
import type { MomentRendererProps } from './MomentRenderer';
import { localizedText } from '../../services/moments/config';

/**
 * Generic multiple-choice renderer — enforces the Moment's min/max selection
 * constraints from config. Works for any multiple_choice Moment.
 */
export default function MultipleChoiceMoment({ snapshot, value, onChange, language }: MomentRendererProps) {
  const max = snapshot.maxSelection ?? snapshot.options.length;

  const toggle = (id: string) => {
    if (value.includes(id)) {
      onChange(value.filter((v) => v !== id));
    } else if (value.length < max) {
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
          const isSelected = value.includes(opt.id);
          const atLimit = !isSelected && value.length >= max;
          return (
            <button
              key={opt.id}
              type="button"
              onClick={() => toggle(opt.id)}
              className={clsx(
                'p-4 rounded-2xl border transition-all text-left',
                isSelected
                  ? 'border-primary bg-primary text-white'
                  : atLimit
                    ? 'border-gray-100 text-gray-300 cursor-default'
                    : 'border-gray-200 hover:border-primary hover:bg-gray-50 text-primary',
              )}
            >
              <span className="text-sm font-light leading-relaxed">{localizedText(opt.text, language)}</span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
