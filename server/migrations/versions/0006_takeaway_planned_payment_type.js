export const version = '0006_takeaway_planned_payment_type';
export const name = 'Add takeaway_planned_payment_type column to orders';

function columnExists(database, table, column) {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r.name === column);
}

export function up(database) {
  if (!columnExists(database, 'orders', 'takeaway_planned_payment_type')) {
    database.exec(`ALTER TABLE orders ADD COLUMN takeaway_planned_payment_type TEXT`);
  }
}
