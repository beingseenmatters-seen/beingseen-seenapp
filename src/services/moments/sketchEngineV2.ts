/**
 * Sketch Engine V2 — Continuity + Delta (2026-07-29).
 *
 * Replaces the portrait-shaped Summary Engine V1 pipeline for NEW sketches
 * (V1 remains in the codebase for auditing/regenerating old stored sketches).
 *
 * Strategy:
 *  - Sketch 01 (no prior retained sessions): a baseline of the strongest
 *    meaningful Movement observations from this session. Salience is
 *    normalized per Movement (support × |direction|), which removes V1's bias
 *    where dimensions with longer signal lists automatically dominated.
 *  - Sketch 02+: generated from pre-session Behaviour Understanding, this
 *    session's Movement evidence, post-session understanding, and the last
 *    1–2 sketches' provenance. Meaningful deltas lead; stable understanding
 *    provides continuity. A session with no meaningful delta produces a
 *    confirmation-oriented sketch instead of invented novelty.
 *
 * Guarantees preserved from V1:
 *  - Output is an exact concatenation of founder-approved fragments
 *    (audited); no free-form generation.
 *  - Fully deterministic: the same stored state always produces the same
 *    sketch (no randomness, no wall-clock reads).
 *  - Behaviour channel only: consumes Moment session evidence exclusively.
 *
 * Founder principle (2026-07-30): novelty is not the goal — growth is.
 * A sketch changes only when understanding genuinely changed. A Movement
 * voiced in a recent sketch can never be presented as "new" again, and when
 * the strongest delta is weak or was just voiced, the sketch reinforces
 * existing understanding instead of manufacturing novelty.
 *
 * Internal delta labels, Movement ids, scores and thresholds are never
 *  rendered to the person.
 */

import type {
  MomentsSession,
  SketchDeltaClass,
  SketchMode,
  SketchProvenance,
} from '../../types/moments';
import type { MovementId } from '../../data/understanding/movements';
import {
  aggregateMomentSessionEvidence,
  type MomentMovementAggregate,
} from '../understanding/momentEvidence';
import {
  BASELINE_CONNECTIVES,
  FRAMINGS_CONFIRMATION,
  FRAMINGS_NEW,
  FRAMINGS_REINFORCED,
  FRAMINGS_REVISED,
  FRAMINGS_SHIFTED,
  FRAMINGS_STRENGTHENED,
  MOVEMENT_CLAUSES,
  SKETCH_SENTENCE_STOP,
  SKETCH_V2_ENGINE_VERSION,
  capitalizeSketchOpening,
  sketchText,
  type MovementClause,
  type SketchFraming,
} from '../../data/moments/sketchV2Content';

// ---------------------------------------------------------------------------
// Thresholds — aligned with the Human Understanding Engine's confidence
// vocabulary (low 0.3 / medium 0.6 / high 0.9 in momentEvidence.ts).
// ---------------------------------------------------------------------------

/**
 * Minimum support (strength × mappingConfidence) for a session observation to
 * count as meaningful. A single weak low-confidence touch (~0.1 × 0.3 = 0.03)
 * fails; a typical reinforced medium-confidence aggregate (~0.3 × 0.5 = 0.15)
 * passes. This is what keeps accidental single-answer changes out of sketches.
 */
export const MEANINGFUL_SUPPORT = 0.09;

/** Minimum |direction| for an observation to have an expressible polarity. */
export const MIN_DIRECTION = 0.35;

/**
 * Sessions of consistent support after which an understanding counts as
 * mature: one more consistent session confirms (STABLE) rather than
 * strengthens it.
 */
export const MATURE_SESSION_COUNT = 3;

/**
 * A repeat observation counts as STRENGTHENED only when it is materially
 * stronger than the prior typical observation — merely repeating the same
 * answers confirms (STABLE) rather than strengthens.
 */
export const STRENGTHEN_FACTOR = 1.25;

/** Max sentences led by deltas / continuity respectively (guidance 1–2 each). */
const MAX_DELTA_SLOTS = 2;
const MAX_CONTINUITY_SLOTS = 2;

// ---------------------------------------------------------------------------
// Cross-session Behaviour Understanding snapshot
// ---------------------------------------------------------------------------

