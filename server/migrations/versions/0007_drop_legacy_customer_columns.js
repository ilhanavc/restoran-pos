export const version = '0007_drop_legacy_customer_columns';
export const name = 'Drop unused legacy_* columns from customers';

function columnExists(database, table, column) {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r.name === column);
}

export function up(database) {
  const cols = ['legacy_no', 'legacy_balance', 'legacy_total_amount', 'legacy_discount_amount'];
  for (const col of cols) {
    if (columnExists(database, 'customers', col)) {
      database.exec(`ALTER TABLE customers DROP COLUMN ${col}`);
    }
  }
}
