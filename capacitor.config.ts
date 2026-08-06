import type { CapacitorConfig } from '@capacitor/cli';

const config: CapacitorConfig = {
  appId: 'com.beingseenmatters.seen',
  appName: 'Seen',
  webDir: 'dist',
  ios: {
    contentInset: 'automatic',
    allowsLinkPreview: false
  },
  server: {
    androidScheme: 'https',
    iosScheme: 'capacitor'
  },
  plugins: {
    // Do NOT globally enable CapacitorHttp — it patches fetch/XHR and breaks
    // Firestore's WebChannel transport on Android (writes hang forever).
    // Moment Library native fetches use CapacitorHttp explicitly where needed.
    FirebaseAuthentication: {
      providers: ['apple.com', 'google.com'],
    }
  }
};

export default config;
