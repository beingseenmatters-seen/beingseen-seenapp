/**
 * Moments session service — the single storage boundary for Moments V0.1.
 *
 * V0.1 is frontend-only: everything persists locally under one user-scoped
 * key (per Firebase uid) so data from different users on the same browser
 * cannot mix. UI components never touch localStorage directly; they only call
 * this async service, so a future Firestore-backed implementation can replace
 * `KeyValueStore` without rewriting pages or components.
 *
 * No Firestore, Lambda, SeenUser, soulProfile, emergentTraits or matching
 * writes happen here.
 */

import type {
  MomentDefinition,
  MomentSnapshot,
  MomentsSession,
  MomentsUserData,
  SketchSummary,
} from '../../types/moments';
import { getActiveMoments } from './config';
import { generateSketchV2 } from './sketchEngineV2';

/** Minimal async key-value boundary a future Firestore adapter can implement. */
export interface KeyValueStore {
  get(key: string): Promise<string | null>;
  set(key: string, value: string): Promise<void>;
  remove(key: string): Promise<void>;
}

export class LocalStorageStore implements KeyValueStore {
  async get(key: string): Promise<string | null> {
    return localStorage.getItem(key);
  }
  async set(key: string, value: string): Promise<void> {
    localStorage.setItem(key, value);
  }
  async remove(key: string): Promise<void> {
    localStorage.removeItem(key);
  }
}

export class InMemoryStore implements KeyValueStore {
  private map = new Map<string, string>();
  async get(key: string): Promise<string | null> {
    return this.map.has(key) ? (this.map.get(key) as string) : null;
  }
  async set(key: string, value: string): Promise<void> {
    this.map.set(key, value);
  }
  async remove(key: string): Promise<void> {
    this.map.delete(key);
  }
}

const STORAGE_KEY_PREFIX = 'seen_moments_v1_';
const SESSION_SIZE = 10;

function emptyData(): MomentsUserData {
  return { schemaVersion: 1, activeSession: null, completedSessions: [] };
}

