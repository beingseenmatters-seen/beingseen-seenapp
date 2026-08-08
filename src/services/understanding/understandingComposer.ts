/**
 * Understanding Composer — pure, deterministic, evidence-grounded.
 *
 * compose(reflectInsights, momentEvidence) → CurrentUnderstanding (3 facets).
 * No I/O, no LLM, no randomness — the same evidence always yields the same
 * understanding (required by the derived-cache/rebuild model). Reads durable
 * evidence only; never reads or writes emergentTraits / matchReady / Matching.
 *
 * Evolution is built in via recency-weighting: recent evidence dominates, old
 * evidence decays, and a movement whose net direction is pulled toward zero by
 * contradiction simply stops being surfaced (soften → drop), rather than
 * asserting a stale claim.
 */

import type { SessionInsight } from '../../types/userSummary';
import type { UnderstandingEvidence } from '../../types/evidence';
import type { MovementId } from '../../data/understanding/movements';
import { reflectMappingsForSlug } from '../../data/understanding/reflectSlugMovementMap';
import {
  ANALYTICAL_WORLDVIEW_SLUGS,
  CURRENT_UNDERSTANDING_VERSION,
  MOVEMENT_FACET,
  emptyCurrentUnderstanding,
  type CurrentUnderstanding,
  type EvidenceChannel,
  type FacetId,
  type UnderstandingConfidence,
  type UnderstandingItem,
} from './currentUnderstanding';

// --- Tunable, internal calibration (never surfaced) -------------------------
const HALF_LIFE_DAYS = 120; // ~4 months → 6-month-old evidence weighs ~¼
const DAY_MS = 86_400_000;
const MIN_DIRECTION = 0.35; // a movement pulled below this by contradiction is not surfaced
const MIN_WEIGHT = 0.12; // a signal below this is not yet part of "today's" understanding
const CLEAR_WEIGHT = 0.6;
const EMERGING_WEIGHT = 0.3;

function clamp(n: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, n));
}

/** Recency weight in (0,1]: 1 for now, halving every HALF_LIFE_DAYS. */
function recency(ts: number, now: number): number {
  const ageDays = Math.max(0, (now - ts) / DAY_MS);
  return Math.pow(0.5, ageDays / HALF_LIFE_DAYS);
}

/** Saturating support → 0..1 ranking weight (diminishing returns). */
function saturate(supportSum: number): number {
  return clamp(supportSum / (supportSum + 1), 0, 1);
}

function band(weight: number, channels: EvidenceChannel[], count: number): UnderstandingConfidence {
  if (weight >= CLEAR_WEIGHT && (channels.length >= 2 || count >= 3)) return 'clear';
  if (weight >= EMERGING_WEIGHT) return 'emerging';
  return 'forming';
}

interface Contribution {
  direction: number;
  support: number; // pre-recency
  ts: number;
  channel: EvidenceChannel;
}

