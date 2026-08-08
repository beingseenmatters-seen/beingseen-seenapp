/**
 * Connection Origin — the branded "同频遇见" explainability layer.
 *
 * Two separate concerns (founder decision):
 *  - INTERNAL classification: which understanding channel brought two people
 *    together — 'moment' (Behaviour), 'reflect' (Meaning), or 'both'. Derived
 *    server-side from the resonance scores (see lambda classifyOrigin); this
 *    module never recomputes it.
 *  - USER-FACING explanation: the emotional, natural-language sentence is the
 *    PRIMARY message; the category tag (生活场景 / 理解方式 / 共同形成) is a
 *    SECONDARY visual cue. All copy lives in i18n under `connection_origin.*`.
 *
 * The server may also send 'none' (no shared channel); we treat that — and any
 * unknown value — as "no origin", and the UI falls back gracefully.
 */

export type ConnectionOrigin = 'moment' | 'reflect' | 'both';

const ORIGINS: readonly ConnectionOrigin[] = ['moment', 'reflect', 'both'];

/** Narrow an untrusted value (server field / stored doc) to a ConnectionOrigin. */
export function asConnectionOrigin(value: unknown): ConnectionOrigin | undefined {
  return ORIGINS.includes(value as ConnectionOrigin) ? (value as ConnectionOrigin) : undefined;
}

/** i18n keys for the origin block. Title is shared; explanation + tag vary by channel. */
export const CONNECTION_ORIGIN_TITLE_KEY = 'connection_origin.title';
export function connectionOriginExplanationKey(origin: ConnectionOrigin): string {
  return `connection_origin.${origin}.explanation`;
}
export function connectionOriginTagKey(origin: ConnectionOrigin): string {
  return `connection_origin.${origin}.tag`;
}
