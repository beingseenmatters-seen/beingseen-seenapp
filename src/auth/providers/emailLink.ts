import {
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  linkWithCredential,
  EmailAuthProvider,
  type User,
} from 'firebase/auth';
import { auth } from '../../services/firebase';
import { AUTH_APP_URL } from '../config';

const EMAIL_KEY = 'seen_email_for_signin';

export async function sendEmailLink(email: string): Promise<void> {
  const callbackUrl = `${AUTH_APP_URL}/auth/verify`;

  console.log('[auth] sending email link', { email, callbackUrl });

  try {
    await sendSignInLinkToEmail(auth, email, {
      url: callbackUrl,
      handleCodeInApp: true,
      iOS: {
        bundleId: 'com.beingseenmatters.seen',
      },
      android: {
        packageName: 'com.beingseenmatters.seen',
        installApp: false,
      },
    });

    localStorage.setItem(EMAIL_KEY, email);
    console.log('[auth] email link sent, email saved to localStorage');
  } catch (err) {
    console.error('[auth] sendSignInLinkToEmail raw error:', err);
    throw err;
  }
}

export function getStoredEmail(): string | null {
  return localStorage.getItem(EMAIL_KEY);
}

export function clearStoredEmail(): void {
  localStorage.removeItem(EMAIL_KEY);
}

export function isEmailLink(url: string): boolean {
  return isSignInWithEmailLink(auth, url);
}

export async function completeEmailSignIn(
  url: string,
  manualEmail?: string,
): Promise<User> {
  const storedEmail = localStorage.getItem(EMAIL_KEY);
  const email = manualEmail || storedEmail;

  console.log('[auth] completing email link sign-in', {
    hasStoredEmail: !!storedEmail,
    hasManualEmail: !!manualEmail,
    usingEmail: email ? '(set)' : '(none)',
  });

  if (!email) {
    console.error('[auth] no email available for sign-in link completion');
    const err = new Error('no_stored_email');
    (err as unknown as Record<string, string>).code = 'auth/missing-email';
    throw err;
  }

  let result;
  try {
    if (auth.currentUser) {
      // Link to existing user
      const credential = EmailAuthProvider.credentialWithLink(email, url);
      result = await linkWithCredential(auth.currentUser, credential);
      console.log('[auth] email link successfully linked to current user');
    } else {
      // Sign in as new/existing user
      result = await signInWithEmailLink(auth, email, url);
      console.log('[auth] email link sign-in succeeded, uid:', result.user.uid);
    }
  } catch (err: any) {
    console.error('[auth] email link completion raw error:', err);
    if (err.code === 'auth/credential-already-in-use') {
      throw new Error('This email is already linked to another Seen account.');
    }
    if (err.code === 'auth/provider-already-linked') {
      throw new Error('This email is already linked to your current Seen account.');
    }
    throw err;
  }

  localStorage.removeItem(EMAIL_KEY);
  return result.user;
}
