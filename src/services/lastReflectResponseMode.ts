import { ResponseStyle, type ResponseStyleType } from '../types/responseStyle';
import { isResponseStyleType } from './reflectStyle';

/**
 * User-scoped "last used Reflect response mode".
 *
 * This is the ONLY live default source for a new Reflect conversation
 * (Phase 1 decision). It is a lightweight local preference — it contains no
 * conversation content, so it may outlive transcript retention. It is
 * intentionally NOT persisted to Firestore in this phase.
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
 * Missing, invalid or unreadable values all fall back to MIRROR so a broken
 * localStorage can never break Reflect.
 */
export function loadLastUsedResponseMode(
  uid: string | null | undefined,
  store: ResponseModeStore | null = defaultStore(),
): ResponseStyleType {
  if (!uid || !store) return ResponseStyle.MIRROR;
  try {
    const raw = store.getItem(lastUsedResponseModeKey(uid));
    if (raw !== null && isResponseStyleType(raw)) return raw;
    return ResponseStyle.MIRROR;
  } catch {
    return ResponseStyle.MIRROR;
  }
}

export function saveLastUsedResponseMode(
  uid: string | null | undefined,
  mode: ResponseStyleType,
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
