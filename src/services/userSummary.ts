/**
 * User understanding service
 *
 * Layers:
 * 1. `ConversationExtraction` - distilled from one conversation, shown to the user for approval
 * 2. `SessionInsight` - one approved reflection summary
 * 3. `UserUnderstandingModel` - stable long-term understanding derived from multiple approved insights
 *
 * Matching should prefer the aggregated understanding model over raw chats.
 * Raw chats remain deletable and are never used as long-term storage.
 */

import type {
  ConversationExtraction,
  SessionInsight,
  UserUnderstandingModel,
} from '../types/userSummary';

export type InsightLanguage = 'zh' | 'en';

type ConversationMessage = { role: 'user' | 'ai' | 'system'; text: string };

const SESSION_INSIGHTS_STORAGE_KEY = 'seen_session_insights';
const UNDERSTANDING_MODEL_STORAGE_KEY = 'seen_user_understanding_model';
const LEGACY_PERSONALITY_MODEL_STORAGE_KEY = 'seen_user_personality_model';
const LEGACY_SUMMARY_STORAGE_KEY = 'seen_user_summary';
const MIN_INSIGHTS_FOR_MODEL = 5;

const TAG_LABELS: Record<string, { zh: string; en: string }> = {
  philosophical_reasoning: { zh: '哲学式推理', en: 'Philosophical reasoning' },
  systems_thinking: { zh: '系统思维', en: 'Systems thinking' },
  abstract_analysis: { zh: '抽象分析', en: 'Abstract analysis' },
  cause_effect_modeling: { zh: '因果建模', en: 'Cause-effect modeling' },
  pattern_mapping: { zh: '模式识别', en: 'Pattern mapping' },
  dialectical_reasoning: { zh: '辩证思考', en: 'Dialectical reasoning' },
  relational_reasoning: { zh: '关系推演', en: 'Relational reasoning' },
  macro_micro_linking: { zh: '宏观与微观联动', en: 'Macro-micro linking' },
  existential_inquiry: { zh: '存在与意义追问', en: 'Existential inquiry' },

  what_makes_relationships_endure: { zh: '什么决定关系能否长久', en: 'What makes relationships endure' },
  can_loyalty_be_measured: { zh: '忠诚能否被验证', en: 'Can loyalty be measured' },
  what_drives_human_aggregation: { zh: '人为什么会形成聚合', en: 'What drives human aggregation' },
  how_does_entropy_affect_connection: { zh: '熵如何影响连接与分散', en: 'How does entropy affect connection' },
  how_do_power_and_wealth_shape_order: { zh: '权力与财富如何塑造秩序', en: 'How do power and wealth shape order' },
  what_allows_real_trust: { zh: '什么让真实信任成为可能', en: 'What allows real trust' },
  how_do_individual_bonds_survive_systems: { zh: '个体关系如何在大系统中存续', en: 'How do individual bonds survive systems' },
  what_is_stable_in_human_nature: { zh: '人性里究竟什么是稳定的', en: 'What is stable in human nature' },
  how_do_relationships_change_over_time: { zh: '关系为何会随时间改变', en: 'How do relationships change over time' },

  human_hearts_resist_measurement: { zh: '人心难以被精确测量', en: 'Human hearts resist measurement' },
  aggregation_tends_toward_dispersion: { zh: '聚合终会走向分散', en: 'Aggregation tends toward dispersion' },
  systems_follow_incentives: { zh: '系统往往被激励与利益驱动', en: 'Systems often follow incentives' },
  power_and_wealth_shape_collective_order: { zh: '权力与财富会重塑群体秩序', en: 'Power and wealth shape collective order' },
  relationships_live_inside_larger_systems: { zh: '个体关系始终嵌在更大的系统里', en: 'Relationships live inside larger systems' },
  authenticity_emerges_when_defenses_drop: { zh: '防御下降时真实才更容易出现', en: 'Authenticity emerges when defenses drop' },
  order_is_temporary: { zh: '秩序通常是暂时性的', en: 'Order is temporary' },
  meaning_must_be_built_not_received: { zh: '意义需要被建立而非被给予', en: 'Meaning must be built, not received' },
  belonging_is_sought_under_uncertainty: { zh: '人在不确定中会主动寻找归属', en: 'Belonging is sought under uncertainty' },

  trust_cannot_be_forced: { zh: '信任无法被强行验证', en: 'Trust cannot be forced' },
  loyalty_is_revealed_over_time: { zh: '忠诚更像时间中的显现', en: 'Loyalty is revealed over time' },
  alignment_matters_more_than_intensity: { zh: '关系更依赖认知同频而非强烈情绪', en: 'Alignment matters more than intensity' },
  reciprocity_keeps_bonds_alive: { zh: '双向回应让关系维持生命力', en: 'Reciprocity keeps bonds alive' },
  safety_precedes_closeness: { zh: '安全感先于亲密', en: 'Safety precedes closeness' },
  authenticity_requires_lowered_defenses: { zh: '放下防御后才更容易真实', en: 'Authenticity requires lowered defenses' },
  slow_bonding_reveals_truth: { zh: '慢慢建立比迅速靠近更能看见真实', en: 'Slow bonding reveals truth' },
  relationships_change_with_context: { zh: '关系会随着环境与阶段变化', en: 'Relationships change with context' },
  distance_can_clarify_connection: { zh: '距离有时能让连接更清楚', en: 'Distance can clarify connection' },

  structured_thinking: { zh: '结构化表达', en: 'Structured thinking' },
  metaphor_usage: { zh: '会用比喻', en: 'Uses metaphor' },
  concept_driven_dialogue: { zh: '概念驱动的对话', en: 'Concept-driven dialogue' },
  chain_reasoning: { zh: '链式推演', en: 'Chain reasoning' },
  layered_abstraction: { zh: '层层抽象推进', en: 'Layered abstraction' },
  comparative_reasoning: { zh: '对照式思考', en: 'Comparative reasoning' },
  exploratory_dialogue: { zh: '探索式展开', en: 'Exploratory dialogue' },
  reflective_language: { zh: '反思式语言', en: 'Reflective language' },

  loyalty: { zh: '忠诚', en: 'Loyalty' },
  measure_of_the_heart: { zh: '人心是否可测', en: 'Whether the heart can be measured' },
  trust: { zh: '信任', en: 'Trust' },
  relationship_impermanence: { zh: '关系的无常', en: 'Relationship impermanence' },
  human_aggregation: { zh: '人的聚合', en: 'Human aggregation' },
  entropy: { zh: '熵与分散', en: 'Entropy and dispersion' },
  power: { zh: '权力结构', en: 'Power structures' },
  wealth: { zh: '财富结构', en: 'Wealth structures' },
  systems: { zh: '系统与秩序', en: 'Systems and order' },
  belonging: { zh: '归属', en: 'Belonging' },
  authenticity: { zh: '真实', en: 'Authenticity' },
  defenses: { zh: '防御', en: 'Defenses' },
  alignment: { zh: '认知同频', en: 'Alignment' },
  human_nature: { zh: '人性', en: 'Human nature' },
  order: { zh: '秩序', en: 'Order' },
};

