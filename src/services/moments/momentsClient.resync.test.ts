import { beforeEach, describe, expect, it, vi } from 'vitest';

const syncRemote = vi.fn(async () => ({ promoted: true, reason: 'ok' }));
const ensureReady = vi.fn(async () => undefined);

vi.mock('./libraryClient', () => {
  class MomentLibraryClient {
    constructor(
      _store: unknown,
      public getRegion: () => string,
    ) {}
    ensureReady = ensureReady;
    syncRemote = syncRemote;
    getActiveMoments = () => [];
    getProvenance = () => ({
      libraryVersion: 1,
      schemaVersion: 1,
      signalCatalogVersion: 1,
      region: 'GLOBAL' as const,
      packHash: '',
    });
  }
  return { MomentLibraryClient };
});

vi.mock('../firebase', () => ({
  auth: { currentUser: null },
}));

describe('momentsClient auth-region resync', () => {
  beforeEach(() => {
    syncRemote.mockClear();
    ensureReady.mockClear();
    vi.resetModules();
    vi.stubGlobal('navigator', { language: 'zh-CN' });
  });

  it('re-syncs when signed-out zh (CN) becomes signed-in GLOBAL', async () => {
    const mod = await import('./momentsClient');
    // Allow initial bootstrap sync (CN → no-op at host layer in real app).
    await Promise.resolve();
    syncRemote.mockClear();
    ensureReady.mockClear();

    mod.setMomentLibraryAccountRegion(null, true);

    await vi.waitFor(() => {
      expect(ensureReady).toHaveBeenCalled();
      expect(syncRemote).toHaveBeenCalled();
    });
  });

  it('does not re-sync when region and sign-in state are unchanged', async () => {
    const mod = await import('./momentsClient');
    await Promise.resolve();
    mod.setMomentLibraryAccountRegion(null, true);
    await vi.waitFor(() => expect(syncRemote).toHaveBeenCalled());
    syncRemote.mockClear();
    ensureReady.mockClear();

    mod.setMomentLibraryAccountRegion(null, true);
    await Promise.resolve();
    await Promise.resolve();

    expect(syncRemote).not.toHaveBeenCalled();
  });
});
