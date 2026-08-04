/**
 * Moments V0.1 — typed schema for the config-driven Moment framework.
 *
 * Content ported from the approved Previewer source
 * (ENGINEERING/Prototype/data/*.json, sync 2026-07-05). Signal IDs, deltas,
 * confidences, weights and all user-facing wording are approved and frozen —
 * do not edit them without founder approval.
 *
 * Adding a new Moment only requires appending data in `src/data/moments/`;
 * no new pages, routes or renderers.
 */

/** Localized copy. `zh` is the source of truth; `en` falls back to `zh` when absent. */
export interface LocalizedText {
  zh: string;
  en?: string;
}

export type MomentInteractionType = 'single_choice' | 'multiple_choice' | 'ranking';

export type MomentStatus = 'draft' | 'active' | 'retired';

/** Evidence weight vocabulary from the approved source (internal only). */
export type MomentEvidenceWeight = 'Very Light' | 'Light' | 'Moderate';

export type MomentSignalConfidence = 'low' | 'medium' | 'high';

/** One approved signal emission for an option (internal; never rendered). */
export interface MomentSignalEmission {
  signal: string;
  delta: number;
  confidence: MomentSignalConfidence;
}

export interface MomentOption {
  /** Unique within the Moment. */
  id: string;
  text: LocalizedText;
  /** Approved per-question interpretation line (user-facing, gentle). */
  interpretation?: LocalizedText;
  /** Approved neutral immediate reading (internal metadata; never rendered). */
  immediate?: string;
  weight?: MomentEvidenceWeight;
  signals: MomentSignalEmission[];
  /** Approved slider deltas (internal; preserved for fidelity, not rendered). */
  sliders?: Record<string, number>;
}

export interface MomentDefinition {
  id: string;
  /** Content version; locked into sessions so history survives later edits. */
  version: number;
  status: MomentStatus;
  interactionType: MomentInteractionType;
  /** Short scene name, e.g. 电梯坏了. */
  title: LocalizedText;
  /** The scenario prompt shown to the person. */
  scenario: LocalizedText;
  emoji?: string;
  audience?: string;
  /** Optional selection hint, e.g. 请选择最多 3 项。 */
  hint?: LocalizedText;
  /** multiple_choice only. */
  minSelection?: number;
  /** multiple_choice only. */
  maxSelection?: number;
  /** ranking only — the person orders exactly this many options. */
  maxRank?: number;
  options: MomentOption[];
}

/** Signal display metadata (internal; used for config validation only). */
export interface SignalMeta {
  name: string;
  zh: string;
  family: string;
  status: 'active' | 'draft';
}

// ---------------------------------------------------------------------------
// Summary Engine V1 (approved & frozen) — configuration types
// ---------------------------------------------------------------------------

export interface SummaryCondition {
  signal: string;
  op: '>=' | '<=' | '>' | '<';
  value: number;
}

export interface SummaryVariant {
  rhythm: 'long' | 'short';
  text: string;
}

export interface SummaryBlock {
  id: string;
  dim: string;
  claim: string;
  fallback?: boolean;
  conditions: SummaryCondition[];
  variants: SummaryVariant[];
}

export interface SummaryDimension {
  code: string;
  sliderKey: string;
  name: string;
  signals: string[];
}

export interface SummaryEngineConfig {
  engineVersion: string;
  thresholds: { high: number; low: number };
  connectives: string[];
  dimensions: SummaryDimension[];
  blocks: SummaryBlock[];
}

// ---------------------------------------------------------------------------
// Session model (V0.1 — local-only persistence)
// ---------------------------------------------------------------------------

/**
 * One answer. `selectedOptionIds` semantics:
 *  - single_choice: exactly one id
 *  - multiple_choice: min..max ids (selection order irrelevant)
 *  - ranking: ordered ids, first = rank 1, length === maxRank
 */
export interface MomentAnswer {
  momentId: string;
  selectedOptionIds: string[];
  answeredAt: number;
}

/** Immutable per-option snapshot so old sketches survive later content changes. */
export interface MomentOptionSnapshot {
  id: string;
  text: LocalizedText;
  interpretation?: LocalizedText;
  weight?: MomentEvidenceWeight;
  /** Kept so completed sessions can regenerate/audit without the live library. */
  signals: MomentSignalEmission[];
}

/** Immutable snapshot of one Moment as it was when the session was created. */
export interface MomentSnapshot {
  momentId: string;
  version: number;
  interactionType: MomentInteractionType;
  title: LocalizedText;
  scenario: LocalizedText;
  emoji?: string;
  hint?: LocalizedText;
  minSelection?: number;
  maxSelection?: number;
  maxRank?: number;
  options: MomentOptionSnapshot[];
}

/**
 * Internal delta classification for one Movement touched by a completed
 * session (Sketch Engine V2). Never rendered to the person.
 */
export type SketchDeltaClass =
  | 'NEW'
  | 'STRENGTHENED'
  | 'SHIFTED'
  | 'REVISED'
  | 'STABLE'
  | 'INSUFFICIENT_CHANGE';

/** How a sketch was composed (Sketch Engine V2). Internal only. */
export type SketchMode = 'baseline' | 'delta' | 'confirmation';

/**
 * Lightweight provenance stored with each sketch so the next generation can
 * apply cooldowns and framing rotation without a separate memory store.
 * Internal metadata; never rendered.
 */
export interface SketchProvenance {
  mode: SketchMode;
  /** Movement ids expressed in this sketch, in sentence order. */
  movementIds: string[];
  /** Content block (clause) ids used, in sentence order. */
  blockIds: string[];
  /** Framing/variant ids used, in sentence order ('' for none). */
  variantIds: string[];
  /** Delta classification per touched Movement (not only rendered ones). */
  deltaClasses: Record<string, SketchDeltaClass>;
  engineVersion: string;
  /** Source Moment session. */
  sessionId: string;
}

/** The stored, deterministic sketch generated at completion. */
export interface StoredSketch {
  /** 1-based sketch number for this person (速写 · 01, 02, …). */
  number: number;
  text: string;
  generatedAt: number;
  engineVersion: string;
  language: 'zh' | 'en';
  /** Absent on sketches generated by Summary Engine V1. */
  provenance?: SketchProvenance;
}

export type MomentsSessionStatus = 'active' | 'completed';

export interface MomentsSession {
  id: string;
  status: MomentsSessionStatus;
  /** Locked Moment order — never reshuffled after creation. */
  momentIds: string[];
  /** Locked Moment content versions at creation time. */
  momentVersions: Record<string, number>;
  /** Immutable content snapshots, same order as momentIds. */
  snapshots: MomentSnapshot[];
  answers: Record<string, MomentAnswer>;
  createdAt: number;
  updatedAt: number;
  completedAt?: number;
  sketch?: StoredSketch;
}

/** Everything persisted for one person (one storage key per uid). */
export interface MomentsUserData {
  schemaVersion: 1;
  activeSession: MomentsSession | null;
  completedSessions: MomentsSession[];
}

/** Lightweight listing item for the sketch history page. */
export interface SketchSummary {
  sessionId: string;
  number: number;
  completedAt: number;
  preview: string;
}