const THINKING_STYLE_KEYWORDS: Record<string, string[]> = {
  philosophical_reasoning: ['意义', '存在', '人生', '人性', '本质', '哲学', 'meaning', 'existence', 'human nature', 'essence', 'philosophy'],
  systems_thinking: ['系统', '结构', '机制', '秩序', '网络', '群体', '国家', '宗教', '部落', 'system', 'structure', 'order', 'network', 'collective', 'nation', 'religion', 'tribe'],
  abstract_analysis: ['抽象', '概念', '宏观', '模式', '规律', 'abstract', 'concept', 'macro', 'pattern', 'principle'],
  cause_effect_modeling: ['因为', '所以', '导致', '结果', '因果', 'therefore', 'because', 'lead to', 'result in', 'cause', 'effect'],
  pattern_mapping: ['反复', '总是', '模式', '循环', '轨迹', 'recurring', 'pattern', 'cycle', 'trajectory'],
  dialectical_reasoning: ['一方面', '另一方面', '同时', '矛盾', '既', '又', 'on the one hand', 'on the other hand', 'tension', 'contradiction'],
  relational_reasoning: ['关系', '忠诚', '信任', '连接', 'relationship', 'loyalty', 'trust', 'connection'],
  existential_inquiry: ['值得', '为什么活着', '意义感', '存在感', 'worth', 'why live', 'purpose', 'existential'],
};

const CORE_QUESTION_KEYWORDS: Record<string, string[]> = {
  what_makes_relationships_endure: ['长久', '维持关系', '长期关系', '持续的关系', 'endure', 'lasting relationship', 'long-term relationship'],
  can_loyalty_be_measured: ['忠诚', '可测', '验证信任', '测试信任', 'loyalty', 'measure trust', 'test trust', 'prove trust'],
  what_drives_human_aggregation: ['聚合', '群体', '部落', '国家', '宗教', '归属', 'aggregation', 'collective', 'tribe', 'nation', 'religion', 'belonging'],
  how_does_entropy_affect_connection: ['熵', '分散', '瓦解', '散开', 'entropy', 'dispersion', 'decay', 'break apart'],
  how_do_power_and_wealth_shape_order: ['权力', '财富', '阶层', '资源', '资本', 'power', 'wealth', 'class', 'resource', 'capital'],
  what_allows_real_trust: ['信任', '真实', '防御', '放下防备', 'trust', 'authenticity', 'defense', 'lower defenses'],
  how_do_individual_bonds_survive_systems: ['个体关系', '大系统', '社会结构', 'small relationship', 'larger system', 'social structure'],
  what_is_stable_in_human_nature: ['人性', '人心', '本性', 'human nature', 'human heart'],
  how_do_relationships_change_over_time: ['无常', '变化', '变质', '时间', 'impermanence', 'change over time', 'drift'],
};

