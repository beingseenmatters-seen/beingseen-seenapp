/**
 * Reusable Moments discovery invitation.
 *
 * Layout-agnostic: no page chrome. Safe to embed in Reflect home, future
 * campaign landings, or Mini Program shells. Does not own eligibility —
 * the parent decides whether to mount it.
 */

import { useLanguage } from '../../i18n';

export interface MomentsInvitationCardProps {
  onStart: () => void;
  onDismiss: () => void;
  /** Optional wrapper class for host-page spacing. */
  className?: string;
  starting?: boolean;
}

export default function MomentsInvitationCard({
  onStart,
  onDismiss,
  className = '',
  starting = false,
}: MomentsInvitationCardProps) {
  const { t } = useLanguage();

  return (
    <div
      className={`rounded-2xl border border-stone-200/90 bg-white px-4 py-4 space-y-3 shadow-sm ${className}`}
      data-testid="moments-invitation-card"
    >
      <div className="space-y-1.5">
        <h3 className="text-base font-light text-primary leading-snug">
          {t('moments.invite_title')}
        </h3>
        <p className="text-xs text-secondary font-light leading-relaxed whitespace-pre-line">
          {t('moments.invite_body')}
        </p>
      </div>
      <div className="space-y-2">
        <button
          type="button"
          onClick={onStart}
          disabled={starting}
          className="w-full py-2.5 rounded-xl bg-primary text-white text-sm font-medium hover:bg-black transition-colors disabled:opacity-60"
        >
          {t('moments.invite_cta_start')}
        </button>
        <button
          type="button"
          onClick={onDismiss}
          disabled={starting}
          className="w-full py-2 rounded-lg text-sm text-gray-500 font-light hover:bg-gray-50 transition-colors disabled:opacity-60"
        >
          {t('moments.invite_cta_later')}
        </button>
      </div>
    </div>
  );
}
