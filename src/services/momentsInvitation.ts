/**
 * Moments invitation — lightweight product-discovery UI state.
 *
 * NOT Human Understanding evidence. Never written to soulProfile, Moment
 * evidence, Current Understanding, or matching data.
 *
 * Display policy (restrained, documented):
 * 1. Never show if the user already has a completed Moments sketch
 *    (`completedCount > 0`).
 * 2. Never show after `MAX_DISMISSALS` (2) “Maybe later” taps.
 * 3. After dismiss, hide for the rest of the browser session
 *    (`sessionStorage`).
 * 4. After the first dismissal, may reappear on a later app visit only if
 *    `lastDismissedAt` is on a previous local calendar day (not the same day).
 * 5. Reflect kept-understandings history is intentionally ignored — Moments
 *    and Reflect stay independent channels.
 */

export interface MomentsInvitationState {
  firstShownAt: number | null;
  dismissalCount: number;
  lastDismissedAt: number | null;
}

export interface InvitationStore {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** Max “Maybe later” taps before the invitation is permanently suppressed. */
export const MAX_MOMENTS_INVITE_DISMISSALS = 2;

const STATE_PREFIX = 'seen_moments_invite_v1_';
const SESSION_HIDDEN_PREFIX = 'seen_moments_invite_session_hidden_v1_';

function defaultLocalStore(): InvitationStore | null {
  try {
    if (typeof localStorage === 'undefined') return null;
    return localStorage;
  } catch {
    return null;
  }
}

function defaultSessionStore(): InvitationStore | null {
  try {
    if (typeof sessionStorage === 'undefined') return null;
    return sessionStorage;
  } catch {
    return null;
  }
}

export function momentsInvitationStateKey(uid: string): string {
  return `${STATE_PREFIX}${uid}`;
}

export function momentsInvitationSessionHiddenKey(uid: string): string {
  return `${SESSION_HIDDEN_PREFIX}${uid}`;
}

export function emptyInvitationState(): MomentsInvitationState {
  return { firstShownAt: null, dismissalCount: 0, lastDismissedAt: null };
}

export function loadMomentsInvitationState(
  uid: string | null | undefined,
  store: InvitationStore | null = defaultLocalStore(),
): MomentsInvitationState {
  if (!uid || !store) return emptyInvitationState();
  try {
    const raw = store.getItem(momentsInvitationStateKey(uid));
    if (!raw) return emptyInvitationState();
    const parsed = JSON.parse(raw) as Partial<MomentsInvitationState>;
    return {
      firstShownAt: typeof parsed.firstShownAt === 'number' ? parsed.firstShownAt : null,
      dismissalCount:
        typeof parsed.dismissalCount === 'number' && parsed.dismissalCount >= 0
          ? Math.floor(parsed.dismissalCount)
          : 0,
      lastDismissedAt:
        typeof parsed.lastDismissedAt === 'number' ? parsed.lastDismissedAt : null,
    };
  } catch {
    return emptyInvitationState();
  }
}

export function saveMomentsInvitationState(
  uid: string,
  state: MomentsInvitationState,
  store: InvitationStore | null = defaultLocalStore(),
): void {
  if (!store) return;
  try {
    store.setItem(momentsInvitationStateKey(uid), JSON.stringify(state));
  } catch {
    // ignore quota / private mode
  }
}

function isHiddenThisSession(
  uid: string,
  sessionStore: InvitationStore | null = defaultSessionStore(),
): boolean {
  if (!sessionStore) return false;
  try {
    return sessionStore.getItem(momentsInvitationSessionHiddenKey(uid)) === '1';
  } catch {
    return false;
  }
}

export function hideMomentsInvitationForSession(
  uid: string,
  sessionStore: InvitationStore | null = defaultSessionStore(),
): void {
  if (!sessionStore) return;
  try {
    sessionStore.setItem(momentsInvitationSessionHiddenKey(uid), '1');
  } catch {
    // ignore
  }
}

function sameLocalCalendarDay(a: number, b: number): boolean {
  const da = new Date(a);
  const db = new Date(b);
  return (
    da.getFullYear() === db.getFullYear() &&
    da.getMonth() === db.getMonth() &&
    da.getDate() === db.getDate()
  );
}

export interface ShouldShowMomentsInvitationInput {
  uid: string | null | undefined;
  /** From Moments overview — sketches completed. */
  completedCount: number;
  now?: number;
  localStore?: InvitationStore | null;
  sessionStore?: InvitationStore | null;
}

/**
 * Pure eligibility check. Caller must already ensure onboarding is complete
 * (invitation is only mounted on the main app surface).
 */
export function shouldShowMomentsInvitation(
  input: ShouldShowMomentsInvitationInput,
): boolean {
  const { uid, completedCount } = input;
  if (!uid) return false;
  if (completedCount > 0) return false;

  const now = input.now ?? Date.now();
  const localStore = input.localStore === undefined ? defaultLocalStore() : input.localStore;
  const sessionStore =
    input.sessionStore === undefined ? defaultSessionStore() : input.sessionStore;

  if (isHiddenThisSession(uid, sessionStore)) return false;

  const state = loadMomentsInvitationState(uid, localStore);
  if (state.dismissalCount >= MAX_MOMENTS_INVITE_DISMISSALS) return false;

  if (state.dismissalCount === 0) return true;

  // After ≥1 dismissal: only on a later calendar day.
  if (state.lastDismissedAt == null) return true;
  return !sameLocalCalendarDay(state.lastDismissedAt, now);
}

/** Record first display (idempotent). */
export function markMomentsInvitationShown(
  uid: string,
  now: number = Date.now(),
  store: InvitationStore | null = defaultLocalStore(),
): MomentsInvitationState {
  const prev = loadMomentsInvitationState(uid, store);
  if (prev.firstShownAt != null) return prev;
  const next = { ...prev, firstShownAt: now };
  saveMomentsInvitationState(uid, next, store);
  return next;
}

/** “Maybe later” — durable dismiss + hide for this browser session. */
export function dismissMomentsInvitation(
  uid: string,
  now: number = Date.now(),
  localStore: InvitationStore | null = defaultLocalStore(),
  sessionStore: InvitationStore | null = defaultSessionStore(),
): MomentsInvitationState {
  const prev = loadMomentsInvitationState(uid, localStore);
  const next: MomentsInvitationState = {
    firstShownAt: prev.firstShownAt ?? now,
    dismissalCount: prev.dismissalCount + 1,
    lastDismissedAt: now,
  };
  saveMomentsInvitationState(uid, next, localStore);
  hideMomentsInvitationForSession(uid, sessionStore);
  return next;
}