const WORLDVIEW_KEYWORDS: Record<string, string[]> = {
  human_hearts_resist_measurement: ['人心不可测', '人心难测', '人心无法衡量', 'heart cannot be measured', 'human hearts resist measurement'],
  aggregation_tends_toward_dispersion: ['聚合后分散', '终将散去', '熵增', '由聚到散', 'aggregation leads to dispersion', 'entropy', 'dispersion'],
  systems_follow_incentives: ['利益驱动', '激励驱动', '制度驱动', 'incentive', 'interest-driven', 'system follows incentives'],
  power_and_wealth_shape_collective_order: ['权力结构', '财富结构', '资本结构', 'power structure', 'wealth structure', 'capital structure'],
  relationships_live_inside_larger_systems: ['关系嵌在系统里', '个体关系也受社会影响', 'relationship inside systems', 'social structure shapes relationships'],
  authenticity_emerges_when_defenses_drop: ['放下防御才真实', '卸下防备', '真实出现', 'authenticity appears when defenses drop', 'lower defenses'],
  order_is_temporary: ['秩序是暂时的', '稳定只是阶段性的', 'order is temporary', 'stability is temporary'],
  meaning_must_be_built_not_received: ['意义要自己建立', '意义不是被给定的', 'meaning must be built', 'meaning is not given'],
  belonging_is_sought_under_uncertainty: ['不确定中的归属', '寻找归属', 'belonging under uncertainty', 'search for belonging'],
};

const RELATIONSHIP_PHILOSOPHY_KEYWORDS: Record<string, string[]> = {
  trust_cannot_be_forced: ['信任不能测试', '无法验证信任', 'trust cannot be tested', 'trust cannot be forced'],
  loyalty_is_revealed_over_time: ['忠诚是时间里看出来的', '忠诚需要时间', 'loyalty over time', 'loyalty is revealed'],
  alignment_matters_more_than_intensity: ['同频', '认知一致', '思想一致', 'alignment', 'cognitive alignment', 'more than intensity'],
  reciprocity_keeps_bonds_alive: ['双向', '互相回应', '彼此回应', 'reciprocity', 'mutual response'],
  safety_precedes_closeness: ['安全感', '先稳定再靠近', 'safety', 'emotional safety', 'stable before closeness'],
  authenticity_requires_lowered_defenses: ['放下防御', '卸下防备', 'lower defenses', 'drop defenses'],
  slow_bonding_reveals_truth: ['慢慢来', '慢慢建立', 'slow bonding', 'take it slow'],
  relationships_change_with_context: ['阶段变化', '环境变化', '关系会变', 'context changes relationships', 'relationships change'],
  distance_can_clarify_connection: ['距离让关系更清楚', 'distance clarifies', 'distance can clarify connection'],
};

const CONVERSATION_STYLE_KEYWORDS: Record<string, string[]> = {
  metaphor_usage: ['像', '仿佛', '好像', '像是', 'like', 'as if', 'metaphor'],
  concept_driven_dialogue: ['概念', '结构', '系统', '本质', 'concept', 'structure', 'system', 'essence'],
  layered_abstraction: ['从', '到', '再到', '一层层', 'from', 'to', 'then to', 'layer by layer'],
  comparative_reasoning: ['不是', '而是', '相比', '对照', 'rather than', 'instead of', 'compare', 'contrast'],
  reflective_language: ['我在想', '我意识到', '回头看', '反过来看', 'i keep thinking', 'i realize', 'looking back'],
};

const THINKING_PATH_KEYWORDS: Record<string, string[]> = {
  loyalty: ['忠诚', 'loyalty'],
  measure_of_the_heart: ['人心', '可测', '衡量', 'measure the heart', 'human heart'],
  trust: ['信任', 'trust'],
  relationship_impermanence: ['无常', '变化', '变质', '漂移', 'impermanence', 'drift', 'change over time'],
  human_aggregation: ['聚合', '部落', '宗教', '国家', '群体', 'aggregation', 'tribe', 'religion', 'nation', 'collective'],
  entropy: ['熵', '分散', '散开', '瓦解', 'entropy', 'dispersion', 'break apart'],
  power: ['权力', 'power'],
  wealth: ['财富', '资本', '资源', 'wealth', 'capital', 'resource'],
  systems: ['系统', '结构', '秩序', 'system', 'structure', 'order'],
  belonging: ['归属', 'belonging'],
  authenticity: ['真实', 'authenticity'],
  defenses: ['防御', '防备', 'defense', 'defenses'],
  alignment: ['同频', '一致', 'alignment'],
  human_nature: ['人性', 'human nature'],
  order: ['秩序', 'order'],
};

const MACRO_KEYWORDS = ['系统', '国家', '宗教', '部落', '阶层', '权力', '财富', 'system', 'nation', 'religion', 'tribe', 'class', 'power', 'wealth'];
const MICRO_KEYWORDS = ['关系', '忠诚', '信任', '亲密', '真实', 'relationship', 'loyalty', 'trust', 'intimacy', 'authenticity'];
const STRUCTURED_PATTERNS = [/\d+[.、:：)）]/, /首先|其次|然后|最后|一方面|另一方面/, /first|second|third|finally|on the one hand|on the other hand/i];
const COMPARATIVE_PATTERNS = ['不是', '而是', '相比', '对照', 'rather than', 'instead of', 'compare', 'contrast'];

import { extractReflectSummary } from './seenApi';