export interface MovementUnderstanding {
  movementId: MovementId;
  /** −1..1 — support-weighted mean direction across retained sessions. */
  direction: number;
  /** 0..1 — mean per-session support (strength × mappingConfidence). */
  meanSupport: number;
  /** How many retained sessions touched this Movement. */
  sessionCount: number;
}

export type UnderstandingSnapshot = Map<MovementId, MovementUnderstanding>;

const support = (a: MomentMovementAggregate): number => a.strength * a.mappingConfidence;

/**
 * Combine retained sessions into a per-Movement understanding snapshot.
 * Pure and order-insensitive; deleting a retained session and recombining
 * removes its evidence — nothing else stores derived understanding.
 */
export function combineBehaviourUnderstanding(sessions: MomentsSession[]): UnderstandingSnapshot {
  const byMovement = new Map<MovementId, MomentMovementAggregate[]>();
  for (const session of sessions) {
    for (const aggregate of aggregateMomentSessionEvidence(session)) {
      const list = byMovement.get(aggregate.movementId) ?? [];
      list.push(aggregate);
      byMovement.set(aggregate.movementId, list);
    }
  }

  const snapshot: UnderstandingSnapshot = new Map();
  for (const [movementId, list] of byMovement) {
    const supportSum = list.reduce((s, a) => s + support(a), 0);
    if (supportSum === 0) continue;
    snapshot.set(movementId, {
      movementId,
      direction: list.reduce((s, a) => s + a.direction * support(a), 0) / supportSum,
      meanSupport: supportSum / list.length,
      sessionCount: list.length,
    });
  }
  return snapshot;
}

const isMeaningful = (u: { meanSupport: number; direction: number }): boolean =>
  u.meanSupport >= MEANINGFUL_SUPPORT && Math.abs(u.direction) >= MIN_DIRECTION;

// ---------------------------------------------------------------------------
// Delta classification
// ---------------------------------------------------------------------------

export interface MovementDelta {
  movementId: MovementId;
  deltaClass: SketchDeltaClass;
  /** This session's observation. */
  direction: number;
  /** Salience of this session's observation (support × |direction|). */
  salience: number;
}

/**
 * Classify every Movement touched by the completed session against the
 * pre-session understanding. Numerical noise is not treated as meaning:
 * observations below the support/direction thresholds classify as
 * INSUFFICIENT_CHANGE and never lead a sketch.
 *
 * `recentlyVoiced` — Movements expressed in the last 1–2 sketches. A Movement
 * the person just read about can never be "new" again: a borderline prior
 * (support hovering under threshold) would otherwise re-classify NEW every
 * session and headline repeatedly. It becomes STRENGTHENED — honest growth,
 * not manufactured novelty.
 */
export function classifySessionDeltas(
  sessionAggregates: MomentMovementAggregate[],
  pre: UnderstandingSnapshot,
  recentlyVoiced: ReadonlySet<string> = new Set(),
): MovementDelta[] {
  return sessionAggregates.map((cur): MovementDelta => {
    const curSupport = support(cur);
    const salience = curSupport * Math.abs(cur.direction);
    const base = { movementId: cur.movementId, direction: cur.direction, salience };

    if (curSupport < MEANINGFUL_SUPPORT || Math.abs(cur.direction) < MIN_DIRECTION) {
      return { ...base, deltaClass: 'INSUFFICIENT_CHANGE' };
    }

    const prior = pre.get(cur.movementId);
    if (!prior) return { ...base, deltaClass: 'NEW' };

    const priorMeaningful = isMeaningful(prior);
    const signFlip = Math.sign(prior.direction) !== Math.sign(cur.direction);
    if (priorMeaningful && signFlip) return { ...base, deltaClass: 'REVISED' };
    if (!priorMeaningful) {
      // Prior touches were too weak to constitute understanding — this
      // session is the first meaningful observation, unless the person has
      // already read about this Movement recently.
      return { ...base, deltaClass: recentlyVoiced.has(cur.movementId) ? 'STRENGTHENED' : 'NEW' };
    }
    if (Math.abs(prior.direction - cur.direction) >= 0.5) {
      return { ...base, deltaClass: 'SHIFTED' };
    }
    const priorSalience = prior.meanSupport * Math.abs(prior.direction);
    if (prior.sessionCount < MATURE_SESSION_COUNT && salience >= priorSalience * STRENGTHEN_FACTOR) {
      return { ...base, deltaClass: 'STRENGTHENED' };
    }
    return { ...base, deltaClass: 'STABLE' };
  });
}

