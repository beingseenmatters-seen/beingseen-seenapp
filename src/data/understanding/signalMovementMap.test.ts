/**
 * Signal-to-Movement mapping (Section G): explicit, complete, demographic-free.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import {
  INTENTIONALLY_NON_PROFILE_SIGNALS,
  SIGNAL_MOVEMENT_MAP,
  getMappingsForSignal,
  validateSignalMovementMap,
} from './signalMovementMap';
import { SIGNAL_INDEX } from '../moments/signals';
import { isMovementId } from './movements';

describe('signal-to-movement mapping', () => {
  it('passes its own structural validation', () => {
    expect(validateSignalMovementMap()).toEqual([]);
  });

  it('maps or explicitly excludes every Moment Signal', () => {
    const mapped = new Set(SIGNAL_MOVEMENT_MAP.map((m) => m.signalId));
    for (const signalId of Object.keys(SIGNAL_INDEX)) {
      const covered = mapped.has(signalId) || signalId in INTENTIONALLY_NON_PROFILE_SIGNALS;
      expect(covered, `signal ${signalId} must be mapped or intentionally excluded`).toBe(true);
    }
  });

  it('references only known movements and known signals', () => {
    for (const row of SIGNAL_MOVEMENT_MAP) {
      expect(isMovementId(row.movementId), `unknown movement ${row.movementId}`).toBe(true);
      expect(SIGNAL_INDEX[row.signalId], `unknown signal ${row.signalId}`).toBeTruthy();
    }
  });

  it('every mapping has a written rationale and bounded multipliers', () => {
    for (const row of SIGNAL_MOVEMENT_MAP) {
      expect(row.rationale.trim().length).toBeGreaterThan(10);
      expect([1, -1]).toContain(row.directionMultiplier);
      expect(row.strengthMultiplier).toBeGreaterThan(0);
      expect(row.strengthMultiplier).toBeLessThanOrEqual(1);
    }
  });

  it('multi-movement mappings stay rare and justified', () => {
    const bySignal = new Map<string, number>();
    for (const row of SIGNAL_MOVEMENT_MAP) {
      bySignal.set(row.signalId, (bySignal.get(row.signalId) ?? 0) + 1);
    }
    const multi = [...bySignal.entries()].filter(([, n]) => n > 1);
    // Only CHG-09 (certainty) and REL-10 (conflict avoidance) are dual today.
    expect(multi.map(([id]) => id).sort()).toEqual(['CHG-09', 'REL-10']);
    for (const [, n] of multi) expect(n).toBe(2);
  });

  it('no mapping depends on gender, age, zodiac or response modes', () => {
    const source = readFileSync(resolve(__dirname, './signalMovementMap.ts'), 'utf-8');
    const stripped = source
      .replace(/\/\*[\s\S]*?\*\//g, '')
      .replace(/^\s*\/\/.*$/gm, '');
    // The boundary words appear only in comments, never in executable data.
    for (const row of SIGNAL_MOVEMENT_MAP) {
      expect(row.signalId).toMatch(/^[A-Z]{3}-\d{2}$/);
    }
    expect(stripped).not.toMatch(/zodiac/i);
    expect(stripped).not.toMatch(/\bgender\b/i);
    expect(stripped).not.toMatch(/response[_-]?mode/i);
  });

  it('preserves original Signal semantics (reads, never rewrites, the library)', () => {
    // The mapping module must not import or touch the Moment library content.
    const source = readFileSync(resolve(__dirname, './signalMovementMap.ts'), 'utf-8');
    expect(source).not.toContain("moments/library");
    // And the mapping API is read-only lookup.
    expect(getMappingsForSignal('EXP-01')).toHaveLength(1);
    expect(getMappingsForSignal('EXP-01')[0].movementId).toBe('direct_expression');
    expect(getMappingsForSignal('NOPE-99')).toEqual([]);
  });
});
