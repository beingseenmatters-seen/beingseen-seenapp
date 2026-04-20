/**
 * Slider-only cards shared by onboarding Step 2 and settings/Understanding.tsx.
 * Same ids and 0–100 values stored under `soulProfile.understanding`.
 */
export const UNDERSTANDING_SLIDER_CARD_DEFS = [
  {
    id: 'value_orientation',
    titleKey: 'settings.understanding.cards.value_orientation.title',
    labelsKey: 'settings.understanding.cards.value_orientation.labels',
    descKey: 'settings.understanding.cards.value_orientation.desc',
  },
  {
    id: 'self_vs_relationship',
    titleKey: 'settings.understanding.cards.self_vs_relationship.title',
    labelsKey: 'settings.understanding.cards.self_vs_relationship.labels',
    descKey: 'settings.understanding.cards.self_vs_relationship.desc',
  },
  {
    id: 'conflict_handling',
    titleKey: 'settings.understanding.cards.conflict_handling.title',
    labelsKey: 'settings.understanding.cards.conflict_handling.labels',
    descKey: 'settings.understanding.cards.conflict_handling.desc',
  },
  {
    id: 'life_pace',
    titleKey: 'settings.understanding.cards.life_pace.title',
    labelsKey: 'settings.understanding.cards.life_pace.labels',
    descKey: 'settings.understanding.cards.life_pace.desc',
  },
  {
    id: 'connection_depth',
    titleKey: 'settings.understanding.cards.connection_depth.title',
    labelsKey: 'settings.understanding.cards.connection_depth.labels',
    descKey: 'settings.understanding.cards.connection_depth.desc',
  },
  {
    id: 'money_view',
    titleKey: 'settings.understanding.cards.money_view.title',
    labelsKey: 'settings.understanding.cards.money_view.labels',
    descKey: 'settings.understanding.cards.money_view.desc',
  },
  {
    id: 'expression_style',
    titleKey: 'settings.understanding.cards.expression_style.title',
    labelsKey: 'settings.understanding.cards.expression_style.labels',
    descKey: 'settings.understanding.cards.expression_style.desc',
  },
] as const;

export type UnderstandingSliderId = (typeof UNDERSTANDING_SLIDER_CARD_DEFS)[number]['id'];
