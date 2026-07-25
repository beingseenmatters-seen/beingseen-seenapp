/**
 * Signal display metadata — ported 1:1 from the approved Previewer source
 * (ENGINEERING/Prototype/data/signals.json, librarySync 2026-07-05).
 *
 * Canonical definitions live in HUMAN_UNDERSTANDING_ENGINE/SIGNAL_LIBRARY/.
 * IDs are permanent. Internal only — never rendered to the person.
 */

import type { SignalMeta } from '../../types/moments';

export const SIGNAL_INDEX: Record<string, SignalMeta> = {
  'EMW-01': { name: 'Acceptance', zh: '接纳', family: 'EMW', status: 'active' },
  'EMW-02': { name: 'Frustration Tolerance', zh: '挫折消化', family: 'EMW', status: 'active' },
  'CHG-01': { name: 'Reframing', zh: '重构', family: 'CHG', status: 'active' },
  'CHG-02': { name: 'Action Bias', zh: '行动倾向', family: 'CHG', status: 'active' },
  'CHG-03': { name: 'Agency', zh: '能动', family: 'CHG', status: 'active' },
  'CHG-07': { name: 'Continuity Preservation', zh: '延续守持', family: 'CHG', status: 'draft' },
  'CHG-08': { name: 'Planning Orientation', zh: '规划先行', family: 'CHG', status: 'draft' },
  'CAR-01': { name: 'Care Expression', zh: '善意付诸', family: 'CAR', status: 'active' },
  'CAR-02': { name: 'Care Commitment', zh: '长期承接', family: 'CAR', status: 'active' },
  'CAR-03': { name: 'Practical Care', zh: '务实关照', family: 'CAR', status: 'active' },
  'CAR-04': { name: 'Responsibility Uptake', zh: '责任上肩', family: 'CAR', status: 'active' },
  'CAR-05': { name: 'Accountability Focus', zh: '问责指向', family: 'CAR', status: 'active' },
  'REL-04': { name: 'Boundary Maintenance', zh: '边界持守', family: 'REL', status: 'active' },
  'REL-05': { name: 'Commitment Caution', zh: '承诺审慎', family: 'REL', status: 'active' },
  'REL-06': { name: 'Relational Generosity', zh: '近亲分享', family: 'REL', status: 'draft' },
  'MEA-01': { name: 'Experiential Meaning', zh: '体验即意义', family: 'MEA', status: 'draft' },
  'MEA-02': { name: 'Contributive Meaning', zh: '有用即意义', family: 'MEA', status: 'draft' },
  'MEA-08': { name: 'Security Priority', zh: '安稳优先', family: 'MEA', status: 'draft' },
  'MEA-09': { name: 'Freedom Seeking', zh: '自由优先', family: 'MEA', status: 'draft' },
  'MEA-11': { name: 'Luck Attribution', zh: '运气归因', family: 'MEA', status: 'active' },
  'MEA-12': { name: 'Structural Attribution', zh: '结构归因', family: 'MEA', status: 'active' },
  'TRU-01': { name: 'Benevolence Assumption', zh: '善意推定', family: 'TRU', status: 'active' },
  'TRU-02': { name: 'Social Caution', zh: '社交警觉', family: 'TRU', status: 'active' },
  'TRU-03': { name: 'System Trust', zh: '系统信任', family: 'TRU', status: 'active' },
  'TRU-04': { name: 'Rule Sensitivity', zh: '规则敏感', family: 'TRU', status: 'active' },
  'TRU-05': { name: 'Judgment Restraint', zh: '判断克制', family: 'TRU', status: 'active' },
  'TRU-06': { name: 'Information Control', zh: '信息守护', family: 'TRU', status: 'active' },
  'TRU-07': { name: 'Disclosure Depth', zh: '敞开程度', family: 'TRU', status: 'active' },
  'MEA-05': { name: 'Internal Anchoring', zh: '内在锚点', family: 'MEA', status: 'draft' },
  'MEA-06': { name: 'Comparison Sensitivity', zh: '比较敏感', family: 'MEA', status: 'draft' },
  'MEA-10': { name: 'Effort Attribution', zh: '努力归因', family: 'MEA', status: 'draft' },
  'EMW-03': { name: 'Anxiety Activation', zh: '焦虑激活', family: 'EMW', status: 'draft' },
  'REL-07': { name: 'Communal Embedding', zh: '熟人环绕', family: 'REL', status: 'draft' },
  'REL-08': { name: 'Anonymity Seeking', zh: '匿名自在', family: 'REL', status: 'draft' },
  'REL-09': { name: 'Selective Connection', zh: '少而真', family: 'REL', status: 'draft' },
  'REL-10': { name: 'Conflict Avoidance', zh: '和气绕行', family: 'REL', status: 'draft' },
  'CHG-05': { name: 'Letting Go', zh: '轻装放手', family: 'CHG', status: 'draft' },
  'CHG-06': { name: 'Past Engagement', zh: '回望有温', family: 'CHG', status: 'draft' },
  'CHG-09': { name: 'Certainty Seeking', zh: '先要确定', family: 'CHG', status: 'draft' },
  'CHG-10': { name: 'Curiosity', zh: '终究想看', family: 'CHG', status: 'draft' },
  'MEA-03': { name: 'Existential Acceptance', zh: '存在自足', family: 'MEA', status: 'draft' },
  'MEA-04': { name: 'Meaning Autonomy', zh: '答案自寻', family: 'MEA', status: 'draft' },
  'EXP-01': { name: 'Directness', zh: '当面说出', family: 'EXP', status: 'draft' },
  'EXP-02': { name: 'Emotional Containment', zh: '心里收着', family: 'EXP', status: 'draft' },
  'EXP-03': { name: 'Strategic Expression', zh: '看时机说', family: 'EXP', status: 'draft' },
  'EMW-04': { name: 'Emotional Economy', zh: '情绪不外借', family: 'EMW', status: 'draft' },
  'EMW-05': { name: 'Present Protection', zh: '护住今天', family: 'EMW', status: 'draft' },
};
