export type MatchReasonSource = 'understanding' | 'aboutMeSignals' | 'structured' | 'context';

export interface MatchReason {
  key: string;
  zh: string;
  en: string;
  source: MatchReasonSource;
}

const REASON_COPY: Record<string, Record<string, { zh: string[]; en: string[] }>> = {
  understanding: {
    connection_depth: {
      zh: ['你们对关系的深度感受很接近', '你们都更在意连接里的真实感'],
      en: ['You seem close in how deeply you want to connect', 'You both seem to value depth and realness in connection']
    },
    life_pace: {
      zh: ['你们在关系节奏上很接近', '你们更像是在同一种节奏里靠近彼此'],
      en: ['You seem aligned in pace', 'You seem to move toward connection at a similar pace']
    },
    expression_style: {
      zh: ['你们表达自己的方式很接近', '你们更容易在表达里彼此读懂'],
      en: ['You express yourselves in a similar way', 'You may find it easier to understand each other through expression']
    },
    conflict_handling: {
      zh: ['你们面对分歧的方式很接近', '你们处理关系张力的方式有些像'],
      en: ['You seem similar in how you handle tension', 'You may approach differences in a similar way']
    },
    self_vs_relationship: {
      zh: ['你们在自我与关系之间的平衡感很接近', '你们都在用相似的方式处理靠近与保留'],
      en: ['You seem close in how you balance self and relationship', 'You may navigate closeness and boundaries in similar ways']
    },
    value_orientation: {
      zh: ['你们在看重什么这件事上很接近', '你们似乎在意相似的东西'],
      en: ['You seem close in what you value', 'You seem to care about similar things']
    },
    money_view: {
      zh: ['你们在现实感与关系感之间的取向很接近', '你们对现实与关系的理解有些像'],
      en: ['You seem similar in how you hold practicality and connection', 'You may see reality and relationship in a similar way']
    }
  },
  aboutMeSignals: {
    valueTags: {
      zh: ['你们都很在意一些更内在的东西', '你们似乎把相似的价值放得很重要'],
      en: ['You both seem to care about something deeply internal', 'You seem to place importance on similar values']
    },
    copingStyleTags: {
      zh: ['你们在疲惫时，更像会用相似的方式照顾自己', '你们恢复自己的方式有些接近'],
      en: ['You seem to recover in similar ways when tired', 'The way you take care of yourselves feels similar']
    },
    emotionalNeeds: {
      zh: ['你们需要被接住的方式有些像', '你们在关系里期待的回应方式很接近'],
      en: ['You seem to need to be received in similar ways', 'You seem close in the kind of response you hope for']
    },
    selfNarrativeTags: {
      zh: ['你们看待自己的方式有些像', '你们的内在叙事似乎很接近'],
      en: ['The way you see yourselves feels similar', 'Your inner narratives seem close']
    },
    aspirationThemes: {
      zh: ['你们都在朝着相似的自己靠近', '你们想成为的样子有些接近'],
      en: ['You both seem to be moving toward a similar self', 'The selves you’re growing toward feel close']
    }
  },
  structured: {
    interests: {
      zh: ['你们有一些自然重叠的兴趣', '你们平时会投入时间的事情有些像'],
      en: ['You seem to share a few natural interests', 'You seem to spend your time on similar things']
    },
    goals: {
      zh: ['你们当下想靠近的方向有些像', '你们在生活目标上有相似感'],
      en: ['You seem to be moving toward similar things', 'Your goals seem to overlap in some way']
    },
    communicationPreference: {
      zh: ['你们偏好的沟通方式很接近', '你们更容易在相似的交流方式里靠近'],
      en: ['You seem close in how you prefer to communicate', 'You may connect more easily through similar ways of communicating']
    }
  },
  context: {
    currentState: {
      zh: ['你们似乎正处在有些相似的阶段', '你们现在的状态有一些接近'],
      en: ['You seem to be in a somewhat similar phase', 'Your current state seems to overlap in some way']
    }
  }
};

function getRandomCopy(options: string[]) {
  return options[Math.floor(Math.random() * options.length)];
}

