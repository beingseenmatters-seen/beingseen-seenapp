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
 * Reflect default style: Firestore profile first, then localStorage `seen_ai_preference`, else undefined (caller may use MIRROR).
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

export function resolveResponseStyleForReflect(args: {
  reflectSelectedStyle?: ResponseStyleType;
  meDefaultStyle?: ResponseStyleType;
  sessionStyle?: ResponseStyleType;
  keepContext: boolean;
  isNewSession: boolean;
}): ResponseStyleType {
  const { reflectSelectedStyle, meDefaultStyle, sessionStyle, keepContext, isNewSession } = args;

  if (reflectSelectedStyle) return reflectSelectedStyle;
  if (keepContext && sessionStyle && !isNewSession) return sessionStyle;
  if (meDefaultStyle) return meDefaultStyle;
  return ResponseStyle.MIRROR;
}


