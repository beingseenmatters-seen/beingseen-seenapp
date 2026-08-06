import { readFileSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { validateLibraryPack, activeMomentsFromPack } from '../src/services/moments/libraryValidation';
import type { MomentLibraryPack } from '../src/types/momentLibrary';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const pack = JSON.parse(
  readFileSync(join(root, 'moment-library/v2/global/library.v2.pack.json'), 'utf8'),
) as MomentLibraryPack;
const seed = JSON.parse(
  readFileSync(join(root, 'src/data/moments/seed/momentLibrary.v1.pack.json'), 'utf8'),
) as MomentLibraryPack;

const result = await validateLibraryPack(pack);
if (!result.ok) {
  console.error('VALIDATION FAILED', result.errors);
  process.exit(1);
}
const active = activeMomentsFromPack(result.pack);
console.log(
  JSON.stringify(
    {
      ok: true,
      libraryVersion: pack.libraryVersion,
      activeCount: active.length,
      fri002: active.some((m) => m.id === 'FRI-002'),
      par001: active.some((m) => m.id === 'PAR-001'),
      seedLibraryVersion: seed.libraryVersion,
      seedCount: seed.moments.length,
      seedUntouched:
        seed.libraryVersion === 1 &&
        seed.moments.length === 21 &&
        !seed.moments.some((m) => m.id === 'FRI-002' || m.id === 'PAR-001'),
      packHash: pack.packHash,
    },
    null,
    2,
  ),
);
