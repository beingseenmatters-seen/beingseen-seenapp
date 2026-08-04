/**
 * Central Signal-to-Movement mapping (Section G, Phase 3A).
 *
 * The single place where existing Moment Signals (src/data/moments/signals.ts,
 * frozen IDs) feed the Movement layer. The approved Moment content — wording,
 * signal IDs, deltas, confidences, option weights — is NOT changed here; this
 * layer only interprets emissions upward.
 *
 * Hard boundaries:
 *  - no mapping may depend on user gender, age or zodiac
 *  - zodiac never produces Movement evidence
 *  - response-mode selection never produces Movement evidence
 *  - demographic fields never become personality evidence
 *
 * One Signal maps to more than one Movement only where genuinely justified
 * (currently CHG-09 and REL-10; rationale documented on each row).
 */

import type { MovementId } from './movements';
import { isMovementId } from './movements';
import type { EvidenceContext } from '../../types/evidence';
import { SIGNAL_INDEX } from '../moments/signals';

/** Recorded in moment evidence sourceVersion.mappingVersion. */
export const SIGNAL_MOVEMENT_MAP_VERSION = 'signal_movement_map_v1';

export interface SignalMovementMapping {
  signalId: string;
  movementId: MovementId;
  /** +1 = signal's positive delta supports the movement's positive direction. */
  directionMultiplier: 1 | -1;
  /** 0..1 relative weight of this signal for the movement. */
  strengthMultiplier: number;
  contextOverrides?: Partial<EvidenceContext>;
  /** Written rationale — required for every mapping. */
  rationale: string;
}