export async function extractSummaryFromConversation(
  messages: ConversationMessage[],
  options: { preferredResponseStyle?: string; language?: InsightLanguage; uid?: string; sessionId?: string } = {}
): Promise<ConversationExtraction> {
  const language = options.language ?? 'zh';
  const uid = options.uid || 'anonymous';
  const sessionId = options.sessionId || 'unknown';

  try {
    const response = await extractReflectSummary({
      uid,
      sessionId,
      conversation: messages,
      module: 'reflect',
      language
    });

    const extraction: ConversationExtraction = {
      summaryText: response.summary || '',
      thinkingStyle: [],
      coreQuestions: [],
      worldview: [],
      relationshipPhilosophy: [],
      conversationStyle: [],
      thinkingPath: [],
      preferredResponseStyle: options.preferredResponseStyle,
      contentSummary: response.layers?.contentSummary,
      emotion: response.layers?.emotion,
      trigger: response.layers?.trigger,
      values: response.layers?.values,
      behaviorPattern: response.layers?.behaviorPattern,
      decisionModel: response.layers?.decisionModel,
      personalityTraits: response.layers?.personalityTraits,
      relationshipNeed: response.layers?.relationshipNeed,
      motivation: response.layers?.motivation,
      coreConflict: response.layers?.coreConflict,
    };

    // Fallback to local logic if summaryText is empty
    if (!extraction.summaryText) {
      throw new Error('Empty summary from backend');
    }

    return extraction;
  } catch (error) {
    console.error('[UserSummary] Backend extraction failed, falling back to local:', error);
    
    const userMessages = messages.filter(message => message.role === 'user' && message.text.trim());
    const allMessages = messages.filter(message => message.role !== 'system' && message.text.trim());
    const userText = userMessages.map(message => message.text).join('\n');
    const userTextLower = userText.toLowerCase();
    const allTextLower = allMessages.map(message => message.text).join('\n').toLowerCase();

    const thinkingPath = extractThinkingPath(userMessages);
    const thinkingStyle = inferThinkingStyle(userTextLower, thinkingPath);
    const coreQuestions = inferCoreQuestions(userMessages, userTextLower, language);
    const worldview = inferWorldview(userTextLower, allTextLower);
    const relationshipPhilosophy = inferRelationshipPhilosophy(userTextLower);
    const conversationStyle = inferConversationStyle(userMessages, userTextLower, thinkingPath);

    const extraction: ConversationExtraction = {
      summaryText: '',
      thinkingStyle: thinkingStyle.slice(0, 4),
      coreQuestions: coreQuestions.slice(0, 4),
      worldview: worldview.slice(0, 4),
      relationshipPhilosophy: relationshipPhilosophy.slice(0, 4),
      conversationStyle: conversationStyle.slice(0, 4),
      thinkingPath: thinkingPath.slice(0, 6),
      preferredResponseStyle: options.preferredResponseStyle,
    };

    extraction.summaryText = buildSummaryText(extraction, language);
    return extraction;
  }
}

export function formatInsightTag(key: string, language: InsightLanguage): string {
  const labels = TAG_LABELS[key];
  if (labels) {
    return labels[language];
  }
  return key;
}

function inferThinkingStyle(userTextLower: string, thinkingPath: string[]): string[] {
  const styles = matchKeywords(userTextLower, THINKING_STYLE_KEYWORDS);
  const priority: string[] = [];

  if (
    containsAny(userTextLower, ['到底', '究竟', '为什么', '忠诚', '人心', '聚合', '熵', 'loyalty', 'human heart', 'aggregation', 'entropy'])
  ) {
    priority.push('philosophical_reasoning');
  }
  if (thinkingPath.length >= 3) {
    priority.push('pattern_mapping');
  }

  if (containsAny(userTextLower, MACRO_KEYWORDS) && containsAny(userTextLower, MICRO_KEYWORDS)) {
    priority.push('macro_micro_linking');
  }

  if (priority.length === 0 && styles.length === 0 && userTextLower.trim().length > 120) {
    priority.push('abstract_analysis');
  }

  return dedup([...priority, ...styles]);
}

function inferCoreQuestions(
  userMessages: ConversationMessage[],
  userTextLower: string,
  language: InsightLanguage
): string[] {
  const questions = matchKeywords(userTextLower, CORE_QUESTION_KEYWORDS);
  const explicitQuestions = extractExplicitQuestions(userMessages, language);

  explicitQuestions.forEach(question => {
    if (questions.length < 4) {
      questions.push(question);
    }
  });

  return dedup(questions);
}

function inferWorldview(userTextLower: string, allTextLower: string): string[] {
  const worldview = matchKeywords(userTextLower, WORLDVIEW_KEYWORDS);

  if (worldview.length === 0) {
    worldview.push(...matchKeywords(allTextLower, WORLDVIEW_KEYWORDS));
  }

  if (
    containsAny(userTextLower, ['聚合', 'aggregation', 'tribe', 'nation', '宗教', '国家']) &&
    containsAny(userTextLower, ['熵', '分散', '瓦解', 'entropy', 'dispersion', 'break apart'])
  ) {
    worldview.push('aggregation_tends_toward_dispersion');
  }

  if (containsAny(userTextLower, ['熵', 'entropy', '瓦解', 'dispersion'])) {
    worldview.push('order_is_temporary');
  }

  if (containsAny(userTextLower, ['归属', 'belonging', '聚合', 'tribe', 'nation'])) {
    worldview.push('belonging_is_sought_under_uncertainty');
  }

  return dedup(worldview);
}

