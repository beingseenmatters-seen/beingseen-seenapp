export type LoginMethod = 'apple' | 'google' | 'email';

export interface SeenUser {
  uid: string;
  email: string;
  createdAt: unknown;
  loginMethod: LoginMethod;
  onboardingCompleted: boolean;
  nickname?: string;
  desire?: string;
}
