import { afterEach, describe, expect, it, vi } from 'vitest';
import { sendReflectWithGate } from './seenApi';

const localStorageMock = {
  getItem: vi.fn(() => null),
  setItem: vi.fn(),
  removeItem: vi.fn(),
  clear: vi.fn(),
};

describe('sendReflectWithGate', () => {
  afterEach(() => {
    vi.restoreAllMocks();
    localStorageMock.getItem.mockClear();
  });

  it('always sends the full conversation history, even when keepContext is false', async () => {
    Object.defineProperty(globalThis, 'localStorage', {
      value: localStorageMock,
      configurable: true,
    });

    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ reply: 'ok', response_id: '1' }),
    });

    Object.defineProperty(globalThis, 'fetch', {
      value: fetchMock,
      configurable: true,
    });

    const recentTurns = Array.from({ length: 8 }, (_, index) => ({
      role: index % 2 === 0 ? 'user' as const : 'ai' as const,
      text: `turn-${index}`,
    }));

    await sendReflectWithGate('latest thought', 'en', 0, recentTurns, false, undefined, {
      isNewSession: false,
      action: 'continue',
    });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const payload = JSON.parse(fetchMock.mock.calls[0][1].body as string);

    expect(payload.recentTurns).toHaveLength(8);
    expect(payload.conversationHistory).toHaveLength(8);
    expect(payload.recentTurns[0].text).toBe('turn-0');
    expect(payload.recentTurns[7].text).toBe('turn-7');
  });
});
