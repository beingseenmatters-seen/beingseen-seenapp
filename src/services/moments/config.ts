/**
 * Moment config access + runtime validation.
 *
 * All pages read Moment content through this module so config parsing rules
 * live in exactly one place. Validation is dependency-free by design.
 */

import type { LocalizedText, MomentDefinition } from '../../types/moments';
import { MOMENT_LIBRARY } from '../../data/moments/library';
import { SIGNAL_INDEX } from '../../data/moments/signals';

const INTERACTION_TYPES = ['single_choice', 'multiple_choice', 'ranking'] as const;
const STATUSES = ['draft', 'active', 'retired'] as const;

function hasZhText(t: LocalizedText | undefined): boolean {
  return !!t && typeof t.zh === 'string' && t.zh.trim().length > 0;
}

/** Returns a list of human-readable problems; an empty list means valid. */
export function validateMomentConfig(moment: MomentDefinition): string[] {
  const errs: string[] = [];
  const where = `Moment ${moment?.id ?? '(missing id)'}`;

  if (!moment || typeof moment.id !== 'string' || !moment.id.trim()) {
    return ['Moment: missing id'];
  }
  if (!Number.isInteger(moment.version) || moment.version < 1) {
    errs.push(`${where}: version must be a positive integer`);
  }
  if (!STATUSES.includes(moment.status)) {
    errs.push(`${where}: invalid status "${moment.status}"`);
  }
  if (!INTERACTION_TYPES.includes(moment.interactionType)) {
    errs.push(`${where}: invalid interactionType "${moment.interactionType}"`);
  }
  if (!hasZhText(moment.title)) errs.push(`${where}: missing title.zh`);
  if (!hasZhText(moment.scenario)) errs.push(`${where}: missing scenario.zh`);

  const options = Array.isArray(moment.options) ? moment.options : [];
  if (options.length < 2) errs.push(`${where}: needs at least 2 options`);

  const seenOptionIds = new Set<string>();
  options.forEach((o) => {
    const optWhere = `${where} option ${o?.id ?? '(missing id)'}`;
    if (!o || typeof o.id !== 'string' || !o.id.trim()) {
      errs.push(`${where}: option missing id`);
      return;
    }
    if (seenOptionIds.has(o.id)) errs.push(`${where}: duplicate option id ${o.id}`);
    seenOptionIds.add(o.id);
    if (!hasZhText(o.text)) errs.push(`${optWhere}: missing text.zh`);
    (o.signals ?? []).forEach((sg) => {
      if (!sg || !SIGNAL_INDEX[sg.signal]) {
        errs.push(`${optWhere}: unknown Signal ID "${sg?.signal}"`);
      }
      if (typeof sg?.delta !== 'number' || Number.isNaN(sg.delta)) {
        errs.push(`${optWhere}: ${sg?.signal} missing numeric delta`);
      }
    });
  });

  if (moment.interactionType === 'multiple_choice') {
    const min = moment.minSelection;
    const max = moment.maxSelection;
    if (!Number.isInteger(min) || !Number.isInteger(max)) {
      errs.push(`${where}: multiple_choice requires integer minSelection and maxSelection`);
    } else if ((min as number) < 1 || (min as number) > (max as number) || (max as number) > options.length) {
      errs.push(`${where}: invalid selection constraints min=${min} max=${max} options=${options.length}`);
    }
  }

  if (moment.interactionType === 'ranking') {
    const maxRank = moment.maxRank;
    if (!Number.isInteger(maxRank) || (maxRank as number) < 1 || (maxRank as number) > options.length) {
      errs.push(`${where}: ranking requires maxRank between 1 and ${options.length}`);
    }
  }

  return errs;
}

/** Validates a whole library (also checks cross-Moment id uniqueness). */
export function validateMomentLibrary(moments: MomentDefinition[]): string[] {
  const errs: string[] = [];
  const ids = new Set<string>();
  moments.forEach((m) => {
    if (m?.id) {
      if (ids.has(m.id)) errs.push(`Duplicate Moment id ${m.id}`);
      ids.add(m.id);
    }
    errs.push(...validateMomentConfig(m));
  });
  return errs;
}

/** Active, valid Moments only — the pool a new session draws from. */
export function getActiveMoments(library: MomentDefinition[] = MOMENT_LIBRARY): MomentDefinition[] {
  return library.filter((m) => m.status === 'active' && validateMomentConfig(m).length === 0);
}

export function getMomentById(
  id: string,
  library: MomentDefinition[] = MOMENT_LIBRARY,
): MomentDefinition | undefined {
  return library.find((m) => m.id === id);
}

/** Resolve localized copy with zh fallback (English Moment copy does not exist yet). */
export function localizedText(t: LocalizedText | undefined, language: 'zh' | 'en'): string {
  if (!t) return '';
  return (language === 'en' && t.en) ? t.en : t.zh;
}
