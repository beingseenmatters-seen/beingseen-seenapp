export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://rtbzs3sjwe.execute-api.ap-southeast-2.amazonaws.com';

/**
 * App identifier sent as X-Seen-App-Key. NON-SECRET application identification /
 * coarse gateway protection — browser and native bundles expose it by design.
 * Real authorization is server-side: Firebase ID tokens, possession
 * credentials, SSO one-time codes, origin/audience checks, rate limits.
 *
 * Production builds REQUIRE an explicit VITE_SEEN_APP_API_KEY (set in the
 * deploy environment / release-build .env). Only dev builds may fall back to
 * the historical local value; production never silently reverts to it.
 */
const DEV_ONLY_APP_KEY = 'test_seen_app_key';
export const API_KEY: string =
  import.meta.env.VITE_SEEN_APP_API_KEY || (import.meta.env.DEV ? DEV_ONLY_APP_KEY : '');
if (import.meta.env.PROD && !import.meta.env.VITE_SEEN_APP_API_KEY) {
  console.error(
    '[config] VITE_SEEN_APP_API_KEY is not configured for this production build — backend requests will be rejected (401).'
  );
}

/**
 * T-301 W7 rollout flag. When 'on', the client uses the server-side Resonance
 * Engine V2 (`POST /match/candidate`) and Admin-SDK profile hydration
 * (`POST /profiles/hydrate`) instead of reading other users' documents directly.
 * Default 'off' so behaviour is unchanged until Firestore rules + endpoints are
 * deployed. Set VITE_MATCH_CANDIDATE_API=on to enable.
 */
export const MATCH_CANDIDATE_API =
  (import.meta.env.VITE_MATCH_CANDIDATE_API || 'off') === 'on';
