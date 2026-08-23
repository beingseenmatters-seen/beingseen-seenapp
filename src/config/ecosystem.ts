/**
 * Seen ecosystem — sibling-product entry URLs.
 *
 * Entries are plain cross-origin links (same-tab <a>), never token handoffs —
 * the safe-external-nav posture the Connect → Gift.Seen entry established.
 * Override per environment; defaults are the production origins.
 */
export const MOMENT_APP_URL =
  import.meta.env.VITE_MOMENT_APP_URL || 'https://moment.beingseenmatters.com';
