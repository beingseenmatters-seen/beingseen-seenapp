import {
  createContext,
  useContext,
  useEffect,
  useReducer,
  useCallback,
  useRef,
  type ReactNode,
} from 'react';
import { onAuthStateChanged, signOut as firebaseSignOut, type User } from 'firebase/auth';
import { auth } from '../services/firebase';
import type { SeenUser, LoginMethod } from './providers/types';
import * as emailLink from './providers/emailLink';
import * as googleWeb from './providers/googleWeb';
import * as appleNative from './providers/appleNative';
import * as firestoreOps from './firestore';
import { registerDeepLinkListener } from './deepLink';
import { isNative, isWeb } from './platform';

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

interface AuthState {
  firebaseUser: User | null;
  seenUser: SeenUser | null;
  isLoading: boolean;
  error: string | null;
  initialized: boolean;
}

type AuthAction =
  | { type: 'LOADING' }
  | { type: 'SET_USER'; firebaseUser: User | null; seenUser: SeenUser | null }
  | { type: 'SET_ERROR'; error: string }
  | { type: 'CLEAR_ERROR' }
  | { type: 'UPDATE_SEEN_USER'; seenUser: SeenUser }
  | { type: 'MERGE_SEEN_USER'; data: Partial<SeenUser> };

function authReducer(state: AuthState, action: AuthAction): AuthState {
  switch (action.type) {
    case 'LOADING':
      return { ...state, isLoading: true, error: null };
    case 'SET_USER':
      return {
        ...state,
        firebaseUser: action.firebaseUser,
        seenUser: action.seenUser,
        isLoading: false,
        initialized: true,
      };
    case 'SET_ERROR':
      return { ...state, error: action.error, isLoading: false };
    case 'CLEAR_ERROR':
      return { ...state, error: null };
    case 'UPDATE_SEEN_USER':
      return { ...state, seenUser: action.seenUser };
    case 'MERGE_SEEN_USER': {
      if (!state.firebaseUser) return state;
      const baseUser = state.seenUser || {
        uid: state.firebaseUser.uid,
        email: state.firebaseUser.email || '',
        onboardingCompleted: false,
        understandingProgress: 0
      } as SeenUser;
      const updatedUser = { ...baseUser, ...action.data };
      syncLocalStorage(updatedUser);
      return { ...state, seenUser: updatedUser };
    }
    default:
      return state;
  }
}

// ---------------------------------------------------------------------------
// Error mapping
// ---------------------------------------------------------------------------

function friendlyErrorKey(error: unknown): string {
  const code = (error as { code?: string })?.code;
  switch (code) {
    case 'auth/popup-closed-by-user':
    case 'auth/cancelled-popup-request':
      return 'auth.error_popup_closed';
    case 'auth/popup-blocked':
    case 'auth/operation-not-supported-in-this-environment':
      return 'auth.error_popup_blocked';
    case 'auth/unauthorized-domain':
      return 'auth.error_unauthorized_domain';
    case 'auth/network-request-failed':
      return 'auth.error_network';
    case 'auth/invalid-email':
      return 'auth.error_invalid_email';
    case 'auth/too-many-requests':
      return 'auth.error_too_many';
    case 'auth/user-disabled':
      return 'auth.error_disabled';
    case 'auth/invalid-action-code':
    case 'auth/expired-action-code':
      return 'auth.error_link_expired';
    case 'auth/missing-email':
      return 'auth.error_missing_email';
    case 'auth/credential-already-in-use':
      return 'auth.error_credential_already_in_use';
    case 'auth/provider-already-linked':
      return 'auth.error_provider_already_linked';
    case 'auth/operation-not-allowed':
      return 'auth.error_operation_not_allowed';
    case 'auth/unauthorized-continue-uri':
    case 'auth/invalid-continue-uri':
      return 'auth.error_invalid_continue_uri';
    default:
      return 'auth.error_generic';
  }
}

// ---------------------------------------------------------------------------
// Context interface
// ---------------------------------------------------------------------------

