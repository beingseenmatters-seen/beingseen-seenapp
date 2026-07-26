/**
 * Phase 2C — per-turn mode metadata persistence in retained conversations.
 *
 * Covers:
 *  - AI turns persist requestedMode/effectiveMode and read back on restore
 *  - two assistant turns can retain different mode metadata
 *  - old records without metadata (whole-session model) still load safely
 *  - re-saving unchanged content never rewrites old messages or timestamps
 *  - lifecycle patches (updateConversation) never touch per-turn metadata
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  saveConversation,
  updateConversation,
  getConversationById,
} from './recentConversations';

function createFakeLocalStorage() {
  const data = new Map<string, string>();
  return {
    getItem: (key: string) => (data.has(key) ? data.get(key)! : null),
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
    clear: () => data.clear(),
  };
}

const TURN_MESSAGES = [
  { role: 'user' as const, text: '我最近有点乱' },
  { role: 'ai' as const, text: '嗯，我听见了。', requestedMode: 'reflect', effectiveMode: 'reflect' },
  { role: 'user' as const, text: '帮我理一理' },
  { role: 'ai' as const, text: '先分开事实和感受。', requestedMode: 'untangle', effectiveMode: 'untangle' },
];

beforeEach(() => {
  vi.stubGlobal('localStorage', createFakeLocalStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('per-turn mode metadata persistence', () => {
  it('persists requested/effective mode on AI turns and reads them back', () => {
    saveConversation('c1', TURN_MESSAGES, '3days', 'zh', { responseMode: 'untangle' });
    const restored = getConversationById('c1');
    expect(restored).not.toBeNull();
    expect(restored!.messages[1].requestedMode).toBe('reflect');
    expect(restored!.messages[1].effectiveMode).toBe('reflect');
    expect(restored!.messages[3].requestedMode).toBe('untangle');
  });

  it('first and second assistant turns retain different mode metadata', () => {
    saveConversation('c1', TURN_MESSAGES, '3days', 'zh', { responseMode: 'untangle' });
    const restored = getConversationById('c1')!;
    const aiTurns = restored.messages.filter(m => m.role === 'ai');
    expect(aiTurns[0].effectiveMode).toBe('reflect');
    expect(aiTurns[1].effectiveMode).toBe('untangle');
    expect(aiTurns[0].effectiveMode).not.toBe(aiTurns[1].effectiveMode);
  });

  it('a distress override persists distinct requested and effective modes', () => {
    saveConversation(
      'c1',
      [
        { role: 'user', text: '我快撑不住了' },
        { role: 'ai', text: '我在这里。', requestedMode: 'discover', effectiveMode: 'reflect' },
      ],
      '3days',
      'zh'
    );
    const ai = getConversationById('c1')!.messages[1];
    expect(ai.requestedMode).toBe('discover');
    expect(ai.effectiveMode).toBe('reflect');
  });

  it('the conversation-level responseMode is the CURRENT next-turn mode, not a lock', () => {
    saveConversation('c1', TURN_MESSAGES.slice(0, 2), '3days', 'zh', { responseMode: 'reflect' });
    // Turn 2: the user switched modes — the record follows the current mode
    // while earlier turns keep their own metadata untouched.
    saveConversation('c1', TURN_MESSAGES, '3days', 'zh', { responseMode: 'untangle' });
    const restored = getConversationById('c1')!;
    expect(restored.responseMode).toBe('untangle');
    expect(restored.messages[1].effectiveMode).toBe('reflect');
  });
});

describe('migration safety with pre-2C records', () => {
  it('old whole-session records without per-turn metadata still load', () => {
    const legacy = [
      { role: 'user' as const, text: '老对话' },
      { role: 'ai' as const, text: '旧回复。' },
    ];
    saveConversation('old1', legacy, '3days', 'zh', {
      responseMode: 'express',
      sessionStyle: 'helper',
      selectedMode: 2,
    });
    const restored = getConversationById('old1')!;
    expect(restored.responseMode).toBe('express');
    expect(restored.messages[1].requestedMode).toBeUndefined();
    expect(restored.messages[1].effectiveMode).toBeUndefined();
  });

  it('re-saving unchanged old messages preserves timestamps and never rewrites them', () => {
    const legacy = [
      { role: 'user' as const, text: '老对话' },
      { role: 'ai' as const, text: '旧回复。' },
    ];
    const first = saveConversation('old1', legacy, '3days', 'zh', { responseMode: 'express' })!;
    // Reopen + persist cycle with the new mapping shape ({role, text,
    // requestedMode: undefined, effectiveMode: undefined}) — must count as
    // unchanged content.
    const again = saveConversation(
      'old1',
      legacy.map(m => ({
        role: m.role,
        text: m.text,
        requestedMode: undefined,
        effectiveMode: undefined,
      })),
      '3days',
      'zh',
      { responseMode: 'untangle' }
    )!;
    expect(again.createdAt).toBe(first.createdAt);
    expect(again.expiresAt).toBe(first.expiresAt);
    expect(again.messages).toEqual(first.messages);
    // Only the current next-turn mode moved.
    expect(again.responseMode).toBe('untangle');
  });
});

describe('lifecycle patches leave turn metadata alone', () => {
  it('marking completed does not strip per-turn mode metadata', () => {
    saveConversation('c1', TURN_MESSAGES, '3days', 'zh', { responseMode: 'untangle' });
    updateConversation('c1', { status: 'completed', decision: 'kept', pendingExtraction: null });
    const restored = getConversationById('c1')!;
    expect(restored.status).toBe('completed');
    expect(restored.messages[1].effectiveMode).toBe('reflect');
    expect(restored.messages[3].effectiveMode).toBe('untangle');
    expect(restored.responseMode).toBe('untangle');
  });
});
