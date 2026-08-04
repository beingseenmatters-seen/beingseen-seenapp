/**
 * Movement Taxonomy V1 (Section F): small, stable, movement-language only.
 */
import { describe, expect, it } from 'vitest';
import {
  MOVEMENTS,
  MOVEMENT_IDS,
  RELATED_MOVEMENTS,
  areMovementsRelated,
  isMovementId,
} from './movements';

/** Identity/diagnostic labels that must never appear in the taxonomy. */
const FORBIDDEN_LABEL_PATTERNS = [
  /introvert/i,
  /extrovert/i,
  /\bavoidant\b/i,
  /\banxious\b/i,
  /narcissis/i,
  /people[\s_-]?pleaser/i,
  /\bempath\b/i,
  /\bcontroller\b/i,
  /attachment[\s_-]?(type|style)/i,
  /personality[\s_-]?type/i,
  /内向|外向|回避型|焦虑型|自恋|讨好型|共情者|控制狂|依恋类型|人格类型/,
];

describe('movement taxonomy V1', () => {
  it('has between 10 and 16 movements with unique ids', () => {
    expect(MOVEMENT_IDS.length).toBeGreaterThanOrEqual(10);
    expect(MOVEMENT_IDS.length).toBeLessThanOrEqual(16);
    expect(new Set(MOVEMENT_IDS).size).toBe(MOVEMENT_IDS.length);
    for (const id of MOVEMENT_IDS) {
      expect(MOVEMENTS[id].id).toBe(id);
      expect(isMovementId(id)).toBe(true);
    }
    expect(isMovementId('narcissist')).toBe(false);
  });

  it('every movement has localized zh and en titles', () => {
    for (const id of MOVEMENT_IDS) {
      expect(MOVEMENTS[id].title.zh.trim()).not.toBe('');
      expect(MOVEMENTS[id].title.en.trim()).not.toBe('');
    }
  });

  it('movement ids and titles never use identity or diagnostic labels', () => {
    for (const id of MOVEMENT_IDS) {
      const def = MOVEMENTS[id];
      const labelSurface = `${def.id} ${def.title.zh} ${def.title.en} ${def.positiveDirection} ${def.negativeDirection ?? ''}`;
      for (const pattern of FORBIDDEN_LABEL_PATTERNS) {
        expect(labelSurface).not.toMatch(pattern);
      }
    }
  });

  it('every movement documents description, direction and permitted sources', () => {
    for (const id of MOVEMENT_IDS) {
      const def = MOVEMENTS[id];
      expect(def.description.trim()).not.toBe('');
      expect(def.positiveDirection.trim()).not.toBe('');
      expect(def.allowedSources.length).toBeGreaterThan(0);
      for (const source of def.allowedSources) {
        expect(['reflect', 'moment']).toContain(source);
      }
      expect(typeof def.userFacingEligible).toBe('boolean');
    }
  });

  it('every movement documents supporting examples and invalid overreach', () => {
    for (const id of MOVEMENT_IDS) {
      const def = MOVEMENTS[id];
      expect(def.supportingEvidenceExamples.length).toBeGreaterThan(0);
      expect(def.invalidOverreachExamples.length).toBeGreaterThan(0);
    }
  });

  it('related-movement graph is symmetric and references known ids', () => {
    for (const [from, related] of Object.entries(RELATED_MOVEMENTS)) {
      expect(isMovementId(from)).toBe(true);
      for (const to of related ?? []) {
        expect(isMovementId(to)).toBe(true);
        expect(areMovementsRelated(to as never, from as never)).toBe(true);
      }
    }
    expect(areMovementsRelated('direct_expression', 'direct_expression')).toBe(true);
    expect(areMovementsRelated('direct_expression', 'meaning_orientation')).toBe(false);
  });
});