// ---------------------------------------------------------------------------
// Content lookup
// ---------------------------------------------------------------------------

const clauseFor = (movementId: MovementId, direction: number): MovementClause | undefined =>
  MOVEMENT_CLAUSES.find(
    (c) => c.movementId === movementId && c.polarity === (direction >= 0 ? 'positive' : 'negative'),
  );

const FRAMINGS_BY_CLASS: Partial<Record<SketchDeltaClass, SketchFraming[]>> = {
  NEW: FRAMINGS_NEW,
  STRENGTHENED: FRAMINGS_STRENGTHENED,
  REVISED: FRAMINGS_REVISED,
  SHIFTED: FRAMINGS_SHIFTED,
};

/**
 * Deterministic framing rotation: never repeat a framing within one sketch,
 * and (when alternatives exist) avoid the framings the previous sketch used —
 * so no fixed reusable opening can emerge. The within-sketch rule holds even
 * when every framing of a class was used by the previous sketch.
 */
function pickFraming(
  list: SketchFraming[],
  sketchNumber: number,
  slotIndex: number,
  avoidPrior: ReadonlySet<string>,
  usedThisSketch: ReadonlySet<string>,
): SketchFraming {
  const fresh = list.filter((f) => !avoidPrior.has(f.id) && !usedThisSketch.has(f.id));
  const withinSketch = list.filter((f) => !usedThisSketch.has(f.id));
  const pool = fresh.length ? fresh : withinSketch.length ? withinSketch : list;
  return pool[(sketchNumber + slotIndex) % pool.length];
}

// ---------------------------------------------------------------------------
// Generation
// ---------------------------------------------------------------------------

export interface SketchV2Input {
  /** The just-completed session (all answers present). */
  session: MomentsSession;
  /** Previously retained (completed, kept) sessions, any order. */
  priorSessions: MomentsSession[];
  /** Provenance of the most recent 1–2 retained sketches, oldest first. */
  recentProvenance: SketchProvenance[];
  /** 1-based number of the sketch being generated. */
  sketchNumber: number;
  /** User-facing language for assembled sketch text. Defaults to zh. */
  language?: 'zh' | 'en';
}

export interface SketchV2Result {
  text: string;
  audit: 'PASSED' | 'FAILED';
  engineVersion: string;
  provenance: SketchProvenance;
}

interface Sentence {
  fragments: string[];
  movementId: MovementId;
  blockId: string;
  variantId: string;
}

const DELTA_PRIORITY: Partial<Record<SketchDeltaClass, number>> = {
  NEW: 4,
  REVISED: 3,
  SHIFTED: 2,
  STRENGTHENED: 1,
};

/**
 * Assembly audit — every emitted fragment must be an exact approved fragment:
 * a Movement clause, a framing, a baseline connective, or the sentence stop.
 * Mirrors V1's guarantee that no unapproved text can reach the person.
 * Both languages are approved so the same provenance can render in either.
 */
const ALL_FRAMINGS = [
  ...FRAMINGS_NEW,
  ...FRAMINGS_STRENGTHENED,
  ...FRAMINGS_REVISED,
  ...FRAMINGS_SHIFTED,
  ...FRAMINGS_REINFORCED,
  ...FRAMINGS_CONFIRMATION,
];

const APPROVED_FRAGMENTS: Set<string> = new Set([
  SKETCH_SENTENCE_STOP.zh,
  SKETCH_SENTENCE_STOP.en!,
  ...BASELINE_CONNECTIVES.flatMap((c) => [c.zh, c.en!].filter(Boolean)),
  ...MOVEMENT_CLAUSES.flatMap((c) => [c.text.zh, c.text.en!]),
  ...ALL_FRAMINGS.flatMap((f) => [f.text.zh, f.text.en!]),
]);

const isApprovedFragment = (fragment: string): boolean => APPROVED_FRAGMENTS.has(fragment);

