import { describe, expect, it } from 'vitest';
import { createHostForRegion, resolveLibraryHost } from './libraryHosts';

describe('resolveLibraryHost / createHostForRegion', () => {
  it('refuses Firebase-looking CN production host with explicit failReason', () => {
    const prevCn = import.meta.env.VITE_MOMENT_LIBRARY_CN_BASE;
    const prevGlobal = import.meta.env.VITE_MOMENT_LIBRARY_GLOBAL_BASE;
    import.meta.env.VITE_MOMENT_LIBRARY_CN_BASE =
      'https://firebasestorage.googleapis.com/v0/b/fake/o';
    import.meta.env.VITE_MOMENT_LIBRARY_GLOBAL_BASE = 'https://cdn.example.com/global';

    const resolved = resolveLibraryHost('CN');
    expect(resolved.host).toBeNull();
    expect(resolved.failReason).toBe('cn_host_firebase_refused');
    expect(createHostForRegion('CN')).toBeNull();

    import.meta.env.VITE_MOMENT_LIBRARY_CN_BASE = prevCn;
    import.meta.env.VITE_MOMENT_LIBRARY_GLOBAL_BASE = prevGlobal;
  });

  it('reports CN_BASE unset as first failing step (native zh path)', () => {
    const prevCn = import.meta.env.VITE_MOMENT_LIBRARY_CN_BASE;
    const prevGlobal = import.meta.env.VITE_MOMENT_LIBRARY_GLOBAL_BASE;
    import.meta.env.VITE_MOMENT_LIBRARY_CN_BASE = '';
    import.meta.env.VITE_MOMENT_LIBRARY_GLOBAL_BASE =
      'https://cdn.jsdelivr.net/gh/beingseenmatters-seen/beingseen-seenapp@cdn/moment-library/global';

    const resolved = resolveLibraryHost('CN');
    expect(resolved.host).toBeNull();
    expect(resolved.failReason).toBe('cn_host_unconfigured');
    // GLOBAL still works — CN must never silently fall back to GLOBAL.
    expect(createHostForRegion('GLOBAL')?.region).toBe('GLOBAL');

    import.meta.env.VITE_MOMENT_LIBRARY_CN_BASE = prevCn;
    import.meta.env.VITE_MOMENT_LIBRARY_GLOBAL_BASE = prevGlobal;
  });

  it('creates GLOBAL host when base is set', () => {
    const prev = import.meta.env.VITE_MOMENT_LIBRARY_GLOBAL_BASE;
    import.meta.env.VITE_MOMENT_LIBRARY_GLOBAL_BASE = 'https://cdn.example.com/global';
    const host = createHostForRegion('GLOBAL');
    expect(host?.region).toBe('GLOBAL');
    expect(host?.baseUrl).toBe('https://cdn.example.com/global');
    import.meta.env.VITE_MOMENT_LIBRARY_GLOBAL_BASE = prev;
  });
});
