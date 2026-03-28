import { Mic, Square, Loader2 } from 'lucide-react';
import type { VoiceState } from '../hooks/useVoiceRecorder';

interface VoiceOverlayProps {
  state: VoiceState;
  elapsedMs: number;
  errorKey: string | null;
  t: (key: string) => string;
  onStop: () => void;
  onCancel: () => void;
  onRetry: () => void;
}

function formatTimer(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function VoiceOverlay({ state, elapsedMs, errorKey, t, onStop, onCancel, onRetry }: VoiceOverlayProps) {
  if (state === 'idle' || state === 'cancelling') return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl p-8 mx-6 max-w-xs w-full text-center shadow-2xl space-y-5">
        {state === 'recording' && (
          <>
            <div className="mx-auto w-16 h-16 rounded-full bg-red-50 flex items-center justify-center animate-pulse">
              <Mic size={28} className="text-red-500" />
            </div>
            <p className="text-sm font-medium text-gray-800">{t('voice.recording')}</p>
            <p className="text-2xl font-light text-gray-600 tabular-nums">{formatTimer(elapsedMs)}</p>
            <button
              onClick={onStop}
              className="w-full py-3.5 rounded-xl bg-gray-900 text-white text-sm font-medium active:bg-black transition-colors flex items-center justify-center gap-2"
            >
              <Square size={14} fill="currentColor" />
              {t('voice.stop')}
            </button>
          </>
        )}

        {state === 'processing' && (
          <>
            <div className="mx-auto w-16 h-16 rounded-full bg-gray-100 flex items-center justify-center">
              <Loader2 size={28} className="text-gray-500 animate-spin" />
            </div>
            <p className="text-sm font-medium text-gray-800">{t('voice.transcribing')}</p>
          </>
        )}

        {state === 'error' && (
          <>
            <div className="mx-auto w-16 h-16 rounded-full bg-amber-50 flex items-center justify-center">
              <Mic size={28} className="text-amber-500" />
            </div>
            <p className="text-sm font-medium text-gray-800">
              {errorKey ? t(errorKey) : t('voice.error_generic')}
            </p>
            <div className="flex gap-3 justify-center pt-1">
              <button
                onClick={onCancel}
                className="flex-1 py-3 rounded-xl border border-gray-200 text-sm text-gray-500 active:bg-gray-50 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={onRetry}
                className="flex-1 py-3 rounded-xl bg-gray-900 text-white text-sm font-medium active:bg-black transition-colors"
              >
                {t('voice.retry')}
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}
