import { describe, expect, it } from 'vitest';
import { ResponseStyle } from '../types/responseStyle';
import {
  resolveResponseModeForReflect,
  resolveLegacySessionResponseMode,
} from './reflectStyle';

describe('resolveResponseModeForReflect (Phase 1 order: session > draft > last-used > MIRROR)', () => {
  it('locked session mode wins over draft and a later last-used value', () => {
    expect(
      resolveResponseModeForReflect({
        sessionResponseMode: ResponseStyle.ORGANIZER,
        draftResponseMode: ResponseStyle.GUIDE,
        lastUsedResponseMode: ResponseStyle.EXPRESSION_HELP,
      })
    ).toBe(ResponseStyle.ORGANIZER);
  });

  it('before the first message, the draft selection wins over last-used', () => {
    expect(
      resolveResponseModeForReflect({
        sessionResponseMode: undefined,
        draftResponseMode: ResponseStyle.GUIDE,
        lastUsedResponseMode: ResponseStyle.EXPRESSION_HELP,
      })
    ).toBe(ResponseStyle.GUIDE);
  });

  it('a new conversation starts from the previous conversation\'s last-used mode', () => {
    expect(
      resolveResponseModeForReflect({
        sessionResponseMode: undefined,
        draftResponseMode: undefined,
        lastUsedResponseMode: ResponseStyle.EXPRESSION_HELP,
      })
    ).toBe(ResponseStyle.EXPRESSION_HELP);
  });

  it('falls back to MIRROR when nothing is set — Me aiPreference is not an input', () => {
    // A user whose old Me setting was e.g. EXPRESSION_HELP gets MIRROR here:
    // soulProfile.aiPreference no longer controls a new conversation.
    expect(
      resolveResponseModeForReflect({
        sessionResponseMode: undefined,
        draftResponseMode: undefined,
        lastUsedResponseMode: undefined,
      })
    ).toBe(ResponseStyle.MIRROR);
  });
});

describe('resolveLegacySessionResponseMode (deterministic migration for retained sessions)', () => {
  it('prefers a valid legacy stored session style', () => {
    expect(
      resolveLegacySessionResponseMode({
        legacySessionStyle: ResponseStyle.ORGANIZER,
        legacySelectedMode: 2,
        lastUsedResponseMode: ResponseStyle.EXPRESSION_HELP,
      })
    ).toBe(ResponseStyle.ORGANIZER);
  });

  it('falls back to the legacy numeric selected mode when the style is missing or invalid', () => {
    expect(
      resolveLegacySessionResponseMode({
        legacySessionStyle: 'bogus',
        legacySelectedMode: 2,
        lastUsedResponseMode: ResponseStyle.EXPRESSION_HELP,
      })
    ).toBe(ResponseStyle.GUIDE);
  });

  it('falls back to lastUsedResponseMode when no legacy fields exist', () => {
    expect(
      resolveLegacySessionResponseMode({
        legacySessionStyle: undefined,
        legacySelectedMode: null,
        lastUsedResponseMode: ResponseStyle.EXPRESSION_HELP,
      })
    ).toBe(ResponseStyle.EXPRESSION_HELP);
  });

  it('falls back to MIRROR when nothing at all is available', () => {
    expect(
      resolveLegacySessionResponseMode({
        legacySessionStyle: undefined,
        legacySelectedMode: undefined,
        lastUsedResponseMode: undefined,
      })
    ).toBe(ResponseStyle.MIRROR);
  });

  it('is deterministic — same inputs always produce the same mode', () => {
    const args = { legacySessionStyle: 'x', legacySelectedMode: 1, lastUsedResponseMode: undefined };
    expect(resolveLegacySessionResponseMode(args)).toBe(resolveLegacySessionResponseMode(args));
    expect(resolveLegacySessionResponseMode(args)).toBe(ResponseStyle.ORGANIZER);
  });
});
