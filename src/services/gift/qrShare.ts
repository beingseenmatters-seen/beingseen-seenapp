import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { Filesystem, Directory } from '@capacitor/filesystem';

export type QrShareOutcome = 'shared' | 'saved' | 'cancelled' | 'unavailable' | 'error';

/**
 * Share the QR itself as the primary object.
 *   native → write the PNG to cache, then Share.share the file (image sheet)
 *   web    → navigator.share({files}) when supported, else download the PNG
 * `dataUrl` is a PNG data URL; `text` is an accompanying note (no key).
 */
export async function shareQrImage(
  dataUrl: string,
  text: string,
  filename = 'seen-gift-qr.png',
): Promise<QrShareOutcome> {
  const base64 = dataUrl.split(',')[1] ?? '';

  if (Capacitor.isNativePlatform()) {
    try {
      const path = `${filename}`;
      await Filesystem.writeFile({ path, data: base64, directory: Directory.Cache });
      const { uri } = await Filesystem.getUri({ path, directory: Directory.Cache });
      await Share.share({ text, files: [uri] });
      return 'shared';
    } catch (err) {
      if (isCancellation(err)) return 'cancelled';
      console.error('[shareQrImage] native failed', err);
      return 'error';
    }
  }

  const nav = typeof navigator !== 'undefined' ? navigator : undefined;
  try {
    const blob = await (await fetch(dataUrl)).blob();
    const file = new File([blob], filename, { type: 'image/png' });
    if (nav && nav.canShare?.({ files: [file] }) && typeof nav.share === 'function') {
      await nav.share({ files: [file], text });
      return 'shared';
    }
  } catch (err) {
    if (isCancellation(err)) return 'cancelled';
    // fall through to download
  }

  // Fallback: download the QR image so the sender can send it however they like.
  try {
    const a = document.createElement('a');
    a.href = dataUrl;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    return 'saved';
  } catch (err) {
    console.error('[shareQrImage] download failed', err);
    return 'unavailable';
  }
}

function isCancellation(err: unknown): boolean {
  const name = (err as { name?: string })?.name;
  return name === 'AbortError';
}
