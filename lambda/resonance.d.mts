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

export interface ResonanceResult {
  resonanceScore: number;
  detail: unknown;
}

export function computeResonance(riA: RIProfile, riB: RIProfile): ResonanceResult;

// --- Moment channel (Behaviour / first-touch) — second, independent stream ---

export interface MomentProfileRI {
  movements: Array<{ movementId: string; direction: number; weight: number }>;
}

export function assembleMomentProfile(
  momentProfile: unknown,
): MomentProfileRI;

export function isMomentEligible(momentRI: MomentProfileRI): boolean;

export interface MomentResonanceResult {
  momentScore: number;
  detail: { sharedHits: Array<{ movementId: string; contribution: number }> };
}

export function computeMomentResonance(
  mA: MomentProfileRI,
  mB: MomentProfileRI,
): MomentResonanceResult;
