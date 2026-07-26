/**
 * Phase 2C — turn-level response-mode pipeline tests.
 *
 * The request pipeline is turn-scoped: every call to sendReflectWithGate
 * snapshots one requested mode, runs the question gate/distress override for
 * that turn only, and reports both the requested and the effective mode back
 * to the caller so they can be stored with the turn.
 */
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

function payloadAt(fetchMock: ReturnType<typeof vi.fn>, index: number) {
  return JSON.parse(fetchMock.mock.calls[index][1].body as string);
}

afterEach(() => {
  vi.restoreAllMocks();
});

describe('per-turn requested/effective mode metadata', () => {
  it('returns requestedMode === effectiveMode when no override applies', async () => {
    mockFetch();
    const res = await sendReflectWithGate('想把最近的事想清楚', 'zh', ResponseMode.UNTANGLE);
    expect(res.requestedMode).toBe('untangle');
    expect(res.effectiveMode).toBe('untangle');
  });

  it('distress override yields a distinct effective mode (DISCOVER → REFLECT)', async () => {
    const fetchMock = mockFetch();
    const res = await sendReflectWithGate('我快崩溃了，撑不住了', 'zh', ResponseMode.DISCOVER);
    expect(res.requestedMode).toBe('discover');
    expect(res.effectiveMode).toBe('reflect');
    // The backend receives the effective mode for this turn.
    expect(payloadAt(fetchMock, 0).responseMode).toBe('reflect');
  });

  it('distress with a non-DISCOVER mode keeps the mode but the gate still applies', async () => {
    const fetchMock = mockFetch();
    const res = await sendReflectWithGate('我快崩溃了，撑不住了', 'zh', ResponseMode.EXPRESS);
    expect(res.requestedMode).toBe('express');
    expect(res.effectiveMode).toBe('express');
    expect(payloadAt(fetchMock, 0).userPreferenceQuestionLevel).toBe('no_questions');
  });
});

describe('mode is resolved per turn, never cached across turns', () => {
  it('consecutive turns with different modes send different payloads', async () => {
    const fetchMock = mockFetch();
    await sendReflectWithGate('第一句话', 'zh', ResponseMode.REFLECT, [], true, 's1');
    await sendReflectWithGate(
      '第二句话',
      'zh',
      ResponseMode.UNTANGLE,
      [
        { role: 'user', text: '第一句话' },
        { role: 'ai', text: '嗯，我听见了。' },
      ],
      true,
      's1'
    );
    expect(payloadAt(fetchMock, 0).responseMode).toBe('reflect');
    expect(payloadAt(fetchMock, 1).responseMode).toBe('untangle');
    // Same session id — switching mode continues the conversation, it never
    // forks a new one.
    expect(payloadAt(fetchMock, 0).sessionId).toBe('s1');
    expect(payloadAt(fetchMock, 1).sessionId).toBe('s1');
  });

  it("the question gate runs against each turn's requested mode", async () => {
    const fetchMock = mockFetch();
    await sendReflectWithGate('随便聊聊近况', 'zh', ResponseMode.REFLECT, [], true, 's1');
    await sendReflectWithGate('随便聊聊近况', 'zh', ResponseMode.UNTANGLE, [], true, 's1');
    const first = payloadAt(fetchMock, 0);
    const second = payloadAt(fetchMock, 1);
    // REFLECT is zero-question by policy; UNTANGLE allows one clarifying
    // question — the levels must differ because the gate re-ran per turn.
    expect(first.userPreferenceQuestionLevel).toBe('no_questions');
    expect(second.userPreferenceQuestionLevel).not.toBe('no_questions');
  });

  it('turn-level switching keeps the legacy dual-write contract per turn', async () => {
    const fetchMock = mockFetch();
    await sendReflectWithGate('hello', 'en', ResponseMode.EXPRESS, [], true, 's1');
    await sendReflectWithGate('hello again', 'en', ResponseMode.CONNECT, [], true, 's1');
    expect(payloadAt(fetchMock, 0).responseStyle).toBe('helper');
    expect(payloadAt(fetchMock, 1).responseStyle).toBeUndefined();
  });
});
