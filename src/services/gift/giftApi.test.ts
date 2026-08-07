import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Firebase auth is imported transitively; stub it so no real SDK init runs.
vi.mock('../firebase', () => ({
  auth: { currentUser: { getIdToken: vi.fn(async () => 'test-id-token') } },
}));
vi.mock('../../config/api', () => ({
  API_BASE_URL: 'https://api.test',
  API_KEY: 'test-key',
}));

import { createGift, retrieveGift, revokeGift, GiftError } from './giftApi';

function mockFetch(status: number, body: unknown) {
  const fn = vi.fn((_url: string, _init: RequestInit) =>
    Promise.resolve({
      ok: status >= 200 && status < 300,
      status,
      json: async () => body,
    }),
  );
  Object.defineProperty(globalThis, 'fetch', { value: fn, configurable: true, writable: true });
  return fn;
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe('createGift', () => {
  it('posts to /gift/create with auth and returns token/url/key', async () => {
    const fetchFn = mockFetch(200, {
      token: 'abc',
      url: 'https://app.beingseenmatters.com/s/abc',
      retrievalKey: '482731',
    });
    const res = await createGift({ message: '想你了', senderName: '小林', tone: '真诚' });
    expect(res.retrievalKey).toBe('482731');
    expect(res.url).toContain('/s/abc');
    const [url, init] = fetchFn.mock.calls[0];
    expect(url).toBe('https://api.test/gift/create');
    expect((init as any).headers['Authorization']).toBe('Bearer test-id-token');
    expect((init as any).headers['X-Seen-App-Key']).toBe('test-key');
  });

  it('throws GiftError with code on failure', async () => {
    mockFetch(429, { error: 'rate_limited' });
    await expect(createGift({ message: 'hi' })).rejects.toMatchObject({
      name: 'GiftError',
      code: 'rate_limited',
      status: 429,
    });
  });
});

describe('retrieveGift maps status → discriminated result (no auth header)', () => {
  it('ok', async () => {
    const fetchFn = mockFetch(200, {
      message: 'secret',
      senderName: '小林',
      tone: null,
      createdAt: 1,
      redeemedAt: 2,
    });
    const r = await retrieveGift('tok', '482731');
    expect(r).toMatchObject({ status: 'ok', message: 'secret', senderName: '小林' });
    // Retrieve must not attach a Firebase auth header.
    expect((fetchFn.mock.calls[0][1] as any).headers['Authorization']).toBeUndefined();
  });

  it('invalid_key carries attemptsRemaining', async () => {
    mockFetch(401, { error: 'invalid_key', attemptsRemaining: 3 });
    expect(await retrieveGift('tok', '000000')).toEqual({ status: 'invalid_key', attemptsRemaining: 3 });
  });

  it('locked carries lockedUntil', async () => {
    mockFetch(423, { error: 'locked', lockedUntil: 999 });
    expect(await retrieveGift('tok', '000000')).toEqual({ status: 'locked', lockedUntil: 999 });
  });

  it('not_found / revoked / expired', async () => {
    mockFetch(404, { error: 'not_found' });
    expect((await retrieveGift('tok', 'x')).status).toBe('not_found');
    mockFetch(410, { error: 'revoked' });
    expect((await retrieveGift('tok', 'x')).status).toBe('revoked');
    mockFetch(410, { error: 'expired' });
    expect((await retrieveGift('tok', 'x')).status).toBe('expired');
  });
});

describe('revokeGift', () => {
  it('resolves on ok and throws on forbidden', async () => {
    mockFetch(200, { ok: true });
    await expect(revokeGift('tok')).resolves.toBeUndefined();
    mockFetch(403, { error: 'forbidden' });
    await expect(revokeGift('tok')).rejects.toBeInstanceOf(GiftError);
  });
});
