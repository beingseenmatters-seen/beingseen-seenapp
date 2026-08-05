import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();

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
  auth: { currentUser: null },
  db: {},
}));

vi.mock('firebase/firestore', () => ({
  collection: vi.fn(),
  deleteDoc: vi.fn(),
  doc: vi.fn(),
  getDocs: vi.fn(),
  setDoc: vi.fn(),
}));

import {
  getKeptReflections,
  saveKeptReflection,
  clearKeptReflections,
} from './keptReflections';

describe('keptReflections Me surface store', () => {
  beforeEach(() => {
    store.clear();
    clearKeptReflections();
  });

  it('saveKeptReflection writes only approved text into local cache', () => {
    const saved = saveKeptReflection({
      text: '  你在关系里会先停下来想清楚  ',
      language: 'zh',
      sessionId: 'sess-1',
    });
    expect(saved?.text).toBe('你在关系里会先停下来想清楚');
    const all = getKeptReflections();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(saved!.id);
    expect(Object.keys(all[0]).sort()).toEqual(
      ['createdAt', 'id', 'language', 'sessionId', 'text'].sort(),
    );
  });

  it('rejects empty text so discarded extractions cannot create entries', () => {
    expect(saveKeptReflection({ text: '   ', language: 'en' })).toBeNull();
    expect(getKeptReflections()).toHaveLength(0);
  });

  it('dedupes by stable id when the same record appears twice locally', () => {
    const a = saveKeptReflection({ text: 'first', language: 'en' })!;
    const raw = JSON.parse(store.get('seen_kept_reflections') || '[]');
    raw.push({ ...a, text: 'first duplicate', createdAt: a.createdAt - 10 });
    store.set('seen_kept_reflections', JSON.stringify(raw));

    const all = getKeptReflections();
    expect(all).toHaveLength(1);
    expect(all[0].id).toBe(a.id);
    expect(all[0].text).toBe('first');
  });

  it('returns newest-first order', () => {
    const older = saveKeptReflection({ text: 'older', language: 'en' })!;
    const newer = saveKeptReflection({ text: 'newer', language: 'en' })!;
    store.set(
      'seen_kept_reflections',
      JSON.stringify([
        { ...older, createdAt: 100 },
        { ...newer, createdAt: 200 },
      ]),
    );
    const all = getKeptReflections();
    expect(all.map((r) => r.text)).toEqual(['newer', 'older']);
  });
});
