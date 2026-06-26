/**
 * Discover availability (Phase 4 · Sprint 4B).
 *
 * Tracks only what the frozen Sprint 4A document requires for the tab indicator:
 * a single subtle dot meaning "there may be someone worth discovering."
 *
 * This layer stores nothing but the id of the possibility the person last saw
 * when they opened Discover. It does NOT do selection or scoring — availability
 * is derived by the caller from the existing candidate selection. The dot:
 *   - appears only for a genuinely new, meaningful possibility,
 *   - clears the moment the person opens Discover (whether or not they act),
 *   - never counts, never nags, never re-surfaces the same possibility.
 */

const LAST_SEEN_KEY = 'seen_discover_last_seen_uid';
/** Fired (same-tab) when the "last seen" marker changes. */
export const DISCOVER_AVAILABILITY_EVENT = 'seen:discover-availability-changed';

/**
 * The candidate id the person saw the last time they opened Discover.
 * Returns '' when they have opened Discover to an empty room, and null when they
 * have never opened it.
 */
export function getDiscoverLastSeenUid(): string | null {
  try {
    return localStorage.getItem(LAST_SEEN_KEY);
  } catch {
    return null;
  }
}

/**
 * Record that the person opened Discover and saw `candidateUid` (or nothing).
 * This clears the dot until a genuinely different possibility appears.
 */
export function markDiscoverOpened(candidateUid: string | null): void {
  try {
    localStorage.setItem(LAST_SEEN_KEY, candidateUid ?? '');
    window.dispatchEvent(new CustomEvent(DISCOVER_AVAILABILITY_EVENT));
  } catch {
    // non-browser — no-op
  }
}

/** Subscribe to "last seen" changes (same-tab + cross-tab). Returns unsubscribe. */
export function subscribeDiscoverAvailability(callback: () => void): () => void {
  const onChange = () => callback();
  const onStorage = (e: StorageEvent) => {
    if (e.key === LAST_SEEN_KEY) callback();
  };
  window.addEventListener(DISCOVER_AVAILABILITY_EVENT, onChange);
  window.addEventListener('storage', onStorage);
  return () => {
    window.removeEventListener(DISCOVER_AVAILABILITY_EVENT, onChange);
    window.removeEventListener('storage', onStorage);
  };
}
