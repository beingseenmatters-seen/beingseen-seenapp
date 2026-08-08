/**
 * The letter's words — clause fragments the Composer weaves into "查看我的理解".
 *
 * This is the ONE authored artifact; it IS Seen's voice. Per the founder's
 * Hybrid decision:
 *   - DRAFTED here: Thinking facet (cognitive slugs) + structural Behaviour
 *     movements + functional scaffold (title/connectors/provenance).
 *   - LEFT BLANK ('') for the founder to author: Meaning, Relationships, the
 *     closing line, and the "what's shifting" note — the emotional core.
 *
 * A blank fragment ('') is intentionally NOT rendered — that part of the letter
 * simply doesn't appear until it is authored, so Seen never says something in a
 * voice that isn't yours. Fragments are second-person CLAUSES designed to
 * connect ("…, and…", "…; yet…") — never full sentences.
 */

import type { MovementId } from '../../data/understanding/movements';

export interface Fragment { zh: string; en: string; }

/** Movement fragments (Behaviour + Meaning facets). Positive-direction phrasing. */
export const MOVEMENT_FRAGMENTS: Record<MovementId, Fragment> = {
  // --- Behaviour · structural (DRAFTED) ---
  direct_expression: { zh: '倾向于把话直接说出口', en: 'tend to say things directly' },
  delayed_expression: { zh: '会等一个合适的时机再开口', en: 'wait for the right moment to speak' },
  boundary_preservation: { zh: '守着自己的节奏和边界', en: 'guard your own pace and space' },
  structure_seeking: { zh: '喜欢先有清楚的安排再往前走', en: 'like a clear plan before moving ahead' },
  responsibility_orientation: { zh: '愿意把该扛的责任扛起来', en: 'take on what is yours to carry' },
  // --- Behaviour · relational (founder-authored, 2026-08) ---
  relationship_preservation: { zh: '对真正在意的人，你愿意持续投入', en: 'with the people who matter, you keep showing up' },
  trust_openness: { zh: '当防备可以慢慢放下时，你也愿意让自己更靠近一些', en: 'when your guard can slowly come down, you let yourself move a little closer' },
  emotional_attunement: { zh: '常会留意对方没有直接说出的情绪变化', en: 'often notice shifts in feeling that the other person has not said directly' },
  conflict_engagement: { zh: '不太回避那些值得谈开的分歧', en: 'do not tend to avoid disagreements that are worth talking through' },
  perspective_taking: { zh: '会先试着站在对方的处境里理解', en: 'try to understand things from where the other person stands' },
  // --- Meaning / Values / Orientation (founder-authored, 2026-08) ---
  meaning_orientation: { zh: '更愿意自己去建立意义，而不是等它被给予', en: 'would rather build meaning yourself than wait for it to be given' },
  autonomy_orientation: { zh: '更愿意依据自己的判断，而不是只跟随外界的声音', en: 'tend to rely on your own judgment rather than simply follow outside voices' },
  stability_orientation: { zh: '看重安稳，也愿意守护已经建立起来的东西', en: 'value steadiness, and tend to protect what has already been built' },
  change_orientation: { zh: '面对变化，你更愿意主动回应，而不是只是等待', en: 'when things are changing, you tend to respond actively rather than simply wait' },
  openness_to_revision: { zh: '愿意回头修正自己的想法', en: 'stay willing to revise how you see things' },
  uncertainty_tolerance: { zh: '能和暂时没有答案的事情相处一阵', en: 'can stay with things that do not have an answer yet' },
};

