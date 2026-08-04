/**
 * Unified Evidence Layer V1 — canonical evidence types (Phase 3A foundation).
 *
 * One `UnderstandingEvidence` item is one bounded observation tied to a
 * source, a context, a time, a Movement, a direction/strength/confidence and
 * a user-confirmation state.
 *
 * Founder decisions encoded here:
 *  - Reflect evidence becomes active only after the person explicitly
 *    confirms the extracted sentence (符合我，记住它).
 *  - Moments evidence activates on session completion/retention as one source
 *    event; deleting the sketch withdraws it.
 *  - Evidence Layer V1 never affects Matching or Discover.
 *
 * Persistence-agnostic: nothing in this module (or the understanding
 * services) writes to Firestore, SeenUser, soulProfile, emergentTraits or
 * matchReady. Legacy pipelines (userSummary.saveApprovedSummary,
 * emergentTraitInference, lambda/resonance.mjs) remain the production path
 * until the Evidence Layer is validated and explicitly migrated in a later
 * phase.
 */

import type { MovementId } from '../data/understanding/movements';

export const EVIDENCE_SCHEMA_VERSION = 1;

export type EvidenceSource = 'reflect' | 'moment';

export const EVIDENCE_SOURCES: EvidenceSource[] = ['reflect', 'moment'];

export type EvidenceTemporalScope =
  | 'current_state'
  | 'situational'
  | 'repeated_pattern';

export const EVIDENCE_TEMPORAL_SCOPES: EvidenceTemporalScope[] = [
  'current_state',
  'situational',
  'repeated_pattern',
];

export type EvidenceLifecycleStatus =
  | 'candidate'
  | 'active'
  | 'withdrawn'
  | 'expired';

export const EVIDENCE_LIFECYCLE_STATUSES: EvidenceLifecycleStatus[] = [
  'candidate',
  'active',
  'withdrawn',
  'expired',
];

export type EvidencePrivacyLevel = 'private' | 'profile_eligible';

export const EVIDENCE_PRIVACY_LEVELS: EvidencePrivacyLevel[] = [
  'private',
  'profile_eligible',
];

// ---------------------------------------------------------------------------
// Structured context model (Section E)
// ---------------------------------------------------------------------------

export type EvidenceContextDomain =
  | 'relationship'
  | 'work'
  | 'family'
  | 'friendship'
  | 'self'
  | 'decision'
  | 'conflict'
  | 'daily_life'
  | 'unknown';

export const EVIDENCE_CONTEXT_DOMAINS: EvidenceContextDomain[] = [
  'relationship',
  'work',
  'family',
  'friendship',
  'self',
  'decision',
  'conflict',
  'daily_life',
  'unknown',
];

export type EvidenceRelationshipType =
  | 'partner'
  | 'friend'
  | 'family'
  | 'colleague'
  | 'stranger'
  | 'unknown';

export const EVIDENCE_RELATIONSHIP_TYPES: EvidenceRelationshipType[] = [
  'partner',
  'friend',
  'family',
  'colleague',
  'stranger',
  'unknown',
];

export type EvidenceStakes = 'low' | 'medium' | 'high' | 'unknown';

export const EVIDENCE_STAKES: EvidenceStakes[] = ['low', 'medium', 'high', 'unknown'];

export type EvidenceAudienceScope = 'private' | 'public' | 'unknown';

export const EVIDENCE_AUDIENCE_SCOPES: EvidenceAudienceScope[] = [
  'private',
  'public',
  'unknown',
];

/**
 * Lightweight structured context. Never stores the identity or name of
 * another person, and never carries protected or sensitive identity
 * attributes (validated in validateEvidence.ts).
 */
export interface EvidenceContext {
  domain: EvidenceContextDomain;
  relationshipType?: EvidenceRelationshipType;
  stakes?: EvidenceStakes;
  audienceScope?: EvidenceAudienceScope;
  tags?: string[];
}

// ---------------------------------------------------------------------------
// Canonical evidence item (Section D)
// ---------------------------------------------------------------------------

/** Bounds for the numeric fields. Never rendered in user-facing UI. */
export const EVIDENCE_BOUNDS = {
  direction: { min: -1, max: 1 },
  strength: { min: 0, max: 1 },
  confidence: { min: 0, max: 1 },
} as const;

