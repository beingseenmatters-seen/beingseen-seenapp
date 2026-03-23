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

// Simple Jaccard similarity for arrays of strings
function calculateArraySimilarity(arr1: string[], arr2: string[]): number {
  if (!arr1 || !arr2 || arr1.length === 0 || arr2.length === 0) return 0;
  const set1 = new Set(arr1);
  const set2 = new Set(arr2);
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return intersection.size / union.size;
}

// Simple similarity for basic profile (me data)
export function calculateMeSimilarity(me1: any, me2: any): number {
  if (!me1 || !me2) return 0;
  
  let totalScore = 0;
  let totalWeight = 0;

  // 1. interests (array) - 30% weight
  if (Array.isArray(me1.interests) && Array.isArray(me2.interests) && me1.interests.length > 0 && me2.interests.length > 0) {
    const sim = calculateArraySimilarity(me1.interests, me2.interests);
    totalScore += sim * 0.30;
    totalWeight += 0.30;
  }

  // 2. values (array) - 25% weight
  if (Array.isArray(me1.values) && Array.isArray(me2.values) && me1.values.length > 0 && me2.values.length > 0) {
    const sim = calculateArraySimilarity(me1.values, me2.values);
    totalScore += sim * 0.25;
    totalWeight += 0.25;
  }

  // 3. lifeStage (string) - 20% weight
  if (me1.lifeStage && me2.lifeStage) {
    const sim = me1.lifeStage === me2.lifeStage ? 1 : 0;
    totalScore += sim * 0.20;
    totalWeight += 0.20;
  }

  // 4. goals (array) - 15% weight
  if (Array.isArray(me1.goals) && Array.isArray(me2.goals) && me1.goals.length > 0 && me2.goals.length > 0) {
    const sim = calculateArraySimilarity(me1.goals, me2.goals);
    totalScore += sim * 0.15;
    totalWeight += 0.15;
  }

  // 5. communicationPreference (string) - 10% weight
  if (me1.communicationPreference && me2.communicationPreference) {
    const sim = me1.communicationPreference === me2.communicationPreference ? 1 : 0;
    totalScore += sim * 0.10;
    totalWeight += 0.10;
  }

  // Normalize score based on available data
  // If totalWeight is 0 (meaning none of the meaningful fields were present in both), return 0
  return totalWeight > 0 ? totalScore / totalWeight : 0;
}

// Simple similarity for soul profile (reflect data)
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

  // Also check new 10-layer fields (simple exact match for now)
  const stringFields = ['emotion', 'trigger', 'values', 'behaviorPattern', 'decisionModel', 'personalityTraits', 'relationshipNeed', 'motivation', 'coreConflict'];
  for (const field of stringFields) {
    if (model1[field] && model2[field]) {
      maxScore += 0.5; // lower weight for single string matches
      if (model1[field] === model2[field]) {
        score += 0.5;
      }
    }
  }

  return maxScore > 0 ? score / maxScore : 0;
}
