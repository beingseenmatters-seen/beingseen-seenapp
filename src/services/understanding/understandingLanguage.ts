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
const FOUNDER: Fragment = { zh: '', en: '' }; // authored later

/** Movement fragments (Behaviour + Meaning facets). Positive-direction phrasing. */
export const MOVEMENT_FRAGMENTS: Record<MovementId, Fragment> = {
  // --- Behaviour · structural (DRAFTED) ---
  direct_expression: { zh: '倾向于把话直接说出口', en: 'tend to say things directly' },
  delayed_expression: { zh: '会等一个合适的时机再开口', en: 'wait for the right moment to speak' },
  boundary_preservation: { zh: '守着自己的节奏和边界', en: 'guard your own pace and space' },
  structure_seeking: { zh: '喜欢先有清楚的安排再往前走', en: 'like a clear plan before moving ahead' },
  responsibility_orientation: { zh: '愿意把该扛的责任扛起来', en: 'take on what is yours to carry' },
  // --- Behaviour · relational (FOUNDER — emotionally central) ---
  relationship_preservation: FOUNDER,
  trust_openness: FOUNDER,
  emotional_attunement: FOUNDER,
  conflict_engagement: FOUNDER,
  perspective_taking: FOUNDER,
  // --- Meaning / Values / Orientation (FOUNDER — emotionally central) ---
  meaning_orientation: FOUNDER,
  autonomy_orientation: FOUNDER,
  stability_orientation: FOUNDER,
  change_orientation: FOUNDER,
  openness_to_revision: FOUNDER,
  uncertainty_tolerance: FOUNDER,
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
  what_makes_relationships_endure: FOUNDER,
  what_allows_real_trust: FOUNDER,
  can_loyalty_be_measured: FOUNDER,
  how_do_relationships_change_over_time: FOUNDER,
};

/** Letter scaffold. Title/connectors/provenance DRAFTED; closing + shift FOUNDER. */
export const LETTER_SCAFFOLD = {
  title: { zh: '此刻，Seen 这样理解你', en: 'How Seen understands you today' },
  // connectors weave facets into one voice (structural — founder may refine)
  open_thinking: { zh: '你', en: 'You ' },
  connect_behaviour: { zh: '这份感觉也在你与人相处时显现：你', en: 'That shows up in how you relate, too: you ' },
  connect_meaning: { zh: '再往里看，你', en: 'Underneath it, you ' },
  closing: FOUNDER, // the final line — founder authored
  shifting_prefix: FOUNDER, // "Seen 还在继续认识你。最近…" — founder authored
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
