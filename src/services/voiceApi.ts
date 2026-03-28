import { API_BASE_URL, API_KEY } from '../config/api';

interface TranscribeResult {
  text: string;
}

/**
 * Upload base64 audio to backend for Whisper transcription.
 * Returns the transcribed text or throws on failure.
 */
export async function transcribeAudio(
  base64Audio: string,
  mimeType: string,
  language: string
): Promise<TranscribeResult> {
  const url = `${API_BASE_URL}/voice/transcribe`;

  const response = await fetch(url, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'X-Seen-App-Key': API_KEY,
    },
    body: JSON.stringify({
      audio: base64Audio,
      mimeType,
      language,
    }),
  });

  if (!response.ok) {
    const errText = await response.text().catch(() => '');
    throw new Error(`Transcription failed: ${response.status} ${errText}`);
  }

  const data = await response.json();
  return { text: data.text || '' };
}
