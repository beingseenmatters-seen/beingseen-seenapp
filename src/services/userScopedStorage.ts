/**
 * User-scoped local persistence (P0 account isolation).
 *
 * Architecture:
 *  - Every user-owned cache key is `{prefix}{uid}`.
 *  - Legacy device-global keys are purged and never migrated.
 *  - Without a signed-in uid, user-owned reads return empty / no-op writes.
 *  - Logout detaches the previous uid's mirrors immediately.
 */

/** Legacy device-global keys — never used as live stores; purged on access/logout. */
export const LEGACY_GLOBAL_USER_KEYS = [
  'seen_retained_conversations',
  'seen_reflect_session',
  'seen_session_insights',
  'seen_user_understanding_model',
  'seen_emergent_traits',
  'seen_user_personality_model',
  'seen_user_summary',
  'seen_kept_reflections',
  'seen_ai_preference',
  'seen_understanding_answers',
  'seen_profile',
  'seen_me_questions',
  'seen_shown_cards',
  'seen_onboarding',
  'seen_discover_last_seen_uid',
] as const;

/** Live uid-scoped key prefixes (value is always `${prefix}${uid}`). */
export const USER_SCOPED_KEY_PREFIXES = [
  'seen_retained_conversations_v2_',
  'seen_reflect_session_v2_',
  'seen_session_insights_v2_',
  'seen_user_understanding_model_v2_',
  'seen_emergent_traits_v2_',
  'seen_ai_preference_v2_',
  'seen_understanding_answers_v2_',
  'seen_profile_v2_',
  'seen_me_questions_v2_',
  'seen_shown_cards_v2_',
  'seen_discover_last_seen_v2_',
  'seen_moments_v1_',
  'seen_kept_reflections_v2_',
  'seen_last_reflect_mode_v1_',
  'seen_moments_invite_v1_',
] as const;

const SESSION_SCOPED_KEY_PREFIXES = ['seen_moments_invite_session_hidden_v1_'] as const;

export function userScopedKey(prefix: string, uid: string): string {
  return `${prefix}${uid}`;
}

function defaultLocalStore(): Storage | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function defaultSessionStore(): Storage | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

export function purgeLegacyGlobalUserCaches(
  store: Pick<Storage, 'removeItem'> | null = defaultLocalStore(),
): void {
  if (!store) return;
  for (const key of LEGACY_GLOBAL_USER_KEYS) {
    try {
      store.removeItem(key);
    } catch {
      // ignore
    }
  }
}

/**
 * Detach one uid's offline mirrors + purge every legacy global user cache.
 * Call with the uid captured BEFORE Firebase clears auth.currentUser.
 */
export function detachAllUserLocalStorage(uid: string | null | undefined): void {
  const local = defaultLocalStore();
  const session = defaultSessionStore();
  purgeLegacyGlobalUserCaches(local);

  if (uid && local) {
    for (const prefix of USER_SCOPED_KEY_PREFIXES) {
      try {
        local.removeItem(userScopedKey(prefix, uid));
      } catch {
        // ignore
      }
    }
  }

  if (uid && session) {
    for (const prefix of SESSION_SCOPED_KEY_PREFIXES) {
      try {
        session.removeItem(userScopedKey(prefix, uid));
      } catch {
        // ignore
      }
    }
  }

  try {
    window.dispatchEvent(new CustomEvent('seen:user-local-storage-detached'));
  } catch {
    // SSR / non-browser
  }
}
