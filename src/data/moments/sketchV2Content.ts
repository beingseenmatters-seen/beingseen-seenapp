/**
 * Sketch Engine V2 content library — Movement-level observation clauses and
 * delta framings (drafted 2026-07-29; bilingual 2026-08-04).
 *
 * Every user-visible sentence a V2 sketch can contain is assembled ONLY from
 * the fixed fragments below — no free-form generation, identical policy to
 * Summary Engine V1. The audit stage verifies the output is an exact
 * concatenation of these fragments.
 *
 * BILINGUAL: every fragment carries Chinese and native English. English is
 * not a literal translation — it preserves the same behavioural observation
 * in natural English. Both languages share the same block ids, so provenance
 * and Human Understanding structure stay identical across locales.
 *
 * Structure of one sketch sentence:  framing + clause + stop
 *  - clause: one observation per (Movement, polarity), standalone and gentle.
 *  - framing: carries the delta meaning (newly noticed / clearer / revised /
 *    still true). Several per class; the engine rotates them deterministically
 *    and never repeats the framing used for the same class in the previous
 *    sketch, so no fixed reusable opening emerges.
 *
 * Internal delta labels (NEW/STRENGTHENED/…) are never rendered.
 */

import type { LocalizedText } from '../../types/moments';
import type { MovementId } from '../understanding/movements';

export type ClausePolarity = 'positive' | 'negative';

export interface MovementClause {
  /** Stable content-block id (provenance). */
  id: string;
  movementId: MovementId;
  polarity: ClausePolarity;
  /** Standalone observation sentence body (no trailing stop). */
  text: LocalizedText;
}

/**
 * One observation clause per Movement direction that the Movement Library
 * defines. delayed_expression / emotional_attunement / meaning_orientation
 * are positive-only in the library, so they have no negative clause here.
 */
