/**
 * Canonical Reflect response modes (Phase 2).
 *
 * These are user-intent-based response modes — "what kind of help would be
 * useful in this conversation?" — NOT AI roles, identities or personalities.
 *
 * Legacy four-role values (mirror / organizer / helper / expression / guide)
 * remain accepted everywhere for backward compatibility and are normalised
 * through `normalizeResponseMode`. CONNECT is genuinely new and has no legacy
 * equivalent.
 */

export const ResponseMode = {
  REFLECT: 'reflect',
  UNTANGLE: 'untangle',
  EXPRESS: 'express',
  CONNECT: 'connect',
  DISCOVER: 'discover',
  /** 一起想想 — jointly think through a real event / practical problem. */
  EXPLORE: 'explore',
} as const;

export type ResponseModeType = typeof ResponseMode[keyof typeof ResponseMode];

/** Canonical display/order for the selector UI (一起想想 after 换个角度). */
export const RESPONSE_MODES: ResponseModeType[] = [
  ResponseMode.REFLECT,
  ResponseMode.UNTANGLE,
  ResponseMode.EXPRESS,
  ResponseMode.CONNECT,
  ResponseMode.DISCOVER,
  ResponseMode.EXPLORE,
];

export function isResponseModeType(value: unknown): value is ResponseModeType {
  return (
    value === ResponseMode.REFLECT ||
    value === ResponseMode.UNTANGLE ||
    value === ResponseMode.EXPRESS ||
    value === ResponseMode.CONNECT ||
    value === ResponseMode.DISCOVER ||
    value === ResponseMode.EXPLORE
  );
}

/**
 * Approved legacy mapping (founder decision):
 *   mirror → reflect, organizer → untangle, helper/expression_help/expression
 *   → express, guide → discover. Nothing maps to connect.
 */
const LEGACY_TO_CANONICAL: Record<string, ResponseModeType> = {
  mirror: ResponseMode.REFLECT,
  organizer: ResponseMode.UNTANGLE,
  helper: ResponseMode.EXPRESS,
  expression_help: ResponseMode.EXPRESS,
  expression: ResponseMode.EXPRESS,
  guide: ResponseMode.DISCOVER,
};

/**
 * Normalise a canonical or legacy value; returns undefined for anything
 * unknown so callers can fall through to the next source.
 */
export function tryNormalizeResponseMode(value: unknown): ResponseModeType | undefined {
  if (isResponseModeType(value)) return value;
  if (typeof value === 'string') {
    const mapped = LEGACY_TO_CANONICAL[value.toLowerCase()];
    if (mapped) return mapped;
  }
  return undefined;
}

/** Normalise with the safe system fallback (REFLECT). */
export function normalizeResponseMode(value: unknown): ResponseModeType {
  return tryNormalizeResponseMode(value) ?? ResponseMode.REFLECT;
}

/**
 * Legacy wire value for compatibility fields (`responseStyle` in the API
 * payload, `sessionStyle` in retained conversations). CONNECT and EXPLORE
 * have no legacy equivalent, so they return undefined and legacy consumers
 * apply their own safe fallback (the deployed backend falls back to mirror).
 */
export function toLegacyResponseStyle(
  mode: ResponseModeType,
): 'mirror' | 'organizer' | 'helper' | 'guide' | undefined {
  switch (mode) {
    case ResponseMode.REFLECT:
      return 'mirror';
    case ResponseMode.UNTANGLE:
      return 'organizer';
    case ResponseMode.EXPRESS:
      return 'helper';
    case ResponseMode.DISCOVER:
      return 'guide';
    case ResponseMode.CONNECT:
    case ResponseMode.EXPLORE:
      return undefined;
  }
}

/**
 * Legacy numeric selectedMode (0–3) used by old persisted sessions.
 * CONNECT and EXPLORE have no legacy index.
 */
export function toLegacySelectedMode(mode: ResponseModeType): number | null {
  switch (mode) {
    case ResponseMode.REFLECT:
      return 0;
    case ResponseMode.UNTANGLE:
      return 1;
    case ResponseMode.DISCOVER:
      return 2;
    case ResponseMode.EXPRESS:
      return 3;
    case ResponseMode.CONNECT:
    case ResponseMode.EXPLORE:
      return null;
  }
}

/** Legacy numeric selectedMode (0–3) → canonical mode. */
export function fromLegacySelectedMode(index: number | null | undefined): ResponseModeType | undefined {
  switch (index) {
    case 0:
      return ResponseMode.REFLECT;
    case 1:
      return ResponseMode.UNTANGLE;
    case 2:
      return ResponseMode.DISCOVER;
    case 3:
      return ResponseMode.EXPRESS;
    default:
      return undefined;
  }
}
