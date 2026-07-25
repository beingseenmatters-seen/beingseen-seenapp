import {
  ResponseMode,
  type ResponseModeType,
  tryNormalizeResponseMode,
} from '../types/responseMode';

/**
 * User-scoped "last used Reflect response mode".
 *
 * This is the ONLY live default source for a new Reflect conversation
 * (Phase 1 decision). It is a lightweight local preference — it contains no
 * conversation content, so it may outlive transcript retention. It is
 * intentionally NOT persisted to Firestore.
 *
 * Phase 2: values are canonical five-mode strings. Legacy stored values
 * (mirror/organizer/helper/guide) are normalised on read via the approved
 * mapping; anything unknown falls back to REFLECT.
 *
 * UI components must go through this service instead of localStorage.
 */

export interface ResponseModeStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

const KEY_PREFIX = 'seen_last_reflect_mode_v1_';

function defaultStore(): ResponseModeStore | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

export function lastUsedResponseModeKey(uid: string): string {
  return `${KEY_PREFIX}${uid}`;
}

/**
 * Missing, invalid or unreadable values all fall back to REFLECT so a broken
 * localStorage can never break Reflect. Legacy four-role values stored before
 * Phase 2 are migrated through the approved mapping on read.
 */
export function loadLastUsedResponseMode(
  uid: string | null | undefined,
  store: ResponseModeStore | null = defaultStore(),
): ResponseModeType {
  if (!uid || !store) return ResponseMode.REFLECT;
  try {
    const raw = store.getItem(lastUsedResponseModeKey(uid));
    return tryNormalizeResponseMode(raw) ?? ResponseMode.REFLECT;
  } catch {
    return ResponseMode.REFLECT;
  }
}

export function saveLastUsedResponseMode(
  uid: string | null | undefined,
  mode: ResponseModeType,
  store: ResponseModeStore | null = defaultStore(),
): void {
  if (!uid || !store) return;
  try {
    store.setItem(lastUsedResponseModeKey(uid), mode);
  } catch {
    // Quota / privacy-mode failures must never break Reflect.
  }
}

export function clearLastUsedResponseMode(
  uid: string | null | undefined,
  store: ResponseModeStore | null = defaultStore(),
): void {
  if (!uid || !store) return;
  try {
    store.removeItem(lastUsedResponseModeKey(uid));
  } catch {
    // Ignore storage failures.
  }
}