export const SIGNAL_MOVEMENT_MAP: SignalMovementMapping[] = [
  // --- EMW (emotional weather) ---
  { signalId: 'EMW-01', movementId: 'uncertainty_tolerance', directionMultiplier: 1, strengthMultiplier: 0.8,
    rationale: 'Acceptance (接纳) of what happened is direct evidence of staying steady with the unresolved.' },
  { signalId: 'EMW-02', movementId: 'uncertainty_tolerance', directionMultiplier: 1, strengthMultiplier: 1,
    rationale: 'Frustration tolerance (挫折消化) is the core positive observation of uncertainty tolerance.' },
  { signalId: 'EMW-03', movementId: 'uncertainty_tolerance', directionMultiplier: -1, strengthMultiplier: 1,
    rationale: 'Anxiety activation (焦虑激活) observes strain when things are unresolved — negative direction.' },
  { signalId: 'EMW-04', movementId: 'boundary_preservation', directionMultiplier: 1, strengthMultiplier: 0.7,
    rationale: 'Emotional economy (情绪不外借) keeps emotional resources guarded — a boundary movement.' },
  { signalId: 'EMW-05', movementId: 'stability_orientation', directionMultiplier: 1, strengthMultiplier: 0.8,
    rationale: 'Present protection (护住今天) protects what is currently working — stability movement.' },

  // --- CHG (change) ---
  { signalId: 'CHG-01', movementId: 'openness_to_revision', directionMultiplier: 1, strengthMultiplier: 1,
    rationale: 'Reframing (重构) is the canonical observation of revising one\'s own framing.' },
  { signalId: 'CHG-02', movementId: 'change_orientation', directionMultiplier: 1, strengthMultiplier: 0.9,
    rationale: 'Action bias (行动倾向) turns situations into initiated action — change movement.' },
  { signalId: 'CHG-03', movementId: 'responsibility_orientation', directionMultiplier: 1, strengthMultiplier: 0.8,
    rationale: 'Agency (能动) claims ownership over outcomes — responsibility movement.' },
  { signalId: 'CHG-05', movementId: 'openness_to_revision', directionMultiplier: 1, strengthMultiplier: 0.8,
    rationale: 'Letting go (轻装放手) releases an old framing/attachment — revision movement.' },
  { signalId: 'CHG-06', movementId: 'stability_orientation', directionMultiplier: 1, strengthMultiplier: 0.5,
    rationale: 'Warm past engagement (回望有温) keeps continuity with what has been — weak stability evidence.' },
  { signalId: 'CHG-07', movementId: 'stability_orientation', directionMultiplier: 1, strengthMultiplier: 1,
    rationale: 'Continuity preservation (延续守持) is the core positive observation of valuing stability.' },
  { signalId: 'CHG-08', movementId: 'structure_seeking', directionMultiplier: 1, strengthMultiplier: 1,
    rationale: 'Planning orientation (规划先行) is direct structure-seeking evidence.' },
  // CHG-09 dual mapping — genuinely two movements: needing certainty is both a
  // preference for structure and reduced tolerance for open situations.
  { signalId: 'CHG-09', movementId: 'structure_seeking', directionMultiplier: 1, strengthMultiplier: 0.6,
    rationale: 'Certainty seeking (先要确定) prefers defined arrangements before moving.' },
  { signalId: 'CHG-09', movementId: 'uncertainty_tolerance', directionMultiplier: -1, strengthMultiplier: 0.9,
    rationale: 'Certainty seeking also observes discomfort with unresolved states — negative direction.' },
  { signalId: 'CHG-10', movementId: 'openness_to_revision', directionMultiplier: 1, strengthMultiplier: 0.7,
    rationale: 'Curiosity (终究想看) keeps the willingness to look again and update.' },

  // --- CAR (care) ---
  { signalId: 'CAR-01', movementId: 'emotional_attunement', directionMultiplier: 1, strengthMultiplier: 0.8,
    rationale: 'Care expression (善意付诸) requires noticing and responding to another\'s state.' },
  { signalId: 'CAR-02', movementId: 'relationship_preservation', directionMultiplier: 1, strengthMultiplier: 1,
    rationale: 'Care commitment (长期承接) invests in keeping a bond alive over time.' },
  { signalId: 'CAR-03', movementId: 'emotional_attunement', directionMultiplier: 1, strengthMultiplier: 0.6,
    rationale: 'Practical care (务实关照) responds to needs concretely — attunement expressed in action.' },
  { signalId: 'CAR-04', movementId: 'responsibility_orientation', directionMultiplier: 1, strengthMultiplier: 1,
    rationale: 'Responsibility uptake (责任上肩) is the core positive observation of the movement.' },
  { signalId: 'CAR-05', movementId: 'responsibility_orientation', directionMultiplier: 1, strengthMultiplier: 0.7,
    rationale: 'Accountability focus (问责指向) cares about responsibility being carried — same movement, other-directed.' },

  // --- REL (relationships) ---
  { signalId: 'REL-04', movementId: 'boundary_preservation', directionMultiplier: 1, strengthMultiplier: 1,
    rationale: 'Boundary maintenance (边界持守) is the canonical boundary observation.' },
  { signalId: 'REL-05', movementId: 'boundary_preservation', directionMultiplier: 1, strengthMultiplier: 0.6,
    rationale: 'Commitment caution (承诺审慎) protects future obligations — boundary movement.' },
  { signalId: 'REL-06', movementId: 'relationship_preservation', directionMultiplier: 1, strengthMultiplier: 0.7,
    rationale: 'Relational generosity (近亲分享) invests resources in close bonds.' },
  { signalId: 'REL-07', movementId: 'stability_orientation', directionMultiplier: 1, strengthMultiplier: 0.6,
    rationale: 'Communal embedding (熟人环绕) roots life in familiar, continuous circles.' },
  { signalId: 'REL-08', movementId: 'autonomy_orientation', directionMultiplier: 1, strengthMultiplier: 0.7,
    rationale: 'Anonymity seeking (匿名自在) is comfort apart from known reference groups.' },
  { signalId: 'REL-09', movementId: 'boundary_preservation', directionMultiplier: 1, strengthMultiplier: 0.7,
    rationale: 'Selective connection (少而真) keeps the circle deliberately small — boundary movement.' },
  // REL-10 dual mapping — genuinely two movements: routing around friction is
  // negative conflict engagement AND positive relationship-surface preservation.
  { signalId: 'REL-10', movementId: 'conflict_engagement', directionMultiplier: -1, strengthMultiplier: 1,
    rationale: 'Conflict avoidance (和气绕行) is the negative direction of engaging conflict.' },
  { signalId: 'REL-10', movementId: 'relationship_preservation', directionMultiplier: 1, strengthMultiplier: 0.5,
    rationale: 'The same choice also protects the relationship\'s surface harmony — weak positive evidence.' },

  // --- MEA (meaning) ---
  { signalId: 'MEA-01', movementId: 'meaning_orientation', directionMultiplier: 1, strengthMultiplier: 0.8,
    rationale: 'Experiential meaning (体验即意义) actively builds meaning from lived experience.' },
  { signalId: 'MEA-02', movementId: 'meaning_orientation', directionMultiplier: 1, strengthMultiplier: 0.8,
    rationale: 'Contributive meaning (有用即意义) builds meaning from usefulness to others.' },
  { signalId: 'MEA-03', movementId: 'meaning_orientation', directionMultiplier: 1, strengthMultiplier: 0.6,
    rationale: 'Existential acceptance (存在自足) treats existence itself as enough — meaning movement.' },
  { signalId: 'MEA-04', movementId: 'autonomy_orientation', directionMultiplier: 1, strengthMultiplier: 0.9,
    rationale: 'Meaning autonomy (答案自寻) finds answers internally rather than adopting given ones.' },
  { signalId: 'MEA-05', movementId: 'autonomy_orientation', directionMultiplier: 1, strengthMultiplier: 0.8,
    rationale: 'Internal anchoring (内在锚点) measures life against internal standards.' },
  { signalId: 'MEA-06', movementId: 'autonomy_orientation', directionMultiplier: -1, strengthMultiplier: 0.8,
    rationale: 'Comparison sensitivity (比较敏感) leans on external reference points — negative direction.' },
  { signalId: 'MEA-08', movementId: 'stability_orientation', directionMultiplier: 1, strengthMultiplier: 1,
    rationale: 'Security priority (安稳优先) is the canonical stability observation.' },
  { signalId: 'MEA-09', movementId: 'autonomy_orientation', directionMultiplier: 1, strengthMultiplier: 0.9,
    rationale: 'Freedom seeking (自由优先) prioritises self-determined space.' },
  { signalId: 'MEA-10', movementId: 'responsibility_orientation', directionMultiplier: 1, strengthMultiplier: 0.8,
    rationale: 'Effort attribution (努力归因) explains outcomes through one\'s own effort.' },
  { signalId: 'MEA-11', movementId: 'responsibility_orientation', directionMultiplier: -1, strengthMultiplier: 0.6,
    rationale: 'Luck attribution (运气归因) hands outcomes to external chance — negative direction.' },
  { signalId: 'MEA-12', movementId: 'perspective_taking', directionMultiplier: 1, strengthMultiplier: 0.6,
    rationale: 'Structural attribution (结构归因) explains events through wider systems, not individual blame.' },

  // --- TRU (trust) ---
  { signalId: 'TRU-01', movementId: 'trust_openness', directionMultiplier: 1, strengthMultiplier: 1,
    rationale: 'Benevolence assumption (善意推定) extends the benefit of the doubt — core trust openness.' },
  { signalId: 'TRU-02', movementId: 'trust_openness', directionMultiplier: -1, strengthMultiplier: 0.8,
    rationale: 'Social caution (社交警觉) stays watchful with unfamiliar others — negative direction.' },
  { signalId: 'TRU-03', movementId: 'trust_openness', directionMultiplier: 1, strengthMultiplier: 0.6,
    rationale: 'System trust (系统信任) extends trust to institutions and processes.' },
  { signalId: 'TRU-04', movementId: 'structure_seeking', directionMultiplier: 1, strengthMultiplier: 0.7,
    rationale: 'Rule sensitivity (规则敏感) values defined rules being kept — structure movement.' },
  { signalId: 'TRU-05', movementId: 'perspective_taking', directionMultiplier: 1, strengthMultiplier: 0.9,
    rationale: 'Judgment restraint (判断克制) suspends conclusions about others — perspective movement.' },
  { signalId: 'TRU-06', movementId: 'boundary_preservation', directionMultiplier: 1, strengthMultiplier: 0.8,
    rationale: 'Information control (信息守护) guards personal information — boundary movement.' },
  { signalId: 'TRU-07', movementId: 'trust_openness', directionMultiplier: 1, strengthMultiplier: 0.8,
    rationale: 'Disclosure depth (敞开程度) opens up as trust grows. (Defined in SIGNAL_INDEX; not yet emitted by any approved Moment — mapped ahead of use.)' },

  // --- EXP (expression) ---
  { signalId: 'EXP-01', movementId: 'direct_expression', directionMultiplier: 1, strengthMultiplier: 1,
    rationale: 'Directness (当面说出) is the canonical direct-expression observation.' },
  { signalId: 'EXP-02', movementId: 'direct_expression', directionMultiplier: -1, strengthMultiplier: 0.8,
    rationale: 'Emotional containment (心里收着) keeps feelings unvoiced — negative direction of direct expression.' },
  { signalId: 'EXP-03', movementId: 'delayed_expression', directionMultiplier: 1, strengthMultiplier: 1,
    rationale: 'Strategic expression (看时机说) times and shapes expression — delayed-expression movement.' },
];

