/**
 * Mirrors `lambda/index.mjs` match helpers (getProfileWeight + me similarity).
 * Used for reference/tests; production scoring runs in Lambda `/match/rank`.
 */

export type ProfileStage = 'cold_start' | 'early' | 'stable' | 'deep';

export function getProfileWeight(reflectCount: number): {
  stage: ProfileStage;
  me: number;
  soul: number;
} {
  if (reflectCount <= 2) {
    return { stage: 'cold_start', me: 0.7, soul: 0.3 };
  } else if (reflectCount <= 5) {
    return { stage: 'early', me: 0.55, soul: 0.45 };
  } else if (reflectCount <= 10) {
    return { stage: 'stable', me: 0.4, soul: 0.6 };
  } else {
    return { stage: 'deep', me: 0.3, soul: 0.7 };
  }
}

export const UNDERSTANDING_SLIDER_KEYS = [
  'value_orientation',
  'self_vs_relationship',
  'conflict_handling',
  'life_pace',
  'connection_depth',
  'money_view',
  'expression_style',
] as const;

export const AGE_RANGES = [
  "18-24",
  "25-34",
  "35-44",
  "45-54",
  "55-64",
  "65+"
] as const;

export const ABOUT_ME_SIGNALS_KEYS = [
  'valueTags',
  'regretThemes',
  'aspirationThemes',
  'selfNarrativeTags',
  'copingStyleTags',
  'resonanceTags',
  'emotionalNeeds'
] as const;

const ME_STRUCTURED_WEIGHT = 0.28;
const ME_UNDERSTANDING_WEIGHT = 0.32;
const ME_CONTEXT_WEIGHT = 0.15;
const ME_ABOUT_ME_SIGNALS_WEIGHT = 0.25;

