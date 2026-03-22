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
    CapacitorHttp: {
      // Enable native HTTP for all requests
      enabled: true
    },
    FirebaseAuthentication: {
      providers: ['apple.com', 'google.com'],
    }
  }
};

export default config;
