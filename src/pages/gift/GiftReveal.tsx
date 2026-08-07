import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Loader2 } from 'lucide-react';
import { useLanguage } from '../../i18n';
import { retrieveGift, type RetrieveResult } from '../../services/gift/giftApi';

/**
 * Public `/s/:token` Gift reveal. No Seen account required. The recipient
 * enters the six-digit 心意钥匙; the message is revealed only on server-side
 * verification. There is no token-only path to the content.
 */
export default function GiftReveal() {
  const { token } = useParams<{ token: string }>();
  const { t } = useLanguage();

  const [key, setKey] = useState('');
  const [loading, setLoading] = useState(false);
  const [result, setResult] = useState<RetrieveResult | null>(null);

  const submit = async () => {
    if (!token || key.replace(/\D/g, '').length < 6 || loading) return;
    setLoading(true);
    const r = await retrieveGift(token, key);
    setResult(r);
    setLoading(false);
  };

  const revealed = result?.status === 'ok' ? result : null;

  return (
    <div className="flex flex-col h-full w-full bg-surface text-primary font-sans">
      <div className="flex flex-col h-full w-full max-w-md mx-auto bg-white px-6">
        <div className="flex-1 flex flex-col justify-center py-12">
          {revealed ? (
            <div className="space-y-6">
              <p className="text-xs text-muted uppercase tracking-widest text-center">
                {revealed.senderName
                  ? t('gift.from_named').replace('{{name}}', revealed.senderName)
                  : t('gift.from_anonymous')}
              </p>
              <div className="p-6 rounded-2xl bg-gray-50 border border-gray-100">
                <p className="text-lg font-light text-primary leading-loose whitespace-pre-wrap">
                  {revealed.message}
                </p>
              </div>
              <p className="text-center text-[11px] text-muted font-light tracking-widest uppercase">Seen</p>
            </div>
          ) : (
            <div className="space-y-8">
              <div className="space-y-2 text-center">
                <h1 className="text-2xl font-light text-primary">{t('gift.reveal_title')}</h1>
                <p className="text-sm text-secondary font-light leading-relaxed">{t('gift.reveal_subtitle')}</p>
              </div>

              <div className="space-y-3">
                <input
                  value={key}
                  onChange={(e) => setKey(e.target.value.replace(/[^\d\s]/g, '').slice(0, 7))}
                  onKeyDown={(e) => e.key === 'Enter' && submit()}
                  inputMode="numeric"
                  autoFocus
                  placeholder="· · ·   · · ·"
                  className="w-full bg-gray-50 rounded-2xl py-4 text-center text-2xl tracking-[0.4em] text-primary placeholder:text-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-200"
                />

                {result && result.status !== 'ok' && (
                  <p className="text-sm text-center font-light text-red-500">
                    {result.status === 'invalid_key' &&
                      t('gift.err_invalid_key').replace('{{n}}', String(result.attemptsRemaining))}
                    {result.status === 'locked' && t('gift.err_locked')}
                    {result.status === 'not_found' && t('gift.err_not_found')}
                    {result.status === 'revoked' && t('gift.err_revoked')}
                    {result.status === 'expired' && t('gift.err_expired')}
                    {result.status === 'error' && t('gift.err_generic')}
                  </p>
                )}

                <button
                  onClick={submit}
                  disabled={key.replace(/\D/g, '').length < 6 || loading || result?.status === 'locked'}
                  className="w-full py-3.5 rounded-2xl bg-primary text-white text-sm font-medium hover:bg-black disabled:bg-gray-200 disabled:text-gray-400 transition-colors flex items-center justify-center"
                >
                  {loading ? <Loader2 className="animate-spin" size={18} /> : t('gift.open')}
                </button>
              </div>

              <p className="text-center text-[11px] text-muted font-light leading-relaxed">
                {t('gift.reveal_hint')}
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
