import { useCallback, useEffect, useState } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../services/firebase';
import {
  getKeptReflections,
  deleteKeptReflection,
  hydrateKeptReflections,
  subscribeKeptReflections,
  type KeptReflection,
} from '../services/keptReflections';

/**
 * Reflection History reader (Phase 4 · Sprint 3).
 *
 * Offline mirror is uid-scoped. On sign-in, hydrate REPLACES that uid's mirror
 * from Firestore (source of truth). On sign-out, AuthContext detaches the
 * previous uid's mirror so another account never inherits it.
 */
export function useKeptReflections() {
  const [reflections, setReflections] = useState<KeptReflection[]>([]);

  const refresh = useCallback(() => {
    setReflections(getKeptReflections());
  }, []);

  useEffect(() => {
    refresh();
    const unsubscribeStore = subscribeKeptReflections(refresh);
    const unsubscribeAuth = onAuthStateChanged(auth, (user) => {
      if (!user) {
        // Logout detach already cleared the mirror; render empty immediately.
        refresh();
        return;
      }
      // Replace local mirror with this uid's Firestore only — never merge.
      void hydrateKeptReflections().then(refresh);
    });
    return () => {
      unsubscribeStore();
      unsubscribeAuth();
    };
  }, [refresh]);

  const remove = useCallback(
    (id: string) => {
      deleteKeptReflection(id);
      refresh();
    },
    [refresh],
  );

  return { reflections, refresh, remove };
}
