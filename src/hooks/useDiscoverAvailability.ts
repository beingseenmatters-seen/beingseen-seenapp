import { useEffect, useState } from 'react';
import { useAuth } from '../auth';
import { getResonateCandidate } from '../services/connections';
import {
  getDiscoverLastSeenUid,
  subscribeDiscoverAvailability,
} from '../services/discoverAvailability';

/**
 * Discover availability (Sprint 4B). Returns whether a *genuinely new* meaningful
 * possibility exists — the single signal behind the subtle Discover tab dot.
 *
 * Quiet by design: it checks once on mount and on a slow interval (never urgent),
 * and recomputes instantly when Discover is opened (which clears the dot). It
 * reuses the existing candidate selection and changes no backend logic.
 */
export function useDiscoverAvailability() {
  const { firebaseUser } = useAuth();
  const uid = firebaseUser?.uid;

  const [candidateUid, setCandidateUid] = useState<string | null>(null);
  const [lastSeen, setLastSeen] = useState<string | null>(() => getDiscoverLastSeenUid());

  useEffect(() => {
    let cancelled = false;

    async function check() {
      if (!uid) {
        if (!cancelled) setCandidateUid(null);
        return;
      }
      try {
        const candidate = await getResonateCandidate(uid);
        if (!cancelled) setCandidateUid(candidate?.uid ?? null);
      } catch {
        if (!cancelled) setCandidateUid(null);
      }
    }

    check();
    const interval = setInterval(check, 5 * 60_000);
    const unsubscribe = subscribeDiscoverAvailability(() => setLastSeen(getDiscoverLastSeenUid()));

    return () => {
      cancelled = true;
      clearInterval(interval);
      unsubscribe();
    };
  }, [uid]);

  // A dot only for a genuinely new possibility the person hasn't opened to yet.
  const hasNew = candidateUid !== null && candidateUid !== '' && candidateUid !== lastSeen;

  return { hasNew, candidateUid };
}
