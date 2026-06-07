export const version = '0003_snapshot_columns';
export const name = 'Add order pricing and tax snapshot columns';

function tableExists(database, tableName) {
  return Boolean(
    database
      .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
      .get(tableName),
  );
}

function columnExists(database, tableName, columnName) {
  return database
    .prepare(`PRAGMA table_info(${tableName})`)
    .all()
    .some((column) => column.name === columnName);
}

function addColumnIfMissing(database, tableName, columnName, definition) {
  if (!tableExists(database, tableName) || columnExists(database, tableName, columnName)) return;
  database.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} ${definition}`).run();
}

export function up(database) {
  addColumnIfMissing(database, 'orders', 'pricing_policy_version', 'TEXT');
  addColumnIfMissing(database, 'orders', 'service_charge_rate', 'REAL DEFAULT 0');
  addColumnIfMissing(database, 'orders', 'service_charge_amount', 'REAL DEFAULT 0');
  addColumnIfMissing(database, 'orders', 'service_charge_cents', 'INTEGER');

  addColumnIfMissing(database, 'order_items', 'vat_rate_snapshot', 'REAL');

  if (tableExists(database, 'orders')) {
    database.prepare(`
      UPDATE orders SET
        service_charge_rate = COALESCE(service_charge_rate, 0),
        service_charge_amount = COALESCE(service_charge_amount, 0),
        service_charge_cents = COALESCE(service_charge_cents, 0)
      WHERE service_charge_rate IS NULL
         OR service_charge_amount IS NULL
         OR service_charge_cents IS NULL
    `).run();
  }

  if (tableExists(database, 'order_items')) {
    database.prepare(`
      UPDATE order_items SET vat_rate_snapshot = vat_rate
      WHERE vat_rate_snapshot IS NULL
    `).run();
  }
}
