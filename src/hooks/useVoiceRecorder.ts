import { useState, useRef, useCallback, useEffect } from 'react';
import { VoiceRecorder } from '@independo/capacitor-voice-recorder';
import { isNative } from '../auth/platform';

export type VoiceState = 'idle' | 'recording' | 'cancelling' | 'processing' | 'error';

const MAX_DURATION_MS = 60_000;
const MIN_DURATION_MS = 1_000;

interface UseVoiceRecorderReturn {
  state: VoiceState;
  elapsedMs: number;
  errorKey: string | null;
  debugMsg: string | null;
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
  const [debugMsg, setDebugMsg] = useState<string | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const startTimeRef = useRef<number>(0);
  const maxTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  const clearTimers = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (maxTimerRef.current) { clearTimeout(maxTimerRef.current); maxTimerRef.current = null; }
  }, []);

  useEffect(() => clearTimers, [clearTimers]);

  const startRecording = useCallback(async () => {
    setState('processing');
    setDebugMsg('startRecording called');

    if (!isNative()) {
      setDebugMsg('SKIP: isNative() = false');
      setState('error');
      setErrorKey('voice.error_generic');
      return;
    }

    setErrorKey(null);
    setDebugMsg('checking permission...');

    try {
      let permGranted = false;
      try {
        const perm = await VoiceRecorder.hasAudioRecordingPermission();
        permGranted = perm.value;
        setDebugMsg(`hasPermission: ${perm.value}`);
      } catch (permErr: any) {
        setDebugMsg(`hasPermission error: ${permErr?.message || permErr}, requesting...`);
      }

      if (!permGranted) {
        setDebugMsg('requesting permission...');
        try {
          const req = await VoiceRecorder.requestAudioRecordingPermission();
          setDebugMsg(`requestPermission result: ${req.value}`);
          if (!req.value) {
            setState('error');
            setErrorKey('voice.error_permission');
            return;
          }
        } catch (reqErr: any) {
          setDebugMsg(`requestPermission error: ${reqErr?.message || reqErr}`);
          setState('error');
          setErrorKey('voice.error_permission');
          return;
        }
      }

      setDebugMsg('calling VoiceRecorder.startRecording()...');
      await VoiceRecorder.startRecording();
      setDebugMsg('recording started!');
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
    } catch (err: any) {
      console.error('[VoiceRecorder] startRecording error:', err);
      setDebugMsg(`startRecording error: ${err?.message || err?.code || JSON.stringify(err)}`);
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
    } catch (err: any) {
      console.error('[VoiceRecorder] stopRecording error:', err);
      setDebugMsg(`stopRecording error: ${err?.message || err}`);
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
    setDebugMsg(null);
  }, []);

  return {
    state, elapsedMs, errorKey, debugMsg,
    startRecording, stopRecording, cancelRecording,
    setProcessing, setError, resetToIdle,
  };
}
