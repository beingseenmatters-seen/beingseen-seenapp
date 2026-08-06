import { describe, expect, it, vi } from 'vitest';
import { createHostForRegion } from './libraryHosts';

describe('createHostForRegion', () => {
  it('refuses Firebase-looking CN production host', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});
    const prevCn = import.meta.env.VITE_MOMENT_LIBRARY_CN_BASE;
    const prevGlobal = import.meta.env.VITE_MOMENT_LIBRARY_GLOBAL_BASE;
    import.meta.env.VITE_MOMENT_LIBRARY_CN_BASE =
      'https://firebasestorage.googleapis.com/v0/b/fake/o';
    import.meta.env.VITE_MOMENT_LIBRARY_GLOBAL_BASE = 'https://cdn.example.com/global';

    expect(createHostForRegion('CN')).toBeNull();
    expect(spy).toHaveBeenCalled();

    import.meta.env.VITE_MOMENT_LIBRARY_CN_BASE = prevCn;
    import.meta.env.VITE_MOMENT_LIBRARY_GLOBAL_BASE = prevGlobal;
    spy.mockRestore();
  });

  it('creates GLOBAL host when base is set', () => {
    const prev = import.meta.env.VITE_MOMENT_LIBRARY_GLOBAL_BASE;
    import.meta.env.VITE_MOMENT_LIBRARY_GLOBAL_BASE = 'https://cdn.example.com/global';
    const host = createHostForRegion('GLOBAL');
    expect(host?.region).toBe('GLOBAL');
    import.meta.env.VITE_MOMENT_LIBRARY_GLOBAL_BASE = prev;
  });
});
