/**
 * Atomic Moment Library pack validation (Founder rule):
 * any active Moment failure → reject entire candidate; keep previous active.
 */

import type { MomentDefinition } from '../../types/moments';
import type {
  LibraryPromoteResult,
  MomentLibraryIndexEntry,
  MomentLibraryPack,
} from '../../types/momentLibrary';
import {
  MOMENT_LIBRARY_SCHEMA_VERSION,
  SIGNAL_CATALOG_VERSION,
  SUPPORTED_INTERACTION_TYPES,
} from '../../data/moments/platformConstants';
import {
  getMomentRegistryEntry,
  isShipableRegistryId,
} from '../../data/moments/momentRegistry';
import { validateMomentConfig, validateMomentLibrary } from './config';
import { hashLibraryPackBody, hashMomentDocument } from './libraryHash';

export interface ValidatePackOptions {
  /** App binary signal catalog version. */
  signalCatalogVersion?: number;
  supportedInteractionTypes?: readonly string[];
  expectedSchemaVersion?: number;
  /** When true, verify packHash and per-moment contentHash. */
  verifyHashes?: boolean;
  /**
   * Allow Moment ids matching TEST-* / TEST_*.
   * Default false — production / formal promote path must never accept test Moments.
   */
  allowTestMomentIds?: boolean;
}

/** Test-only Moment ids — never promote into a production formal pack. */
export function isTestMomentId(id: string): boolean {
  return /^TEST[-_]/i.test(id);
}

/**
 * Validate a formal published pack atomically.
 * Draft Moments in the pack are allowed but must still be well-formed if present;
 * only Moments with status === 'active' must also satisfy capability gates for pool use.
 */
