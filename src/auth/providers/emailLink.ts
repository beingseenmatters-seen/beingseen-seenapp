import {
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  type User,
} from 'firebase/auth';
import { auth } from '../../services/firebase';
import { AUTH_APP_URL } from '../config';

const EMAIL_KEY = 'seen_email_for_signin';

export async function sendEmailLink(email: string): Promise<void> {
  const callbackUrl = `${AUTH_APP_URL}/auth/verify`;

  console.log('[auth] sending email link', { email, callbackUrl });

  await sendSignInLinkToEmail(auth, email, {
    url: callbackUrl,
    handleCodeInApp: true,
  });

  localStorage.setItem(EMAIL_KEY, email);
  console.log('[auth] email link sent, email saved to localStorage');
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

  const result = await signInWithEmailLink(auth, email, url);
  localStorage.removeItem(EMAIL_KEY);
  console.log('[auth] email link sign-in succeeded, uid:', result.user.uid);
  return result.user;
}
