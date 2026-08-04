/**
 * Evidence Layer privacy boundaries (Section N, Phase 3A).
 *
 * Evidence must never contain: raw transcripts, other people's names or
 * identifiers, demographic-derived claims, inferred sexuality, medical or
 * psychological diagnosis, political or religious classification, exact
 * location, or hidden response-mode history treated as identity evidence.
 *
 * These are pragmatic, deterministic guards — a hard boundary at the data
 * model, not a moderation system. Upstream producers (Reflect extraction,
 * Moment conversion) are expected to behave; these checks make silent
 * violations impossible to store.
 */

export const MAX_EVIDENCE_TEXT_LENGTH = 200;

/** Transcript-shaped content: multiple speaker turns must never be stored. */
const TRANSCRIPT_MARKERS = [
  /(^|\n)\s*(user|assistant|ai|system)\s*[:：]/i,
  /(^|\n)\s*(用户|我说|AI|助手)\s*[:：]/,
];

/** Contact-style identifiers of other people. */
const IDENTIFIER_PATTERNS = [
  /[\w.+-]+@[\w-]+\.[\w.]+/, // email
  /(?<!\d)(\+?\d[\d\s-]{8,}\d)(?!\d)/, // phone-like
  /@[A-Za-z0-9_]{3,}/, // social handle
];

/** Diagnostic / clinical / classification language that must never be evidence. */
const FORBIDDEN_CLAIM_PATTERNS = [
  /抑郁症|焦虑症|人格障碍|自恋型|回避型依恋|焦虑型依恋|双相|成瘾/,
  /\b(depress(ion|ive)|anxiety disorder|narcissis|borderline|bipolar|adhd|autis|disorder|diagnos)/i,
  /性取向|同性恋|异性恋|双性恋/,
  /\b(sexual orientation|gay|lesbian|bisexual)\b/i,
  /政治立场|宗教信仰|党派/,
  /\b(political affiliation|religio(n|us belief))\b/i,
];

/** Third-party motive attribution / labeling — evidence is about this person. */
const THIRD_PARTY_MOTIVE_PATTERNS = [
  /(他|她)(一定|肯定|就)是(想|因为)/,
  /(他|她)的动机/,
  /(他|她)是个/,
  /\b(he|she|they)\s+(must|definitely|clearly)\s+(want|think|mean)/i,
  /\b(his|her|their)\s+(real\s+)?motive/i,
];

/** Metadata keys that would smuggle demographics or mode history into evidence. */
export const FORBIDDEN_METADATA_KEYS = [
  'gender',
  'zodiac',
  'age',
  'agerange',
  'birthday',
  'location',
  'responsemode',
  'requestedmode',
  'effectivemode',
  'aipreference',
  'sexuality',
  'religion',
  'politics',
];

export interface EvidenceTextViolation {
  code:
    | 'text_too_long'
    | 'transcript_shape'
    | 'identifier_present'
    | 'forbidden_claim'
    | 'third_party_motive';
  detail: string;
}

/** Returns all boundary violations for a candidate evidenceText. */
export function findEvidenceTextViolations(text: string): EvidenceTextViolation[] {
  const violations: EvidenceTextViolation[] = [];

  if (text.length > MAX_EVIDENCE_TEXT_LENGTH) {
    violations.push({
      code: 'text_too_long',
      detail: `evidenceText exceeds ${MAX_EVIDENCE_TEXT_LENGTH} characters (raw transcripts are forbidden)`,
    });
  }
  if (TRANSCRIPT_MARKERS.some((p) => p.test(text))) {
    violations.push({ code: 'transcript_shape', detail: 'evidenceText looks like a conversation transcript' });
  }
  if (IDENTIFIER_PATTERNS.some((p) => p.test(text))) {
    violations.push({ code: 'identifier_present', detail: 'evidenceText contains a contact-style identifier' });
  }
  if (FORBIDDEN_CLAIM_PATTERNS.some((p) => p.test(text))) {
    violations.push({ code: 'forbidden_claim', detail: 'evidenceText contains diagnostic or protected-attribute language' });
  }
  if (THIRD_PARTY_MOTIVE_PATTERNS.some((p) => p.test(text))) {
    violations.push({ code: 'third_party_motive', detail: 'evidenceText attributes motives or labels to another person' });
  }

  return violations;
}

export function isEvidenceTextAllowed(text: string): boolean {
  return findEvidenceTextViolations(text).length === 0;
}

/**
 * Best-effort sanitisation for producer convenience: collapses whitespace and
 * bounds length. Does NOT attempt to fix forbidden claims — those must be
 * rejected, not rewritten.
 */
export function sanitizeEvidenceText(text: string): string {
  const collapsed = text.replace(/\s+/g, ' ').trim();
  if (collapsed.length <= MAX_EVIDENCE_TEXT_LENGTH) return collapsed;
  return `${collapsed.slice(0, MAX_EVIDENCE_TEXT_LENGTH - 1).trimEnd()}…`;
}

/** Returns metadata keys that violate the demographic/mode-history boundary. */
export function findForbiddenMetadataKeys(metadata: Record<string, unknown>): string[] {
  return Object.keys(metadata).filter((key) =>
    FORBIDDEN_METADATA_KEYS.includes(key.toLowerCase().replace(/[_-]/g, '')),
  );
}
