import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { StoredSketch } from '../../types/moments';

// --- Mocks -----------------------------------------------------------------
vi.mock('@capacitor/core', () => ({
  Capacitor: { isNativePlatform: vi.fn(() => false) },
}));
vi.mock('@capacitor/share', () => ({
  Share: { share: vi.fn(async () => undefined) },
}));

import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import {
  buildSketchShareText,
  isShareAvailable,
  shareSketch,
} from './shareSketch';

const isNative = Capacitor.isNativePlatform as unknown as ReturnType<typeof vi.fn>;
const nativeShare = Share.share as unknown as ReturnType<typeof vi.fn>;

const sketch: StoredSketch = {
  number: 3,
  text: '你在选择里更看重被理解，而不是被认同。',
  generatedAt: 1_700_000_000_000,
  engineVersion: 'v2',
  language: 'zh',
};

const strings = { title: '速写 · 03', attribution: '— 来自 Seen' };

function setNavigator(nav: Partial<Navigator> | undefined) {
  Object.defineProperty(globalThis, 'navigator', {
    value: nav,
    configurable: true,
    writable: true,
  });
}

beforeEach(() => {
  isNative.mockReturnValue(false);
  nativeShare.mockReset();
  nativeShare.mockResolvedValue(undefined);
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe('buildSketchShareText', () => {
  it('includes title, sketch body and attribution in order', () => {
    const text = buildSketchShareText(sketch, 'zh', strings);
    expect(text).toBe(`速写 · 03\n\n${sketch.text}\n\n— 来自 Seen`);
  });

  it('never leaks anything beyond the abstracted sketch body', () => {
    const text = buildSketchShareText(sketch, 'zh', strings);
    // Only the three known parts appear; no choice/snapshot/signal data.
    expect(text.split('\n\n')).toHaveLength(3);
    expect(text).toContain(sketch.text);
  });
});

describe('isShareAvailable', () => {
  it('is true on native regardless of web APIs', () => {
    isNative.mockReturnValue(true);
    setNavigator({} as Navigator);
    expect(isShareAvailable()).toBe(true);
  });

  it('is true on web when navigator.share exists', () => {
    setNavigator({ share: vi.fn() } as unknown as Navigator);
    expect(isShareAvailable()).toBe(true);
  });

  it('is true on web when only clipboard exists', () => {
    setNavigator({ clipboard: { writeText: vi.fn() } } as unknown as Navigator);
    expect(isShareAvailable()).toBe(true);
  });

  it('is false when neither share nor clipboard exists', () => {
    setNavigator({} as Navigator);
    expect(isShareAvailable()).toBe(false);
  });
});

describe('shareSketch', () => {
  it('uses the native share sheet on native platforms', async () => {
    isNative.mockReturnValue(true);
    const outcome = await shareSketch(sketch, 'zh', strings);
    expect(outcome).toBe('shared');
    expect(nativeShare).toHaveBeenCalledTimes(1);
    const arg = nativeShare.mock.calls[0][0];
    expect(arg.text).toContain(sketch.text);
    expect(arg.text).toContain('— 来自 Seen');
  });

  it('treats native cancellation as benign', async () => {
    isNative.mockReturnValue(true);
    nativeShare.mockRejectedValue(Object.assign(new Error('User cancelled'), { name: 'AbortError' }));
    const outcome = await shareSketch(sketch, 'zh', strings);
    expect(outcome).toBe('cancelled');
  });

  it('uses navigator.share on web when available', async () => {
    const webShare = vi.fn((_data: { text: string }) => Promise.resolve());
    setNavigator({ share: webShare } as unknown as Navigator);
    const outcome = await shareSketch(sketch, 'zh', strings);
    expect(outcome).toBe('shared');
    expect(webShare).toHaveBeenCalledTimes(1);
    expect(webShare.mock.calls[0][0].text).toContain(sketch.text);
  });

  it('falls back to clipboard when navigator.share is absent', async () => {
    const writeText = vi.fn((_text: string) => Promise.resolve());
    setNavigator({ clipboard: { writeText } } as unknown as Navigator);
    const outcome = await shareSketch(sketch, 'zh', strings);
    expect(outcome).toBe('copied');
    expect(writeText).toHaveBeenCalledTimes(1);
    expect(writeText.mock.calls[0][0]).toContain(sketch.text);
  });

  it('falls back to clipboard when navigator.share throws a non-cancellation error', async () => {
    const webShare = vi.fn(async () => {
      throw new Error('not allowed');
    });
    const writeText = vi.fn(async () => undefined);
    setNavigator({ share: webShare, clipboard: { writeText } } as unknown as Navigator);
    const outcome = await shareSketch(sketch, 'zh', strings);
    expect(outcome).toBe('copied');
  });

  it('reports unavailable when no share or clipboard exists', async () => {
    setNavigator({} as Navigator);
    const outcome = await shareSketch(sketch, 'zh', strings);
    expect(outcome).toBe('unavailable');
  });
});
