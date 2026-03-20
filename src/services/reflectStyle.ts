import { ResponseStyle, type ResponseStyleType } from '../types/responseStyle';

export function isResponseStyleType(value: unknown): value is ResponseStyleType {
  return (
    value === ResponseStyle.MIRROR ||
    value === ResponseStyle.ORGANIZER ||
    value === ResponseStyle.GUIDE ||
    value === ResponseStyle.EXPRESSION_HELP
  );
}

export function readMeDefaultStyle(): ResponseStyleType | undefined {
  try {
    const pref = JSON.parse(localStorage.getItem('seen_ai_preference') || '{}') as { role?: unknown };
    if (isResponseStyleType(pref.role)) return pref.role;
    return undefined;
  } catch {
    return undefined;
  }
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


