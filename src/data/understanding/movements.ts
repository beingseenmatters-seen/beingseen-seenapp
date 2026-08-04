/**
 * Movement Taxonomy V1 — Evidence Layer foundation (Phase 3A).
 *
 * SINGLE ONTOLOGY (Phase 3.1): the Movement Library is the ONE Human
 * Understanding ontology. Moments and Reflect are two independent observation
 * channels — the Behaviour pipeline (Moments → Movement Library → behaviour
 * evidence → behaviour understanding) and the Meaning pipeline (Reflect →
 * Movement Library → meaning evidence → Current Understanding) both classify
 * into the Movements defined here. Reflect never introduces a second theme
 * taxonomy; future matching also speaks this language. The pipelines share
 * the ontology and NOTHING else: no shared evidence, no merged profile, no
 * cross-source promotion.
 *
 * A Movement is a stable, human-readable direction a person can move in.
 * Movements sit ABOVE the low-level Moment Signal layer (src/data/moments/
 * signals.ts) and receive evidence from multiple Signals and multiple
 * sources (Reflect confirmations, completed Moment sessions).
 *
 * Movements are NOT personality types. They describe movement, never fixed
 * identity — no labels equivalent to introvert / avoidant / anxious /
 * attachment type may ever enter this taxonomy.
 *
 * Legacy coexistence: the frozen Emergent Trait Taxonomy V1.1
 * (src/types/emergentTraits.ts) and reflectModel/matchReady pipelines remain
 * untouched and continue to drive matching. The Evidence Layer is additive;
 * it is expected to eventually supersede trait inference for the Living
 * Profile, but no production behavior changes in Phase 3A.
 */

import type { EvidenceSource } from '../../types/evidence';

/** Recorded in every evidence item's sourceVersion.taxonomyVersion. */
export const MOVEMENT_TAXONOMY_VERSION = 'movements_v1';

export type MovementId =
  | 'relationship_preservation'
  | 'boundary_preservation'
  | 'direct_expression'
  | 'delayed_expression'
  | 'emotional_attunement'
  | 'perspective_taking'
  | 'structure_seeking'
  | 'autonomy_orientation'
  | 'responsibility_orientation'
  | 'uncertainty_tolerance'
  | 'openness_to_revision'
  | 'stability_orientation'
  | 'change_orientation'
  | 'trust_openness'
  | 'conflict_engagement'
  | 'meaning_orientation';

/**
 * Recognition material a Movement can carry so both observation channels
 * classify against the same ontology entry (Phase 3.1).
 *
 * PLACEHOLDER STRUCTURE ONLY. All content here will be written manually by
 * the founder later — code must never invent examples, recognition rules or
 * expanded definitions. Moment Signals are intentionally NOT stored here:
 * they stay derived from the Signal → Movement map
 * (src/data/understanding/signalMovementMap.ts, `signalsForMovement`) so the
 * mapping keeps a single source of truth.
 */
export interface MovementRecognition {
  /** TODO(founder): Moment example situations that express this movement. */
  momentExamples: string[];
  /** TODO(founder): Reflect sentences that should classify into this movement. */
  reflectRecognitionExamples: string[];
  /** TODO(founder): near-miss sentences/choices that must NOT classify here. */
  negativeExamples: string[];
  /** TODO(founder): notes on how to recognise (and not over-recognise) it. */
  recognitionNotes: string;
}

/** Empty placeholder until the founder writes recognition material. */
export const EMPTY_MOVEMENT_RECOGNITION: MovementRecognition = {
  momentExamples: [],
  reflectRecognitionExamples: [],
  negativeExamples: [],
  recognitionNotes: '',
};

export interface MovementDefinition {
  id: MovementId;
  /** Localized human-readable title (movement language, not identity). */
  title: { zh: string; en: string };
  /** Internal description — never rendered to the person. */
  description: string;
  /** What the positive direction (+1) of this movement observes. */
  positiveDirection: string;
  /** What the negative direction (−1) observes, where meaningful. */
  negativeDirection?: string;
  /** Which evidence sources may support this movement. */
  allowedSources: EvidenceSource[];
  /** Whether a future Living Profile may surface understandings for it. */
  userFacingEligible: boolean;
  /** Examples of valid supporting evidence (internal documentation). */
  supportingEvidenceExamples: string[];
  /** Examples of overreach this movement must never be stretched into. */
  invalidOverreachExamples: string[];
  /**
   * Founder-authored recognition material (Phase 3.1 placeholder — absent
   * until written manually; read via `getMovementRecognition`).
   */
  recognition?: MovementRecognition;
}

const BOTH_SOURCES: EvidenceSource[] = ['reflect', 'moment'];

