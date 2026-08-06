/**
 * Region resolution for Moment Library (Founder rule).
 *
 * Signed-in: account.dataRegion is source of truth.
 * Signed-out first-run: channel / device / locale may suggest a region,
 * but must never override account.dataRegion after login.
 */

import type { DataRegion } from '../../types/momentLibrary';

export type RegionSuggestionSource =
  | 'account'
  | 'distribution_channel'
  | 'device_region'
  | 'locale'
  | 'default';

export interface ResolveDataRegionInput {
  /** From SeenUser.dataRegion when signed in. */
  accountDataRegion?: DataRegion | null;
  /** True when a Firebase/auth user is signed in. */
  isSignedIn: boolean;
  /** Optional first-run suggestions (ignored once account region exists). */
  suggestedRegion?: DataRegion | null;
  suggestionSource?: Exclude<RegionSuggestionSource, 'account' | 'default'>;
}

export interface ResolvedDataRegion {
  region: DataRegion;
  source: RegionSuggestionSource;
}

/**
 * Resolve which Moment Library host/pack region to use.
 * Account region always wins when signed in (even if suggestedRegion differs).
 */
export function resolveDataRegion(input: ResolveDataRegionInput): ResolvedDataRegion {
  if (input.isSignedIn) {
    if (input.accountDataRegion === 'CN' || input.accountDataRegion === 'GLOBAL') {
      return { region: input.accountDataRegion, source: 'account' };
    }
    // Signed in but unset — keep a stable default; do not invent from locale.
    return { region: 'GLOBAL', source: 'default' };
  }

  if (input.suggestedRegion === 'CN' || input.suggestedRegion === 'GLOBAL') {
    return {
      region: input.suggestedRegion,
      source: input.suggestionSource ?? 'locale',
    };
  }

  return { region: 'GLOBAL', source: 'default' };
}

/** Locale → suggestion only (never overrides account). */
export function suggestRegionFromLocale(language: string | undefined | null): DataRegion {
  const code = (language ?? '').toLowerCase();
  if (code === 'zh' || code.startsWith('zh-') || code.includes('hans')) return 'CN';
  return 'GLOBAL';
}
