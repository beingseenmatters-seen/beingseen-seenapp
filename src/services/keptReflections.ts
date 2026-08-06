/**
 * Reflection History — durable data capability (Phase 4 · Sprint 3).
 *
 * Account isolation (P0):
 *  - Local cache is uid-scoped. Never a device-global list.
 *  - Firestore (`users/{uid}/keptReflections/{id}`) is the source of truth.
 *  - Local cache is only an offline mirror for that uid.
 *  - Hydration REPLACES the mirror for the current uid. Never merges
 *    another user's cache. Never migrates records across uids.
 *  - Logout detaches the previous user's local mirror completely.
 *
 * The Me page surfaces this via `useKeptReflections` as「我留下的理解」—
 * a history of user-approved Reflect Understanding Updates only.
 *
 * Founder Decision: this is NOT Current Understanding and must not be
 * promoted into Current Understanding automatically.
 *
 * Founder Architecture Decision — FROZEN (2026-08-06):
 * This store holds the only long-term user-facing Reflect artifact:
 * approved Understanding Updates. Full conversation transcripts belong only
 * to short-term unfinished/continue flows and must not become permanent
 * history here. Moments retain Sketches independently.
 */

import { auth, db } from './firebase';
import {
  collection,
  deleteDoc,
  doc,
  getDocs,
  setDoc,
} from 'firebase/firestore';

export interface KeptReflection {
  id: string;
  /** The approved reflection, in the person's own words, slightly clearer. */
  text: string;
  createdAt: number;
  language: 'zh' | 'en';
  /** The Reflect session this reflection came from, if known. */
  sessionId?: string;
}

/** Legacy device-global key — must never be used as a live store. */
const LEGACY_GLOBAL_KEY = 'seen_kept_reflections';

const STORAGE_KEY_PREFIX = 'seen_kept_reflections_v2_';

/** Fired (same-tab) whenever the kept-reflections store changes. */
export const KEPT_REFLECTIONS_EVENT = 'seen:kept-reflections-changed';

export function keptReflectionsStorageKey(uid: string): string {
  return `${STORAGE_KEY_PREFIX}${uid}`;
}

function currentUid(): string | null {
  return auth.currentUser?.uid ?? null;
}

function purgeLegacyGlobalCache(): void {
  try {
    localStorage.removeItem(LEGACY_GLOBAL_KEY);
  } catch {
    // ignore
  }
}

