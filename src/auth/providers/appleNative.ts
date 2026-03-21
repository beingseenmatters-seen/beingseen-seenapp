/**
 * Apple Sign-In provider for iOS native.
 *
 * Status: SCAFFOLD — not yet functional.
 *
 * To activate:
 * 1. Install @capacitor-community/apple-sign-in (or similar plugin)
 * 2. Enable "Sign in with Apple" capability in Xcode
 * 3. Configure Apple Developer portal (Services IDs, Keys)
 * 4. Implement signInWithApple() below:
 *    - Call the native Apple Sign-In plugin to get an identityToken + nonce
 *    - Create a Firebase OAuthProvider credential:
 *        const credential = OAuthProvider.credentialFromJSON({
 *          providerId: 'apple.com',
 *          signInMethod: 'oauth',
 *          idToken: identityToken,
 *          rawNonce: nonce,
 *        });
 *    - Call signInWithCredential(auth, credential)
 *    - Return the Firebase User
 * 5. Set isAppleAvailable() to return true on iOS
 * 6. Enable the Apple button in AuthOptionsScreen
 */

import { isIOS } from '../platform';

const APPLE_CONFIGURED = false;

export function isAppleAvailable(): boolean {
  return isIOS() && APPLE_CONFIGURED;
}

export async function signInWithApple(): Promise<never> {
  // When implementing, this will:
  // 1. Trigger native Apple Sign-In dialog via Capacitor plugin
  // 2. Get identityToken + authorizationCode
  // 3. Create Firebase OAuthCredential
  // 4. Call signInWithCredential(auth, credential)
  // 5. Return the Firebase User
  throw new Error(
    'Apple Sign-In is not yet configured. ' +
    'See auth/providers/appleNative.ts for setup instructions.',
  );
}
