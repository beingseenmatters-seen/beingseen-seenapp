import { API_BASE_URL, API_KEY } from '../../config/api';
import { auth } from '../firebase';

/**
 * Client for the Relationship Expression / QR Gift loop.
 *
 * create/revoke attach the Firebase ID token (author identity). retrieve is
 * app-key only so an account-less recipient can open a Gift. Unlike the shared
 * apiClient (which throws a generic Error on non-2xx), retrieve needs the
 * status to distinguish invalid-key / locked / revoked / expired, so this
 * module talks to fetch directly and returns a discriminated result.
 */

async function giftFetch(
  endpoint: string,
  data: unknown,
  withAuth: boolean,
): Promise<{ ok: boolean; status: number; body: any }> {
  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    'X-Seen-App-Key': API_KEY,
  };
  if (withAuth) {
    try {
      const idToken = await auth.currentUser?.getIdToken();
      if (idToken) headers['Authorization'] = `Bearer ${idToken}`;
    } catch {
      /* unauthenticated — server will 401 create/revoke */
    }
  }
  const res = await fetch(`${API_BASE_URL}${endpoint}`, {
    method: 'POST',
    headers,
    body: JSON.stringify(data),
  });
  let body: any = null;
  try {
    body = await res.json();
  } catch {
    /* empty/non-JSON body */
  }
  return { ok: res.ok, status: res.status, body };
}

export interface CreateGiftInput {
  message: string;
  senderName?: string | null;
  tone?: string | null;
  /** Optional sender-chosen Heart Key; omit to have the server generate one. */
  retrievalKey?: string | null;
}

export interface CreateGiftResult {
  token: string;
  url: string;
  retrievalKey: string;
}

export class GiftError extends Error {
  code: string;
  status: number;
  constructor(code: string, status: number) {
    super(code);
    this.name = 'GiftError';
    this.code = code;
    this.status = status;
  }
}

export async function createGift(input: CreateGiftInput): Promise<CreateGiftResult> {
  const { ok, status, body } = await giftFetch('/gift/create', input, true);
  if (!ok) throw new GiftError(body?.error || 'create_failed', status);
  return body as CreateGiftResult;
}

export async function revokeGift(token: string): Promise<void> {
  const { ok, status, body } = await giftFetch('/gift/revoke', { token }, true);
  if (!ok) throw new GiftError(body?.error || 'revoke_failed', status);
}

export type RetrieveResult =
  | {
      status: 'ok';
      message: string;
      senderName: string | null;
      tone: string | null;
      createdAt: number;
      redeemedAt: number;
    }
  | { status: 'invalid_key'; attemptsRemaining: number }
  | { status: 'locked'; lockedUntil: number }
  | { status: 'not_found' }
  | { status: 'revoked' }
  | { status: 'expired' }
  | { status: 'error' };

export async function retrieveGift(token: string, key: string): Promise<RetrieveResult> {
  const { ok, status, body } = await giftFetch('/gift/retrieve', { token, key }, false);
  if (ok) {
    return {
      status: 'ok',
      message: body.message,
      senderName: body.senderName ?? null,
      tone: body.tone ?? null,
      createdAt: body.createdAt,
      redeemedAt: body.redeemedAt,
    };
  }
  if (status === 401 && body?.error === 'invalid_key') {
    return { status: 'invalid_key', attemptsRemaining: body.attemptsRemaining ?? 0 };
  }
  if (status === 423) return { status: 'locked', lockedUntil: body?.lockedUntil ?? 0 };
  if (status === 404) return { status: 'not_found' };
  if (status === 410 && body?.error === 'revoked') return { status: 'revoked' };
  if (status === 410 && body?.error === 'expired') return { status: 'expired' };
  return { status: 'error' };
}

export async function draftExpressions(
  situation: string,
  tone: string,
  language: 'zh' | 'en',
): Promise<string[]> {
  const { ok, body } = await giftFetch('/express/draft', { situation, tone, language }, true);
  if (!ok) return [];
  return Array.isArray(body?.drafts) ? body.drafts.map((s: unknown) => String(s)) : [];
}
