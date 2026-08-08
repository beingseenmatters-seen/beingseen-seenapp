/**
 * Current Understanding — derived-cache persistence.
 *
 * Evidence is the SSOT (users/{uid}/reflectInsights + users/{uid}/momentEvidence).
 * Current Understanding is a deterministic, rebuildable projection: recomposed on
 * every evidence change and on login, cached to Firestore (users/{uid}.currentUnderstanding)
 * and mirrored locally. Always reproducible from evidence → never device-local-only.
 *
 * NEVER reads or writes soulProfile / emergentTraits / matchReady / Matching.
 * The stored object carries internal fields (weight/direction/…) only so the letter
 * can be rebuilt; the UI renders ONLY the assembled letter — the user never sees them.
 */

import { collection, doc, getDoc, getDocs, serverTimestamp, setDoc } from 'firebase/firestore';
import { auth, db } from '../firebase';
import { userScopedKey } from '../userScopedStorage';
import { readSessionInsights } from '../userSummary';
import type { UnderstandingEvidence } from '../../types/evidence';
import { composeCurrentUnderstanding } from './understandingComposer';
import type { CurrentUnderstanding } from './currentUnderstanding';

const CU_KEY_PREFIX = 'seen_current_understanding_v1_';
const FIRESTORE_WRITE_MS = 12_000;

function currentUid(): string | null {
  return auth.currentUser?.uid ?? null;
}

async function withTimeout<T>(p: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      p,
      new Promise<never>((_, rej) => {
        timer = setTimeout(() => rej(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/** The current cached understanding for this uid (offline mirror). */
export function readCurrentUnderstanding(): CurrentUnderstanding | null {
  const uid = currentUid();
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(userScopedKey(CU_KEY_PREFIX, uid));
    if (!raw) return null;
    const parsed = JSON.parse(raw) as CurrentUnderstanding;
    return parsed?.facets ? parsed : null;
  } catch {
    return null;
  }
}

/**
 * Recompose Current Understanding from durable evidence and persist it
 * (Firestore derived cache + local mirror). Call after a Reflect Keep, a Moments
 * completion, and on login. Fire-and-forget; failures keep the last cache.
 */
export async function refreshCurrentUnderstanding(): Promise<CurrentUnderstanding | null> {
  const uid = currentUid();
  if (!uid) return null;
  try {
    const reflectInsights = readSessionInsights(); // local, hydrated from Firestore SSOT on login
    const snapshot = await getDocs(collection(db, 'users', uid, 'momentEvidence'));
    const momentEvidence = snapshot.docs.map((d) => d.data() as UnderstandingEvidence);

    const cu = composeCurrentUnderstanding({ reflectInsights, momentEvidence, now: Date.now() });

    try {
      localStorage.setItem(userScopedKey(CU_KEY_PREFIX, uid), JSON.stringify(cu));
    } catch {
      /* storage unavailable — Firestore write below is still the durable copy */
    }

    // Derived cache on the user doc — its OWN field, never soulProfile. merge
    // preserves matchReady/momentReady/emergentTraits untouched.
    await withTimeout(
      setDoc(
        doc(db, 'users', uid),
        { currentUnderstanding: { ...cu, updatedAt: serverTimestamp() } },
        { merge: true },
      ),
      FIRESTORE_WRITE_MS,
      'current understanding write',
    );
    return cu;
  } catch (err) {
    console.warn('[CurrentUnderstanding] refresh failed (keeping last cache):', err);
    return readCurrentUnderstanding();
  }
}

/** Cross-device first paint: pull the cached projection into the local mirror. */
export async function hydrateCurrentUnderstanding(): Promise<void> {
  const uid = currentUid();
  if (!uid) return;
  try {
    const snap = await getDoc(doc(db, 'users', uid));
    const cu = snap.exists() ? (snap.data() as { currentUnderstanding?: CurrentUnderstanding }).currentUnderstanding : null;
    if (cu?.facets) {
      localStorage.setItem(userScopedKey(CU_KEY_PREFIX, uid), JSON.stringify(cu));
    }
  } catch (err) {
    console.warn('[CurrentUnderstanding] hydrate failed:', err);
  }
}
