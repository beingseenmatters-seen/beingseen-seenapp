/**
 * Moment Registry — single source of truth for permanent Moment IDs.
 *
 * Founder Frozen: see docs/MOMENT_ID_CONVENTION.md
 *
 * Rules encoded here:
 * - IDs are never reused or renumbered
 * - Retired IDs remain reserved forever
 * - Canonical IDs are category codes (REL-001, …)
 * - M-Pxx are historical aliases only (no new M-Pxx)
 */

/** Founder-frozen category codes for canonical Moment IDs. */
export const MOMENT_CATEGORY_CODES = [
  'REL',
  'FRI',
  'BUS',
  'PAR',
  'SOC',
  'TRV',
  'COM',
  'LIF',
  'MON',
  'LRN',
  'WRK',
  'FAM',
  'SELF',
] as const;

export type MomentCategoryCode = (typeof MOMENT_CATEGORY_CODES)[number];

export const MOMENT_CATEGORY_LABELS: Record<
  MomentCategoryCode,
  { zh: string; en: string }
> = {
  REL: { zh: '关系', en: 'Relationship' },
  FRI: { zh: '友情', en: 'Friendship' },
  BUS: { zh: '事业合作', en: 'Business' },
  PAR: { zh: '养育', en: 'Parenting' },
  SOC: { zh: '社交', en: 'Social' },
  TRV: { zh: '旅行', en: 'Travel' },
  COM: { zh: '承诺', en: 'Commitment' },
  LIF: { zh: '日常', en: 'Daily Life' },
  MON: { zh: '金钱', en: 'Money' },
  LRN: { zh: '学习', en: 'Learning' },
  WRK: { zh: '工作', en: 'Career / Work' },
  FAM: { zh: '家庭', en: 'Family' },
  SELF: { zh: '自我觉察', en: 'Self-awareness' },
};

/** Registry lifecycle. Retired and reserved IDs are never reassigned. */
export type MomentRegistryStatus = 'active' | 'reserved' | 'retired';

export interface MomentRegistryEntry {
  /** Permanent Moment ID (never changes). */
  id: string;
  /**
   * Category for canonical IDs; `LEGACY` for historical M-Pxx aliases.
   */
  category: MomentCategoryCode | 'LEGACY';
  /** Founder registry short label (zh). */
  labelZh: string;
  status: MomentRegistryStatus;
  /** Historical M-Pxx only — not used for new Moments. */
  legacyAlias?: boolean;
  notes?: string;
}

/** Canonical category ID: REL-001, FRI-002, … */
export const CANONICAL_MOMENT_ID_RE = new RegExp(
  `^(${MOMENT_CATEGORY_CODES.join('|')})-\\d{3}$`,
);

/** Legacy historical alias: M-P01 … M-P99 (no new IDs in this form). */
export const LEGACY_MOMENT_ID_RE = /^M-P\d{2}$/;

/**
 * Founder Moment Registry (SSOT).
 *
 * Every Founder-approved Moment is listed here before (or with) library ship.
 * Duplicate IDs are forbidden. Retired IDs stay listed forever.
 */
