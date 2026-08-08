/**
 * Reflect slug → Movement map (Current Understanding, Behaviour + Meaning facets).
 *
 * The deterministic bridge that lets the relational/meaning slice of Reflect
 * contribute to the same Movement ontology Moments use — WITHOUT an LLM and
 * WITHOUT touching emergentTraits/Matching. Mirrors the shape of
 * data/understanding/signalMovementMap.ts (Moments), but over Reflect's
 * controlled slugs (userSummary.ts inferers).
 *
 * FOUNDER-REVIEWABLE. Every row's direction/strength is a judgment call; only
 * slugs with a genuine, unambiguous Movement counterpart are mapped. Cognitive/
 * analytical slugs are intentionally absent — they belong to the Thinking facet
 * (Reflect signals, not Movements). Ambiguous-direction slugs are intentionally
 * omitted rather than guessed.
 */

import type { MovementId } from './movements';

export const REFLECT_SLUG_MOVEMENT_MAP_VERSION = 'reflect_slug_movement_map_v1';

export interface ReflectSlugMovementMapping {
  /** Slug from a SessionInsight categorical array. */
  slug: string;
  /** Which array it may appear in (documentation + safety). */
  from: 'relationshipPhilosophy' | 'worldview';
  movementId: MovementId;
  /** +1 = slug expresses the movement's positive direction. */
  directionMultiplier: 1 | -1;
  /** 0..1 base strength for one occurrence (recurrence scales it up). */
  strengthMultiplier: number;
  rationale: string;
}

export const REFLECT_SLUG_MOVEMENT_MAP: ReflectSlugMovementMapping[] = [
  // --- relationshipPhilosophy → Behaviour movements ---
  { slug: 'reciprocity_keeps_bonds_alive', from: 'relationshipPhilosophy', movementId: 'relationship_preservation', directionMultiplier: 1, strengthMultiplier: 0.9,
    rationale: 'Two-way responsiveness keeping a bond alive is the core of investing to preserve a relationship.' },
  { slug: 'loyalty_is_revealed_over_time', from: 'relationshipPhilosophy', movementId: 'relationship_preservation', directionMultiplier: 1, strengthMultiplier: 0.6,
    rationale: 'Valuing loyalty shown over time is a sustained commitment to bonds.' },
  { slug: 'safety_precedes_closeness', from: 'relationshipPhilosophy', movementId: 'boundary_preservation', directionMultiplier: 1, strengthMultiplier: 0.7,
    rationale: 'Needing safety/stability before closeness protects one\'s own limits and pace.' },
  { slug: 'authenticity_requires_lowered_defenses', from: 'relationshipPhilosophy', movementId: 'trust_openness', directionMultiplier: 1, strengthMultiplier: 0.8,
    rationale: 'Opening up by lowering defenses is the positive direction of trust-openness.' },
  { slug: 'slow_bonding_reveals_truth', from: 'relationshipPhilosophy', movementId: 'delayed_expression', directionMultiplier: 1, strengthMultiplier: 0.6,
    rationale: 'Preferring to build slowly is timing/shaping connection before releasing it.' },
  { slug: 'relationships_change_with_context', from: 'relationshipPhilosophy', movementId: 'perspective_taking', directionMultiplier: 1, strengthMultiplier: 0.6,
    rationale: 'Reading relationships through changing context is situation-aware perspective-taking.' },
  { slug: 'distance_can_clarify_connection', from: 'relationshipPhilosophy', movementId: 'boundary_preservation', directionMultiplier: 1, strengthMultiplier: 0.6,
    rationale: 'Using distance to clarify a bond keeps protective space around it.' },

  // --- worldview (meaning/behaviour beliefs) → Meaning / Behaviour movements ---
  { slug: 'meaning_must_be_built_not_received', from: 'worldview', movementId: 'meaning_orientation', directionMultiplier: 1, strengthMultiplier: 0.9,
    rationale: 'Actively building meaning rather than receiving it is the canonical meaning-orientation.' },
  { slug: 'order_is_temporary', from: 'worldview', movementId: 'uncertainty_tolerance', directionMultiplier: 1, strengthMultiplier: 0.7,
    rationale: 'Accepting order as impermanent is comfort with unresolved, shifting states.' },
  { slug: 'authenticity_emerges_when_defenses_drop', from: 'worldview', movementId: 'trust_openness', directionMultiplier: 1, strengthMultiplier: 0.6,
    rationale: 'Belief that realness appears as defenses drop leans toward openness in trust.' },

  // Intentionally NOT mapped (no unambiguous Movement counterpart or unclear
  // direction): trust_cannot_be_forced, alignment_matters_more_than_intensity,
  // belonging_is_sought_under_uncertainty, and all analytical worldview slugs
  // (systems_follow_incentives, power_and_wealth_shape_collective_order, …) —
  // the analytical ones belong to the Thinking facet as Reflect signals.
];

export function reflectMappingsForSlug(slug: string): ReflectSlugMovementMapping[] {
  return REFLECT_SLUG_MOVEMENT_MAP.filter((m) => m.slug === slug);
}
