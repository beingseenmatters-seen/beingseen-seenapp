/**
 * Export the compile-time MOMENT_LIBRARY as immutable seed + GLOBAL remote v1 fixtures.
 *
 * Usage (from repo root):
 *   npx vite-node scripts/exportMomentLibrary.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOMENT_LIBRARY, MOMENTS_META } from '../src/data/moments/library';
import {
  getMomentRegistryEntry,
  isShipableRegistryId,
} from '../src/data/moments/momentRegistry';
import {
  MOMENT_LIBRARY_SCHEMA_VERSION,
  SEED_LIBRARY_VERSION,
  SIGNAL_CATALOG_VERSION,
  SUPPORTED_INTERACTION_TYPES,
} from '../src/data/moments/platformConstants';
import { buildIndexEntry } from '../src/services/moments/libraryValidation';
import { hashLibraryPackBody } from '../src/services/moments/libraryHash';
import type { MomentLibraryPack } from '../src/types/momentLibrary';

function assertLibraryMatchesRegistry() {
  const problems: string[] = [];
  for (const m of MOMENT_LIBRARY) {
    const entry = getMomentRegistryEntry(m.id);
    if (!entry) {
      problems.push(`${m.id}: missing from Moment Registry (SSOT)`);
    } else if (!isShipableRegistryId(m.id)) {
      problems.push(`${m.id}: registry status "${entry.status}" is not shipable`);
    }
  }
  if (problems.length) {
    throw new Error(
      `Moment Registry check failed:\n${problems.map((p) => `  - ${p}`).join('\n')}`,
    );
  }
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

async function buildPack(region: 'GLOBAL' | 'CN'): Promise<MomentLibraryPack> {
  const moments = MOMENT_LIBRARY.map((m) => structuredClone(m));
  const momentIndex = [];
  for (const m of moments) {
    momentIndex.push(await buildIndexEntry(m));
  }

  const partial = {
    schemaVersion: MOMENT_LIBRARY_SCHEMA_VERSION,
    libraryVersion: SEED_LIBRARY_VERSION,
    region,
    signalCatalogVersion: SIGNAL_CATALOG_VERSION,
    publishedAt: '2026-08-06T00:00:00.000Z',
    minAppCapability: {
      interactionTypes: [...SUPPORTED_INTERACTION_TYPES],
      signalCatalogVersion: SIGNAL_CATALOG_VERSION,
    },
    moments,
    momentIndex,
    ab: null,
    meta: MOMENTS_META,
  };

  const packHash = await hashLibraryPackBody(partial);
  return { ...partial, packHash };
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  console.log('wrote', path);
}

async function main() {
  assertLibraryMatchesRegistry();
  const globalPack = await buildPack('GLOBAL');
  const cnPack = await buildPack('CN');

  // Immutable seed (bundled). GLOBAL seed is the default offline bootstrap.
  const seedPath = join(root, 'src/data/moments/seed/momentLibrary.v1.pack.json');
  writeJson(seedPath, globalPack);

  // Remote fixture tree (not production publish) — content-equivalent to seed.
  const globalRoot = join(root, 'moment-library/v1/global');
  writeJson(join(globalRoot, 'library.v1.pack.json'), globalPack);
  writeJson(join(globalRoot, 'manifest.json'), {
    schemaVersion: globalPack.schemaVersion,
    libraryVersion: globalPack.libraryVersion,
    region: 'GLOBAL',
    signalCatalogVersion: globalPack.signalCatalogVersion,
    publishedAt: globalPack.publishedAt,
    minAppCapability: globalPack.minAppCapability,
    moments: globalPack.momentIndex,
    packPath: 'library.v1.pack.json',
    packHash: globalPack.packHash,
    ab: null,
  });
  for (const m of globalPack.moments) {
    const entry = globalPack.momentIndex.find(
      (e) => e.id === m.id && e.version === m.version,
    )!;
    writeJson(join(globalRoot, entry.path), m);
  }

  // CN mirror (same Moment documents; domestic host later). Never Firebase.
  const cnRoot = join(root, 'moment-library/v1/cn');
  writeJson(join(cnRoot, 'library.v1.pack.json'), cnPack);
  writeJson(join(cnRoot, 'manifest.json'), {
    schemaVersion: cnPack.schemaVersion,
    libraryVersion: cnPack.libraryVersion,
    region: 'CN',
    signalCatalogVersion: cnPack.signalCatalogVersion,
    publishedAt: cnPack.publishedAt,
    minAppCapability: cnPack.minAppCapability,
    moments: cnPack.momentIndex,
    packPath: 'library.v1.pack.json',
    packHash: cnPack.packHash,
    ab: null,
  });
  for (const m of cnPack.moments) {
    const entry = cnPack.momentIndex.find(
      (e) => e.id === m.id && e.version === m.version,
    )!;
    writeJson(join(cnRoot, entry.path), m);
  }

  console.log(
    `Exported library v${SEED_LIBRARY_VERSION}: ${globalPack.moments.length} Moments, packHash=${globalPack.packHash.slice(0, 12)}…`,
  );
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
