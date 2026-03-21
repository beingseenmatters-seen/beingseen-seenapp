import { App, type URLOpenListenerEvent } from '@capacitor/app';
import { isNative } from './platform';

type DeepLinkHandler = (url: string) => void;

let registered = false;

export function registerDeepLinkListener(onUrl: DeepLinkHandler): () => void {
  if (!isNative()) {
    console.log('[DeepLink] Skipping — not a native platform');
    return () => {};
  }

  if (registered) {
    console.warn('[DeepLink] Listener already registered, skipping duplicate');
    return () => {};
  }

  registered = true;
  console.log('[DeepLink] Registering appUrlOpen listener');

  const listener = App.addListener(
    'appUrlOpen',
    (event: URLOpenListenerEvent) => {
      console.log('[DeepLink] appUrlOpen received:', event.url);
      onUrl(event.url);
    },
  );

  return () => {
    console.log('[DeepLink] Removing appUrlOpen listener');
    listener.then((h) => h.remove());
    registered = false;
  };
}
