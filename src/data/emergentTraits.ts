/**
 * Emergent Trait Taxonomy V1.1 — FROZEN closed set (26 traits).
 * Source: Seen Founding Team/Emergent_Trait_Taxonomy_V1.1.md
 */

import type {
  InferenceLevel,
  TraitDefinition,
  TraitId,
} from '../types/emergentTraits';

export const TAXONOMY_VERSION = '1.1' as const;

export const RECENT_OBSERVATION_WINDOW = 5;

export const ABOUT_ME_PRIOR_MAX = 0.03;

const OBS = { boostOnly: false as const };
const BOOST = { boostOnly: true as const };

export const TRAIT_DEFINITIONS: TraitDefinition[] = [
  {
    id: 'layered_inquiry',
    displayName: 'Layered Inquiry',
    family: 'Thinking',
    inferenceLevel: 'medium',
    matchingEligible: true,
    rules: [
      { source: 'thinkingStyle', signals: ['philosophical_reasoning', 'abstract_analysis', 'dialectical_reasoning'], ...OBS },
      { source: 'conversationStyle', signals: ['chain_reasoning', 'layered_abstraction', 'concept_driven_dialogue', 'reflective_language'], ...OBS },
    ],
  },
  {
    id: 'structural_framing',
    displayName: 'Structural Framing',
    family: 'Thinking',
    inferenceLevel: 'medium',
    matchingEligible: true,
    rules: [
      { source: 'thinkingStyle', signals: ['systems_thinking', 'macro_micro_linking', 'cause_effect_modeling'], ...OBS },
      { source: 'worldview', signals: ['systems_follow_incentives', 'relationships_live_inside_larger_systems', 'power_and_wealth_shape_collective_order'], ...OBS },
      { source: 'thinkingPath', signals: ['systems', 'power', 'wealth', 'entropy', 'human_aggregation'], ...OBS },
      { source: 'coreQuestions', signals: ['what_drives_human_aggregation', 'how_do_power_and_wealth_shape_order'], ...OBS },
    ],
  },
  {
    id: 'pattern_noticer',
    displayName: 'Pattern Noticing',
    family: 'Thinking',
    inferenceLevel: 'low',
    matchingEligible: true,
    rules: [
      { source: 'thinkingStyle', signals: ['pattern_mapping'], ...OBS },
      { source: 'conversationStyle', signals: ['layered_abstraction', 'comparative_reasoning'], ...OBS },
    ],
  },
  {
    id: 'dialectical_mind',
    displayName: 'Holds Tension',
    family: 'Thinking',
    inferenceLevel: 'high',
    matchingEligible: false,
    rules: [
      { source: 'thinkingStyle', signals: ['dialectical_reasoning'], ...OBS },
      { source: 'worldview', signals: ['order_is_temporary', 'human_hearts_resist_measurement'], ...OBS },
      { source: 'aboutMe.selfNarrativeTags', signals: ['complex'], ...BOOST },
    ],
  },
  {
    id: 'inquiry_led',
    displayName: 'Inquiry-Led Entry',
    family: 'Curiosity',
    inferenceLevel: 'low',
    matchingEligible: true,
    composite: { coreQuestionsMinCount: 1 },
    rules: [
      { source: 'coreQuestions', signals: ['*'], ...OBS },
      { source: 'conversationStyle', signals: ['exploratory_dialogue'], ...OBS },
      { source: 'thinkingStyle', signals: ['existential_inquiry'], ...OBS },
    ],
  },
  {
    id: 'thread_spreading',
    displayName: 'Thread Spreading',
    family: 'Curiosity',
    inferenceLevel: 'medium',
    matchingEligible: true,
    composite: { thinkingPathMinLength: 4 },
    rules: [
      { source: 'conversationStyle', signals: ['exploratory_dialogue'], ...OBS },
      { source: 'thinkingStyle', signals: ['pattern_mapping'], ...OBS },
      { source: 'aboutMe.aspirationThemes', signals: ['freedom'], ...BOOST },
    ],
  },
  {
    id: 'associative_drift',
    displayName: 'Associative Drift',
    family: 'Curiosity',
    inferenceLevel: 'medium',
    matchingEligible: false,
    composite: { thinkingPathMinLength: 3 },
    rules: [
      { source: 'conversationStyle', signals: ['concept_driven_dialogue', 'metaphor_usage'], ...OBS },
      { source: 'aboutMe.selfNarrativeTags', signals: ['reflective'], ...BOOST },
    ],
  },
  {
    id: 'purpose_returning',
    displayName: 'Purpose Returning',
    family: 'Meaning',
    inferenceLevel: 'medium',
    matchingEligible: true,
    rules: [
      { source: 'thinkingStyle', signals: ['existential_inquiry', 'philosophical_reasoning'], ...OBS },
      { source: 'worldview', signals: ['meaning_must_be_built_not_received'], ...OBS },
      { source: 'coreQuestions', signals: ['what_is_stable_in_human_nature'], ...OBS },
      { source: 'aboutMe.resonanceTags', signals: ['meaning', 'awakening'], ...BOOST },
    ],
  },
  {
    id: 'values_returning',
    displayName: 'Values Returning',
    family: 'Meaning',
    inferenceLevel: 'low',
    matchingEligible: true,
    rules: [
      { source: 'worldview', signals: ['meaning_must_be_built_not_received'], ...OBS },
      { source: 'thinkingPath', signals: ['authenticity', 'belonging'], ...OBS },
      { source: 'aboutMe.valueTags', signals: ['responsibility', 'kindness', 'persistence', 'growth'], ...BOOST },
    ],
  },
  {
    id: 'anchor_returning',
    displayName: 'Anchor Returning',
    family: 'Meaning',
    inferenceLevel: 'medium',
    matchingEligible: false,
    rules: [
      { source: 'worldview', signals: ['belonging_is_sought_under_uncertainty', 'order_is_temporary'], ...OBS },
      { source: 'coreQuestions', signals: ['what_is_stable_in_human_nature'], ...OBS },
      { source: 'thinkingPath', signals: ['order', 'belonging'], ...OBS },
      { source: 'aboutMe.aspirationThemes', signals: ['stability'], ...BOOST },
      { source: 'aboutMe.selfNarrativeTags', signals: ['mostly_consistent'], ...BOOST },
    ],
  },
  {
    id: 'change_framing',
    displayName: 'Change Framing',
    family: 'Growth',
    inferenceLevel: 'low',
    matchingEligible: true,
    rules: [
      { source: 'conversationStyle', signals: ['reflective_language'], ...OBS },
      { source: 'worldview', signals: ['order_is_temporary'], ...OBS },
      { source: 'aboutMe.valueTags', signals: ['growth'], ...BOOST },
      { source: 'aboutMe.selfNarrativeTags', signals: ['growing', 'still_searching', 'changed_a_lot', 'closer_to_true_self'], ...BOOST },
    ],
  },
  {
    id: 'narrative_revision',
    displayName: 'Narrative Revision',
    family: 'Growth',
    inferenceLevel: 'medium',
    matchingEligible: false,
    rules: [
      { source: 'conversationStyle', signals: ['reflective_language'], ...OBS },
      { source: 'aboutMe.selfNarrativeTags', signals: ['changed_a_lot', 'reflective', 'closer_to_true_self'], ...BOOST },
    ],
  },
  {
    id: 'strain_continuity',
    displayName: 'Strain Continuity',
    family: 'Growth',
    inferenceLevel: 'low',
    matchingEligible: false,
    rules: [
      { source: 'conversationStyle', signals: ['reflective_language'], ...OBS },
      { source: 'aboutMe.valueTags', signals: ['persistence'], ...BOOST },
      { source: 'aboutMe.selfNarrativeTags', signals: ['tired', 'growing', 'reflective'], ...BOOST },
      { source: 'aboutMe.resonanceTags', signals: ['courage'], ...BOOST },
    ],
  },
  {
    id: 'reciprocity_emphasis',
    displayName: 'Reciprocity Emphasis',
    family: 'Relationships',
    inferenceLevel: 'medium',
    matchingEligible: true,
    rules: [
      { source: 'relationshipPhilosophy', signals: ['reciprocity_keeps_bonds_alive', 'alignment_matters_more_than_intensity'], ...OBS },
      { source: 'thinkingStyle', signals: ['relational_reasoning'], ...OBS },
      { source: 'aboutMe.copingStyleTags', signals: ['connection_recovery'], ...BOOST },
      { source: 'aboutMe.emotionalNeeds', signals: ['being_heard'], ...BOOST },
    ],
  },
  {
    id: 'long_horizon',
    displayName: 'Long Horizon',
    family: 'Relationships',
    inferenceLevel: 'medium',
    matchingEligible: true,
    rules: [
      { source: 'relationshipPhilosophy', signals: ['loyalty_is_revealed_over_time', 'slow_bonding_reveals_truth', 'relationships_change_with_context'], ...OBS },
      { source: 'coreQuestions', signals: ['what_makes_relationships_endure', 'how_do_relationships_change_over_time'], ...OBS },
      { source: 'thinkingPath', signals: ['loyalty', 'trust', 'relationship_impermanence'], ...OBS },
    ],
  },
  {
    id: 'trust_careful',
    displayName: 'Trust-Careful',
    family: 'Relationships',
    inferenceLevel: 'medium',
    matchingEligible: false,
    rules: [
      { source: 'relationshipPhilosophy', signals: ['trust_cannot_be_forced', 'safety_precedes_closeness', 'slow_bonding_reveals_truth'], ...OBS },
      { source: 'worldview', signals: ['human_hearts_resist_measurement'], ...OBS },
      { source: 'thinkingPath', signals: ['defenses', 'measure_of_the_heart'], ...OBS },
      { source: 'aboutMe.selfNarrativeTags', signals: ['guarded'], ...BOOST },
    ],
  },
  {
    id: 'boundary_protective',
    displayName: 'Boundary Protective',
    family: 'Relationships',
    inferenceLevel: 'medium',
    matchingEligible: true,
    rules: [
      { source: 'relationshipPhilosophy', signals: ['safety_precedes_closeness', 'distance_can_clarify_connection', 'authenticity_requires_lowered_defenses'], ...OBS },
      { source: 'thinkingPath', signals: ['defenses'], ...OBS },
      { source: 'aboutMe.selfNarrativeTags', signals: ['guarded'], ...BOOST },
      { source: 'aboutMe.valueTags', signals: ['independence'], ...BOOST },
      { source: 'aboutMe.emotionalNeeds', signals: ['space'], ...BOOST },
      { source: 'aboutMe.copingStyleTags', signals: ['solitude_recovery'], ...BOOST },
    ],
  },
  {
    id: 'structure_assembly',
    displayName: 'Structure Assembly',
    family: 'Creation',
    inferenceLevel: 'medium',
    matchingEligible: true,
    rules: [
      { source: 'thinkingStyle', signals: ['systems_thinking', 'cause_effect_modeling'], ...OBS },
      { source: 'conversationStyle', signals: ['structured_thinking'], ...OBS },
      { source: 'aboutMe.aspirationThemes', signals: ['competence'], ...BOOST },
      { source: 'aboutMe.valueTags', signals: ['achievement', 'independence'], ...BOOST },
    ],
  },
  {
    id: 'expressive_channel',
    displayName: 'Expressive Channel',
    family: 'Creation',
    inferenceLevel: 'low',
    matchingEligible: true,
    rules: [
      { source: 'conversationStyle', signals: ['metaphor_usage'], ...OBS },
      { source: 'aboutMe.aspirationThemes', signals: ['creativity'], ...BOOST },
    ],
  },
  {
    id: 'idea_combiner',
    displayName: 'Idea Combining',
    family: 'Creation',
    inferenceLevel: 'medium',
    matchingEligible: true,
    composite: { thinkingPathMinLength: 3 },
    rules: [
      { source: 'thinkingStyle', signals: ['pattern_mapping', 'abstract_analysis', 'macro_micro_linking'], ...OBS },
      { source: 'conversationStyle', signals: ['chain_reasoning', 'comparative_reasoning'], ...OBS },
    ],
  },
  {
    id: 'doing_restoration',
    displayName: 'Doing Restoration',
    family: 'Action',
    inferenceLevel: 'low',
    matchingEligible: false,
    rules: [
      { source: 'aboutMe.copingStyleTags', signals: ['action_recovery'], ...BOOST },
      { source: 'aboutMe.emotionalNeeds', signals: ['movement'], ...BOOST },
    ],
  },
  {
    id: 'closure_movement',
    displayName: 'Closure Movement',
    family: 'Action',
    inferenceLevel: 'medium',
    matchingEligible: false,
    rules: [
      { source: 'thinkingStyle', signals: ['cause_effect_modeling'], ...OBS },
      { source: 'conversationStyle', signals: ['structured_thinking'], ...OBS },
      { source: 'aboutMe.valueTags', signals: ['achievement', 'independence'], ...BOOST },
      { source: 'aboutMe.copingStyleTags', signals: ['action_recovery'], ...BOOST },
    ],
  },
  {
    id: 'context_tracking',
    displayName: 'Context Tracking',
    family: 'Adaptability',
    inferenceLevel: 'medium',
    matchingEligible: true,
    rules: [
      { source: 'relationshipPhilosophy', signals: ['relationships_change_with_context', 'distance_can_clarify_connection'], ...OBS },
      { source: 'worldview', signals: ['order_is_temporary', 'aggregation_tends_toward_dispersion'], ...OBS },
      { source: 'coreQuestions', signals: ['how_do_relationships_change_over_time'], ...OBS },
    ],
  },
  {
    id: 'unresolved_tolerance',
    displayName: 'Unresolved Tolerance',
    family: 'Adaptability',
    inferenceLevel: 'high',
    matchingEligible: false,
    composite: { coreQuestionsMinCount: 2 },
    rules: [
      { source: 'worldview', signals: ['belonging_is_sought_under_uncertainty', 'order_is_temporary'], ...OBS },
      { source: 'aboutMe.selfNarrativeTags', signals: ['still_searching', 'complex'], ...BOOST },
    ],
  },
];

