import type { MomentSnapshot } from '../../types/moments';
import SingleChoiceMoment from './SingleChoiceMoment';
import MultipleChoiceMoment from './MultipleChoiceMoment';
import RankingMoment from './RankingMoment';

export interface MomentRendererProps {
  snapshot: MomentSnapshot;
  /** Current selection (ordered for ranking). */
  value: string[];
  onChange: (selectedOptionIds: string[]) => void;
  language: 'zh' | 'en';
}

/**
 * Dispatches on `interactionType` only — never on Moment ID. Adding a new
 * Moment of any supported type requires zero changes here.
 */
export default function MomentRenderer(props: MomentRendererProps) {
  switch (props.snapshot.interactionType) {
    case 'single_choice':
      return <SingleChoiceMoment {...props} />;
    case 'multiple_choice':
      return <MultipleChoiceMoment {...props} />;
    case 'ranking':
      return <RankingMoment {...props} />;
    default:
      return null;
  }
}
