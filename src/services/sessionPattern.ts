import type { AboutMeSignals } from '../auth/providers/types';
import type { SessionInsight } from '../types/userSummary';
import type { SessionPattern } from '../types/emergentTraits';

export function insightToSessionPattern(
  insight: SessionInsight,
  aboutMe?: AboutMeSignals,
): SessionPattern {
  return {
    insightId: insight.id,
    approvedAt: insight.approvedAt,
    thinkingStyle: insight.thinkingStyle ?? [],
    coreQuestions: insight.coreQuestions ?? [],
    worldview: insight.worldview ?? [],
    relationshipPhilosophy: insight.relationshipPhilosophy ?? [],
    conversationStyle: insight.conversationStyle ?? [],
    thinkingPath: insight.thinkingPath ?? [],
    thinkingPathLength: (insight.thinkingPath ?? []).length,
    aboutMe: aboutMe
      ? {
          valueTags: aboutMe.valueTags,
          aspirationThemes: aboutMe.aspirationThemes,
          selfNarrativeTags: aboutMe.selfNarrativeTags,
          copingStyleTags: aboutMe.copingStyleTags,
          resonanceTags: aboutMe.resonanceTags,
          emotionalNeeds: aboutMe.emotionalNeeds,
        }
      : undefined,
  };
}

export function buildSessionPatterns(
  insights: SessionInsight[],
  aboutMe?: AboutMeSignals,
): SessionPattern[] {
  return insights
    .slice()
    .sort((a, b) => a.approvedAt - b.approvedAt)
    .map(insight => insightToSessionPattern(insight, aboutMe));
}

/** Last N patterns by approval time (most recent). */
export function recentPatterns(patterns: SessionPattern[], windowSize: number): SessionPattern[] {
  if (patterns.length <= windowSize) return patterns;
  return patterns.slice(-windowSize);
}

export function getPatternValues(pattern: SessionPattern, source: string): string[] {
  switch (source) {
    case 'thinkingStyle':
      return pattern.thinkingStyle;
    case 'coreQuestions':
      return pattern.coreQuestions;
    case 'worldview':
      return pattern.worldview;
    case 'relationshipPhilosophy':
      return pattern.relationshipPhilosophy;
    case 'conversationStyle':
      return pattern.conversationStyle;
    case 'thinkingPath':
      return pattern.thinkingPath;
    case 'aboutMe.valueTags':
      return pattern.aboutMe?.valueTags ?? [];
    case 'aboutMe.aspirationThemes':
      return pattern.aboutMe?.aspirationThemes ?? [];
    case 'aboutMe.selfNarrativeTags':
      return pattern.aboutMe?.selfNarrativeTags ?? [];
    case 'aboutMe.copingStyleTags':
      return pattern.aboutMe?.copingStyleTags ?? [];
    case 'aboutMe.resonanceTags':
      return pattern.aboutMe?.resonanceTags ?? [];
    case 'aboutMe.emotionalNeeds':
      return pattern.aboutMe?.emotionalNeeds ?? [];
    default:
      return [];
  }
}
