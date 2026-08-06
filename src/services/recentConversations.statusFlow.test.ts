/**
 * Phase 2B — retained-conversation lifecycle tests.
 *
 * Covers:
 *  - backward compatibility: old records without `status` behave as active
 *  - awaiting-decision persistence (extracted sentence survives, no re-extract)
 *  - completed (留下 / 放下) persistence
 *  - reopening does not duplicate, reorder, or reset timestamps/expiry
 *  - stale / expired / deleted entries fail safely
 *  - retention semantics (3-day / 7-day / no-save) remain unchanged
 */
import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';

const authState: { currentUser: { uid: string } | null } = {
  currentUser: { uid: 'test-user' },
};

vi.mock('./firebase', () => ({
  auth: {
    get currentUser() {
      return authState.currentUser;
    },
  },
  db: {},
}));

import {
  saveConversation,
  updateConversation,
  getConversationById,
  getVisibleConversations,
  deleteConversation,
  disposeCompletedConversation,
  retainedConversationsStorageKey,
  type RetainedConversation,
} from './recentConversations';

const DAY_MS = 24 * 60 * 60 * 1000;
const STORAGE_KEY = retainedConversationsStorageKey('test-user');

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

const EXTRACTION = {
  summaryText: '你想把工作的事想清楚一点。',
  thinkingStyle: [],
  coreQuestions: [],
};

