/**
 * Reflect Durability Sprint — regression protection.
 *
 * Proves the durability contract the sprint restores:
 *   1. reflectInsights hydrates the local Session Insight cache from Firestore.
 *   2. Duplicate hydration is idempotent (union by id, no duplicates).
 *   3. The cache is rebuilt from Firestore after a "reinstall" (empty local).
 *   4. Trait inference runs over the HYDRATED history, not only new local sessions.
 *   5. A failed durable write never silently reports Keep success (it throws) and
 *      never commits the local cache.
 *   6. Durable records are keyed by the stable insight/record id (append-only,
 *      one approved Reflect = one durable record), NOT by sessionId.
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Environment shims (node env — no jsdom) -------------------------------
const store = new Map<string, string>();
vi.stubGlobal('localStorage', {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => store.clear(),
});

const authState: { currentUser: { uid: string } | null } = { currentUser: null };
vi.mock('./firebase', () => ({
  auth: {
    get currentUser() {
      return authState.currentUser;
    },
  },
  db: {},
}));
// userSummary imports the backend extractor transitively; it is never exercised
// here, but stub it so the module graph loads without a live config.
vi.mock('./seenApi', () => ({ extractReflectSummary: vi.fn() }));

// --- Firestore mock (controllable setDoc / getDocs) ------------------------
const setDoc = vi.fn().mockResolvedValue(undefined);
const getDocs = vi.fn();
const doc = vi.fn((...segments: unknown[]) => ({
  id: segments[segments.length - 1] as string,
  path: segments.slice(1).join('/'),
}));
const collection = vi.fn((...segments: unknown[]) => ({ path: segments.slice(1).join('/') }));
vi.mock('firebase/firestore', () => ({
  collection: (...a: unknown[]) => collection(...a),
  doc: (...a: unknown[]) => doc(...a),
  getDocs: (...a: unknown[]) => getDocs(...a),
  setDoc: (...a: unknown[]) => setDoc(...a),
  serverTimestamp: () => ({ __server: true }),
}));

import {
  hydrateSessionInsights,
  readSessionInsights,
  readEmergentTraits,
  saveApprovedSummary,
} from './userSummary';
import { buildSessionPatterns } from './sessionPattern';
import { inferEmergentTraits } from './emergentTraitInference';
import type { ConversationExtraction } from '../types/userSummary';

/** A reflectInsights Firestore doc carrying trait evidence. */
function insightDoc(
  id: string,
  approvedAt: number,
  over: Record<string, unknown> = {},
): { id: string; data: Record<string, unknown> } {
  return {
    id,
    data: {
      id,
      source: 'reflect',
      approvedByUser: true,
      createdAt: approvedAt,
      approvedAt,
      summaryText: `understanding ${id}`,
      thinkingStyle: ['pattern_mapping'],
      coreQuestions: [],
      worldview: [],
      relationshipPhilosophy: [],
      conversationStyle: [],
      thinkingPath: [],
      ...over,
    },
  };
}

/** getDocs → a QuerySnapshot-like object (mirrors keptReflections hydration). */
function snapshotOf(docs: Array<{ id: string; data: Record<string, unknown> }>) {
  return { docs: docs.map((d) => ({ id: d.id, data: () => d.data })) };
}

function extraction(over: Partial<ConversationExtraction> = {}): ConversationExtraction {
  return {
    summaryText: 'a clearer version of what I said',
    thinkingStyle: ['pattern_mapping'],
    coreQuestions: [],
    worldview: [],
    relationshipPhilosophy: [],
    conversationStyle: [],
    thinkingPath: [],
    ...over,
  };
}

beforeEach(() => {
  store.clear();
  authState.currentUser = { uid: 'u1' };
  setDoc.mockReset().mockResolvedValue(undefined);
  getDocs.mockReset();
  doc.mockClear();
  collection.mockClear();
});