export const MOVEMENT_CLAUSES: MovementClause[] = [
  {
    id: 'clause_relationship_preservation_pos',
    movementId: 'relationship_preservation',
    polarity: 'positive',
    text: {
      zh: '关系遇到磕绊时，你更愿意花力气去修，而不是轻易放手',
      en: 'when a relationship hits a rough patch, you\u2019d rather put in the work to mend it than walk away easily',
    },
  },
  {
    id: 'clause_relationship_preservation_neg',
    movementId: 'relationship_preservation',
    polarity: 'negative',
    text: {
      zh: '对一段一直在消耗的关系，你不会勉强自己硬撑，该放手时你放得下',
      en: 'when a relationship keeps draining you, you don\u2019t force yourself to stay — you can let go when it\u2019s time',
    },
  },
  {
    id: 'clause_boundary_preservation_pos',
    movementId: 'boundary_preservation',
    polarity: 'positive',
    text: {
      zh: '你的善意是有边界的——能给的给得自然，给不了的也不勉强自己答应',
      en: 'your kindness has edges — you give what you can freely, and you don\u2019t promise what you can\u2019t',
    },
  },
  {
    id: 'clause_boundary_preservation_neg',
    movementId: 'boundary_preservation',
    polarity: 'negative',
    text: {
      zh: '你常常把别人的需要放在自己的边界前面，那条线画得比较松',
      en: 'other people\u2019s needs often come before your own boundaries — that line stays fairly soft',
    },
  },
  {
    id: 'clause_direct_expression_pos',
    movementId: 'direct_expression',
    polarity: 'positive',
    text: {
      zh: '心里有话，你倾向当面说出来，不太绕弯',
      en: 'when something is on your mind, you tend to say it out loud — without much circling around',
    },
  },
  {
    id: 'clause_direct_expression_neg',
    movementId: 'direct_expression',
    polarity: 'negative',
    text: {
      zh: '很多感受你先收在心里，不急着说出口',
      en: 'a lot of what you feel you keep to yourself first — you\u2019re in no rush to say it out loud',
    },
  },
  {
    id: 'clause_delayed_expression_pos',
    movementId: 'delayed_expression',
    polarity: 'positive',
    text: {
      zh: '想说的话你会说，但你讲时机——等一个合适的时刻再开口',
      en: 'you will say what you mean — but you wait for the right moment before you speak',
    },
  },
  {
    id: 'clause_emotional_attunement_pos',
    movementId: 'emotional_attunement',
    polarity: 'positive',
    text: {
      zh: '情绪的起伏你接得很敏——别人的，也包括自己的，你会去回应它们',
      en: 'you pick up on emotional shifts quickly — other people\u2019s, and your own, and you respond to them',
    },
  },
  {
    id: 'clause_perspective_taking_pos',
    movementId: 'perspective_taking',
    polarity: 'positive',
    text: {
      zh: '评判在你这里来得慢——你更愿意先看看对方所处的位置，再下结论',
      en: 'judgment comes slowly for you — you\u2019d rather see where someone stands before you decide',
    },
  },
  {
    id: 'clause_perspective_taking_neg',
    movementId: 'perspective_taking',
    polarity: 'negative',
    text: {
      zh: '你下判断比较快，第一印象在你那里分量不小',
      en: 'you tend to judge quickly — first impressions carry real weight with you',
    },
  },
  {
    id: 'clause_structure_seeking_pos',
    movementId: 'structure_seeking',
    polarity: 'positive',
    text: {
      zh: '你喜欢事情有个章法：先计划、先说清楚，再开始',
      en: 'you like things to have a shape: plan first, get clear, then begin',
    },
  },
  {
    id: 'clause_structure_seeking_neg',
    movementId: 'structure_seeking',
    polarity: 'negative',
    text: {
      zh: '你不太需要把一切安排好才动身，松一点的安排反而让你自在',
      en: 'you don\u2019t need everything lined up before you start — a looser plan often suits you better',
    },
  },
  {
    id: 'clause_autonomy_orientation_pos',
    movementId: 'autonomy_orientation',
    polarity: 'positive',
    text: {
      zh: '你的标准更多长在自己身上，别人怎么走，不太左右你的步子',
      en: 'your standards live mostly inside you — how others move doesn\u2019t set your pace',
    },
  },
  {
    id: 'clause_autonomy_orientation_neg',
    movementId: 'autonomy_orientation',
    polarity: 'negative',
    text: {
      zh: '别人的进度和眼光，会时不时走进你的坐标系',
      en: 'other people\u2019s progress and opinions still walk into your frame of reference from time to time',
    },
  },
  {
    id: 'clause_responsibility_orientation_pos',
    movementId: 'responsibility_orientation',
    polarity: 'positive',
    text: {
      zh: '出了事，你习惯先把责任接过来，把结果算在自己的努力上',
      en: 'when something goes wrong, you tend to take responsibility first — and count the result against your own effort',
    },
  },
  {
    id: 'clause_responsibility_orientation_neg',
    movementId: 'responsibility_orientation',
    polarity: 'negative',
    text: {
      zh: '你觉得很多结果并不全在自己手里，运气和大环境占了不小的比重',
      en: 'you see that many outcomes aren\u2019t fully in your hands — luck and the wider context weigh heavily too',
    },
  },
  {
    id: 'clause_uncertainty_tolerance_pos',
    movementId: 'uncertainty_tolerance',
    polarity: 'positive',
    text: {
      zh: '悬而未决的事，你放得住——不急着要一个答案',
      en: 'you can sit with things left open — you don\u2019t rush to force an answer',
    },
  },
  {
    id: 'clause_uncertainty_tolerance_neg',
    movementId: 'uncertainty_tolerance',
    polarity: 'negative',
    text: {
      zh: '没有确定下来的事会让你悬着心，你更想先要一个准信',
      en: 'unsettled things keep you on edge — you\u2019d rather have a clear answer first',
    },
  },
  {
    id: 'clause_openness_to_revision_pos',
    movementId: 'openness_to_revision',
    polarity: 'positive',
    text: {
      zh: '你愿意改写自己原来的看法——旧的框不合适了，你换得动',
      en: 'you\u2019re willing to rewrite an old view — when the old frame no longer fits, you can change it',
    },
  },
  {
    id: 'clause_openness_to_revision_neg',
    movementId: 'openness_to_revision',
    polarity: 'negative',
    text: {
      zh: '你认定的框架不太容易松动，第一版理解在你那里很牢',
      en: 'the frames you settle on don\u2019t loosen easily — a first reading tends to stay firm with you',
    },
  },
  {
    id: 'clause_stability_orientation_pos',
    movementId: 'stability_orientation',
    polarity: 'positive',
    text: {
      zh: '把日子过稳，在你这里排得很靠前——先把底垫牢，其他慢慢来',
      en: 'keeping life steady ranks high for you — secure the ground first, and let the rest come in time',
    },
  },
  {
    id: 'clause_stability_orientation_neg',
    movementId: 'stability_orientation',
    polarity: 'negative',
    text: {
      zh: '安稳在你那里不是第一位的——为了可能性，你愿意让日子晃一晃',
      en: 'stability isn\u2019t always first for you — for the sake of possibility, you\u2019ll let life sway a little',
    },
  },
  {
    id: 'clause_change_orientation_pos',
    movementId: 'change_orientation',
    polarity: 'positive',
    text: {
      zh: '事情来了你不太观望，先动起来是你的本能',
      en: 'when something arrives, you don\u2019t tend to wait and watch — moving first is instinct',
    },
  },
  {
    id: 'clause_change_orientation_neg',
    movementId: 'change_orientation',
    polarity: 'negative',
    text: {
      zh: '你更愿意让事情先落一落、看清楚了再动',
      en: 'you\u2019d rather let things settle and see them clearly before you move',
    },
  },
  {
    id: 'clause_trust_openness_pos',
    movementId: 'trust_openness',
    polarity: 'positive',
    text: {
      zh: '你倾向把人往好处想，也愿意随着了解慢慢敞开',
      en: 'you tend to give people the benefit of the doubt — and open up as you get to know them',
    },
  },
  {
    id: 'clause_trust_openness_neg',
    movementId: 'trust_openness',
    polarity: 'negative',
    text: {
      zh: '你对人保持着一分警觉——敞开是逐步的、有筛选的',
      en: 'you keep a careful watch with people — opening up is gradual, and selective',
    },
  },
  {
    id: 'clause_conflict_engagement_pos',
    movementId: 'conflict_engagement',
    polarity: 'positive',
    text: {
      zh: '有分歧时，你愿意把它摆到桌面上，跟当事人直接谈',
      en: 'when there\u2019s a disagreement, you\u2019re willing to put it on the table and talk it through directly',
    },
  },
  {
    id: 'clause_conflict_engagement_neg',
    movementId: 'conflict_engagement',
    polarity: 'negative',
    text: {
      zh: '碰到摩擦，你常选择绕一绕，先把表面的和气留住',
      en: 'when friction shows up, you often go around it — keeping the surface calm for now',
    },
  },
  {
    id: 'clause_meaning_orientation_pos',
    movementId: 'meaning_orientation',
    polarity: 'positive',
    text: {
      zh: '意义感这件事，你是主动去搭的——亲身体验、被人需要，都是你的来源',
      en: 'a sense of meaning is something you actively build — lived experience, and being needed, are both sources for you',
    },
  },
];

