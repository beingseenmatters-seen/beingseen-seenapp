/**
 * Region-specific Moment Library hosts.
 *
 * GLOBAL: Firebase Storage / GCS + CDN (via VITE_MOMENT_LIBRARY_GLOBAL_BASE).
 * CN: domestic object storage + CDN (via VITE_MOMENT_LIBRARY_CN_BASE).
 * Firebase must never be used as the CN production host.
 */

import type { DataRegion, MomentLibraryManifest, MomentLibraryPack } from '../../types/momentLibrary';

export interface MomentLibraryHost {
  readonly region: DataRegion;
  readonly baseUrl: string;
  fetchManifest(): Promise<MomentLibraryManifest>;
  /** Atomic pack download preferred for V1 formal versions. */
  fetchPack(manifest: MomentLibraryManifest): Promise<MomentLibraryPack>;
}

export interface ResolvedLibraryHost {
  host: MomentLibraryHost | null;
  remoteBase: string | null;
  /** Null when a host was created. */
  failReason: string | null;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

export class MomentLibraryHttpError extends Error {
  status: number;
  contentType: string | null;
  url: string;

  constructor(url: string, status: number, contentType: string | null) {
    super(`Moment library fetch failed ${status} for ${url}`);
    this.name = 'MomentLibraryHttpError';
    this.url = url;
    this.status = status;
    this.contentType = contentType;
  }
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-cache' });
  const contentType = res.headers.get('content-type');
  if (!res.ok) {
    throw new MomentLibraryHttpError(url, res.status, contentType);
  }
  return (await res.json()) as T;
}

export class HttpMomentLibraryHost implements MomentLibraryHost {
  readonly region: DataRegion;
  readonly baseUrl: string;

  constructor(region: DataRegion, baseUrl: string) {
    this.region = region;
    this.baseUrl = trimSlash(baseUrl);
  }

  async fetchManifest(): Promise<MomentLibraryManifest> {
    return fetchJson<MomentLibraryManifest>(`${this.baseUrl}/manifest.json`);
  }

  async fetchPack(manifest: MomentLibraryManifest): Promise<MomentLibraryPack> {
    if (manifest.packPath) {
      const path = manifest.packPath.replace(/^\//, '');
      return fetchJson<MomentLibraryPack>(`${this.baseUrl}/${path}`);
    }
    // Assemble from immutable moment files (still validated atomically after fetch).
    const moments = [];
    for (const entry of manifest.moments) {
      const path = entry.path.replace(/^\//, '');
      moments.push(await fetchJson(`${this.baseUrl}/${path}`));
    }
    return {
      schemaVersion: manifest.schemaVersion,
      libraryVersion: manifest.libraryVersion,
      region: manifest.region,
      signalCatalogVersion: manifest.signalCatalogVersion,
      publishedAt: manifest.publishedAt,
      minAppCapability: manifest.minAppCapability,
      moments: moments as MomentLibraryPack['moments'],
      momentIndex: manifest.moments,
      packHash: manifest.packHash ?? '',
      ab: manifest.ab ?? null,
    };
  }
}

/** In-memory host for tests / local fixtures. */
export class MemoryMomentLibraryHost implements MomentLibraryHost {
  readonly region: DataRegion;
  readonly baseUrl: string;
  private packs: Map<number, MomentLibraryPack>;

  constructor(region: DataRegion, packs: MomentLibraryPack[], baseUrl = 'memory://library') {
    this.region = region;
    this.baseUrl = baseUrl;
    this.packs = new Map(packs.map((p) => [p.libraryVersion, p]));
  }

  async fetchManifest(): Promise<MomentLibraryManifest> {
    const latest = [...this.packs.values()].sort(
      (a, b) => b.libraryVersion - a.libraryVersion,
    )[0];
    if (!latest) throw new Error('No packs in MemoryMomentLibraryHost');
    return {
      schemaVersion: latest.schemaVersion,
      libraryVersion: latest.libraryVersion,
      region: latest.region,
      signalCatalogVersion: latest.signalCatalogVersion,
      publishedAt: latest.publishedAt,
      minAppCapability: latest.minAppCapability,
      moments: latest.momentIndex,
      packPath: `library.v${latest.libraryVersion}.pack.json`,
      packHash: latest.packHash,
      ab: latest.ab ?? null,
    };
  }

  async fetchPack(manifest: MomentLibraryManifest): Promise<MomentLibraryPack> {
    const pack = this.packs.get(manifest.libraryVersion);
    if (!pack) {
      throw new Error(`Pack libraryVersion ${manifest.libraryVersion} not found`);
    }
    return pack;
  }
}

/** Normalize Vite env bases (empty / the literal "undefined" count as unset). */
function readEnvBase(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed || trimmed === 'undefined') return null;
  return trimmed;
}

/**
 * Resolve host for a region. Never falls CN → GLOBAL (Founder rule).
 * Callers must surface failReason — do not silently treat as seed-only.
 */
export function resolveLibraryHost(region: DataRegion): ResolvedLibraryHost {
  const globalBase = readEnvBase(import.meta.env.VITE_MOMENT_LIBRARY_GLOBAL_BASE);
  const cnBase = readEnvBase(import.meta.env.VITE_MOMENT_LIBRARY_CN_BASE);

  if (region === 'GLOBAL') {
    if (!globalBase) {
      return {
        host: null,
        remoteBase: null,
        failReason: 'global_host_unconfigured',
      };
    }
    const base = trimSlash(globalBase);
    return {
      host: new HttpMomentLibraryHost('GLOBAL', base),
      remoteBase: base,
      failReason: null,
    };
  }

  if (!cnBase) {
    return {
      host: null,
      remoteBase: null,
      // Stable diagnostic code for acceptance (signed-out zh suggestion, no CN CDN).
      failReason: 'cn_host_unconfigured',
    };
  }
  if (/firebase|googleapis\.com|firebasestorage/i.test(cnBase)) {
    return {
      host: null,
      remoteBase: cnBase,
      failReason: 'cn_host_firebase_refused',
    };
  }
  const base = trimSlash(cnBase);
  return {
    host: new HttpMomentLibraryHost('CN', base),
    remoteBase: base,
    failReason: null,
  };
}

export function createHostForRegion(region: DataRegion): MomentLibraryHost | null {
  return resolveLibraryHost(region).host;
}