export const MOVEMENTS: Record<MovementId, MovementDefinition> = {
  relationship_preservation: {
    id: 'relationship_preservation',
    title: { zh: '守护关系', en: 'Preserving relationships' },
    description: 'Moves to keep an existing bond intact when it is under strain.',
    positiveDirection: 'Invests effort in keeping a relationship alive through difficulty.',
    negativeDirection: 'Lets a strained relationship go rather than working to hold it.',
    allowedSources: BOTH_SOURCES,
    userFacingEligible: true,
    supportingEvidenceExamples: [
      'Confirmed Reflect sentence about wanting to repair a friendship after a fight',
      'Moment choices that favor long-term commitment to people over convenience',
    ],
    invalidOverreachExamples: [
      '"You are a people pleaser" — identity label, forbidden',
      'Inferring the person fears abandonment',
    ],
  },
  boundary_preservation: {
    id: 'boundary_preservation',
    title: { zh: '守住边界', en: 'Preserving boundaries' },
    description: 'Moves to protect personal space, information and commitments.',
    positiveDirection: 'Maintains limits around time, information and obligations.',
    negativeDirection: 'Lets others set the limits; boundaries stay porous.',
    allowedSources: BOTH_SOURCES,
    userFacingEligible: true,
    supportingEvidenceExamples: [
      'Confirmed Reflect sentence about needing to say no more often',
      'Moment choices favoring information control or careful commitments',
    ],
    invalidOverreachExamples: [
      '"You are avoidant" — diagnostic attachment label, forbidden',
      'Concluding the person is cold or distant as a trait',
    ],
  },
  direct_expression: {
    id: 'direct_expression',
    title: { zh: '直接表达', en: 'Expressing directly' },
    description: 'Moves toward saying the thing plainly to the person involved.',
    positiveDirection: 'Says what they feel or need directly to the person concerned.',
    negativeDirection: 'Keeps feelings contained rather than voicing them.',
    allowedSources: BOTH_SOURCES,
    userFacingEligible: true,
    supportingEvidenceExamples: [
      'Confirmed Reflect sentence about finally telling a colleague the truth',
      'Moment choice 当面说出 (EXP-01) in an expression scenario',
    ],
    invalidOverreachExamples: [
      '"You are blunt/aggressive" — identity judgment, forbidden',
      'Treating one direct message as a universal communication style',
    ],
  },
  delayed_expression: {
    id: 'delayed_expression',
    title: { zh: '择时表达', en: 'Choosing the moment to speak' },
    description: 'Moves toward timing and shaping expression before releasing it.',
    positiveDirection: 'Waits for the right moment or medium before expressing.',
    allowedSources: BOTH_SOURCES,
    userFacingEligible: true,
    supportingEvidenceExamples: [
      'Moment choice 看时机说 (EXP-03)',
      'Confirmed Reflect sentence about writing things down before a hard talk',
    ],
    invalidOverreachExamples: [
      '"You are passive-aggressive" — diagnostic label, forbidden',
      'Reading delay as fear or weakness',
    ],
  },
  emotional_attunement: {
    id: 'emotional_attunement',
    title: { zh: '体察情绪', en: 'Attuning to feelings' },
    description: 'Moves toward noticing and responding to emotional states, own or others\'.',
    positiveDirection: 'Notices what someone (or they themselves) is feeling and responds to it.',
    allowedSources: BOTH_SOURCES,
    userFacingEligible: true,
    supportingEvidenceExamples: [
      'Confirmed Reflect sentence about realising a friend was quietly struggling',
      'Moment choices expressing practical or emotional care (CAR-01, CAR-03)',
    ],
    invalidOverreachExamples: [
      '"You are an empath" — identity label, forbidden',
      'Claiming the person absorbs others\' emotions',
    ],
  },
  perspective_taking: {
    id: 'perspective_taking',
    title: { zh: '换位理解', en: 'Taking other perspectives' },
    description: 'Moves toward holding judgment and considering wider explanations.',
    positiveDirection: 'Suspends judgment; explains behavior through situations and systems.',
    negativeDirection: 'Reaches conclusions about others quickly from one frame.',
    allowedSources: BOTH_SOURCES,
    userFacingEligible: true,
    supportingEvidenceExamples: [
      'Moment choice reflecting judgment restraint (TRU-05)',
      'Moment choice attributing outcomes to structures rather than individuals (MEA-12)',
    ],
    invalidOverreachExamples: [
      'Claiming the person is morally superior or "wise"',
      'Diagnosing others the person talks about',
    ],
  },
  structure_seeking: {
    id: 'structure_seeking',
    title: { zh: '寻求结构', en: 'Seeking structure' },
    description: 'Moves toward plans, rules and predictable arrangements.',
    positiveDirection: 'Prefers planning ahead, clear rules and defined expectations.',
    negativeDirection: 'Prefers improvising and keeping arrangements loose.',
    allowedSources: BOTH_SOURCES,
    userFacingEligible: true,
    supportingEvidenceExamples: [
      'Moment choices favoring planning (CHG-08) or rule sensitivity (TRU-04)',
      'Confirmed Reflect sentence about needing a plan before feeling settled',
    ],
    invalidOverreachExamples: [
      '"You are a controller" or obsessive — forbidden',
      'Treating structure preference as anxiety',
    ],
  },
  autonomy_orientation: {
    id: 'autonomy_orientation',
    title: { zh: '自我锚定', en: 'Anchoring in oneself' },
    description: 'Moves toward internal reference points over external comparison.',
    positiveDirection: 'Finds answers and standards internally; comfortable apart from the crowd.',
    negativeDirection: 'Measures self against others; leans on external reference points.',
    allowedSources: BOTH_SOURCES,
    userFacingEligible: true,
    supportingEvidenceExamples: [
      'Moment choices for meaning autonomy (MEA-04) or internal anchoring (MEA-05)',
      'Confirmed Reflect sentence about deciding without needing agreement',
    ],
    invalidOverreachExamples: [
      '"You are a loner/introvert" — identity label, forbidden',
      'Reading autonomy as inability to connect',
    ],
  },
  responsibility_orientation: {
    id: 'responsibility_orientation',
    title: { zh: '责任上肩', en: 'Taking responsibility' },
    description: 'Moves toward owning outcomes and carrying one\'s share.',
    positiveDirection: 'Takes ownership of outcomes; attributes results to effort and agency.',
    negativeDirection: 'Attributes outcomes to luck or external forces.',
    allowedSources: BOTH_SOURCES,
    userFacingEligible: true,
    supportingEvidenceExamples: [
      'Moment choices for responsibility uptake (CAR-04) or agency (CHG-03)',
      'Confirmed Reflect sentence about a mistake being theirs to fix',
    ],
    invalidOverreachExamples: [
      'Claiming the person blames themselves excessively (a clinical read)',
      'Moralising: "you are more responsible than others"',
    ],
  },
  uncertainty_tolerance: {
    id: 'uncertainty_tolerance',
    title: { zh: '与不确定共处', en: 'Living with uncertainty' },
    description: 'Moves toward staying steady when things are unresolved.',
    positiveDirection: 'Accepts open situations without needing immediate resolution.',
    negativeDirection: 'Needs certainty before moving; unresolved states activate strain.',
    allowedSources: BOTH_SOURCES,
    userFacingEligible: true,
    supportingEvidenceExamples: [
      'Moment choices for acceptance (EMW-01) or frustration tolerance (EMW-02)',
      'Confirmed Reflect sentence about sitting with an undecided situation',
    ],
    invalidOverreachExamples: [
      '"You are anxious" — diagnostic label, forbidden',
      'Treating a stressful week as a stable trait',
    ],
  },
  openness_to_revision: {
    id: 'openness_to_revision',
    title: { zh: '愿意改写', en: 'Openness to revision' },
    description: 'Moves toward reframing, letting go, and updating one\'s own story.',
    positiveDirection: 'Reinterprets situations; releases old framings when they stop serving.',
    negativeDirection: 'Holds the first framing firmly even as circumstances change.',
    allowedSources: BOTH_SOURCES,
    userFacingEligible: true,
    supportingEvidenceExamples: [
      'Moment choices for reframing (CHG-01) or letting go (CHG-05)',
      'Confirmed Reflect sentence about seeing an old conflict differently now',
    ],
    invalidOverreachExamples: [
      'Claiming the person is inconsistent or unreliable',
      'Treating revision as weakness of conviction',
    ],
  },
  stability_orientation: {
    id: 'stability_orientation',
    title: { zh: '看重安稳', en: 'Valuing stability' },
    description: 'Moves toward continuity, security and protecting what is present.',
    positiveDirection: 'Protects continuity and security; keeps what works intact.',
    negativeDirection: 'Deprioritises security in favor of what could change.',
    allowedSources: BOTH_SOURCES,
    userFacingEligible: true,
    supportingEvidenceExamples: [
      'Moment choices for security priority (MEA-08) or continuity (CHG-07)',
      'Confirmed Reflect sentence about wanting life to stay steady right now',
    ],
    invalidOverreachExamples: [
      '"You fear change" — motive attribution, forbidden',
      'Reading stability as lack of ambition',
    ],
  },
  change_orientation: {
    id: 'change_orientation',
    title: { zh: '趋向行动与改变', en: 'Moving toward change' },
    description: 'Moves toward acting on situations and initiating change.',
    positiveDirection: 'Turns situations into action; initiates rather than waits.',
    negativeDirection: 'Prefers to let situations settle before acting.',
    allowedSources: BOTH_SOURCES,
    userFacingEligible: true,
    supportingEvidenceExamples: [
      'Moment choices with action bias (CHG-02)',
      'Confirmed Reflect sentence about deciding to finally change a situation',
    ],
    invalidOverreachExamples: [
      '"You are impulsive" — identity judgment, forbidden',
      'Treating one decisive week as a permanent operating mode',
    ],
  },
  trust_openness: {
    id: 'trust_openness',
    title: { zh: '信任的敞开', en: 'Openness in trust' },
    description: 'Moves toward assuming goodwill and disclosing to others.',
    positiveDirection: 'Extends benefit of the doubt; opens up as trust grows.',
    negativeDirection: 'Stays watchful; discloses slowly and selectively.',
    allowedSources: BOTH_SOURCES,
    userFacingEligible: true,
    supportingEvidenceExamples: [
      'Moment choices assuming benevolence (TRU-01) or deeper disclosure (TRU-07)',
      'Confirmed Reflect sentence about deciding to trust someone again',
    ],
    invalidOverreachExamples: [
      '"You have trust issues" — diagnostic framing, forbidden',
      'Claiming the person was betrayed in the past',
    ],
  },
  conflict_engagement: {
    id: 'conflict_engagement',
    title: { zh: '面对冲突', en: 'Engaging with conflict' },
    description: 'Moves toward addressing disagreement rather than routing around it.',
    positiveDirection: 'Addresses disagreements openly with the people involved.',
    negativeDirection: 'Routes around friction to keep the surface calm.',
    allowedSources: BOTH_SOURCES,
    userFacingEligible: true,
    supportingEvidenceExamples: [
      'Moment choice of 和气绕行 (REL-10) — negative direction evidence',
      'Confirmed Reflect sentence about raising a hard topic at home',
    ],
    invalidOverreachExamples: [
      '"You are conflict-avoidant" as a fixed identity — forbidden',
      'Reading avoidance in one high-stakes case as fear in all cases',
    ],
  },
  meaning_orientation: {
    id: 'meaning_orientation',
    title: { zh: '意义感的来处', en: 'Where meaning comes from' },
    description: 'Moves toward building meaning from experience, contribution or acceptance.',
    positiveDirection: 'Actively builds a sense of meaning (experience, usefulness, self-acceptance).',
    allowedSources: BOTH_SOURCES,
    userFacingEligible: true,
    supportingEvidenceExamples: [
      'Moment choices for experiential (MEA-01) or contributive meaning (MEA-02)',
      'Confirmed Reflect sentence about what makes a period of life feel worth it',
    ],
    invalidOverreachExamples: [
      'Religious or political classification — forbidden',
      '"You are searching for yourself" — vague identity claim',
    ],
  },
};

