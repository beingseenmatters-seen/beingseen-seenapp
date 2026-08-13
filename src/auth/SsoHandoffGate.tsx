import { useEffect, useState } from 'react';
import { signInWithCustomToken } from 'firebase/auth';
import { auth } from '../services/firebase';
import { useAuth } from './AuthContext';
import { useLanguage } from '../i18n';
import {
  isRevealPath,
  takePendingSsoCode,
  redeemHandoff,
  inspectHandoff,
} from './ssoHandoff';

/**
 * MATTERS SSO receiver gate (Seen web). Renders nothing except the
 * account-choice modal in the one case that needs an explicit decision:
 *
 *   no local user       → redeem silently (no inspect); the user lands
 *                         authenticated and the existing router takes over
 *                         (returning users go in; brand-new-to-Seen users see
 *                         the normal onboarding — Seen's existing behavior)
 *   same local UID      → authenticated inspect; server consumed the code
 *                         atomically; continue silently
 *   different local UID → this modal. NOTHING happens until the user chooses.
 *
 * "Keep using current" leaves the existing session untouched. "Continue as"
 * replaces ONLY this origin's Firebase session. No data merging anywhere.
 */
export function SsoHandoffGate() {
  const { firebaseUser, isLoading } = useAuth();
  const { t } = useLanguage();

  const [conflict, setConflict] = useState<{ incomingEmail: string | null; code: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    if (isLoading) return;
    if (isRevealPath(window.location.pathname)) return; // belt-and-braces
    const code = takePendingSsoCode(); // single-shot latch
    if (!code) return;

    (async () => {
      try {
        if (!firebaseUser) {
          const token = await redeemHandoff(code);
          await signInWithCustomToken(auth, token);
        } else {
          const idToken = await firebaseUser.getIdToken();
          const result = await inspectHandoff(code, idToken);
          if (result.sameAccount) return; // consumed server-side
          setConflict({ incomingEmail: result.incomingEmail, code });
        }
      } catch {
        // Bad/expired/replayed/unreachable → today's behavior, silently.
      }
    })();
    // isLoading settles exactly once at boot; firebaseUser is read then.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isLoading]);

  if (!conflict) return null;

  const currentEmail = firebaseUser?.email ?? firebaseUser?.displayName ?? '';
  const incoming = conflict.incomingEmail;

  const continueAsIncoming = async () => {
    setBusy(true);
    try {
      const token = await redeemHandoff(conflict.code);
      await signInWithCustomToken(auth, token); // replaces THIS origin's session only
      setConflict(null);
    } catch {
      setFailed(true); // quiet failure; current session stays
    } finally {
      setBusy(false);
    }
  };

  const keepCurrent = () => setConflict(null);

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/30 px-6" role="dialog" aria-modal="true">
      <div className="w-full max-w-sm rounded-2xl bg-white border border-stone-200 shadow-xl p-7">
        {failed ? (
          <>
            <p className="text-sm leading-relaxed text-stone-500 mb-6">{t('sso.expired')}</p>
            <button
              onClick={keepCurrent}
              className="w-full rounded-full py-2.5 text-sm font-medium bg-stone-900 text-white hover:bg-stone-800 transition-colors"
            >
              {t('sso.close')}
            </button>
          </>
        ) : (
          <>
            <p className="text-sm leading-relaxed text-stone-500 mb-1">{t('sso.currentIntro')}</p>
            <p className="text-base font-medium text-stone-900 mb-6 break-all">{currentEmail}</p>

            <button
              onClick={continueAsIncoming}
              disabled={busy || !incoming}
              className="w-full rounded-full py-2.5 text-sm font-medium mb-3 bg-stone-900 text-white hover:bg-stone-800 transition-colors disabled:opacity-60"
            >
              {t('sso.continueAs')} {incoming ?? t('sso.otherAccount')}
            </button>
            <button
              onClick={keepCurrent}
              disabled={busy}
              className="w-full rounded-full py-2.5 text-sm font-medium bg-transparent text-stone-500 border border-stone-200 hover:border-stone-300 transition-colors disabled:opacity-60"
            >
              {t('sso.keepUsing')} {currentEmail}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
