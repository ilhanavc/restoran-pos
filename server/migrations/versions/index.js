import * as baselineLegacySchema from './0000_baseline_legacy_schema.js';

export const BASELINE_SCHEMA_VERSION = baselineLegacySchema.version;

export const versionedMigrations = [
  baselineLegacySchema,
];
