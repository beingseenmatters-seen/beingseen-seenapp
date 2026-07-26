/**
 * Zodiac sign definitions for onboarding / profile UI.
 *
 * `value` is the canonical stored profile value (`basic.zodiac`) — the same
 * keys used by OptionalCards and BasicProfile since launch.
 *
 * `range` is DISPLAY METADATA ONLY (conventional date span, D/M format).
 * It must never be stored as a user-profile field, and zodiac itself must
 * never feed personality labels, Moment signals, Reflect conclusions,
 * emergent traits or match scores — product/content layer use only.
 */
export interface ZodiacSignDef {
  /** Canonical stored value — do not rename. */
  value: string;
  /** i18n key for the localized sign name (existing optional_cards keys). */
  labelKey: string;
  /** Conventional date range, display-only. */
  range: string;
}

export const ZODIAC_SIGNS: ZodiacSignDef[] = [
  { value: 'capricorn', labelKey: 'optional_cards.zodiac_capricorn', range: '22/12–19/1' },
  { value: 'aquarius', labelKey: 'optional_cards.zodiac_aquarius', range: '20/1–18/2' },
  { value: 'pisces', labelKey: 'optional_cards.zodiac_pisces', range: '19/2–20/3' },
  { value: 'aries', labelKey: 'optional_cards.zodiac_aries', range: '21/3–19/4' },
  { value: 'taurus', labelKey: 'optional_cards.zodiac_taurus', range: '20/4–20/5' },
  { value: 'gemini', labelKey: 'optional_cards.zodiac_gemini', range: '21/5–21/6' },
  { value: 'cancer', labelKey: 'optional_cards.zodiac_cancer', range: '22/6–22/7' },
  { value: 'leo', labelKey: 'optional_cards.zodiac_leo', range: '23/7–22/8' },
  { value: 'virgo', labelKey: 'optional_cards.zodiac_virgo', range: '23/8–22/9' },
  { value: 'libra', labelKey: 'optional_cards.zodiac_libra', range: '23/9–23/10' },
  { value: 'scorpio', labelKey: 'optional_cards.zodiac_scorpio', range: '24/10–22/11' },
  { value: 'sagittarius', labelKey: 'optional_cards.zodiac_sagittarius', range: '23/11–21/12' },
];
