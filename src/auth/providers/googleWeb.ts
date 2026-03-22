import {
  signInWithPopup,
  signInWithRedirect,
  getRedirectResult,
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
    } else {
      // Native iOS/Android Google Sign-In
      const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
      const result = await FirebaseAuthentication.signInWithGoogle();
      const credential = GoogleAuthProvider.credential(result.credential?.idToken);
      const userCredential = await import('firebase/auth').then(m => m.signInWithCredential(auth, credential));
      console.log('[auth] native google sign-in succeeded, uid:', userCredential.user.uid);
      return userCredential.user;
    }
  } catch (err) {
    const code = (err as { code?: string })?.code;
    const message = (err as Error)?.message ?? '';
    console.error('[auth] google sign-in failed:', code, message);

    if (
      code === 'auth/popup-closed-by-user' ||
      code === 'auth/cancelled-popup-request'
    ) {
      throw err;
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
