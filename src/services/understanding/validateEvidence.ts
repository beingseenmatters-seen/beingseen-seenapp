/**
 * Full validation for UnderstandingEvidence items (Sections D, E, N).
 * Pure and deterministic; returns a list of problems (empty = valid).
 */

import type { EvidenceContext, UnderstandingEvidence } from '../../types/evidence';
import {
  EVIDENCE_AUDIENCE_SCOPES,
  EVIDENCE_BOUNDS,
  EVIDENCE_CONTEXT_DOMAINS,
  EVIDENCE_LIFECYCLE_STATUSES,
  EVIDENCE_PRIVACY_LEVELS,
  EVIDENCE_RELATIONSHIP_TYPES,
  EVIDENCE_SOURCES,
  EVIDENCE_STAKES,
  EVIDENCE_TEMPORAL_SCOPES,
  EVIDENCE_SCHEMA_VERSION,
} from '../../types/evidence';
import { isMovementId, MOVEMENTS } from '../../data/understanding/movements';
import { findEvidenceTextViolations, findForbiddenMetadataKeys } from './privacy';

function inRange(value: number, min: number, max: number): boolean {
  return Number.isFinite(value) && value >= min && value <= max;
}

function isIsoTimestamp(value: string): boolean {
  return typeof value === 'string' && value.length > 0 && !Number.isNaN(Date.parse(value));
}

export function validateEvidenceContext(context: EvidenceContext): string[] {
  const problems: string[] = [];

  if (!context || typeof context !== 'object') {
    return ['context is required'];
  }
  if (!EVIDENCE_CONTEXT_DOMAINS.includes(context.domain)) {
    problems.push(`unknown context domain: ${String(context.domain)}`);
  }
  if (context.relationshipType !== undefined && !EVIDENCE_RELATIONSHIP_TYPES.includes(context.relationshipType)) {
    problems.push(`unknown relationshipType: ${String(context.relationshipType)}`);
  }
  if (context.stakes !== undefined && !EVIDENCE_STAKES.includes(context.stakes)) {
    problems.push(`unknown stakes: ${String(context.stakes)}`);
  }
  if (context.audienceScope !== undefined && !EVIDENCE_AUDIENCE_SCOPES.includes(context.audienceScope)) {
    problems.push(`unknown audienceScope: ${String(context.audienceScope)}`);
  }
  if (context.tags !== undefined) {
    if (!Array.isArray(context.tags) || context.tags.some((t) => typeof t !== 'string' || !t.trim())) {
      problems.push('context tags must be non-empty strings');
    } else {
      // Tags are topical slugs, never demographics or another person's name.
      const forbidden = context.tags.filter((t) =>
        /gender|zodiac|星座|性别|age|年龄|响应模式|response[_-]?mode/i.test(t),
      );
      if (forbidden.length) {
        problems.push(`context tags carry forbidden attributes: ${forbidden.join(', ')}`);
      }
    }
  }

  return problems;
}

