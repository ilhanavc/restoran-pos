export const version = '0002_add_cents_columns';
export const name = 'Add integer cents shadow columns';

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

function addColumnIfMissing(database, tableName, columnName) {
  if (!tableExists(database, tableName) || columnExists(database, tableName, columnName)) return;
  database.prepare(`ALTER TABLE ${tableName} ADD COLUMN ${columnName} INTEGER`).run();
}

export function up(database) {
  addColumnIfMissing(database, 'orders', 'subtotal_cents');
  addColumnIfMissing(database, 'orders', 'discount_cents');
  addColumnIfMissing(database, 'orders', 'grand_total_cents');

  addColumnIfMissing(database, 'order_items', 'unit_price_cents');
  addColumnIfMissing(database, 'order_items', 'subtotal_cents');

  addColumnIfMissing(database, 'payments', 'amount_cents');
  addColumnIfMissing(database, 'payments', 'change_cents');
  addColumnIfMissing(database, 'payments', 'tip_cents');

  addColumnIfMissing(database, 'refunds', 'amount_cents');

  addColumnIfMissing(database, 'products', 'price_cents');
  addColumnIfMissing(database, 'product_portions', 'price_cents');

  if (tableExists(database, 'orders')) {
    database.prepare(`
      UPDATE orders SET
        subtotal_cents = ROUND(subtotal * 100),
        discount_cents = ROUND(COALESCE(discount_amount, 0) * 100),
        grand_total_cents = ROUND(grand_total * 100)
      WHERE grand_total_cents IS NULL
    `).run();
  }

  if (tableExists(database, 'order_items')) {
    database.prepare(`
      UPDATE order_items SET
        unit_price_cents = ROUND(unit_price * 100),
        subtotal_cents = ROUND((unit_price * quantity - COALESCE(discount_amount, 0)) * 100)
      WHERE subtotal_cents IS NULL
    `).run();
  }

  if (tableExists(database, 'payments')) {
    database.prepare(`
      UPDATE payments SET
        amount_cents = ROUND(amount * 100),
        change_cents = ROUND(COALESCE(change_amount, 0) * 100),
        tip_cents = ROUND(COALESCE(tip_amount, 0) * 100)
      WHERE amount_cents IS NULL
    `).run();
  }

  if (tableExists(database, 'refunds')) {
    database.prepare(`
      UPDATE refunds SET amount_cents = ROUND(amount * 100)
      WHERE amount_cents IS NULL
    `).run();
  }

  if (tableExists(database, 'products')) {
    database.prepare(`
      UPDATE products SET price_cents = ROUND(price * 100)
      WHERE price_cents IS NULL
    `).run();
  }

  if (tableExists(database, 'product_portions')) {
    database.prepare(`
      UPDATE product_portions SET price_cents = ROUND(price * 100)
      WHERE price_cents IS NULL
    `).run();
  }
}
