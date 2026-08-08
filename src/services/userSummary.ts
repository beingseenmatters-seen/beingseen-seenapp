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
 *
 * LEGACY STATUS (Phase 3A): this pipeline (saveApprovedSummary → reflectModel /
 * emergentTraits / matchReady) remains the production path and is untouched.
 * The additive Evidence Layer (src/types/evidence.ts,
 * src/services/understanding/) is expected to eventually supersede trait
 * inference for the Living Profile; migration happens in a later phase after
 * the Evidence Layer is validated independently of matching.
 *
 * DEPRECATED (Behaviour & Meaning separation): Reflect must NOT write
 * directly into memory. The agreed Meaning pipeline is
 * Reflect → Evidence → Candidate Theme → Current Understanding
 * (src/services/understanding/currentUnderstanding.ts). This direct-write
 * path stays functional for production compatibility but must not gain new
 * capabilities; it will be replaced by the Meaning pipeline when persistence
 * for the Evidence Layer lands.
 */

import type { AboutMeSignals } from '../auth/providers/types';
import type { EmergentTrait, TraitInferenceMeta } from '../types/emergentTraits';
import type {
  ConversationExtraction,
  SessionInsight,
  UserUnderstandingModel,
} from '../types/userSummary';

import { collection, doc, getDocs, setDoc, serverTimestamp } from 'firebase/firestore';
import { extractReflectSummary } from './seenApi';
import { auth, db } from './firebase';
import { buildSessionPatterns } from './sessionPattern';
import { inferEmergentTraits } from './emergentTraitInference';
import { purgeLegacyGlobalUserCaches, userScopedKey } from './userScopedStorage';
// T-301.1 — single source of truth for readiness. We import the exact functions
// the server eligibility gate uses (lambda/resonance.mjs, pure & dependency-free)
// so the denormalized profile.matchReady flag can never drift from the gate.
import { assembleRIProfile, isEligibleToMatch } from '../../lambda/resonance.mjs';

function currentUid(): string | null {
  return auth.currentUser?.uid ?? null;
}

function purgeInsightLegacyKeys(): void {
  purgeLegacyGlobalUserCaches();
  try {
    localStorage.removeItem(LEGACY_SESSION_INSIGHTS_KEY);
    localStorage.removeItem(LEGACY_UNDERSTANDING_MODEL_KEY);
    localStorage.removeItem(LEGACY_EMERGENT_TRAITS_KEY);
    localStorage.removeItem(LEGACY_PERSONALITY_MODEL_STORAGE_KEY);
    localStorage.removeItem(LEGACY_SUMMARY_STORAGE_KEY);
  } catch {
    // ignore
  }
}

export type InsightLanguage = 'zh' | 'en';

type ConversationMessage = { role: 'user' | 'ai' | 'system'; text: string };

const SESSION_INSIGHTS_KEY_PREFIX = 'seen_session_insights_v2_';
const UNDERSTANDING_MODEL_KEY_PREFIX = 'seen_user_understanding_model_v2_';
const EMERGENT_TRAITS_KEY_PREFIX = 'seen_emergent_traits_v2_';
/** Legacy device-global keys — purged, never migrated. */
const LEGACY_SESSION_INSIGHTS_KEY = 'seen_session_insights';
const LEGACY_UNDERSTANDING_MODEL_KEY = 'seen_user_understanding_model';
const LEGACY_EMERGENT_TRAITS_KEY = 'seen_emergent_traits';
const LEGACY_PERSONALITY_MODEL_STORAGE_KEY = 'seen_user_personality_model';
const LEGACY_SUMMARY_STORAGE_KEY = 'seen_user_summary';
const MIN_INSIGHTS_FOR_MODEL = 1;

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

/**
 * Backend-only extraction (Phase 2B). Calls `/reflect/extract` once and throws
 * on any failure (network, endpoint, malformed or empty response) instead of
 * silently substituting a locally built sentence. The Reflect completion flow
 * uses this so failures surface a visible retry state rather than pretending
 * extraction succeeded.
 */
