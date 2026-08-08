/**
 * Letter assembler — the hard voice/length rules, plus rendered examples.
 */
import { describe, expect, it } from 'vitest';
import { composeCurrentUnderstanding } from './understandingComposer';
import { assembleLetter } from './understandingLetter';
import type { SessionInsight } from '../../types/userSummary';
import type { UnderstandingEvidence } from '../../types/evidence';

const NOW = 1_800_000_000_000;
const DAY = 86_400_000;

function insight(ts: number, over: Partial<SessionInsight>): SessionInsight {
  return {
    id: `i_${ts}`, source: 'reflect', approvedByUser: true, createdAt: ts, approvedAt: ts,
    summaryText: '', thinkingStyle: [], coreQuestions: [], worldview: [],
    relationshipPhilosophy: [], conversationStyle: [], thinkingPath: [], ...over,
  } as SessionInsight;
}
function mev(movementId: string, direction: number, ts: number): UnderstandingEvidence {
  return {
    id: `ev_${movementId}_${ts}`, source: 'moment', movementId, direction,
    strength: 0.85, mappingConfidence: 0.9, lifecycleStatus: 'active',
    observedAt: new Date(ts).toISOString(), createdAt: new Date(ts).toISOString(),
  } as unknown as UnderstandingEvidence;
}

describe('Rule 1 — length grows with reinforcement (never padded)', () => {
  it('a brand-new user (one session) gets a SHORT, tentative letter', () => {
    const cu = composeCurrentUnderstanding({
      now: NOW,
      reflectInsights: [insight(NOW, { thinkingStyle: ['systems_thinking'] })],
      momentEvidence: [mev('direct_expression', 0.8, NOW), mev('boundary_preservation', 0.7, NOW)],
    });
    const zh = assembleLetter(cu, 'zh');
    expect(zh.lines[0]).toContain('Seen 还在慢慢认识你');
    expect(zh.lines.length).toBeLessThanOrEqual(2); // no full portrait from weak evidence
    console.log('\n[THIN · zh]\n' + zh.title + '\n' + zh.lines.join('\n') + '\n' + zh.provenance);
    console.log('\n[THIN · en]\n' + assembleLetter(cu, 'en').lines.join('\n'));
  });

  it('a reinforced user gets a fuller letter — one thread per facet + closing', () => {
    const reflects = [
      insight(NOW, { thinkingStyle: ['systems_thinking'], relationshipPhilosophy: ['reciprocity_keeps_bonds_alive'], worldview: ['meaning_must_be_built_not_received'] }),
      insight(NOW - 20 * DAY, { thinkingStyle: ['systems_thinking'], worldview: ['meaning_must_be_built_not_received'] }),
      insight(NOW - 40 * DAY, { thinkingStyle: ['systems_thinking'], relationshipPhilosophy: ['reciprocity_keeps_bonds_alive'] }),
    ];
    const moments = [
      mev('relationship_preservation', 0.8, NOW), mev('relationship_preservation', 0.8, NOW - 10 * DAY),
      mev('meaning_orientation', 0.8, NOW), mev('meaning_orientation', 0.8, NOW - 15 * DAY),
    ];
    const cu = composeCurrentUnderstanding({ now: NOW, reflectInsights: reflects, momentEvidence: moments });
    const zh = assembleLetter(cu, 'zh');
    const en = assembleLetter(cu, 'en');

    expect(zh.lines.length).toBeGreaterThanOrEqual(3); // thinking + behaviour + meaning + closing
    expect(zh.lines[zh.lines.length - 1]).toContain('慢慢长出来'); // gentle closing, not declarative
    console.log('\n[REINFORCED · zh]\n' + zh.title + '\n' + zh.lines.join('\n') + '\n' + zh.provenance);
    console.log('\n[REINFORCED · en]\n' + en.title + '\n' + en.lines.join('\n') + '\n' + en.provenance);
  });
});

describe('Rule 2 — tentative until reinforced', () => {
  it('forming signals are softened; clear signals are firm', () => {
    const thin = composeCurrentUnderstanding({ now: NOW, reflectInsights: [insight(NOW, { thinkingStyle: ['pattern_mapping'] })], momentEvidence: [] });
    expect(assembleLetter(thin, 'zh').lines.join('')).toMatch(/似乎|感觉/); // softened

    const firm = composeCurrentUnderstanding({
      now: NOW,
      reflectInsights: [insight(NOW, { thinkingStyle: ['pattern_mapping'] }), insight(NOW - DAY, { thinkingStyle: ['pattern_mapping'] }), insight(NOW - 2 * DAY, { thinkingStyle: ['pattern_mapping'] })],
      momentEvidence: [],
    });
    // 3 occurrences → clear → firm "你…", not "似乎"
    const line = assembleLetter(firm, 'zh').lines.find((l) => l.includes('模式')) ?? '';
    expect(line.startsWith('你') && !line.includes('似乎')).toBe(true);
  });
});

describe('Rule 4 — the shifting note only appears with a real change signal', () => {
  it('is absent by default', () => {
    const cu = composeCurrentUnderstanding({
      now: NOW,
      reflectInsights: [insight(NOW, { thinkingStyle: ['systems_thinking'] }), insight(NOW - DAY, { thinkingStyle: ['systems_thinking'] }), insight(NOW - 2 * DAY, { thinkingStyle: ['systems_thinking'] })],
      momentEvidence: [],
    });
    expect(assembleLetter(cu, 'zh').lines.join('')).not.toContain('最近，Seen');
  });
});
