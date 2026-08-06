/**
 * Build official Moment Library v2 for Founder Frozen Set 003.
 *
 * - Includes all Moments from MOMENT_LIBRARY (v1 set + FRI-002 + PAR-001)
 * - Writes remote trees under moment-library/v2/{global,cn}/
 * - Does NOT modify the immutable seed (library v1) — no app rebuild required
 * - Does NOT publish to production CDN (Founder review gate)
 *
 *   npx vite-node scripts/buildLibraryV2Frozen003.ts
 */

import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { MOMENT_LIBRARY, MOMENTS_META } from '../src/data/moments/library';
import {
  MOMENT_LIBRARY_SCHEMA_VERSION,
  SIGNAL_CATALOG_VERSION,
  SUPPORTED_INTERACTION_TYPES,
} from '../src/data/moments/platformConstants';
import { buildIndexEntry } from '../src/services/moments/libraryValidation';
import { hashLibraryPackBody } from '../src/services/moments/libraryHash';
import type { MomentLibraryPack } from '../src/types/momentLibrary';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const LIBRARY_VERSION = 2;

async function buildPack(region: 'GLOBAL' | 'CN'): Promise<MomentLibraryPack> {
  const moments = MOMENT_LIBRARY.map((m) => structuredClone(m));
  const momentIndex = [];
  for (const m of moments) {
    momentIndex.push(await buildIndexEntry(m));
  }

  const partial = {
    schemaVersion: MOMENT_LIBRARY_SCHEMA_VERSION,
    libraryVersion: LIBRARY_VERSION,
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
    meta: {
      ...MOMENTS_META,
      frozenSet: '003',
      note: 'Founder Frozen Set 003 — FRI-002 + PAR-001. Seed remains v1.',
    },
  };

  return { ...partial, packHash: await hashLibraryPackBody(partial) };
}

function writeJson(path: string, value: unknown) {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, `${JSON.stringify(value, null, 2)}\n`, 'utf8');
  console.log('wrote', path);
}

async function writeRegion(region: 'GLOBAL' | 'CN', pack: MomentLibraryPack) {
  const dir = join(root, 'moment-library/v2', region.toLowerCase());
  writeJson(join(dir, `library.v${LIBRARY_VERSION}.pack.json`), pack);
  writeJson(join(dir, 'manifest.json'), {
    schemaVersion: pack.schemaVersion,
    libraryVersion: pack.libraryVersion,
    region: pack.region,
    signalCatalogVersion: pack.signalCatalogVersion,
    publishedAt: pack.publishedAt,
    minAppCapability: pack.minAppCapability,
    moments: pack.momentIndex,
    packPath: `library.v${LIBRARY_VERSION}.pack.json`,
    packHash: pack.packHash,
    ab: null,
  });
  for (const m of pack.moments) {
    const entry = pack.momentIndex.find(
      (e) => e.id === m.id && e.version === m.version,
    )!;
    writeJson(join(dir, entry.path), m);
  }
}

async function main() {
  const ids = MOMENT_LIBRARY.map((m) => m.id);
  if (!ids.includes('FRI-002') || !ids.includes('PAR-001')) {
    throw new Error('FRI-002 and PAR-001 must exist in MOMENT_LIBRARY');
  }
  if (ids.includes('TEST-PLAT-001')) {
    throw new Error('Official v2 must not include TEST-* Moments');
  }

  const globalPack = await buildPack('GLOBAL');
  const cnPack = await buildPack('CN');
  await writeRegion('GLOBAL', globalPack);
  await writeRegion('CN', cnPack);

  console.log(
    `\nMoment Library v${LIBRARY_VERSION}: ${globalPack.moments.length} Moments`,
  );
  console.log(`New: FRI-002, PAR-001`);
  console.log(`packHash=${globalPack.packHash}`);
  console.log('Seed v1 untouched. NOT published to production CDN.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
