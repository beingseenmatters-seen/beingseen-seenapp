import { beforeEach, describe, expect, it, vi } from 'vitest';

const signOut = vi.fn().mockResolvedValue(undefined);

vi.mock('../platform', () => ({
  isNative: vi.fn(),
}));

vi.mock('@capacitor-firebase/authentication', () => ({
  FirebaseAuthentication: { signOut },
}));

import { isNative } from '../platform';
import { clearNativeAuthProviders } from './nativeAuthSession';

describe('clearNativeAuthProviders', () => {
  beforeEach(() => {
    signOut.mockClear();
    vi.mocked(isNative).mockReset();
  });

  it('no-ops on web so browser logout stays Firebase-JS only', async () => {
    vi.mocked(isNative).mockReturnValue(false);
    await clearNativeAuthProviders();
    expect(signOut).not.toHaveBeenCalled();
  });

  it('calls Capacitor FirebaseAuthentication.signOut on native', async () => {
    vi.mocked(isNative).mockReturnValue(true);
    await clearNativeAuthProviders();
    expect(signOut).toHaveBeenCalledTimes(1);
  });

  it('swallows native signOut failures so logout still completes', async () => {
    vi.mocked(isNative).mockReturnValue(true);
    signOut.mockRejectedValueOnce(new Error('native unavailable'));
    await expect(clearNativeAuthProviders()).resolves.toBeUndefined();
  });
});
