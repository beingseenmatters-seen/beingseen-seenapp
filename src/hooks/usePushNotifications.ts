import { useEffect } from 'react';
import { Capacitor } from '@capacitor/core';
import { PushNotifications } from '@capacitor/push-notifications';
import { FirebaseMessaging } from '@capacitor-firebase/messaging';
import { useAuth } from '../auth';

export function usePushNotifications() {
  const { seenUser, updateProfile } = useAuth();

  useEffect(() => {
    if (!seenUser || !Capacitor.isNativePlatform()) return;

    const setupPush = async () => {
      try {
        // 1. Request permission
        let permStatus = await PushNotifications.checkPermissions();
        
        if (permStatus.receive === 'prompt') {
          permStatus = await PushNotifications.requestPermissions();
        }

        if (permStatus.receive !== 'granted') {
          console.log('[Push] User denied push notification permission');
          return;
        }

        // 2. Register with Apple / Google
        await PushNotifications.register();

        // 3. Get FCM token
        const { token } = await FirebaseMessaging.getToken();
        console.log("FCM TOKEN:", token);

        // 4. Save to Firestore
        if (token) {
          const currentTokens = seenUser.fcmTokens || [];
          const tokenExists = currentTokens.some((t: { token: string }) => t.token === token);
          
          if (!tokenExists) {
            const newToken = {
              token,
              platform: Capacitor.getPlatform(),
              updatedAt: Date.now()
            };
            
            await updateProfile({
              fcmTokens: [...currentTokens, newToken]
            });
            console.log('[Push] FCM token saved to Firestore');
          }
        }
      } catch (err) {
        console.error('[Push] Failed to setup push notifications:', err);
      }
    };

    setupPush();

    // Listeners for foreground/background
    const pushReceivedListener = PushNotifications.addListener('pushNotificationReceived', (notification) => {
      console.log('[Push] Notification received in foreground:', notification);
      // Could show a local toast here if needed
    });

    const pushActionPerformedListener = PushNotifications.addListener('pushNotificationActionPerformed', (notification) => {
      console.log('[Push] Notification action performed:', notification);
    });

    return () => {
      pushReceivedListener.then(l => l.remove());
      pushActionPerformedListener.then(l => l.remove());
    };
  }, [seenUser, updateProfile]); // Only re-run if user changes
}
