import { isNative } from '../platform';

/**
 * Clear native provider sessions (Google Credential Manager / GIDSignIn, etc.).
 *
 * Firebase JS `signOut` alone does not clear Android's Credential Manager or
 * iOS GIDSignIn. After explicit logout, the next "Continue with Google" must
 * show the account chooser — matching iOS behaviour.
 *
 * Safe on cold start: app-launch silent restore uses Firebase JS persistence
 * via `onAuthStateChanged`, not a native Google silent sign-in. Call this
 * only from explicit logout / account deletion.
 */
export async function clearNativeAuthProviders(): Promise<void> {
  if (!isNative()) return;
  try {
    const { FirebaseAuthentication } = await import('@capacitor-firebase/authentication');
    await FirebaseAuthentication.signOut();
    console.log('[auth] native provider sessions cleared');
  } catch (err) {
    console.warn('[auth] native provider signOut failed:', (err as Error)?.message);
  }
}
