import { useEffect } from 'react';
import { useNavigate } from 'react-router-dom';
import { App } from '@capacitor/app';
import { isNative } from '../../auth/platform';

/**
 * Native deep-link routing for Gift links. The universal link
 * `app.beingseenmatters.com/s/{token}` opens the app (associated domains);
 * Capacitor delivers it via appUrlOpen, and we route the SPA to the reveal
 * page. On web the BrowserRouter already handles `/s/:token` directly.
 */
export function useGiftDeepLink(): void {
  const navigate = useNavigate();
  useEffect(() => {
    if (!isNative()) return;
    const handle = App.addListener('appUrlOpen', (event: { url: string }) => {
      const token = parseGiftToken(event.url);
      if (token) navigate(`/s/${token}`);
    });
    return () => {
      handle.then((h) => h.remove());
    };
  }, [navigate]);
}

/** Extract the opaque token from a `/s/{token}` URL, else null. */
export function parseGiftToken(url: string): string | null {
  try {
    const path = new URL(url).pathname;
    const m = path.match(/^\/s\/([A-Za-z0-9_-]+)\/?$/);
    return m ? m[1] : null;
  } catch {
    const m = url.match(/\/s\/([A-Za-z0-9_-]+)\/?(?:$|[?#])/);
    return m ? m[1] : null;
  }
}
