/**
 * Discover availability (Phase 4 · Sprint 4B).
 *
 * Tracks only what the frozen Sprint 4A document requires for the tab indicator:
 * a single subtle dot meaning "there may be someone worth discovering."
 *
 * Offline marker is uid-scoped to the viewer — never device-global.
 */

import { auth } from './firebase';
import { purgeLegacyGlobalUserCaches, userScopedKey } from './userScopedStorage';

const KEY_PREFIX = 'seen_discover_last_seen_v2_';
/** Fired (same-tab) when the "last seen" marker changes. */
export const DISCOVER_AVAILABILITY_EVENT = 'seen:discover-availability-changed';

function currentUid(): string | null {
  return auth.currentUser?.uid ?? null;
}

function storageKeyForViewer(uid: string): string {
  return userScopedKey(KEY_PREFIX, uid);
}

/**
 * The candidate id the person saw the last time they opened Discover.
 * Returns '' when they have opened Discover to an empty room, and null when they
 * have never opened it / are signed out.
 */
export function getDiscoverLastSeenUid(): string | null {
  purgeLegacyGlobalUserCaches();
  const uid = currentUid();
  if (!uid) return null;
  try {
    return localStorage.getItem(storageKeyForViewer(uid));
  } catch {
    return null;
  }
}

/**
 * Record that the person opened Discover and saw `candidateUid` (or nothing).
 * This clears the dot until a genuinely different possibility appears.
 */
export function markDiscoverOpened(candidateUid: string | null): void {
  purgeLegacyGlobalUserCaches();
  const uid = currentUid();
  if (!uid) return;
  try {
    localStorage.setItem(storageKeyForViewer(uid), candidateUid ?? '');
    window.dispatchEvent(new CustomEvent(DISCOVER_AVAILABILITY_EVENT));
  } catch {
    // non-browser — no-op
  }
}

/** Subscribe to "last seen" changes (same-tab + cross-tab). Returns unsubscribe. */
export function subscribeDiscoverAvailability(callback: () => void): () => void {
  const onChange = () => callback();
  const onStorage = (e: StorageEvent) => {
    if (
      e.key === 'seen_discover_last_seen_uid' ||
      (typeof e.key === 'string' && e.key.startsWith(KEY_PREFIX))
    ) {
      callback();
    }
  };
  window.addEventListener(DISCOVER_AVAILABILITY_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(DISCOVER_AVAILABILITY_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}
