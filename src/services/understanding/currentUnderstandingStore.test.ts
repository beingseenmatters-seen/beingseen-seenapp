/**
 * Current Understanding store — persistence + independence from Matching.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});

const authState: { currentUser: { uid: string } | null } = { currentUser: null };
vi.mock('../firebase', () => ({
  auth: { get currentUser() { return authState.currentUser; } },
  db: {},
}));

const readSessionInsights = vi.fn();
vi.mock('../userSummary', () => ({ readSessionInsights: () => readSessionInsights() }));

const setDoc = vi.fn().mockResolvedValue(undefined);
const getDocs = vi.fn();
const getDoc = vi.fn();
const doc = vi.fn((...a: unknown[]) => ({ __path: a.slice(1).join('/') }));
const collection = vi.fn((...a: unknown[]) => ({ __path: a.slice(1).join('/') }));
vi.mock('firebase/firestore', () => ({
  collection: (...a: unknown[]) => collection(...a),
  doc: (...a: unknown[]) => doc(...a),
  getDoc: (...a: unknown[]) => getDoc(...a),
  getDocs: (...a: unknown[]) => getDocs(...a),
  setDoc: (...a: unknown[]) => setDoc(...a),
  serverTimestamp: () => ({ __ts: true }),
}));

import { readCurrentUnderstanding, refreshCurrentUnderstanding } from './currentUnderstandingStore';

// Recent timestamps — the store composes with the real Date.now(), so evidence
// must be recent or recency-decay (correctly) zeroes it out.
const NOW = Date.now();
const insight = (over: Record<string, unknown>) => ({
  id: 'i1', source: 'reflect', approvedByUser: true, createdAt: NOW, approvedAt: NOW,
  summaryText: '', thinkingStyle: [], coreQuestions: [], worldview: [],
  relationshipPhilosophy: [], conversationStyle: [], thinkingPath: [], ...over,
});
const mev = (movementId: string) => ({
  source: 'moment', movementId, direction: 0.8, strength: 0.85, mappingConfidence: 0.9,
  lifecycleStatus: 'active', observedAt: new Date(NOW).toISOString(),
});

beforeEach(() => {
  store.clear();
  authState.currentUser = { uid: 'u1' };
  readSessionInsights.mockReset().mockReturnValue([]);
  setDoc.mockReset().mockResolvedValue(undefined);
  getDocs.mockReset().mockResolvedValue({ docs: [] });
  doc.mockClear();
});

describe('refreshCurrentUnderstanding', () => {
  it('composes from both evidence streams and caches locally + in Firestore', async () => {
    readSessionInsights.mockReturnValue([insight({ thinkingStyle: ['systems_thinking'] })]);
    getDocs.mockResolvedValue({ docs: [mev('relationship_preservation')].map((e) => ({ data: () => e })) });

    const cu = await refreshCurrentUnderstanding();
    expect(cu).toBeTruthy();
    expect(cu!.facets.thinking.items.some((i) => i.key === 'systems_thinking')).toBe(true);
    expect(readCurrentUnderstanding()!.version).toBe(cu!.version); // local mirror written
  });

  it('writes ONLY currentUnderstanding — never Matching state', async () => {
    readSessionInsights.mockReturnValue([insight({ thinkingStyle: ['systems_thinking'] })]);
    getDocs.mockResolvedValue({ docs: [] });

    await refreshCurrentUnderstanding();

    expect(setDoc).toHaveBeenCalledTimes(1);
    const payload = setDoc.mock.calls[0][1] as Record<string, unknown>;
    expect(Object.keys(payload)).toEqual(['currentUnderstanding']);
    const serialized = JSON.stringify(payload);
    for (const forbidden of ['emergentTraits', 'matchReady', 'soulProfile', 'momentProfile', 'reflectModel']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('is a no-op when signed out', async () => {
    authState.currentUser = null;
    expect(await refreshCurrentUnderstanding()).toBeNull();
    expect(setDoc).not.toHaveBeenCalled();
  });
});
