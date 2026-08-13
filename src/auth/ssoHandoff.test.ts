import { describe, it, expect, beforeEach, vi, afterEach } from 'vitest';

// isNative() must be controllable per-test.
vi.mock('./platform', () => ({ isNative: vi.fn(() => false) }));

import { isNative } from './platform';
import {
  captureSsoCode,
  takePendingSsoCode,
  isRevealPath,
  redeemHandoff,
  inspectHandoff,
  HandoffError,
  __resetForTests,
} from './ssoHandoff';

const VALID = 'A'.repeat(43); // matches [A-Za-z0-9_-]{43}

function loc(pathname: string, hash: string, search = '') {
  return { pathname, search, hash };
}

function makeHist() {
  const calls: string[] = [];
  return {
    calls,
    replaceState: (_d: unknown, _t: string, url: string) => void calls.push(url),
  };
}

beforeEach(() => {
  __resetForTests();
  (isNative as ReturnType<typeof vi.fn>).mockReturnValue(false);
});
afterEach(() => vi.restoreAllMocks());

describe('captureSsoCode — fragment handling', () => {
  it('captures a valid code and strips the fragment immediately', () => {
    const hist = makeHist();
    captureSsoCode(loc('/', `#sso=${VALID}`), hist);
    expect(hist.calls).toEqual(['/']); // fragment gone from visible URL
    expect(takePendingSsoCode()).toBe(VALID);
  });

  it('preserves path + query when stripping', () => {
    const hist = makeHist();
    captureSsoCode(loc('/c/thanks', `#sso=${VALID}`, '?x=1'), hist);
    expect(hist.calls).toEqual(['/c/thanks?x=1']);
  });

  it('strips malformed #sso fragments but keeps no code (silent fallback)', () => {
    const hist = makeHist();
    captureSsoCode(loc('/', '#sso=tooshort'), hist);
    expect(hist.calls).toEqual(['/']);
    expect(takePendingSsoCode()).toBeNull();
  });

  it('ignores non-sso fragments entirely', () => {
    const hist = makeHist();
    captureSsoCode(loc('/', '#seen'), hist);
    expect(hist.calls).toEqual([]);
    expect(takePendingSsoCode()).toBeNull();
  });

  it('REVEAL GUARD: /s/:token is completely inert — no read, no strip, no store', () => {
    const hist = makeHist();
    captureSsoCode(loc('/s/some-token', `#sso=${VALID}`), hist);
    expect(hist.calls).toEqual([]); // untouched
    expect(takePendingSsoCode()).toBeNull();
  });

  it('NATIVE GUARD: inert when isNative() is true', () => {
    (isNative as ReturnType<typeof vi.fn>).mockReturnValue(true);
    const hist = makeHist();
    captureSsoCode(loc('/', `#sso=${VALID}`), hist);
    expect(hist.calls).toEqual([]);
    expect(takePendingSsoCode()).toBeNull();
  });

  it('takePendingSsoCode is single-shot (StrictMode double-effect safe)', () => {
    const hist = makeHist();
    captureSsoCode(loc('/', `#sso=${VALID}`), hist);
    expect(takePendingSsoCode()).toBe(VALID);
    expect(takePendingSsoCode()).toBeNull(); // second effect run gets nothing
  });

  it('isRevealPath covers /s and /s/*, not /signin-like paths', () => {
    expect(isRevealPath('/s/abc')).toBe(true);
    expect(isRevealPath('/s')).toBe(true);
    expect(isRevealPath('/')).toBe(false);
    expect(isRevealPath('/settings')).toBe(false);
    expect(isRevealPath('/c/thanks')).toBe(false);
  });
});

describe('backend calls', () => {
  it('redeemHandoff posts code+aud with app key and returns the custom token', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ customToken: 'ct_test' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const token = await redeemHandoff(VALID);
    expect(token).toBe('ct_test');
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toContain('/auth/handoff/redeem');
    expect((init.headers as Record<string, string>)['X-Seen-App-Key']).toBeTruthy();
    expect((init.headers as Record<string, string>).Authorization).toBeUndefined();
    expect(JSON.parse(init.body as string)).toEqual({ code: VALID, aud: 'seen' });
  });

  it('inspectHandoff sends the LOCAL user ID token and never surfaces a uid', async () => {
    const fetchMock = vi.fn(async () => ({
      ok: true,
      json: async () => ({ sameAccount: false, incomingEmail: 'a@b.c', uid: 'SHOULD_NOT_LEAK' }),
    }));
    vi.stubGlobal('fetch', fetchMock);
    const r = await inspectHandoff(VALID, 'idtok');
    expect(r).toEqual({ sameAccount: false, incomingEmail: 'a@b.c' }); // uid dropped
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect((init.headers as Record<string, string>).Authorization).toBe('Bearer idtok');
  });

  it('non-OK responses raise HandoffError with the server error code', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(async () => ({ ok: false, status: 410, json: async () => ({ error: 'code_expired' }) }))
    );
    await expect(redeemHandoff(VALID)).rejects.toMatchObject({ code: 'code_expired', status: 410 });
  });

  it('network failure raises (caller degrades silently)', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => Promise.reject(new Error('offline'))));
    await expect(redeemHandoff(VALID)).rejects.toThrow();
    expect(HandoffError).toBeDefined();
  });
});
