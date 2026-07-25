import { ResponseStyle, type ResponseStyleType } from '../types/responseStyle';

/** Onboarding Step 3 / profile `responseStyle` — map to legacy `role` / ResponseStyle. */
export type OnboardingResponseStyleId = 'listener' | 'organizer' | 'challenger' | 'supporter';

export function isResponseStyleType(value: unknown): value is ResponseStyleType {
  return (
    value === ResponseStyle.MIRROR ||
    value === ResponseStyle.ORGANIZER ||
    value === ResponseStyle.GUIDE ||
    value === ResponseStyle.EXPRESSION_HELP
  );
}

/** Legacy localStorage only — use `getReflectDefaultStyle` for full priority (profile > LS). */
export function readMeDefaultStyle(): ResponseStyleType | undefined {
  try {
    const pref = JSON.parse(localStorage.getItem('seen_ai_preference') || '{}') as { role?: unknown };
    if (isResponseStyleType(pref.role)) return pref.role;
    return undefined;
  } catch {
    return undefined;
  }
}

/**
 * Prefer `role` when present and valid; otherwise map `responseStyle` (onboarding).
 */
export function resolveStyleFromAiPreference(
  aiPreference?: { role?: string; responseStyle?: string } | null,
): ResponseStyleType | undefined {
  if (!aiPreference) return undefined;
  if (aiPreference.role && isResponseStyleType(aiPreference.role)) {
    return aiPreference.role;
  }
  const rs = aiPreference.responseStyle as OnboardingResponseStyleId | undefined;
  switch (rs) {
    case 'listener':
      return ResponseStyle.MIRROR;
    case 'organizer':
      return ResponseStyle.ORGANIZER;
    case 'challenger':
      return ResponseStyle.GUIDE;
    case 'supporter':
      return ResponseStyle.EXPRESSION_HELP;
    default:
      return undefined;
  }
}

/**
 * LEGACY — no longer a live default for Reflect (Phase 1). Kept only for the
 * question-gate fallback path in seenApi, which never fires when a resolved
 * style is provided. New conversations use `lastUsedResponseMode` instead.
 */
export function getReflectDefaultStyle(
  aiPreference?: { role?: string; responseStyle?: string } | null,
): ResponseStyleType | undefined {
  const fromProfile = resolveStyleFromAiPreference(aiPreference);
  if (fromProfile) return fromProfile;
  return readMeDefaultStyle();
}

/**
 * Question gate / API: same priority as `getReflectDefaultStyle` for `resolveStyleAndLevel` when mode index is missing.
 */
export function buildGateSavedPreference(
  aiPreference?: { role?: string; responseStyle?: string } | null,
): { role?: ResponseStyleType } {
  const style = getReflectDefaultStyle(aiPreference);
  if (style) return { role: style };
  return {};
}

export function mapSelectedModeToStyle(selectedMode: number | null): ResponseStyleType | undefined {
  const modeMapping: ResponseStyleType[] = [
    ResponseStyle.MIRROR, // 0
    ResponseStyle.ORGANIZER, // 1
    ResponseStyle.GUIDE, // 2
    ResponseStyle.EXPRESSION_HELP // 3
  ];

  if (selectedMode === null) return undefined;
  if (selectedMode < 0 || selectedMode >= modeMapping.length) return undefined;
  return modeMapping[selectedMode];
}

export function mapStyleToSelectedMode(style: ResponseStyleType): number {
  switch (style) {
    case ResponseStyle.MIRROR:
      return 0;
    case ResponseStyle.ORGANIZER:
      return 1;
    case ResponseStyle.GUIDE:
      return 2;
    case ResponseStyle.EXPRESSION_HELP:
      return 3;
  }
}

/**
 * Phase 1 resolution order (founder decision):
 *   1. locked session.responseMode
 *   2. pre-conversation draft selection
 *   3. user-scoped lastUsedResponseMode
 *   4. MIRROR
 *
 * `soulProfile.aiPreference` is deliberately NOT an input — the old Me
 * setting no longer influences a new conversation.
 */
export function resolveResponseModeForReflect(args: {
  sessionResponseMode?: ResponseStyleType;
  draftResponseMode?: ResponseStyleType;
  lastUsedResponseMode?: ResponseStyleType;
}): ResponseStyleType {
  return (
    args.sessionResponseMode ??
    args.draftResponseMode ??
    args.lastUsedResponseMode ??
    ResponseStyle.MIRROR
  );
}

/**
 * Deterministic migration for retained conversations saved before
 * `responseMode` existed: prefer the legacy stored session style, then the
 * legacy numeric selected mode, then lastUsedResponseMode, then MIRROR.
 */
export function resolveLegacySessionResponseMode(args: {
  legacySessionStyle?: unknown;
  legacySelectedMode?: number | null;
  lastUsedResponseMode?: ResponseStyleType;
}): ResponseStyleType {
  if (isResponseStyleType(args.legacySessionStyle)) return args.legacySessionStyle;
  const fromSelectedMode = mapSelectedModeToStyle(args.legacySelectedMode ?? null);
  if (fromSelectedMode) return fromSelectedMode;
  return args.lastUsedResponseMode ?? ResponseStyle.MIRROR;
}


