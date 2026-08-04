/**
 * Moments → Evidence conversion (Section I, Phase 3A).
 *
 * Pure helpers that transform a COMPLETED, RETAINED Moment session into
 * Movement evidence. Evidence comes exclusively from:
 *  - the session's immutable Moment snapshots
 *  - the selected options and their approved Signal emissions
 *  - the central Signal-to-Movement mapping
 *
 * Evidence NEVER comes from reparsing the generated sketch prose.
 *
 * Semantics (founder decision 3):
 *  - completing and retaining a sketch permits the session's evidence
 *    (userConfirmed = session retention, not per-option approval)
 *  - one completed session is ONE source event, however many questions it has
 *  - deleting the sketch / clearing Moments data withdraws by sourceRef
 *
 * No Firestore writes; the caller owns persistence in a later phase.
 */

import type { MomentSnapshot, MomentsSession } from '../../types/moments';
import type { MomentSignalConfidence } from '../../types/moments';
import type { EvidenceContext, UnderstandingEvidence } from '../../types/evidence';
import { EVIDENCE_SCHEMA_VERSION } from '../../types/evidence';
import type { MovementId } from '../../data/understanding/movements';
import { MOVEMENT_TAXONOMY_VERSION } from '../../data/understanding/movements';
import {
  SIGNAL_MOVEMENT_MAP,
  SIGNAL_MOVEMENT_MAP_VERSION,
} from '../../data/understanding/signalMovementMap';
import { validateUnderstandingEvidence } from './validateEvidence';

/** Approved emission confidence → numeric confidence (internal only). */
const CONFIDENCE_VALUE: Record<MomentSignalConfidence, number> = {
  low: 0.3,
  medium: 0.6,
  high: 0.9,
};

export interface MomentMovementAggregate {
  movementId: MovementId;
  /** −1..1 — weighted mean direction across contributions. */
  direction: number;
  /** 0..1 — mean contribution magnitude. */
  strength: number;
  /** 0..1 — mean emission/mapping reliability of contributions. */
  mappingConfidence: number;
  /** Number of signal contributions folded into this aggregate. */
  contributionCount: number;
  /** Distinct signal IDs that contributed (for audit; never user-facing). */
  signalIds: string[];
  contextOverrides?: Partial<EvidenceContext>;
}

interface Contribution {
  movementId: MovementId;
  /** delta × directionMultiplier × strengthMultiplier, sign carries direction. */
  value: number;
  confidence: number;
  signalId: string;
  contextOverrides?: Partial<EvidenceContext>;
}

function collectContributions(session: MomentsSession): Contribution[] {
  const contributions: Contribution[] = [];

  for (const momentId of session.momentIds) {
    const answer = session.answers[momentId];
    if (!answer) continue;
    const snapshot: MomentSnapshot | undefined = session.snapshots.find(
      (s) => s.momentId === momentId,
    );
    if (!snapshot) continue;

    for (const optionId of answer.selectedOptionIds) {
      const option = snapshot.options.find((o) => o.id === optionId);
      if (!option) continue;

      for (const emission of option.signals) {
        for (const mapping of SIGNAL_MOVEMENT_MAP) {
          if (mapping.signalId !== emission.signal) continue;
          contributions.push({
            movementId: mapping.movementId,
            value: emission.delta * mapping.directionMultiplier * mapping.strengthMultiplier,
            confidence: CONFIDENCE_VALUE[emission.confidence] ?? 0.3,
            signalId: emission.signal,
            contextOverrides: mapping.contextOverrides,
          });
        }
      }
    }
  }

  return contributions;
}

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/**
 * Deterministically aggregate one completed session's signal emissions into
 * per-Movement observations. Repeated signals within the session reinforce
 * one aggregate — they are never treated as independent events.
 */
export function aggregateMomentSessionEvidence(
  session: MomentsSession,
): MomentMovementAggregate[] {
  const byMovement = new Map<MovementId, Contribution[]>();
  for (const contribution of collectContributions(session)) {
    const list = byMovement.get(contribution.movementId) ?? [];
    list.push(contribution);
    byMovement.set(contribution.movementId, list);
  }

  const aggregates: MomentMovementAggregate[] = [];
  for (const [movementId, list] of byMovement) {
    const signedSum = list.reduce((s, c) => s + c.value, 0);
    const magnitude = list.reduce((s, c) => s + Math.abs(c.value), 0);
    if (magnitude === 0) continue;

    const overrides = list.find((c) => c.contextOverrides)?.contextOverrides;
    aggregates.push({
      movementId,
      direction: clamp(signedSum / magnitude, -1, 1),
      strength: clamp(magnitude / list.length, 0, 1),
      mappingConfidence: clamp(list.reduce((s, c) => s + c.confidence, 0) / list.length, 0, 1),
      contributionCount: list.length,
      signalIds: [...new Set(list.map((c) => c.signalId))].sort(),
      contextOverrides: overrides,
    });
  }

  // Deterministic output order.
  return aggregates.sort((a, b) => a.movementId.localeCompare(b.movementId));
}

export interface CreateMomentEvidenceParams {
  userId: string;
  /** Injected reference time (ISO). */
  now: string;
}

/**
 * Convert a completed, retained session into active Movement evidence.
 * IDs are deterministic (`ev_moment_{sessionId}_{movementId}`) so repeated
 * conversion never produces duplicate evidence — an upsert by id is a no-op.
 */
export function createMomentEvidenceFromSession(
  session: MomentsSession,
  params: CreateMomentEvidenceParams,
): UnderstandingEvidence[] {
  if (session.status !== 'completed' || !session.sketch) {
    throw new Error('Moment evidence requires a completed, retained session');
  }

  const observedAt = new Date(session.completedAt ?? session.updatedAt).toISOString();

  const evidence = aggregateMomentSessionEvidence(session).map(
    (aggregate): UnderstandingEvidence => ({
      id: `ev_moment_${session.id}_${aggregate.movementId}`,
      schemaVersion: EVIDENCE_SCHEMA_VERSION,
      userId: params.userId,
      source: 'moment',
      // One session = one source event; every aggregate shares the sourceRef.
      sourceRef: session.id,
      sourceVersion: {
        contentVersion: session.sketch?.engineVersion,
        mappingVersion: SIGNAL_MOVEMENT_MAP_VERSION,
        taxonomyVersion: MOVEMENT_TAXONOMY_VERSION,
      },
      movementId: aggregate.movementId,
      direction: aggregate.direction,
      strength: aggregate.strength,
      mappingConfidence: aggregate.mappingConfidence,
      context: {
        // Moments observe reactions to everyday scenes; per-Moment context
        // refinement can come with a richer content schema later.
        domain: 'daily_life',
        ...aggregate.contextOverrides,
      },
      // A single session is a situational sample, never a repeated pattern.
      temporalScope: 'situational',
      observedAt,
      createdAt: params.now,
      updatedAt: params.now,
      // Represents completion/retention of the session (founder decision 3).
      userConfirmed: true,
      lifecycleStatus: 'active',
      privacyLevel: 'private',
      // No evidenceText: sketch prose must never be parsed back into evidence.
      metadata: {
        momentVersions: session.momentVersions,
        contributionCount: aggregate.contributionCount,
        signalIds: aggregate.signalIds,
      },
    }),
  );

  for (const item of evidence) {
    const problems = validateUnderstandingEvidence(item);
    if (problems.length) {
      throw new Error(`Invalid moment evidence (${item.movementId}): ${problems.join('; ')}`);
    }
  }

  return evidence;
}
