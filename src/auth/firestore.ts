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
  displayName?: string | null,
): Promise<SeenUser> {
  const userRef = doc(db, 'users', user.uid);
  const snapshot = await getDoc(userRef);

  const email = user.email || '';
  const isAppleRelay = email.endsWith('privaterelay.appleid.com');
  const providerId = method === 'apple' ? 'apple.com' : method === 'google' ? 'google.com' : 'emailLink';

  if (snapshot.exists()) {
    const existing = snapshot.data() as SeenUser;
    const updates: Partial<SeenUser> = {
      lastLoginProvider: providerId,
    };
    
    // Add to allEmails if new
    if (email) {
      const currentEmails = existing.allEmails || [existing.primaryEmail || existing.email].filter(Boolean);
      if (!currentEmails.includes(email)) {
        updates.allEmails = Array.from(new Set([...currentEmails, email]));
      }
    }
    
    // Add to providers if new
    const currentProviders = existing.providers || [existing.provider || existing.loginMethod].filter(Boolean);
    if (!currentProviders.includes(providerId)) {
      updates.providers = Array.from(new Set([...currentProviders, providerId]));
    }

    if (Object.keys(updates).length > 0) {
      await setDoc(userRef, updates, { merge: true });
      return { ...existing, ...updates };
    }
    
    return existing;
  }

  const newUser: SeenUser = {
    uid: user.uid,
    email: email,
    primaryEmail: email,
    allEmails: email ? [email] : [],
    isAppleRelayEmail: isAppleRelay,
    providers: [providerId],
    lastLoginProvider: providerId,
    createdAt: serverTimestamp(),
    loginMethod: method,
    onboardingCompleted: false,
    onboardingStarted: false,
    understandingProgress: 0,
  };

  if (displayName) {
    newUser.nickname = displayName;
  }
  
  if (method === 'apple') {
    newUser.provider = 'apple.com';
  }

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
  await setDoc(doc(db, 'users', uid), { ...data, updatedAt: serverTimestamp() }, { merge: true });
}
