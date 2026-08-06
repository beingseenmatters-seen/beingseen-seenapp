import { describe, expect, it } from 'vitest';
import { MOMENT_LIBRARY } from './library';
import {
  CANONICAL_MOMENT_ID_RE,
  LEGACY_MOMENT_ID_RE,
  MOMENT_CATEGORY_CODES,
  MOMENT_REGISTRY,
  SESSION_SNAPSHOT_VERSION_FIELDS,
  getMomentRegistryEntry,
  isCanonicalMomentId,
  isLegacyMomentId,
  isShipableRegistryId,
  parseCanonicalMomentId,
} from './momentRegistry';

describe('Moment Registry (Founder Frozen permanent IDs)', () => {
  it('has unique IDs (no duplicates)', () => {
    const ids = MOMENT_REGISTRY.map((e) => e.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('uses only Founder category codes or LEGACY', () => {
    const allowed = new Set<string>([...MOMENT_CATEGORY_CODES, 'LEGACY']);
    for (const entry of MOMENT_REGISTRY) {
      expect(allowed.has(entry.category)).toBe(true);
    }
  });

  it('canonical IDs match CATEGORY-NNN and category field', () => {
    for (const entry of MOMENT_REGISTRY) {
      if (entry.legacyAlias || entry.category === 'LEGACY') {
        expect(isLegacyMomentId(entry.id)).toBe(true);
        expect(LEGACY_MOMENT_ID_RE.test(entry.id)).toBe(true);
        continue;
      }
      expect(isCanonicalMomentId(entry.id)).toBe(true);
      expect(CANONICAL_MOMENT_ID_RE.test(entry.id)).toBe(true);
      const parsed = parseCanonicalMomentId(entry.id);
      expect(parsed?.category).toBe(entry.category);
    }
  });

  it('marks only M-Pxx as legacy aliases', () => {
    for (const entry of MOMENT_REGISTRY) {
      if (entry.legacyAlias) {
        expect(entry.id.startsWith('M-P')).toBe(true);
        expect(entry.category).toBe('LEGACY');
      }
    }
  });

  it('every library Moment is registered and shipable (active)', () => {
    for (const moment of MOMENT_LIBRARY) {
      const entry = getMomentRegistryEntry(moment.id);
      expect(entry, `unregistered library Moment ${moment.id}`).toBeDefined();
      expect(entry!.status).toBe('active');
      expect(isShipableRegistryId(moment.id)).toBe(true);
    }
  });

  it('reserved IDs are not present in the compile-time library', () => {
    const reserved = MOMENT_REGISTRY.filter((e) => e.status === 'reserved').map((e) => e.id);
    const libraryIds = new Set(MOMENT_LIBRARY.map((m) => m.id));
    for (const id of reserved) {
      expect(libraryIds.has(id)).toBe(false);
    }
  });

  it('retired IDs stay in the registry forever (none reassigned)', () => {
    const retired = MOMENT_REGISTRY.filter((e) => e.status === 'retired');
    for (const entry of retired) {
      expect(getMomentRegistryEntry(entry.id)?.status).toBe('retired');
      expect(isShipableRegistryId(entry.id)).toBe(false);
    }
  });

  it('registers Founder Set 003 IDs (FRI-002, PAR-001)', () => {
    expect(getMomentRegistryEntry('FRI-002')?.status).toBe('active');
    expect(getMomentRegistryEntry('FRI-002')?.labelZh).toBe('朋友误会');
    expect(getMomentRegistryEntry('PAR-001')?.status).toBe('active');
    expect(getMomentRegistryEntry('PAR-001')?.labelZh).toBe('孩子成长排序');
  });

  it('reserves BUS-001 permanently (gap before BUS-002)', () => {
    const bus001 = getMomentRegistryEntry('BUS-001');
    expect(bus001?.status).toBe('reserved');
    expect(getMomentRegistryEntry('BUS-002')?.status).toBe('active');
  });

  it('lists Founder Relationship / Friendship / Business / Parenting labels', () => {
    expect(getMomentRegistryEntry('REL-001')?.labelZh).toContain('随便');
    expect(getMomentRegistryEntry('REL-002')?.labelZh).toContain('上错菜');
    expect(getMomentRegistryEntry('REL-003')?.labelZh).toContain('超预算');
    expect(getMomentRegistryEntry('REL-004')?.labelZh).toContain('家庭经济');
    expect(getMomentRegistryEntry('FRI-001')?.labelZh).toContain('在吗');
    expect(getMomentRegistryEntry('BUS-002')?.labelZh).toContain('合作方向');
  });

  it('documents required session snapshot version fields', () => {
    expect(SESSION_SNAPSHOT_VERSION_FIELDS).toEqual([
      'momentId',
      'version',
      'libraryVersion',
      'schemaVersion',
      'signalCatalogVersion',
    ]);
  });
});
