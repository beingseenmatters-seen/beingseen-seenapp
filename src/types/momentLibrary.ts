/**
 * Moment Platform V1 — remote/seed library envelope types.
 *
 * Content plane only. Does not redefine Human Understanding, Sketch, or Reflect.
 */

import type { MomentDefinition, MomentInteractionType } from './moments';

/** Account / library region. Same schema; different hosts. */
export type DataRegion = 'CN' | 'GLOBAL';

/** Reserved for future A/B — optional fields only in V1; no assignment logic. */
export interface MomentLibraryAbReservation {
  /** Reserved. Must be ignored by V1 clients. */
  experimentIds?: string[];
  /** Reserved. */
  notes?: string;
}

export interface MomentLibraryMinAppCapability {
  interactionTypes: MomentInteractionType[];
  signalCatalogVersion: number;
}

/** Index entry for one immutable Moment version file. */
export interface MomentLibraryIndexEntry {
  id: string;
  version: number;
  status: 'draft' | 'active' | 'retired';
  /** Relative path, e.g. moments/REL-003.v1.json */
  path: string;
  /** sha256 hex of the Moment document bytes (canonical JSON). */
  contentHash: string;
}

/**
 * Formal published library pack (seed or remote).
 * Promotion is atomic: validate the whole pack or reject it.
 */
export interface MomentLibraryPack {
  schemaVersion: number;
  libraryVersion: number;
  region: DataRegion;
  signalCatalogVersion: number;
  publishedAt: string;
  minAppCapability: MomentLibraryMinAppCapability;
  /** Full Moment documents for every indexed Moment in this pack. */
  moments: MomentDefinition[];
  /** Immutable version index (paths + hashes). */
  momentIndex: MomentLibraryIndexEntry[];
  /** sha256 of canonical pack body used for cache integrity. */
  packHash: string;
  /** Reserved A/B slot — ignore in V1. */
  ab?: MomentLibraryAbReservation | null;
  /** Intro/result framing (same as MOMENTS_META). */
  meta?: Record<string, unknown>;
}

/** Lightweight remote manifest before moment bodies are fetched. */
export interface MomentLibraryManifest {
  schemaVersion: number;
  libraryVersion: number;
  region: DataRegion;
  signalCatalogVersion: number;
  publishedAt: string;
  minAppCapability: MomentLibraryMinAppCapability;
  moments: MomentLibraryIndexEntry[];
  /** Optional single-file pack path for atomic download. */
  packPath?: string;
  packHash?: string;
  ab?: MomentLibraryAbReservation | null;
}

/** Provenance locked into session snapshots at creation. */
export interface MomentLibraryProvenance {
  libraryVersion: number;
  schemaVersion: number;
  signalCatalogVersion: number;
  region: DataRegion;
  packHash: string;
}

export type LibraryPromoteResult =
  | { ok: true; pack: MomentLibraryPack }
  | { ok: false; reason: string; errors: string[] };
