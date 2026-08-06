/**
 * Moment Library client — seed → cache → validate → atomic promote → offline.
 *
 * Precedence (Founder):
 * 1) valid active cache (never downgraded by older seed)
 * 2) remote candidate when newer + valid
 * 3) bundled seed only when no valid active cache exists
 *
 * Does not modify Sketch / Reflect / Matching / Me. Sessions read active Moments
 * via getActiveMoments(); snapshots lock provenance at createSession time.
 */

import type { MomentDefinition } from '../../types/moments';
import type {
  DataRegion,
  MomentLibraryPack,
  MomentLibraryProvenance,
} from '../../types/momentLibrary';
import {
  LIBRARY_CACHE_ACTIVE_KEY,
  LIBRARY_CACHE_POINTER_KEY,
  LIBRARY_CACHE_STAGING_KEY,
  MOMENT_LIBRARY_SCHEMA_VERSION,
  SIGNAL_CATALOG_VERSION,
} from '../../data/moments/platformConstants';
import type { KeyValueStore } from './momentsService';
import {
  activeMomentsFromPack,
  validateLibraryPack,
} from './libraryValidation';
import type { MomentLibraryHost } from './libraryHosts';
import {
  MomentLibraryHttpError,
  createHostForRegion,
  resolveLibraryHost,
} from './libraryHosts';
import {
  recordMomentLibrarySyncDiagnostics,
} from './librarySyncDiagnostics';
import seedPackJson from '../../data/moments/seed/momentLibrary.v1.pack.json';

export interface LibraryPointer {
  region: DataRegion;
  libraryVersion: number;
  packHash: string;
  updatedAt: number;
}

export interface SyncRemoteResult {
  promoted: boolean;
  reason: string;
  errors?: string[];
}

export class MomentLibraryClient {
  private store: KeyValueStore;
  private getRegion: () => DataRegion;
  private hostFactory: (region: DataRegion) => MomentLibraryHost | null;
  private seedPack: MomentLibraryPack;
  private activePack: MomentLibraryPack | null = null;
  private ready = false;

  constructor(
    store: KeyValueStore,
    getRegion: () => DataRegion,
    options?: {
      seedPack?: MomentLibraryPack;
      hostFactory?: (region: DataRegion) => MomentLibraryHost | null;
    },
  ) {
    this.store = store;
    this.getRegion = getRegion;
    this.hostFactory = options?.hostFactory ?? createHostForRegion;
    this.seedPack = (options?.seedPack ?? seedPackJson) as MomentLibraryPack;
  }

  /**
   * Load active cache or fall back to immutable seed.
   * Seed must never replace a newer/equal validated active cache.
   */
  async ensureReady(): Promise<MomentLibraryPack> {
    if (this.ready && this.activePack) return this.activePack;

    const cached = await this.readJson<MomentLibraryPack>(LIBRARY_CACHE_ACTIVE_KEY);
    if (cached) {
      const result = await validateLibraryPack(cached, { verifyHashes: true });
      if (result.ok) {
        this.activePack = result.pack;
        this.ready = true;
        return result.pack;
      }
      console.warn(
        '[MomentLibrary] active cache failed validation; falling back to seed',
        result.errors,
      );
    }

    const seedResult = await validateLibraryPack(this.seedPack, { verifyHashes: true });
    if (!seedResult.ok) {
      throw new Error(
        `[MomentLibrary] seed invalid — cannot start: ${seedResult.errors.join('; ')}`,
      );
    }
    this.activePack = seedResult.pack;
    this.ready = true;
    return seedResult.pack;
  }

  getActivePack(): MomentLibraryPack {
    if (!this.activePack) {
      // Sync path for MomentsService before ensureReady completes: use seed.
      return this.seedPack;
    }
    return this.activePack;
  }

  getActiveMoments(): MomentDefinition[] {
    return activeMomentsFromPack(this.getActivePack());
  }

  getProvenance(): MomentLibraryProvenance {
    const pack = this.getActivePack();
    return {
      libraryVersion: pack.libraryVersion,
      schemaVersion: pack.schemaVersion,
      signalCatalogVersion: pack.signalCatalogVersion,
      region: pack.region,
      packHash: pack.packHash,
    };
  }