function inferRelationshipPhilosophy(userTextLower: string): string[] {
  const philosophy = matchKeywords(userTextLower, RELATIONSHIP_PHILOSOPHY_KEYWORDS);

  if (
    containsAny(userTextLower, ['忠诚', '信任', 'loyalty', 'trust']) &&
    containsAny(
      userTextLower,
      ['难测量', '不可测', '不能验证', '无法验证', 'hard to measure', 'cannot be measured', 'cannot be tested']
    )
  ) {
    philosophy.push('trust_cannot_be_forced');
  }

  if (containsAny(userTextLower, ['关系', 'relationship']) && containsAny(userTextLower, ['变化', '无常', 'drift', 'impermanence'])) {
    philosophy.push('relationships_change_with_context');
  }

  return dedup(philosophy);
}

function inferConversationStyle(
  userMessages: ConversationMessage[],
  userTextLower: string,
  thinkingPath: string[]
): string[] {
  const styles = matchKeywords(userTextLower, CONVERSATION_STYLE_KEYWORDS);
  const hasStructuredForm = userMessages.some(message => STRUCTURED_PATTERNS.some(pattern => pattern.test(message.text)));

  if (hasStructuredForm) {
    styles.push('structured_thinking');
  }
  if (thinkingPath.length >= 3) {
    styles.push('chain_reasoning');
  }
  if (containsAny(userTextLower, COMPARATIVE_PATTERNS)) {
    styles.push('comparative_reasoning');
  }
  if ((userTextLower.match(/[?？]/g) || []).length >= 2) {
    styles.push('exploratory_dialogue');
  }
  if (containsAny(userTextLower, ['概念', '结构', '系统', '本质', 'concept', 'structure', 'system', 'essence'])) {
    styles.push('concept_driven_dialogue');
  }

  return dedup(styles);
}

function extractThinkingPath(userMessages: ConversationMessage[]): string[] {
  const orderedMatches: string[] = [];

  userMessages.forEach(message => {
    const textLower = message.text.toLowerCase();
    Object.entries(THINKING_PATH_KEYWORDS).forEach(([tag, keywords]) => {
      if (!orderedMatches.includes(tag) && keywords.some(keyword => textLower.includes(keyword.toLowerCase()))) {
        orderedMatches.push(tag);
      }
    });
  });

  return orderedMatches;
}

function extractExplicitQuestions(userMessages: ConversationMessage[], language: InsightLanguage): string[] {
  const questions: string[] = [];

  userMessages.forEach(message => {
    const parts = message.text
      .split(/[?？]/)
      .map(part => sanitizeQuestion(part))
      .filter(Boolean);

    parts.forEach(part => {
      if (questions.length >= 2) {
        return;
      }
      const normalized = normalizeQuestionLabel(part, language);
      if (normalized) {
        questions.push(normalized);
      }
    });
  });

  return dedup(questions);
}

function sanitizeQuestion(text: string): string {
  return text
    .replace(/[\r\n]+/g, ' ')
    .replace(/^[\s,.;:!，。；：！？-]+/, '')
    .trim();
}

function normalizeQuestionLabel(text: string, language: InsightLanguage): string | null {
  if (!text) return null;
  if (text.length < 8) return null;

  const compact = text.replace(/\s+/g, ' ').trim();
  const maxLength = language === 'zh' ? 22 : 70;

  if (compact.length > maxLength) {
    return `${compact.slice(0, maxLength).trim()}...`;
  }

  return compact;
}

function matchKeywords(text: string, dictionary: Record<string, string[]>): string[] {
  const matches: string[] = [];

  Object.entries(dictionary).forEach(([tag, keywords]) => {
    if (keywords.some(keyword => text.includes(keyword.toLowerCase()))) {
      matches.push(tag);
    }
  });

  return matches;
}

function containsAny(text: string, keywords: string[]): boolean {
  return keywords.some(keyword => text.includes(keyword.toLowerCase()));
}

