/**
 * Onboarding demographics — founder decision: nickname, age range, gender and
 * zodiac are all required; onboarding shows only male/female gender values;
 * zodiac renders as a 12-sign card grid with display-only date ranges.
 *
 * The project has no DOM test environment (no jsdom/testing-library), so the
 * zodiac data contract is tested directly and the component/routing wiring is
 * pinned with source-level assertions, matching the established pattern
 * (reflectRestoreWiring, reflectTurnModeWiring).
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ZODIAC_SIGNS } from '../data/zodiac';

const onboardingSource = readFileSync(resolve(__dirname, './Onboarding.tsx'), 'utf-8');
const appSource = readFileSync(resolve(__dirname, '../App.tsx'), 'utf-8');

/** Strip comments so data-boundary checks only see executable code. */
function stripComments(source: string): string {
  return source
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/^\s*\/\/.*$/gm, '')
    .replace(/([^:'"])\/\/[^\n'"`]*$/gm, '$1');
}

function readStripped(relPath: string): string {
  return stripComments(readFileSync(resolve(__dirname, relPath), 'utf-8'));
}

// ============================================================
// Required fields
// ============================================================

describe('all four demographics are required', () => {
  it('completion requires nickname, age range, gender and zodiac — nothing else', () => {
    expect(onboardingSource).toContain(
      "const demographicsComplete = Boolean(nickname.trim() && ageRange && gender && zodiac);"
    );
  });

  it('the 进入 Seen action stays disabled until the required fields are valid', () => {
    expect(onboardingSource).toContain('disabled={!demographicsComplete || saving}');
    expect(onboardingSource).toContain('if (!demographicsComplete || saving) return;');
    expect(onboardingSource).toContain("t('onboarding.enter_seen')");
  });
});

describe('current state and interests are removed from onboarding only', () => {
  // Legacy fields are still mentioned in developer comments (the product
  // philosophy note), so executable-code checks use the stripped source.
  const strippedOnboarding = stripComments(onboardingSource);

  it('current state no longer renders', () => {
    expect(strippedOnboarding).not.toContain('current_state');
    expect(strippedOnboarding).not.toContain('CURRENT_STATE_OPTIONS');
    expect(strippedOnboarding).not.toContain('currentState');
  });

  it('interests no longer render (no chips, no multi-select)', () => {
    expect(strippedOnboarding).not.toContain('interests_title');
    expect(strippedOnboarding).not.toContain('INTEREST_SLUGS');
    expect(strippedOnboarding).not.toContain('toggleInterest');
    expect(strippedOnboarding).not.toContain('interest_opt');
    expect(strippedOnboarding).not.toMatch(/\binterests\b/);
  });

  it('onboarding never writes currentState or interests — no [], null or "" replacement', () => {
    // The save payload spreads existing basic (preserving legacy values for
    // existing users) and writes only the four collected fields.
    expect(onboardingSource).toContain('...(seenUser?.basic || {})');
    expect(strippedOnboarding).not.toMatch(/currentState\s*[,:]/);
    expect(strippedOnboarding).not.toMatch(/interests\s*[,:]/);
  });

  it('the legacy schema fields and localization keys are untouched', () => {
    const types = readFileSync(resolve(__dirname, '../auth/providers/types.ts'), 'utf-8');
    expect(types).toContain('currentState');
    expect(types).toContain('interests');
    const zh = JSON.parse(readFileSync(resolve(__dirname, '../i18n/zh.json'), 'utf-8'));
    expect(zh.onboarding.current_state).toBeTruthy();
    expect(zh.onboarding.interests_title).toBeTruthy();
    expect(zh.onboarding.state_connection).toBeTruthy();
  });

  it('the page contains only the four fields plus the primary action', () => {
    const sectionLabels = onboardingSource.match(/t\('onboarding\.(nickname|age_range|gender|zodiac|current_state|interests_title)'\)/g) ?? [];
    expect(sectionLabels).toEqual([
      "t('onboarding.nickname')",
      "t('onboarding.age_range')",
      "t('onboarding.gender')",
      "t('onboarding.zodiac')",
      "t('onboarding.zodiac')", // radiogroup aria-label reuses the field label
    ]);
  });
});

describe('single-step first login', () => {
  it('the old understanding-sliders and AI-role steps are gone', () => {
    expect(onboardingSource).not.toContain('understandingStyle');
    expect(onboardingSource).not.toContain('AI_STYLE_OPTIONS');
    expect(onboardingSource).not.toContain('responseStyle');
    expect(onboardingSource).not.toContain('UNDERSTANDING_SLIDER_CARD_DEFS');
  });

  it('onboarding no longer writes a fixed AI role preference', () => {
    // Response modes are per-turn tool choices inside Reflect, never a fixed
    // identity captured at first login.
    expect(onboardingSource).not.toContain('aiPreference');
  });

  it('完成 saves the profile and marks onboarding completed in one step', () => {
    expect(onboardingSource).toContain('onboardingStarted: true');
    expect(onboardingSource).toContain('onboardingCompleted: true');
  });

  it('Me exposes the Current Understanding letter, not the old slider questionnaire', () => {
    expect(appSource).toContain("path=\"/me/current-understanding\"");
    // The standalone 我的理解方式 questionnaire page was removed to avoid
    // confusion with the letter; its slider cards live only in onboarding now.
    expect(appSource).not.toContain("path=\"/me/understanding\"");
  });
});

// ============================================================
// Gender: only male and female render in onboarding
// ============================================================

describe('onboarding gender choices', () => {
  it('renders only male and female (existing stored schema values)', () => {
    const optionsBlock = onboardingSource.slice(
      onboardingSource.indexOf('const GENDER_OPTIONS'),
      onboardingSource.indexOf('] as const;', onboardingSource.indexOf('const GENDER_OPTIONS'))
    );
    expect(optionsBlock).toContain("value: 'female'");
    expect(optionsBlock).toContain("value: 'male'");
    expect(optionsBlock).not.toContain('non_binary');
    expect(optionsBlock).not.toContain('prefer_not');
  });

  it('renders no gender skip action and no optional hint', () => {
    expect(onboardingSource).not.toContain('gender_optional_hint');
    expect(onboardingSource).not.toContain('gender_non_binary');
    expect(onboardingSource).not.toContain('gender_prefer_not');
    // Selecting no longer toggles off — the field is required.
    expect(onboardingSource).not.toContain("setGender((g) => (g === value ? '' : value))");
  });
});

// ============================================================
// Zodiac data contract
// ============================================================

describe('zodiac signs and date ranges', () => {
  it('defines exactly the 12 canonical stored values', () => {
    expect(ZODIAC_SIGNS).toHaveLength(12);
    expect(ZODIAC_SIGNS.map((s) => s.value).sort()).toEqual(
      [
        'aquarius', 'aries', 'cancer', 'capricorn', 'gemini', 'leo',
        'libra', 'pisces', 'sagittarius', 'scorpio', 'taurus', 'virgo',
      ]
    );
  });

  it('every sign carries the approved conventional date range', () => {
    const expected: Record<string, string> = {
      capricorn: '22/12–19/1',
      aquarius: '20/1–18/2',
      pisces: '19/2–20/3',
      aries: '21/3–19/4',
      taurus: '20/4–20/5',
      gemini: '21/5–21/6',
      cancer: '22/6–22/7',
      leo: '23/7–22/8',
      virgo: '23/8–22/9',
      libra: '23/9–23/10',
      scorpio: '24/10–22/11',
      sagittarius: '23/11–21/12',
    };
    for (const sign of ZODIAC_SIGNS) {
      expect(sign.range).toBe(expected[sign.value]);
    }
  });

  it('every sign uses an existing localized name key', () => {
    const zh = JSON.parse(
      readFileSync(resolve(__dirname, '../i18n/zh.json'), 'utf-8')
    );
    const en = JSON.parse(
      readFileSync(resolve(__dirname, '../i18n/en.json'), 'utf-8')
    );
    for (const sign of ZODIAC_SIGNS) {
      expect(sign.labelKey).toBe(`optional_cards.zodiac_${sign.value}`);
      expect(zh.optional_cards[`zodiac_${sign.value}`]).toBeTruthy();
      expect(en.optional_cards[`zodiac_${sign.value}`]).toBeTruthy();
    }
  });
});

// ============================================================
// Zodiac rendering
// ============================================================

describe('zodiac card grid rendering', () => {
  it('renders all 12 signs as cards from ZODIAC_SIGNS', () => {
    expect(onboardingSource).toContain('ZODIAC_SIGNS.map(({ value, labelKey, range })');
  });

  it('each card shows the localized name with the date range beneath it', () => {
    expect(onboardingSource).toContain('{t(labelKey)}');
    expect(onboardingSource).toContain('{range}');
  });

  it('uses a responsive card grid (2 cols mobile, 3/4 wider), not a select', () => {
    expect(onboardingSource).toContain('grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4');
    const zodiacSection = onboardingSource.slice(
      onboardingSource.indexOf("t('onboarding.zodiac')"),
      onboardingSource.indexOf("t('onboarding.enter_seen')")
    );
    expect(zodiacSection).not.toContain('<select');
  });

  it('stores only the canonical sign value; the range is never persisted', () => {
    // The save payload writes `zodiac` (canonical value state) as-is …
    expect(onboardingSource).toMatch(/zodiac,\s*\n\s*\},/);
    // … and no range/date field is ever written to the profile.
    expect(onboardingSource).not.toMatch(/zodiacRange|zodiac_range|dateRange|range:\s*range/);
  });
});

// ============================================================
// Existing users are not re-onboarded
// ============================================================

describe('existing users', () => {
  it('the routing gate checks only onboardingCompleted — no demographic migration gate', () => {
    expect(appSource).toContain('const isOnboarded = !!seenUser?.onboardingCompleted;');
    const stripped = stripComments(appSource);
    expect(stripped).not.toContain('zodiac');
    expect(stripped).not.toMatch(/\bgender\b/);
  });

  it('missing fields stay completable through Basic Profile', () => {
    const basicProfile = readFileSync(
      resolve(__dirname, './settings/BasicProfile.tsx'),
      'utf-8'
    );
    expect(basicProfile).toContain('setGender');
    expect(basicProfile).toContain('setZodiac');
  });
});

// ============================================================
// Data-usage boundaries
// ============================================================

describe('demographics never become personality evidence', () => {
  it('gender does not imply partner gender anywhere in src', () => {
    // No partner-gender derivation exists; matching and connections read no
    // gender at all.
    expect(readStripped('../services/matching/getProfileWeight.ts')).not.toMatch(/\bgender\b|\bzodiac\b/);
    expect(readStripped('../services/matching/matchReason.ts')).not.toMatch(/\bgender\b|\bzodiac\b/);
    expect(readStripped('../services/connections.ts')).not.toMatch(/\bgender\b|\bzodiac\b/);
    expect(onboardingSource).not.toMatch(/partnerGender|preferredGender|partner_gender/);
  });

  it('zodiac does not enter Moment signals or the sketch engine', () => {
    expect(readStripped('../data/moments/signals.ts')).not.toMatch(/\bzodiac\b/i);
    expect(readStripped('../data/moments/library.ts')).not.toMatch(/\bzodiac\b/i);
    expect(readStripped('../services/moments/sketchEngine.ts')).not.toMatch(/\bzodiac\b/i);
  });

  it('zodiac and gender do not enter Reflect requests or trait extraction', () => {
    expect(readStripped('../services/seenApi.ts')).not.toMatch(/\bzodiac\b|\bgender\b/);
    expect(readStripped('../services/userSummary.ts')).not.toMatch(/\bzodiac\b|\bgender\b/);
    expect(readStripped('../services/questionGate.ts')).not.toMatch(/\bzodiac\b|\bgender\b/);
  });

  it('backend Reflect prompts contain no demographic injection', () => {
    const reflectModes = readFileSync(
      resolve(__dirname, '../../lambda/reflectModes.mjs'),
      'utf-8'
    );
    expect(stripComments(reflectModes)).not.toMatch(/\bzodiac\b|\bgender\b|\bageRange\b/);
  });
});
