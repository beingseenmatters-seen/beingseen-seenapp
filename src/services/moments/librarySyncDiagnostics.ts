/**
 * Safe Moment Library sync diagnostics for acceptance testing.
 * No user PII — region/base/versions/reasons only.
 */

import type { DataRegion } from '../../types/momentLibrary';

export interface MomentLibrarySyncDiagnostics {
  /** Wall-clock of last sync attempt. */
  updatedAt: number | null;
  resolvedRegion: DataRegion | null;
  resolvedRemoteBase: string | null;
  manifestUrl: string | null;
  /** Set when an HTTP fetch was attempted. */
  httpStatus: number | null;
  httpContentType: string | null;
  fetchedManifestLibraryVersion: number | null;
  activeLibraryVersion: number | null;
  promoted: boolean | null;
  /** Machine-readable reason (never silent). */
  fallbackReason: string | null;
  lastError: string | null;
}

const empty: MomentLibrarySyncDiagnostics = {
  updatedAt: null,
  resolvedRegion: null,
  resolvedRemoteBase: null,
  manifestUrl: null,
  httpStatus: null,
  httpContentType: null,
  fetchedManifestLibraryVersion: null,
  activeLibraryVersion: null,
  promoted: null,
  fallbackReason: null,
  lastError: null,
};

let snapshot: MomentLibrarySyncDiagnostics = { ...empty };

export function getMomentLibrarySyncDiagnostics(): MomentLibrarySyncDiagnostics {
  return { ...snapshot };
}

export function recordMomentLibrarySyncDiagnostics(
  patch: Partial<MomentLibrarySyncDiagnostics>,
): void {
  snapshot = {
    ...snapshot,
    ...patch,
    updatedAt: Date.now(),
  };
}

export function resetMomentLibrarySyncDiagnostics(): void {
  snapshot = { ...empty };
}

/** Attach read-only diagnostics getter for acceptance builds when enabled. */
export function installMomentLibraryDiagnosticsBridge(): void {
  const enabled =
    import.meta.env.DEV ||
    String(import.meta.env.VITE_MOMENT_LIBRARY_DEBUG || '') === '1';
  if (!enabled || typeof window === 'undefined') return;
  (window as unknown as { __seenMomentLibraryDiagnostics?: () => MomentLibrarySyncDiagnostics })
    .__seenMomentLibraryDiagnostics = getMomentLibrarySyncDiagnostics;
}