function readAllForUid(uid: string): KeptReflection[] {
  try {
    const raw = localStorage.getItem(keptReflectionsStorageKey(uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as KeptReflection[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAllForUid(uid: string, reflections: KeptReflection[]): void {
  localStorage.setItem(keptReflectionsStorageKey(uid), JSON.stringify(reflections));
  notifyKeptReflectionsChanged();
}

function removeAllForUid(uid: string): void {
  try {
    localStorage.removeItem(keptReflectionsStorageKey(uid));
  } catch {
    // ignore
  }
  notifyKeptReflectionsChanged();
}

function notifyKeptReflectionsChanged(): void {
  try {
    window.dispatchEvent(new CustomEvent(KEPT_REFLECTIONS_EVENT));
  } catch {
    // SSR / non-browser — no-op
  }
}

function reflectionsCollection(uid: string) {
  return collection(db, 'users', uid, 'keptReflections');
}

function toFirestore(r: KeptReflection): Record<string, unknown> {
  const payload: Record<string, unknown> = {
    text: r.text,
    createdAt: r.createdAt,
    language: r.language,
  };
  if (r.sessionId) payload.sessionId = r.sessionId;
  return payload;
}

function normalizeRemoteDoc(
  id: string,
  data: Partial<KeptReflection>,
): KeptReflection | null {
  const text = typeof data.text === 'string' ? data.text.trim() : '';
  if (!text) return null;
  return {
    id,
    text,
    createdAt: typeof data.createdAt === 'number' ? data.createdAt : Date.now(),
    language: data.language === 'en' ? 'en' : 'zh',
    sessionId: typeof data.sessionId === 'string' ? data.sessionId : undefined,
  };
}

/**
 * All kept reflections for the signed-in uid (offline mirror), most recent first.
 * Signed out → empty. Never reads another uid's mirror or the legacy global key.
 */
export function getKeptReflections(): KeptReflection[] {
  purgeLegacyGlobalCache();
  const uid = currentUid();
  if (!uid) return [];

  const byId = new Map<string, KeptReflection>();
  for (const r of readAllForUid(uid)) {
    if (!r?.id || !r.text?.trim()) continue;
    const prev = byId.get(r.id);
    if (!prev || r.createdAt > prev.createdAt) byId.set(r.id, r);
  }
  return Array.from(byId.values()).sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Persist an approved reflection for the current uid only.
 * Requires a signed-in user — never writes a device-global cache.
 */
export function saveKeptReflection(input: {
  text: string;
  language: 'zh' | 'en';
  sessionId?: string;
}): KeptReflection | null {
  const text = input.text?.trim();
  if (!text) return null;

  const uid = currentUid();
  if (!uid) {
    console.warn('[KeptReflections] refuse save without signed-in uid (account isolation)');
    return null;
  }

  const reflection: KeptReflection = {
    id: crypto.randomUUID(),
    text,
    createdAt: Date.now(),
    language: input.language,
    sessionId: input.sessionId,
  };

  const all = readAllForUid(uid);
  all.unshift(reflection);
  writeAllForUid(uid, all);

  void setDoc(doc(reflectionsCollection(uid), reflection.id), toFirestore(reflection)).catch(
    (err) => console.warn('[KeptReflections] Firestore write failed (mirrored locally):', err),
  );

  return reflection;
}

/** Remove a single kept reflection from this uid's mirror and Firestore. */
export function deleteKeptReflection(id: string): void {
  const uid = currentUid();
  if (!uid) return;

  writeAllForUid(
    uid,
    readAllForUid(uid).filter((r) => r.id !== id),
  );

  void deleteDoc(doc(reflectionsCollection(uid), id)).catch((err) =>
    console.warn('[KeptReflections] Firestore delete failed:', err),
  );
}

/**
 * Clear the current uid's local offline mirror (does not bulk-clear Firestore).
 * Prefer `detachKeptReflectionsOnLogout` on sign-out.
 */
export function clearKeptReflections(): void {
  purgeLegacyGlobalCache();
  const uid = currentUid();
  if (!uid) {
    notifyKeptReflectionsChanged();
    return;
  }
  removeAllForUid(uid);
}

/**
 * Logout / account switch: completely detach this uid's local mirror and the
 * legacy global key so the next account cannot see or inherit prior data.
 * Call with the uid captured BEFORE Firebase signOut clears auth.currentUser.
 */
export function detachKeptReflectionsOnLogout(uid: string | null | undefined): void {
  purgeLegacyGlobalCache();
  if (uid) removeAllForUid(uid);
  else notifyKeptReflectionsChanged();
}

/**
 * Replace the current uid's offline mirror with Firestore for that uid only.
 * Never merges another user's cache. Never uploads local-only rows into Firestore.
 */
export async function hydrateKeptReflections(): Promise<void> {
  purgeLegacyGlobalCache();

  const uid = currentUid();
  if (!uid) return;

  try {
    const snapshot = await getDocs(reflectionsCollection(uid));
    const remote: KeptReflection[] = [];
    for (const d of snapshot.docs) {
      const row = normalizeRemoteDoc(d.id, d.data() as Partial<KeptReflection>);
      if (row) remote.push(row);
    }
    remote.sort((a, b) => b.createdAt - a.createdAt);
    // REPLACE — never merge prior device cache into this uid.
    writeAllForUid(uid, remote);
  } catch (err) {
    console.warn('[KeptReflections] Firestore hydrate failed (keeping uid mirror if any):', err);
  }
}

/**
 * Subscribe to store changes (same-tab custom event + cross-tab storage event).
 * Returns an unsubscribe function.
 */
export function subscribeKeptReflections(callback: () => void): () => void {
  const onChange = () => callback();
  const onStorage = (e: StorageEvent) => {
    if (
      e.key === LEGACY_GLOBAL_KEY ||
      (typeof e.key === 'string' && e.key.startsWith(STORAGE_KEY_PREFIX))
    ) {
      callback();
    }
  };
  window.addEventListener(KEPT_REFLECTIONS_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(KEPT_REFLECTIONS_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}