interface AuthContextType extends AuthState {
  signInWithGoogle: () => Promise<void>;
  signInWithApple: () => Promise<void>;
  sendEmailLink: (email: string) => Promise<void>;
  completeEmailSignIn: (manualEmail?: string, deepLinkUrl?: string) => Promise<boolean>;
  updateProfile: (data: Partial<SeenUser>) => Promise<void>;
  signOut: () => Promise<void>;
  clearError: () => void;
}

const AuthContext = createContext<AuthContextType | undefined>(undefined);

const initialState: AuthState = {
  firebaseUser: null,
  seenUser: null,
  isLoading: true,
  error: null,
  initialized: false,
};

// ---------------------------------------------------------------------------
// Provider
// ---------------------------------------------------------------------------

export function AuthProvider({ children }: { children: ReactNode }) {
  const [state, dispatch] = useReducer(authReducer, initialState);
  const pendingDeepLinkRef = useRef<string | null>(null);
  const emailLinkHandledRef = useRef(false);

  // --- Auth state listener + startup checks ---
  useEffect(() => {
    let isHandlingRedirect = false;

    // 1. On web: detect email sign-in link in the current URL BEFORE
    //    onAuthStateChanged fires, so we don't accidentally redirect away.
    if (isWeb() && !emailLinkHandledRef.current) {
      const href = window.location.href;
      if (emailLink.isEmailLink(href)) {
        console.log('[auth] detected email sign-in link on app load');
        emailLinkHandledRef.current = true;
        isHandlingRedirect = true;
        handleWebEmailLink(href).finally(() => {
          isHandlingRedirect = false;
        });
      }
    }

    // 2. On web: pick up any pending redirect sign-ins (Google/Apple).
    if (isWeb() && !isHandlingRedirect) {
      isHandlingRedirect = true;
      const handleRedirects = async () => {
        try {
          const googleUser = await googleWeb.completeGoogleRedirect();
          if (googleUser) {
            console.log('[auth] completed pending google redirect sign-in');
            await firestoreOps.ensureUserDocument(googleUser, 'google');
            return;
          }
          const appleResult = await appleNative.completeAppleRedirect();
          if (appleResult?.user) {
            console.log('[auth] completed pending apple redirect sign-in');
            await firestoreOps.ensureUserDocument(appleResult.user, 'apple', appleResult.displayName);
            return;
          }
        } catch (err) {
          console.error('[auth] redirect completion error:', err);
        } finally {
          isHandlingRedirect = false;
        }
      };
      handleRedirects();
    }

    // 3. Standard Firebase auth state listener.
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      console.log('[auth] onAuthStateChanged:', user ? `uid=${user.uid}` : 'null');
      
      // If we are currently handling a redirect or email link, we should wait
      // for that to finish creating the user document before we fetch it.
      if (user && isHandlingRedirect) {
        console.log('[auth] waiting for redirect handler to finish ensureUserDocument...');
        // Simple polling wait
        for (let i = 0; i < 20; i++) {
          if (!isHandlingRedirect) break;
          await new Promise(r => setTimeout(r, 200));
        }
      }

      if (user) {
        try {
          let seenUser = await firestoreOps.getUserDocument(user.uid);
          // If still null, maybe it's a brand new user that didn't go through our wrappers?
          // Let's ensure it exists just in case.
          if (!seenUser) {
             console.log('[auth] seenUser not found in onAuthStateChanged, ensuring doc exists');
             seenUser = await firestoreOps.ensureUserDocument(user, 'email'); // fallback method
          }
          dispatch({ type: 'SET_USER', firebaseUser: user, seenUser });
          syncLocalStorage(seenUser);
        } catch (err) {
          console.error('[auth] error fetching user document:', err);
          dispatch({ type: 'SET_USER', firebaseUser: user, seenUser: null });
        }
      } else {
        dispatch({ type: 'SET_USER', firebaseUser: null, seenUser: null });
      }
    });

    // 4. On native: listen for deep links (email sign-in links opened from email app).
    const removeDeepLink = registerDeepLinkListener((url) => {
      if (emailLink.isEmailLink(url)) {
        console.log('[auth] deep link is an email sign-in link, completing...');
        handleDeepLinkEmailSignIn(url);
      } else {
        console.log('[auth] deep link received but not an email sign-in link');
      }
    });

    return () => {
      unsubscribe();
      removeDeepLink();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // --- Web email link handler (called once on app load) ---
  const handleWebEmailLink = async (href: string) => {
    const storedEmail = emailLink.getStoredEmail();
    console.log('[auth] handling web email link', { hasStoredEmail: !!storedEmail });

    if (!storedEmail) {
      // No stored email — the EmailLinkWaitingScreen will prompt the user.
      // Don't block here; let the app render normally so the user can
      // type their email on the verify screen.
      console.log('[auth] no stored email — waiting for user input on verify screen');
      return;
    }

    dispatch({ type: 'LOADING' });
    try {
      const user = await emailLink.completeEmailSignIn(href);
      await firestoreOps.ensureUserDocument(user, 'email');
      // Clean the URL so the sign-in params don't linger.
      window.history.replaceState({}, '', '/');
      console.log('[auth] web email link sign-in completed');
    } catch (err) {
      console.error('[auth] web email link sign-in failed:', (err as Error)?.message);
      dispatch({ type: 'SET_ERROR', error: friendlyErrorKey(err) });
    }
  };

  // --- Native deep link email handler ---
  const handleDeepLinkEmailSignIn = async (url: string) => {
    const storedEmail = emailLink.getStoredEmail();
    console.log('[auth] handleDeepLinkEmailSignIn', { hasStoredEmail: !!storedEmail, url });

    if (!storedEmail) {
      pendingDeepLinkRef.current = url;
      dispatch({ type: 'SET_ERROR', error: 'auth.error_missing_email' });
      return;
    }

    dispatch({ type: 'LOADING' });
    try {
      const user = await emailLink.completeEmailSignIn(url);
      await firestoreOps.ensureUserDocument(user, 'email');
      pendingDeepLinkRef.current = null;
      console.log('[auth] deep link email sign-in completed');
    } catch (err) {
      console.error('[auth] deep link email sign-in failed:', (err as Error)?.message, err);
      dispatch({ type: 'SET_ERROR', error: friendlyErrorKey(err) });
    }
  };

  // --- Provider-based sign-in helpers ---

  const handleProviderAuth = useCallback(
    async (method: LoginMethod, action: () => Promise<User | { user: User; displayName?: string }>) => {
      console.log('[auth] provider sign-in started:', method);
      dispatch({ type: 'LOADING' });
      try {
        const result = await action();
        const user = 'user' in result ? result.user : result;
        const displayName = ('displayName' in result && result.displayName) ? result.displayName : undefined;
        
        await firestoreOps.ensureUserDocument(user, method, displayName);
        const seenUser = await firestoreOps.getUserDocument(user.uid);
        dispatch({ type: 'SET_USER', firebaseUser: user, seenUser });
        syncLocalStorage(seenUser);
        console.log('[auth] provider sign-in succeeded:', method);
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (
          code === 'auth/popup-closed-by-user' ||
          code === 'auth/cancelled-popup-request'
        ) {
          console.log('[auth] sign-in cancelled by user');
          dispatch({ type: 'CLEAR_ERROR' });
          dispatch({
            type: 'SET_USER',
            firebaseUser: state.firebaseUser,
            seenUser: state.seenUser,
          });
          return;
        }
        console.error('[auth] provider sign-in failed:', method, code, (err as Error)?.message);
        dispatch({ type: 'SET_ERROR', error: friendlyErrorKey(err) });
        throw err;
      }
    },
    [state.firebaseUser, state.seenUser],
  );

  const signInWithGoogle = useCallback(
    () => handleProviderAuth('google', googleWeb.signInWithGoogle),
    [handleProviderAuth],
  );

  const signInWithApple = useCallback(
    () => handleProviderAuth('apple', appleNative.signInWithApple),
    [handleProviderAuth],
  );

  const sendEmailLinkAction = useCallback(
    async (email: string) => {
      dispatch({ type: 'LOADING' });
      try {
        await emailLink.sendEmailLink(email);
        dispatch({ type: 'CLEAR_ERROR' });
        dispatch({
          type: 'SET_USER',
          firebaseUser: state.firebaseUser,
          seenUser: state.seenUser,
        });
      } catch (err) {
        console.error('[auth] failed to send email link:', (err as Error)?.message, err);
        dispatch({ type: 'SET_ERROR', error: friendlyErrorKey(err) });
        throw err;
      }
    },
    [state.firebaseUser, state.seenUser],
  );

  const completeEmailSignIn = useCallback(
    async (manualEmail?: string, deepLinkUrl?: string): Promise<boolean> => {
      const url =
        deepLinkUrl ||
        pendingDeepLinkRef.current ||
        (isNative() ? null : window.location.href);

      console.log('[auth] completeEmailSignIn called', {
        source: deepLinkUrl ? 'deepLink' : pendingDeepLinkRef.current ? 'pendingRef' : 'windowHref',
        isLink: url ? emailLink.isEmailLink(url) : false,
        hasManualEmail: !!manualEmail,
        url
      });

      if (!url || !emailLink.isEmailLink(url)) {
        console.log('[auth] no valid email sign-in link URL available');
        return false;
      }

      dispatch({ type: 'LOADING' });
      try {
        const user = await emailLink.completeEmailSignIn(url, manualEmail);
        await firestoreOps.ensureUserDocument(user, 'email');
        pendingDeepLinkRef.current = null;
        if (!isNative()) {
          window.history.replaceState({}, '', '/');
        }
        console.log('[auth] email sign-in completed successfully');
        return true;
      } catch (err) {
        console.error('[auth] email sign-in failed:', (err as Error)?.message, (err as { code?: string })?.code, err);
        dispatch({ type: 'SET_ERROR', error: friendlyErrorKey(err) });
        return false;
      }
    },
    [],
  );

  const updateProfile = useCallback(
    async (data: Partial<SeenUser>) => {
      if (!state.firebaseUser) throw new Error('No authenticated user');
      
      // 1. Optimistic update for instant UI response
      dispatch({ type: 'MERGE_SEEN_USER', data });

      // 2. Perform network request
      // We intentionally DO NOT refetch getUserDocument here to avoid race conditions
      // where an older background sync overwrites a newer optimistic update.
      await firestoreOps.updateUserDocument(state.firebaseUser.uid, data);
    },
    [state.firebaseUser],
  );

  const signOutAction = useCallback(async () => {
    dispatch({ type: 'LOADING' });
    try {
      await firebaseSignOut(auth);
      emailLink.clearStoredEmail();
      localStorage.removeItem('seen_user');
      dispatch({ type: 'SET_USER', firebaseUser: null, seenUser: null });
      console.log('[auth] user signed out');
    } catch (err) {
      dispatch({ type: 'SET_ERROR', error: friendlyErrorKey(err) });
    }
  }, []);

  const clearError = useCallback(() => {
    dispatch({ type: 'CLEAR_ERROR' });
  }, []);

  return (
    <AuthContext.Provider
      value={{
        ...state,
        signInWithGoogle,
        signInWithApple,
        sendEmailLink: sendEmailLinkAction,
        completeEmailSignIn,
        updateProfile,
        signOut: signOutAction,
        clearError,
      }}
    >
      {children}
    </AuthContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Hook
// ---------------------------------------------------------------------------

export function useAuth(): AuthContextType {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used within AuthProvider');
  return ctx;
}

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function syncLocalStorage(seenUser: SeenUser | null) {
  if (!seenUser) return;
  try {
    const prev = JSON.parse(localStorage.getItem('seen_user') || '{}');
    localStorage.setItem(
      'seen_user',
      JSON.stringify({
        ...prev,
        nickname: seenUser.nickname ?? prev.nickname,
        onboarded: seenUser.onboardingCompleted,
      }),
    );
  } catch {
    // Ignore localStorage errors
  }
}
