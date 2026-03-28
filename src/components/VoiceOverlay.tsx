import { Mic, Loader2, X } from 'lucide-react';
import type { VoiceState } from '../hooks/useVoiceRecorder';

interface VoiceOverlayProps {
  state: VoiceState;
  elapsedMs: number;
  errorKey: string | null;
  t: (key: string) => string;
  onCancel: () => void;
  onRetry: () => void;
}

function formatTimer(ms: number): string {
  const totalSec = Math.floor(ms / 1000);
  const m = Math.floor(totalSec / 60);
  const s = totalSec % 60;
  return `${m}:${s.toString().padStart(2, '0')}`;
}

export default function VoiceOverlay({ state, elapsedMs, errorKey, t, onCancel, onRetry }: VoiceOverlayProps) {
  if (state === 'idle' || state === 'cancelling') return null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 backdrop-blur-sm">
      <div className="bg-white rounded-2xl p-8 mx-6 max-w-xs w-full text-center shadow-2xl space-y-4">
        {state === 'recording' && (
          <>
            <div className="mx-auto w-16 h-16 rounded-full bg-red-50 flex items-center justify-center animate-pulse">
              <Mic size={28} className="text-red-500" />
            </div>
            <p className="text-sm font-medium text-gray-800">{t('voice.recording')}</p>
            <p className="text-2xl font-light text-gray-600 tabular-nums">{formatTimer(elapsedMs)}</p>
            <p className="text-xs text-gray-400">{t('voice.slide_cancel')}</p>
            <button
              onClick={onCancel}
              className="mt-2 p-2 rounded-full text-gray-400 hover:text-red-500 hover:bg-red-50 transition-colors mx-auto flex items-center justify-center"
            >
              <X size={20} />
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
            <div className="flex gap-3 justify-center pt-2">
              <button
                onClick={onCancel}
                className="px-4 py-2 text-sm text-gray-500 hover:text-gray-700 transition-colors"
              >
                {t('common.cancel')}
              </button>
              <button
                onClick={onRetry}
                className="px-4 py-2 text-sm font-medium text-white bg-gray-800 rounded-lg hover:bg-black transition-colors"
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
