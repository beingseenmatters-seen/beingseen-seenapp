export type LoginMethod = 'apple' | 'google' | 'email';

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
    age?: string;
    location?: string;
    gender?: string;
    zodiac?: string;
  };
  soulProfile?: {
    answers?: Record<string, string>;
    understanding?: Record<string, any>;
    aiPreference?: {
      role?: string;
      intensity?: number;
      emotionHandling?: string;
    };
    reflectModel?: any;
  };
}