/** Thinking-facet fragments (Reflect cognitive slugs). Mostly DRAFTED. */
export const THINKING_FRAGMENTS: Record<string, Fragment> = {
  // thinkingStyle
  philosophical_reasoning: { zh: '遇事会往意义和本质上想', en: 'reach for meaning and first principles' },
  systems_thinking: { zh: '习惯从系统和结构去理解世界', en: 'make sense of the world through systems and structure' },
  abstract_analysis: { zh: '喜欢把具体的事抽象成规律', en: 'abstract the particular into patterns' },
  cause_effect_modeling: { zh: '会顺着因果一步步推演', en: 'reason things through cause and effect' },
  pattern_mapping: { zh: '容易看见反复出现的模式', en: 'notice the patterns that keep recurring' },
  dialectical_reasoning: { zh: '能同时握住两种相反的道理', en: 'hold two opposing truths at once' },
  relational_reasoning: { zh: '常从关系的角度去想问题', en: 'think in terms of how things relate' },
  macro_micro_linking: { zh: '会把宏观和具体连起来看', en: 'link the big picture to the concrete' },
  existential_inquiry: { zh: '会追问什么才算值得', en: 'keep asking what actually makes things worth it' },
  // conversationStyle (texture)
  metaphor_usage: { zh: '喜欢用比喻把事情说清楚', en: 'reach for metaphor to make things clear' },
  layered_abstraction: { zh: '会一层层地把想法推进', en: 'move through an idea layer by layer' },
  comparative_reasoning: { zh: '习惯用对照去厘清', en: 'clarify by comparison' },
  reflective_language: { zh: '会回头审视自己的想法', en: 'turn back to examine your own thinking' },
  // analytical worldview (how you read the world)
  systems_follow_incentives: { zh: '相信系统多半被利益驱动', en: 'see systems as driven by incentives' },
  power_and_wealth_shape_collective_order: { zh: '看见权力与财富在塑造秩序', en: 'see power and wealth shaping the order of things' },
  aggregation_tends_toward_dispersion: { zh: '觉得聚合之后终会分散', en: 'sense that what gathers tends to disperse' },
  human_hearts_resist_measurement: { zh: '认为人心难以被精确衡量', en: 'hold that human hearts resist measurement' },
  relationships_live_inside_larger_systems: { zh: '看见个体关系嵌在更大的系统里', en: 'see personal bonds nested in larger systems' },
  // coreQuestions — analytical/existential (DRAFTED); relational ones (FOUNDER)
  what_is_stable_in_human_nature: { zh: '一直在追问人性里什么是稳定的', en: 'keep asking what is stable in human nature' },
  what_drives_human_aggregation: { zh: '好奇人为什么会聚成群体', en: 'wonder why people gather into groups' },
  how_does_entropy_affect_connection: { zh: '在想连接如何抵抗消散', en: 'think about how connection resists coming apart' },
  how_do_power_and_wealth_shape_order: { zh: '关注权力与财富如何塑造秩序', en: 'attend to how power and wealth shape order' },
  how_do_individual_bonds_survive_systems: { zh: '在想个体关系如何在大系统中存续', en: 'wonder how personal bonds survive inside systems' },
  what_makes_relationships_endure: { zh: '你常常在想，是什么让一段关系走得长久', en: 'you often wonder what lets a relationship last' },
  what_allows_real_trust: { zh: '你在意，真正的信任究竟从何而来', en: 'you care about where real trust actually comes from' },
  can_loyalty_be_measured: { zh: '你会追问，忠诚能不能被看见、被确认', en: 'you keep asking whether loyalty can ever be seen and confirmed' },
  how_do_relationships_change_over_time: { zh: '你会留意，关系如何随时间悄悄改变', en: 'you notice how bonds quietly shift over time' },
};

/** Letter scaffold. Title/connectors/provenance DRAFTED; closing + shift FOUNDER. */
export const LETTER_SCAFFOLD = {
  title: { zh: '此刻，Seen 这样理解你', en: 'How Seen understands you today' },
  // connectors weave facets into one voice (structural — founder may refine)
  open_thinking: { zh: '你', en: 'You ' },
  connect_behaviour: { zh: '这份感觉也在你与人相处时显现：你', en: 'That shows up in how you relate, too: you ' },
  connect_meaning: { zh: '再往里看，你', en: 'Underneath it, you ' },
  closing: { zh: '这份理解，还会随着时间慢慢长出来。', en: 'this understanding will keep taking shape over time.' },
  // Tentative by rule; only rendered when there is genuine recent evidence of change.
  shifting_prefix: { zh: '最近，Seen 似乎又多看见了一点：', en: 'lately, Seen seems to have noticed something more:' },
  provenance: { zh: '这份理解来自你的 Moments 与 Reflect，会随你继续使用而更新。', en: 'This comes from your Moments and Reflect, and updates as you keep using Seen.' },
};

export function isBlank(f: Fragment | undefined): boolean {
  return !f || (!f.zh.trim() && !f.en.trim());
}

/**
 * The exact slots left for founder authorship (a checklist). Everything else is
 * drafted above and can be edited freely.
 */
export const FOUNDER_SLOTS = {
  meaning_movements: [
    'meaning_orientation', 'autonomy_orientation', 'stability_orientation',
    'change_orientation', 'openness_to_revision', 'uncertainty_tolerance',
  ],
  relational_movements: [
    'relationship_preservation', 'trust_openness', 'emotional_attunement',
    'conflict_engagement', 'perspective_taking',
  ],
  relational_questions: [
    'what_makes_relationships_endure', 'what_allows_real_trust',
    'can_loyalty_be_measured', 'how_do_relationships_change_over_time',
  ],
  scaffold: ['closing', 'shifting_prefix'],
} as const;
