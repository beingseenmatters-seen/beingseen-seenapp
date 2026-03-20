import {
  sendSignInLinkToEmail,
  isSignInWithEmailLink,
  signInWithEmailLink,
  type User,
} from 'firebase/auth';
import { auth } from '../../services/firebase';
import { isNative } from '../platform';

const EMAIL_KEY = 'seen_email_for_signin';

function getCallbackUrl(): string {
  if (isNative()) {
    const appUrl = import.meta.env.VITE_APP_URL;
    if (appUrl) return `${appUrl}/auth/verify`;
    console.warn(
      '[EmailLink] VITE_APP_URL not set — email link callback will not work on native. ' +
      'Set it to your HTTPS hosting domain (e.g. https://seen.web.app).',
    );
    return `https://${import.meta.env.VITE_FIREBASE_AUTH_DOMAIN}`;
  }
  return `${window.location.origin}/auth/verify`;
}

export async function sendEmailLink(email: string): Promise<void> {
  const callbackUrl = getCallbackUrl();
  console.log('[EmailLink] Sending sign-in link', { email, callbackUrl, native: isNative() });
  await sendSignInLinkToEmail(auth, email, {
    url: callbackUrl,
    handleCodeInApp: true,
  });
  localStorage.setItem(EMAIL_KEY, email);
  console.log('[EmailLink] Link sent, email saved to localStorage');
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
  console.log('[EmailLink] completeSignIn', {
    storedEmail: storedEmail ?? '(none)',
    manualEmail: manualEmail ?? '(none)',
    using: email ?? '(none)',
  });

  if (!email) {
    console.error('[EmailLink] No email available for sign-in link completion');
    const err = new Error('no_stored_email');
    (err as unknown as Record<string, string>).code = 'auth/missing-email';
    throw err;
  }

  const result = await signInWithEmailLink(auth, email, url);
  localStorage.removeItem(EMAIL_KEY);
  console.log('[EmailLink] signInWithEmailLink succeeded, uid:', result.user.uid);
  return result.user;
}
