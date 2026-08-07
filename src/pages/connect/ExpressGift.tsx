import { useEffect, useState } from 'react';
import { ChevronLeft, Loader2, Copy, Check, Share2, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import QRCode from 'qrcode';
import { Capacitor } from '@capacitor/core';
import { Share } from '@capacitor/share';
import { useLanguage } from '../../i18n';
import {
  createGift,
  draftExpressions,
  GiftError,
  type CreateGiftResult,
} from '../../services/gift/giftApi';

type Step = 'compose' | 'drafts' | 'review' | 'created';

const TONES = [
  { value: '真诚', key: 'sincere' },
  { value: '浪漫', key: 'romantic' },
  { value: '轻松幽默', key: 'playful' },
  { value: '克制含蓄', key: 'restrained' },
  { value: '简单直接', key: 'direct' },
] as const;

/** Connect → 有句话，想送给 TA. Sender composes a message and mints a QR Gift. */
export default function ExpressGift() {
  const navigate = useNavigate();
  const { t, effectiveLanguage } = useLanguage();

  const [step, setStep] = useState<Step>('compose');
  const [situation, setSituation] = useState('');
  const [senderName, setSenderName] = useState('');
  const [tone, setTone] = useState<string>('真诚');
  const [drafts, setDrafts] = useState<string[]>([]);
  const [drafting, setDrafting] = useState(false);
  const [message, setMessage] = useState('');
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateGiftResult | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState<'link' | 'key' | null>(null);

  useEffect(() => {
    if (!result) return;
    QRCode.toDataURL(result.url, { margin: 1, width: 320 })
      .then(setQrDataUrl)
      .catch(() => setQrDataUrl(''));
  }, [result]);

  const handleGenerate = async () => {
    if (!situation.trim()) return;
    setDrafting(true);
    setError(null);
    setStep('drafts');
    const out = await draftExpressions(situation.trim(), tone, effectiveLanguage);
    setDrafts(out);
    setDrafting(false);
  };

  const handleCreate = async () => {
    if (!message.trim() || creating) return;
    setCreating(true);
    setError(null);
    try {
      const res = await createGift({
        message: message.trim(),
        senderName: senderName.trim() || null,
        tone,
      });
      setResult(res);
      setStep('created');
    } catch (err) {
      const code = err instanceof GiftError ? err.code : 'create_failed';
      setError(t(`express.error_${code}`) !== `express.error_${code}` ? t(`express.error_${code}`) : t('express.error_generic'));
    } finally {
      setCreating(false);
    }
  };

  const copy = async (text: string, which: 'link' | 'key') => {
    try {
      await navigator.clipboard?.writeText(text);
      setCopied(which);
      setTimeout(() => setCopied(null), 2000);
    } catch {
      /* clipboard unavailable */
    }
  };

  const shareLink = async () => {
    if (!result) return;
    // Share ONLY the link — never the 心意钥匙 (that goes out-of-band).
    const text = `${t('express.share_text')}\n${result.url}`;
    if (Capacitor.isNativePlatform()) {
      try {
        await Share.share({ title: t('express.title'), text, url: result.url });
      } catch {
        /* cancelled */
      }
    } else if (typeof navigator !== 'undefined' && typeof navigator.share === 'function') {
      try {
        await navigator.share({ text, url: result.url });
      } catch {
        /* cancelled */
      }
    } else {
      copy(result.url, 'link');
    }
  };

  const back = () => {
    if (step === 'drafts') setStep('compose');
    else if (step === 'review') setStep(drafts.length ? 'drafts' : 'compose');
    else navigate('/inbox');
  };

  return (
    <div className="flex flex-col h-full w-full bg-surface relative overflow-hidden text-primary font-sans">
      <div className="flex flex-col h-full w-full max-w-md mx-auto bg-white relative">
        {/* Header */}
        <div className="px-6 pt-12 pb-4 flex items-center justify-between bg-white z-10 sticky top-0 shrink-0">
          <button onClick={back} className="p-2 -ml-2 text-secondary hover:text-primary transition-colors" aria-label={t('common.back')}>
            <ChevronLeft size={24} strokeWidth={1.5} />
          </button>
          <span className="text-sm font-medium tracking-widest text-muted uppercase">{t('express.header')}</span>
          <div className="w-8" />
        </div>

        <div className="flex-1 overflow-y-auto no-scrollbar px-6 pb-12">
          {/* STEP: compose */}
          {step === 'compose' && (
            <div className="space-y-8 pt-4">
              <div className="space-y-2">
                <h1 className="text-2xl font-light text-primary">{t('express.title')}</h1>
                <p className="text-sm text-secondary font-light leading-relaxed">{t('express.subtitle')}</p>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-muted font-medium">{t('express.situation_label')}</label>
                <textarea
                  value={situation}
                  onChange={(e) => setSituation(e.target.value)}
                  placeholder={t('express.situation_placeholder')}
                  className="w-full bg-gray-50 rounded-2xl p-4 text-base text-primary placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-gray-200 resize-none min-h-[120px]"
                />
              </div>

              <div className="space-y-3">
                <label className="text-xs text-muted font-medium">{t('express.tone_label')}</label>
                <div className="flex flex-wrap gap-2">
                  {TONES.map((tn) => (
                    <button
                      key={tn.value}
                      onClick={() => setTone(tn.value)}
                      className={clsx(
                        'px-4 py-2 rounded-full text-sm font-light border transition-colors',
                        tone === tn.value
                          ? 'bg-primary text-white border-primary'
                          : 'bg-white text-secondary border-gray-200 hover:border-gray-300',
                      )}
                    >
                      {t(`express.tone_${tn.key}`)}
                    </button>
                  ))}
                </div>
              </div>

              <div className="space-y-2">
                <label className="text-xs text-muted font-medium">{t('express.sender_label')}</label>
                <input
                  value={senderName}
                  onChange={(e) => setSenderName(e.target.value)}
                  placeholder={t('express.sender_placeholder')}
                  className="w-full bg-gray-50 rounded-2xl px-4 py-3 text-base text-primary placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-gray-200"
                />
              </div>

              <div className="space-y-3 pt-2">
                <button
                  onClick={handleGenerate}
                  disabled={!situation.trim()}
                  className="w-full py-3.5 rounded-2xl bg-primary text-white text-sm font-medium hover:bg-black disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
                >
                  {t('express.help_write')}
                </button>
                <button
                  onClick={() => {
                    setMessage('');
                    setStep('review');
                  }}
                  className="w-full py-3.5 rounded-2xl border border-gray-200 text-secondary text-sm font-light hover:bg-gray-50 transition-colors"
                >
                  {t('express.write_myself')}
                </button>
              </div>
            </div>
          )}

          {/* STEP: drafts */}
          {step === 'drafts' && (
            <div className="space-y-6 pt-4">
              <h2 className="text-xl font-light text-primary">{t('express.pick_draft')}</h2>
              {drafting ? (
                <div className="flex flex-col items-center py-16 space-y-3">
                  <Loader2 className="animate-spin text-gray-300" size={28} />
                  <p className="text-sm text-muted font-light">{t('express.drafting')}</p>
                </div>
              ) : drafts.length === 0 ? (
                <div className="space-y-4 py-8 text-center">
                  <p className="text-sm text-secondary font-light">{t('express.draft_empty')}</p>
                  <button onClick={handleGenerate} className="text-sm text-primary underline underline-offset-4">
                    {t('express.regenerate')}
                  </button>
                  <button
                    onClick={() => {
                      setMessage('');
                      setStep('review');
                    }}
                    className="block mx-auto text-sm text-secondary underline underline-offset-4"
                  >
                    {t('express.write_myself')}
                  </button>
                </div>
              ) : (
                <>
                  <div className="space-y-3">
                    {drafts.map((d, i) => (
                      <button
                        key={i}
                        onClick={() => {
                          setMessage(d);
                          setStep('review');
                        }}
                        className="w-full text-left p-5 rounded-2xl bg-gray-50 border border-gray-100 hover:border-gray-300 transition-colors"
                      >
                        <p className="text-base font-light text-primary leading-relaxed whitespace-pre-wrap">{d}</p>
                      </button>
                    ))}
                  </div>
                  <button
                    onClick={handleGenerate}
                    className="flex items-center gap-2 text-sm text-secondary hover:text-primary transition-colors"
                  >
                    <RefreshCw size={14} /> {t('express.regenerate')}
                  </button>
                </>
              )}
            </div>
          )}

          {/* STEP: review */}
          {step === 'review' && (
            <div className="space-y-6 pt-4">
              <h2 className="text-xl font-light text-primary">{t('express.review_title')}</h2>
              <textarea
                value={message}
                onChange={(e) => setMessage(e.target.value)}
                placeholder={t('express.message_placeholder')}
                className="w-full bg-gray-50 rounded-2xl p-4 text-base text-primary placeholder:text-muted focus:outline-none focus:ring-1 focus:ring-gray-200 resize-none min-h-[160px] leading-relaxed"
              />
              {error && <p className="text-sm text-red-500 font-light">{error}</p>}
              <button
                onClick={handleCreate}
                disabled={!message.trim() || creating}
                className="w-full py-3.5 rounded-2xl bg-primary text-white text-sm font-medium hover:bg-black disabled:bg-gray-200 disabled:text-gray-400 transition-colors flex items-center justify-center"
              >
                {creating ? <Loader2 className="animate-spin" size={18} /> : t('express.create')}
              </button>
            </div>
          )}

          {/* STEP: created */}
          {step === 'created' && result && (
            <div className="space-y-8 pt-4 text-center">
              <div className="space-y-2">
                <h2 className="text-xl font-light text-primary">{t('express.created_title')}</h2>
                <p className="text-sm text-secondary font-light leading-relaxed">{t('express.created_subtitle')}</p>
              </div>

              {qrDataUrl && (
                <div className="flex justify-center">
                  <img
                    src={qrDataUrl}
                    alt="QR"
                    className="w-52 h-52 rounded-2xl border border-gray-100 p-3 bg-white"
                  />
                </div>
              )}

              {/* 心意钥匙 */}
              <div className="space-y-3 p-5 rounded-2xl bg-gray-50 border border-gray-100">
                <p className="text-xs text-muted font-medium uppercase tracking-wider">{t('express.key_label')}</p>
                <p className="text-3xl font-light tracking-[0.3em] text-primary">
                  {result.retrievalKey.slice(0, 3)} {result.retrievalKey.slice(3)}
                </p>
                <p className="text-xs text-secondary font-light leading-relaxed">{t('express.key_guidance')}</p>
                <button
                  onClick={() => copy(result.retrievalKey, 'key')}
                  className="inline-flex items-center gap-1.5 text-sm text-primary"
                >
                  {copied === 'key' ? <Check size={14} /> : <Copy size={14} />}
                  {copied === 'key' ? t('express.copied') : t('express.copy_key')}
                </button>
              </div>

              <div className="space-y-3">
                <button
                  onClick={shareLink}
                  className="w-full py-3.5 rounded-2xl bg-primary text-white text-sm font-medium hover:bg-black transition-colors flex items-center justify-center gap-2"
                >
                  <Share2 size={16} /> {t('express.share_link')}
                </button>
                <button
                  onClick={() => copy(result.url, 'link')}
                  className="w-full py-3.5 rounded-2xl border border-gray-200 text-secondary text-sm font-light hover:bg-gray-50 transition-colors flex items-center justify-center gap-2"
                >
                  {copied === 'link' ? <Check size={16} /> : <Copy size={16} />}
                  {copied === 'link' ? t('express.copied') : t('express.copy_link')}
                </button>
                <button
                  onClick={() => navigate('/inbox')}
                  className="w-full py-3 text-sm text-muted font-light hover:text-primary transition-colors"
                >
                  {t('express.done')}
                </button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
