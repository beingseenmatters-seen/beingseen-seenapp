import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { OAuthProvider, signInWithCredential, signInWithPopup, signInWithRedirect, getRedirectResult } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { isIOS, isWeb } from '../platform';
import { auth } from '../../services/firebase';

export function isAppleAvailable(): boolean {
  return true;
}

export async function signInWithApple(): Promise<{ user: User; displayName?: string }> {
  console.log('[auth] starting apple sign-in');
  try {
    if (isIOS()) {
      const result = await FirebaseAuthentication.signInWithApple({
        skipNativeAuth: true,
      });

      const idToken = result.credential?.idToken ?? undefined;
      const rawNonce = result.credential?.nonce ?? undefined;

      if (!idToken || !rawNonce) {
        throw new Error('Apple sign-in did not return a Firebase credential.');
      }

      const provider = new OAuthProvider('apple.com');
      const credential = provider.credential({
        idToken,
        rawNonce,
      });

      const userCredential = await signInWithCredential(auth, credential);
      const displayName = result.user?.displayName ?? undefined;
      console.log('[auth] native apple sign-in succeeded, uid:', userCredential.user.uid);
      return { user: userCredential.user, displayName };
    } else {
      // Web implementation
      const provider = new OAuthProvider('apple.com');
      provider.addScope('email');
      provider.addScope('name');
      
      const result = await signInWithPopup(auth, provider);
      console.log('[auth] web apple popup sign-in succeeded, uid:', result.user.uid);
      return { user: result.user, displayName: result.user.displayName || undefined };
    }
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    console.error('[auth] apple sign-in failed:', err.code, err.message);

    if (
      err.code === '1001' ||
      err.code === 'auth/popup-closed-by-user' ||
      err.code === 'auth/cancelled-popup-request' ||
      err.message?.includes('canceled') ||
      err.message?.includes('cancelled')
    ) {
      const cancelError = new Error('User cancelled') as Error & { code?: string };
      cancelError.code = 'auth/popup-closed-by-user';
      throw cancelError;
    }

    if (
      isWeb() &&
      (err.code === 'auth/popup-blocked' ||
       err.code === 'auth/operation-not-supported-in-this-environment')
    ) {
      console.log('[auth] apple popup blocked/unsupported, falling back to redirect');
      const provider = new OAuthProvider('apple.com');
      provider.addScope('email');
      provider.addScope('name');
      await signInWithRedirect(auth, provider);
      // Unreachable, but needed for TS
      throw err;
    }

    throw error;
  }
}

export async function completeAppleRedirect(): Promise<{ user: User; displayName?: string } | null> {
  try {
    const result = await getRedirectResult(auth);
    if (result?.user && result.providerId === 'apple.com') {
      console.log('[auth] apple redirect sign-in completed, uid:', result.user.uid);
      return { user: result.user, displayName: result.user.displayName || undefined };
    }
    return null;
  } catch (err) {
    console.error('[auth] apple redirect completion failed:', (err as Error)?.message);
    return null;
  }
}
