import { useState, useRef, useCallback, useEffect } from 'react';
import { VoiceRecorder } from 'capacitor-voice-recorder';
import { isNative } from '../auth/platform';

export type VoiceState = 'idle' | 'recording' | 'cancelling' | 'processing' | 'error';

const MAX_DURATION_MS = 60_000;
const MIN_DURATION_MS = 1_000;

interface UseVoiceRecorderReturn {
  state: VoiceState;
  elapsedMs: number;
  errorKey: string | null;
  startRecording: () => Promise<void>;
  stopRecording: () => Promise<{ base64: string; mimeType: string } | null>;
  cancelRecording: () => Promise<void>;
  setProcessing: () => void;
  setError: (key: string) => void;
  resetToIdle: () => void;
}

export function useVoiceRecorder(): UseVoiceRecorderReturn {
  const [state, setState] = useState<VoiceState>('idle');
  const [elapsedMs, setElapsedMs] = useState(0);
  const [errorKey, setErrorKey] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (maxTimerRef.current) { clearTimeout(maxTimerRef.current); maxTimerRef.current = null; }
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const startRecording = useCallback(async () => {
    if (!isNative()) return;
    setErrorKey(null);

    try {
      const perm = await VoiceRecorder.hasAudioRecordingPermission();
      if (!perm.value) {
        const req = await VoiceRecorder.requestAudioRecordingPermission();
        if (!req.value) {
          setState('error');
          setErrorKey('voice.error_permission');
          return;
        }
      }

      await VoiceRecorder.startRecording();
      setState('recording');
      startTimeRef.current = Date.now();
      setElapsedMs(0);

      timerRef.current = setInterval(() => {
        setElapsedMs(Date.now() - startTimeRef.current);
      }, 200);

      maxTimerRef.current = setTimeout(async () => {
        clearTimers();
        try {
          await VoiceRecorder.stopRecording();
        } catch { /* ignore */ }
        setState('idle');
      }, MAX_DURATION_MS);
    } catch (err) {
      console.error('[VoiceRecorder] startRecording error:', err);
      setState('error');
      setErrorKey('voice.error_generic');
    }
  }, [clearTimers]);

  const stopRecording = useCallback(async () => {
    clearTimers();
    const duration = Date.now() - startTimeRef.current;

    if (state !== 'recording') return null;

    try {
      const result = await VoiceRecorder.stopRecording();

      if (duration < MIN_DURATION_MS) {
        setState('error');
        setErrorKey('voice.error_too_short');
        return null;
      }

      setState('processing');
      return {
        base64: result.value.recordDataBase64 || '',
        mimeType: result.value.mimeType || 'audio/aac',
      };
    } catch (err) {
      console.error('[VoiceRecorder] stopRecording error:', err);
      setState('error');
      setErrorKey('voice.error_generic');
      return null;
    }
  }, [state, clearTimers]);

  const cancelRecording = useCallback(async () => {
    clearTimers();
    setState('cancelling');

    try {
      const status = await VoiceRecorder.getCurrentStatus();
      if (status.status === 'RECORDING' || status.status === 'PAUSED') {
        await VoiceRecorder.stopRecording();
      }
    } catch { /* ignore */ }

    setState('idle');
    setElapsedMs(0);
  }, [clearTimers]);

  const setProcessing = useCallback(() => setState('processing'), []);

  const setError = useCallback((key: string) => {
    setState('error');
    setErrorKey(key);
  }, []);

  const resetToIdle = useCallback(() => {
    setState('idle');
    setElapsedMs(0);
    setErrorKey(null);
  }, []);

  return {
    state, elapsedMs, errorKey,
    startRecording, stopRecording, cancelRecording,
    setProcessing, setError, resetToIdle,
  };
}
