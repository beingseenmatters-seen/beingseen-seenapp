import { describe, it, expect } from 'vitest';
import type { MomentDefinition, MomentSnapshot } from '../../types/moments';
import { MOMENT_LIBRARY } from '../../data/moments/library';
import { getActiveMoments } from './config';
import {
  InMemoryStore,
  MomentsService,
  nextQuestionIndex,
  validateSelection,
  type KeyValueStore,
} from './momentsService';
import { RANKING_TEST_FIXTURE, SAMPLE_PROFILE_A } from './testFixtures';

function makeService(opts: {
  store?: KeyValueStore;
  uid?: string | null;
  library?: () => MomentDefinition[];
} = {}) {
  return new MomentsService(
    opts.store ?? new InMemoryStore(),
    () => (opts.uid === undefined ? 'user-1' : opts.uid),
    opts.library ?? getActiveMoments,
  );
}

function defaultChoiceForSnapshot(snap: MomentSnapshot, momentId: string): string[] {
  const fromProfile = SAMPLE_PROFILE_A[momentId];
  if (fromProfile) return fromProfile;
  if (snap.interactionType === 'ranking') {
    const n = snap.maxRank ?? snap.options.length;
    return snap.options.slice(0, n).map((o) => o.id);
  }
  return [snap.options[0].id];
}

/** Answer every Moment in a session with the approved sample-A choices (or valid defaults). */
async function answerAll(service: MomentsService, sessionId: string) {
  let session = (await service.loadActiveSession())!;
  for (const momentId of session.momentIds) {
    const snap = session.snapshots.find((s) => s.momentId === momentId)!;
    session = await service.saveAnswer(
      sessionId,
      momentId,
      defaultChoiceForSnapshot(snap, momentId),
    );
  }
  return session;
}

function tinyLibrary(scenarioZh = '场景一'): MomentDefinition[] {
  return [
    {
      id: 'T-01',
      version: 1,
      status: 'active',
      interactionType: 'single_choice',
      title: { zh: '一' },
      scenario: { zh: scenarioZh },
      options: [
        { id: 'A', text: { zh: '甲' }, signals: [{ signal: 'CHG-01', delta: 0.5, confidence: 'medium' }] },
        { id: 'B', text: { zh: '乙' }, signals: [{ signal: 'TRU-01', delta: 0.4, confidence: 'low' }] },
      ],
    },
    {
      id: 'T-02',
      version: 1,
      status: 'active',
      interactionType: 'single_choice',
      title: { zh: '二' },
      scenario: { zh: '场景二' },
      options: [
        { id: 'A', text: { zh: '丙' }, signals: [] },
        { id: 'B', text: { zh: '丁' }, signals: [] },
      ],
    },
  ];
}

describe('session creation and locking', () => {
  it('creates a session of 10 Moments drawn from the active pool, locked ids, versions and snapshots', async () => {
    const service = makeService();
    const session = await service.createSession();
    expect(session.momentIds).toHaveLength(10);
    expect(new Set(session.momentIds).size).toBe(10);
    expect(session.snapshots).toHaveLength(10);
    for (const momentId of session.momentIds) {
      const m = MOMENT_LIBRARY.find((x) => x.id === momentId)!;
      expect(session.momentVersions[momentId]).toBe(m.version);
    }
    expect(session.id).toMatch(/^ms_/);
    expect(session.createdAt).toBeGreaterThan(0);
    expect(session.updatedAt).toBeGreaterThanOrEqual(session.createdAt);
  });

  it('does not silently replace an unfinished session', async () => {
    const store = new InMemoryStore();
    const service = makeService({ store });
    const first = await service.createSession();
    const second = await service.createSession();
    expect(second.id).toBe(first.id);
    expect(second.momentIds).toEqual(first.momentIds);
  });

  it('keeps the locked Moment order across a refresh (new service instance)', async () => {
    const store = new InMemoryStore();
    const service = makeService({ store });
    const created = await service.createSession();

    const afterRefresh = makeService({ store });
    const loaded = await afterRefresh.loadActiveSession();
    expect(loaded?.id).toBe(created.id);
    expect(loaded?.momentIds).toEqual(created.momentIds);
    expect(loaded?.momentVersions).toEqual(created.momentVersions);
  });
});

