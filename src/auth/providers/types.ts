import type { EmergentTrait, TraitInferenceMeta } from '../../types/emergentTraits';

export type LoginMethod = 'apple' | 'google' | 'email';

/** Onboarding / AI response style (Step 3). Maps to legacy `role` for existing UI. */
export type AiResponseStyleId = 'listener' | 'organizer' | 'challenger' | 'supporter';

export interface UnderstandingAnswers {
  proudestMoment?: string;
  biggestRegret?: string;
  childhoodDream?: string;
  selfDescription?: string;
  biggestInterest?: string;
  influentialPersonOrQuote?: string;
}

/** Optional Me-module “about you” prompts (not onboarding; not understandingProgress). */
export type AboutMeQ5Choice = 'alone' | 'talk' | 'scroll' | 'shift' | 'other';

export interface AboutMeSignals {
  valueTags: string[];
  regretThemes: string[];
  aspirationThemes: string[];
  selfNarrativeTags: string[];
  copingStyleTags: string[];
  resonanceTags: string[];
  emotionalNeeds: string[];
  updatedAt: number;
}

export interface SoulProfileAboutMe {
  q1?: { text?: string };
  q2?: { text?: string };
  q3?: { who?: string; distanceNow?: string };
  q4?: { sentence?: string; sameAsBefore?: string };
  q5?: { choice?: AboutMeQ5Choice | string; text?: string };
  q6?: { text?: string };
  completedCount?: number;
  updatedAt?: number;
}

export interface SeenUser {
  uid: string;
  email: string;
  primaryEmail?: string | null;
  allEmails?: string[];
  isAppleRelayEmail?: boolean;
  providers?: string[];
  lastLoginProvider?: string | null;
  createdAt: unknown;
  updatedAt?: unknown;
  loginMethod: LoginMethod;
  provider?: string;
  onboardingCompleted: boolean;
  onboardingStarted?: boolean;
  nickname?: string;
  desire?: string;
  lifeStory?: string;
  understandingProgress?: number;
  understandingAnswers?: UnderstandingAnswers;
  fcmTokens?: Array<{ token: string; platform: string; updatedAt: number }>;
  basic?: {
    nickname?: string;
    /** Age range slug, e.g. 18-24, 25-34 (collected at onboarding). */
    age?: string;
    location?: string;
    gender?: string;
    zodiac?: string;
    /**
     * Legacy field — no longer collected during onboarding. Onboarding only
     * asks what cannot naturally emerge from later interaction; Reflect and
     * Moments are the primary understanding mechanisms. Existing users'
     * values are preserved untouched.
     */
    currentState?: string;
    /**
     * Legacy field — no longer collected during onboarding (see currentState
     * note). Stable English slugs, e.g. reading, travel; custom via other:...
     */
    interests?: string[];
  };
  soulProfile?: {
    answers?: Record<string, string>;
    understanding?: Record<string, any>;
    aboutMe?: SoulProfileAboutMe;
    aboutMeSignals?: AboutMeSignals;
    aiPreference?: {
      role?: string;
      intensity?: number;
      emotionHandling?: string;
      responseStyle?: AiResponseStyleId;
    };
    reflectModel?: any;
    /** T-202: inferred emergent traits from approved reflection sessions */
    emergentTraits?: EmergentTrait[];
    traitInferenceMeta?: TraitInferenceMeta;
  };
}
