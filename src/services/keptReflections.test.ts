import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
const authState: { currentUser: { uid: string } | null } = { currentUser: null };

vi.stubGlobal('localStorage', {
  getItem: (key: string) => store.get(key) ?? null,
  setItem: (key: string, value: string) => {
    store.set(key, value);
  },
  removeItem: (key: string) => {
    store.delete(key);
  },
  clear: () => {
    store.clear();
  },
});

vi.mock('./firebase', () => ({
  auth: {
    get currentUser() {
      return authState.currentUser;
    },
  },
  db: {},
}));

const setDoc = vi.fn().mockResolvedValue(undefined);
const getDocs = vi.fn();
const deleteDoc = vi.fn().mockResolvedValue(undefined);
const doc = vi.fn((_col: unknown, id: string) => ({ id }));
const collection = vi.fn((...segments: string[]) => ({ path: segments.join('/') }));

vi.mock('firebase/firestore', () => ({
  collection: (...args: string[]) => collection(...args),
  deleteDoc: (...args: unknown[]) => deleteDoc(...(args as [])),
  doc: (...args: unknown[]) => doc(...(args as [unknown, string])),
  getDocs: (...args: unknown[]) => getDocs(...(args as [])),
  setDoc: (...args: unknown[]) => setDoc(...(args as [])),
}));

import {
  clearKeptReflections,
  detachKeptReflectionsOnLogout,
  getKeptReflections,
  hydrateKeptReflections,
  keptReflectionsStorageKey,
  saveKeptReflection,
} from './keptReflections';

function setUid(uid: string | null) {
  authState.currentUser = uid ? { uid } : null;
}

describe('keptReflections account isolation', () => {
  beforeEach(() => {
    store.clear();
    setUid(null);
    setDoc.mockClear();
    getDocs.mockReset();
    deleteDoc.mockClear();
  });

  it('uses a uid-scoped storage key, never a live global key', () => {
    expect(keptReflectionsStorageKey('alice')).toBe('seen_kept_reflections_v2_alice');
    expect(keptReflectionsStorageKey('alice')).not.toBe(keptReflectionsStorageKey('bob'));
  });

  it('refuses to save without a signed-in uid (no global fallback)', () => {
    setUid(null);
    expect(saveKeptReflection({ text: 'orphan', language: 'en' })).toBeNull();
    expect(store.size).toBe(0);
  });

  it('saveKeptReflection writes only into the current uid mirror', () => {
    setUid('alice');
    const saved = saveKeptReflection({
      text: '  你在关系里会先停下来想清楚  ',
      language: 'zh',
      sessionId: 'sess-1',
    });
    expect(saved?.text).toBe('你在关系里会先停下来想清楚');
    expect(store.has('seen_kept_reflections')).toBe(false);
    expect(store.has(keptReflectionsStorageKey('alice'))).toBe(true);
    expect(store.has(keptReflectionsStorageKey('bob'))).toBe(false);
    expect(getKeptReflections()).toHaveLength(1);
  });

  it('signed-out reads return empty even if another uid mirror exists on disk', () => {
    setUid('alice');
    saveKeptReflection({ text: 'alice kept', language: 'en' });
    setUid(null);
    expect(getKeptReflections()).toEqual([]);
  });

  it('uid B never reads uid A mirror before hydrate', () => {
    setUid('alice');
    saveKeptReflection({ text: 'alice only', language: 'en' });
    setUid('bob');
    expect(getKeptReflections()).toEqual([]);
  });

  it('logout detach removes that uid mirror and the legacy global key', () => {
    setUid('alice');
    saveKeptReflection({ text: 'alice kept', language: 'en' });
    store.set('seen_kept_reflections', JSON.stringify([{ id: 'legacy', text: 'leak' }]));

    detachKeptReflectionsOnLogout('alice');
    setUid(null);

    expect(store.has(keptReflectionsStorageKey('alice'))).toBe(false);
    expect(store.has('seen_kept_reflections')).toBe(false);
    expect(getKeptReflections()).toEqual([]);
  });

  it('hydrate REPLACES the current uid mirror from Firestore and never merges foreign cache', async () => {
    setUid('bob');
    // Poison: leftover rows that must not survive replace / must not upload.
    store.set(
      keptReflectionsStorageKey('bob'),
      JSON.stringify([{ id: 'from-alice', text: 'should not remain', createdAt: 1, language: 'en' }]),
    );
    store.set(
      'seen_kept_reflections',
      JSON.stringify([{ id: 'legacy-global', text: 'legacy leak', createdAt: 2, language: 'en' }]),
    );

    getDocs.mockResolvedValue({
      docs: [
        {
          id: 'remote-1',
          data: () => ({
            text: 'bob remote',
            createdAt: 300,
            language: 'en',
          }),
        },
      ],
    });

    await hydrateKeptReflections();

    const all = getKeptReflections();
    expect(all.map((r) => r.text)).toEqual(['bob remote']);
    expect(all.map((r) => r.id)).toEqual(['remote-1']);
    expect(store.has('seen_kept_reflections')).toBe(false);
    // Replace must not migrate foreign/local-only rows into Firestore.
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('hydrate for an empty remote clears prior local mirror for that uid', async () => {
    setUid('bob');
    store.set(
      keptReflectionsStorageKey('bob'),
      JSON.stringify([{ id: 'stale', text: 'previous account residue', createdAt: 1, language: 'zh' }]),
    );
    getDocs.mockResolvedValue({ docs: [] });

    await hydrateKeptReflections();
    expect(getKeptReflections()).toEqual([]);
  });

  it('rejects empty text so discarded extractions cannot create entries', () => {
    setUid('alice');
    expect(saveKeptReflection({ text: '   ', language: 'en' })).toBeNull();
    expect(getKeptReflections()).toHaveLength(0);
  });

  it('dedupes by stable id within the current uid mirror', () => {
    setUid('alice');
    const a = saveKeptReflection({ text: 'first', language: 'en' })!;
    const key = keptReflectionsStorageKey('alice');
    const raw = JSON.parse(store.get(key) || '[]');
    raw.push({ ...a, text: 'first duplicate', createdAt: a.createdAt - 10 });
    store.set(key, JSON.stringify(raw));

    const all = getKeptReflections();
    expect(all).toHaveLength(1);
    expect(all[0].text).toBe('first');
  });

  it('returns newest-first order for the current uid', () => {
    setUid('alice');
    const older = saveKeptReflection({ text: 'older', language: 'en' })!;
    const newer = saveKeptReflection({ text: 'newer', language: 'en' })!;
    store.set(
      keptReflectionsStorageKey('alice'),
      JSON.stringify([
        { ...older, createdAt: 100 },
        { ...newer, createdAt: 200 },
      ]),
    );
    expect(getKeptReflections().map((r) => r.text)).toEqual(['newer', 'older']);
  });

  it('clearKeptReflections only clears the current uid mirror', () => {
    setUid('alice');
    saveKeptReflection({ text: 'alice', language: 'en' });
    store.set(
      keptReflectionsStorageKey('bob'),
      JSON.stringify([{ id: 'b1', text: 'bob', createdAt: 1, language: 'en' }]),
    );
    clearKeptReflections();
    expect(store.has(keptReflectionsStorageKey('alice'))).toBe(false);
    expect(store.has(keptReflectionsStorageKey('bob'))).toBe(true);
  });
});
