import {
  ABOUT_ME_PRIOR_MAX,
  getInferenceThresholdForTrait,
  RECENT_OBSERVATION_WINDOW,
  TAXONOMY_VERSION,
  TRAIT_DEFINITIONS,
} from '../data/emergentTraits';
import type {
  EmergentTrait,
  SessionPattern,
  SessionTraitHit,
  TraitDefinition,
  TraitEvidenceHit,
  TraitId,
  TraitInferenceMeta,
  TraitSignalRule,
  TraitStatus,
  TraitTrajectory,
} from '../types/emergentTraits';
import { getPatternValues, recentPatterns } from './sessionPattern';

const EVIDENCE_CAP = 20;

function matchesSignal(values: string[], signal: string): boolean {
  if (signal === '*') return values.length > 0;
  return values.includes(signal);
}

function countRuleHits(
  pattern: SessionPattern,
  rules: TraitSignalRule[],
  boostOnly: boolean,
): { count: number; hits: TraitEvidenceHit[] } {
  const hits: TraitEvidenceHit[] = [];
  let count = 0;

  for (const rule of rules) {
    if (Boolean(rule.boostOnly) !== boostOnly) continue;
    const values = getPatternValues(pattern, rule.source);
    for (const signal of rule.signals) {
      if (matchesSignal(values, signal)) {
        count += 1;
        hits.push({
          source: rule.source,
          signal: signal === '*' ? values[0] ?? '*' : signal,
          insightId: pattern.insightId,
          approvedAt: pattern.approvedAt,
        });
        break;
      }
    }
  }

  return { count, hits };
}

function passesComposite(pattern: SessionPattern, def: TraitDefinition): boolean {
  const composite = def.composite;
  if (!composite) return true;
  if (composite.thinkingPathMinLength != null && pattern.thinkingPathLength < composite.thinkingPathMinLength) {
    return false;
  }
  if (composite.coreQuestionsMinCount != null && pattern.coreQuestions.length < composite.coreQuestionsMinCount) {
    return false;
  }
  return true;
}

export function scoreSessionTrait(pattern: SessionPattern, def: TraitDefinition): SessionTraitHit | null {
  if (!passesComposite(pattern, def)) return null;

  const observedRules = def.rules.filter(r => !r.boostOnly);
  const { count: observedHitCount, hits: observedHits } = countRuleHits(pattern, def.rules, false);
  const { count: boostCount } = countRuleHits(pattern, def.rules, true);

  const minObserved = getInferenceThresholdForTrait(def.id).minObservedHitsPerSession;
  if (observedHitCount < minObserved) return null;

  const observedStrength = observedRules.length > 0
    ? Math.min(1, observedHitCount / Math.min(observedRules.length, 3))
    : 0;

  return {
    traitId: def.id,
    insightId: pattern.insightId,
    approvedAt: pattern.approvedAt,
    observedHitCount,
    observedStrength,
    boostMatched: boostCount > 0,
    evidence: observedHits,
  };
}

export function scoreAllSessionTraits(pattern: SessionPattern): SessionTraitHit[] {
  return TRAIT_DEFINITIONS.map(def => scoreSessionTrait(pattern, def)).filter(
    (hit): hit is SessionTraitHit => hit !== null,
  );
}

function clamp(n: number, min: number, max: number): number {
  return Math.max(min, Math.min(max, n));
}

function computeConfidence(
  distinctSessions: number,
  totalInsights: number,
  meanStrength: number,
  aboutMePrior: number,
): number {
  const recurrence = distinctSessions / Math.max(totalInsights, 1);
  return clamp(0.12 + 0.6 * recurrence + 0.28 * meanStrength + aboutMePrior, 0, 1);
}

