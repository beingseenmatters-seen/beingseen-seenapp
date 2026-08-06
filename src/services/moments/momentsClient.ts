/**
 * App-wired Moments service singleton: localStorage persistence, scoped to the
 * signed-in Firebase uid. Pages and components import this; the pure service
 * (`momentsService.ts`) stays framework-free and fully testable.
 *
 * Moment Platform V1: library comes from MomentLibraryClient (seed/cache/remote),
 * not a compile-time import of MOMENT_LIBRARY on the runtime path.
 */

import { App } from '@capacitor/app';
import { Capacitor } from '@capacitor/core';
import { auth } from '../firebase';
import { LocalStorageStore, MomentsService } from './momentsService';
import { MomentLibraryClient } from './libraryClient';
import type { DataRegion } from '../../types/momentLibrary';
import { resolveDataRegion, suggestRegionFromLocale } from './dataRegion';
import {
  getMomentLibrarySyncDiagnostics,
  installMomentLibraryDiagnosticsBridge,
} from './librarySyncDiagnostics';

const store = new LocalStorageStore();

/** Mutable account region — AuthContext updates this after login. */
let accountDataRegion: DataRegion | null = null;
let signedIn = false;

/** Throttle remote sync storms (cold start + auth + Moments + resume). */
const SYNC_THROTTLE_MS = 15_000;
let lastSyncAttemptAt = 0;
let syncInFlight: Promise<void> | null = null;

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

export { getMomentLibrarySyncDiagnostics };

/** Bootstrap seed/cache; then attempt remote sync (records fallback reason). */
export async function startMomentLibrary(): Promise<void> {
  try {
    await momentLibraryClient.ensureReady();
    await refreshMomentLibraryFromRemote({ force: true });
  } catch (err) {
    console.warn('[MomentLibrary] start failed; seed/cache still used if available', err);
  }
}

/**
 * Re-run remote sync after auth/region is known, Moments entry, or foreground.
 * Throttled unless `force` is set.
 */
export async function refreshMomentLibraryFromRemote(options?: {
  force?: boolean;
}): Promise<void> {
  const force = options?.force ?? false;
  const now = Date.now();
  if (!force && now - lastSyncAttemptAt < SYNC_THROTTLE_MS) {
    return;
  }
  if (syncInFlight) {
    await syncInFlight;
    return;
  }

  lastSyncAttemptAt = now;
  syncInFlight = (async () => {
    try {
      await momentLibraryClient.ensureReady();
      const result = await momentLibraryClient.syncRemote();
      if (!result.promoted) {
        // Reason already recorded + warned inside syncRemote; keep one-line summary.
        console.info('[MomentLibrary] sync result:', result.reason);
      }
    } catch (err) {
      console.warn('[MomentLibrary] refresh failed; keeping seed/cache', err);
    } finally {
      syncInFlight = null;
    }
  })();
  await syncInFlight;
}

/**
 * Update account region from Auth after authentication resolves.
 * Reads account.dataRegion, re-resolves the host, and forces one remote sync
 * on sign-in or whenever the resolved library region changes.
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
  const authResolved = isUserSignedIn && !prevSignedIn;
  const regionChanged = nextRegion !== prevRegion;
  if (authResolved || regionChanged) {
    void refreshMomentLibraryFromRemote({ force: true });
  }
}

function installNativeForegroundSync(): void {
  if (!Capacitor.isNativePlatform()) return;
  void App.addListener('appStateChange', ({ isActive }) => {
    if (isActive) {
      void refreshMomentLibraryFromRemote();
    }
  });
}

installMomentLibraryDiagnosticsBridge();
installNativeForegroundSync();
void startMomentLibrary();
