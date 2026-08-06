import type { MomentInteractionType } from '../../types/moments';

/** Moment document / pack schema version for Platform V1. */
export const MOMENT_LIBRARY_SCHEMA_VERSION = 1;

/**
 * Signal catalog version known to this app binary.
 * Bump only when SIGNAL_INDEX / ontology compatibility changes (app release).
 */
export const SIGNAL_CATALOG_VERSION = 1;

/** Interaction types this binary can render. */
export const SUPPORTED_INTERACTION_TYPES: MomentInteractionType[] = [
  'single_choice',
  'multiple_choice',
  'ranking',
];

/** Immutable seed libraryVersion shipped with the app. */
export const SEED_LIBRARY_VERSION = 2;

export const LIBRARY_CACHE_ACTIVE_KEY = 'seen_moment_library_active_v1';
export const LIBRARY_CACHE_STAGING_KEY = 'seen_moment_library_staging_v1';
export const LIBRARY_CACHE_POINTER_KEY = 'seen_moment_library_pointer_v1';
