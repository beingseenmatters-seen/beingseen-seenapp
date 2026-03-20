import {
  doc,
  getDoc,
  setDoc,
  serverTimestamp,
} from 'firebase/firestore';
import { db } from '../services/firebase';
import type { User } from 'firebase/auth';
import type { SeenUser, LoginMethod } from './providers/types';

export async function ensureUserDocument(
  user: User,
  method: LoginMethod,
): Promise<SeenUser> {
  const userRef = doc(db, 'users', user.uid);
  const snapshot = await getDoc(userRef);

  if (snapshot.exists()) {
    return snapshot.data() as SeenUser;
  }

  const newUser: SeenUser = {
    uid: user.uid,
    email: user.email || '',
    createdAt: serverTimestamp(),
    loginMethod: method,
    onboardingCompleted: false,
  };

  await setDoc(userRef, newUser);
  return newUser;
}

export async function getUserDocument(uid: string): Promise<SeenUser | null> {
  const snapshot = await getDoc(doc(db, 'users', uid));
  return snapshot.exists() ? (snapshot.data() as SeenUser) : null;
}

export async function updateUserDocument(
  uid: string,
  data: Partial<SeenUser>,
): Promise<void> {
  await setDoc(doc(db, 'users', uid), data, { merge: true });
}