export function generateSketchV2(input: SketchV2Input): SketchV2Result {
  const { session, priorSessions, recentProvenance, sketchNumber } = input;
  const language = input.language ?? 'zh';
  const stop = sketchText(SKETCH_SENTENCE_STOP, language);

  const sessionAggregates = aggregateMomentSessionEvidence(session);
  const pre = combineBehaviourUnderstanding(priorSessions);
  const post = combineBehaviourUnderstanding([...priorSessions, session]);
  const recentlyVoiced = new Set(recentProvenance.flatMap((p) => p.movementIds));
  const deltas = classifySessionDeltas(sessionAggregates, pre, recentlyVoiced);
  const deltaClasses: Record<string, SketchDeltaClass> = {};
  for (const d of deltas) deltaClasses[d.movementId] = d.deltaClass;

  const lastProvenance = recentProvenance[recentProvenance.length - 1];
  const cooldownBlockIds = new Set(lastProvenance?.blockIds ?? []);
  const avoidFramingIds = new Set(lastProvenance?.variantIds.filter(Boolean) ?? []);

  const sentences: Sentence[] = [];
  let mode: SketchMode;

  if (priorSessions.length === 0) {
    // ----- Sketch 01: baseline — strongest meaningful observations only.
    mode = 'baseline';
    const candidates = deltas
      .filter((d) => d.deltaClass !== 'INSUFFICIENT_CHANGE')
      .map((d) => ({ delta: d, clause: clauseFor(d.movementId, d.direction) }))
      .filter((c): c is { delta: MovementDelta; clause: MovementClause } => !!c.clause)
      .sort(
        (a, b) => b.delta.salience - a.delta.salience
          || a.delta.movementId.localeCompare(b.delta.movementId),
      )
      .slice(0, BASELINE_CONNECTIVES.length);

    candidates.forEach(({ delta, clause }, i) => {
      const connective = sketchText(BASELINE_CONNECTIVES[i] ?? { zh: '', en: '' }, language);
      const clauseBody = sketchText(clause.text, language);
      sentences.push({
        fragments: connective ? [connective, clauseBody, stop] : [clauseBody, stop],
        movementId: delta.movementId,
        blockId: clause.id,
        variantId: '',
      });
    });
  } else {
    // ----- Sketch 02+: meaningful deltas lead; stable understanding anchors.
    const usedFramings = new Set<string>();

    const deltaCandidates = deltas
      .filter((d) => (DELTA_PRIORITY[d.deltaClass] ?? 0) > 0)
      .map((d) => ({ delta: d, clause: clauseFor(d.movementId, d.direction) }))
      // A sentence voiced in the previous sketch is excluded outright —
      // founder principle: when the strongest delta was just voiced, it is
      // better to reinforce existing understanding (confirmation mode below)
      // than to headline the same observation again. A genuine REVISED flips
      // polarity and therefore uses a different clause, so real reversals
      // are never suppressed by this cooldown.
      .filter(
        (c): c is { delta: MovementDelta; clause: MovementClause } =>
          !!c.clause && !cooldownBlockIds.has(c.clause.id),
      )
      .sort((a, b) => {
        const prio = (DELTA_PRIORITY[b.delta.deltaClass] ?? 0) - (DELTA_PRIORITY[a.delta.deltaClass] ?? 0);
        if (prio) return prio;
        return b.delta.salience - a.delta.salience
          || a.delta.movementId.localeCompare(b.delta.movementId);
      })
      .slice(0, MAX_DELTA_SLOTS);

    mode = deltaCandidates.length ? 'delta' : 'confirmation';

    deltaCandidates.forEach(({ delta, clause }, i) => {
      const framing = pickFraming(
        FRAMINGS_BY_CLASS[delta.deltaClass] ?? FRAMINGS_NEW,
        sketchNumber,
        i,
        avoidFramingIds,
        usedFramings,
      );
      usedFramings.add(framing.id);
      sentences.push({
        fragments: [sketchText(framing.text, language), sketchText(clause.text, language), stop],
        movementId: delta.movementId,
        blockId: clause.id,
        variantId: framing.id,
      });
    });

    // Continuity: mature, meaningful post-session understanding not already
    // voiced above, with a cooldown on last sketch's blocks.
    const voiced = new Set(sentences.map((s) => s.movementId));
    const continuityPool = [...post.values()]
      .filter((u) => u.sessionCount >= 2 && isMeaningful(u) && !voiced.has(u.movementId))
      .map((u) => ({ u, clause: clauseFor(u.movementId, u.direction) }))
      .filter((c): c is { u: MovementUnderstanding; clause: MovementClause } => !!c.clause)
      .sort(
        (a, b) => b.u.meanSupport * Math.abs(b.u.direction) - a.u.meanSupport * Math.abs(a.u.direction)
          || a.u.movementId.localeCompare(b.u.movementId),
      );
    const offCooldown = continuityPool.filter((c) => !cooldownBlockIds.has(c.clause.id));
    const continuity = (offCooldown.length ? offCooldown : continuityPool)
      .slice(0, mode === 'confirmation' ? MAX_CONTINUITY_SLOTS + 1 : MAX_CONTINUITY_SLOTS);

    continuity.forEach(({ u, clause }, i) => {
      const isOpening = sentences.length === 0 && i === 0;
      const framing = pickFraming(
        // A no-delta sketch opens by saying so — confirmation, not novelty.
        isOpening && mode === 'confirmation' ? FRAMINGS_CONFIRMATION : FRAMINGS_REINFORCED,
        sketchNumber,
        sentences.length,
        avoidFramingIds,
        usedFramings,
      );
      usedFramings.add(framing.id);
      sentences.push({
        fragments: [sketchText(framing.text, language), sketchText(clause.text, language), stop],
        movementId: u.movementId,
        blockId: clause.id,
        variantId: framing.id,
      });
    });
  }

  const fragments = sentences.flatMap((s) => s.fragments);
  const text = capitalizeSketchOpening(fragments.join(''), language);
  // Opening capitalization is presentation-only for English; audit the raw
  // approved fragments, then accept the optional first-letter capital.
  const rawOk = text.length > 0 && fragments.every(isApprovedFragment);
  const audit: SketchV2Result['audit'] = rawOk ? 'PASSED' : 'FAILED';

  return {
    text,
    audit,
    engineVersion: SKETCH_V2_ENGINE_VERSION,
    provenance: {
      mode,
      movementIds: sentences.map((s) => s.movementId),
      blockIds: sentences.map((s) => s.blockId),
      variantIds: sentences.map((s) => s.variantId),
      deltaClasses,
      engineVersion: SKETCH_V2_ENGINE_VERSION,
      sessionId: session.id,
    },
  };
}