function calculateArrayJaccard(arr1: any[], arr2: any[]): number {
  if (!Array.isArray(arr1) || !Array.isArray(arr2) || arr1.length === 0 || arr2.length === 0) return 0;
  const set1 = new Set(arr1);
  const set2 = new Set(arr2);
  const intersection = new Set([...set1].filter(x => set2.has(x)));
  const union = new Set([...set1, ...set2]);
  return intersection.size / union.size;
}

export function generatePrimaryMatchReason(currentUser: any, candidateUser: any): MatchReason | null {
  if (!currentUser || !candidateUser) return null;

  // 1. Priority 1: understanding
  const u1 = currentUser.soulProfile?.understanding || {};
  const u2 = candidateUser.soulProfile?.understanding || {};
  
  let bestUnderstandingKey: string | null = null;
  let minDiff = Infinity;

  const understandingKeys = [
    'connection_depth', 'life_pace', 'expression_style', 
    'conflict_handling', 'self_vs_relationship', 'value_orientation', 'money_view'
  ];

  for (const key of understandingKeys) {
    const val1 = u1[key];
    const val2 = u2[key];
    if (typeof val1 === 'number' && typeof val2 === 'number' && !Number.isNaN(val1) && !Number.isNaN(val2)) {
      const diff = Math.abs(val1 - val2);
      if (diff <= 12 && diff < minDiff) {
        minDiff = diff;
        bestUnderstandingKey = key;
      }
    }
  }

  if (bestUnderstandingKey) {
    const copy = REASON_COPY.understanding[bestUnderstandingKey];
    return {
      key: bestUnderstandingKey,
      zh: getRandomCopy(copy.zh),
      en: getRandomCopy(copy.en),
      source: 'understanding'
    };
  }

  // 2. Priority 2: aboutMeSignals
  const s1 = currentUser.soulProfile?.aboutMeSignals || {};
  const s2 = candidateUser.soulProfile?.aboutMeSignals || {};
  
  let bestSignalKey: string | null = null;
  let maxSignalScore = 0;

  const signalKeys = ['valueTags', 'copingStyleTags', 'emotionalNeeds', 'selfNarrativeTags', 'aspirationThemes'];

  for (const key of signalKeys) {
    const score = calculateArrayJaccard(s1[key], s2[key]);
    if (score > 0 && score > maxSignalScore) {
      maxSignalScore = score;
      bestSignalKey = key;
    }
  }

  if (bestSignalKey) {
    const copy = REASON_COPY.aboutMeSignals[bestSignalKey];
    return {
      key: bestSignalKey,
      zh: getRandomCopy(copy.zh),
      en: getRandomCopy(copy.en),
      source: 'aboutMeSignals'
    };
  }

  // 3. Priority 3: structured
  const b1 = currentUser.basic || {};
  const b2 = candidateUser.basic || {};

  let bestStructuredKey: string | null = null;
  let maxStructuredScore = 0;

  const arrayStructuredKeys = ['interests', 'goals'];
  for (const key of arrayStructuredKeys) {
    const score = calculateArrayJaccard(b1[key], b2[key]);
    if (score > 0 && score > maxStructuredScore) {
      maxStructuredScore = score;
      bestStructuredKey = key;
    }
  }

  // Check communicationPreference
  if (b1.communicationPreference && b2.communicationPreference && b1.communicationPreference === b2.communicationPreference) {
    // Treat exact match as score 1
    if (1 > maxStructuredScore) {
      maxStructuredScore = 1;
      bestStructuredKey = 'communicationPreference';
    }
  }

  if (bestStructuredKey) {
    const copy = REASON_COPY.structured[bestStructuredKey];
    return {
      key: bestStructuredKey,
      zh: getRandomCopy(copy.zh),
      en: getRandomCopy(copy.en),
      source: 'structured'
    };
  }

  // 4. Priority 4: context
  if (b1.currentState && b2.currentState && b1.currentState === b2.currentState) {
    const copy = REASON_COPY.context.currentState;
    return {
      key: 'currentState',
      zh: getRandomCopy(copy.zh),
      en: getRandomCopy(copy.en),
      source: 'context'
    };
  }

  return null;
}
