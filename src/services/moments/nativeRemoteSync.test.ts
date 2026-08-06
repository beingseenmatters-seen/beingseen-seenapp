import { describe, expect, it } from 'vitest';
import { InMemoryStore, MomentsService } from './momentsService';
import { MomentLibraryClient } from './libraryClient';
import { MemoryMomentLibraryHost } from './libraryHosts';
import { getMomentLibrarySyncDiagnostics, resetMomentLibrarySyncDiagnostics } from './librarySyncDiagnostics';
import { validateLibraryPack } from './libraryValidation';
import { hashLibraryPackBody } from './libraryHash';
import { buildIndexEntry } from './libraryValidation';
import seedPack from '../../data/moments/seed/momentLibrary.v1.pack.json';
import type { MomentLibraryPack } from '../../types/momentLibrary';
import v2PackJson from '../../../moment-library/v2/global/library.v2.pack.json';

const seedV1 = seedPack as MomentLibraryPack;
const remoteV2 = v2PackJson as MomentLibraryPack;

async function clonePack(
  base: MomentLibraryPack,
  mut: (p: MomentLibraryPack) => void,
): Promise<MomentLibraryPack> {
  const pack = structuredClone(base);
  mut(pack);
  pack.momentIndex = [];
  for (const m of pack.moments) {
    pack.momentIndex.push(await buildIndexEntry(m));
  }
  const { packHash: _drop, ...rest } = pack;
  pack.packHash = await hashLibraryPackBody(rest);
  return pack;
}

