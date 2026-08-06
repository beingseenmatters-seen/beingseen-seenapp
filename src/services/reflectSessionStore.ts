/**
 * Active Reflect session offline mirror — uid-scoped only.
 * Never migrates legacy `seen_reflect_session`.
 */

import { auth } from './firebase';
import { purgeLegacyGlobalUserCaches, userScopedKey } from './userScopedStorage';

export const REFLECT_SESSION_KEY_PREFIX = 'seen_reflect_session_v2_';
const LEGACY_KEY = 'seen_reflect_session';

export function reflectSessionStorageKey(uid: string): string {
  return userScopedKey(REFLECT_SESSION_KEY_PREFIX, uid);
}

function currentUid(): string | null {
  return auth.currentUser?.uid ?? null;
}

/** Load raw JSON for the signed-in uid. Signed out → null. */
export function loadReflectSessionRaw(): string | null {
  purgeLegacyGlobalUserCaches();
  try {
    localStorage.removeItem(LEGACY_KEY);
  } catch {
    // ignore
  }
  const uid = currentUid();
  if (!uid) return null;
  try {
    return localStorage.getItem(reflectSessionStorageKey(uid));
  } catch {
    return null;
  }
}

/** Persist raw JSON for the signed-in uid only. */
export function saveReflectSessionRaw(raw: string): void {
  purgeLegacyGlobalUserCaches();
  const uid = currentUid();
  if (!uid) return;
  try {
    localStorage.setItem(reflectSessionStorageKey(uid), raw);
  } catch {
    // ignore quota / private mode
  }
}

/** Clear the signed-in uid's active session mirror. */
export function clearReflectSession(): void {
  purgeLegacyGlobalUserCaches();
  const uid = currentUid();
  if (!uid) return;
  try {
    localStorage.removeItem(reflectSessionStorageKey(uid));
  } catch {
    // ignore
  }
}