export async function validateLibraryPack(
  pack: MomentLibraryPack,
  options: ValidatePackOptions = {},
): Promise<LibraryPromoteResult> {
  const errors: string[] = [];
  const signalCatalogVersion = options.signalCatalogVersion ?? SIGNAL_CATALOG_VERSION;
  const supported =
    options.supportedInteractionTypes ?? SUPPORTED_INTERACTION_TYPES;
  const expectedSchema = options.expectedSchemaVersion ?? MOMENT_LIBRARY_SCHEMA_VERSION;
  const verifyHashes = options.verifyHashes ?? true;
  const allowTestMomentIds = options.allowTestMomentIds ?? false;

  if (!pack || typeof pack !== 'object') {
    return { ok: false, reason: 'missing pack', errors: ['pack is missing'] };
  }
  if (pack.schemaVersion !== expectedSchema) {
    errors.push(
      `schemaVersion ${pack.schemaVersion} unsupported (app expects ${expectedSchema})`,
    );
  }
  if (!Number.isInteger(pack.libraryVersion) || pack.libraryVersion < 1) {
    errors.push('libraryVersion must be a positive integer');
  }
  if (pack.region !== 'GLOBAL' && pack.region !== 'CN') {
    errors.push(`invalid region "${String(pack.region)}"`);
  }
  if (pack.signalCatalogVersion !== signalCatalogVersion) {
    errors.push(
      `signalCatalogVersion ${pack.signalCatalogVersion} incompatible with app ${signalCatalogVersion}`,
    );
  }
  if (pack.minAppCapability?.signalCatalogVersion > signalCatalogVersion) {
    errors.push(
      `minAppCapability.signalCatalogVersion ${pack.minAppCapability.signalCatalogVersion} > app ${signalCatalogVersion}`,
    );
  }
  for (const t of pack.minAppCapability?.interactionTypes ?? []) {
    if (!supported.includes(t)) {
      errors.push(`unsupported interactionType in minAppCapability: ${t}`);
    }
  }
  if (!Array.isArray(pack.moments) || !Array.isArray(pack.momentIndex)) {
    errors.push('moments and momentIndex must be arrays');
  }

  if (errors.length) {
    return { ok: false, reason: 'pack envelope invalid', errors };
  }

  // Library-wide structural validation (unknown signals, duplicate ids, …)
  errors.push(...validateMomentLibrary(pack.moments));

  const byKey = new Map<string, MomentDefinition>();
  for (const m of pack.moments) {
    byKey.set(`${m.id}@${m.version}`, m);
  }

  const activeEntries = pack.momentIndex.filter((e) => e.status === 'active');
  if (activeEntries.length === 0) {
    errors.push('formal pack has no active Moments');
  }

  for (const entry of pack.momentIndex) {
    if (!allowTestMomentIds && isTestMomentId(entry.id)) {
      errors.push(
        `${entry.id}@${entry.version}: test Moment ids are not allowed in formal packs`,
      );
    }
    // Permanent ID Convention: formal packs may only ship registered, active IDs.
    if (!allowTestMomentIds && !isTestMomentId(entry.id)) {
      const reg = getMomentRegistryEntry(entry.id);
      if (!reg) {
        errors.push(
          `${entry.id}@${entry.version}: Moment ID is not in the Moment Registry`,
        );
      } else if (entry.status === 'active' && !isShipableRegistryId(entry.id)) {
        errors.push(
          `${entry.id}@${entry.version}: registry status is "${reg.status}" (not shipable)`,
        );
      }
    }
    const moment = byKey.get(`${entry.id}@${entry.version}`);
    if (!moment) {
      errors.push(`index entry ${entry.id}@${entry.version} missing moment body`);
      continue;
    }
    if (moment.status !== entry.status) {
      errors.push(
        `${entry.id}@${entry.version}: status mismatch body=${moment.status} index=${entry.status}`,
      );
    }
    if (entry.status === 'active') {
      if (!supported.includes(moment.interactionType)) {
        errors.push(
          `${entry.id}@${entry.version}: unsupported interactionType ${moment.interactionType}`,
        );
      }
      // validateMomentConfig already checks unknown signals; re-check for clarity
      const cfgErrs = validateMomentConfig(moment);
      if (cfgErrs.length) {
        errors.push(...cfgErrs.map((e) => `active ${e}`));
      }
    }
    if (verifyHashes) {
      const hash = await hashMomentDocument(moment);
      if (hash !== entry.contentHash) {
        errors.push(
          `${entry.id}@${entry.version}: contentHash mismatch (expected ${entry.contentHash}, got ${hash})`,
        );
      }
    }
  }

  // Every active moment body must appear in the index as active
  for (const m of pack.moments.filter((x) => x.status === 'active')) {
    const indexed = pack.momentIndex.find(
      (e) => e.id === m.id && e.version === m.version && e.status === 'active',
    );
    if (!indexed) {
      errors.push(`active moment ${m.id}@${m.version} missing from momentIndex`);
    }
  }

  if (verifyHashes) {
    const bodyHash = await hashLibraryPackBody(pack);
    if (bodyHash !== pack.packHash) {
      errors.push(`packHash mismatch (expected ${pack.packHash}, got ${bodyHash})`);
    }
  }

  if (errors.length) {
    return { ok: false, reason: 'atomic validation failed', errors };
  }
  return { ok: true, pack };
}

/** Active Moments from a validated pack (pool for sessions). */
export function activeMomentsFromPack(pack: MomentLibraryPack): MomentDefinition[] {
  const activeKeys = new Set(
    pack.momentIndex
      .filter((e) => e.status === 'active')
      .map((e) => `${e.id}@${e.version}`),
  );
  return pack.moments.filter(
    (m) => m.status === 'active' && activeKeys.has(`${m.id}@${m.version}`),
  );
}

export function indexEntryPath(id: string, version: number): string {
  return `moments/${id}.v${version}.json`;
}

export async function buildIndexEntry(
  moment: MomentDefinition,
): Promise<MomentLibraryIndexEntry> {
  return {
    id: moment.id,
    version: moment.version,
    status: moment.status,
    path: indexEntryPath(moment.id, moment.version),
    contentHash: await hashMomentDocument(moment),
  };
}