export const MOVEMENT_IDS = Object.keys(MOVEMENTS) as MovementId[];

export function isMovementId(value: string): value is MovementId {
  return Object.prototype.hasOwnProperty.call(MOVEMENTS, value);
}

export function getMovementDefinition(id: MovementId): MovementDefinition {
  return MOVEMENTS[id];
}

/**
 * Recognition material for a Movement — empty placeholder until the founder
 * writes it. Both observation channels (Moments, Reflect) will read from
 * this one place; neither may define recognition content of its own.
 */
export function getMovementRecognition(id: MovementId): MovementRecognition {
  return MOVEMENTS[id].recognition ?? EMPTY_MOVEMENT_RECOGNITION;
}

/**
 * Movements considered "closely related" for relationship classification.
 * Symmetric by construction (validated in tests). Same-id is always related.
 */
export const RELATED_MOVEMENTS: Partial<Record<MovementId, MovementId[]>> = {
  direct_expression: ['delayed_expression', 'conflict_engagement'],
  delayed_expression: ['direct_expression', 'conflict_engagement'],
  conflict_engagement: ['direct_expression', 'delayed_expression', 'relationship_preservation'],
  relationship_preservation: ['conflict_engagement', 'emotional_attunement', 'trust_openness'],
  emotional_attunement: ['relationship_preservation', 'perspective_taking'],
  perspective_taking: ['emotional_attunement'],
  trust_openness: ['relationship_preservation', 'boundary_preservation'],
  boundary_preservation: ['trust_openness', 'autonomy_orientation'],
  autonomy_orientation: ['boundary_preservation', 'meaning_orientation'],
  meaning_orientation: ['autonomy_orientation'],
  stability_orientation: ['change_orientation', 'uncertainty_tolerance'],
  change_orientation: ['stability_orientation', 'openness_to_revision'],
  openness_to_revision: ['change_orientation'],
  uncertainty_tolerance: ['structure_seeking', 'stability_orientation'],
  structure_seeking: ['uncertainty_tolerance', 'responsibility_orientation'],
  responsibility_orientation: ['structure_seeking'],
};

export function areMovementsRelated(a: MovementId, b: MovementId): boolean {
  if (a === b) return true;
  return (RELATED_MOVEMENTS[a] ?? []).includes(b);
}
