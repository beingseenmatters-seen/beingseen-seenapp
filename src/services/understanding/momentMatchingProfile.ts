/**
 * Moment Matching Profile (Behaviour channel · first-touch).
 *
 * A compact, denormalized per-Movement vector derived from a user's durable
 * Moment Evidence. It is the ONLY Moment-side structure the matching engine
 * reads (server assembles resonance from it) — the raw evidence stays the SSOT.
 *
 * Independence (founder decision): this is the Behaviour channel. It never reads
 * or writes soulProfile / emergentTraits / matchReady. Reflect (Meaning channel)
 * and Moments (Behaviour channel) share only the Movement ontology.
 *
 * The aggregation mirrors the sketch engine's own cross-session math
 * (`combineBehaviourUnderstanding`: support = strength × mappingConfidence,
 * support-weighted direction, meanSupport) and reuses its `meaningful` bar so
 * matching and the user's sketch speak about the same Movements.
 */

import type { MovementId } from '../../data/understanding/movements';
import type { UnderstandingEvidence } from '../../types/evidence';
import { MEANINGFUL_SUPPORT, MIN_DIRECTION } from '../moments/sketchEngineV2';

/** Bumped when the profile shape or aggregation changes. Internal. */
export const MOMENT_PROFILE_VERSION = 'moment_profile_v1';

/**
 * Minimum meaningful Movements for a Moment profile to enter matching.
 * Internal / tunable — calibration is an implementation detail, per founder.
 */
export const MIN_MOMENT_MOVEMENTS = 2;

export interface MomentProfileMovement {
  movementId: MovementId;
  /** −1..1 support-weighted mean direction. */
  direction: number;
  /** 0..1 mean support (strength × mappingConfidence). */
  weight: number;
}

export interface MomentProfile {
  version: string;
  movements: MomentProfileMovement[];
  /** Count of meaningful movements (== movements.length). */
  meaningfulCount: number;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Build the Moment matching profile from durable Moment Evidence (all sessions,
 * all devices). Each evidence item is one per-session, per-Movement observation;
 * we combine them per Movement exactly as the sketch engine combines sessions.
 * Withdrawn/expired evidence is ignored.
 */
export function buildMomentProfileFromEvidence(
  evidence: UnderstandingEvidence[],
): MomentProfile {
  const byMovement = new Map<
    MovementId,
    { supportSum: number; directionWeighted: number; count: number }
  >();

  for (const ev of evidence) {
    if (!ev || ev.source !== 'moment') continue;
    if (ev.lifecycleStatus === 'withdrawn' || ev.lifecycleStatus === 'expired') continue;
    const movementId = ev.movementId as MovementId;
    const support = clamp(ev.strength ?? 0, 0, 1) * clamp(ev.mappingConfidence ?? 0, 0, 1);
    if (support <= 0) continue;

    const agg = byMovement.get(movementId) ?? { supportSum: 0, directionWeighted: 0, count: 0 };
    agg.supportSum += support;
    agg.directionWeighted += clamp(ev.direction ?? 0, -1, 1) * support;
    agg.count += 1;
    byMovement.set(movementId, agg);
  }

  const movements: MomentProfileMovement[] = [];
  for (const [movementId, agg] of byMovement) {
    if (agg.supportSum <= 0) continue;
    const direction = agg.directionWeighted / agg.supportSum;
    const meanSupport = agg.supportSum / agg.count;
    // Same "meaningful" bar the sketch uses — matching never surfaces a Movement
    // the user's own sketch wouldn't consider meaningful.
    if (meanSupport >= MEANINGFUL_SUPPORT && Math.abs(direction) >= MIN_DIRECTION) {
      movements.push({
        movementId,
        direction: clamp(direction, -1, 1),
        weight: Math.min(meanSupport, 1),
      });
    }
  }

  movements.sort((a, b) => a.movementId.localeCompare(b.movementId));
  return { version: MOMENT_PROFILE_VERSION, movements, meaningfulCount: movements.length };
}

/** Behaviour-channel readiness — Moments alone can make a user matchable. */
export function isMomentReady(profile: MomentProfile): boolean {
  return profile.meaningfulCount >= MIN_MOMENT_MOVEMENTS;
}