/**
 * Rebuild sketch body text from stored provenance in the requested language.
 * Used so a sketch generated in Chinese can display in English (and vice
 * versa) without changing selection or Behaviour Understanding.
 */
/**
 * Resolve the sketch body for the active UI language. Prefers a provenance
 * re-render when the stored language differs (so a Chinese-generated sketch
 * can show native English without regenerating selection).
 */
export function displaySketchText(
  sketch: { text: string; language: 'zh' | 'en'; provenance?: SketchProvenance },
  language: 'zh' | 'en',
): string {
  if (sketch.language === language) return sketch.text;
  if (sketch.provenance) {
    const rendered = renderSketchFromProvenance(sketch.provenance, language);
    if (rendered) return rendered;
  }
  return sketch.text;
}

export function renderSketchFromProvenance(
  provenance: SketchProvenance,
  language: 'zh' | 'en',
): string | null {
  const stop = sketchText(SKETCH_SENTENCE_STOP, language);
  const fragments: string[] = [];

  for (let i = 0; i < provenance.blockIds.length; i++) {
    const blockId = provenance.blockIds[i];
    const variantId = provenance.variantIds[i] ?? '';
    const clause = MOVEMENT_CLAUSES.find((c) => c.id === blockId);
    if (!clause) return null;

    if (provenance.mode === 'baseline') {
      const connective = sketchText(BASELINE_CONNECTIVES[i] ?? { zh: '', en: '' }, language);
      if (connective) fragments.push(connective);
      fragments.push(sketchText(clause.text, language), stop);
      continue;
    }

    const framing = ALL_FRAMINGS.find((f) => f.id === variantId);
    if (!framing) return null;
    fragments.push(sketchText(framing.text, language), sketchText(clause.text, language), stop);
  }

  if (!fragments.length || !fragments.every(isApprovedFragment)) return null;
  return capitalizeSketchOpening(fragments.join(''), language);
}
