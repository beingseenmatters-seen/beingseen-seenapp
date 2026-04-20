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
  basic?: {
    nickname?: string;
    /** Age range slug, e.g. 18-24, 25-34 (same as onboarding Step 1). */
    age?: string;
    location?: string;
    gender?: string;
    zodiac?: string;
    /** Why the user is here (onboarding Step 1). */
    currentState?: string;
  };
  soulProfile?: {
    answers?: Record<string, string>;
    understanding?: Record<string, any>;
    aiPreference?: {
      role?: string;
      intensity?: number;
      emotionHandling?: string;
      responseStyle?: AiResponseStyleId;
    };
    reflectModel?: any;
  };
}