export interface SketchFraming {
  /** Stable framing id (provenance variant id). */
  id: string;
  /** Sentence prefix; flows into the clause that follows. */
  text: LocalizedText;
}

/** Framings for a Movement seen for the first time. */
export const FRAMINGS_NEW: SketchFraming[] = [
  { id: 'frame_new_1', text: { zh: '这一次，有一笔是新的——', en: 'This time, something new showed up — ' } },
  { id: 'frame_new_2', text: { zh: '这次多了一个之前没有出现过的侧面：', en: 'This time another side appeared that hadn\u2019t shown before: ' } },
  { id: 'frame_new_3', text: { zh: 'Seen 第一次看到你的这一面：', en: 'Seen is seeing this side of you for the first time: ' } },
];

/** Framings for an understanding that this session made clearer. */
export const FRAMINGS_STRENGTHENED: SketchFraming[] = [
  { id: 'frame_strengthened_1', text: { zh: '有一点，这次变得更清楚了：', en: 'One thing grew clearer this time: ' } },
  { id: 'frame_strengthened_2', text: { zh: '上次还只是隐约的一笔，这次更确定了些——', en: 'What was only a faint line before feels more certain now — ' } },
  { id: 'frame_strengthened_3', text: { zh: '再一次的选择，让这一笔加深了：', en: 'Choosing again deepened this stroke: ' } },
];

