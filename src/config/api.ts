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
// Resolve the app key. A PRODUCTION build MUST be given VITE_SEEN_APP_API_KEY
// (release env / .env.production): it fails CLOSED (throws) rather than silently
// shipping the historical dev fallback, which the production backend rejects
// with 401. The dev fallback literal lives ONLY inside the `import.meta.env.DEV`
// branch, so a production bundle is dead-code-stripped of it entirely — a
// release build can never embed `test_seen_app_key` again.
export const API_KEY: string = (() => {
  const configured = import.meta.env.VITE_SEEN_APP_API_KEY;
  if (configured) return configured;
  if (import.meta.env.DEV) return 'test_seen_app_key'; // local dev only
  throw new Error(
    '[config] VITE_SEEN_APP_API_KEY is required for a production build — refusing ' +
      'to build with the dev fallback (the backend would 401). Set it in the ' +
      'release environment (.env.production).',
  );
})();

/**
 * T-301 W7 rollout flag. When 'on', the client uses the server-side Resonance
 * Engine V2 (`POST /match/candidate`) and Admin-SDK profile hydration
 * (`POST /profiles/hydrate`) instead of reading other users' documents directly.
 * Default 'off' so behaviour is unchanged until Firestore rules + endpoints are
 * deployed. Set VITE_MATCH_CANDIDATE_API=on to enable.
 */
export const MATCH_CANDIDATE_API =
  (import.meta.env.VITE_MATCH_CANDIDATE_API || 'off') === 'on';
