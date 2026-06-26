export const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://rtbzs3sjwe.execute-api.ap-southeast-2.amazonaws.com';
export const API_KEY = import.meta.env.VITE_SEEN_APP_API_KEY || 'test_seen_app_key';

/**
 * T-301 W7 rollout flag. When 'on', the client uses the server-side Resonance
 * Engine V2 (`POST /match/candidate`) and Admin-SDK profile hydration
 * (`POST /profiles/hydrate`) instead of reading other users' documents directly.
 * Default 'off' so behaviour is unchanged until Firestore rules + endpoints are
 * deployed. Set VITE_MATCH_CANDIDATE_API=on to enable.
 */
export const MATCH_CANDIDATE_API =
  (import.meta.env.VITE_MATCH_CANDIDATE_API || 'off') === 'on';
