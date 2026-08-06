import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
  signInWithCredential,
  GoogleAuthProvider,
  type User,
} from 'firebase/auth';
import { auth } from '../../services/firebase';
import { isWeb } from '../platform';

const provider = new GoogleAuthProvider();

export function isGoogleAvailable(): boolean {
  // We now support Google Sign-In on both Web and Native (iOS/Android)
  return true;
}

function isUserCancelled(err: unknown): boolean {
  const code = String((err as { code?: string })?.code ?? '');
  const message = String((err as Error)?.message ?? '').toLowerCase();
  return (
    code === 'auth/popup-closed-by-user' ||
    code === 'auth/cancelled-popup-request' ||
    message.includes('cancel') ||
    message.includes('cancelled') ||
    message.includes('canceled')
  );
}

/**
 * Native Google Sign-In via Capacitor plugin, then Firebase JS credential.
 * Matches Apple: skipNativeAuth so the JS Auth session is the source of truth.
 * Falls back from Credential Manager to legacy Google Sign-In on Android.
 */
async function signInWithGoogleNative(): Promise<User> {
  const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');

  const complete = async (useCredentialManager: boolean) => {
    console.log('[auth] native google sign-in, useCredentialManager=', useCredentialManager);
    const result = await FirebaseAuthentication.signInWithGoogle({
      skipNativeAuth: true,
      useCredentialManager,
    });
    const idToken = result.credential?.idToken;
    if (!idToken) {
      const missing = new Error('Google sign-in did not return an ID token.') as Error & {
        code?: string;
      };
      missing.code = 'auth/missing-google-id-token';
      throw missing;
    }
    const credential = GoogleAuthProvider.credential(idToken);
    const userCredential = await signInWithCredential(auth, credential);
    console.log('[auth] native google sign-in succeeded, uid:', userCredential.user.uid);
    return userCredential.user;
  };

  try {
    return await complete(true);
  } catch (err) {
    if (isUserCancelled(err)) throw err;
    console.warn(
      '[auth] Credential Manager Google sign-in failed, retrying legacy flow:',
      (err as Error)?.message,
    );
    return await complete(false);
  }
}

/**
 * Attempt popup sign-in first. If the popup is blocked or fails
 * for environment reasons, fall back to redirect-based sign-in.
 */
export async function signInWithGoogle(): Promise<User> {
  console.log('[auth] starting google sign-in');

  try {
    if (isWeb()) {
      const result = await signInWithPopup(auth, provider);
      console.log('[auth] google popup sign-in succeeded, uid:', result.user.uid);
      return result.user;
    }

    return await signInWithGoogleNative();
  } catch (err) {
    const code = (err as { code?: string })?.code;
    const message = (err as Error)?.message ?? '';
    console.error('[auth] google sign-in failed:', code, message);

    if (isUserCancelled(err)) {
      const cancelled = new Error(message || 'User cancelled') as Error & { code?: string };
      cancelled.code = 'auth/popup-closed-by-user';
      throw cancelled;
    }

    if (
      code === 'auth/popup-blocked' ||
      code === 'auth/operation-not-supported-in-this-environment'
    ) {
      console.log('[auth] popup blocked/unsupported, falling back to redirect');
      await signInWithRedirect(auth, provider);
      // signInWithRedirect navigates away; this line is unreachable,
      // but TypeScript needs a return. The result is picked up by
      // completeGoogleRedirect() on the next page load.
      throw err;
    }

    if (code === 'auth/unauthorized-domain') {
      console.error(
        '[auth] unauthorized domain — add this domain to Firebase Console → ' +
        'Authentication → Settings → Authorized domains:',
        window.location.hostname,
      );
    }

    throw err;
  }
}

/**
 * Call on app startup to pick up a redirect-based Google sign-in
 * that was initiated by signInWithRedirect.
 */
export async function completeGoogleRedirect(): Promise<User | null> {
  try {
    const result = await getRedirectResult(auth);
    if (result?.user) {
      console.log('[auth] google redirect sign-in completed, uid:', result.user.uid);
      return result.user;
    }
    return null;
  } catch (err) {
    console.error('[auth] google redirect completion failed:', (err as Error)?.message);
    return null;
  }
}
