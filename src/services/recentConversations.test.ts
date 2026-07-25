import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import { RETENTION_OPTIONS, RETENTION_TTL_DAYS } from '../types/insight';
import { saveConversation, getConversationById } from './recentConversations';

const DAY_MS = 24 * 60 * 60 * 1000;

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

const MESSAGES = [
  { role: 'user' as const, text: '我最近在想工作的事' },
  { role: 'ai' as const, text: '听起来这件事占了你不少心思。' },
];

beforeEach(() => {
  vi.stubGlobal('localStorage', createFakeLocalStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('retention behavior stays unchanged (Phase 1 guard)', () => {
  it('retention options and TTL days are exactly the existing ones', () => {
    expect(RETENTION_OPTIONS).toEqual(['3days', '5days', '7days', 'none']);
    expect(RETENTION_TTL_DAYS).toEqual({ '3days': 3, '5days': 5, '7days': 7, 'none': 0 });
  });

  it('3-day and 7-day retention compute the same expiry as before', () => {
    const before = Date.now();
    const c3 = saveConversation('id-3', MESSAGES, '3days', 'zh');
    const c7 = saveConversation('id-7', MESSAGES, '7days', 'zh');
    const after = Date.now();

    expect(c3).not.toBeNull();
    expect(c7).not.toBeNull();
    expect(c3!.retentionDays).toBe(3);
    expect(c7!.retentionDays).toBe(7);
    expect(c3!.expiresAt - c3!.createdAt).toBe(3 * DAY_MS);
    expect(c7!.expiresAt - c7!.createdAt).toBe(7 * DAY_MS);
    expect(c3!.createdAt).toBeGreaterThanOrEqual(before);
    expect(c3!.createdAt).toBeLessThanOrEqual(after);
  });

  it('"no save" still stores nothing', () => {
    expect(saveConversation('id-none', MESSAGES, 'none', 'zh')).toBeNull();
    expect(getConversationById('id-none')).toBeNull();
  });

  it('a saved conversation can still be resumed before expiry', () => {
    saveConversation('id-resume', MESSAGES, '3days', 'zh');
    const resumed = getConversationById('id-resume');
    expect(resumed).not.toBeNull();
    expect(resumed!.messages).toHaveLength(2);
  });
});

describe('responseMode persistence is independent from retention', () => {
  it('stores the locked responseMode alongside legacy fields', () => {
    saveConversation('id-mode', MESSAGES, '3days', 'zh', {
      responseMode: 'guide',
      sessionStyle: 'guide',
      selectedMode: 2,
    });
    const convo = getConversationById('id-mode');
    expect(convo?.responseMode).toBe('guide');
    expect(convo?.sessionStyle).toBe('guide');
    expect(convo?.selectedMode).toBe(2);
  });

  it('a legacy conversation without responseMode still loads (migration happens on resume)', () => {
    saveConversation('id-legacy', MESSAGES, '3days', 'zh', {
      sessionStyle: 'organizer',
      selectedMode: 1,
    });
    const convo = getConversationById('id-legacy');
    expect(convo?.responseMode).toBeUndefined();
    expect(convo?.sessionStyle).toBe('organizer');
  });

  it('stores canonical five-mode values with legacy compatibility fields (Phase 2)', () => {
    saveConversation('id-canonical', MESSAGES, '7days', 'zh', {
      responseMode: 'untangle',
      sessionStyle: 'organizer',
      selectedMode: 1,
    });
    const convo = getConversationById('id-canonical');
    expect(convo?.responseMode).toBe('untangle');
    expect(convo?.sessionStyle).toBe('organizer');
  });

  it('CONNECT persists canonically with no legacy fields, and retention is unaffected', () => {
    const saved = saveConversation('id-connect', MESSAGES, '3days', 'zh', {
      responseMode: 'connect',
      sessionStyle: undefined,
      selectedMode: null,
    });
    expect(saved!.expiresAt - saved!.createdAt).toBe(3 * DAY_MS);
    const convo = getConversationById('id-connect');
    expect(convo?.responseMode).toBe('connect');
    expect(convo?.sessionStyle).toBeUndefined();
    expect(convo?.selectedMode).toBeNull();
  });
});
