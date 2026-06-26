/**
 * Emergent Trait Taxonomy V1.1 (FROZEN) — types for T-202 inference engine.
 */

export type TraitId =
  | 'layered_inquiry'
  | 'structural_framing'
  | 'pattern_noticer'
  | 'dialectical_mind'
  | 'inquiry_led'
  | 'thread_spreading'
  | 'associative_drift'
  | 'purpose_returning'
  | 'values_returning'
  | 'anchor_returning'
  | 'change_framing'
  | 'narrative_revision'
  | 'strain_continuity'
  | 'reciprocity_emphasis'
  | 'long_horizon'
  | 'trust_careful'
  | 'boundary_protective'
  | 'structure_assembly'
  | 'expressive_channel'
  | 'idea_combiner'
  | 'doing_restoration'
  | 'closure_movement'
  | 'context_tracking'
  | 'unresolved_tolerance';

export type TraitFamily =
  | 'Thinking'
  | 'Curiosity'
  | 'Meaning'
  | 'Growth'
  | 'Relationships'
  | 'Creation'
  | 'Action'
  | 'Adaptability';

export type InferenceLevel = 'low' | 'medium' | 'high';

export type TraitStatus = 'candidate' | 'emergent' | 'established' | 'dormant';

export type TraitTrajectory = 'rising' | 'stable';

export type TraitSignalSource =
  | 'thinkingStyle'
  | 'coreQuestions'
  | 'worldview'
  | 'relationshipPhilosophy'
  | 'conversationStyle'
  | 'thinkingPath'
  | 'aboutMe.valueTags'
  | 'aboutMe.aspirationThemes'
  | 'aboutMe.selfNarrativeTags'
  | 'aboutMe.copingStyleTags'
  | 'aboutMe.resonanceTags'
  | 'aboutMe.emotionalNeeds';

export interface TraitSignalRule {
  source: TraitSignalSource;
  /** Slug match; use '*' with coreQuestions to mean any non-empty entry */
  signals: string[];
  /** AboutMe only — weak prior; never counts toward session hit floor */
  boostOnly?: boolean;
}

export interface TraitCompositeRule {
  thinkingPathMinLength?: number;
  /** Require at least N entries in coreQuestions for session hit */
  coreQuestionsMinCount?: number;
}

export interface TraitDefinition {
  id: TraitId;
  displayName: string;
  family: TraitFamily;
  inferenceLevel: InferenceLevel;
  matchingEligible: boolean;
  rules: TraitSignalRule[];
  composite?: TraitCompositeRule;
}

export interface TraitEvidenceHit {
  source: TraitSignalSource;
  signal: string;
  insightId: string;
  approvedAt: number;
}

export interface SessionPattern {
  insightId: string;
  approvedAt: number;
  thinkingStyle: string[];
  coreQuestions: string[];
  worldview: string[];
  relationshipPhilosophy: string[];
  conversationStyle: string[];
  thinkingPath: string[];
  thinkingPathLength: number;
  aboutMe?: {
    valueTags: string[];
    aspirationThemes: string[];
    selfNarrativeTags: string[];
    copingStyleTags: string[];
    resonanceTags: string[];
    emotionalNeeds: string[];
  };
}

export interface SessionTraitHit {
  traitId: TraitId;
  insightId: string;
  approvedAt: number;
  observedHitCount: number;
  observedStrength: number;
  boostMatched: boolean;
  evidence: TraitEvidenceHit[];
}

export interface EmergentTrait {
  traitId: TraitId;
  status: TraitStatus;
  confidence: number;
  /** Distinct approved reflection sessions with observed hits */
  distinctSessions: number;
  trajectory: TraitTrajectory;
  inferenceLevel: InferenceLevel;
  matchingEligible: boolean;
  firstSeenAt: number;
  lastReinforcedAt: number;
  sourceInsightIds: string[];
  evidence: TraitEvidenceHit[];
  taxonomyVersion: '1.1';
}

export interface TraitInferenceMeta {
  taxonomyVersion: '1.1';
  insightCount: number;
  updatedAt: number;
}
