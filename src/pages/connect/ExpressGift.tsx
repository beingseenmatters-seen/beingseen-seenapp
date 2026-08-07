import { useEffect, useState } from 'react';
import { ChevronLeft, Loader2, Copy, Check, RefreshCw, Pencil, QrCode } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import clsx from 'clsx';
import QRCode from 'qrcode';
import { useLanguage } from '../../i18n';
import {
  createGift,
  draftExpressions,
  GiftError,
  type CreateGiftResult,
} from '../../services/gift/giftApi';
import { generateHeartKey, isWeakHeartKey, formatHeartKey } from '../../services/gift/heartKey';
import { shareQrImage } from '../../services/gift/qrShare';

type Step = 'compose' | 'drafts' | 'review' | 'key' | 'shared';

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
  const [sealing, setSealing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<CreateGiftResult | null>(null);
  const [qrDataUrl, setQrDataUrl] = useState<string>('');
  const [copied, setCopied] = useState<'link' | 'key' | null>(null);

  // Heart Key — chosen client-side (default / 换一个 / 自定义) BEFORE sealing.
  const [heartKey, setHeartKey] = useState<string>('');
  const [customOpen, setCustomOpen] = useState(false);
  const [customInput, setCustomInput] = useState('');
  const [customError, setCustomError] = useState<string | null>(null);

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

  // Move from message review to the Heart Key step, seeding a default key.
  const goToKeyStep = () => {
    if (!message.trim()) return;
    setError(null);
    setHeartKey(generateHeartKey());
    setStep('key');
  };

  const confirmCustomKey = () => {
    const digits = customInput.replace(/\D/g, '');
    if (isWeakHeartKey(digits)) {
      setCustomError(
        digits.length === 6 ? t('express.custom_weak') : t('express.custom_invalid'),
      );
      return;
    }
    setHeartKey(digits);
    setCustomOpen(false);
    setCustomError(null);
  };

  // Seal the Gift: the single /gift/create call. After this the key is immutable.
  const handleSeal = async () => {
    if (!message.trim() || sealing) return;
    setSealing(true);
    setError(null);
    try {
      const res = await createGift({
        message: message.trim(),
        senderName: senderName.trim() || null,
        tone,
        retrievalKey: heartKey,
      });
      setResult(res);
      setStep('shared');
    } catch (err) {
      const code = err instanceof GiftError ? err.code : 'create_failed';
      const key = `express.error_${code}`;
      setError(t(key) !== key ? t(key) : t('express.error_generic'));
    } finally {
      setSealing(false);
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

  // Share the QR itself (the primary sharing object) — never the key.
  const shareQr = async () => {
    if (!result || !qrDataUrl) return;
    await shareQrImage(qrDataUrl, `${t('express.share_text')}\n${result.url}`);
  };

  const back = () => {
    if (step === 'drafts') setStep('compose');
    else if (step === 'review') setStep(drafts.length ? 'drafts' : 'compose');
    else if (step === 'key') setStep('review');
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
                onClick={goToKeyStep}
                disabled={!message.trim()}
                className="w-full py-3.5 rounded-2xl bg-primary text-white text-sm font-medium hover:bg-black disabled:bg-gray-200 disabled:text-gray-400 transition-colors flex items-center justify-center"
              >
                {t('express.next')}
              </button>
            </div>
          )}

          {/* STEP: key — choose the Heart Key (default / 换一个 / 自定义), mutable */}
          {step === 'key' && (
            <div className="space-y-8 pt-4">
              <div className="space-y-2">
                <h2 className="text-xl font-light text-primary">{t('express.key_title')}</h2>
                <p className="text-sm text-secondary font-light leading-relaxed">{t('express.key_choose_hint')}</p>
              </div>

              <div className="py-6 flex flex-col items-center gap-6">
                <p className="text-[2.75rem] leading-none font-light tracking-[0.25em] text-primary tabular-nums">
                  {formatHeartKey(heartKey)}
                </p>
                <div className="flex items-center gap-3">
                  <button
                    onClick={() => setHeartKey(generateHeartKey())}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-gray-200 text-sm font-light text-secondary hover:border-gray-300 transition-colors"
                  >
                    <RefreshCw size={14} /> {t('express.key_regenerate')}
                  </button>
                  <button
                    onClick={() => {
                      setCustomInput('');
                      setCustomError(null);
                      setCustomOpen(true);
                    }}
                    className="inline-flex items-center gap-1.5 px-4 py-2 rounded-full border border-gray-200 text-sm font-light text-secondary hover:border-gray-300 transition-colors"
                  >
                    <Pencil size={14} /> {t('express.key_custom')}
                  </button>
                </div>
              </div>

              {error && <p className="text-sm text-red-500 font-light text-center">{error}</p>}
              <button
                onClick={handleSeal}
                disabled={sealing}
                className="w-full py-4 rounded-2xl bg-primary text-white text-base font-medium hover:bg-black disabled:bg-gray-200 disabled:text-gray-400 transition-colors flex items-center justify-center"
              >
                {sealing ? <Loader2 className="animate-spin" size={18} /> : t('express.seal')}
              </button>
              <p className="text-center text-[11px] text-muted font-light">{t('express.seal_hint')}</p>
            </div>
          )}

          {/* STEP: shared — QR is the primary object; key is now immutable */}
          {step === 'shared' && result && (
            <div className="space-y-8 pt-4 text-center">
              <div className="space-y-1.5">
                <h2 className="text-xl font-light text-primary">{t('express.created_title')}</h2>
                <p className="text-sm text-secondary font-light leading-relaxed">
                  {t('express.share_lead_1')}
                  <br />
                  {t('express.share_lead_2')}
                </p>
              </div>

              {/* QR hero — the sharing object */}
              <div className="flex flex-col items-center gap-4">
                {qrDataUrl && (
                  <img
                    src={qrDataUrl}
                    alt="QR"
                    className="w-64 h-64 rounded-3xl border border-gray-100 p-4 bg-white shadow-sm"
                  />
                )}
                <button
                  onClick={shareQr}
                  className="w-full py-4 rounded-2xl bg-primary text-white text-base font-medium hover:bg-black transition-colors flex items-center justify-center gap-2"
                >
                  <QrCode size={18} /> {t('express.share_qr')}
                </button>
                <button
                  onClick={() => copy(result.url, 'link')}
                  className="inline-flex items-center gap-1.5 text-sm text-secondary hover:text-primary transition-colors"
                >
                  {copied === 'link' ? <Check size={15} /> : <Copy size={15} />}
                  {copied === 'link' ? t('express.copied') : t('express.copy_link')}
                </button>
              </div>

              {/* 心意钥匙 reminder — for TA only */}
              <div className="space-y-2 p-5 rounded-2xl bg-gray-50 border border-gray-100">
                <p className="text-xs text-muted font-medium uppercase tracking-wider">{t('express.key_label')}</p>
                <p className="text-2xl font-light tracking-[0.3em] text-primary tabular-nums">
                  {formatHeartKey(result.retrievalKey)}
                </p>
                <p className="text-xs text-secondary font-light">{t('express.key_only_ta')}</p>
                <button
                  onClick={() => copy(result.retrievalKey, 'key')}
                  className="inline-flex items-center gap-1.5 text-sm text-primary pt-1"
                >
                  {copied === 'key' ? <Check size={14} /> : <Copy size={14} />}
                  {copied === 'key' ? t('express.copied') : t('express.copy_key')}
                </button>
              </div>

              {/* Deliberate completion */}
              <button
                onClick={() => navigate('/inbox')}
                className="w-full py-4 rounded-2xl border-2 border-primary text-primary text-base font-medium hover:bg-primary hover:text-white transition-colors flex items-center justify-center gap-2"
              >
                <Check size={18} /> {t('express.done')}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* 自定义 Heart Key dialog */}
      {customOpen && (
        <div className="absolute inset-0 z-30 flex items-end sm:items-center justify-center bg-black/30 px-4 pb-8 sm:pb-0">
          <div className="w-full max-w-md bg-white rounded-3xl p-6 space-y-5 shadow-xl">
            <h3 className="text-lg font-light text-primary">{t('express.custom_title')}</h3>
            <input
              value={customInput}
              onChange={(e) => {
                setCustomInput(e.target.value.replace(/\D/g, '').slice(0, 6));
                setCustomError(null);
              }}
              onKeyDown={(e) => e.key === 'Enter' && confirmCustomKey()}
              inputMode="numeric"
              autoFocus
              placeholder="· · ·   · · ·"
              className="w-full bg-gray-50 rounded-2xl py-4 text-center text-2xl tracking-[0.4em] text-primary placeholder:text-gray-300 focus:outline-none focus:ring-1 focus:ring-gray-200 tabular-nums"
            />
            {customError && <p className="text-sm text-red-500 font-light">{customError}</p>}
            <div className="text-xs text-muted font-light leading-relaxed whitespace-pre-line">
              {t('express.custom_hint')}
            </div>
            <div className="flex gap-3 pt-1">
              <button
                onClick={() => setCustomOpen(false)}
                className="flex-1 py-3 rounded-2xl border border-gray-200 text-secondary text-sm font-light hover:bg-gray-50 transition-colors"
              >
                {t('express.custom_cancel')}
              </button>
              <button
                onClick={confirmCustomKey}
                disabled={customInput.length !== 6}
                className="flex-1 py-3 rounded-2xl bg-primary text-white text-sm font-medium hover:bg-black disabled:bg-gray-200 disabled:text-gray-400 transition-colors"
              >
                {t('express.custom_confirm')}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