describe('answers, resume and validation', () => {
  it('persists each answer and resumes at the next unanswered question', async () => {
    const store = new InMemoryStore();
    const service = makeService({ store });
    const session = await service.createSession();

    const firstId = session.momentIds[0];
    const firstSnap = session.snapshots.find((s) => s.momentId === firstId)!;
    await service.saveAnswer(
      session.id,
      firstId,
      defaultChoiceForSnapshot(firstSnap, firstId),
    );

    const resumed = (await makeService({ store }).loadActiveSession())!;
    expect(nextQuestionIndex(resumed)).toBe(1);
    expect(resumed.answers[firstId]).toBeDefined();
  });

  it('rejects invalid single-choice selections', () => {
    const snap: MomentSnapshot = {
      momentId: 'S',
      version: 1,
      interactionType: 'single_choice',
      title: { zh: 's' },
      scenario: { zh: 's' },
      options: [
        { id: 'A', text: { zh: 'a' }, signals: [] },
        { id: 'B', text: { zh: 'b' }, signals: [] },
      ],
    };
    expect(validateSelection(snap, ['A'])).toEqual([]);
    expect(validateSelection(snap, [])).not.toEqual([]);
    expect(validateSelection(snap, ['A', 'B'])).not.toEqual([]);
    expect(validateSelection(snap, ['Z'])).not.toEqual([]);
  });

  it('enforces multiple-choice min/max constraints', () => {
    const snap: MomentSnapshot = {
      momentId: 'M',
      version: 1,
      interactionType: 'multiple_choice',
      title: { zh: 'm' },
      scenario: { zh: 'm' },
      minSelection: 1,
      maxSelection: 3,
      options: ['A', 'B', 'C', 'D'].map((id) => ({ id, text: { zh: id }, signals: [] })),
    };
    expect(validateSelection(snap, ['A'])).toEqual([]);
    expect(validateSelection(snap, ['A', 'B', 'C'])).toEqual([]);
    expect(validateSelection(snap, [])).not.toEqual([]);
    expect(validateSelection(snap, ['A', 'B', 'C', 'D'])).not.toEqual([]);
    expect(validateSelection(snap, ['A', 'A'])).not.toEqual([]);
  });

  it('enforces ranking constraints using the test fixture', () => {
    const snap: MomentSnapshot = {
      momentId: RANKING_TEST_FIXTURE.id,
      version: RANKING_TEST_FIXTURE.version,
      interactionType: 'ranking',
      title: RANKING_TEST_FIXTURE.title,
      scenario: RANKING_TEST_FIXTURE.scenario,
      maxRank: RANKING_TEST_FIXTURE.maxRank,
      options: RANKING_TEST_FIXTURE.options.map((o) => ({ id: o.id, text: o.text, signals: o.signals })),
    };
    expect(validateSelection(snap, ['B', 'A'])).toEqual([]);
    expect(validateSelection(snap, ['A'])).not.toEqual([]); // too few
    expect(validateSelection(snap, ['A', 'B', 'C'])).not.toEqual([]); // too many
    expect(validateSelection(snap, ['A', 'A'])).not.toEqual([]); // duplicate
  });

  it('rejects answers for Moments outside the session or without an active session', async () => {
    const service = makeService();
    const session = await service.createSession();
    await expect(service.saveAnswer(session.id, 'NOT-IN-SESSION', ['A'])).rejects.toThrow();
    await expect(service.saveAnswer('wrong-session', session.momentIds[0], ['A'])).rejects.toThrow();
  });
});

