import * as baselineLegacySchema from './0000_baseline_legacy_schema.js';
import * as createEntityMutations from './0001_create_entity_mutations.js';

export const BASELINE_SCHEMA_VERSION = baselineLegacySchema.version;

export const versionedMigrations = [
  baselineLegacySchema,
  createEntityMutations,
];