export async function extractSummaryFromBackend(
  messages: ConversationMessage[],
  options: { preferredResponseStyle?: string; language?: InsightLanguage; uid?: string; sessionId?: string } = {}
): Promise<ConversationExtraction> {
  const language = options.language ?? 'zh';
  const uid = options.uid || 'anonymous';
  const sessionId = options.sessionId || 'unknown';

  const response = await extractReflectSummary({
    uid,
    sessionId,
    conversation: messages,
    module: 'reflect',
    language
  });

  // Repair the Reflect → emergent-trait producer/consumer contract: the backend
  // LLM returns prose "layers" but NOT the categorical slug arrays that emergent
  // trait inference consumes (thinkingStyle/coreQuestions/worldview/…). Derive
  // them here with the SAME deterministic controlled-vocabulary inferers the
  // fallback path uses below, over the SAME conversation input. No new inference
  // logic; the backend prose fields are preserved exactly.
  const userMessages = messages.filter(message => message.role === 'user' && message.text.trim());
  const allMessages = messages.filter(message => message.role !== 'system' && message.text.trim());
  const userTextLower = userMessages.map(message => message.text).join('\n').toLowerCase();
  const allTextLower = allMessages.map(message => message.text).join('\n').toLowerCase();
  const thinkingPath = extractThinkingPath(userMessages);

  const extraction: ConversationExtraction = {
    // Surface the Understanding Update. `summary` (10-layer synthesis)
    // stays internal and is only a fallback for older Lambda deployments.
    summaryText: response.reflection || response.summary || '',
    thinkingStyle: inferThinkingStyle(userTextLower, thinkingPath).slice(0, 4),
    coreQuestions: inferCoreQuestions(userMessages, userTextLower, language).slice(0, 4),
    worldview: inferWorldview(userTextLower, allTextLower).slice(0, 4),
    relationshipPhilosophy: inferRelationshipPhilosophy(userTextLower).slice(0, 4),
    conversationStyle: inferConversationStyle(userMessages, userTextLower, thinkingPath).slice(0, 4),
    thinkingPath: thinkingPath.slice(0, 6),
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

  if (!extraction.summaryText) {
    throw new Error('Empty summary from backend');
  }

  return extraction;
}

export async function extractSummaryFromConversation(
  messages: ConversationMessage[],
  options: { preferredResponseStyle?: string; language?: InsightLanguage; uid?: string; sessionId?: string } = {}
): Promise<ConversationExtraction> {
  const language = options.language ?? 'zh';

  try {
    return await extractSummaryFromBackend(messages, options);
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

    // EX-001: when the backend is unavailable, the reflection must still be a
    // gentle giving-back of the person's own words — never a synthesized portrait.
    // The structured fields above still feed the internal understanding layer.
    extraction.summaryText = buildGentleReflection(userMessages, language);
    return extraction;
  }
}

/**
 * EX-001 §1 gentle reflection (local fallback): hand back the smallest true
 * thing the person said, in their own words. No analysis, no labels, no
 * "you are" — just their own most central line, lightly cleaned.
 */
function buildGentleReflection(
  userMessages: ConversationMessage[],
  language: InsightLanguage,
): string {
  const candidates = userMessages
    .map(message => message.text.replace(/\s+/g, ' ').trim())
    .filter(text => text.length > 0);

  if (candidates.length === 0) {
    return language === 'zh' ? '你来过这里，把它说出口了。' : 'You came here, and you said it out loud.';
  }

  // The most substantive thing they said, preferring later (more settled) lines.
  let chosen = candidates[0];
  for (const text of candidates) {
    if (text.length >= chosen.length) chosen = text;
  }

  const maxLen = language === 'zh' ? 60 : 160;
  if (chosen.length <= maxLen) return chosen;

  const truncated = chosen.slice(0, maxLen);
  const sentenceEnd = Math.max(
    truncated.lastIndexOf('。'), truncated.lastIndexOf('，'),
    truncated.lastIndexOf('.'), truncated.lastIndexOf(','),
  );
  return (sentenceEnd > maxLen * 0.5 ? truncated.slice(0, sentenceEnd) : truncated).trim() + '…';
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

// Session insight storage (uid-scoped offline mirror)

export function readSessionInsights(): SessionInsight[] {
  purgeInsightLegacyKeys();
  const uid = currentUid();
  if (!uid) return [];
  try {
    const raw = localStorage.getItem(userScopedKey(SESSION_INSIGHTS_KEY_PREFIX, uid));
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
  purgeInsightLegacyKeys();
  const uid = currentUid();
  if (!uid) return;
  try {
    localStorage.setItem(userScopedKey(SESSION_INSIGHTS_KEY_PREFIX, uid), JSON.stringify(insights));
    console.log('[UserSummary] Session insights saved:', insights.length);
  } catch (error) {
    console.error('[UserSummary] Failed to save session insights:', error);
  }
}

export function clearSessionInsights(): void {
  purgeInsightLegacyKeys();
  const uid = currentUid();
  if (!uid) return;
  localStorage.removeItem(userScopedKey(SESSION_INSIGHTS_KEY_PREFIX, uid));
  console.log('[UserSummary] Session insights cleared');
}

/**
 * Reflect Durability — hydrate the local Session Insight cache from Firestore.
 *
 * `users/{uid}/reflectInsights` is the durable source of truth for retained
 * Reflect evidence; localStorage is only an offline cache. On login (and on app
 * cold-start with a persisted session) we rebuild the cache from Firestore so
 * future trait inference runs over ALL historical evidence — not only sessions
 * created on this device. Mirrors `hydrateKeptReflections()`.
 *
 * Reconciliation is a union by insight id (Firestore authoritative on collision),
 * so a not-yet-synced local-only insight is never dropped and repeated hydration
 * is idempotent. Empty (signal-less) legacy insights are filtered by
 * `normalizeInsight` and simply contribute nothing — they never dilute inference.
 */
export async function hydrateSessionInsights(): Promise<SessionInsight[]> {
  const uid = currentUid();
  if (!uid) return [];
  try {
    const snapshot = await getDocs(collection(db, 'users', uid, 'reflectInsights'));
    const remote: SessionInsight[] = [];
    for (const docSnap of snapshot.docs) {
      const data = (docSnap.data() ?? {}) as Record<string, unknown>;
      const normalized = normalizeInsight({
        ...data,
        // The durable record id is the insight id; fall back to the doc id.
        id: typeof data.id === 'string' ? data.id : docSnap.id,
      });
      if (normalized) remote.push(normalized);
    }

    // Union by id — Firestore (SSOT) wins on collision, local-only rows are kept.
    const byId = new Map<string, SessionInsight>();
    for (const local of readSessionInsights()) byId.set(local.id, local);
    for (const r of remote) byId.set(r.id, r);
    const merged = Array.from(byId.values()).sort((a, b) => a.approvedAt - b.approvedAt);

    saveSessionInsights(merged);
    rebuildLocalDerivedCaches(merged);
    console.log('[UserSummary] Hydrated session insights from Firestore:', merged.length);
    return merged;
  } catch (error) {
    console.warn(
      '[UserSummary] reflectInsights hydrate failed (keeping local cache if any):',
      error,
    );
    return readSessionInsights();
  }
}

/**
 * Rebuild the local derived caches (understanding model + emergent traits) from a
 * full insight set, so matchReady / traits reflect the hydrated history right away.
 * The next approved Keep recomputes these authoritatively; this only keeps the
 * read-side consistent in the meantime. Local-cache only — never writes Firestore.
 */
function rebuildLocalDerivedCaches(insights: SessionInsight[]): void {
  if (insights.length >= MIN_INSIGHTS_FOR_MODEL) {
    saveUserUnderstandingModel(buildUserUnderstandingModel(insights));
  } else {
    clearUserUnderstandingModel();
  }
  const patterns = buildSessionPatterns(insights);
  const { traits, meta } = inferEmergentTraits(patterns);
  saveEmergentTraits(traits, meta);
}

// Aggregated model storage (uid-scoped; never reads legacy global)

export function readUserUnderstandingModel(): UserUnderstandingModel | null {
  purgeInsightLegacyKeys();
  const uid = currentUid();
  if (!uid) return null;
  try {
    const raw = localStorage.getItem(userScopedKey(UNDERSTANDING_MODEL_KEY_PREFIX, uid));
    if (!raw) return null;

    return normalizeUnderstandingModel(JSON.parse(raw) as Record<string, unknown>);
  } catch (error) {
    console.error('[UserSummary] Failed to read understanding model:', error);
    return null;
  }
}

export function saveUserUnderstandingModel(model: UserUnderstandingModel): void {
  purgeInsightLegacyKeys();
  const uid = currentUid();
  if (!uid) return;
  try {
    localStorage.setItem(userScopedKey(UNDERSTANDING_MODEL_KEY_PREFIX, uid), JSON.stringify(model));
    console.log('[UserSummary] Understanding model saved:', model);
  } catch (error) {
    console.error('[UserSummary] Failed to save understanding model:', error);
  }
}

export function clearUserUnderstandingModel(): void {
  purgeInsightLegacyKeys();
  const uid = currentUid();
  if (!uid) return;
  localStorage.removeItem(userScopedKey(UNDERSTANDING_MODEL_KEY_PREFIX, uid));
  console.log('[UserSummary] Understanding model cleared');
}

export function readEmergentTraits(): EmergentTrait[] {
  purgeInsightLegacyKeys();
  const uid = currentUid();
  if (!uid) return [];
  try {
    const raw = localStorage.getItem(userScopedKey(EMERGENT_TRAITS_KEY_PREFIX, uid));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as { traits?: EmergentTrait[] };
    return Array.isArray(parsed.traits) ? parsed.traits : [];
  } catch (error) {
    console.error('[UserSummary] Failed to read emergent traits:', error);
    return [];
  }
}

export function saveEmergentTraits(traits: EmergentTrait[], meta: TraitInferenceMeta): void {
  purgeInsightLegacyKeys();
  const uid = currentUid();
  if (!uid) return;
  try {
    localStorage.setItem(
      userScopedKey(EMERGENT_TRAITS_KEY_PREFIX, uid),
      JSON.stringify({ traits, meta }),
    );
    console.log('[UserSummary] Emergent traits saved:', traits.length);
  } catch (error) {
    console.error('[UserSummary] Failed to save emergent traits:', error);
  }
}

export function clearEmergentTraits(): void {
  purgeInsightLegacyKeys();
  const uid = currentUid();
  if (!uid) return;
  localStorage.removeItem(userScopedKey(EMERGENT_TRAITS_KEY_PREFIX, uid));
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
  // A backend extraction carries only the user-facing sentence (`summaryText`)
  // with empty structured arrays — that alone is meaningful (Phase 2B).
  return Boolean(extraction.summaryText?.trim()) || hasMeaningfulUnderstanding(extraction);
}

// Helper to remove undefined values before saving to Firestore
function removeUndefined<T extends Record<string, any>>(obj: T): T {
  return Object.entries(obj).reduce((acc, [key, value]) => {
    if (value !== undefined) {
      acc[key as keyof T] = value;
    }
    return acc;
  }, {} as T);
}

/** Prevent Reflect "正在留下" from hanging if Firestore never settles (Android WebView). */
async function withTimeout<T>(promise: Promise<T>, ms: number, label: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([
      promise,
      new Promise<never>((_, reject) => {
        timer = setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms);
      }),
    ]);
  } finally {
    if (timer !== undefined) clearTimeout(timer);
  }
}

/**
 * @deprecated Behaviour & Meaning separation: this writes Reflect output
 * directly into memory (soulProfile.reflectModel / emergentTraits /
 * profile.matchReady), which the agreed architecture forbids. It remains the
 * production path until Evidence Layer persistence lands; the replacement is
 * Reflect → Evidence → Candidate Theme → Current Understanding
 * (src/services/understanding/currentUnderstanding.ts). Do not extend.
 */
export async function saveApprovedSummary(
  extraction: ConversationExtraction,
  uid?: string,
  sessionId?: string,
  options: { aboutMeSignals?: AboutMeSignals; recordId?: string } = {},
): Promise<{
  insight: SessionInsight;
  model: UserUnderstandingModel | null;
  emergentTraits: EmergentTrait[];
  traitInferenceMeta: TraitInferenceMeta | null;
  insightCount: number;
}> {
  // The durable record id is stable across retries of the same approval (Reflect
  // supplies it) so a retry never accumulates duplicates — locally or in Firestore.
  const insight = createSessionInsight(extraction, options.recordId);

  // Compute everything in memory first; commit to the local cache only AFTER the
  // durable Firestore write succeeds. Upsert-by-id keeps retries idempotent.
  const priorInsights = readSessionInsights().filter(existing => existing.id !== insight.id);
  const insights = [...priorInsights, insight];

  let model: UserUnderstandingModel | null = null;
  if (insights.length >= MIN_INSIGHTS_FOR_MODEL) {
    model = buildUserUnderstandingModel(insights);
  }

  const patterns = buildSessionPatterns(insights, options.aboutMeSignals);
  const { traits: emergentTraits, meta: traitInferenceMeta } = inferEmergentTraits(patterns);

  // ---- Durable persistence is AUTHORITATIVE (Reflect Durability Sprint) ----
  // Firestore is the source of truth for retained Reflect evidence. Write it FIRST
  // and let failures THROW so the caller (Reflect) keeps the transcript and shows
  // its retry state — we must never silently report Keep success when the durable
  // write failed. localStorage is only a cache and is committed afterwards.
  console.log(
    '[UserSummary] saveApprovedSummary called with uid:',
    uid,
    'sessionId:',
    sessionId,
    'recordId:',
    insight.id,
  );
  if (uid) {
    const cleanInsight = removeUndefined(insight);
    const cleanModel = model ? removeUndefined(model) : null;

    const FIRESTORE_WRITE_MS = 12_000;

    // One approved Reflect = one durable record, keyed by the stable insight id
    // (NOT sessionId, which may be absent / 'unknown' and can repeat across
    // approvals, overwriting or colliding distinct records). merge keeps a retry
    // of the same record idempotent.
    const insightRef = doc(db, 'users', uid, 'reflectInsights', insight.id);
    await withTimeout(
      setDoc(insightRef, { ...cleanInsight, updatedAt: serverTimestamp() }, { merge: true }),
      FIRESTORE_WRITE_MS,
      'reflectInsights write',
    );

    // Always save the latest insight to soulProfile as the current snapshot even
    // if we don't have enough insights for a full aggregated model yet.
    const userRef = doc(db, 'users', uid);
    const soulProfileUpdate: Record<string, unknown> = {
      reflectModel: {
        latestInsight: { ...cleanInsight, updatedAt: serverTimestamp() },
      },
      emergentTraits,
      traitInferenceMeta,
    };

    if (cleanModel) {
      soulProfileUpdate.reflectModel = {
        ...cleanModel,
        updatedAt: serverTimestamp(),
        latestInsight: (soulProfileUpdate.reflectModel as { latestInsight: unknown }).latestInsight,
      };
    }

    // T-301.1 — denormalized readiness pre-filter for the candidate pool.
    // Derived from the same gate the server applies; flag is a hint, the server
    // re-validates eligibility for every candidate it returns.
    const readinessRI = assembleRIProfile(emergentTraits);
    const matchReady = isEligibleToMatch(
      readinessRI,
      traitInferenceMeta?.insightCount ?? insights.length,
    );

    await withTimeout(
      setDoc(
        userRef,
        {
          soulProfile: soulProfileUpdate,
          profile: { matchReady, updatedAt: serverTimestamp() },
        },
        { merge: true },
      ),
      FIRESTORE_WRITE_MS,
      'user soulProfile write',
    );
    console.log('[UserSummary] Durable persistence confirmed for record:', insight.id);
  } else {
    // Anonymous (no uid): no durable store exists — local-only Keep, as before.
    console.warn('[UserSummary] No uid — local-only Keep (anonymous), no durable persistence.');
  }

  // Commit the local cache only AFTER durable persistence has succeeded (or when
  // there is no uid to persist to). If the awaited writes above threw, we never
  // reach here and the local cache stays unchanged.
  saveSessionInsights(insights);
  localStorage.removeItem(LEGACY_SUMMARY_STORAGE_KEY);
  if (model) {
    saveUserUnderstandingModel(model);
  }
  saveEmergentTraits(emergentTraits, traitInferenceMeta);

  console.log('[UserSummary] Approved summary saved:', {
    insightCount: insights.length,
    modelUpdated: Boolean(model),
    emergentTraitCount: emergentTraits.length,
  });

  return { insight, model, emergentTraits, traitInferenceMeta, insightCount: insights.length };
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

function createSessionInsight(extraction: ConversationExtraction, id?: string): SessionInsight {
  const timestamp = Date.now();

  return {
    // A caller-provided id is the stable durable record id (reused across retries
    // of the same approval — see Reflect handleConfirmSummary). One approved
    // Reflect = one durable record.
    id: id ?? crypto.randomUUID?.() ?? `insight_${timestamp}_${Math.random().toString(36).slice(2, 8)}`,
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
