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
  fetchManifest(): Promise<MomentLibraryManifest>;
  /** Atomic pack download preferred for V1 formal versions. */
  fetchPack(manifest: MomentLibraryManifest): Promise<MomentLibraryPack>;
}

function trimSlash(url: string): string {
  return url.replace(/\/+$/, '');
}

async function fetchJson<T>(url: string): Promise<T> {
  const res = await fetch(url, { cache: 'no-cache' });
  if (!res.ok) {
    throw new Error(`Moment library fetch failed ${res.status} for ${url}`);
  }
  return (await res.json()) as T;
}

export class HttpMomentLibraryHost implements MomentLibraryHost {
  readonly region: DataRegion;
  private baseUrl: string;

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
  private packs: Map<number, MomentLibraryPack>;

  constructor(region: DataRegion, packs: MomentLibraryPack[]) {
    this.region = region;
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

export function createHostForRegion(region: DataRegion): MomentLibraryHost | null {
  const globalBase = import.meta.env.VITE_MOMENT_LIBRARY_GLOBAL_BASE as string | undefined;
  const cnBase = import.meta.env.VITE_MOMENT_LIBRARY_CN_BASE as string | undefined;

  if (region === 'GLOBAL') {
    if (!globalBase) return null;
    return new HttpMomentLibraryHost('GLOBAL', globalBase);
  }

  // CN must use domestic base — never fall back to Firebase/GLOBAL URL.
  if (!cnBase) return null;
  if (/firebase|googleapis\.com|firebasestorage/i.test(cnBase)) {
    console.error(
      '[MomentLibrary] CN host looks like Firebase/GCS — refusing (Founder rule).',
    );
    return null;
  }
  return new HttpMomentLibraryHost('CN', cnBase);
}
