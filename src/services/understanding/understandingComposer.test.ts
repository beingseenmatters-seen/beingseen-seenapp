/**
 * Understanding Composer — deterministic engine.
 */
import { describe, expect, it } from 'vitest';
import { composeCurrentUnderstanding } from './understandingComposer';
import type { SessionInsight } from '../../types/userSummary';
import type { UnderstandingEvidence } from '../../types/evidence';

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

function insight(ts: number, over: Partial<SessionInsight>): SessionInsight {
  return {
    id: `i_${ts}_${Math.abs(ts)}`,
    source: 'reflect',
    approvedByUser: true,
    createdAt: ts,
    approvedAt: ts,
    summaryText: '',
    thinkingStyle: [],
    coreQuestions: [],
    worldview: [],
    relationshipPhilosophy: [],
    conversationStyle: [],
    thinkingPath: [],
    ...over,
  } as SessionInsight;
}

function mev(movementId: string, direction: number, ts: number, over: Partial<UnderstandingEvidence> = {}): UnderstandingEvidence {
  return {
    id: `ev_${movementId}_${ts}`,
    source: 'moment',
    movementId,
    direction,
    strength: 0.8,
    mappingConfidence: 0.9,
    lifecycleStatus: 'active',
    observedAt: new Date(ts).toISOString(),
    createdAt: new Date(ts).toISOString(),
    ...over,
  } as unknown as UnderstandingEvidence;
}

const find = <T extends { key: string }>(items: T[], key: string): T | undefined =>
  items.find((i) => i.key === key);

describe('facet routing', () => {
  it('routes Moment movements + mapped Reflect slugs + cognitive slugs to the right facets', () => {
    const cu = composeCurrentUnderstanding({
      now: NOW,
      momentEvidence: [mev('direct_expression', 0.8, NOW), mev('meaning_orientation', 0.7, NOW)],
      reflectInsights: [
        insight(NOW, {
          relationshipPhilosophy: ['reciprocity_keeps_bonds_alive'], // → relationship_preservation (behaviour)
          worldview: ['meaning_must_be_built_not_received', 'systems_follow_incentives'], // → meaning_orientation + thinking
          thinkingStyle: ['systems_thinking', 'philosophical_reasoning'],
        }),
      ],
    });

    expect(find(cu.facets.behaviour.items, 'direct_expression')).toBeDefined();
    expect(find(cu.facets.behaviour.items, 'relationship_preservation')).toBeDefined();
    expect(find(cu.facets.meaning.items, 'meaning_orientation')).toBeDefined();
    expect(find(cu.facets.thinking.items, 'systems_thinking')).toBeDefined();
    // analytical worldview → Thinking, never Meaning/Behaviour
    expect(find(cu.facets.thinking.items, 'systems_follow_incentives')).toBeDefined();
    expect(find(cu.facets.meaning.items, 'systems_follow_incentives')).toBeUndefined();
  });
});

describe('cross-channel reinforcement (merge, not duplicate)', () => {
  it('the same movement from both channels becomes ONE item with both channels', () => {
    const cu = composeCurrentUnderstanding({
      now: NOW,
      momentEvidence: [mev('relationship_preservation', 0.8, NOW), mev('relationship_preservation', 0.7, NOW - DAY)],
      reflectInsights: [insight(NOW, { relationshipPhilosophy: ['reciprocity_keeps_bonds_alive'] })],
    });
    const items = cu.facets.behaviour.items.filter((i) => i.key === 'relationship_preservation');
    expect(items).toHaveLength(1); // never two
    expect([...items[0].channels].sort()).toEqual(['moment', 'reflect']);
    expect(items[0].confidence).toBe('clear'); // both channels + reinforced
  });
});

describe('contradiction — recency wins, softens to drop when balanced', () => {
  it('recent contradicting evidence flips the surfaced direction', () => {
    const cu = composeCurrentUnderstanding({
      now: NOW,
      momentEvidence: [mev('direct_expression', 0.9, NOW - 400 * DAY), mev('direct_expression', -0.9, NOW)],
      reflectInsights: [],
    });
    const it0 = find(cu.facets.behaviour.items, 'direct_expression');
    expect(it0).toBeDefined();
    expect(it0!.direction).toBeLessThan(0); // recent negative dominates the old positive
  });

  it('evenly contradicted (both recent) is not surfaced as a confident claim', () => {
    const cu = composeCurrentUnderstanding({
      now: NOW,
      momentEvidence: [mev('direct_expression', 0.9, NOW), mev('direct_expression', -0.9, NOW)],
      reflectInsights: [],
    });
    expect(find(cu.facets.behaviour.items, 'direct_expression')).toBeUndefined(); // net ~0 → dropped
  });
});

describe('recency decay', () => {
  it('old-only evidence weighs less than recent-only', () => {
    const recent = composeCurrentUnderstanding({ now: NOW, momentEvidence: [mev('boundary_preservation', 0.8, NOW)], reflectInsights: [] });
    const old = composeCurrentUnderstanding({ now: NOW, momentEvidence: [mev('boundary_preservation', 0.8, NOW - 400 * DAY)], reflectInsights: [] });
    const wR = find(recent.facets.behaviour.items, 'boundary_preservation')!.weight;
    const wO = find(old.facets.behaviour.items, 'boundary_preservation')?.weight ?? 0;
    expect(wR).toBeGreaterThan(wO);
  });
});

describe('determinism', () => {
  it('same evidence → identical understanding', () => {
    const input = {
      now: NOW,
      momentEvidence: [mev('direct_expression', 0.8, NOW), mev('meaning_orientation', 0.7, NOW - DAY)],
      reflectInsights: [insight(NOW, { thinkingStyle: ['systems_thinking'], worldview: ['meaning_must_be_built_not_received'] })],
    };
    expect(composeCurrentUnderstanding(input)).toEqual(composeCurrentUnderstanding(input));
  });
});
