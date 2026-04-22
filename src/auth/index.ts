export { AuthProvider, useAuth } from './AuthContext';
export { AUTH_APP_URL } from './config';
export { getPlatform, isNative, isIOS, isAndroid, isWeb } from './platform';
export type { Platform } from './platform';
export type {
  AboutMeQ5Choice,
  AiResponseStyleId,
  LoginMethod,
  SeenUser,
  SoulProfileAboutMe,
  UnderstandingAnswers,
} from './providers/types';
export { isGoogleAvailable, completeGoogleRedirect } from './providers/googleWeb';
export { isAppleAvailable } from './providers/appleNative';
export { getStoredEmail, isEmailLink } from './providers/emailLink';
