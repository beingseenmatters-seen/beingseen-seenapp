import { auth } from '../services/firebase';
import { linkWithCredential, linkWithPopup, GoogleAuthProvider, OAuthProvider } from 'firebase/auth';
import { FirebaseAuthentication } from '@capacitor-firebase/authentication';
import { isIOS, isWeb } from './platform';
import { ensureUserDocument } from './firestore';
import { sendEmailLink } from './providers/emailLink';

export async function linkGoogleToCurrentUser() {
  if (!auth.currentUser) throw new Error('No user signed in');
  
  try {
    if (isWeb()) {
      const provider = new GoogleAuthProvider();
      const result = await linkWithPopup(auth.currentUser, provider);
      await ensureUserDocument(result.user, 'google', result.user.displayName);
      return result.user;
    } else {
      // On native iOS/Android, use capacitor-firebase plugin
      const result = await FirebaseAuthentication.signInWithGoogle();
      const credential = GoogleAuthProvider.credential(result.credential?.idToken);
      const linkResult = await linkWithCredential(auth.currentUser, credential);
      await ensureUserDocument(linkResult.user, 'google', result.user?.displayName);
      return linkResult.user;
    }
  } catch (error: any) {
    if (error.code === 'auth/credential-already-in-use') {
      throw new Error('This Google account is already linked to another Seen account.');
    }
    if (error.code === 'auth/provider-already-linked') {
      throw new Error('This Google account is already linked to your current Seen account.');
    }
    throw error;
  }
}

export async function linkAppleToCurrentUser() {
  if (!auth.currentUser) throw new Error('No user signed in');
  if (!isIOS()) throw new Error('Apple linking is only supported on iOS');

  try {
    const result = await FirebaseAuthentication.signInWithApple({
      skipNativeAuth: true,
    });

    const idToken = result.credential?.idToken;
    const rawNonce = result.credential?.nonce;

    if (!idToken || !rawNonce) {
      throw new Error('Apple sign-in did not return a valid credential.');
    }

    const provider = new OAuthProvider('apple.com');
    provider.addScope('email');
    provider.addScope('name');
    provider.setCustomParameters({
      client_id: 'com.beingseenmatters.seen'
    });

    const credential = provider.credential({
      idToken,
      rawNonce,
    });

    const linkResult = await linkWithCredential(auth.currentUser, credential);
    await ensureUserDocument(linkResult.user, 'apple', result.user?.displayName);
    return linkResult.user;
  } catch (error: any) {
    if (error.code === 'auth/credential-already-in-use') {
      throw new Error('This Apple account is already linked to another Seen account.');
    }
    if (error.code === 'auth/provider-already-linked') {
      throw new Error('This Apple account is already linked to your current Seen account.');
    }
    throw error;
  }
}

export async function linkEmailToCurrentUser(email: string) {
  if (!auth.currentUser) throw new Error('No user signed in');
  
  try {
    await sendEmailLink(email);
    // The actual linking happens when they click the link and completeEmailSignIn is called.
  } catch (error: any) {
    throw error;
  }
}
