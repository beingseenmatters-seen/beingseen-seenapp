/**
 * The letter — turns a CurrentUnderstanding into "查看我的理解".
 *
 * HARD RULES (founder-mandated, 2026-08):
 *  1. Never force length. If Seen only truly knows one thing, say one thing.
 *     Length grows only as evidence reinforces across sessions/channels — the
 *     understanding visibly "grows over time," it is never padded from weak
 *     evidence into a full personality portrait.
 *  2. Tentative until reinforced. Firm phrasing ("你…") only for 'clear' items;
 *     otherwise soften ("你似乎…", "Seen 感觉…"). Never sound like Seen knows the
 *     user better than they know themselves.
 *  3. Silence over over-interpretation. Unauthored (blank) fragments and merely-
 *     'forming' signals are not asserted as claims.
 *  4. The "what's shifting" note appears ONLY when given a genuine recent-change
 *     signal (none is produced yet → it stays silent by default).
 *
 * This is deterministic template assembly of founder-authored fragments — no LLM.
 */

import type { MovementId } from '../../data/understanding/movements';
import type { CurrentUnderstanding, FacetId, UnderstandingItem } from './currentUnderstanding';
import {
  LETTER_SCAFFOLD,
  MOVEMENT_FRAGMENTS,
  THINKING_FRAGMENTS,
  isBlank,
  type Fragment,
} from './understandingLanguage';

export type LetterLang = 'zh' | 'en';

export interface UnderstandingLetter {
  title: string;
  /** Body sentences, in order. Zero-length when Seen has nothing yet to say. */
  lines: string[];
  provenance: string;
}

/** An optional, evidence-backed recent-change signal (produced elsewhere later). */
export interface ShiftSignal {
  item: UnderstandingItem;
}

const FACET_ORDER: FacetId[] = ['thinking', 'behaviour', 'meaning'];

function fragmentFor(item: UnderstandingItem): Fragment | undefined {
  return item.representation === 'movement'
    ? MOVEMENT_FRAGMENTS[item.key as MovementId]
    : THINKING_FRAGMENTS[item.key];
}

function authored(item: UnderstandingItem): boolean {
  const f = fragmentFor(item);
  return !!f && !isBlank(f);
}

/** Render one item as a clause, softened unless `firm`. Handles fragments that
 *  already carry a subject ("…，你…") vs. bare verb-phrases. */
function renderClause(item: UnderstandingItem, lang: LetterLang, firm: boolean): string {
  const f = fragmentFor(item);
  if (!f || isBlank(f)) return '';
  const text = lang === 'zh' ? f.zh : f.en;

  if (lang === 'zh') {
    const hasSubject = text.includes('你');
    if (hasSubject) return firm ? text : `Seen 感觉，${text}`;
    return firm ? `你${text}` : `你似乎${text}`;
  }
  const hasSubject = /\byou\b/i.test(text);
  const cap = text.charAt(0).toUpperCase() + text.slice(1);
  if (hasSubject) return firm ? cap : `Seen senses that ${text}`;
  return firm ? `You ${text}` : `You seem to ${text}`;
}

const pick = (f: Fragment, lang: LetterLang) => (lang === 'zh' ? f.zh : f.en);
const period = (lang: LetterLang, s: string) => (lang === 'zh' ? `${s}。` : `${s}.`);

/**
 * Assemble the letter. `shift` is optional and defaults to none — the shifting
 * note only appears with a real recent-change signal.
 */
export function assembleLetter(
  cu: CurrentUnderstanding,
  lang: LetterLang,
  shift?: ShiftSignal,
): UnderstandingLetter {
  const L = LETTER_SCAFFOLD;
  const lines: string[] = [];

  // Solid = reinforced (emerging/clear) AND authored. These drive the real letter.
  const solidByFacet = new Map<FacetId, UnderstandingItem>();
  for (const facet of FACET_ORDER) {
    const top = cu.facets[facet].items.find(
      (i) => authored(i) && (i.confidence === 'emerging' || i.confidence === 'clear'),
    );
    if (top) solidByFacet.set(facet, top);
  }

  if (solidByFacet.size === 0) {
    // Rule 1: thin evidence → say little, honestly. At most one tentative note.
    lines.push(lang === 'zh' ? 'Seen 还在慢慢认识你。' : 'Seen is still getting to know you.');
    const forming = FACET_ORDER.flatMap((f) => cu.facets[f].items)
      .filter(authored)
      .sort((a, b) => b.weight - a.weight)[0];
    if (forming) {
      const clause = renderClause(forming, lang, false);
      lines.push(
        lang === 'zh'
          ? `现在，它先感觉到：${clause}。`
          : `For now, it senses this: ${clause.charAt(0).toLowerCase()}${clause.slice(1)}.`,
      );
    }
  } else {
    // One reinforced thread per facet, in the fixed arc. 1–3 sentences — no more.
    for (const facet of FACET_ORDER) {
      const item = solidByFacet.get(facet);
      if (!item) continue;
      const clause = renderClause(item, lang, item.confidence === 'clear');
      if (clause) lines.push(period(lang, clause));
    }
    // The "what's shifting" note — only with a genuine recent-change signal.
    if (shift && authored(shift.item)) {
      const clause = renderClause(shift.item, lang, false);
      lines.push(`${pick(L.shifting_prefix, lang)}${clause}${lang === 'zh' ? '。' : '.'}`);
    }
    // Gentle closing — reinforces "still taking shape", never declarative.
    lines.push(pick(L.closing, lang));
  }

  // Each line stands alone → sentence-case for EN (fragments are authored as
  // lower-case clauses meant to be woven).
  const finalLines =
    lang === 'en' ? lines.map((s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s)) : lines;

  return { title: pick(L.title, lang), lines: finalLines, provenance: pick(L.provenance, lang) };
}
