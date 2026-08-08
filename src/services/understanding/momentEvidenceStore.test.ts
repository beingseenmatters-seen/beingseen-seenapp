/**
 * Moment persistence — pipeline + channel independence.
 *
 * Proves syncMomentUnderstanding writes durable Moment Evidence + a denormalized
 * momentProfile/momentReady, and NEVER writes soulProfile / emergentTraits /
 * matchReady (the two evidence channels stay independent).
 */
import { beforeEach, describe, expect, it, vi } from 'vitest';

const authState: { currentUser: { uid: string } | null } = { currentUser: null };
vi.mock('../firebase', () => ({
  auth: {
    get currentUser() {
      return authState.currentUser;
    },
  },
  db: {},
}));

const exportAll = vi.fn();
vi.mock('../moments/momentsClient', () => ({ momentsClient: { exportAll: (...a: unknown[]) => exportAll(...a) } }));

const createMomentEvidenceFromSession = vi.fn();
vi.mock('./momentEvidence', () => ({
  createMomentEvidenceFromSession: (...a: unknown[]) => createMomentEvidenceFromSession(...a),
}));

const batchSet = vi.fn();
const batchCommit = vi.fn().mockResolvedValue(undefined);
const setDoc = vi.fn().mockResolvedValue(undefined);
const getDocs = vi.fn();
const doc = vi.fn((...args: unknown[]) => ({ __path: args.slice(1).join('/') }));
const collection = vi.fn((...args: unknown[]) => ({ __path: args.slice(1).join('/') }));
const writeBatch = vi.fn((..._args: unknown[]) => ({ set: batchSet, commit: batchCommit }));
vi.mock('firebase/firestore', () => ({
  collection: (...a: unknown[]) => collection(...a),
  doc: (...a: unknown[]) => doc(...a),
  getDocs: (...a: unknown[]) => getDocs(...a),
  setDoc: (...a: unknown[]) => setDoc(...a),
  writeBatch: (...a: unknown[]) => writeBatch(...a),
  serverTimestamp: () => ({ __ts: true }),
}));

import { syncMomentUnderstanding } from './momentEvidenceStore';

const evidence = (movementId: string) => ({
  id: `ev_moment_s1_${movementId}`,
  source: 'moment',
  movementId,
  direction: 0.8,
  strength: 0.8,
  mappingConfidence: 0.9,
  lifecycleStatus: 'active',
});

beforeEach(() => {
  authState.currentUser = { uid: 'u1' };
  exportAll.mockReset();
  createMomentEvidenceFromSession.mockReset();
  batchSet.mockReset();
  batchCommit.mockReset().mockResolvedValue(undefined);
  setDoc.mockReset().mockResolvedValue(undefined);
  getDocs.mockReset();
  doc.mockClear();
  writeBatch.mockClear();
});

describe('syncMomentUnderstanding', () => {
  it('persists evidence + a momentReady profile, and never touches Reflect fields', async () => {
    exportAll.mockResolvedValue({
      schemaVersion: 1,
      activeSession: null,
      completedSessions: [{ id: 's1', status: 'completed', sketch: { number: 1 } }],
    });
    const evs = [evidence('direct_expression'), evidence('trust_openness')];
    createMomentEvidenceFromSession.mockReturnValue(evs);
    getDocs.mockResolvedValue({ docs: evs.map((e) => ({ data: () => e })) });

    await syncMomentUnderstanding();

    // Evidence written to the durable subcollection (one set per item).
    expect(batchSet).toHaveBeenCalledTimes(2);
    expect(batchCommit).toHaveBeenCalledTimes(1);

    // Exactly one user-doc write — the denormalized matching cache.
    expect(setDoc).toHaveBeenCalledTimes(1);
    const payload = setDoc.mock.calls[0][1] as Record<string, any>;

    // It carries the Moment channel...
    expect(payload.momentProfile.movements).toHaveLength(2);
    expect(payload.profile.momentReady).toBe(true);
    expect(Object.keys(payload).sort()).toEqual(['momentProfile', 'profile']);
    expect(Object.keys(payload.profile).sort()).toEqual(['momentReady', 'updatedAt']);

    // ...and NOTHING from the Reflect channel.
    const serialized = JSON.stringify(payload);
    for (const forbidden of ['emergentTraits', 'matchReady', 'soulProfile', 'reflectModel', 'traitInferenceMeta']) {
      expect(serialized).not.toContain(forbidden);
    }
  });

  it('is a no-op when signed out', async () => {
    authState.currentUser = null;
    await syncMomentUnderstanding();
    expect(exportAll).not.toHaveBeenCalled();
    expect(setDoc).not.toHaveBeenCalled();
  });

  it('still refreshes the profile when there are no local sessions (cross-device)', async () => {
    // Device B: empty local, but Firestore already holds this user's evidence.
    exportAll.mockResolvedValue({ schemaVersion: 1, activeSession: null, completedSessions: [] });
    const evs = [evidence('direct_expression'), evidence('trust_openness')];
    getDocs.mockResolvedValue({ docs: evs.map((e) => ({ data: () => e })) });

    await syncMomentUnderstanding();

    expect(createMomentEvidenceFromSession).not.toHaveBeenCalled(); // nothing local to push
    expect(batchSet).not.toHaveBeenCalled();
    expect(setDoc).toHaveBeenCalledTimes(1); // profile still rebuilt from durable evidence
    expect((setDoc.mock.calls[0][1] as Record<string, any>).profile.momentReady).toBe(true);
  });
});
