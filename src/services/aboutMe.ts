import type { SoulProfileAboutMe } from '../auth/providers/types';

export function computeAboutMeCompletedCount(a: SoulProfileAboutMe | undefined): number {
  if (!a) return 0;
  let n = 0;
  if (a.q1?.text?.trim()) n++;
  if (a.q2?.text?.trim()) n++;
  if (a.q3?.who?.trim() || a.q3?.distanceNow?.trim()) n++;
  if (a.q4?.sentence?.trim() || a.q4?.sameAsBefore?.trim()) n++;
  if (a.q5?.choice === 'other') {
    if (a.q5.text?.trim()) n++;
  } else if (a.q5?.choice) {
    n++;
  }
  if (a.q6?.text?.trim()) n++;
  return n;
}

/** First step index (0–5) that is not yet “filled enough”; if all six count as done, returns 0 (start at first for review). */
export function firstIncompleteAboutMeStep(a: SoulProfileAboutMe | undefined): number {
  const d = a || {};
  if (!d.q1?.text?.trim()) return 0;
  if (!d.q2?.text?.trim()) return 1;
  if (!d.q3?.who?.trim() && !d.q3?.distanceNow?.trim()) return 2;
  if (!d.q4?.sentence?.trim() && !d.q4?.sameAsBefore?.trim()) return 3;
  if (d.q5?.choice === 'other') {
    if (!d.q5.text?.trim()) return 4;
  } else if (!d.q5?.choice) {
    return 4;
  }
  if (!d.q6?.text?.trim()) return 5;
  return 0;
}

export function normalizeAboutMe(server?: SoulProfileAboutMe): SoulProfileAboutMe {
  return {
    q1: { text: server?.q1?.text ?? '' },
    q2: { text: server?.q2?.text ?? '' },
    q3: { who: server?.q3?.who ?? '', distanceNow: server?.q3?.distanceNow ?? '' },
    q4: { sentence: server?.q4?.sentence ?? '', sameAsBefore: server?.q4?.sameAsBefore ?? '' },
    q5: {
      choice: server?.q5?.choice ?? '',
      text: server?.q5?.text ?? '',
    },
    q6: { text: server?.q6?.text ?? '' },
    completedCount: server?.completedCount,
    updatedAt: server?.updatedAt,
  };
}
