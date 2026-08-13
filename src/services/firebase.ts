import { initializeApp } from 'firebase/app';
import { getAuth, initializeAuth, indexedDBLocalPersistence, connectAuthEmulator } from 'firebase/auth';
import { getFirestore, connectFirestoreEmulator } from 'firebase/firestore';
import { isNative } from '../auth/platform';

const firebaseConfig = {
  apiKey: import.meta.env.VITE_FIREBASE_API_KEY ?? '',
  authDomain: import.meta.env.VITE_FIREBASE_AUTH_DOMAIN ?? '',
  projectId: import.meta.env.VITE_FIREBASE_PROJECT_ID ?? '',
  storageBucket: import.meta.env.VITE_FIREBASE_STORAGE_BUCKET ?? '',
  messagingSenderId: import.meta.env.VITE_FIREBASE_MESSAGING_SENDER_ID ?? '',
  appId: import.meta.env.VITE_FIREBASE_APP_ID ?? '',
};

export const app = initializeApp(firebaseConfig);

// On native iOS/Android, avoid browserPopupRedirectResolver to prevent iframe creation
// which can cause ATS errors with insecure HTTP requests.
export const auth = isNative()
  ? initializeAuth(app, { persistence: indexedDBLocalPersistence })
  : getAuth(app);

export const db = getFirestore(app);

// Local SSO verification rig ONLY (never set in any deployed env): points web
// auth + firestore at the Firebase emulators. Dev-build only — dead code in
// production builds.
if (!isNative() && import.meta.env.DEV && import.meta.env.VITE_AUTH_EMULATOR === '1') {
  connectAuthEmulator(auth, 'http://127.0.0.1:9099', { disableWarnings: true });
  connectFirestoreEmulator(db, '127.0.0.1', 8080);
  import('firebase/auth').then(({ signInWithCustomToken }) => {
    (window as unknown as Record<string, unknown>).__rigSignIn = (t: string) =>
      signInWithCustomToken(auth, t);
  });
}
