/**
 * Moment pipeline — developer observability (NOT a user feature).
 *
 * Captures the ENTIRE Behaviour pipeline for a user's completed sessions in one
 * structured object, so a future audit never has to reconstruct it by hand:
 *
 *   Moment Session → Moment Signals → Movement Mapping → Moment Evidence
 *     → momentProfile → momentReady → Matching Eligibility
 *
 * Gated OFF by default. Enable in a developer's own browser only:
 *   localStorage.setItem('seen_dev_moment_diagnostics', '1')
 * When enabled, a snapshot is logged on every sync and stashed on
 * `window.seenMomentDiagnostics` for console inspection. Production users never
 * see it. Reads only; never persists, never affects matching.
 */

import type { MomentsSession } from '../../types/moments';
import { SIGNAL_MOVEMENT_MAP } from '../../data/understanding/signalMovementMap';
import {
  aggregateMomentSessionEvidence,
  createMomentEvidenceFromSession,
} from './momentEvidence';
import {
  isMomentReady,
  MIN_MOMENT_MOVEMENTS,
  type MomentProfile,
} from './momentMatchingProfile';
import { MEANINGFUL_SUPPORT, MIN_DIRECTION } from '../moments/sketchEngineV2';

const MOMENT_DIAGNOSTICS_FLAG = 'seen_dev_moment_diagnostics';

export interface MomentSessionDiagnostics {
  sessionId: string;
  completedAt: number | null;
  momentIds: string[];
  /** Stage 1→2: the approved Signal emissions of the options the user chose. */
  signals: Array<{ momentId: string; optionId: string; signal: string; delta: number; confidence: string }>;
  /** Stage 2→3: the Signal→Movement mappings those emissions triggered. */
  mappings: Array<{ signal: string; movementId: string; directionMultiplier: number; strengthMultiplier: number }>;
  /** Stage 3: per-session Movement aggregates. */
  aggregates: ReturnType<typeof aggregateMomentSessionEvidence>;
  /** Stage 4: durable Moment Evidence produced (compact). */
  evidence: Array<{ id: string; movementId: string; direction: number; strength: number; mappingConfidence: number }>;
}

export interface MomentPipelineDiagnostics {
  generatedAt: string;
  uid: string | null;
  sessions: MomentSessionDiagnostics[];
  /** Stage 5: cross-session profile (as written to Firestore). */
  momentProfile: MomentProfile;
  /** Stage 6. */
  momentReady: boolean;
  /**
   * Stage 7: this user's Behaviour-channel matching eligibility. The server's
   * final gate is `momentEligible OR reflectEligible` — this is the Moment half.
   */
  matchingEligible: boolean;
  thresholds: { meaningfulSupport: number; minDirection: number; minMovements: number };
}

export function isMomentDiagnosticsEnabled(): boolean {
  try {
    return typeof localStorage !== 'undefined' && localStorage.getItem(MOMENT_DIAGNOSTICS_FLAG) === '1';
  } catch {
    return false;
  }
}

/**
 * Build the full pipeline snapshot. Pure; reads the same session data + mapping
 * the runtime uses. `profile` is the cross-session profile actually written
 * (built from durable evidence), so stages 5–7 match what matching sees.
 */
export function buildMomentPipelineDiagnostics(
  uid: string | null,
  sessions: MomentsSession[],
  profile: MomentProfile,
): MomentPipelineDiagnostics {
  const now = new Date(Date.now()).toISOString();
  const retained = sessions.filter((s) => s.status === 'completed' && s.sketch);

  const sessionDiagnostics: MomentSessionDiagnostics[] = retained.map((session) => {
    const signals: MomentSessionDiagnostics['signals'] = [];
    for (const momentId of session.momentIds) {
      const answer = session.answers[momentId];
      if (!answer) continue;
      const snapshot = session.snapshots.find((s) => s.momentId === momentId);
      if (!snapshot) continue;
      for (const optionId of answer.selectedOptionIds) {
        const option = snapshot.options.find((o) => o.id === optionId);
        if (!option) continue;
        for (const emission of option.signals) {
          signals.push({
            momentId,
            optionId,
            signal: emission.signal,
            delta: emission.delta,
            confidence: emission.confidence,
          });
        }
      }
    }

    const emittedSignals = new Set(signals.map((s) => s.signal));
    const mappings = SIGNAL_MOVEMENT_MAP.filter((m) => emittedSignals.has(m.signalId)).map((m) => ({
      signal: m.signalId,
      movementId: m.movementId,
      directionMultiplier: m.directionMultiplier,
      strengthMultiplier: m.strengthMultiplier,
    }));

    const evidence = createMomentEvidenceFromSession(session, { userId: uid ?? 'unknown', now }).map(
      (ev) => ({
        id: ev.id,
        movementId: ev.movementId,
        direction: ev.direction,
        strength: ev.strength,
        mappingConfidence: ev.mappingConfidence ?? 0,
      }),
    );

    return {
      sessionId: session.id,
      completedAt: session.completedAt ?? null,
      momentIds: session.momentIds,
      signals,
      mappings,
      aggregates: aggregateMomentSessionEvidence(session),
      evidence,
    };
  });

  return {
    generatedAt: now,
    uid,
    sessions: sessionDiagnostics,
    momentProfile: profile,
    momentReady: isMomentReady(profile),
    matchingEligible: profile.meaningfulCount >= MIN_MOMENT_MOVEMENTS,
    thresholds: {
      meaningfulSupport: MEANINGFUL_SUPPORT,
      minDirection: MIN_DIRECTION,
      minMovements: MIN_MOMENT_MOVEMENTS,
    },
  };
}

/** Log + stash the pipeline snapshot when developer diagnostics are enabled. No-op otherwise. */
export function logMomentPipelineDiagnostics(
  uid: string | null,
  sessions: MomentsSession[],
  profile: MomentProfile,
): void {
  if (!isMomentDiagnosticsEnabled()) return;
  try {
    const diagnostics = buildMomentPipelineDiagnostics(uid, sessions, profile);
    console.log('[MomentDiagnostics] pipeline snapshot', diagnostics);
    if (typeof window !== 'undefined') {
      (window as unknown as { seenMomentDiagnostics?: unknown }).seenMomentDiagnostics = diagnostics;
    }
  } catch (err) {
    console.warn('[MomentDiagnostics] snapshot failed:', err);
  }
}