/**
 * Structured source versioning (Phase 3B). Every evidence item records which
 * versions of the producing machinery observed it, so later re-evaluation and
 * audits stay possible after prompts, mappings or the taxonomy evolve.
 */
export interface EvidenceSourceVersion {
  /** reflect: prompt/session content version · moment: Moment content / sketch engine version. */
  contentVersion?: string | number;
  /** reflect only: extraction schema/prompt version. */
  extractionVersion?: string;
  /** moment only: signal-to-movement mapping version. */
  mappingVersion?: string;
  /** Movement Taxonomy version — always required. */
  taxonomyVersion: string;
}

export interface UnderstandingEvidence {
  id: string;
  schemaVersion: number;

  userId: string;

  source: EvidenceSource;
  /**
   * Stable reference to the source event:
   *  - reflect: the extraction/session id the confirmed sentence came from
   *  - moment: the Moments session id
   * One source event shares one sourceRef across all its evidence items.
   */
  sourceRef: string;
  /** Required structured version metadata for both sources. */
  sourceVersion: EvidenceSourceVersion;

  movementId: MovementId;

  /** −1..+1 relative to the movement's positive direction. */
  direction: number;
  /** 0..1 — how strongly this single observation points in the movement direction. Internal only. */
  strength: number;
  /**
   * Terminology (Phase 3B): evidence is an OBSERVATION. These numbers never
   * mean confidence that the person "is this kind of person" — they describe
   * how reliable the producing step is. Exactly one is set, matching the
   * source; use `observationConfidence()` for source-agnostic reads.
   */
  /** reflect only, 0..1 — how reliable the extraction step is. Internal only. */
  extractionConfidence?: number;
  /** moment only, 0..1 — how reliable the signal emission + mapping is. Internal only. */
  mappingConfidence?: number;

  context: EvidenceContext;

  temporalScope: EvidenceTemporalScope;

  /** ISO 8601 timestamps. */
  observedAt: string;
  createdAt: string;
  updatedAt: string;

  /**
   * reflect: true only after 符合我，记住它.
   * moment: represents completion/retention of the whole session, not
   * per-option approval.
   */
  userConfirmed: boolean;

  lifecycleStatus: EvidenceLifecycleStatus;
  privacyLevel: EvidencePrivacyLevel;

  /**
   * Optional short bounded excerpt or paraphrased observation. Never a raw
   * transcript, never another person's name (enforced by privacy boundaries).
   */
  evidenceText?: string;

  metadata?: Record<string, unknown>;
}

/**
 * Source-agnostic read of the observation-reliability number
 * (extractionConfidence for reflect, mappingConfidence for moment).
 */
export function observationConfidence(evidence: UnderstandingEvidence): number {
  return evidence.source === 'reflect'
    ? evidence.extractionConfidence ?? 0
    : evidence.mappingConfidence ?? 0;
}

// ---------------------------------------------------------------------------
// Relationship classification output (Section J)
// ---------------------------------------------------------------------------

export type EvidenceRelationshipKind =
  | 'confirmation'
  | 'supplementation'
  | 'contextual_tension'
  | 'unrelated'
  | 'insufficient';

export interface EvidenceRelationship {
  type: EvidenceRelationshipKind;
  movementIds: MovementId[];
  evidenceIds: string[];
  confidence: number;
  /** Internal structured explanation — not user-facing prose. */
  contextExplanation?: string;
  rationaleCodes: string[];
}

// ---------------------------------------------------------------------------
// Pattern candidate model (Section K)
// ---------------------------------------------------------------------------

export type PatternCandidateStatus =
  | 'insufficient'
  | 'candidate'
  | 'eligible_for_understanding';

export interface PatternCandidate {
  id: string;
  movementId: MovementId;

  evidenceIds: string[];
  sourceTypes: EvidenceSource[];
  sourceEventCount: number;
  contextCount: number;

  relationship: 'confirmation' | 'supplementation' | 'contextual_tension';

  /** Internal values, never user scores. */
  supportScore: number;
  stabilityScore: number;

  status: PatternCandidateStatus;
}
