import * as baselineLegacySchema from './0000_baseline_legacy_schema.js';
import * as createEntityMutations from './0001_create_entity_mutations.js';
import * as addCentsColumns from './0002_add_cents_columns.js';
import * as snapshotColumns from './0003_snapshot_columns.js';
import * as refreshTokens from './0004_refresh_tokens.js';
import * as devices from './0005_devices.js';
import * as takeawayPlannedPaymentType from './0006_takeaway_planned_payment_type.js';
import * as dropLegacyCustomerColumns from './0007_drop_legacy_customer_columns.js';
import * as customerNameSplitAndAddressAdmin from './0008_customer_name_split_and_address_admin.js';
import * as renormalizeCustomerPhones from './0009_renormalize_customer_phones.js';
import * as cleanupSoftDeletedCategories from './0010_cleanup_soft_deleted_categories.js';
import * as mustChangePassword from './0011_must_change_password.js';

export const BASELINE_SCHEMA_VERSION = baselineLegacySchema.version;

export const versionedMigrations = [
  baselineLegacySchema,
  createEntityMutations,
  addCentsColumns,
  snapshotColumns,
  refreshTokens,
  devices,
  takeawayPlannedPaymentType,
  dropLegacyCustomerColumns,
  customerNameSplitAndAddressAdmin,
  renormalizeCustomerPhones,
  cleanupSoftDeletedCategories,
  mustChangePassword,
];
