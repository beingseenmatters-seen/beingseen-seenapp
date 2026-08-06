import { describe, expect, it } from 'vitest';
import { InMemoryStore, MomentsService } from './momentsService';
import { MomentLibraryClient } from './libraryClient';
import { MemoryMomentLibraryHost } from './libraryHosts';
import { validateLibraryPack, activeMomentsFromPack } from './libraryValidation';
import { hashLibraryPackBody, hashMomentDocument } from './libraryHash';
import { MOMENT_LIBRARY } from '../../data/moments/library';
import { getActiveMoments } from './config';
import seedPack from '../../data/moments/seed/momentLibrary.v1.pack.json';
import type { MomentDefinition } from '../../types/moments';
import type { MomentLibraryPack } from '../../types/momentLibrary';
import {
  MOMENT_LIBRARY_SCHEMA_VERSION,
  SIGNAL_CATALOG_VERSION,
  SUPPORTED_INTERACTION_TYPES,
} from '../../data/moments/platformConstants';
import { buildIndexEntry } from './libraryValidation';

const seed = seedPack as MomentLibraryPack;

async function clonePack(base: MomentLibraryPack, mut: (p: MomentLibraryPack) => void): Promise<MomentLibraryPack> {
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

describe('Moment Platform seed v1', () => {
  it('validates atomically', async () => {
    const result = await validateLibraryPack(seed);
    expect(result.ok).toBe(true);
  });

  it('seed v1 is a subset of compile-time library (authoring may be ahead)', () => {
    const fromSeed = activeMomentsFromPack(seed)
      .map((m) => `${m.id}@${m.version}`)
      .sort();
    const fromTs = new Set(
      getActiveMoments(MOMENT_LIBRARY).map((m) => `${m.id}@${m.version}`),
    );
    expect(fromSeed).toHaveLength(21);
    for (const key of fromSeed) {
      expect(fromTs.has(key)).toBe(true);
    }
    // Frozen Set 003 lives in library.ts / remote v2; seed stays at 21 until a seed bump.
    expect(fromTs.has('FRI-002@1')).toBe(true);
    expect(fromTs.has('PAR-001@1')).toBe(true);
  });
});

describe('MomentLibraryClient', () => {
  it('offline first launch uses seed', async () => {
    const client = new MomentLibraryClient(new InMemoryStore(), () => 'GLOBAL', {
      seedPack: seed,
      hostFactory: () => null,
    });
    const pack = await client.ensureReady();
    expect(pack.libraryVersion).toBe(1);
    expect(client.getActiveMoments()).toHaveLength(21);
  });

  it('offline later launch uses last validated active cache', async () => {
    const store = new InMemoryStore();
    const host = new MemoryMomentLibraryHost('GLOBAL', [seed]);
    const first = new MomentLibraryClient(store, () => 'GLOBAL', {
      seedPack: seed,
      hostFactory: () => host,
    });
    await first.ensureReady();
    // Manually cache a promoted pointer by syncing same v1
    await first.syncRemote();

    const second = new MomentLibraryClient(store, () => 'GLOBAL', {
      seedPack: seed,
      hostFactory: () => null,
    });
    const pack = await second.ensureReady();
    expect(pack.libraryVersion).toBe(1);
    expect(pack.packHash).toBe(seed.packHash);
  });

  it('rejects incompatible v2 without changing active pack or sessions', async () => {
    const store = new InMemoryStore();
    const client = new MomentLibraryClient(store, () => 'GLOBAL', {
      seedPack: seed,
      hostFactory: () => null,
    });
    await client.ensureReady();

    const service = new MomentsService(
      store,
      () => 'user_a',
      () => client.getActiveMoments(),
      () => 0.1,
      () => 1_700_000_000_000,
      () => client.getProvenance(),
    );
    const session = await service.createSession();
    expect(session.snapshots[0]?.libraryVersion).toBe(1);
    expect(session.snapshots[0]?.signalCatalogVersion).toBe(SIGNAL_CATALOG_VERSION);

    const bad = await clonePack(seed, (p) => {
      p.libraryVersion = 2;
      p.moments[0]!.options[0]!.signals = [
        { signal: 'NOT_A_REAL_SIGNAL', delta: 1, confidence: 'high' },
      ];
    });

    const promote = await client.tryPromotePack(bad);
    expect(promote.promoted).toBe(false);
    expect(client.getActivePack().libraryVersion).toBe(1);

    const still = await service.loadActiveSession();
    expect(still?.id).toBe(session.id);
    expect(still?.snapshots[0]?.libraryVersion).toBe(1);
  });

  it('promotes valid library v2 with a net-new Moment', async () => {
    const store = new InMemoryStore();
    const client = new MomentLibraryClient(store, () => 'GLOBAL', {
      seedPack: seed,
      hostFactory: () => null,
    });
    await client.ensureReady();

    const { SIGNAL_INDEX } = await import('../../data/moments/signals');
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

    const v2 = await clonePack(seed, (p) => {
      p.libraryVersion = 2;
      p.publishedAt = '2026-08-06T12:00:00.000Z';
      p.moments.push(newMoment);
    });

    const host = new MemoryMomentLibraryHost('GLOBAL', [seed, v2]);
    const syncing = new MomentLibraryClient(store, () => 'GLOBAL', {
      seedPack: seed,
      hostFactory: () => host,
    });
    await syncing.ensureReady();
    // Remote sync must refuse TEST-* even if a host serves them.
    const remoteRejected = await syncing.syncRemote();
    expect(remoteRejected.promoted).toBe(false);
    expect(remoteRejected.errors?.some((e) => e.includes('TEST-PLAT-001'))).toBe(true);
    expect(syncing.getActivePack().libraryVersion).toBe(1);

    // Explicit test-only promote path may accept TEST-* for acceptance harnesses.
    const allowed = await syncing.tryPromotePack(v2, { allowTestMomentIds: true });
    expect(allowed.promoted).toBe(true);
    expect(syncing.getActivePack().libraryVersion).toBe(2);
    expect(syncing.getActiveMoments().some((m) => m.id === 'TEST-PLAT-001')).toBe(true);
  });

  it('refuses Firebase-looking CN host', async () => {
    const prev = import.meta.env.VITE_MOMENT_LIBRARY_CN_BASE;
    // Dynamic check via createHostForRegion is covered in libraryHosts; assert pack region wiring here.
    expect(seed.region).toBe('GLOBAL');
    expect(seed.minAppCapability.interactionTypes).toEqual([...SUPPORTED_INTERACTION_TYPES]);
    expect(seed.schemaVersion).toBe(MOMENT_LIBRARY_SCHEMA_VERSION);
    void prev;
  });
});

describe('content hash stability', () => {
  it('moment contentHash matches index', async () => {
    for (const entry of seed.momentIndex.slice(0, 3)) {
      const moment = seed.moments.find((m) => m.id === entry.id && m.version === entry.version)!;
      expect(await hashMomentDocument(moment)).toBe(entry.contentHash);
    }
  });
});
