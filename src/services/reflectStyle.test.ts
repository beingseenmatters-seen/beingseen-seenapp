import { describe, expect, it } from 'vitest';
import { ResponseMode } from '../types/responseMode';
import {
  resolveResponseModeForReflect,
  resolveLegacySessionResponseMode,
} from './reflectStyle';

describe('resolveResponseModeForReflect (order: session > draft > last-used > REFLECT)', () => {
  it('locked session mode wins over draft and a later last-used value', () => {
    expect(
      resolveResponseModeForReflect({
        sessionResponseMode: ResponseMode.UNTANGLE,
        draftResponseMode: ResponseMode.DISCOVER,
        lastUsedResponseMode: ResponseMode.EXPRESS,
      })
    ).toBe(ResponseMode.UNTANGLE);
  });

  it('before the first message, the draft selection wins over last-used', () => {
    expect(
      resolveResponseModeForReflect({
        sessionResponseMode: undefined,
        draftResponseMode: ResponseMode.CONNECT,
        lastUsedResponseMode: ResponseMode.EXPRESS,
      })
    ).toBe(ResponseMode.CONNECT);
  });

  it('a new conversation starts from the previous conversation\'s last-used mode', () => {
    expect(
      resolveResponseModeForReflect({
        sessionResponseMode: undefined,
        draftResponseMode: undefined,
        lastUsedResponseMode: ResponseMode.EXPRESS,
      })
    ).toBe(ResponseMode.EXPRESS);
  });

  it('falls back to REFLECT when nothing is set — Me aiPreference is not an input', () => {
    // A user whose old Me setting was e.g. helper gets REFLECT here:
    // soulProfile.aiPreference no longer controls a new conversation.
    expect(
      resolveResponseModeForReflect({
        sessionResponseMode: undefined,
        draftResponseMode: undefined,
        lastUsedResponseMode: undefined,
      })
    ).toBe(ResponseMode.REFLECT);
  });
});

describe('resolveLegacySessionResponseMode (deterministic migration for retained sessions)', () => {
  it('maps every legacy stored session style through the approved mapping', () => {
    const cases: Array<[string, string]> = [
      ['mirror', ResponseMode.REFLECT],
      ['organizer', ResponseMode.UNTANGLE],
      ['helper', ResponseMode.EXPRESS],
      ['expression_help', ResponseMode.EXPRESS],
      ['guide', ResponseMode.DISCOVER],
    ];
    for (const [legacy, canonical] of cases) {
      expect(
        resolveLegacySessionResponseMode({
          legacySessionStyle: legacy,
          legacySelectedMode: null,
          lastUsedResponseMode: undefined,
        })
      ).toBe(canonical);
    }
  });

  it('nothing legacy maps to CONNECT', () => {
    for (const legacy of ['mirror', 'organizer', 'helper', 'expression_help', 'guide']) {
      expect(
        resolveLegacySessionResponseMode({ legacySessionStyle: legacy })
      ).not.toBe(ResponseMode.CONNECT);
    }
  });

  it('falls back to the legacy numeric selected mode when the style is missing or invalid', () => {
    // Legacy index 2 was GUIDE → discover under the approved mapping.
    expect(
      resolveLegacySessionResponseMode({
        legacySessionStyle: 'bogus',
        legacySelectedMode: 2,
        lastUsedResponseMode: ResponseMode.EXPRESS,
      })
    ).toBe(ResponseMode.DISCOVER);
  });

  it('falls back to lastUsedResponseMode when no legacy fields exist', () => {
    expect(
      resolveLegacySessionResponseMode({
        legacySessionStyle: undefined,
        legacySelectedMode: null,
        lastUsedResponseMode: ResponseMode.EXPRESS,
      })
    ).toBe(ResponseMode.EXPRESS);
  });

  it('falls back to REFLECT when nothing at all is available', () => {
    expect(
      resolveLegacySessionResponseMode({
        legacySessionStyle: undefined,
        legacySelectedMode: undefined,
        lastUsedResponseMode: undefined,
      })
    ).toBe(ResponseMode.REFLECT);
  });

  it('is deterministic — same inputs always produce the same mode', () => {
    const args = { legacySessionStyle: 'x', legacySelectedMode: 1, lastUsedResponseMode: undefined };
    expect(resolveLegacySessionResponseMode(args)).toBe(resolveLegacySessionResponseMode(args));
    expect(resolveLegacySessionResponseMode(args)).toBe(ResponseMode.UNTANGLE);
  });
});
