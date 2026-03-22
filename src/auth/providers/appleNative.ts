import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { OAuthProvider, signInWithCredential } from 'firebase/auth';
import type { User } from 'firebase/auth';
import { isIOS } from '../platform';
import { auth } from '../../services/firebase';

export function isAppleAvailable(): boolean {
  // We allow Apple sign-in on web now (using Firebase JS SDK)
  return true;
}

export async function signInWithApple(): Promise<{ user: User; displayName?: string }> {
  try {
    if (isIOS()) {
      // Use Capawesome's Firebase Authentication plugin on iOS.
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
      return { user: userCredential.user, displayName };
    } else {
      // Web implementation
      const provider = new OAuthProvider('apple.com');
      provider.addScope('email');
      provider.addScope('name');
      
      const result = await import('firebase/auth').then(m => m.signInWithPopup(auth, provider));
      return { user: result.user, displayName: result.user.displayName || undefined };
    }
  } catch (error: unknown) {
    const err = error as { message?: string; code?: string };
    if (
      err.code === '1001' ||
      err.message?.includes('canceled') ||
      err.message?.includes('cancelled')
    ) {
      const cancelError = new Error('User cancelled') as Error & { code?: string };
      cancelError.code = 'auth/popup-closed-by-user';
      throw cancelError;
    }

    console.error('[auth] signInWithApple error:', error);
    throw error;
  }
}
