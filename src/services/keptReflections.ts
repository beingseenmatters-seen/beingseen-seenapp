/**
 * Reflection History — durable data capability (Phase 4 · Sprint 3).
 *
 * EX-001 §2/§8: history is the person's collection of *approved Reflections* —
 * "the smallest true thing" they chose to keep — never conversation transcripts.
 * Reflections stay until the person removes them (no expiry, no counts, no streaks).
 *
 * Storage model (per founder review):
 *  - The local abstraction REMAINS: a localStorage cache is the fast, offline,
 *    and signed-out store. Reads are synchronous from this cache.
 *  - Firestore (`users/{uid}/keptReflections/{id}`) is the durable BACKING store
 *    so reflections persist across devices once the person is signed in.
 *  - Writes are write-through: cache first (instant), then Firestore best-effort.
 *  - On sign-in, `hydrateKeptReflections` reconciles cache and Firestore.
 *
 * The Me page surfaces this in Sprint 3 via `useKeptReflections`.
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

const STORAGE_KEY = 'seen_kept_reflections';
/** Fired (same-tab) whenever the kept-reflections store changes. */
export const KEPT_REFLECTIONS_EVENT = 'seen:kept-reflections-changed';

function readAll(): KeptReflection[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as KeptReflection[];
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function writeAll(reflections: KeptReflection[]): void {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(reflections));
  try {
    window.dispatchEvent(new CustomEvent(KEPT_REFLECTIONS_EVENT));
  } catch {
    // SSR / non-browser — no-op
  }
}

function currentUid(): string | null {
  return auth.currentUser?.uid ?? null;
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

/** All kept reflections (from the local cache), most recent first. */
export function getKeptReflections(): KeptReflection[] {
  return readAll().sort((a, b) => b.createdAt - a.createdAt);
}

/**
 * Persist an approved reflection. Returns the stored record, or null when the
 * reflection has no meaningful text. Writes the cache synchronously, then the
 * Firestore backing store best-effort (when signed in).
 */
export function saveKeptReflection(input: {
  text: string;
  language: 'zh' | 'en';
  sessionId?: string;
}): KeptReflection | null {
  const text = input.text?.trim();
  if (!text) return null;

  const reflection: KeptReflection = {
    id: crypto.randomUUID(),
    text,
    createdAt: Date.now(),
    language: input.language,
    sessionId: input.sessionId,
  };

  const all = readAll();
  all.unshift(reflection);
  writeAll(all);

  const uid = currentUid();
  if (uid) {
    void setDoc(doc(reflectionsCollection(uid), reflection.id), toFirestore(reflection)).catch(
      (err) => console.warn('[KeptReflections] Firestore write failed (cached locally):', err),
    );
  }

  return reflection;
}

/** Remove a single kept reflection from cache and the backing store. */
export function deleteKeptReflection(id: string): void {
  writeAll(readAll().filter((r) => r.id !== id));

  const uid = currentUid();
  if (uid) {
    void deleteDoc(doc(reflectionsCollection(uid), id)).catch((err) =>
      console.warn('[KeptReflections] Firestore delete failed:', err),
    );
  }
}

/** Remove every kept reflection from the local cache (does not bulk-clear Firestore). */
export function clearKeptReflections(): void {
  writeAll([]);
}

/**
 * Reconcile the local cache with the Firestore backing store for the signed-in
 * user. Firestore is authoritative for reflections it already holds; any
 * cache-only reflections (e.g. created while signed out) are migrated up so the
 * person never loses a kept reflection when they sign in. Safe to call on auth
 * changes; no-ops when signed out.
 */
export async function hydrateKeptReflections(): Promise<void> {
  const uid = currentUid();
  if (!uid) return;

  try {
    const snapshot = await getDocs(reflectionsCollection(uid));
    const remote: KeptReflection[] = snapshot.docs.map((d) => {
      const data = d.data() as Partial<KeptReflection>;
      return {
        id: d.id,
        text: typeof data.text === 'string' ? data.text : '',
        createdAt: typeof data.createdAt === 'number' ? data.createdAt : Date.now(),
        language: data.language === 'en' ? 'en' : 'zh',
        sessionId: typeof data.sessionId === 'string' ? data.sessionId : undefined,
      };
    });

    const remoteIds = new Set(remote.map((r) => r.id));
    const cacheOnly = readAll().filter((r) => !remoteIds.has(r.id) && r.text.trim());

    // Migrate cache-only reflections to the durable backing store.
    await Promise.all(
      cacheOnly.map((r) =>
        setDoc(doc(reflectionsCollection(uid), r.id), toFirestore(r)).catch((err) =>
          console.warn('[KeptReflections] Firestore migrate failed:', err),
        ),
      ),
    );

    const merged = [...remote, ...cacheOnly].sort((a, b) => b.createdAt - a.createdAt);
    writeAll(merged);
  } catch (err) {
    console.warn('[KeptReflections] Firestore hydrate failed (using local cache):', err);
  }
}

/**
 * Subscribe to store changes (same-tab custom event + cross-tab storage event).
 * Returns an unsubscribe function.
 */
export function subscribeKeptReflections(callback: () => void): () => void {
  const onChange = () => callback();
  const onStorage = (e: StorageEvent) => {
    if (e.key === STORAGE_KEY) callback();
  };
  window.addEventListener(KEPT_REFLECTIONS_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(KEPT_REFLECTIONS_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}