describe('Native remote Library sync (acceptance)', () => {
  it('1–4: installed v1 seed/cache promotes remote v2 without rebuild; new session can include FRI-002/PAR-001', async () => {
    resetMomentLibrarySyncDiagnostics();
    const store = new InMemoryStore();
    const host = new MemoryMomentLibraryHost('GLOBAL', [seedV1, remoteV2]);
    const client = new MomentLibraryClient(store, () => 'GLOBAL', {
      seedPack: seedV1,
      hostFactory: () => host,
    });

    const ready = await client.ensureReady();
    expect(ready.libraryVersion).toBe(1);

    const sync = await client.syncRemote();
    expect(sync.promoted).toBe(true);
    expect(client.getActivePack().libraryVersion).toBe(2);
    expect(client.getActiveMoments().some((m) => m.id === 'FRI-002')).toBe(true);
    expect(client.getActiveMoments().some((m) => m.id === 'PAR-001')).toBe(true);

    const diag = getMomentLibrarySyncDiagnostics();
    expect(diag.fetchedManifestLibraryVersion).toBe(2);
    expect(diag.activeLibraryVersion).toBe(2);
    expect(diag.promoted).toBe(true);
    expect(diag.fallbackReason).toBeNull();

    const service = new MomentsService(
      store,
      () => 'uid_native',
      () => client.getActiveMoments(),
      () => 0.1,
      () => Date.now(),
      () => client.getProvenance(),
    );
    const session = await service.createSession();
    expect(session.snapshots[0]?.libraryVersion).toBe(2);
    // Pool has 23; session takes 10 — ids come from v2 pool.
    expect(session.momentIds.every((id) => client.getActiveMoments().some((m) => m.id === id))).toBe(
      true,
    );
  });

  it('5: existing session remains snapshot-stable across promote', async () => {
    const store = new InMemoryStore();
    const host = new MemoryMomentLibraryHost('GLOBAL', [seedV1, remoteV2]);
    const client = new MomentLibraryClient(store, () => 'GLOBAL', {
      seedPack: seedV1,
      hostFactory: () => host,
    });
    await client.ensureReady();
    const service = new MomentsService(
      store,
      () => 'uid_native',
      () => client.getActiveMoments(),
      () => 0.1,
      () => 1_700_000_000_000,
      () => client.getProvenance(),
    );
    const session = await service.createSession();
    expect(session.snapshots[0]?.libraryVersion).toBe(1);
    const idsBefore = [...session.momentIds];

    await client.syncRemote();
    expect(client.getActivePack().libraryVersion).toBe(2);

    const still = await service.loadActiveSession();
    expect(still?.id).toBe(session.id);
    expect(still?.momentIds).toEqual(idsBefore);
    expect(still?.snapshots[0]?.libraryVersion).toBe(1);
  });

  it('6: restart offline keeps cached v2 active', async () => {
    const store = new InMemoryStore();
    const host = new MemoryMomentLibraryHost('GLOBAL', [seedV1, remoteV2]);
    const first = new MomentLibraryClient(store, () => 'GLOBAL', {
      seedPack: seedV1,
      hostFactory: () => host,
    });
    await first.ensureReady();
    await first.syncRemote();
    expect(first.getActivePack().libraryVersion).toBe(2);

    const offline = new MomentLibraryClient(store, () => 'GLOBAL', {
      seedPack: seedV1,
      hostFactory: () => null,
    });
    const pack = await offline.ensureReady();
    expect(pack.libraryVersion).toBe(2);
    expect(pack.packHash).toBe(remoteV2.packHash);
  });

  it('7: corrupt remote v3 leaves v2 active', async () => {
    const store = new InMemoryStore();
    const hostV2 = new MemoryMomentLibraryHost('GLOBAL', [seedV1, remoteV2]);
    const client = new MomentLibraryClient(store, () => 'GLOBAL', {
      seedPack: seedV1,
      hostFactory: () => hostV2,
    });
    await client.ensureReady();
    await client.syncRemote();
    expect(client.getActivePack().libraryVersion).toBe(2);

    const badV3 = await clonePack(remoteV2, (p) => {
      p.libraryVersion = 3;
      p.moments[0]!.options[0]!.signals = [
        { signal: 'NOT_A_REAL_SIGNAL', delta: 1, confidence: 'high' },
      ];
    });
    // Ensure bad pack fails validation
    const badCheck = await validateLibraryPack(badV3, { verifyHashes: true });
    expect(badCheck.ok).toBe(false);

    const hostV3 = new MemoryMomentLibraryHost('GLOBAL', [remoteV2, badV3]);
    const client2 = new MomentLibraryClient(store, () => 'GLOBAL', {
      seedPack: seedV1,
      hostFactory: () => hostV3,
    });
    await client2.ensureReady();
    const sync = await client2.syncRemote();
    expect(sync.promoted).toBe(false);
    expect(client2.getActivePack().libraryVersion).toBe(2);
  });

  it('8: seed v1 never downgrades cached v2', async () => {
    const store = new InMemoryStore();
    await store.set('seen_moment_library_active_v1', JSON.stringify(remoteV2));
    const client = new MomentLibraryClient(store, () => 'GLOBAL', {
      seedPack: seedV1,
      hostFactory: () => null,
    });
    const pack = await client.ensureReady();
    expect(pack.libraryVersion).toBe(2);
    expect(seedV1.libraryVersion).toBe(1);
  });

  it('records explicit CN host-unset reason (does not silent-seed)', async () => {
    resetMomentLibrarySyncDiagnostics();
    const prevCn = import.meta.env.VITE_MOMENT_LIBRARY_CN_BASE;
    const prevGlobal = import.meta.env.VITE_MOMENT_LIBRARY_GLOBAL_BASE;
    import.meta.env.VITE_MOMENT_LIBRARY_CN_BASE = '';
    import.meta.env.VITE_MOMENT_LIBRARY_GLOBAL_BASE =
      'https://cdn.jsdelivr.net/gh/beingseenmatters-seen/beingseen-seenapp@cdn/moment-library/global';

    const client = new MomentLibraryClient(new InMemoryStore(), () => 'CN', {
      seedPack: seedV1,
      // Use real createHostForRegion path
    });
    await client.ensureReady();
    const sync = await client.syncRemote();
    expect(sync.promoted).toBe(false);
    expect(sync.reason).toBe('cn_host_unconfigured');
    const diag = getMomentLibrarySyncDiagnostics();
    expect(diag.resolvedRegion).toBe('CN');
    expect(diag.fallbackReason).toBe('cn_host_unconfigured');
    expect(diag.activeLibraryVersion).toBe(1);

    import.meta.env.VITE_MOMENT_LIBRARY_CN_BASE = prevCn;
    import.meta.env.VITE_MOMENT_LIBRARY_GLOBAL_BASE = prevGlobal;
  });
});
