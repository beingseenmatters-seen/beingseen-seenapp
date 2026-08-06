/**
 * App-wired Moments service singleton: localStorage persistence, scoped to the
 * signed-in Firebase uid. Pages and components import this; the pure service
 * (`momentsService.ts`) stays framework-free and fully testable.
 *
 * Moment Platform V1: library comes from MomentLibraryClient (seed/cache/remote),
 * not a compile-time import of MOMENT_LIBRARY on the runtime path.
 */

import { auth } from '../firebase';
import { LocalStorageStore, MomentsService } from './momentsService';
import { MomentLibraryClient } from './libraryClient';
import type { DataRegion } from '../../types/momentLibrary';
import { resolveDataRegion, suggestRegionFromLocale } from './dataRegion';

const store = new LocalStorageStore();

/** Mutable account region — AuthContext updates this after login. */
let accountDataRegion: DataRegion | null = null;
let signedIn = false;

export function setMomentLibraryAccountRegion(
  region: DataRegion | null | undefined,
  isUserSignedIn: boolean,
): void {
  accountDataRegion = region === 'CN' || region === 'GLOBAL' ? region : null;
  signedIn = isUserSignedIn;
}

function currentLibraryRegion(): DataRegion {
  const locale =
    typeof navigator !== 'undefined' ? navigator.language : undefined;
  return resolveDataRegion({
    isSignedIn: signedIn,
    accountDataRegion,
    suggestedRegion: suggestRegionFromLocale(locale),
    suggestionSource: 'locale',
  }).region;
}

export const momentLibraryClient = new MomentLibraryClient(store, currentLibraryRegion);

export const momentsClient = new MomentsService(
  store,
  () => auth.currentUser?.uid ?? null,
  () => momentLibraryClient.getActiveMoments(),
  Math.random,
  Date.now,
  () => momentLibraryClient.getProvenance(),
);

/** Bootstrap seed/cache; then attempt remote sync (no-op if host unset). */
export async function startMomentLibrary(): Promise<void> {
  try {
    await momentLibraryClient.ensureReady();
    await momentLibraryClient.syncRemote();
  } catch (err) {
    console.warn('[MomentLibrary] start failed; seed/cache still used if available', err);
  }
}

void startMomentLibrary();
