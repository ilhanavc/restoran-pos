import * as baselineLegacySchema from './0000_baseline_legacy_schema.js';
import * as createEntityMutations from './0001_create_entity_mutations.js';
import * as addCentsColumns from './0002_add_cents_columns.js';
import * as snapshotColumns from './0003_snapshot_columns.js';
import * as refreshTokens from './0004_refresh_tokens.js';
import * as devices from './0005_devices.js';

export const BASELINE_SCHEMA_VERSION = baselineLegacySchema.version;

export const versionedMigrations = [
  baselineLegacySchema,
  createEntityMutations,
  addCentsColumns,
  snapshotColumns,
  refreshTokens,
  devices,
];