// Simple Jaccard similarity for arrays of strings (mirrors Lambda)
function calculateArraySimilarity(arr1: unknown, arr2: unknown): number {
  if (!arr1 || !arr2 || !Array.isArray(arr1) || !Array.isArray(arr2) || arr1.length === 0 || arr2.length === 0) return 0;
  const set1 = new Set(arr1);
  const set2 = new Set(arr2);
  const intersection = new Set([...set1].filter((x) => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return intersection.size / union.size;
}

/** `basic` structured fields: interests, values, lifeStage, goals, communicationPreference */
export function calculateMeStructuredSimilarity(me1: any, me2: any): { score: number; hasData: boolean } {
  if (!me1 || !me2) return { score: 0, hasData: false };

  let totalScore = 0;
  let totalWeight = 0;

  if (Array.isArray(me1.interests) && Array.isArray(me2.interests) && me1.interests.length > 0 && me2.interests.length > 0) {
    const sim = calculateArraySimilarity(me1.interests, me2.interests);
    totalScore += sim * 0.3;
    totalWeight += 0.3;
  }

  if (Array.isArray(me1.values) && Array.isArray(me2.values) && me1.values.length > 0 && me2.values.length > 0) {
    const sim = calculateArraySimilarity(me1.values, me2.values);
    totalScore += sim * 0.25;
    totalWeight += 0.25;
  }

  if (me1.lifeStage && me2.lifeStage) {
    const sim = me1.lifeStage === me2.lifeStage ? 1 : 0;
    totalScore += sim * 0.2;
    totalWeight += 0.2;
  }

  if (Array.isArray(me1.goals) && Array.isArray(me2.goals) && me1.goals.length > 0 && me2.goals.length > 0) {
    const sim = calculateArraySimilarity(me1.goals, me2.goals);
    totalScore += sim * 0.15;
    totalWeight += 0.15;
  }

  if (me1.communicationPreference && me2.communicationPreference) {
    const sim = me1.communicationPreference === me2.communicationPreference ? 1 : 0;
    totalScore += sim * 0.1;
    totalWeight += 0.1;
  }

  const hasData = totalWeight > 0;
  const score = hasData ? totalScore / totalWeight : 0;
  return { score, hasData };
}

/** `soulProfile.understanding` sliders 0–100 */
export function calculateUnderstandingSimilarity(
  understanding1: Record<string, unknown> = {},
  understanding2: Record<string, unknown> = {},
): { score: number; hasData: boolean } {
  let total = 0;
  let count = 0;
  for (const key of UNDERSTANDING_SLIDER_KEYS) {
    const a = understanding1[key];
    const b = understanding2[key];
    if (typeof a === 'number' && typeof b === 'number' && !Number.isNaN(a) && !Number.isNaN(b)) {
      total += 1 - Math.abs(a - b) / 100;
      count += 1;
    }
  }
  const hasData = count > 0;
  const score = hasData ? total / count : 0;
  return { score, hasData };
}

export function calculateBasicContextSimilarity(basic1: any = {}, basic2: any = {}): { score: number; hasData: boolean } {
  let totalScore = 0;
  let totalWeight = 0;

  // 1. currentState (exact match)
  if (basic1.currentState && basic2.currentState) {
    totalScore += basic1.currentState === basic2.currentState ? 1 : 0;
    totalWeight += 1;
  }

  // 2. age (range proximity)
  if (basic1.age && basic2.age) {
    const idx1 = AGE_RANGES.indexOf(basic1.age as any);
    const idx2 = AGE_RANGES.indexOf(basic2.age as any);
    if (idx1 !== -1 && idx2 !== -1) {
      const diff = Math.abs(idx1 - idx2);
      if (diff === 0) totalScore += 1;
      else if (diff === 1) totalScore += 0.6;
      totalWeight += 1;
    } else if (basic1.age === basic2.age) {
      totalScore += 1;
      totalWeight += 1;
    }
  }

  // 3. location (loose text match)
  if (basic1.location && basic2.location) {
    const loc1 = String(basic1.location).toLowerCase().trim();
    const loc2 = String(basic2.location).toLowerCase().trim();
    if (loc1 === loc2) {
      totalScore += 1;
    } else if (loc1.includes(loc2) || loc2.includes(loc1)) {
      totalScore += 0.7;
    }
    totalWeight += 1;
  }

  // 4. gender (exact match, ignore prefer_not)
  if (basic1.gender && basic2.gender && 
      !String(basic1.gender).includes('prefer_not') && 
      !String(basic2.gender).includes('prefer_not')) {
    totalScore += basic1.gender === basic2.gender ? 1 : 0;
    totalWeight += 1;
  }

  // 5. zodiac (exact match)
  if (basic1.zodiac && basic2.zodiac) {
    totalScore += basic1.zodiac === basic2.zodiac ? 1 : 0;
    totalWeight += 1;
  }

  const hasData = totalWeight > 0;
  const score = hasData ? totalScore / totalWeight : 0;
  return { score, hasData };
}

export function calculateAboutMeSignalsSimilarity(signals1: any = {}, signals2: any = {}): { score: number; hasData: boolean } {
  let totalScore = 0;
  let totalWeight = 0;

  for (const key of ABOUT_ME_SIGNALS_KEYS) {
    const arr1 = signals1[key];
    const arr2 = signals2[key];
    if (Array.isArray(arr1) && Array.isArray(arr2) && arr1.length > 0 && arr2.length > 0) {
      totalScore += calculateArraySimilarity(arr1, arr2);
      totalWeight += 1;
    }
  }

  const hasData = totalWeight > 0;
  const score = hasData ? totalScore / totalWeight : 0;
  return { score, hasData };
}

export function combineMeSimilarity(
  structuredResult: { score: number; hasData: boolean },
  understandingResult: { score: number; hasData: boolean },
  contextResult?: { score: number; hasData: boolean },
  aboutMeSignalsResult?: { score: number; hasData: boolean },
): number {
  const { score: s, hasData: hs } = structuredResult;
  const { score: u, hasData: hu } = understandingResult;
  const { score: c, hasData: hc } = contextResult || { score: 0, hasData: false };
  const { score: a, hasData: ha } = aboutMeSignalsResult || { score: 0, hasData: false };

  let totalWeight = 0;
  let totalScore = 0;

  if (hs) {
    totalWeight += ME_STRUCTURED_WEIGHT;
    totalScore += s * ME_STRUCTURED_WEIGHT;
  }
  if (hu) {
    totalWeight += ME_UNDERSTANDING_WEIGHT;
    totalScore += u * ME_UNDERSTANDING_WEIGHT;
  }
  if (hc) {
    totalWeight += ME_CONTEXT_WEIGHT;
    totalScore += c * ME_CONTEXT_WEIGHT;
  }
  if (ha) {
    totalWeight += ME_ABOUT_ME_SIGNALS_WEIGHT;
    totalScore += a * ME_ABOUT_ME_SIGNALS_WEIGHT;
  }

  return totalWeight > 0 ? totalScore / totalWeight : 0;
}

/**
 * Combined Me similarity (structured `basic` + `soulProfile.understanding` sliders).
 * Mirrors the Lambda `/match/rank` pipeline when optional understanding objects are passed.
 */
export function calculateMeSimilarity(
  me1: any,
  me2: any,
  understanding1: Record<string, unknown> = {},
  understanding2: Record<string, unknown> = {},
  aboutMeSignals1: Record<string, unknown> = {},
  aboutMeSignals2: Record<string, unknown> = {},
): number {
  return combineMeSimilarity(
    calculateMeStructuredSimilarity(me1, me2),
    calculateUnderstandingSimilarity(understanding1, understanding2),
    calculateBasicContextSimilarity(me1, me2),
    calculateAboutMeSignalsSimilarity(aboutMeSignals1, aboutMeSignals2),
  );
}

// Simple similarity for soul profile (reflect data) — mirrors Lambda
export function calculateSoulSimilarity(soul1: any, soul2: any): number {
  if (!soul1 || !soul2) return 0;

  const model1 = soul1.reflectModel || soul1.latestInsight;
  const model2 = soul2.reflectModel || soul2.latestInsight;

  if (!model1 || !model2) return 0;

  let score = 0;
  let maxScore = 0;

  const arrayFields = ['thinkingStyle', 'coreQuestions', 'worldview', 'relationshipPhilosophy', 'conversationStyle'];

  for (const field of arrayFields) {
    if (model1[field] && model2[field]) {
      maxScore += 1;
      score += calculateArraySimilarity(model1[field], model2[field]);
    }
  }

  const stringFields = [
    'emotion',
    'trigger',
    'values',
    'behaviorPattern',
    'decisionModel',
    'personalityTraits',
    'relationshipNeed',
    'motivation',
    'coreConflict',
  ];
  for (const field of stringFields) {
    if (model1[field] && model2[field]) {
      maxScore += 0.5;
      if (model1[field] === model2[field]) {
        score += 0.5;
      }
    }
  }

  return maxScore > 0 ? score / maxScore : 0;
}