/**
 * Signals deliberately kept out of the Movement layer, with the reason.
 * (Currently empty: every signal in SIGNAL_INDEX is behavioral and mapped.
 * Demographic fields, zodiac and response-mode selections are not Signals and
 * can never enter this map — enforced by validateSignalMovementMap and tests.)
 */
export const INTENTIONALLY_NON_PROFILE_SIGNALS: Record<string, string> = {};

export function getMappingsForSignal(signalId: string): SignalMovementMapping[] {
  return SIGNAL_MOVEMENT_MAP.filter((m) => m.signalId === signalId);
}

/**
 * Moment Signals that feed a Movement — the "Moment Signals" facet of the
 * single ontology (Phase 3.1). Always DERIVED from this map so the
 * Signal → Movement mapping keeps one source of truth; Movement definitions
 * never store their own signal lists.
 */
export function signalsForMovement(movementId: MovementId): string[] {
  return [...new Set(
    SIGNAL_MOVEMENT_MAP.filter((m) => m.movementId === movementId).map((m) => m.signalId),
  )].sort();
}

/**
 * Structural validation of the mapping layer. Returns problems (empty = ok):
 *  - every SIGNAL_INDEX signal is mapped or intentionally excluded
 *  - no unknown movement or signal is referenced
 *  - no duplicate signal→movement rows (which would double-count)
 *  - multipliers stay in bounds and every row has a rationale
 */
