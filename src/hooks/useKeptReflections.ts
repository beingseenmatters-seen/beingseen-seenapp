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
 * Reads from the local cache for instant, offline-friendly access, and keeps it
 * reconciled with the durable Firestore backing store on sign-in (cross-device
 * persistence). The Me page consumes this to surface kept Reflections.
 */
export function useKeptReflections() {
  const [reflections, setReflections] = useState<KeptReflection[]>([]);

  const refresh = useCallback(() => {
    setReflections(getKeptReflections());
  }, []);

  useEffect(() => {
    refresh();
    const unsubscribeStore = subscribeKeptReflections(refresh);
    // Reconcile with Firestore whenever auth resolves/changes; refresh after.
    const unsubscribeAuth = onAuthStateChanged(auth, () => {
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
