import { beforeEach, afterEach, describe, expect, it, vi } from 'vitest';
import {
  LEGACY_GLOBAL_USER_KEYS,
  detachAllUserLocalStorage,
  purgeLegacyGlobalUserCaches,
  userScopedKey,
} from './userScopedStorage';
import { retainedConversationsStorageKey } from './recentConversations';

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

describe('userScopedStorage architecture', () => {
  beforeEach(() => {
    vi.stubGlobal('localStorage', createFakeLocalStorage());
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('builds uid-scoped keys and never a shared global live key', () => {
    expect(userScopedKey('seen_retained_conversations_v2_', 'alice')).toBe(
      'seen_retained_conversations_v2_alice',
    );
    expect(retainedConversationsStorageKey('bob')).toBe('seen_retained_conversations_v2_bob');
    expect(retainedConversationsStorageKey('alice')).not.toBe(
      retainedConversationsStorageKey('bob'),
    );
  });

  it('purgeLegacyGlobalUserCaches removes every legacy device-global key', () => {
    for (const key of LEGACY_GLOBAL_USER_KEYS) {
      localStorage.setItem(key, 'leak');
    }
    purgeLegacyGlobalUserCaches();
    for (const key of LEGACY_GLOBAL_USER_KEYS) {
      expect(localStorage.getItem(key)).toBeNull();
    }
  });

  it('detachAllUserLocalStorage removes that uid mirror and legacy globals, not another uid', () => {
    localStorage.setItem('seen_retained_conversations', 'legacy');
    localStorage.setItem('seen_retained_conversations_v2_alice', '[{"id":"a"}]');
    localStorage.setItem('seen_retained_conversations_v2_bob', '[{"id":"b"}]');
    localStorage.setItem('seen_reflect_session_v2_alice', '{}');
    localStorage.setItem('seen_moments_v1_alice', '{}');

    detachAllUserLocalStorage('alice');

    expect(localStorage.getItem('seen_retained_conversations')).toBeNull();
    expect(localStorage.getItem('seen_retained_conversations_v2_alice')).toBeNull();
    expect(localStorage.getItem('seen_reflect_session_v2_alice')).toBeNull();
    expect(localStorage.getItem('seen_moments_v1_alice')).toBeNull();
    expect(localStorage.getItem('seen_retained_conversations_v2_bob')).toBe('[{"id":"b"}]');
  });
});