function buildSummaryText(extraction: ConversationExtraction, language: InsightLanguage): string {
  const topThinking = extraction.thinkingStyle.slice(0, 2).map(item => formatInsightTag(item, language));
  const topQuestions = extraction.coreQuestions.slice(0, 2).map(item => formatInsightTag(item, language));
  const topWorldview = extraction.worldview.slice(0, 2).map(item => formatInsightTag(item, language));
  const topRelationship = extraction.relationshipPhilosophy.slice(0, 2).map(item => formatInsightTag(item, language));
  const path = extraction.thinkingPath.slice(0, 5).map(item => formatInsightTag(item, language)).join(' -> ');

  if (language === 'zh') {
    const parts: string[] = [];
    if (topThinking.length > 0) parts.push(`你的思考方式更接近${topThinking.join('、')}`);
    if (topQuestions.length > 0) parts.push(`你反复在追问${topQuestions.join('、')}`);
    if (topWorldview.length > 0) parts.push(`你对世界的看法里，有${topWorldview.join('、')}`);
    if (topRelationship.length > 0) parts.push(`谈到关系时，你更强调${topRelationship.join('、')}`);
    if (path) parts.push(`这段对话的思路大致沿着 ${path} 展开`);
    return parts.length > 0 ? `${parts.join('。')}。` : '这段对话里，已经出现了一些值得你确认的思考结构。';
  }

  const parts: string[] = [];
  if (topThinking.length > 0) parts.push(`Your thinking style leans toward ${topThinking.join(', ')}`);
  if (topQuestions.length > 0) parts.push(`you keep returning to questions like ${topQuestions.join(', ')}`);
  if (topWorldview.length > 0) parts.push(`your worldview includes ${topWorldview.join(', ')}`);
  if (topRelationship.length > 0) parts.push(`in relationships you emphasize ${topRelationship.join(', ')}`);
  if (path) parts.push(`the conversation roughly moves through ${path}`);
  return parts.length > 0 ? `${parts.join('. ')}.` : 'This conversation already reveals a few thinking structures worth confirming.';
}

function dedup(items: string[]): string[] {
  return [...new Set(items.filter(Boolean))];
}

function hasMeaningfulUnderstanding(data: {
  summaryText?: string;
  thinkingStyle?: string[];
  coreQuestions?: string[];
  worldview?: string[];
  relationshipPhilosophy?: string[];
  conversationStyle?: string[];
  thinkingPath?: string[];
  preferredResponseStyle?: string;
}): boolean {
  return Boolean(
    data.thinkingStyle?.length ||
      data.coreQuestions?.length ||
      data.worldview?.length ||
      data.relationshipPhilosophy?.length ||
      data.conversationStyle?.length ||
      data.thinkingPath?.length ||
      data.preferredResponseStyle
  );
}

// Session insight storage

export function readSessionInsights(): SessionInsight[] {
  try {
    const raw = localStorage.getItem(SESSION_INSIGHTS_STORAGE_KEY);
    if (!raw) return [];

    const parsed = JSON.parse(raw) as Array<Partial<SessionInsight> | Record<string, unknown>>;
    return parsed
      .map(item => normalizeInsight(item))
      .filter((insight): insight is SessionInsight => Boolean(insight));
  } catch (error) {
    console.error('[UserSummary] Failed to read session insights:', error);
    return [];
  }
}

export function saveSessionInsights(insights: SessionInsight[]): void {
  try {
    localStorage.setItem(SESSION_INSIGHTS_STORAGE_KEY, JSON.stringify(insights));
    console.log('[UserSummary] Session insights saved:', insights.length);
  } catch (error) {
    console.error('[UserSummary] Failed to save session insights:', error);
  }
}

export function clearSessionInsights(): void {
  localStorage.removeItem(SESSION_INSIGHTS_STORAGE_KEY);
  console.log('[UserSummary] Session insights cleared');
}

// Aggregated model storage

export function readUserUnderstandingModel(): UserUnderstandingModel | null {
  try {
    const raw = localStorage.getItem(UNDERSTANDING_MODEL_STORAGE_KEY) ?? localStorage.getItem(LEGACY_PERSONALITY_MODEL_STORAGE_KEY);
    if (!raw) return null;

    return normalizeUnderstandingModel(JSON.parse(raw) as Record<string, unknown>);
  } catch (error) {
    console.error('[UserSummary] Failed to read understanding model:', error);
    return null;
  }
}

export function saveUserUnderstandingModel(model: UserUnderstandingModel): void {
  try {
    localStorage.setItem(UNDERSTANDING_MODEL_STORAGE_KEY, JSON.stringify(model));
    localStorage.removeItem(LEGACY_PERSONALITY_MODEL_STORAGE_KEY);
    console.log('[UserSummary] Understanding model saved:', model);
  } catch (error) {
    console.error('[UserSummary] Failed to save understanding model:', error);
  }
}

export function clearUserUnderstandingModel(): void {
  localStorage.removeItem(UNDERSTANDING_MODEL_STORAGE_KEY);
  localStorage.removeItem(LEGACY_PERSONALITY_MODEL_STORAGE_KEY);
  console.log('[UserSummary] Understanding model cleared');
}

// Backward-compatible aliases
export const readUserPersonalityModel = readUserUnderstandingModel;
export const saveUserPersonalityModel = saveUserUnderstandingModel;
export const clearUserPersonalityModel = clearUserUnderstandingModel;

// ---------------------------------------------------------------------------
// TODO (Spec §八): Incremental model update
// Current buildUserUnderstandingModel does full-rebuild from all insights.
// Should be changed to:
//   1. Generate session summary (topic, emotionalTone, keywords, tension)
//   2. Extract candidate insights from this session
//   3. Compare candidates against existing stable model
//   4. Only persist: new entries, reinforced entries, corrected entries
//   5. Never overwrite stable traits from a single emotional session
//   6. Track confidence per value: initial=0.5, reinforced +0.1, calibrated ±0.15
//   7. Promote candidate → stable when confidence >= 0.75 AND reinforcementCount >= 3
// ---------------------------------------------------------------------------