const TRAIT_BY_ID = new Map<TraitId, TraitDefinition>(
  TRAIT_DEFINITIONS.map(def => [def.id, def]),
);

export interface InferenceThresholds {
  sessionsRequired: number;
  emergentFloor: number;
  establishedFloor: number;
  minObservedHitsPerSession: number;
}

const THRESHOLDS: Record<InferenceLevel, InferenceThresholds> = {
  low: { sessionsRequired: 2, emergentFloor: 0.5, establishedFloor: 0.7, minObservedHitsPerSession: 1 },
  medium: { sessionsRequired: 3, emergentFloor: 0.55, establishedFloor: 0.75, minObservedHitsPerSession: 1 },
  high: { sessionsRequired: 4, emergentFloor: 0.6, establishedFloor: 0.8, minObservedHitsPerSession: 1 },
};

export function getAllTraitIds(): TraitId[] {
  return TRAIT_DEFINITIONS.map(d => d.id);
}

export function getTraitDefinition(id: TraitId): TraitDefinition {
  const def = TRAIT_BY_ID.get(id);
  if (!def) throw new Error(`Unknown trait id: ${id}`);
  return def;
}

export function isMatchingTrait(id: TraitId): boolean {
  return getTraitDefinition(id).matchingEligible;
}

export function getInferenceThreshold(level: InferenceLevel): InferenceThresholds {
  return THRESHOLDS[level];
}

export function getInferenceThresholdForTrait(id: TraitId): InferenceThresholds {
  return getInferenceThreshold(getTraitDefinition(id).inferenceLevel);
}
