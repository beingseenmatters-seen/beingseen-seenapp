import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../auth';
import { momentsClient } from '../services/moments/momentsClient';
import {
  dismissMomentsInvitation,
  markMomentsInvitationShown,
  shouldShowMomentsInvitation,
} from '../services/momentsInvitation';

/**
 * Eligibility + actions for the Moments discovery invitation.
 * Mount only on the main app surface (post-onboarding).
 */
export function useMomentsInvitation() {
  const { firebaseUser } = useAuth();
  const navigate = useNavigate();
  const uid = firebaseUser?.uid ?? null;

  const [visible, setVisible] = useState(false);
  const [starting, setStarting] = useState(false);

  useEffect(() => {
    let cancelled = false;
    if (!uid) {
      setVisible(false);
      return;
    }

    momentsClient
      .getOverview()
      .then((overview) => {
        if (cancelled) return;
        const show = shouldShowMomentsInvitation({
          uid,
          completedCount: overview.completedCount,
        });
        if (show) {
          markMomentsInvitationShown(uid);
          setVisible(true);
        } else {
          setVisible(false);
        }
      })
      .catch(() => {
        if (!cancelled) setVisible(false);
      });

    return () => {
      cancelled = true;
    };
  }, [uid]);

  const dismiss = useCallback(() => {
    if (!uid) return;
    dismissMomentsInvitation(uid);
    setVisible(false);
  }, [uid]);

  const start = useCallback(async () => {
    if (!uid || starting) return;
    setStarting(true);
    try {
      // createSession returns the existing active session if present — no duplicates.
      const session = await momentsClient.createSession();
      setVisible(false);
      navigate(`/moments/session/${session.id}`);
    } catch (err) {
      console.error('[MomentsInvitation] failed to start session:', err);
      setStarting(false);
    }
  }, [uid, starting, navigate]);

  return { visible, starting, start, dismiss };
}
