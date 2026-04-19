export const version = '0008_customer_name_split_and_address_admin';
export const name = 'Add first_name/last_name + address admin divisions (province/district/neighborhood)';

function columnExists(database, table, column) {
  const rows = database.prepare(`PRAGMA table_info(${table})`).all();
  return rows.some((r) => r.name === column);
}

function splitFullName(full) {
  if (!full || typeof full !== 'string') return { first: '', last: '' };
  const trimmed = full.trim().replace(/\s+/g, ' ');
  if (!trimmed) return { first: '', last: '' };
  const parts = trimmed.split(' ');
  if (parts.length === 1) return { first: parts[0], last: '' };
  return { first: parts[0], last: parts.slice(1).join(' ') };
}

export function up(database) {
  if (!columnExists(database, 'customers', 'first_name')) {
    database.exec(`ALTER TABLE customers ADD COLUMN first_name TEXT`);
  }
  if (!columnExists(database, 'customers', 'last_name')) {
    database.exec(`ALTER TABLE customers ADD COLUMN last_name TEXT`);
  }
  if (!columnExists(database, 'customer_addresses', 'province')) {
    database.exec(`ALTER TABLE customer_addresses ADD COLUMN province TEXT`);
  }
  if (!columnExists(database, 'customer_addresses', 'district')) {
    database.exec(`ALTER TABLE customer_addresses ADD COLUMN district TEXT`);
  }
  if (!columnExists(database, 'customer_addresses', 'neighborhood')) {
    database.exec(`ALTER TABLE customer_addresses ADD COLUMN neighborhood TEXT`);
  }

  const rows = database.prepare(
    `SELECT id, full_name, first_name, last_name FROM customers`,
  ).all();
  const update = database.prepare(
    `UPDATE customers SET first_name = ?, last_name = ? WHERE id = ?`,
  );
  const txn = database.transaction(() => {
    for (const r of rows) {
      if (r.first_name || r.last_name) continue;
      const { first, last } = splitFullName(r.full_name);
      if (first || last) update.run(first || null, last || null, r.id);
    }
  });
  txn();
}