export function validateSignalMovementMap(): string[] {
  const problems: string[] = [];
  const knownSignals = new Set(Object.keys(SIGNAL_INDEX));
  const seenRows = new Set<string>();

  for (const row of SIGNAL_MOVEMENT_MAP) {
    if (!knownSignals.has(row.signalId)) {
      problems.push(`mapping references unknown signal: ${row.signalId}`);
    }
    if (!isMovementId(row.movementId)) {
      problems.push(`mapping references unknown movement: ${row.movementId}`);
    }
    if (row.directionMultiplier !== 1 && row.directionMultiplier !== -1) {
      problems.push(`${row.signalId}→${row.movementId}: directionMultiplier must be +1 or -1`);
    }
    if (!(row.strengthMultiplier > 0 && row.strengthMultiplier <= 1)) {
      problems.push(`${row.signalId}→${row.movementId}: strengthMultiplier must be in (0, 1]`);
    }
    if (!row.rationale?.trim()) {
      problems.push(`${row.signalId}→${row.movementId}: rationale is required`);
    }
    const key = `${row.signalId}→${row.movementId}`;
    if (seenRows.has(key)) {
      problems.push(`duplicate mapping row: ${key}`);
    }
    seenRows.add(key);
  }

  const mappedSignals = new Set(SIGNAL_MOVEMENT_MAP.map((m) => m.signalId));
  for (const signalId of knownSignals) {
    if (!mappedSignals.has(signalId) && !(signalId in INTENTIONALLY_NON_PROFILE_SIGNALS)) {
      problems.push(`signal neither mapped nor intentionally excluded: ${signalId}`);
    }
  }
  for (const excluded of Object.keys(INTENTIONALLY_NON_PROFILE_SIGNALS)) {
    if (mappedSignals.has(excluded)) {
      problems.push(`signal is both mapped and marked non-profile: ${excluded}`);
    }
  }

  return problems;
}
