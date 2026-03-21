import { useState, useEffect, useCallback } from 'react';
import {
  getVisibleConversations,
  deleteConversation,
  purgeExpired,
  type RetainedConversation,
} from '../services/recentConversations';

export function useRecentConversations() {
  const [conversations, setConversations] = useState<RetainedConversation[]>([]);

  const refresh = useCallback(() => {
    purgeExpired();
    setConversations(getVisibleConversations());
  }, []);

  useEffect(() => {
    refresh();
    const interval = setInterval(refresh, 60_000);
    return () => clearInterval(interval);
  }, [refresh]);

  const remove = useCallback((id: string) => {
    deleteConversation(id);
    refresh();
  }, [refresh]);

  return { conversations, refresh, remove };
}
