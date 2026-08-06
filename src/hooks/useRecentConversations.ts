import { useState, useEffect, useCallback } from 'react';
import { onAuthStateChanged } from 'firebase/auth';
import { auth } from '../services/firebase';
import {
  getVisibleConversations,
  deleteConversation,
  purgeExpired,
  RETAINED_CONVERSATIONS_CHANGED_EVENT,
  type RetainedConversation,
} from '../services/recentConversations';

export function useRecentConversations() {
  const [conversations, setConversations] = useState<RetainedConversation[]>([]);

  const refresh = useCallback(() => {
    // No uid → empty list (never render another user's history).
    if (!auth.currentUser?.uid) {
      setConversations([]);
      return;
    }
    purgeExpired();
    setConversations(getVisibleConversations());
  }, []);

  useEffect(() => {
    refresh();
    const unsubscribeAuth = onAuthStateChanged(auth, () => {
      refresh();
    });
    const onListChange = () => refresh();
    window.addEventListener('seen:user-local-storage-detached', onListChange);
    window.addEventListener(RETAINED_CONVERSATIONS_CHANGED_EVENT, onListChange);
    const interval = setInterval(refresh, 60_000);
    return () => {
      unsubscribeAuth();
      window.removeEventListener('seen:user-local-storage-detached', onListChange);
      window.removeEventListener(RETAINED_CONVERSATIONS_CHANGED_EVENT, onListChange);
      clearInterval(interval);
    };
  }, [refresh]);

  const remove = useCallback((id: string) => {
    deleteConversation(id);
    refresh();
  }, [refresh]);

  return { conversations, refresh, remove };
}
