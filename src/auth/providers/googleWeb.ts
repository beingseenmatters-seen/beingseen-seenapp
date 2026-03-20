import {
  signInWithPopup,
  GoogleAuthProvider,
  type User,
} from 'firebase/auth';
import { auth } from '../../services/firebase';
import { isWeb } from '../platform';

export function isGoogleAvailable(): boolean {
  return isWeb();
}

export async function signInWithGoogle(): Promise<User> {
  if (!isGoogleAvailable()) {
    throw new Error('Google Sign-In is only available on web. Use Email Link on native.');
  }
  console.log('[GoogleWeb] Starting popup sign-in');
  const provider = new GoogleAuthProvider();
  const result = await signInWithPopup(auth, provider);
  console.log('[GoogleWeb] Sign-in succeeded, uid:', result.user.uid);
  return result.user;
}
