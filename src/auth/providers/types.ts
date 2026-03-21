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
  createdAt: unknown;
  updatedAt?: unknown;
  loginMethod: LoginMethod;
  onboardingCompleted: boolean;
  onboardingStarted?: boolean;
  nickname?: string;
  desire?: string;
  lifeStory?: string;
  understandingProgress?: number;
  understandingAnswers?: UnderstandingAnswers;
}