// TODO (Spec §九): Calibration integration
// After saveApprovedSummary, check if any new high-confidence candidate exists.
// If so, return it as a CalibrationPrompt for the UI to display.
// User response ("like_me" / "not_like_me") feeds back into confidence.
// ---------------------------------------------------------------------------

// Confirmed-summary orchestration

export function hasMeaningfulExtraction(extraction: ConversationExtraction): boolean {
  return hasMeaningfulUnderstanding(extraction);
}

import { doc, setDoc, serverTimestamp } from 'firebase/firestore';
import { db } from './firebase';

export async function saveApprovedSummary(
  extraction: ConversationExtraction,
  uid?: string,
  sessionId?: string
): Promise<{
  insight: SessionInsight;
  model: UserUnderstandingModel | null;
  insightCount: number;
}> {
  const insight = createSessionInsight(extraction);
  const insights = [...readSessionInsights(), insight];
  saveSessionInsights(insights);

  localStorage.removeItem(LEGACY_SUMMARY_STORAGE_KEY);

  let model: UserUnderstandingModel | null = null;
  if (insights.length >= MIN_INSIGHTS_FOR_MODEL) {
    model = buildUserUnderstandingModel(insights);
    saveUserUnderstandingModel(model);
  }

  // Persist to Firestore if authenticated
  if (uid) {
    try {
      // Use the provided sessionId, or generate a new one if it's missing
      const finalSessionId = sessionId || crypto.randomUUID();
      const insightRef = doc(db, 'users', uid, 'reflectInsights', finalSessionId);
      await setDoc(insightRef, {
        ...insight,
        updatedAt: serverTimestamp()
      }, { merge: true });

      // Always save the latest insight to soulProfile as the current snapshot
      // even if we don't have enough insights for a full aggregated model yet
      const userRef = doc(db, 'users', uid);
      const soulProfileUpdate: any = {
        reflectModel: {
          latestInsight: {
            ...insight,
            updatedAt: serverTimestamp()
          }
        }
      };

      if (model) {
        soulProfileUpdate.reflectModel.aggregated = {
          ...model,
          updatedAt: serverTimestamp()
        };
      }

      await setDoc(userRef, { soulProfile: soulProfileUpdate }, { merge: true });
      console.log('[UserSummary] Persisted to Firestore successfully with sessionId:', finalSessionId);
    } catch (error) {
      console.error('[UserSummary] Failed to persist to Firestore:', error);
    }
  }

  console.log('[UserSummary] Approved summary saved:', {
    approvedExtraction: extraction,
    insight,
    insightCount: insights.length,
    modelUpdated: Boolean(model),
  });

  return { insight, model, insightCount: insights.length };
}

export function rebuildAggregatedUnderstandingModel(): UserUnderstandingModel | null {
  const insights = readSessionInsights();
  if (insights.length < MIN_INSIGHTS_FOR_MODEL) {
    clearUserUnderstandingModel();
    return null;
  }

  const model = buildUserUnderstandingModel(insights);
  saveUserUnderstandingModel(model);
  return model;
}

export const rebuildAggregatedPersonalityModel = rebuildAggregatedUnderstandingModel;

export function readBestAvailableMatchingProfile(): {
  source: 'aggregated_model' | 'session_insights_fallback' | 'none';
  profile: UserUnderstandingModel | null;
  insightCount: number;
} {
  const model = readUserUnderstandingModel();
  if (model) {
    return {
      source: 'aggregated_model',
      profile: model,
      insightCount: model.sourceInsightCount,
    };
  }

  const insights = readSessionInsights();
  if (insights.length > 0) {
    return {
      source: 'session_insights_fallback',
      profile: buildUserUnderstandingModel(insights, 1),
      insightCount: insights.length,
    };
  }

  return { source: 'none', profile: null, insightCount: 0 };
}

function createSessionInsight(extraction: ConversationExtraction): SessionInsight {
  const timestamp = Date.now();

  return {
    id: crypto.randomUUID?.() ?? `insight_${timestamp}_${Math.random().toString(36).slice(2, 8)}`,
    source: 'reflect',
    approvedByUser: true,
    createdAt: timestamp,
    approvedAt: timestamp,
    ...extraction,
  };
}

function normalizeInsight(raw: Partial<SessionInsight> | Record<string, unknown>): SessionInsight | null {
  if (!raw) return null;

  const timestamp =
    typeof raw.createdAt === 'number'
      ? raw.createdAt
      : typeof raw.approvedAt === 'number'
        ? raw.approvedAt
        : Date.now();

  const normalized: SessionInsight = {
    id: typeof raw.id === 'string' ? raw.id : `insight_${timestamp}`,
    source: 'reflect',
    approvedByUser: true,
    createdAt: timestamp,
    approvedAt: typeof raw.approvedAt === 'number' ? raw.approvedAt : timestamp,
    summaryText: typeof raw.summaryText === 'string' ? raw.summaryText : '',
    thinkingStyle: readStringArray(raw.thinkingStyle),
    coreQuestions: readStringArray(raw.coreQuestions),
    worldview: readStringArray(raw.worldview),
    relationshipPhilosophy: readStringArray(raw.relationshipPhilosophy),
    conversationStyle: dedup([
      ...readStringArray(raw.conversationStyle),
      ...readStringArray((raw as { communicationStyle?: unknown }).communicationStyle),
    ]),
    thinkingPath: readStringArray(raw.thinkingPath),
    preferredResponseStyle:
      typeof raw.preferredResponseStyle === 'string' ? raw.preferredResponseStyle : undefined,
  };

  if (!hasMeaningfulUnderstanding(normalized)) {
    return null;
  }

  if (!normalized.summaryText.trim()) {
    normalized.summaryText = buildSummaryText(normalized, 'zh');
  }

  return normalized;
}