function resolveStatus(
  distinctSessions: number,
  recentSessions: number,
  confidence: number,
  def: TraitDefinition,
): TraitStatus {
  const { sessionsRequired, emergentFloor, establishedFloor } = getInferenceThresholdForTrait(def.id);

  if (recentSessions === 0 && distinctSessions > 0) return 'dormant';
  if (distinctSessions === 0) return 'dormant';
  if (distinctSessions === 1) return 'candidate';
  if (distinctSessions < sessionsRequired) return 'candidate';

  if (confidence >= establishedFloor) return 'established';
  if (confidence >= emergentFloor) return 'emergent';
  return 'candidate';
}

function computeTrajectory(sessionHits: SessionTraitHit[]): TraitTrajectory {
  if (sessionHits.length < 2) return 'stable';
  const sorted = sessionHits.slice().sort((a, b) => a.approvedAt - b.approvedAt);
  const last = sorted[sorted.length - 1].observedStrength;
  const prior = sorted.slice(0, -1).reduce((s, h) => s + h.observedStrength, 0) / (sorted.length - 1);
  return last > prior + 0.08 ? 'rising' : 'stable';
}

export interface InferEmergentTraitsResult {
  traits: EmergentTrait[];
  meta: TraitInferenceMeta;
}

export function inferEmergentTraits(
  patterns: SessionPattern[],
  now: number = Date.now(),
): InferEmergentTraitsResult {
  const totalInsights = patterns.length;
  const recent = recentPatterns(patterns, RECENT_OBSERVATION_WINDOW);
  const recentIds = new Set(recent.map(p => p.insightId));

  const hitsByTrait = new Map<TraitId, SessionTraitHit[]>();

  for (const pattern of patterns) {
    for (const hit of scoreAllSessionTraits(pattern)) {
      const list = hitsByTrait.get(hit.traitId) ?? [];
      list.push(hit);
      hitsByTrait.set(hit.traitId, list);
    }
  }

  const traits: EmergentTrait[] = [];

  for (const def of TRAIT_DEFINITIONS) {
    const sessionHits = hitsByTrait.get(def.id) ?? [];
    if (sessionHits.length === 0) continue;

    const distinctSessions = sessionHits.length;
    const recentSessions = sessionHits.filter(h => recentIds.has(h.insightId)).length;
    const meanStrength =
      sessionHits.reduce((s, h) => s + h.observedStrength, 0) / distinctSessions;

    const aboutMePrior =
      distinctSessions >= 1 && sessionHits.some(h => h.boostMatched)
        ? ABOUT_ME_PRIOR_MAX
        : 0;

    const confidence = computeConfidence(distinctSessions, totalInsights, meanStrength, aboutMePrior);
    const status = resolveStatus(distinctSessions, recentSessions, confidence, def);

    const allEvidence = sessionHits.flatMap(h => h.evidence);
    const sourceInsightIds = [...new Set(sessionHits.map(h => h.insightId))].sort(
      (a, b) =>
        (sessionHits.find(h => h.insightId === a)?.approvedAt ?? 0) -
        (sessionHits.find(h => h.insightId === b)?.approvedAt ?? 0),
    );

    const approvedTimes = sessionHits.map(h => h.approvedAt);

    traits.push({
      traitId: def.id,
      status,
      confidence,
      distinctSessions,
      trajectory: computeTrajectory(sessionHits),
      inferenceLevel: def.inferenceLevel,
      matchingEligible: def.matchingEligible,
      firstSeenAt: Math.min(...approvedTimes),
      lastReinforcedAt: Math.max(...approvedTimes),
      sourceInsightIds,
      evidence: allEvidence.slice(-EVIDENCE_CAP),
      taxonomyVersion: TAXONOMY_VERSION,
    });
  }

  traits.sort((a, b) => b.confidence - a.confidence || a.traitId.localeCompare(b.traitId));

  return {
    traits,
    meta: {
      taxonomyVersion: TAXONOMY_VERSION,
      insightCount: totalInsights,
      updatedAt: now,
    },
  };
}

/** User-visible traits only (excludes internal candidates). */
export function visibleEmergentTraits(traits: EmergentTrait[]): EmergentTrait[] {
  return traits.filter(t => t.status !== 'candidate');
}
