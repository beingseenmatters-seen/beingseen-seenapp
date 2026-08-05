import { beforeEach, describe, expect, it } from 'vitest';
import {
  MAX_MOMENTS_INVITE_DISMISSALS,
  dismissMomentsInvitation,
  emptyInvitationState,
  hideMomentsInvitationForSession,
  loadMomentsInvitationState,
  markMomentsInvitationShown,
  momentsInvitationSessionHiddenKey,
  momentsInvitationStateKey,
  shouldShowMomentsInvitation,
  type InvitationStore,
} from './momentsInvitation';

function memoryStore(): InvitationStore & { data: Map<string, string> } {
  const data = new Map<string, string>();
  return {
    data,
    getItem: (key: string) => data.get(key) ?? null,
    setItem: (key: string, value: string) => {
      data.set(key, value);
    },
    removeItem: (key: string) => {
      data.delete(key);
    },
  };
}

describe('momentsInvitation eligibility', () => {
  const uid = 'user-1';
  let local: ReturnType<typeof memoryStore>;
  let session: ReturnType<typeof memoryStore>;

  beforeEach(() => {
    local = memoryStore();
    session = memoryStore();
  });

  it('shows for a new user with zero completed Moments', () => {
    expect(
      shouldShowMomentsInvitation({
        uid,
        completedCount: 0,
        localStore: local,
        sessionStore: session,
      }),
    ).toBe(true);
  });

  it('never shows once the user has a completed sketch', () => {
    expect(
      shouldShowMomentsInvitation({
        uid,
        completedCount: 1,
        localStore: local,
        sessionStore: session,
      }),
    ).toBe(false);
  });

  it('hides for the rest of the browser session after dismiss', () => {
    const day1 = new Date(2026, 7, 4, 10, 0, 0).getTime();
    dismissMomentsInvitation(uid, day1, local, session);

    expect(
      shouldShowMomentsInvitation({
        uid,
        completedCount: 0,
        now: day1 + 60_000,
        localStore: local,
        sessionStore: session,
      }),
    ).toBe(false);

    // Same day, but a fresh session (sessionStorage cleared) still stays hidden
    // until a later calendar day.
    const freshSession = memoryStore();
    expect(
      shouldShowMomentsInvitation({
        uid,
        completedCount: 0,
        now: day1 + 3 * 60 * 60 * 1000,
        localStore: local,
        sessionStore: freshSession,
      }),
    ).toBe(false);
  });

  it('may reappear on a later calendar day after one dismissal', () => {
    const day1 = new Date(2026, 7, 4, 10, 0, 0).getTime();
    dismissMomentsInvitation(uid, day1, local, session);

    const day2 = new Date(2026, 7, 5, 9, 0, 0).getTime();
    const nextSession = memoryStore();
    expect(
      shouldShowMomentsInvitation({
        uid,
        completedCount: 0,
        now: day2,
        localStore: local,
        sessionStore: nextSession,
      }),
    ).toBe(true);
  });

  it('permanently suppresses after MAX dismissals', () => {
    const day1 = new Date(2026, 7, 4, 10, 0, 0).getTime();
    dismissMomentsInvitation(uid, day1, local, session);

    const day2 = new Date(2026, 7, 5, 9, 0, 0).getTime();
    const session2 = memoryStore();
    dismissMomentsInvitation(uid, day2, local, session2);

    expect(loadMomentsInvitationState(uid, local).dismissalCount).toBe(
      MAX_MOMENTS_INVITE_DISMISSALS,
    );

    const day3 = new Date(2026, 7, 6, 9, 0, 0).getTime();
    const session3 = memoryStore();
    expect(
      shouldShowMomentsInvitation({
        uid,
        completedCount: 0,
        now: day3,
        localStore: local,
        sessionStore: session3,
      }),
    ).toBe(false);
  });

  it('records firstShownAt once via markMomentsInvitationShown', () => {
    const t1 = 1_700_000_000_000;
    const first = markMomentsInvitationShown(uid, t1, local);
    expect(first).toEqual({
      firstShownAt: t1,
      dismissalCount: 0,
      lastDismissedAt: null,
    });
    const second = markMomentsInvitationShown(uid, t1 + 999, local);
    expect(second.firstShownAt).toBe(t1);
  });

  it('uses uid-scoped storage keys', () => {
    expect(momentsInvitationStateKey(uid)).toContain(uid);
    expect(momentsInvitationSessionHiddenKey(uid)).toContain(uid);
    hideMomentsInvitationForSession(uid, session);
    expect(session.getItem(momentsInvitationSessionHiddenKey(uid))).toBe('1');
    expect(emptyInvitationState()).toEqual({
      firstShownAt: null,
      dismissalCount: 0,
      lastDismissedAt: null,
    });
  });
});
