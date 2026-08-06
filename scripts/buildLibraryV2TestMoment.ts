/**
 * P4 — build a local (non-production) library v2 pack that adds TEST-PLAT-001.
 * Does not publish to CDN. For Founder acceptance / sync tests only.
 *
 *   npx vite-node scripts/buildLibraryV2TestMoment.ts
 */

import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { SIGNAL_INDEX } from '../src/data/moments/signals';
import type { MomentDefinition } from '../src/types/moments';
import type { MomentLibraryPack } from '../src/types/momentLibrary';
import { buildIndexEntry } from '../src/services/moments/libraryValidation';
import { hashLibraryPackBody } from '../src/services/moments/libraryHash';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');

async function main() {
  const v1 = JSON.parse(
    readFileSync(join(root, 'src/data/moments/seed/momentLibrary.v1.pack.json'), 'utf8'),
  ) as MomentLibraryPack;

  const signalId = Object.keys(SIGNAL_INDEX)[0]!;
  const newMoment: MomentDefinition = {
    id: 'TEST-PLAT-001',
    version: 1,
    status: 'active',
    interactionType: 'single_choice',
    title: { zh: '平台测试瞬间', en: 'Platform test moment' },
    scenario: {
      zh: '这是一个仅用于 Moment Platform 验收的测试瞬间。',
      en: 'A test moment used only for Moment Platform acceptance.',
    },
    options: [
      {
        id: 'A',
        text: { zh: '选项 A', en: 'Option A' },
        signals: [{ signal: signalId, delta: 1, confidence: 'medium' }],
      },
      {
        id: 'B',
        text: { zh: '选项 B', en: 'Option B' },
        signals: [],
      },
    ],
  };

  const moments = [...v1.moments, newMoment];
  const momentIndex = [];
  for (const m of moments) momentIndex.push(await buildIndexEntry(m));

  const partial = {
    schemaVersion: v1.schemaVersion,
    libraryVersion: 2,
    region: 'GLOBAL' as const,
    signalCatalogVersion: v1.signalCatalogVersion,
    publishedAt: '2026-08-06T12:00:00.000Z',
    minAppCapability: v1.minAppCapability,
    moments,
    momentIndex,
    ab: null,
    meta: v1.meta,
  };
  const pack: MomentLibraryPack = {
    ...partial,
    packHash: await hashLibraryPackBody(partial),
  };

  const outRoot = join(root, 'moment-library/fixtures/test-v2/global');
  mkdirSync(join(outRoot, 'moments'), { recursive: true });
  writeFileSync(join(outRoot, 'library.v2.pack.json'), `${JSON.stringify(pack, null, 2)}\n`);
  writeFileSync(
    join(outRoot, 'manifest.json'),
    `${JSON.stringify(
      {
        schemaVersion: pack.schemaVersion,
        libraryVersion: pack.libraryVersion,
        region: pack.region,
        signalCatalogVersion: pack.signalCatalogVersion,
        publishedAt: pack.publishedAt,
        minAppCapability: pack.minAppCapability,
        moments: pack.momentIndex,
        packPath: 'library.v2.pack.json',
        packHash: pack.packHash,
        ab: null,
      },
      null,
      2,
    )}\n`,
  );
  for (const m of pack.moments) {
    const entry = pack.momentIndex.find((e) => e.id === m.id && e.version === m.version)!;
    writeFileSync(join(outRoot, entry.path), `${JSON.stringify(m, null, 2)}\n`);
  }

  console.log(`Built local library v2 with TEST-PLAT-001 → ${outRoot}`);
  console.log('NOT published to production.');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
