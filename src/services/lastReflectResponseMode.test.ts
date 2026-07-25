import { describe, expect, it } from 'vitest';
import { ResponseMode } from '../types/responseMode';
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

describe('lastReflectResponseMode (canonical five modes)', () => {
  it('missing value falls back to REFLECT', () => {
    const store = createMemoryStore();
    expect(loadLastUsedResponseMode('user-1', store)).toBe(ResponseMode.REFLECT);
  });

  it('invalid stored value falls back to REFLECT', () => {
    const store = createMemoryStore({
      [lastUsedResponseModeKey('user-1')]: 'not-a-mode',
      [lastUsedResponseModeKey('user-2')]: '{"role":"guide"}',
    });
    expect(loadLastUsedResponseMode('user-1', store)).toBe(ResponseMode.REFLECT);
    expect(loadLastUsedResponseMode('user-2', store)).toBe(ResponseMode.REFLECT);
  });

  it('save then load round-trips every canonical mode', () => {
    const store = createMemoryStore();
    for (const mode of [
      ResponseMode.REFLECT,
      ResponseMode.UNTANGLE,
      ResponseMode.EXPRESS,
      ResponseMode.CONNECT,
      ResponseMode.DISCOVER,
    ]) {
      saveLastUsedResponseMode('user-1', mode, store);
      expect(loadLastUsedResponseMode('user-1', store)).toBe(mode);
    }
  });

  it('legacy Phase 1 stored values migrate through the approved mapping', () => {
    const store = createMemoryStore({
      [lastUsedResponseModeKey('u-mirror')]: 'mirror',
      [lastUsedResponseModeKey('u-organizer')]: 'organizer',
      [lastUsedResponseModeKey('u-helper')]: 'helper',
      [lastUsedResponseModeKey('u-guide')]: 'guide',
    });
    expect(loadLastUsedResponseMode('u-mirror', store)).toBe(ResponseMode.REFLECT);
    expect(loadLastUsedResponseMode('u-organizer', store)).toBe(ResponseMode.UNTANGLE);
    expect(loadLastUsedResponseMode('u-helper', store)).toBe(ResponseMode.EXPRESS);
    expect(loadLastUsedResponseMode('u-guide', store)).toBe(ResponseMode.DISCOVER);
  });

  it('values are scoped by Firebase uid — users on the same browser do not share', () => {
    const store = createMemoryStore();
    saveLastUsedResponseMode('user-a', ResponseMode.CONNECT, store);
    saveLastUsedResponseMode('user-b', ResponseMode.UNTANGLE, store);
    expect(loadLastUsedResponseMode('user-a', store)).toBe(ResponseMode.CONNECT);
    expect(loadLastUsedResponseMode('user-b', store)).toBe(ResponseMode.UNTANGLE);
    expect(loadLastUsedResponseMode('user-c', store)).toBe(ResponseMode.REFLECT);
  });

  it('corrupt storage never throws and falls back to REFLECT', () => {
    const store = createThrowingStore();
    expect(() => saveLastUsedResponseMode('user-1', ResponseMode.DISCOVER, store)).not.toThrow();
    expect(loadLastUsedResponseMode('user-1', store)).toBe(ResponseMode.REFLECT);
    expect(() => clearLastUsedResponseMode('user-1', store)).not.toThrow();
  });

  it('missing uid is a safe no-op (load returns REFLECT, save writes nothing)', () => {
    const store = createMemoryStore();
    expect(loadLastUsedResponseMode(undefined, store)).toBe(ResponseMode.REFLECT);
    saveLastUsedResponseMode(null, ResponseMode.DISCOVER, store);
    expect(store.data.size).toBe(0);
  });

  it('clear removes only the given uid value', () => {
    const store = createMemoryStore();
    saveLastUsedResponseMode('user-a', ResponseMode.DISCOVER, store);
    saveLastUsedResponseMode('user-b', ResponseMode.UNTANGLE, store);
    clearLastUsedResponseMode('user-a', store);
    expect(loadLastUsedResponseMode('user-a', store)).toBe(ResponseMode.REFLECT);
    expect(loadLastUsedResponseMode('user-b', store)).toBe(ResponseMode.UNTANGLE);
  });

  it('uses the versioned user-scoped key format', () => {
    expect(lastUsedResponseModeKey('abc123')).toBe('seen_last_reflect_mode_v1_abc123');
  });
});