function makeSessionId(): string {
  if (typeof crypto !== 'undefined' && typeof crypto.randomUUID === 'function') {
    return `ms_${crypto.randomUUID()}`;
  }
  return `ms_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

function shuffle<T>(items: T[], rng: () => number): T[] {
  const arr = items.slice();
  for (let i = arr.length - 1; i > 0; i--) {
    const j = Math.floor(rng() * (i + 1));
    [arr[i], arr[j]] = [arr[j], arr[i]];
  }
  return arr;
}

function toSnapshot(moment: MomentDefinition): MomentSnapshot {
  return {
    momentId: moment.id,
    version: moment.version,
    interactionType: moment.interactionType,
    title: moment.title,
    scenario: moment.scenario,
    emoji: moment.emoji,
    hint: moment.hint,
    minSelection: moment.minSelection,
    maxSelection: moment.maxSelection,
    maxRank: moment.maxRank,
    options: moment.options.map((o) => ({
      id: o.id,
      text: o.text,
      interpretation: o.interpretation,
      weight: o.weight,
      signals: o.signals,
    })),
  };
}

/**
 * Validate a selection against a Moment snapshot's constraints.
 * Returns human-readable problems; empty list means valid.
 */
export function validateSelection(snapshot: MomentSnapshot, selectedOptionIds: string[]): string[] {
  const errs: string[] = [];
  const validIds = new Set(snapshot.options.map((o) => o.id));
  const unique = new Set(selectedOptionIds);

  if (selectedOptionIds.some((id) => !validIds.has(id))) {
    errs.push(`Unknown option id for ${snapshot.momentId}`);
  }
  if (unique.size !== selectedOptionIds.length) {
    errs.push(`Duplicate option ids for ${snapshot.momentId}`);
  }

  if (snapshot.interactionType === 'single_choice') {
    if (selectedOptionIds.length !== 1) {
      errs.push(`${snapshot.momentId}: single_choice requires exactly one selection`);
    }
  } else if (snapshot.interactionType === 'multiple_choice') {
    const min = snapshot.minSelection ?? 1;
    const max = snapshot.maxSelection ?? snapshot.options.length;
    if (selectedOptionIds.length < min || selectedOptionIds.length > max) {
      errs.push(`${snapshot.momentId}: multiple_choice requires between ${min} and ${max} selections`);
    }
  } else if (snapshot.interactionType === 'ranking') {
    const required = snapshot.maxRank ?? snapshot.options.length;
    if (selectedOptionIds.length !== required) {
      errs.push(`${snapshot.momentId}: ranking requires exactly ${required} ordered selections`);
    }
  }

  return errs;
}

export function answeredCount(session: MomentsSession): number {
  return session.momentIds.filter((id) => !!session.answers[id]).length;
}

/** The next unanswered Moment index in locked order (or momentIds.length when done). */
export function nextQuestionIndex(session: MomentsSession): number {
  const idx = session.momentIds.findIndex((id) => !session.answers[id]);
  return idx === -1 ? session.momentIds.length : idx;
}

export interface MomentsOverview {
  activeSession: MomentsSession | null;
  answeredCount: number;
  sessionSize: number;
  completedCount: number;
  latestCompletedSessionId: string | null;
}

export class MomentsService {
  private store: KeyValueStore;
  private getUid: () => string | null;
  private library: () => MomentDefinition[];
  private rng: () => number;
  private now: () => number;

  constructor(
    store: KeyValueStore,
    getUid: () => string | null,
    library: () => MomentDefinition[] = getActiveMoments,
    rng: () => number = Math.random,
    now: () => number = Date.now,
  ) {
    this.store = store;
    this.getUid = getUid;
    this.library = library;
    this.rng = rng;
    this.now = now;
  }

  private key(): string {
    return `${STORAGE_KEY_PREFIX}${this.getUid() ?? 'anonymous'}`;
  }

  /** Corrupt or missing storage degrades to a fresh empty state. */
  private async read(): Promise<MomentsUserData> {
    try {
      const raw = await this.store.get(this.key());
      if (!raw) return emptyData();
      const parsed = JSON.parse(raw) as MomentsUserData;
      if (
        !parsed ||
        parsed.schemaVersion !== 1 ||
        !Array.isArray(parsed.completedSessions) ||
        parsed.activeSession === undefined
      ) {
        return emptyData();
      }
      return parsed;
    } catch {
      return emptyData();
    }
  }

  private async write(data: MomentsUserData): Promise<void> {
    await this.store.set(this.key(), JSON.stringify(data));
  }

  /**
   * Create a new session, or return the existing unfinished one — an
   * unfinished session is never silently replaced. Discarding is a separate,
   * deliberate action (`discardActiveSession`).
   */
  async createSession(): Promise<MomentsSession> {
    const data = await this.read();
    if (data.activeSession) return data.activeSession;

    const pool = this.library();
    if (!pool.length) throw new Error('No active Moments available');
    const selected = shuffle(pool, this.rng).slice(0, SESSION_SIZE);

    const ts = this.now();
    const session: MomentsSession = {
      id: makeSessionId(),
      status: 'active',
      momentIds: selected.map((m) => m.id),
      momentVersions: Object.fromEntries(selected.map((m) => [m.id, m.version])),
      snapshots: selected.map(toSnapshot),
      answers: {},
      createdAt: ts,
      updatedAt: ts,
    };
    data.activeSession = session;
    await this.write(data);
    return session;
  }

  async loadActiveSession(): Promise<MomentsSession | null> {
    return (await this.read()).activeSession;
  }

  /** Save (or overwrite) one answer. Persists immediately so refreshes resume correctly. */
  async saveAnswer(
    sessionId: string,
    momentId: string,
    selectedOptionIds: string[],
  ): Promise<MomentsSession> {
    const data = await this.read();
    const session = data.activeSession;
    if (!session || session.id !== sessionId) {
      throw new Error('No matching active session');
    }
    const snapshot = session.snapshots.find((s) => s.momentId === momentId);
    if (!snapshot) throw new Error(`Moment ${momentId} is not part of this session`);
    const problems = validateSelection(snapshot, selectedOptionIds);
    if (problems.length) throw new Error(problems.join('; '));

    session.answers[momentId] = {
      momentId,
      selectedOptionIds: selectedOptionIds.slice(),
      answeredAt: this.now(),
    };
    session.updatedAt = this.now();
    await this.write(data);
    return session;
  }

  /**
   * Complete the active session: generates the deterministic sketch, stores it
   * with the session and moves it to history. Completing an already-completed
   * session returns the stored result unchanged (duplicate protection).
   */
  async completeSession(
    sessionId: string,
    language: 'zh' | 'en' = 'zh',
  ): Promise<MomentsSession> {
    const data = await this.read();

    const already = data.completedSessions.find((s) => s.id === sessionId);
    if (already) return already;

    const session = data.activeSession;
    if (!session || session.id !== sessionId) {
      throw new Error('No matching active session');
    }
    const unanswered = session.momentIds.filter((id) => !session.answers[id]);
    if (unanswered.length) {
      throw new Error(`Session incomplete: ${unanswered.length} unanswered`);
    }

    // Sketch Engine V2: continuity + delta. Prior retained sessions provide
    // the pre-session Behaviour Understanding; the last two sketches'
    // provenance drives cooldowns and framing rotation.
    const retained = data.completedSessions.filter((s) => s.sketch);
    const sketchNumber = data.completedSessions.length + 1;
    const result = generateSketchV2({
      session,
      priorSessions: retained,
      recentProvenance: retained
        .slice(-2)
        .map((s) => s.sketch!.provenance)
        .filter((p): p is NonNullable<typeof p> => !!p),
      sketchNumber,
      language,
    });
    const ts = this.now();
    session.status = 'completed';
    session.completedAt = ts;
    session.updatedAt = ts;
    session.sketch = {
      number: sketchNumber,
      text: result.text,
      generatedAt: ts,
      engineVersion: result.engineVersion,
      language,
      provenance: result.provenance,
    };
    data.completedSessions.push(session);
    data.activeSession = null;
    await this.write(data);
    return session;
  }

  /**
   * Delete one retained session (and its sketch). Its Behaviour evidence is
   * withdrawn with it: understanding is always recombined from the retained
   * sessions that remain, so every later sketch computes without it.
   */
  async deleteCompletedSession(sessionId: string): Promise<void> {
    const data = await this.read();
    const next = data.completedSessions.filter((s) => s.id !== sessionId);
    if (next.length === data.completedSessions.length) return;
    data.completedSessions = next;
    await this.write(data);
  }

  /** Deliberate discard of an unfinished session (UI must confirm first). */
  async discardActiveSession(): Promise<void> {
    const data = await this.read();
    if (!data.activeSession) return;
    data.activeSession = null;
    await this.write(data);
  }

  async listSketches(): Promise<SketchSummary[]> {
    const data = await this.read();
    return data.completedSessions
      .filter((s) => s.sketch)
      .map((s) => ({
        sessionId: s.id,
        number: s.sketch!.number,
        completedAt: s.completedAt ?? s.updatedAt,
        preview: s.sketch!.text.slice(0, 60),
      }))
      .sort((a, b) => b.completedAt - a.completedAt);
  }

  async loadSketchDetail(sessionId: string): Promise<MomentsSession | null> {
    const data = await this.read();
    return data.completedSessions.find((s) => s.id === sessionId) ?? null;
  }

  /** One call for the Me page card states. */
  async getOverview(): Promise<MomentsOverview> {
    const data = await this.read();
    const sketches = data.completedSessions.filter((s) => s.sketch);
    const latest = sketches.length
      ? sketches.reduce((a, b) => ((a.completedAt ?? 0) >= (b.completedAt ?? 0) ? a : b))
      : null;
    return {
      activeSession: data.activeSession,
      answeredCount: data.activeSession ? answeredCount(data.activeSession) : 0,
      sessionSize: data.activeSession ? data.activeSession.momentIds.length : SESSION_SIZE,
      completedCount: sketches.length,
      latestCompletedSessionId: latest?.id ?? null,
    };
  }

  /** Remove all local Moments data for the current person. */
  async clearAll(): Promise<void> {
    await this.store.remove(this.key());
  }

  /** Full raw export (technical fields included; caller decides presentation). */
  async exportAll(): Promise<MomentsUserData> {
    return this.read();
  }
}
