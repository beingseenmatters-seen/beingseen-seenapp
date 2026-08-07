import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import type { StoredSketch } from '../../types/moments';
import { displaySketchText } from '../moments/sketchEngineV2';

export interface SketchShareStrings {
  /** Localised sketch title, e.g. "速写 · 03". */
  title: string;
  /** Localised attribution line, e.g. "— 来自 Seen". */
  attribution: string;
}

export type ShareOutcome = 'shared' | 'copied' | 'cancelled' | 'unavailable' | 'error';

/**
 * Compose the shareable text for a single sketch.
 *
 * Privacy boundary: this contains ONLY the abstracted sketch body the user is
 * currently viewing (via displaySketchText) plus a title and brand attribution.
 * It deliberately never includes the underlying Moment choice snapshots,
 * interpretations, or signals. The user shares only what they see.
 */
export function buildSketchShareText(
  sketch: StoredSketch,
  language: 'zh' | 'en',
  strings: SketchShareStrings,
): string {
  const body = displaySketchText(sketch, language);
  return [strings.title, body, strings.attribution]
    .map((part) => part.trim())
    .filter(Boolean)
    .join('\n\n');
}

/** Whether any share or copy path exists in the current runtime. */
export function isShareAvailable(): boolean {
  if (Capacitor.isNativePlatform()) return true;
  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  return !!(nav && (typeof nav.share === 'function' || nav.clipboard?.writeText));
}

/**
 * Share a sketch as plain text.
 *   native → system share sheet (@capacitor/share)
 *   web    → navigator.share, falling back to clipboard copy
 * No image rendering, no link to private data, no backend call.
 */
export async function shareSketch(
  sketch: StoredSketch,
  language: 'zh' | 'en',
  strings: SketchShareStrings,
): Promise<ShareOutcome> {
  const text = buildSketchShareText(sketch, language, strings);

  if (Capacitor.isNativePlatform()) {
    try {
      await Share.share({ title: strings.title, text, dialogTitle: strings.title });
      return 'shared';
    } catch (err) {
      // Dismissing the native sheet rejects; treat cancellation as benign.
      if (isCancellation(err)) return 'cancelled';
      console.error('[shareSketch] native share failed', err);
      return 'error';
    }
  }

  const nav = typeof navigator !== 'undefined' ? navigator : undefined;

  if (nav && typeof nav.share === 'function') {
    try {
      await nav.share({ text });
      return 'shared';
    } catch (err) {
      if (isCancellation(err)) return 'cancelled';
      // Non-cancellation failure — fall through to clipboard.
    }
  }

  if (nav?.clipboard?.writeText) {
    try {
      await nav.clipboard.writeText(text);
      return 'copied';
    } catch (err) {
      console.error('[shareSketch] clipboard write failed', err);
      return 'error';
    }
  }

  return 'unavailable';
}

function isCancellation(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  const message = (err as { message?: string })?.message ?? '';
  return name === 'AbortError' || /cancel|abort/i.test(message);
}
