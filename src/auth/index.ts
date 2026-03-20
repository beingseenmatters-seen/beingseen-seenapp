export { AuthProvider, useAuth } from './AuthContext';
export { getPlatform, isNative, isIOS, isAndroid, isWeb } from './platform';
export type { Platform } from './platform';
export type { LoginMethod, SeenUser } from './providers/types';
export { isGoogleAvailable } from './providers/googleWeb';
export { isAppleAvailable } from './providers/appleNative';
export { getStoredEmail, isEmailLink } from './providers/emailLink';
