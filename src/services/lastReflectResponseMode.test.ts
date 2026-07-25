import { describe, expect, it } from 'vitest';
import { ResponseStyle } from '../types/responseStyle';
import {
  lastUsedResponseModeKey,
  loadLastUsedResponseMode,
  saveLastUsedResponseMode,
  clearLastUsedResponseMode,
  type ResponseModeStore,
} from './lastReflectResponseMode';

function createMemoryStore(initial: Record<string, string> = {}): ResponseModeStore & { data: Map<string, string> } {
  const data = new Map(Object.entries(initial));
  return {
    data,
    getItem: (key) => (data.has(key) ? data.get(key)! : null),
    setItem: (key, value) => {
      data.set(key, value);
    },
    removeItem: (key) => {
      data.delete(key);
    },
  };
}

function createThrowingStore(): ResponseModeStore {
  return {
    getItem: () => {
      throw new Error('storage unavailable');
    },
    setItem: () => {
      throw new Error('storage unavailable');
    },
    removeItem: () => {
      throw new Error('storage unavailable');
    },
  };
}

describe('lastReflectResponseMode', () => {
  it('missing value falls back to MIRROR', () => {
    const store = createMemoryStore();
    expect(loadLastUsedResponseMode('user-1', store)).toBe(ResponseStyle.MIRROR);
  });

  it('invalid or legacy stored value falls back to MIRROR', () => {
    const store = createMemoryStore({
      [lastUsedResponseModeKey('user-1')]: 'not-a-mode',
      [lastUsedResponseModeKey('user-2')]: '{"role":"guide"}',
    });
    expect(loadLastUsedResponseMode('user-1', store)).toBe(ResponseStyle.MIRROR);
    expect(loadLastUsedResponseMode('user-2', store)).toBe(ResponseStyle.MIRROR);
  });

  it('save then load round-trips every valid mode', () => {
    const store = createMemoryStore();
    for (const mode of [
      ResponseStyle.MIRROR,
      ResponseStyle.ORGANIZER,
      ResponseStyle.GUIDE,
      ResponseStyle.EXPRESSION_HELP,
    ]) {
      saveLastUsedResponseMode('user-1', mode, store);
      expect(loadLastUsedResponseMode('user-1', store)).toBe(mode);
    }
  });

  it('values are scoped by Firebase uid — users on the same browser do not share', () => {
    const store = createMemoryStore();
    saveLastUsedResponseMode('user-a', ResponseStyle.GUIDE, store);
    saveLastUsedResponseMode('user-b', ResponseStyle.ORGANIZER, store);
    expect(loadLastUsedResponseMode('user-a', store)).toBe(ResponseStyle.GUIDE);
    expect(loadLastUsedResponseMode('user-b', store)).toBe(ResponseStyle.ORGANIZER);
    expect(loadLastUsedResponseMode('user-c', store)).toBe(ResponseStyle.MIRROR);
  });

  it('corrupt storage never throws and falls back to MIRROR', () => {
    const store = createThrowingStore();
    expect(() => saveLastUsedResponseMode('user-1', ResponseStyle.GUIDE, store)).not.toThrow();
    expect(loadLastUsedResponseMode('user-1', store)).toBe(ResponseStyle.MIRROR);
    expect(() => clearLastUsedResponseMode('user-1', store)).not.toThrow();
  });

  it('missing uid is a safe no-op (load returns MIRROR, save writes nothing)', () => {
    const store = createMemoryStore();
    expect(loadLastUsedResponseMode(undefined, store)).toBe(ResponseStyle.MIRROR);
    saveLastUsedResponseMode(null, ResponseStyle.GUIDE, store);
    expect(store.data.size).toBe(0);
  });

  it('clear removes only the given uid value', () => {
    const store = createMemoryStore();
    saveLastUsedResponseMode('user-a', ResponseStyle.GUIDE, store);
    saveLastUsedResponseMode('user-b', ResponseStyle.ORGANIZER, store);
    clearLastUsedResponseMode('user-a', store);
    expect(loadLastUsedResponseMode('user-a', store)).toBe(ResponseStyle.MIRROR);
    expect(loadLastUsedResponseMode('user-b', store)).toBe(ResponseStyle.ORGANIZER);
  });

  it('uses the versioned user-scoped key format', () => {
    expect(lastUsedResponseModeKey('abc123')).toBe('seen_last_reflect_mode_v1_abc123');
  });
});
