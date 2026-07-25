/**
 * Phase 2B — completion extraction behavior.
 *
 * Covers:
 *  - one call produces exactly one extraction request
 *  - backend failure surfaces an error (no silent fake success) on the strict path
 *  - a retry issues exactly one new request
 *  - a backend extraction carrying only the sentence counts as meaningful
 *  - the legacy fallback path (clear/new) still degrades gracefully
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('./seenApi', () => ({
  extractReflectSummary: vi.fn(),
}));

import { extractReflectSummary } from './seenApi';
import {
  extractSummaryFromBackend,
  extractSummaryFromConversation,
  hasMeaningfulExtraction,
} from './userSummary';

const mockedExtract = vi.mocked(extractReflectSummary);

const MESSAGES = [
  { role: 'user' as const, text: '我最近对工作有点犹豫，不确定要不要换方向。' },
  { role: 'ai' as const, text: '听起来这个犹豫已经陪着你一阵子了。' },
  { role: 'user' as const, text: '是的，我怕选错，但也怕一直停在原地。' },
];

const BACKEND_RESPONSE = {
  layers: {
    contentSummary: '工作方向的犹豫',
    emotion: '犹豫',
    trigger: '',
    values: '',
    behaviorPattern: '',
    decisionModel: '',
    personalityTraits: '',
    relationshipNeed: '',
    motivation: '',
    coreConflict: '',
  },
  reflection: '你怕选错，但也怕一直停在原地。',
  summary: 'internal synthesis',
  model: 'gpt-4.1',
};

beforeEach(() => {
  mockedExtract.mockReset();
});

describe('extractSummaryFromBackend (strict 完成 path)', () => {
  it('one call produces exactly one extraction request and returns the sentence', async () => {
    mockedExtract.mockResolvedValueOnce(BACKEND_RESPONSE);

    const extraction = await extractSummaryFromBackend(MESSAGES, { language: 'zh' });

    expect(mockedExtract).toHaveBeenCalledTimes(1);
    expect(extraction.summaryText).toBe('你怕选错，但也怕一直停在原地。');
  });

  it('throws on backend failure instead of substituting a fake sentence', async () => {
    mockedExtract.mockRejectedValueOnce(new Error('network down'));

    await expect(extractSummaryFromBackend(MESSAGES, { language: 'zh' })).rejects.toThrow(
      'network down'
    );
    expect(mockedExtract).toHaveBeenCalledTimes(1);
  });

  it('throws when the backend returns an empty reflection and summary', async () => {
    mockedExtract.mockResolvedValueOnce({ ...BACKEND_RESPONSE, reflection: '', summary: '' });

    await expect(extractSummaryFromBackend(MESSAGES, { language: 'zh' })).rejects.toThrow();
  });

  it('a retry after failure issues exactly one new request', async () => {
    mockedExtract.mockRejectedValueOnce(new Error('timeout'));
    await expect(extractSummaryFromBackend(MESSAGES, { language: 'zh' })).rejects.toThrow();

    mockedExtract.mockResolvedValueOnce(BACKEND_RESPONSE);
    const retried = await extractSummaryFromBackend(MESSAGES, { language: 'zh' });

    expect(mockedExtract).toHaveBeenCalledTimes(2);
    expect(retried.summaryText).toBe(BACKEND_RESPONSE.reflection);
  });

  it('falls back to the internal summary field for older Lambda deployments', async () => {
    mockedExtract.mockResolvedValueOnce({ ...BACKEND_RESPONSE, reflection: '' });
    const extraction = await extractSummaryFromBackend(MESSAGES, { language: 'zh' });
    expect(extraction.summaryText).toBe('internal synthesis');
  });
});

describe('hasMeaningfulExtraction', () => {
  it('a backend extraction carrying only the sentence is meaningful', () => {
    expect(
      hasMeaningfulExtraction({
        summaryText: '你怕选错，但也怕一直停在原地。',
        thinkingStyle: [],
        coreQuestions: [],
        worldview: [],
        relationshipPhilosophy: [],
        conversationStyle: [],
        thinkingPath: [],
      })
    ).toBe(true);
  });

  it('an empty extraction is not meaningful', () => {
    expect(
      hasMeaningfulExtraction({
        summaryText: '   ',
        thinkingStyle: [],
        coreQuestions: [],
        worldview: [],
        relationshipPhilosophy: [],
        conversationStyle: [],
        thinkingPath: [],
      })
    ).toBe(false);
  });
});

describe('extractSummaryFromConversation (legacy clear/new path)', () => {
  it('still degrades to a local gentle reflection when the backend fails', async () => {
    mockedExtract.mockRejectedValueOnce(new Error('network down'));

    const extraction = await extractSummaryFromConversation(MESSAGES, { language: 'zh' });

    // Never blocks the clear/new flow: a locally built sentence is returned.
    expect(extraction.summaryText.trim().length).toBeGreaterThan(0);
    expect(mockedExtract).toHaveBeenCalledTimes(1);
  });
});
