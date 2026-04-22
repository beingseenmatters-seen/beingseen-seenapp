/**
 * Seen Push Notification Copy System (V1)
 * 
 * Centralized module for managing push notification copy across the app.
 * Supports events, emotional levels, and languages.
 */

const PUSH_COPY_MAP = {
  match: {
    1: {
      zh: [
        '有人和你产生了共鸣',
        '有人，与你在同一频率',
        '有人读到了你的表达'
      ],
      en: [
        'Someone resonates with you',
        'Someone is on the same wavelength as you',
        'Someone read what you shared'
      ]
    },
    2: {
      zh: [
        '有人，在你身上看到了自己',
        '你表达的那些，被人理解了',
        '有人，对你的感受有回应'
      ],
      en: [
        'Someone saw themselves in you',
        'What you expressed was understood',
        'Someone responded to how you feel'
      ]
    },
    3: {
      zh: [
        '你说的那些，也许不只是你一个人的感受',
        '有些感受，被另一个人接住了'
      ],
      en: [
        'What you feel might not be yours alone',
        'Something you felt has been received'
      ]
    }
  },
  message: {
    1: {
      zh: [
        '有人回应了你的表达',
        '你收到一条新的回应'
      ],
      en: [
        'Someone responded to you',
        'You have a new reply'
      ]
    },
    2: {
      zh: [
        '有人认真读了你说的话',
        '有人，正在试着理解你'
      ],
      en: [
        'Someone took time to read what you said',
        'Someone is trying to understand you'
      ]
    },
    3: {
      zh: [
        '有人，看见了你没有说完的那部分',
        '有些话，被真正听到了'
      ],
      en: [
        'Someone noticed what you didn’t finish saying',
        'Something you said was truly heard'
      ]
    }
  },
  inactive: {
    1: {
      zh: [
        'Seen 里有一些新的变化',
        '有一些新的共鸣在等你'
      ],
      en: [
        'There’s something new on Seen',
        'New resonances are waiting'
      ]
    },
    2: {
      zh: [
        '最近还好吗？这里一直在',
        '有些想法，或许可以留在这里'
      ],
      en: [
        'How have you been? This space is still here',
        'Some thoughts might belong here'
      ]
    },
    3: {
      zh: [
        '也许现在，你有一些还没说出口的东西',
        '有些话，如果不说出来，会一直在心里',
        '你不需要一个答案，只需要一个地方说出来'
      ],
      en: [
        'Maybe there’s something in you that hasn’t been said',
        'Some thoughts stay until they’re expressed',
        'You don’t need answers, just a place to say it'
      ]
    }
  },
  reflect: {
    1: {
      zh: [
        '你可以继续刚才的表达',
        '那段话，还可以继续'
      ],
      en: [
        'You can continue what you started',
        'That thought can go further'
      ]
    },
    2: {
      zh: [
        '刚才那段表达，好像还有没说完的',
        '你刚才说的，我还在想'
      ],
      en: [
        'There might be more in what you said',
        'I’m still thinking about what you shared'
      ]
    },
    3: {
      zh: [
        '我对你刚才的表达，有一点新的理解',
        '那些话里，可能有你自己还没意识到的部分'
      ],
      en: [
        'I have a new understanding of what you shared',
        'There may be something in your words you haven’t noticed'
      ]
    }
  }
};

// ---------------------------------------------------------------------------
// Core Functions
// ---------------------------------------------------------------------------

/**
 * Get a random push notification body for a given type, level, and language.
 */
export function getPushCopy(
  type, 
  level, 
  language = 'en'
) {
  // Fallback to English if not explicitly zh
  const lang = language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
  
  const options = PUSH_COPY_MAP[type]?.[level]?.[lang];
  
  if (!options || options.length === 0) {
    // Ultimate fallback if something is missing
    return lang === 'zh' ? '你在 Seen 有新消息' : 'You have a new update on Seen';
  }

  // Randomly select one copy to avoid repetition
  const randomIndex = Math.floor(Math.random() * options.length);
  return options[randomIndex];
}

export function getDefaultPushLevel(type, userState) {
  switch (type) {
    case 'match':
      return 1;
    case 'message':
      return 1;
    case 'reflect':
      return 1;
    case 'inactive':
      return userState === 'atRisk' ? 3 : 2;
    default:
      return 1;
  }
}

export function buildPushPayload({
  type,
  level,
  language = 'en',
  userState
}) {
  const finalLevel = level || getDefaultPushLevel(type, userState);
  const body = getPushCopy(type, finalLevel, language);
  
  return {
    title: 'Seen', // Seen app pushes usually just use the app name as the title
    body,
    type,
    level: finalLevel
  };
}

export function buildMatchPushPayload({
  language = 'en',
  primaryReason
}) {
  let body;
  if (primaryReason) {
    const lang = language.toLowerCase().startsWith('zh') ? 'zh' : 'en';
    body = primaryReason[lang];
  } else {
    body = getPushCopy('match', 1, language);
  }
  
  return {
    title: 'Seen',
    body,
    type: 'match',
    level: 1
  };
}