describe('Task 1 · Session insight hydration from Firestore', () => {
  it('rebuilds the local cache from reflectInsights (was previously never read)', async () => {
    getDocs.mockResolvedValue(snapshotOf([insightDoc('r1', 1000), insightDoc('r2', 2000)]));

    expect(readSessionInsights()).toHaveLength(0); // fresh device — empty local

    const merged = await hydrateSessionInsights();

    expect(merged.map((i) => i.id).sort()).toEqual(['r1', 'r2']);
    // The durable copy is now actually usable from the local cache.
    expect(readSessionInsights().map((i) => i.id).sort()).toEqual(['r1', 'r2']);
    // Reads the correct owner-scoped subcollection.
    expect(collection).toHaveBeenCalledWith({}, 'users', 'u1', 'reflectInsights');
  });

  it('hydration is idempotent — running twice yields no duplicates', async () => {
    getDocs.mockResolvedValue(snapshotOf([insightDoc('r1', 1000), insightDoc('r2', 2000)]));

    await hydrateSessionInsights();
    const afterFirst = readSessionInsights().map((i) => i.id).sort();
    await hydrateSessionInsights();
    const afterSecond = readSessionInsights().map((i) => i.id).sort();

    expect(afterSecond).toEqual(afterFirst);
    expect(afterSecond).toEqual(['r1', 'r2']);
  });

  it('rebuilds the cache after a reinstall (empty local, Firestore intact)', async () => {
    // Simulate reinstall: local wiped, Firestore still holds the 3 approved records.
    getDocs.mockResolvedValue(
      snapshotOf([insightDoc('r1', 1000), insightDoc('r2', 2000), insightDoc('r3', 3000)]),
    );
    expect(readSessionInsights()).toHaveLength(0);

    await hydrateSessionInsights();

    expect(readSessionInsights().map((i) => i.id)).toEqual(['r1', 'r2', 'r3']); // sorted by approvedAt
  });

  it('does not drop a local-only (not-yet-synced) insight — union by id', async () => {
    // Local has a record Firestore has not seen; Firestore has two others.
    getDocs.mockResolvedValue(snapshotOf([insightDoc('r1', 1000), insightDoc('r2', 2000)]));
    // Seed a local-only insight via a Keep whose durable write we let succeed.
    await saveApprovedSummary(extraction(), 'u1', 'sess-local', { recordId: 'local-only' });

    await hydrateSessionInsights();

    expect(readSessionInsights().map((i) => i.id).sort()).toEqual(['local-only', 'r1', 'r2']);
  });
});

describe('Task 4 · Trait inference uses hydrated history', () => {
  it('two recurring hydrated sessions yield a matchable emergent trait', async () => {
    getDocs.mockResolvedValue(snapshotOf([insightDoc('r1', 1000), insightDoc('r2', 2000)]));

    await hydrateSessionInsights();

    // The derived cache rebuilt during hydration already carries the trait.
    const cached = readEmergentTraits().find((t) => t.traitId === 'pattern_noticer');
    expect(cached).toBeDefined();
    expect(['emergent', 'established']).toContain(cached!.status);
    expect(cached!.matchingEligible).toBe(true);

    // And inference over the hydrated local history reproduces it (not only new sessions).
    const patterns = buildSessionPatterns(readSessionInsights());
    const pn = inferEmergentTraits(patterns).traits.find((t) => t.traitId === 'pattern_noticer');
    expect(pn?.matchingEligible).toBe(true);
  });
});

describe('Task 2 · Durable write is authoritative', () => {
  it('a failed Firestore write throws and never commits the local cache', async () => {
    setDoc.mockRejectedValueOnce(new Error('offline / permission-denied'));

    await expect(
      saveApprovedSummary(extraction(), 'u1', 'sess-x', { recordId: 'rec-fail' }),
    ).rejects.toThrow();

    // Keep must NOT be silently recorded locally when durable persistence failed.
    expect(readSessionInsights().some((i) => i.id === 'rec-fail')).toBe(false);
    expect(readSessionInsights()).toHaveLength(0);
  });

  it('a successful durable write does commit the local cache', async () => {
    await saveApprovedSummary(extraction(), 'u1', 'sess-y', { recordId: 'rec-ok' });
    expect(readSessionInsights().some((i) => i.id === 'rec-ok')).toBe(true);
  });
});

describe('Task 3 · Durable record identity (append-only, keyed by insight id)', () => {
  it('keys the reflectInsights doc by the record id, not the sessionId', async () => {
    await saveApprovedSummary(extraction(), 'u1', 'SESSION_ABC', { recordId: 'REC_1' });

    const reflectDocCalls = doc.mock.calls.filter((c) => c.includes('reflectInsights'));
    expect(reflectDocCalls).toHaveLength(1);
    const key = reflectDocCalls[0][reflectDocCalls[0].length - 1];
    expect(key).toBe('REC_1'); // stable record id
    expect(key).not.toBe('SESSION_ABC'); // never the (possibly-repeating) sessionId
  });

  it('distinct approvals write distinct records; a retry upserts the same record (merge)', async () => {
    await saveApprovedSummary(extraction(), 'u1', 'sess', { recordId: 'REC_A' });
    await saveApprovedSummary(extraction(), 'u1', 'sess', { recordId: 'REC_B' });

    const keys = doc.mock.calls
      .filter((c) => c.includes('reflectInsights'))
      .map((c) => c[c.length - 1]);
    expect(keys).toEqual(['REC_A', 'REC_B']); // one durable record per approval

    // A retry of REC_A addresses the same doc and writes with merge:true (idempotent).
    doc.mockClear();
    setDoc.mockClear();
    await saveApprovedSummary(extraction(), 'u1', 'sess', { recordId: 'REC_A' });
    const retryKey = doc.mock.calls
      .filter((c) => c.includes('reflectInsights'))
      .map((c) => c[c.length - 1]);
    expect(retryKey).toEqual(['REC_A']);
    // reflectInsights write uses merge (first setDoc call).
    expect(setDoc.mock.calls[0][2]).toEqual({ merge: true });
    // Local cache still holds exactly one REC_A (upsert, not duplicated).
    expect(readSessionInsights().filter((i) => i.id === 'REC_A')).toHaveLength(1);
  });
});