  /**
   * Fetch remote formal pack for the current region and atomically promote
   * if newer and fully valid. On any failure, keep previous active.
   */
  async syncRemote(): Promise<SyncRemoteResult> {
    await this.ensureReady();
    const region = this.getRegion();
    const activeVersion = this.getActivePack().libraryVersion;

    // Honor injected hostFactory (tests); resolveLibraryHost supplies fail reasons.
    const resolved = resolveLibraryHost(region);
    const host = this.hostFactory(region);

    const remoteBase =
      host && 'baseUrl' in host ? host.baseUrl : resolved.remoteBase;
    const manifestUrl = remoteBase ? `${remoteBase}/manifest.json` : null;

    if (!host) {
      const reason =
        resolved.failReason ??
        `no host configured for region ${region}`;
      recordMomentLibrarySyncDiagnostics({
        resolvedRegion: region,
        resolvedRemoteBase: resolved.remoteBase,
        manifestUrl: null,
        httpStatus: null,
        httpContentType: null,
        fetchedManifestLibraryVersion: null,
        activeLibraryVersion: activeVersion,
        promoted: false,
        fallbackReason: reason,
        lastError: null,
      });
      console.warn('[MomentLibrary] sync skipped:', reason);
      return { promoted: false, reason };
    }

    try {
      const manifest = await host.fetchManifest();
      recordMomentLibrarySyncDiagnostics({
        resolvedRegion: region,
        resolvedRemoteBase: remoteBase,
        manifestUrl,
        httpStatus: 200,
        httpContentType: 'application/json',
        fetchedManifestLibraryVersion: manifest.libraryVersion,
        activeLibraryVersion: activeVersion,
        promoted: null,
        fallbackReason: null,
        lastError: null,
      });

      if (manifest.region !== region) {
        const reason = `manifest region ${manifest.region} != account region ${region}`;
        recordMomentLibrarySyncDiagnostics({
          promoted: false,
          fallbackReason: reason,
          activeLibraryVersion: activeVersion,
        });
        console.warn('[MomentLibrary] sync aborted:', reason);
        return { promoted: false, reason };
      }
      if (manifest.libraryVersion <= activeVersion) {
        const reason = 'already at latest or newer local';
        recordMomentLibrarySyncDiagnostics({
          promoted: false,
          fallbackReason: reason,
          activeLibraryVersion: activeVersion,
          fetchedManifestLibraryVersion: manifest.libraryVersion,
        });
        return { promoted: false, reason };
      }

      const candidate = await host.fetchPack(manifest);
      await this.store.set(LIBRARY_CACHE_STAGING_KEY, JSON.stringify(candidate));

      const result = await validateLibraryPack(candidate, {
        verifyHashes: true,
        allowTestMomentIds: false,
      });
      if (!result.ok) {
        await this.store.remove(LIBRARY_CACHE_STAGING_KEY);
        const reason = 'candidate rejected (atomic validation)';
        recordMomentLibrarySyncDiagnostics({
          promoted: false,
          fallbackReason: reason,
          lastError: (result.errors ?? []).slice(0, 5).join('; '),
          activeLibraryVersion: activeVersion,
          fetchedManifestLibraryVersion: manifest.libraryVersion,
        });
        console.warn('[MomentLibrary] candidate rejected:', result.errors);
        return {
          promoted: false,
          reason,
          errors: result.errors,
        };
      }

      await this.store.set(LIBRARY_CACHE_ACTIVE_KEY, JSON.stringify(result.pack));
      const pointer: LibraryPointer = {
        region: result.pack.region,
        libraryVersion: result.pack.libraryVersion,
        packHash: result.pack.packHash,
        updatedAt: Date.now(),
      };
      await this.store.set(LIBRARY_CACHE_POINTER_KEY, JSON.stringify(pointer));
      await this.store.remove(LIBRARY_CACHE_STAGING_KEY);

      this.activePack = result.pack;
      const reason = `promoted libraryVersion ${result.pack.libraryVersion}`;
      recordMomentLibrarySyncDiagnostics({
        promoted: true,
        fallbackReason: null,
        activeLibraryVersion: result.pack.libraryVersion,
        fetchedManifestLibraryVersion: manifest.libraryVersion,
        lastError: null,
      });
      console.info('[MomentLibrary]', reason);
      return { promoted: true, reason };
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      const httpStatus = err instanceof MomentLibraryHttpError ? err.status : null;
      const httpContentType =
        err instanceof MomentLibraryHttpError ? err.contentType : null;
      const reason = `sync failed: ${message}`;
      recordMomentLibrarySyncDiagnostics({
        resolvedRegion: region,
        resolvedRemoteBase: remoteBase,
        manifestUrl,
        httpStatus,
        httpContentType,
        fetchedManifestLibraryVersion: null,
        activeLibraryVersion: activeVersion,
        promoted: false,
        fallbackReason: reason,
        lastError: message,
      });
      console.warn('[MomentLibrary]', reason);
      return { promoted: false, reason };
    }
  }

  /** Test/helper: attempt to promote an in-memory pack (still atomic). */
  async tryPromotePack(
    candidate: MomentLibraryPack,
    options?: { allowTestMomentIds?: boolean },
  ): Promise<SyncRemoteResult> {
    await this.ensureReady();
    await this.store.set(LIBRARY_CACHE_STAGING_KEY, JSON.stringify(candidate));
    const result = await validateLibraryPack(candidate, {
      verifyHashes: true,
      allowTestMomentIds: options?.allowTestMomentIds ?? false,
    });
    if (!result.ok) {
      await this.store.remove(LIBRARY_CACHE_STAGING_KEY);
      return {
        promoted: false,
        reason: 'candidate rejected (atomic validation)',
        errors: result.errors,
      };
    }
    await this.store.set(LIBRARY_CACHE_ACTIVE_KEY, JSON.stringify(result.pack));
    await this.store.set(
      LIBRARY_CACHE_POINTER_KEY,
      JSON.stringify({
        region: result.pack.region,
        libraryVersion: result.pack.libraryVersion,
        packHash: result.pack.packHash,
        updatedAt: Date.now(),
      } satisfies LibraryPointer),
    );
    await this.store.remove(LIBRARY_CACHE_STAGING_KEY);
    this.activePack = result.pack;
    return { promoted: true, reason: `promoted libraryVersion ${result.pack.libraryVersion}` };
  }

  private async readJson<T>(key: string): Promise<T | null> {
    try {
      const raw = await this.store.get(key);
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch {
      return null;
    }
  }
}

export { MOMENT_LIBRARY_SCHEMA_VERSION, SIGNAL_CATALOG_VERSION };