/** Compose the current understanding from durable evidence. `now` is injected. */
export function composeCurrentUnderstanding(input: {
  reflectInsights: SessionInsight[];
  momentEvidence: UnderstandingEvidence[];
  now: number;
}): CurrentUnderstanding {
  const { reflectInsights, momentEvidence, now } = input;
  const cu = emptyCurrentUnderstanding();
  cu.version = CURRENT_UNDERSTANDING_VERSION;
  cu.generatedAt = now;

  // === Movement facets (Behaviour + Meaning): Moments ∪ mapped Reflect slugs ===
  const byMovement = new Map<MovementId, Contribution[]>();
  const addMovement = (movementId: MovementId, c: Contribution) => {
    const list = byMovement.get(movementId) ?? [];
    list.push(c);
    byMovement.set(movementId, list);
  };

  let momentMovementCount = 0;
  for (const ev of momentEvidence) {
    if (!ev || ev.source !== 'moment') continue;
    if (ev.lifecycleStatus === 'withdrawn' || ev.lifecycleStatus === 'expired') continue;
    const support = clamp(ev.strength ?? 0, 0, 1) * clamp(ev.mappingConfidence ?? 0, 0, 1);
    if (support <= 0) continue;
    momentMovementCount += 1;
    addMovement(ev.movementId as MovementId, {
      direction: clamp(ev.direction ?? 0, -1, 1),
      support,
      ts: Date.parse(ev.observedAt || ev.createdAt || '') || now,
      channel: 'moment',
    });
  }

  for (const insight of reflectInsights) {
    const ts = insight.approvedAt ?? insight.createdAt ?? now;
    const slugs = [...(insight.relationshipPhilosophy ?? []), ...(insight.worldview ?? [])];
    for (const slug of slugs) {
      for (const m of reflectMappingsForSlug(slug)) {
        addMovement(m.movementId, {
          direction: m.directionMultiplier,
          support: m.strengthMultiplier,
          ts,
          channel: 'reflect',
        });
      }
    }
  }

  for (const [movementId, contributions] of byMovement) {
    const weighted = contributions.map((c) => ({ ...c, w: c.support * recency(c.ts, now) }));
    const wSum = weighted.reduce((s, c) => s + c.w, 0);
    if (wSum <= 0) continue;
    const direction = clamp(weighted.reduce((s, c) => s + c.direction * c.w, 0) / wSum, -1, 1);
    if (Math.abs(direction) < MIN_DIRECTION) continue; // in flux / contradicted → soften-to-drop
    const weight = saturate(wSum);
    if (weight < MIN_WEIGHT) continue;
    const channels = [...new Set(contributions.map((c) => c.channel))];
    cu.facets[MOVEMENT_FACET[movementId]].items.push({
      facet: MOVEMENT_FACET[movementId],
      key: movementId,
      representation: 'movement',
      direction,
      weight,
      confidence: band(weight, channels, contributions.length),
      channels,
      lastReinforcedAt: Math.max(...contributions.map((c) => c.ts)),
    });
  }

  // === Thinking facet: Reflect cognitive slugs (Reflect-only, no Movement) ===
  const byThinkingSlug = new Map<string, { ts: number[]; }>();
  const addThinking = (slug: string, ts: number) => {
    const e = byThinkingSlug.get(slug) ?? { ts: [] };
    e.ts.push(ts);
    byThinkingSlug.set(slug, e);
  };
  for (const insight of reflectInsights) {
    const ts = insight.approvedAt ?? insight.createdAt ?? now;
    for (const slug of insight.thinkingStyle ?? []) addThinking(slug, ts);
    for (const slug of insight.conversationStyle ?? []) addThinking(slug, ts);
    for (const slug of insight.coreQuestions ?? []) addThinking(slug, ts);
    for (const slug of insight.worldview ?? []) {
      if (ANALYTICAL_WORLDVIEW_SLUGS.has(slug)) addThinking(slug, ts);
    }
  }
  for (const [slug, e] of byThinkingSlug) {
    const wSum = e.ts.reduce((s, ts) => s + recency(ts, now), 0);
    const weight = saturate(wSum);
    if (weight < MIN_WEIGHT) continue;
    cu.facets.thinking.items.push({
      facet: 'thinking',
      key: slug,
      representation: 'reflect_signal',
      direction: 1,
      weight,
      confidence: band(weight, ['reflect'], e.ts.length),
      channels: ['reflect'],
      lastReinforcedAt: Math.max(...e.ts),
    });
  }

  // Rank each facet: strongest, then most recently reinforced.
  const rank = (a: UnderstandingItem, b: UnderstandingItem) =>
    b.weight - a.weight || b.lastReinforcedAt - a.lastReinforcedAt;
  (Object.keys(cu.facets) as FacetId[]).forEach((f) => cu.facets[f].items.sort(rank));

  cu.evidenceRef = { reflectInsightCount: reflectInsights.length, momentMovementCount };
  return cu;
}
