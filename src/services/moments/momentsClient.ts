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

/**
 * Re-run remote sync after auth/region is known.
 * Needed because the first bootstrap often runs while signed-out; zh locales
 * resolve to CN (no host configured) and would otherwise stay on seed forever.
 */
export async function refreshMomentLibraryFromRemote(): Promise<void> {
  try {
    await momentLibraryClient.ensureReady();
    await momentLibraryClient.syncRemote();
  } catch (err) {
    console.warn('[MomentLibrary] refresh failed; keeping seed/cache', err);
  }
}

/**
 * Update account region from Auth. When the resolved library region changes,
 * or the user signs in, trigger another remote sync so GLOBAL clients on
 * zh devices pick up the published library after login.
 */
export function setMomentLibraryAccountRegion(
  region: DataRegion | null | undefined,
  isUserSignedIn: boolean,
): void {
  const prevRegion = currentLibraryRegion();
  const prevSignedIn = signedIn;

  accountDataRegion = region === 'CN' || region === 'GLOBAL' ? region : null;
  signedIn = isUserSignedIn;

  const nextRegion = currentLibraryRegion();
  const signedInNow = isUserSignedIn && !prevSignedIn;
  if (nextRegion !== prevRegion || signedInNow) {
    void refreshMomentLibraryFromRemote();
  }
}

void startMomentLibrary();