export function validateUnderstandingEvidence(evidence: UnderstandingEvidence): string[] {
  const problems: string[] = [];

  if (!evidence.id?.trim()) problems.push('id is required');
  if (evidence.schemaVersion !== EVIDENCE_SCHEMA_VERSION) {
    problems.push(`unsupported schemaVersion: ${String(evidence.schemaVersion)}`);
  }
  if (!evidence.userId?.trim()) problems.push('userId is required');

  if (!EVIDENCE_SOURCES.includes(evidence.source)) {
    problems.push(`forbidden evidence source: ${String(evidence.source)}`);
  }
  if (!evidence.sourceRef?.trim()) problems.push('sourceRef is required');

  if (!evidence.sourceVersion || typeof evidence.sourceVersion !== 'object') {
    problems.push('sourceVersion is required (structured version metadata)');
  } else if (
    typeof evidence.sourceVersion.taxonomyVersion !== 'string' ||
    !evidence.sourceVersion.taxonomyVersion.trim()
  ) {
    problems.push('sourceVersion.taxonomyVersion is required');
  }

  if (!isMovementId(evidence.movementId)) {
    problems.push(`unknown movement: ${String(evidence.movementId)}`);
  } else if (
    EVIDENCE_SOURCES.includes(evidence.source) &&
    !MOVEMENTS[evidence.movementId].allowedSources.includes(evidence.source)
  ) {
    problems.push(`movement ${evidence.movementId} does not accept ${evidence.source} evidence`);
  }

  const { direction, strength, confidence } = EVIDENCE_BOUNDS;
  if (!inRange(evidence.direction, direction.min, direction.max)) {
    problems.push(`direction out of range [-1, 1]: ${String(evidence.direction)}`);
  }
  if (!inRange(evidence.strength, strength.min, strength.max)) {
    problems.push(`strength out of range [0, 1]: ${String(evidence.strength)}`);
  }

  // Terminology boundary (Phase 3B): exactly one reliability number, matching
  // the source. A bare ambiguous `confidence` field no longer exists.
  if (evidence.source === 'reflect') {
    if (evidence.extractionConfidence === undefined) {
      problems.push('reflect evidence requires extractionConfidence');
    } else if (!inRange(evidence.extractionConfidence, confidence.min, confidence.max)) {
      problems.push(`extractionConfidence out of range [0, 1]: ${String(evidence.extractionConfidence)}`);
    }
    if (evidence.mappingConfidence !== undefined) {
      problems.push('reflect evidence must not carry mappingConfidence');
    }
  } else if (evidence.source === 'moment') {
    if (evidence.mappingConfidence === undefined) {
      problems.push('moment evidence requires mappingConfidence');
    } else if (!inRange(evidence.mappingConfidence, confidence.min, confidence.max)) {
      problems.push(`mappingConfidence out of range [0, 1]: ${String(evidence.mappingConfidence)}`);
    }
    if (evidence.extractionConfidence !== undefined) {
      problems.push('moment evidence must not carry extractionConfidence');
    }
  }
  if ((evidence as unknown as Record<string, unknown>).confidence !== undefined) {
    problems.push('ambiguous `confidence` field is no longer supported; use extractionConfidence or mappingConfidence');
  }

  problems.push(...validateEvidenceContext(evidence.context));

  if (!EVIDENCE_TEMPORAL_SCOPES.includes(evidence.temporalScope)) {
    problems.push(`unknown temporalScope: ${String(evidence.temporalScope)}`);
  }
  if (!EVIDENCE_LIFECYCLE_STATUSES.includes(evidence.lifecycleStatus)) {
    problems.push(`unknown lifecycleStatus: ${String(evidence.lifecycleStatus)}`);
  }
  if (!EVIDENCE_PRIVACY_LEVELS.includes(evidence.privacyLevel)) {
    problems.push(`unknown privacyLevel: ${String(evidence.privacyLevel)}`);
  }

  for (const [field, value] of [
    ['observedAt', evidence.observedAt],
    ['createdAt', evidence.createdAt],
    ['updatedAt', evidence.updatedAt],
  ] as const) {
    if (!isIsoTimestamp(value)) problems.push(`${field} must be an ISO timestamp`);
  }

  if (typeof evidence.userConfirmed !== 'boolean') {
    problems.push('userConfirmed must be a boolean');
  }

  if (evidence.evidenceText !== undefined) {
    for (const violation of findEvidenceTextViolations(evidence.evidenceText)) {
      problems.push(`evidenceText: ${violation.detail}`);
    }
  }

  if (evidence.metadata !== undefined) {
    const forbiddenKeys = findForbiddenMetadataKeys(evidence.metadata);
    if (forbiddenKeys.length) {
      problems.push(`metadata carries forbidden keys: ${forbiddenKeys.join(', ')}`);
    }
  }

  return problems;
}

export function isValidUnderstandingEvidence(evidence: UnderstandingEvidence): boolean {
  return validateUnderstandingEvidence(evidence).length === 0;
}
