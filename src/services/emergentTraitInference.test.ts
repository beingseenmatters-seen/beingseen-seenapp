import { describe, expect, it } from 'vitest';
import type { SessionPattern } from '../types/emergentTraits';
import { inferEmergentTraits, scoreSessionTrait, visibleEmergentTraits } from './emergentTraitInference';
import { getTraitDefinition } from '../data/emergentTraits';

function pattern(
  id: string,
  approvedAt: number,
  partial: Partial<SessionPattern> = {},
): SessionPattern {
  return {
    insightId: id,
    approvedAt,
    thinkingStyle: [],
    coreQuestions: [],
    worldview: [],
    relationshipPhilosophy: [],
    conversationStyle: [],
    thinkingPath: [],
    thinkingPathLength: 0,
    ...partial,
  };
}

describe('emergentTraitInference', () => {
  it('single session produces candidate only, never emergent', () => {
    const patterns = [
      pattern('s1', 1000, {
        thinkingStyle: ['philosophical_reasoning'],
        conversationStyle: ['chain_reasoning'],
        thinkingPath: ['loyalty', 'trust', 'systems'],
        thinkingPathLength: 3,
      }),
    ];
    const { traits } = inferEmergentTraits(patterns, 2000);
    const layered = traits.find(t => t.traitId === 'layered_inquiry');
    expect(layered).toBeDefined();
    expect(layered!.distinctSessions).toBe(1);
    expect(layered!.status).toBe('candidate');
    expect(visibleEmergentTraits(traits).find(t => t.traitId === 'layered_inquiry')).toBeUndefined();
  });

  it('promotes layered_inquiry to emergent then established across distinct sessions', () => {
    const base = {
      thinkingStyle: ['philosophical_reasoning'] as string[],
      conversationStyle: ['chain_reasoning', 'reflective_language'] as string[],
    };

    const two = inferEmergentTraits(
      [
        pattern('s1', 1000, base),
        pattern('s2', 2000, { ...base, thinkingStyle: ['abstract_analysis'] }),
      ],
      3000,
    );
    const atTwo = two.traits.find(t => t.traitId === 'layered_inquiry');
    expect(atTwo?.distinctSessions).toBe(2);
    expect(atTwo?.status).toBe('candidate');

    const four = inferEmergentTraits(
      [
        pattern('s1', 1000, base),
        pattern('s2', 2000, { ...base, thinkingStyle: ['abstract_analysis'] }),
        pattern('s3', 3000, { ...base, conversationStyle: ['layered_abstraction'] }),
        pattern('s4', 4000, { ...base, thinkingStyle: ['dialectical_reasoning'] }),
      ],
      5000,
    );
    const atFour = four.traits.find(t => t.traitId === 'layered_inquiry');
    expect(atFour?.distinctSessions).toBe(4);
    expect(atFour?.status).toBe('established');
    expect(atFour!.evidence.some(e => e.signal === 'philosophical_reasoning')).toBe(true);
    expect(atFour!.sourceInsightIds).toHaveLength(4);
  });

  it('many signals in one session still count as one observation', () => {
    const hit = scoreSessionTrait(
      pattern('s1', 1000, {
        thinkingStyle: ['philosophical_reasoning', 'abstract_analysis', 'dialectical_reasoning'],
        conversationStyle: ['chain_reasoning', 'layered_abstraction', 'reflective_language'],
      }),
      getTraitDefinition('layered_inquiry'),
    );
    expect(hit).not.toBeNull();
    const { traits } = inferEmergentTraits([pattern('s1', 1000, {
      thinkingStyle: ['philosophical_reasoning', 'abstract_analysis'],
      conversationStyle: ['chain_reasoning'],
    })]);
    expect(traits.find(t => t.traitId === 'layered_inquiry')?.distinctSessions).toBe(1);
  });

  it('aboutMe boost alone cannot create a session hit', () => {
    const { traits } = inferEmergentTraits([
      pattern('s1', 1000, {
        aboutMe: { valueTags: ['growth'], aspirationThemes: [], selfNarrativeTags: [], copingStyleTags: [], resonanceTags: [], emotionalNeeds: [] },
      }),
    ]);
    expect(traits.find(t => t.traitId === 'change_framing')).toBeUndefined();
  });

  it('marks dormant when not observed in recent window', () => {
    const shared = {
      thinkingStyle: ['philosophical_reasoning'] as string[],
      conversationStyle: ['chain_reasoning'] as string[],
    };
    const oldPatterns = Array.from({ length: 4 }, (_, i) =>
      pattern(`old-${i}`, i * 1000, shared),
    );
    const filler = Array.from({ length: 5 }, (_, i) =>
      pattern(`recent-${i}`, 5000 + i * 1000, { worldview: ['order_is_temporary'] }),
    );
    const { traits } = inferEmergentTraits([...oldPatterns, ...filler], 12000);
    const layered = traits.find(t => t.traitId === 'layered_inquiry');
    expect(layered?.distinctSessions).toBe(4);
    expect(layered?.status).toBe('dormant');
  });

  it('aboutMe prior is at most 0.03 when observed sessions exist', () => {
    const withBoost = inferEmergentTraits(
      [
        pattern('s1', 1000, {
          thinkingStyle: ['existential_inquiry'],
          worldview: ['meaning_must_be_built_not_received'],
          aboutMe: { valueTags: [], aspirationThemes: [], selfNarrativeTags: [], copingStyleTags: [], resonanceTags: ['meaning'], emotionalNeeds: [] },
        }),
        pattern('s2', 2000, {
          thinkingStyle: ['philosophical_reasoning'],
          worldview: ['meaning_must_be_built_not_received'],
        }),
      ],
      3000,
    );
    const withoutBoost = inferEmergentTraits(
      [
        pattern('s1', 1000, {
          thinkingStyle: ['existential_inquiry'],
          worldview: ['meaning_must_be_built_not_received'],
        }),
        pattern('s2', 2000, {
          thinkingStyle: ['philosophical_reasoning'],
          worldview: ['meaning_must_be_built_not_received'],
        }),
      ],
      3000,
    );
    const c1 = withBoost.traits.find(t => t.traitId === 'purpose_returning')!.confidence;
    const c0 = withoutBoost.traits.find(t => t.traitId === 'purpose_returning')!.confidence;
    expect(c1 - c0).toBeLessThanOrEqual(0.03 + 0.001);
  });

  it('recomputes idempotently from the same session set', () => {
    const patterns = [
      pattern('s1', 1000, {
        thinkingStyle: ['philosophical_reasoning'],
        conversationStyle: ['chain_reasoning'],
      }),
      pattern('s2', 2000, {
        thinkingStyle: ['abstract_analysis'],
        conversationStyle: ['reflective_language'],
      }),
      pattern('s3', 3000, {
        thinkingStyle: ['dialectical_reasoning'],
        conversationStyle: ['layered_abstraction'],
      }),
    ];
    const first = inferEmergentTraits(patterns, 4000);
    const second = inferEmergentTraits(patterns, 4000);
    expect(second.traits).toEqual(first.traits);
    expect(second.meta.insightCount).toBe(3);
  });
});