export const MOMENT_REGISTRY: readonly MomentRegistryEntry[] = [
  // -------------------------------------------------------------------------
  // Legacy historical aliases (M-Pxx) — permanent; do not mint new M-Pxx
  // -------------------------------------------------------------------------
  { id: 'M-P01', category: 'LEGACY', labelZh: '电梯坏了', status: 'active', legacyAlias: true },
  { id: 'M-P02', category: 'LEGACY', labelZh: '没人扶', status: 'active', legacyAlias: true },
  { id: 'M-P03', category: 'LEGACY', labelZh: '流浪猫', status: 'active', legacyAlias: true },
  { id: 'M-P04', category: 'LEGACY', labelZh: '中了500万', status: 'active', legacyAlias: true },
  { id: 'M-P05', category: 'LEGACY', labelZh: '老同学', status: 'active', legacyAlias: true },
  { id: 'M-P06', category: 'LEGACY', labelZh: '住在哪', status: 'active', legacyAlias: true },
  { id: 'M-P07', category: 'LEGACY', labelZh: '旧照片', status: 'active', legacyAlias: true },
  { id: 'M-P08', category: 'LEGACY', labelZh: '为什么活着', status: 'active', legacyAlias: true },
  { id: 'M-P09', category: 'LEGACY', labelZh: '有人插队', status: 'active', legacyAlias: true },
  { id: 'M-P10', category: 'LEGACY', labelZh: '那个日期', status: 'active', legacyAlias: true },
  { id: 'M-P11', category: 'LEGACY', labelZh: '重选伴侣', status: 'active', legacyAlias: true },
  { id: 'M-P12', category: 'LEGACY', labelZh: '创业伙伴', status: 'active', legacyAlias: true },

  // -------------------------------------------------------------------------
  // Relationship
  // -------------------------------------------------------------------------
  { id: 'REL-001', category: 'REL', labelZh: '伴侣说"随便"', status: 'active' },
  { id: 'REL-002', category: 'REL', labelZh: '上错菜', status: 'active' },
  { id: 'REL-003', category: 'REL', labelZh: '喜欢的东西超预算', status: 'active' },
  { id: 'REL-004', category: 'REL', labelZh: '家庭经济条件', status: 'active' },

  // -------------------------------------------------------------------------
  // Friendship
  // -------------------------------------------------------------------------
  { id: 'FRI-001', category: 'FRI', labelZh: '半夜"在吗"', status: 'active' },
  { id: 'FRI-002', category: 'FRI', labelZh: '朋友误会', status: 'active' },

  // -------------------------------------------------------------------------
  // Business
  // -------------------------------------------------------------------------
  {
    id: 'BUS-001',
    category: 'BUS',
    labelZh: '(reserved)',
    status: 'reserved',
    notes: 'Founder-listed slot. Content not yet approved. ID permanently claimed.',
  },
  { id: 'BUS-002', category: 'BUS', labelZh: '合作方向不同', status: 'active' },

  // -------------------------------------------------------------------------
  // Parenting
  // -------------------------------------------------------------------------
  { id: 'PAR-001', category: 'PAR', labelZh: '孩子成长排序', status: 'active' },

  // -------------------------------------------------------------------------
  // Social / Travel / Commitment (shipping in library; Founder category IDs)
  // -------------------------------------------------------------------------
  { id: 'SOC-001', category: 'SOC', labelZh: '快了快了', status: 'active' },
  { id: 'TRV-001', category: 'TRV', labelZh: '收拾行李', status: 'active' },
  { id: 'COM-001', category: 'COM', labelZh: '明天要交', status: 'active' },
] as const;

const registryById = new Map<string, MomentRegistryEntry>(
  MOMENT_REGISTRY.map((e) => [e.id, e]),
);

export function getMomentRegistryEntry(id: string): MomentRegistryEntry | undefined {
  return registryById.get(id);
}

export function isRegisteredMomentId(id: string): boolean {
  return registryById.has(id);
}

/** IDs that may appear in a formal (non-fixture) library pack. */
export function isShipableRegistryId(id: string): boolean {
  const entry = registryById.get(id);
  return entry?.status === 'active';
}

export function isCanonicalMomentId(id: string): boolean {
  return CANONICAL_MOMENT_ID_RE.test(id);
}

export function isLegacyMomentId(id: string): boolean {
  return LEGACY_MOMENT_ID_RE.test(id);
}

export function parseCanonicalMomentId(
  id: string,
): { category: MomentCategoryCode; sequence: number } | null {
  const m = id.match(CANONICAL_MOMENT_ID_RE);
  if (!m) return null;
  return {
    category: m[1] as MomentCategoryCode,
    sequence: Number(id.slice(id.lastIndexOf('-') + 1)),
  };
}

/**
 * Session snapshot provenance fields required for new sessions
 * (Moment Platform V1 + Permanent ID Convention).
 */
export const SESSION_SNAPSHOT_VERSION_FIELDS = [
  'momentId',
  'version',
  'libraryVersion',
  'schemaVersion',
  'signalCatalogVersion',
] as const;
