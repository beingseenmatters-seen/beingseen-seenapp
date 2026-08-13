/**
 * MATTERS cross-product SSO — Seen WEB destination receiver.
 *
 * One identity, separate private rooms: exchanges a one-time `#sso=` fragment
 * code (from www.beingseenmatters.com) for a Firebase custom token minted for
 * the SAME existing UID via the live Seen backend. Identity only — no product
 * data is read, written, or moved; no account is merged.
 *
 * Transport is a URL FRAGMENT: never sent to any server or CDN log. Read once
 * at boot, stripped with history.replaceState BEFORE render or any network
 * activity.
 *
 * Hard guards, in order:
 *   - native builds (iOS/Android): completely inert — web-only continuity
 *   - kill switch: VITE_SSO_RECEIVER=off rebuilds to a no-op
 *   - /s/:token (account-less Gift reveal, which Seen web also serves):
 *     completely inert — fragment not read, not stripped, not stored
 *
 * Every failure (bad/expired/replayed code, wrong audience, backend
 * unreachable) degrades silently to today's normal welcome/sign-in behavior.
 */

import { API_BASE_URL, API_KEY } from '../config/api';
import { isNative } from './platform';

export const SSO_AUD = 'seen';

const CODE_RE = /^#sso=([A-Za-z0-9_-]{43})$/;

let pendingCode: string | null = null;
let started = false;

/** True when the current path is the account-free Gift reveal. */
export function isRevealPath(pathname: string): boolean {
  return pathname === '/s' || pathname.startsWith('/s/');
}

/** Read + strip the `#sso=` fragment. Called synchronously at boot. */
export function captureSsoCode(
  loc: { pathname: string; search: string; hash: string } = window.location,
  hist: { replaceState: (d: unknown, t: string, url: string) => void } = window.history
): void {
  if (isNative()) return;
  if (import.meta.env.VITE_SSO_RECEIVER === 'off') return;
  if (isRevealPath(loc.pathname)) return; // reveal: do not read, strip, or store
  if (!loc.hash.startsWith('#sso=')) return;

  const m = loc.hash.match(CODE_RE);
  hist.replaceState(null, '', loc.pathname + loc.search);
  pendingCode = m ? m[1] : null;
}

/** Single-shot consumer (module latch — StrictMode double-effect safe). */
export function takePendingSsoCode(): string | null {
  if (started) return null;
  started = true;
  const c = pendingCode;
  pendingCode = null;
  return c;
}

/** Test hook — resets module state. */
export function __resetForTests(): void {
  pendingCode = null;
  started = false;
}

// --- backend calls ----------------------------------------------------------

export class HandoffError extends Error {
  readonly code: string;
  readonly status: number;
  constructor(code: string, status: number) {
    super(code);
    this.code = code;
    this.status = status;
  }
}

async function post(path: string, payload: unknown, idToken?: string): Promise<any> {
  const res = await fetch(`${API_BASE_URL}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Seen-App-Key': API_KEY,
      ...(idToken ? { Authorization: `Bearer ${idToken}` } : {}),
    },
    body: JSON.stringify(payload),
  });
  if (!res.ok) {
    let code = 'request_failed';
    try {
      code = (await res.json())?.error ?? code;
    } catch {
      /* non-JSON error body */
    }
    throw new HandoffError(code, res.status);
  }
  return res.json();
}

/** No-local-user path (and the explicit "Continue as" choice). */
export async function redeemHandoff(code: string): Promise<string> {
  const data = await post('/auth/handoff/redeem', { code, aud: SSO_AUD });
  if (!data?.customToken) throw new HandoffError('no_token', 500);
  return data.customToken;
}

/** Local-user path — requires the LOCAL user's ID token; never exposes the incoming UID. */
export async function inspectHandoff(
  code: string,
  idToken: string
): Promise<{ sameAccount: boolean; incomingEmail: string | null }> {
  const data = await post('/auth/handoff/inspect', { code, aud: SSO_AUD }, idToken);
  return {
    sameAccount: data?.sameAccount === true,
    incomingEmail: typeof data?.incomingEmail === 'string' ? data.incomingEmail : null,
  };
}