beforeEach(() => {
  authState.currentUser = { uid: 'test-user' };
  vi.stubGlobal('localStorage', createFakeLocalStorage());
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('account isolation', () => {
  it('returns empty history when signed out', () => {
    saveConversation('c1', MESSAGES, '3days', 'zh');
    authState.currentUser = null;
    expect(getVisibleConversations()).toEqual([]);
    expect(getConversationById('c1')).toBeNull();
  });

  it('never reads another uid mirror or the legacy global key', () => {
    saveConversation('mine', MESSAGES, '3days', 'zh');
    localStorage.setItem(
      'seen_retained_conversations',
      JSON.stringify([{ id: 'legacy-leak', messages: MESSAGES, expiresAt: Date.now() + DAY_MS, retentionDays: 3 }]),
    );
    localStorage.setItem(
      retainedConversationsStorageKey('other-user'),
      JSON.stringify([
        {
          id: 'other',
          messages: MESSAGES,
          retention: '3days',
          retentionDays: 3,
          createdAt: Date.now(),
          expiresAt: Date.now() + DAY_MS,
        },
      ]),
    );
    expect(getVisibleConversations().map((c) => c.id)).toEqual(['mine']);
    expect(localStorage.getItem('seen_retained_conversations')).toBeNull();
  });
});

describe('backward compatibility with pre-Phase-2B records', () => {
  it('a record saved without lifecycle fields has no status (treated as active)', () => {
    const c = saveConversation('c1', MESSAGES, '3days', 'zh');
    expect(c).not.toBeNull();
    expect(c!.status).toBeUndefined();
    expect(c!.decision).toBeUndefined();
    expect(c!.pendingExtraction).toBeUndefined();
  });

  it('old stored data (raw JSON without status) is still readable', () => {
    const legacy: RetainedConversation[] = [
      {
        id: 'legacy-1',
        title: '关于工作',
        messages: MESSAGES,
        retention: '3days',
        retentionDays: 3,
        createdAt: Date.now(),
        expiresAt: Date.now() + 3 * DAY_MS,
        responseMode: 'reflect',
      },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(legacy));

    const found = getConversationById('legacy-1');
    expect(found).not.toBeNull();
    expect(found!.status).toBeUndefined();
    expect(found!.responseMode).toBe('reflect');
  });
});

describe('awaiting-decision persistence', () => {
  it('stores the extracted sentence so reopening never re-extracts', () => {
    saveConversation('c1', MESSAGES, '3days', 'zh', { responseMode: 'untangle' });
    const updated = updateConversation('c1', {
      status: 'awaiting_decision',
      pendingExtraction: EXTRACTION,
    });
    expect(updated).not.toBeNull();

    const reopened = getConversationById('c1');
    expect(reopened!.status).toBe('awaiting_decision');
    expect((reopened!.pendingExtraction as { summaryText: string }).summaryText).toBe(
      EXTRACTION.summaryText
    );
    // The locked mode is untouched by the lifecycle patch.
    expect(reopened!.responseMode).toBe('untangle');
  });

  it('updateConversation never touches messages, timestamps, expiry or order', () => {
    saveConversation('first', MESSAGES, '3days', 'zh');
    saveConversation('second', MESSAGES, '7days', 'zh');
    const before = getConversationById('first')!;

    updateConversation('first', { status: 'awaiting_decision', pendingExtraction: EXTRACTION });

    const after = getConversationById('first')!;
    expect(after.messages).toEqual(before.messages);
    expect(after.createdAt).toBe(before.createdAt);
    expect(after.expiresAt).toBe(before.expiresAt);
    expect(getVisibleConversations().map(c => c.id)).toEqual(['second', 'first']);
  });

  it('is a safe no-op for a conversation that does not exist (retention "none")', () => {
    expect(updateConversation('missing', { status: 'completed' })).toBeNull();
  });
});

describe('completed conversations (留下 / 放下) — immediate disposal', () => {
  it('留下 disposes transcript: not visible, not restorable', () => {
    saveConversation('c1', MESSAGES, '3days', 'zh');
    updateConversation('c1', { status: 'awaiting_decision', pendingExtraction: EXTRACTION });
    disposeCompletedConversation('c1', 'kept');

    expect(getConversationById('c1')).toBeNull();
    expect(getVisibleConversations().map((c) => c.id)).not.toContain('c1');

    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as RetainedConversation[];
    const tombstone = raw.find((c) => c.id === 'c1')!;
    expect(tombstone.status).toBe('completed');
    expect(tombstone.decision).toBe('kept');
    expect(tombstone.messages).toEqual([]);
    expect(tombstone.deletedAt).toBeTypeOf('number');
  });

  it('放下 also disposes transcript immediately (no user-facing chat)', () => {
    saveConversation('c1', MESSAGES, '7days', 'zh');
    disposeCompletedConversation('c1', 'released');

    expect(getConversationById('c1')).toBeNull();
    expect(getVisibleConversations().map((c) => c.id)).not.toContain('c1');

    const raw = JSON.parse(localStorage.getItem(STORAGE_KEY) || '[]') as RetainedConversation[];
    const tombstone = raw.find((c) => c.id === 'c1')!;
    expect(tombstone.decision).toBe('released');
    expect(tombstone.messages).toEqual([]);
  });

  it('autosave cannot recreate a disposed conversation', () => {
    saveConversation('c1', MESSAGES, '3days', 'zh');
    disposeCompletedConversation('c1', 'kept');

    const resurrected = saveConversation('c1', MESSAGES, '3days', 'zh', {
      status: 'active',
    });
    expect(resurrected).toBeNull();
    expect(getConversationById('c1')).toBeNull();
    expect(getVisibleConversations().map((c) => c.id)).not.toContain('c1');
  });

  it('saveConversation refuses status completed writes', () => {
    expect(
      saveConversation('c1', MESSAGES, '3days', 'zh', { status: 'completed', decision: 'kept' }),
    ).toBeNull();
    expect(getVisibleConversations()).toEqual([]);
  });
});

describe('reopening a conversation (restore) is non-destructive', () => {
  it('re-saving identical messages keeps timestamps, expiry, title and position', () => {
    saveConversation('older', MESSAGES, '3days', 'zh');
    const saved = saveConversation('reopened', MESSAGES, '3days', 'zh')!;

    // Simulate the persistence effect firing again after a restore (same content).
    const resaved = saveConversation('reopened', MESSAGES, '3days', 'zh')!;

    expect(resaved.createdAt).toBe(saved.createdAt);
    expect(resaved.expiresAt).toBe(saved.expiresAt);
    expect(resaved.title).toBe(saved.title);
    expect(getVisibleConversations().map(c => c.id)).toEqual(['reopened', 'older']);
    // No duplicate entry was created.
    expect(getVisibleConversations().filter(c => c.id === 'reopened')).toHaveLength(1);
  });

  it('re-saving preserves lifecycle fields when the caller does not pass them', () => {
    saveConversation('c1', MESSAGES, '3days', 'zh');
    updateConversation('c1', { status: 'awaiting_decision', pendingExtraction: EXTRACTION });

    saveConversation('c1', MESSAGES, '3days', 'zh');

    const after = getConversationById('c1')!;
    expect(after.status).toBe('awaiting_decision');
    expect(after.pendingExtraction).toEqual(EXTRACTION);
  });

  it('a genuinely new message moves the conversation to the front and refreshes expiry', async () => {
    saveConversation('a', MESSAGES, '3days', 'zh');
    saveConversation('b', MESSAGES, '3days', 'zh');
    const before = getConversationById('a')!;

    await new Promise(resolve => setTimeout(resolve, 5));
    const extended = [...MESSAGES, { role: 'user' as const, text: '还有一件事' }];
    saveConversation('a', extended, '3days', 'zh');

    const after = getConversationById('a')!;
    expect(after.messages).toHaveLength(3);
    expect(after.expiresAt).toBeGreaterThan(before.expiresAt);
    expect(getVisibleConversations().map(c => c.id)).toEqual(['a', 'b']);
  });
});

describe('stale / expired / missing entries fail safely', () => {
  it('an expired conversation resolves to null instead of throwing', () => {
    const expired: RetainedConversation[] = [
      {
        id: 'expired-1',
        messages: MESSAGES,
        retention: '3days',
        retentionDays: 3,
        createdAt: Date.now() - 4 * DAY_MS,
        expiresAt: Date.now() - 1 * DAY_MS,
      },
    ];
    localStorage.setItem(STORAGE_KEY, JSON.stringify(expired));
    expect(getConversationById('expired-1')).toBeNull();
    expect(getVisibleConversations()).toHaveLength(0);
  });

  it('a deleted conversation resolves to null', () => {
    saveConversation('c1', MESSAGES, '3days', 'zh');
    deleteConversation('c1');
    expect(getConversationById('c1')).toBeNull();
  });

  it('corrupt storage resolves to null instead of throwing', () => {
    localStorage.setItem(STORAGE_KEY, '{not valid json');
    expect(getConversationById('anything')).toBeNull();
    expect(getVisibleConversations()).toEqual([]);
  });
});

describe('retention semantics remain unchanged (Phase 2B guard)', () => {
  it('3-day and 7-day expiry math is untouched', () => {
    const c3 = saveConversation('r3', MESSAGES, '3days', 'zh')!;
    const c7 = saveConversation('r7', MESSAGES, '7days', 'zh')!;
    expect(c3.expiresAt - c3.createdAt).toBe(3 * DAY_MS);
    expect(c7.expiresAt - c7.createdAt).toBe(7 * DAY_MS);
  });

  it('"no save" still stores nothing, even with lifecycle opts', () => {
    expect(
      saveConversation('none-1', MESSAGES, 'none', 'zh', {
        status: 'awaiting_decision',
        pendingExtraction: EXTRACTION,
      })
    ).toBeNull();
    expect(getConversationById('none-1')).toBeNull();
  });
});
