// Type declarations for the pure, dependency-free resonance module so the
// React/Vite client can import the exact server readiness logic without
// enabling allowJs. The .mjs file is the single runtime source of truth.

export interface RIProfile {
  matchingTraits: Array<{
    traitId: string;
    family: string;
    weight: number;
    lastReinforcedAt: number;
  }>;
  familyVector: Record<string, number>;
  profileConfidence: number;
}

export function assembleRIProfile(
  emergentTraits: readonly unknown[] | null | undefined,
): RIProfile;

export function isEligibleToMatch(ri: RIProfile, insightCount: number): boolean;