/** Framings for an understanding whose direction this session reversed. */
export const FRAMINGS_REVISED: SketchFraming[] = [
  { id: 'frame_revised_1', text: { zh: '有一处，和 Seen 之前的理解不太一样——', en: 'One place no longer matches what Seen understood before — ' } },
  { id: 'frame_revised_2', text: { zh: 'Seen 需要改一改之前的一笔：', en: 'Seen needs to revise an earlier stroke: ' } },
  { id: 'frame_revised_3', text: { zh: '这次的选择，让 Seen 重新想了想——', en: 'This round of choices made Seen think again — ' } },
];

/** Framings for an understanding that moved without reversing. */
export const FRAMINGS_SHIFTED: SketchFraming[] = [
  { id: 'frame_shifted_1', text: { zh: '有一笔的方向，似乎在慢慢变化——', en: 'One stroke seems to be shifting direction — ' } },
  { id: 'frame_shifted_2', text: { zh: '这一处没有翻转，但确实在移动：', en: 'This part hasn\u2019t flipped, but it is moving: ' } },
];

/** Framings for continuity sentences (stable understanding, still true). */
export const FRAMINGS_REINFORCED: SketchFraming[] = [
  { id: 'frame_reinforced_1', text: { zh: '而有些部分依然很稳：', en: 'And some parts remain steady: ' } },
  { id: 'frame_reinforced_2', text: { zh: '不变的是——', en: 'What hasn\u2019t changed — ' } },
  { id: 'frame_reinforced_3', text: { zh: '在这些变化旁边，有一笔一直都在：', en: 'Beside these changes, one stroke has been there all along: ' } },
];

/** Opening framings when a session produced no meaningful delta. */
export const FRAMINGS_CONFIRMATION: SketchFraming[] = [
  { id: 'frame_confirmation_1', text: { zh: '这一轮没有带来太多新的笔画，更多是印证——', en: 'This round didn\u2019t add many new strokes — more a confirmation — ' } },
  { id: 'frame_confirmation_2', text: { zh: '这次的选择，大都落在 Seen 已经认识的你上：', en: 'These choices mostly landed on the you Seen already knows: ' } },
];

/**
 * Connectives for baseline (Sketch 01) sentences — the first sketch has no
 * prior understanding to compare against, so observations stand on their own,
 * joined in the approved voice. Index = sentence position.
 */
export const BASELINE_CONNECTIVES: LocalizedText[] = [
  { zh: '', en: '' },
  { zh: '而', en: 'And ' },
  { zh: '同时，', en: 'At the same time, ' },
  { zh: '另一方面，', en: 'On the other hand, ' },
];

export const SKETCH_SENTENCE_STOP: LocalizedText = { zh: '。', en: '.' };

/** Resolve a bilingual fragment for the active language (zh fallback). */
export function sketchText(t: LocalizedText, language: 'zh' | 'en'): string {
  return language === 'en' && t.en ? t.en : t.zh;
}

/** Capitalize the first letter of an English sketch for natural paragraph openers. */
export function capitalizeSketchOpening(text: string, language: 'zh' | 'en'): string {
  if (language !== 'en' || !text) return text;
  const first = text.charAt(0);
  if (first >= 'a' && first <= 'z') return first.toUpperCase() + text.slice(1);
  return text;
}

export const SKETCH_V2_ENGINE_VERSION = 'Sketch Engine V2 · continuity+delta · bilingual 2026-08-04';