describe('completion, duplicate protection and sketches', () => {
  it('refuses to complete with unanswered questions', async () => {
    const service = makeService();
    const session = await service.createSession();
    await expect(service.completeSession(session.id)).rejects.toThrow(/unanswered/);
  });

  it('completes once, stores a deterministic sketch, and protects against duplicate completion', async () => {
    const service = makeService();
    const session = await service.createSession();
    await answerAll(service, session.id);

    const completed = await service.completeSession(session.id);
    expect(completed.status).toBe('completed');
    expect(completed.sketch?.number).toBe(1);
    expect(completed.sketch?.text.length).toBeGreaterThan(0);

    // Duplicate completion returns the stored result unchanged.
    const again = await service.completeSession(session.id);
    expect(again.sketch?.text).toBe(completed.sketch?.text);
    expect(again.sketch?.generatedAt).toBe(completed.sketch?.generatedAt);
    expect((await service.listSketches())).toHaveLength(1);

    // Active session is gone; a new one can start.
    expect(await service.loadActiveSession()).toBeNull();
  });

  it('lists sketches with numbers, dates and previews', async () => {
    const service = makeService();
    const s1 = await service.createSession();
    await answerAll(service, s1.id);
    await service.completeSession(s1.id);

    const s2 = await service.createSession();
    expect(s2.id).not.toBe(s1.id);
    await answerAll(service, s2.id);
    await service.completeSession(s2.id);

    const sketches = await service.listSketches();
    expect(sketches).toHaveLength(2);
    expect(sketches[0].number).toBe(2); // newest first
    expect(sketches[1].number).toBe(1);
    expect(sketches[0].preview.length).toBeGreaterThan(0);
  });

  it('keeps old completed sketches readable via snapshots even after content changes', async () => {
    const store = new InMemoryStore();
    const v1 = makeService({ store, library: () => tinyLibrary('原来的问题') });
    const session = await v1.createSession();
    for (const momentId of session.momentIds) {
      await v1.saveAnswer(session.id, momentId, ['A']);
    }
    const completed = await v1.completeSession(session.id);
    const storedText = completed.sketch!.text;

    // Later "release": same store, changed wording + bumped versions.
    const v2 = makeService({
      store,
      library: () => tinyLibrary('改过的问题').map((m) => ({ ...m, version: 2 })),
    });
    const detail = await v2.loadSketchDetail(session.id);
    expect(detail?.snapshots.find((s) => s.momentId === 'T-01')?.scenario.zh).toBe('原来的问题');
    expect(detail?.momentVersions['T-01']).toBe(1);
    expect(detail?.sketch?.text).toBe(storedText);
  });
});

describe('user scoping, discard, corrupt storage, clear and export', () => {
  it('scopes storage by uid so users on the same browser cannot mix', async () => {
    const store = new InMemoryStore();
    const alice = makeService({ store, uid: 'alice' });
    const bob = makeService({ store, uid: 'bob' });

    const aliceSession = await alice.createSession();
    expect(await bob.loadActiveSession()).toBeNull();

    const bobSession = await bob.createSession();
    expect(bobSession.id).not.toBe(aliceSession.id);
    expect((await alice.loadActiveSession())?.id).toBe(aliceSession.id);
  });

  it('discards an unfinished session only through the deliberate action', async () => {
    const service = makeService();
    const first = await service.createSession();
    await service.discardActiveSession();
    expect(await service.loadActiveSession()).toBeNull();
    const second = await service.createSession();
    expect(second.id).not.toBe(first.id);
  });

  it('degrades gracefully when local storage is corrupt', async () => {
    const store = new InMemoryStore();
    await store.set('seen_moments_v1_user-1', '{not valid json!!');
    const service = makeService({ store });
    expect(await service.loadActiveSession()).toBeNull();
    expect(await service.listSketches()).toEqual([]);
    const session = await service.createSession();
    expect(session.momentIds).toHaveLength(10);
  });

  it('clears all local Moments data', async () => {
    const service = makeService();
    const session = await service.createSession();
    await answerAll(service, session.id);
    await service.completeSession(session.id);

    await service.clearAll();
    expect(await service.loadActiveSession()).toBeNull();
    expect(await service.listSketches()).toEqual([]);
  });

  it('exports the full local dataset including sessions and sketches', async () => {
    const service = makeService();
    const session = await service.createSession();
    await answerAll(service, session.id);
    await service.completeSession(session.id);

    const exported = await service.exportAll();
    expect(exported.schemaVersion).toBe(1);
    expect(exported.activeSession).toBeNull();
    expect(exported.completedSessions).toHaveLength(1);
    expect(exported.completedSessions[0].sketch?.text.length).toBeGreaterThan(0);
    expect(exported.completedSessions[0].snapshots).toHaveLength(10);
  });
});
