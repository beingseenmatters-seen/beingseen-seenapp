const FALLBACK_URL = 'https://app.beingseenmatters.com';

/**
 * The canonical URL for this app in production.
 * Used as the redirect target for Firebase email link sign-in
 * and as the base for any auth-related callbacks.
 *
 * Set VITE_APP_URL in your .env to override (e.g. https://app.beingseenmatters.com).
 */
export const AUTH_APP_URL: string =
  import.meta.env.VITE_APP_URL || FALLBACK_URL;
