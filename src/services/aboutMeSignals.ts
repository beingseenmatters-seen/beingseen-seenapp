import type { SoulProfileAboutMe, AboutMeSignals } from '../auth/providers/types';

function extractTags(text: string | undefined, rules: Record<string, string[]>): string[] {
  if (!text) return [];
  const t = text.toLowerCase();
  const tags = new Set<string>();
  
  for (const [tag, keywords] of Object.entries(rules)) {
    for (const kw of keywords) {
      if (t.includes(kw.toLowerCase())) {
        tags.add(tag);
        break;
      }
    }
  }
  return Array.from(tags);
}

export function extractAboutMeSignals(aboutMe: SoulProfileAboutMe | undefined): AboutMeSignals {
  const signals: AboutMeSignals = {
    valueTags: [],
    regretThemes: [],
    aspirationThemes: [],
    selfNarrativeTags: [],
    copingStyleTags: [],
    resonanceTags: [],
    emotionalNeeds: [],
    updatedAt: Date.now(),
  };

  if (!aboutMe) return signals;

  // Q1: Pride -> valueTags, selfNarrativeTags
  const q1Text = aboutMe.q1?.text || '';
  const q1Values = extractTags(q1Text, {
    growth: ['成长', '进步', '学到', '改变', 'growth', 'learn', 'improve'],
    responsibility: ['责任', '担当', '承担', '家人', 'responsibility', 'duty', 'family'],
    courage: ['勇敢', '勇气', '敢于', '突破', 'courage', 'brave', 'dare'],
    kindness: ['善良', '帮助', '温暖', 'kind', 'help', 'warm'],
    persistence: ['坚持', '熬过', '挺过', '不放弃', 'persist', 'endure', 'never give up'],
    independence: ['独立', '靠自己', '一个人', 'independent', 'myself', 'alone'],
    achievement: ['成就', '成功', '考上', '拿到', 'achieve', 'success', 'got', 'won'],
  });
  signals.valueTags.push(...q1Values);

  // Q2: Regret -> regretThemes, emotionalNeeds
  const q2Text = aboutMe.q2?.text || '';
  const q2Regrets = extractTags(q2Text, {
    missed_connection: ['错过', '没能在一起', '分手', '没留住', 'miss', 'break up', 'lost touch'],
    missed_opportunity: ['机会', '没去', '放弃了', '没选', 'opportunity', 'give up', 'didn\'t choose'],
    self_suppression: ['委屈', '迎合', '没做自己', '太听话', 'suppress', 'please others', 'not myself'],
    wrong_choice: ['选错', '走错', '后悔', 'wrong choice', 'regret', 'mistake'],
    unspoken_feelings: ['没说', '没表白', '没开口', '没道歉', 'didn\'t say', 'unspoken', 'never told'],
    family: ['父母', '爸妈', '家人', '陪伴', 'parents', 'family', 'accompany'],
  });
  signals.regretThemes.push(...q2Regrets);

  // Q3: Childhood dream -> aspirationThemes, selfNarrativeTags
  const q3Who = aboutMe.q3?.who || '';
  const q3Distance = aboutMe.q3?.distanceNow || '';
  const q3Aspirations = extractTags(q3Who, {
    freedom: ['自由', '到处走', '旅行', '不受约束', 'free', 'travel', 'unbound'],
    recognition: ['明星', '科学家', '大人物', '被看见', 'star', 'scientist', 'famous', 'seen'],
    competence: ['厉害', '强大', '无所不能', '能力', 'powerful', 'capable', 'strong'],
    creativity: ['作家', '画家', '艺术家', '创作', 'writer', 'artist', 'create'],
    stability: ['普通', '平凡', '安稳', '安居乐业', 'normal', 'ordinary', 'stable'],
    helping_others: ['医生', '老师', '警察', '帮助', 'doctor', 'teacher', 'police', 'help'],
  });
  signals.aspirationThemes.push(...q3Aspirations);

  const q3DistTags = extractTags(q3Distance, {
    closer_to_true_self: ['更近', '实现了', '差不多', '变成了', 'closer', 'achieved', 'almost', 'became'],
    further_from_true_self: ['更远', '背道而驰', '完全不同', '没有', 'further', 'opposite', 'different', 'not at all'],
    still_searching: ['还在找', '努力', '路上', '不知道', 'searching', 'trying', 'on the way', 'don\'t know'],
  });
  signals.selfNarrativeTags.push(...q3DistTags);

  // Q4: Current self -> selfNarrativeTags
  const q4Sentence = aboutMe.q4?.sentence || '';
  const q4Same = aboutMe.q4?.sameAsBefore || '';
  const q4Self = extractTags(q4Sentence, {
    reflective: ['想很多', '反思', '纠结', '内耗', 'think', 'reflect', 'overthink'],
    rational: ['理智', '现实', '冷静', '看透', 'rational', 'realistic', 'calm'],
    gentle: ['温和', '平静', '随和', '佛系', 'gentle', 'peaceful', 'easygoing', 'chill'],
    tired: ['累', '疲惫', '迷茫', '撑着', 'tired', 'exhausted', 'lost', 'hanging on'],
    growing: ['成长', '变好', '努力', '进步', 'growing', 'better', 'trying', 'improving'],
    guarded: ['防备', '保护', '封闭', '小心', 'guarded', 'protect', 'closed', 'careful'],
    complex: ['矛盾', '复杂', '多面', '双重', 'contradictory', 'complex', 'multi', 'dual'],
  });
  signals.selfNarrativeTags.push(...q4Self);

  const q4SameTags = extractTags(q4Same, {
    changed_a_lot: ['变了很多', '完全不同', '不一样', '变了', 'changed', 'different', 'not the same'],
    mostly_consistent: ['没变', '差不多', '还是那样', '初心', 'same', 'consistent', 'still'],
  });
  signals.selfNarrativeTags.push(...q4SameTags);

  // Q5: Recovery -> copingStyleTags, emotionalNeeds
  const q5Choice = aboutMe.q5?.choice || '';
  const q5Text = aboutMe.q5?.text || '';
  
  if (q5Choice === 'alone') {
    signals.copingStyleTags.push('solitude_recovery');
    signals.emotionalNeeds.push('space');
  } else if (q5Choice === 'talk') {
    signals.copingStyleTags.push('connection_recovery');
    signals.emotionalNeeds.push('being_heard');
  } else if (q5Choice === 'shift') {
    signals.copingStyleTags.push('action_recovery');
    signals.emotionalNeeds.push('movement');
  } else if (q5Choice === 'scroll') {
    signals.copingStyleTags.push('distraction_recovery');
    signals.emotionalNeeds.push('decompression');
  } else if (q5Choice === 'other') {
    const otherCoping = extractTags(q5Text, {
      solitude_recovery: ['一个人', '睡觉', '发呆', '独处', 'alone', 'sleep', 'daze', 'solitude'],
      connection_recovery: ['聊天', '朋友', '倾诉', 'talk', 'friend', 'vent'],
      action_recovery: ['运动', '跑步', '做家务', '出去', 'exercise', 'run', 'chores', 'go out'],
      distraction_recovery: ['看剧', '打游戏', '吃', 'watch', 'game', 'eat'],
    });
    if (otherCoping.length > 0) {
      signals.copingStyleTags.push(...otherCoping);
      if (otherCoping.includes('solitude_recovery')) signals.emotionalNeeds.push('space');
      if (otherCoping.includes('connection_recovery')) signals.emotionalNeeds.push('being_heard');
      if (otherCoping.includes('action_recovery')) signals.emotionalNeeds.push('movement');
      if (otherCoping.includes('distraction_recovery')) signals.emotionalNeeds.push('decompression');
    }
  }

  // Q6: Resonance -> resonanceTags, valueTags
  const q6Text = aboutMe.q6?.text || '';
  const q6Resonance = extractTags(q6Text, {
    truth: ['真实', '真诚', '坦诚', '不伪装', 'truth', 'sincere', 'honest', 'real'],
    freedom: ['自由', '做自己', '不被定义', 'free', 'myself', 'undefined'],
    love: ['爱', '被爱', '温暖', '心疼', 'love', 'loved', 'warm', 'care'],
    family: ['家人', '父母', '孩子', '亲情', 'family', 'parents', 'child'],
    loss: ['失去', '离开', '死亡', '离别', 'loss', 'leave', 'death', 'parting'],
    awakening: ['明白', '懂了', '顿悟', '看透', 'understand', 'realize', 'awaken', 'see through'],
    dignity: ['尊严', '底线', '尊重', 'dignity', 'bottom line', 'respect'],
    understanding: ['懂我', '理解', '共鸣', '接纳', 'understand me', 'resonate', 'accept'],
    courage: ['勇敢', '无畏', '拼命', 'courage', 'fearless', 'desperate'],
    meaning: ['意义', '值得', '为什么', 'meaning', 'worth', 'why'],
  });
  signals.resonanceTags.push(...q6Resonance);

  // Deduplicate arrays
  signals.valueTags = Array.from(new Set(signals.valueTags));
  signals.regretThemes = Array.from(new Set(signals.regretThemes));
  signals.aspirationThemes = Array.from(new Set(signals.aspirationThemes));
  signals.selfNarrativeTags = Array.from(new Set(signals.selfNarrativeTags));
  signals.copingStyleTags = Array.from(new Set(signals.copingStyleTags));
  signals.resonanceTags = Array.from(new Set(signals.resonanceTags));
  signals.emotionalNeeds = Array.from(new Set(signals.emotionalNeeds));

  return signals;
}
