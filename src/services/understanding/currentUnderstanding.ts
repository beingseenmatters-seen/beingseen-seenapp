/**
 * Current Understanding — the model the Understanding Composer produces.
 *
 * This is NOT a report, profile, or database view. It is the structured basis
 * for "a letter from Seen to the user" (查看我的理解). The facets below are the
 * internal composition unit; the user only ever meets the woven letter
 * (see understandingLetter.ts). Nothing here is surfaced verbatim.
 *
 * Founder principles encoded:
 *  - Evidence is the SSOT; this is a derived, deterministic, rebuildable cache.
 *  - Movement is the shared cross-channel ontology, NOT the whole ontology:
 *    the Thinking facet uses Reflect's own cognitive slugs (no Movement, no LLM).
 *  - Matching is never consumed or produced here.
 */

import type { MovementId } from '../../data/understanding/movements';

export const CURRENT_UNDERSTANDING_VERSION = 'cu_v1';

/** The three facets. Internal grouping only — never shown as sections. */
export type FacetId = 'behaviour' | 'thinking' | 'meaning';

/** Warm, human confidence bands — surfaced only as language, never as numbers. */
export type UnderstandingConfidence = 'forming' | 'emerging' | 'clear';

export type EvidenceChannel = 'moment' | 'reflect';

export interface UnderstandingItem {
  facet: FacetId;
  /** movementId (behaviour/meaning) or a Reflect cognitive slug (thinking). */
  key: string;
  representation: 'movement' | 'reflect_signal';
  /** −1..1 for movement items; +1 for the presence of a Reflect cognitive signal. */
  direction: number;
  confidence: UnderstandingConfidence;
  /** 0..1 internal ranking weight — NEVER surfaced. */
  weight: number;
  /** Which channel(s) support this — reinforcement, not duplication. */
  channels: EvidenceChannel[];
  lastReinforcedAt: number;
}

export interface Facet {
  facetId: FacetId;
  /** Ranked by weight desc, then recency. */
  items: UnderstandingItem[];
}

export interface CurrentUnderstanding {
  version: string;
  generatedAt: number;
  /** Reproducibility stamp — CU is a pure function of this evidence. */
  evidenceRef: { reflectInsightCount: number; momentMovementCount: number };
  facets: Record<FacetId, Facet>;
}

// ---------------------------------------------------------------------------
// Routing — every signal goes to EXACTLY ONE facet (prevents cross-facet
// duplication; contradiction/reinforcement is resolved WITHIN a facet).
// This partition is a founder-reviewable table, not a redesign of any taxonomy.
// ---------------------------------------------------------------------------

/** The 16 Movements partitioned into the two Movement-based facets. */
export const MOVEMENT_FACET: Record<MovementId, Extract<FacetId, 'behaviour' | 'meaning'>> = {
  // Behaviour / Relationships
  relationship_preservation: 'behaviour',
  boundary_preservation: 'behaviour',
  direct_expression: 'behaviour',
  delayed_expression: 'behaviour',
  emotional_attunement: 'behaviour',
  perspective_taking: 'behaviour',
  trust_openness: 'behaviour',
  conflict_engagement: 'behaviour',
  responsibility_orientation: 'behaviour',
  structure_seeking: 'behaviour',
  // Meaning / Values / Orientation
  meaning_orientation: 'meaning',
  autonomy_orientation: 'meaning',
  stability_orientation: 'meaning',
  change_orientation: 'meaning',
  openness_to_revision: 'meaning',
  uncertainty_tolerance: 'meaning',
};

/**
 * Which Movements are "relational" (emotionally central). Their letter fragments
 * are founder-authored (left blank in understandingLanguage.ts); the structural
 * behaviour movements are drafted. Used only to organize authorship, not logic.
 */
export const RELATIONAL_MOVEMENTS: ReadonlySet<MovementId> = new Set<MovementId>([
  'relationship_preservation',
  'trust_openness',
  'emotional_attunement',
  'conflict_engagement',
  'perspective_taking',
]);

/**
 * Reflect `worldview` slugs that are ANALYTICAL sense-making → Thinking facet.
 * The remaining worldview slugs are meaning/behaviour beliefs and are routed via
 * reflectSlugMovementMap into the Movement facets instead.
 */
export const ANALYTICAL_WORLDVIEW_SLUGS: ReadonlySet<string> = new Set([
  'systems_follow_incentives',
  'power_and_wealth_shape_collective_order',
  'aggregation_tends_toward_dispersion',
  'human_hearts_resist_measurement',
  'relationships_live_inside_larger_systems',
]);

function emptyFacet(facetId: FacetId): Facet {
  return { facetId, items: [] };
}

export function emptyCurrentUnderstanding(): CurrentUnderstanding {
  return {
    version: CURRENT_UNDERSTANDING_VERSION,
    generatedAt: 0,
    evidenceRef: { reflectInsightCount: 0, momentMovementCount: 0 },
    facets: {
      behaviour: emptyFacet('behaviour'),
      thinking: emptyFacet('thinking'),
      meaning: emptyFacet('meaning'),
    },
  };
}