function normalizeUnderstandingModel(raw: Record<string, unknown>): UserUnderstandingModel | null {
  const normalized: UserUnderstandingModel = {
    thinkingStyle: readStringArray(raw.thinkingStyle),
    coreQuestions: readStringArray(raw.coreQuestions),
    worldview: readStringArray(raw.worldview),
    relationshipPhilosophy: dedup([
      ...readStringArray(raw.relationshipPhilosophy),
      ...readStringArray((raw as { relationshipPreferences?: unknown }).relationshipPreferences),
    ]),
    conversationStyle: dedup([
      ...readStringArray(raw.conversationStyle),
      ...readStringArray((raw as { communicationStyle?: unknown }).communicationStyle),
    ]),
    thinkingPath: readStringArray(raw.thinkingPath),
    preferredResponseStyle:
      typeof raw.preferredResponseStyle === 'string' ? raw.preferredResponseStyle : undefined,
    sourceInsightCount: typeof raw.sourceInsightCount === 'number' ? raw.sourceInsightCount : 0,
    lastUpdated: typeof raw.lastUpdated === 'number' ? raw.lastUpdated : Date.now(),
  };

  return hasMeaningfulUnderstanding(normalized) ? normalized : null;
}

function readStringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0);
}

function buildUserUnderstandingModel(
  insights: SessionInsight[],
  manualThreshold?: number
): UserUnderstandingModel {
  const threshold = manualThreshold ?? getStabilityThreshold(insights.length);

  return {
    thinkingStyle: selectStableValues(insights.map(insight => insight.thinkingStyle), threshold),
    coreQuestions: selectStableValues(insights.map(insight => insight.coreQuestions), threshold),
    worldview: selectStableValues(insights.map(insight => insight.worldview), threshold),
    relationshipPhilosophy: selectStableValues(insights.map(insight => insight.relationshipPhilosophy), threshold),
    conversationStyle: selectStableValues(insights.map(insight => insight.conversationStyle), threshold),
    thinkingPath: selectStableValues(insights.map(insight => insight.thinkingPath), threshold),
    preferredResponseStyle: selectDominantValue(
      insights
        .map(insight => insight.preferredResponseStyle)
        .filter((value): value is string => Boolean(value)),
      threshold
    ),
    
    // Aggregate new LLM layers (simple selection for now, could be enhanced later)
    contentSummary: selectDominantValue(insights.map(i => i.contentSummary).filter((v): v is string => Boolean(v)), threshold),
    emotion: selectDominantValue(insights.map(i => i.emotion).filter((v): v is string => Boolean(v)), threshold),
    trigger: selectDominantValue(insights.map(i => i.trigger).filter((v): v is string => Boolean(v)), threshold),
    values: selectDominantValue(insights.map(i => i.values).filter((v): v is string => Boolean(v)), threshold),
    behaviorPattern: selectDominantValue(insights.map(i => i.behaviorPattern).filter((v): v is string => Boolean(v)), threshold),
    decisionModel: selectDominantValue(insights.map(i => i.decisionModel).filter((v): v is string => Boolean(v)), threshold),
    personalityTraits: selectDominantValue(insights.map(i => i.personalityTraits).filter((v): v is string => Boolean(v)), threshold),
    relationshipNeed: selectDominantValue(insights.map(i => i.relationshipNeed).filter((v): v is string => Boolean(v)), threshold),
    motivation: selectDominantValue(insights.map(i => i.motivation).filter((v): v is string => Boolean(v)), threshold),
    coreConflict: selectDominantValue(insights.map(i => i.coreConflict).filter((v): v is string => Boolean(v)), threshold),

    sourceInsightCount: insights.length,
    lastUpdated: Date.now(),
  };
}

function getStabilityThreshold(insightCount: number): number {
  return Math.max(2, Math.ceil(insightCount * 0.4));
}

function selectStableValues(valueGroups: string[][], threshold: number): string[] {
  const counts = new Map<string, number>();

  valueGroups.forEach(group => {
    dedup(group).forEach(value => {
      counts.set(value, (counts.get(value) ?? 0) + 1);
    });
  });

  return [...counts.entries()]
    .filter(([, count]) => count >= threshold)
    .sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]))
    .map(([value]) => value);
}

function selectDominantValue(values: string[], threshold: number): string | undefined {
  const counts = new Map<string, number>();

  values.forEach(value => {
    counts.set(value, (counts.get(value) ?? 0) + 1);
  });

  const sorted = [...counts.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0]));
  if (sorted.length === 0) return undefined;

  const [value, count] = sorted[0];
  return count >= threshold ? value : undefined;
}
