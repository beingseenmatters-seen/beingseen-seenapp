import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendReflectWithGate } from './seenApi';
import { ResponseMode } from '../types/responseMode';

function mockFetch() {
  const fetchMock = vi.fn().mockResolvedValue({
    ok: true,
    headers: { get: () => 'application/json' },
    json: async () => ({ reply: 'ok', response_id: '1' }),
  });
  Object.defineProperty(globalThis, 'fetch', { value: fetchMock, configurable: true });
  return fetchMock;
}

function lastPayload(fetchMock: ReturnType<typeof vi.fn>) {
  return JSON.parse(fetchMock.mock.calls[0][1].body as string);
}

describe('sendReflectWithGate — canonical five-mode payloads', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it('dual-writes canonical responseMode and the legacy responseStyle field', async () => {
    const fetchMock = mockFetch();
    await sendReflectWithGate('今天想把一件事想清楚', 'zh', ResponseMode.UNTANGLE);
    const payload = lastPayload(fetchMock);
    expect(payload.responseMode).toBe('untangle');
    expect(payload.responseStyle).toBe('organizer');
  });

  it('CONNECT sends canonical responseMode with no misleading legacy value', async () => {
    const fetchMock = mockFetch();
    await sendReflectWithGate('我和伴侣吵架了', 'zh', ResponseMode.CONNECT);
    const payload = lastPayload(fetchMock);
    expect(payload.responseMode).toBe('connect');
    // The deployed backend safely falls back to mirror for missing/unknown styles.
    expect(payload.responseStyle).toBeUndefined();
  });

  it('every mapped mode produces the correct legacy responseStyle for the deployed backend', async () => {
    const cases: Array<[string, string]> = [
      [ResponseMode.REFLECT, 'mirror'],
      [ResponseMode.UNTANGLE, 'organizer'],
      [ResponseMode.EXPRESS, 'helper'],
      [ResponseMode.DISCOVER, 'guide'],
    ];
    for (const [mode, legacy] of cases) {
      const fetchMock = mockFetch();
      await sendReflectWithGate('想聊聊一件事', 'zh', mode as never);
      const payload = lastPayload(fetchMock);
      expect(payload.responseMode).toBe(mode);
      expect(payload.responseStyle).toBe(legacy);
    }
  });

  it('legacy numeric selectedMode callers still work (0 → reflect/mirror)', async () => {
    const fetchMock = mockFetch();
    await sendReflectWithGate('hello there', 'en', 0);
    const payload = lastPayload(fetchMock);
    expect(payload.responseMode).toBe('reflect');
    expect(payload.responseStyle).toBe('mirror');
  });

  it('null mode falls back safely to reflect', async () => {
    const fetchMock = mockFetch();
    await sendReflectWithGate('hello there', 'en', null);
    const payload = lastPayload(fetchMock);
    expect(payload.responseMode).toBe('reflect');
  });

  it('distress override downgrades DISCOVER to REFLECT before the request is sent', async () => {
    const fetchMock = mockFetch();
    await sendReflectWithGate('我快崩溃了，撑不住了', 'zh', ResponseMode.DISCOVER);
    const payload = lastPayload(fetchMock);
    expect(payload.responseMode).toBe('reflect');
    expect(payload.userPreferenceQuestionLevel).toBe('no_questions');
    expect(payload.clientAnalysis.isDistressed).toBe(true);
  });

  it('still sends the full conversation history regardless of keepContext', async () => {
    const fetchMock = mockFetch();
    const recentTurns = Array.from({ length: 6 }, (_, i) => ({
      role: i % 2 === 0 ? ('user' as const) : ('ai' as const),
      text: `turn-${i}`,
    }));
    await sendReflectWithGate('latest', 'en', ResponseMode.EXPRESS, recentTurns, false);
    const payload = lastPayload(fetchMock);
    expect(payload.conversationHistory).toHaveLength(6);
    expect(payload.recentTurns).toHaveLength(6);
  });
});
