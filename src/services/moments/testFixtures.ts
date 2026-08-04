/**
 * Test-only fixtures for the Moments framework.
 *
 * The ranking Moment below exists ONLY to exercise the generic ranking
 * renderer/validation in isolation (production ranking Moments M-P11/M-P12
 * now exist too). This fixture must never be added to the production library.
 */

import type { MomentDefinition } from '../../types/moments';

export const RANKING_TEST_FIXTURE: MomentDefinition = {
  id: 'TEST-RANK-01',
  version: 1,
  status: 'draft',
  interactionType: 'ranking',
  title: { zh: '测试排序' },
  scenario: { zh: '（测试）请按顺序选择。' },
  maxRank: 2,
  options: [
    {
      id: 'A',
      text: { zh: '选项一' },
      weight: 'Light',
      signals: [{ signal: 'CHG-01', delta: 0.5, confidence: 'medium' }],
    },
    {
      id: 'B',
      text: { zh: '选项二' },
      weight: 'Light',
      signals: [{ signal: 'TRU-01', delta: 0.4, confidence: 'low' }],
    },
    {
      id: 'C',
      text: { zh: '选项三' },
      weight: 'Light',
      signals: [{ signal: 'MEA-08', delta: 0.3, confidence: 'low' }],
    },
  ],
};

/** Approved sample answer profiles from the frozen summaryBlocks source. */
export const SAMPLE_PROFILE_A: Record<string, string[]> = {
  'M-P01': ['D'],
  'M-P02': ['D'],
  'M-P03': ['A'],
  'M-P04': ['C', 'E'],
  'M-P05': ['C'],
  'M-P06': ['C'],
  'M-P07': ['B'],
  'M-P08': ['C'],
  'M-P09': ['D'],
  'M-P10': ['D'],
  // Ranking Moments: top-3 selections in order (founder-approved expansion).
  'M-P11': ['C', 'F', 'B'],
  'M-P12': ['A', 'D', 'G'],
};

export const SAMPLE_PROFILE_B: Record<string, string[]> = {
  'M-P01': ['A'],
  'M-P02': ['A'],
  'M-P03': ['D'],
  'M-P04': ['B', 'F'],
  'M-P05': ['D'],
  'M-P06': ['B'],
  'M-P07': ['C'],
  'M-P08': ['A'],
  'M-P09': ['A'],
  'M-P10': ['A'],
  'M-P11': ['I', 'H', 'G'],
  'M-P12': ['F', 'C', 'G'],
};
