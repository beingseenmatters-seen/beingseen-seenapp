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
import { isNative } from './platform';

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
  | { type: 'UPDATE_SEEN_USER'; seenUser: SeenUser };

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

  // --- Auth state listener + native deep link listener ---
  useEffect(() => {
    const unsubscribe = onAuthStateChanged(auth, async (user) => {
      if (user) {
        try {
          const seenUser = await firestoreOps.getUserDocument(user.uid);
          dispatch({ type: 'SET_USER', firebaseUser: user, seenUser });
          syncLocalStorage(seenUser);
        } catch {
          dispatch({ type: 'SET_USER', firebaseUser: user, seenUser: null });
        }
      } else {
        dispatch({ type: 'SET_USER', firebaseUser: null, seenUser: null });
      }
    });

    // On native, listen for deep links (email sign-in links opened from email app).
    // On web, email link completion is handled by EmailLinkWaitingScreen.
    const removeDeepLink = registerDeepLinkListener((url) => {
      if (emailLink.isEmailLink(url)) {
        console.log('[Auth] Deep link is an email sign-in link, completing...');
        handleDeepLinkEmailSignIn(url);
      } else {
        console.log('[Auth] Deep link received but not an email sign-in link:', url);
      }
    });

    return () => {
      unsubscribe();
      removeDeepLink();
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDeepLinkEmailSignIn = async (url: string) => {
    const storedEmail = emailLink.getStoredEmail();
    console.log('[Auth] handleDeepLinkEmailSignIn', { url, storedEmail: storedEmail ?? '(none)' });

    if (!storedEmail) {
      console.log('[Auth] No stored email for deep link — saving URL for manual entry');
      pendingDeepLinkRef.current = url;
      dispatch({ type: 'SET_ERROR', error: 'auth.error_missing_email' });
      return;
    }

    dispatch({ type: 'LOADING' });
    try {
      const user = await emailLink.completeEmailSignIn(url);
      await firestoreOps.ensureUserDocument(user, 'email');
      pendingDeepLinkRef.current = null;
      console.log('[Auth] Deep link email sign-in completed');
    } catch (err) {
      console.error('[Auth] Deep link email sign-in failed:', (err as Error)?.message, (err as { code?: string })?.code);
      dispatch({ type: 'SET_ERROR', error: friendlyErrorKey(err) });
    }
  };

  // --- Provider-based sign-in helpers ---

  const handleProviderAuth = useCallback(
    async (method: LoginMethod, action: () => Promise<User>) => {
      console.log('[Auth] Provider sign-in started:', method);
      dispatch({ type: 'LOADING' });
      try {
        const user = await action();
        await firestoreOps.ensureUserDocument(user, method);
        const seenUser = await firestoreOps.getUserDocument(user.uid);
        dispatch({ type: 'SET_USER', firebaseUser: user, seenUser });
        syncLocalStorage(seenUser);
        console.log('[Auth] Provider sign-in succeeded:', method);
      } catch (err) {
        const code = (err as { code?: string })?.code;
        if (
          code === 'auth/popup-closed-by-user' ||
          code === 'auth/cancelled-popup-request'
        ) {
          dispatch({ type: 'CLEAR_ERROR' });
          dispatch({
            type: 'SET_USER',
            firebaseUser: state.firebaseUser,
            seenUser: state.seenUser,
          });
          return;
        }
        console.error('[Auth] Provider sign-in failed:', method, (err as Error)?.message);
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

      console.log('[Auth] completeEmailSignIn called', {
        source: deepLinkUrl ? 'deepLink' : pendingDeepLinkRef.current ? 'pendingRef' : 'windowHref',
        isEmailLink: url ? emailLink.isEmailLink(url) : false,
        manualEmail: manualEmail ?? '(auto)',
        native: isNative(),
      });

      if (!url || !emailLink.isEmailLink(url)) {
        console.log('[Auth] No valid email sign-in link URL available');
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
        console.log('[Auth] Email sign-in completed successfully');
        return true;
      } catch (err) {
        console.error(
          '[Auth] Email sign-in failed:',
          (err as Error)?.message,
          (err as { code?: string })?.code,
        );
        dispatch({ type: 'SET_ERROR', error: friendlyErrorKey(err) });
        return false;
      }
    },
    [],
  );

  const updateProfile = useCallback(
    async (data: Partial<SeenUser>) => {
      if (!state.firebaseUser) throw new Error('No authenticated user');
      await firestoreOps.updateUserDocument(state.firebaseUser.uid, data);
      const updated = await firestoreOps.getUserDocument(state.firebaseUser.uid);
      if (updated) {
        console.log('[Auth] Profile updated:', {
          onboardingCompleted: updated.onboardingCompleted,
          nickname: updated.nickname,
        });
        dispatch({ type: 'UPDATE_SEEN_USER', seenUser: updated });
        syncLocalStorage(updated);
      } else {
        throw new Error('Failed to read back updated profile');
      }
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
      console.log('[Auth] User signed out');
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
