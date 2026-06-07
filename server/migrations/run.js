import db from '../config/database.js';
import { normalizePhoneDigits } from '../utils/phoneNormalize.js';
import { genId } from '../utils/helpers.js';
import { BASELINE_SCHEMA_VERSION, versionedMigrations } from './versions/index.js';

export const SCHEMA_MIGRATIONS_TABLE_SQL = `
  CREATE TABLE IF NOT EXISTS schema_migrations (
    version TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    applied_at TEXT NOT NULL DEFAULT (datetime('now'))
  )
`;

const MIGRATION_VERSION_PATTERN = /^\d{4}_[a-z0-9_]+$/;

export const migrations = [
  // ── Businesses & Branches ──
  `CREATE TABLE IF NOT EXISTS businesses (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    tax_id TEXT,
    tax_office TEXT,
    logo_url TEXT,
    receipt_header TEXT,
    receipt_footer TEXT DEFAULT 'Bizi tercih ettiğiniz için teşekkürler!',
    default_vat_rate REAL DEFAULT 10.0,
    service_charge_rate REAL DEFAULT 0.0,
    currency TEXT DEFAULT 'TRY',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS branches (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    name TEXT NOT NULL,
    phone TEXT,
    address TEXT,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,

  // ── Users & Roles ──
  `CREATE TABLE IF NOT EXISTS roles (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    name TEXT NOT NULL,
    slug TEXT NOT NULL,
    permissions TEXT DEFAULT '{}',
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    branch_id TEXT REFERENCES branches(id),
    role_id TEXT NOT NULL REFERENCES roles(id),
    email TEXT NOT NULL,
    password_hash TEXT NOT NULL,
    full_name TEXT NOT NULL,
    is_active INTEGER DEFAULT 1,
    last_login_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(email, business_id)
  )`,

  // ── Dining Areas & Tables ──
  `CREATE TABLE IF NOT EXISTS dining_areas (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    branch_id TEXT REFERENCES branches(id),
    name TEXT NOT NULL,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    target_table_count INTEGER,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS tables (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    branch_id TEXT REFERENCES branches(id),
    dining_area_id TEXT NOT NULL REFERENCES dining_areas(id),
    name TEXT NOT NULL,
    capacity INTEGER DEFAULT 4,
    status TEXT DEFAULT 'empty' CHECK(status IN ('empty','occupied','reserved')),
    current_order_id TEXT,
    guest_count INTEGER DEFAULT 0,
    note TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,

  // ── Categories & Products ──
  `CREATE TABLE IF NOT EXISTS categories (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    name TEXT NOT NULL,
    color TEXT DEFAULT '#6366f1',
    icon TEXT,
    sort_order INTEGER DEFAULT 0,
    printer_target TEXT DEFAULT 'kitchen',
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS products (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    category_id TEXT NOT NULL REFERENCES categories(id),
    name TEXT NOT NULL,
    description TEXT,
    price REAL NOT NULL CHECK(price > 0),
    barcode TEXT,
    image_url TEXT,
    vat_rate REAL DEFAULT 10.0,
    printer_target TEXT,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    is_deleted INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS product_modifiers (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    product_id TEXT NOT NULL REFERENCES products(id),
    group_name TEXT NOT NULL,
    name TEXT NOT NULL,
    price_delta REAL DEFAULT 0,
    sort_order INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS product_portions (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    label TEXT NOT NULL,
    price REAL NOT NULL,
    sort_order INTEGER DEFAULT 0,
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS product_combos (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    parent_product_id TEXT NOT NULL REFERENCES products(id),
    child_product_id TEXT NOT NULL REFERENCES products(id),
    quantity INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(parent_product_id, child_product_id)
  )`,

  // ── Customers ──
  `CREATE TABLE IF NOT EXISTS customers (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    full_name TEXT NOT NULL,
    note TEXT,
    is_blacklisted INTEGER DEFAULT 0,
    blacklist_note TEXT,
    total_orders INTEGER DEFAULT 0,
    last_order_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS customer_phones (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    phone TEXT NOT NULL,
    is_primary INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS customer_addresses (
    id TEXT PRIMARY KEY,
    customer_id TEXT NOT NULL REFERENCES customers(id),
    title TEXT DEFAULT 'Ev',
    address TEXT NOT NULL,
    address_note TEXT,
    is_default INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  // ── Orders ──
  `CREATE TABLE IF NOT EXISTS orders (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    branch_id TEXT REFERENCES branches(id),
    order_no INTEGER,
    order_type TEXT NOT NULL DEFAULT 'dine_in' CHECK(order_type IN ('dine_in','takeaway')),
    table_id TEXT REFERENCES tables(id),
    customer_id TEXT REFERENCES customers(id),
    user_id TEXT REFERENCES users(id),
    status TEXT DEFAULT 'new' CHECK(status IN ('new','saved','in_kitchen','preparing','ready','served','cancelled','closed')),
    subtotal REAL DEFAULT 0 CHECK(subtotal >= 0),
    discount_amount REAL DEFAULT 0 CHECK(discount_amount >= 0),
    discount_percent REAL DEFAULT 0 CHECK(discount_percent >= 0),
    service_charge REAL DEFAULT 0 CHECK(service_charge >= 0),
    vat_total REAL DEFAULT 0 CHECK(vat_total >= 0),
    grand_total REAL DEFAULT 0 CHECK(grand_total >= 0),
    note TEXT,
    delivery_address TEXT,
    delivery_note TEXT,
    courier_note TEXT,
    guest_count INTEGER DEFAULT 0,
    table_name_snapshot TEXT,
    customer_name_snapshot TEXT,
    user_name_snapshot TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    closed_at TEXT,
    created_by TEXT REFERENCES users(id),
    updated_by TEXT REFERENCES users(id)
  )`,

  `CREATE TABLE IF NOT EXISTS order_items (
    id TEXT PRIMARY KEY,
    order_id TEXT NOT NULL REFERENCES orders(id),
    product_id TEXT NOT NULL REFERENCES products(id),
    product_name TEXT NOT NULL,
    quantity INTEGER DEFAULT 1 CHECK(quantity > 0),
    unit_price REAL NOT NULL CHECK(unit_price >= 0),
    modifiers TEXT DEFAULT '[]',
    note TEXT,
    status TEXT DEFAULT 'new' CHECK(status IN ('new','sent','preparing','ready','served','cancelled','comped')),
    discount_amount REAL DEFAULT 0,
    is_comped INTEGER DEFAULT 0,
    comp_reason TEXT,
    vat_rate REAL DEFAULT 10.0,
    category_id_snapshot TEXT,
    category_name_snapshot TEXT,
    printer_target_snapshot TEXT,
    sent_to_kitchen_at TEXT,
    prepared_at TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT REFERENCES users(id)
  )`,

  // ── Payments ──
  `CREATE TABLE IF NOT EXISTS payments (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    order_id TEXT NOT NULL REFERENCES orders(id),
    payment_type TEXT NOT NULL CHECK(payment_type IN ('cash','card','mixed','other')),
    payment_scope TEXT NOT NULL DEFAULT 'full_order' CHECK(payment_scope IN ('full_order','split_item')),
    payer_no INTEGER,
    payer_label TEXT,
    amount REAL NOT NULL CHECK(amount > 0),
    tip_amount REAL DEFAULT 0 CHECK(tip_amount >= 0),
    cash_received REAL DEFAULT 0 CHECK(cash_received >= 0),
    change_amount REAL DEFAULT 0 CHECK(change_amount >= 0),
    note TEXT,
    idempotency_key TEXT,
    source TEXT DEFAULT 'manual',
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT REFERENCES users(id)
  )`,

  `CREATE TABLE IF NOT EXISTS payment_allocations (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    payment_id TEXT NOT NULL REFERENCES payments(id),
    order_id TEXT NOT NULL REFERENCES orders(id),
    order_item_id TEXT NOT NULL REFERENCES order_items(id),
    quantity INTEGER NOT NULL CHECK(quantity > 0),
    unit_price_snapshot REAL NOT NULL,
    line_total REAL NOT NULL,
    payer_no INTEGER,
    payer_label TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  // ── Period Close / X-Z Reports ──
  `CREATE TABLE IF NOT EXISTS period_closes (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    branch_id TEXT REFERENCES branches(id),
    period_date TEXT NOT NULL,
    opened_at TEXT NOT NULL,
    closed_at TEXT,
    closed_by TEXT REFERENCES users(id),
    status TEXT NOT NULL DEFAULT 'open' CHECK(status IN ('open','closed')),
    x_snapshot_json TEXT,
    z_snapshot_json TEXT,
    note TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(business_id, period_date)
  )`,

  `CREATE TABLE IF NOT EXISTS refunds (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    order_id TEXT NOT NULL REFERENCES orders(id),
    payment_id TEXT NOT NULL REFERENCES payments(id),
    amount REAL NOT NULL CHECK(amount > 0),
    reason TEXT,
    status TEXT NOT NULL DEFAULT 'completed' CHECK(status IN ('completed','voided')),
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT REFERENCES users(id)
  )`,

  `CREATE TABLE IF NOT EXISTS tips (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    order_id TEXT NOT NULL REFERENCES orders(id),
    payment_id TEXT NOT NULL REFERENCES payments(id),
    amount REAL NOT NULL CHECK(amount > 0),
    created_at TEXT DEFAULT (datetime('now')),
    created_by TEXT REFERENCES users(id)
  )`,

  // ── Printers ──
  `CREATE TABLE IF NOT EXISTS printers (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    branch_id TEXT REFERENCES branches(id),
    name TEXT NOT NULL,
    type TEXT DEFAULT 'receipt' CHECK(type IN ('receipt','kitchen','bar')),
    connection_type TEXT DEFAULT 'network',
    ip_address TEXT,
    port INTEGER DEFAULT 9100,
    is_active INTEGER DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS printer_routing (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    category_id TEXT REFERENCES categories(id),
    printer_id TEXT NOT NULL REFERENCES printers(id),
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS print_jobs (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    order_id TEXT REFERENCES orders(id),
    printer_id TEXT REFERENCES printers(id),
    job_type TEXT NOT NULL,
    payload TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','printed','failed','cancelled')),
    error_message TEXT,
    idempotency_key TEXT UNIQUE,
    created_at TEXT DEFAULT (datetime('now')),
    printed_at TEXT,
    claimed_at TEXT,
    claimed_by TEXT,
    claimed_until TEXT,
    attempt_count INTEGER NOT NULL DEFAULT 0,
    last_attempt_at TEXT,
    last_error_code TEXT
  )`,

  // ── Caller ID / Incoming Calls ──
  `CREATE TABLE IF NOT EXISTS incoming_calls (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    phone TEXT NOT NULL,
    customer_id TEXT REFERENCES customers(id),
    matched INTEGER DEFAULT 0,
    call_note TEXT,
    handled INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  // ── Audit Logs ──
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    user_id TEXT REFERENCES users(id),
    action TEXT NOT NULL,
    entity_type TEXT,
    entity_id TEXT,
    details TEXT,
    ip_address TEXT,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  // ── Settings ──
  `CREATE TABLE IF NOT EXISTS settings (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    key TEXT NOT NULL,
    value TEXT,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now')),
    UNIQUE(business_id, key)
  )`,

  // ── Indexes ──
  `CREATE INDEX IF NOT EXISTS idx_users_business ON users(business_id)`,
  `CREATE INDEX IF NOT EXISTS idx_users_email ON users(email)`,
  `CREATE INDEX IF NOT EXISTS idx_tables_business ON tables(business_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tables_area ON tables(dining_area_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tables_current_order ON tables(current_order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_business ON orders(business_id)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_table ON orders(table_id)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_type ON orders(order_type)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_business_created ON orders(business_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_business_status_created ON orders(business_id, status, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_business_closed ON orders(business_id, closed_at)`,
  `CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_order_items_product ON order_items(product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_products_business ON products(business_id)`,
  `CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id)`,
  `CREATE INDEX IF NOT EXISTS idx_products_business_active ON products(business_id, is_active, is_deleted)`,
  `CREATE INDEX IF NOT EXISTS idx_product_portions_product ON product_portions(product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_categories_business ON categories(business_id)`,
  `CREATE INDEX IF NOT EXISTS idx_customers_business ON customers(business_id)`,
  `CREATE INDEX IF NOT EXISTS idx_customer_phones_customer ON customer_phones(customer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_customer_phones_phone ON customer_phones(phone)`,
  `CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_payments_business_created ON payments(business_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_payments_business_type_created ON payments(business_id, payment_type, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment ON payment_allocations(payment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_payment_allocations_order ON payment_allocations(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_payment_allocations_order_item ON payment_allocations(order_item_id)`,
  `CREATE INDEX IF NOT EXISTS idx_period_closes_business_date ON period_closes(business_id, period_date)`,
  `CREATE INDEX IF NOT EXISTS idx_period_closes_business_status ON period_closes(business_id, status)`,
  `CREATE INDEX IF NOT EXISTS idx_refunds_business_created ON refunds(business_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_refunds_order ON refunds(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_refunds_payment ON refunds(payment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tips_business_created ON tips(business_id, created_at)`,
  `CREATE INDEX IF NOT EXISTS idx_tips_order ON tips(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_tips_payment ON tips(payment_id)`,
  `CREATE INDEX IF NOT EXISTS idx_incoming_calls_phone ON incoming_calls(phone)`,
  `CREATE INDEX IF NOT EXISTS idx_audit_logs_business ON audit_logs(business_id)`,
  `CREATE INDEX IF NOT EXISTS idx_print_jobs_business_status_created ON print_jobs(business_id, status, created_at)`,

  // ── Rezervasyonlar ──
  `CREATE TABLE IF NOT EXISTS reservations (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    table_id TEXT REFERENCES tables(id),
    customer_name TEXT NOT NULL,
    customer_phone TEXT,
    party_size INTEGER DEFAULT 2,
    reservation_date TEXT NOT NULL,
    reservation_time TEXT NOT NULL,
    notes TEXT,
    status TEXT NOT NULL DEFAULT 'confirmed',
    arrived_at TEXT,
    seated_order_id TEXT REFERENCES orders(id),
    created_by TEXT REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_reservations_business_date ON reservations(business_id, reservation_date)`,
  `CREATE INDEX IF NOT EXISTS idx_reservations_table ON reservations(table_id)`,

  // ── Stok ──
  `CREATE TABLE IF NOT EXISTS stock_items (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    name TEXT NOT NULL,
    unit TEXT NOT NULL DEFAULT 'adet',
    quantity REAL NOT NULL DEFAULT 0,
    min_quantity REAL NOT NULL DEFAULT 0,
    cost_price REAL DEFAULT 0,
    is_active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_stock_items_business ON stock_items(business_id)`,

  `CREATE TABLE IF NOT EXISTS stock_movements (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    stock_item_id TEXT NOT NULL REFERENCES stock_items(id),
    movement_type TEXT NOT NULL,
    quantity REAL NOT NULL,
    notes TEXT,
    created_by TEXT REFERENCES users(id),
    created_at TEXT DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS idx_stock_movements_item ON stock_movements(stock_item_id)`,

  // ── Özellik Grupları (Attributes) ──
  `CREATE TABLE IF NOT EXISTS attribute_groups (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    name TEXT NOT NULL,
    selection_type TEXT NOT NULL DEFAULT 'single' CHECK(selection_type IN ('single','multiple')),
    is_required INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now')),
    updated_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS attribute_options (
    id TEXT PRIMARY KEY,
    group_id TEXT NOT NULL REFERENCES attribute_groups(id) ON DELETE CASCADE,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    name TEXT NOT NULL,
    extra_price REAL DEFAULT 0,
    is_default INTEGER DEFAULT 0,
    is_active INTEGER DEFAULT 1,
    sort_order INTEGER DEFAULT 0,
    created_at TEXT DEFAULT (datetime('now'))
  )`,

  `CREATE TABLE IF NOT EXISTS category_attribute_groups (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    category_id TEXT NOT NULL REFERENCES categories(id) ON DELETE CASCADE,
    group_id TEXT NOT NULL REFERENCES attribute_groups(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(category_id, group_id)
  )`,

  `CREATE TABLE IF NOT EXISTS product_attribute_groups (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    product_id TEXT NOT NULL REFERENCES products(id) ON DELETE CASCADE,
    group_id TEXT NOT NULL REFERENCES attribute_groups(id) ON DELETE CASCADE,
    created_at TEXT DEFAULT (datetime('now')),
    UNIQUE(product_id, group_id)
  )`,

  `CREATE INDEX IF NOT EXISTS idx_attribute_groups_business ON attribute_groups(business_id)`,
  `CREATE INDEX IF NOT EXISTS idx_attribute_options_group ON attribute_options(group_id)`,
  `CREATE INDEX IF NOT EXISTS idx_category_attribute_groups_category ON category_attribute_groups(category_id)`,
  `CREATE INDEX IF NOT EXISTS idx_product_attribute_groups_product ON product_attribute_groups(product_id)`,

  // ── Garson Çağırma ──
  `CREATE TABLE IF NOT EXISTS waiter_calls (
    id TEXT PRIMARY KEY,
    business_id TEXT NOT NULL REFERENCES businesses(id),
    table_id TEXT NOT NULL REFERENCES tables(id),
    table_name TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','resolved')),
    created_at TEXT DEFAULT (datetime('now')),
    resolved_at TEXT,
    resolved_by TEXT REFERENCES users(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_waiter_calls_business_status ON waiter_calls(business_id, status)`,
];

/** Eski KDV eklemeli tutarları: ürün fiyatları KDV dahil kabul edilerek siparişleri yeniden hesaplar (bir kez). */
function migrateVatInclusivePricingOnce() {
  try {
    const ver = db.pragma('user_version', { simple: true });
    if (ver >= 1) return;
    db.transaction(() => {
      db.prepare('UPDATE products SET vat_rate = 0').run();
      db.prepare('UPDATE order_items SET vat_rate = 0').run();
      const orders = db.prepare('SELECT id FROM orders').all();
      for (const row of orders) {
        const items = db.prepare(`SELECT * FROM order_items WHERE order_id = ? AND status != 'cancelled'`).all(row.id);
        let subtotal = 0;
        for (const item of items) {
          if (item.is_comped) continue;
          const line = item.unit_price * item.quantity - (item.discount_amount || 0);
          subtotal += line;
        }
        const ord = db.prepare('SELECT discount_amount FROM orders WHERE id = ?').get(row.id);
        const grand = subtotal - (ord?.discount_amount || 0);
        db.prepare('UPDATE orders SET subtotal = ?, vat_total = 0, grand_total = ? WHERE id = ?').run(subtotal, grand, row.id);
      }
    })();
    db.exec('PRAGMA user_version = 1');
    console.log('✅ KDV dahil fiyat migrasyonu uygulandı (user_version=1)');
  } catch (e) {
    console.error('migrateVatInclusivePricingOnce:', e);
  }
}

/** Aynı kategori için birden fazla printer_routing satırını temizler; benzersiz indeks ekler. */
function ensurePrinterRoutingUniqueIndex(database = db) {
  try {
    const hasIdx = database
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_printer_routing_business_category'`)
      .get();
    if (hasIdx) return;

    const dupGroups = database
      .prepare(
        `SELECT business_id, category_id FROM printer_routing GROUP BY business_id, category_id HAVING COUNT(*) > 1`,
      )
      .all();
    for (const g of dupGroups) {
      const rows = database
        .prepare(
          `SELECT id FROM printer_routing WHERE business_id = ? AND category_id = ? ORDER BY datetime(created_at), id`,
        )
        .all(g.business_id, g.category_id);
      for (let i = 1; i < rows.length; i++) {
        database.prepare('DELETE FROM printer_routing WHERE id = ?').run(rows[i].id);
      }
    }
    database.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_printer_routing_business_category ON printer_routing(business_id, category_id)`,
    );
  } catch (e) {
    console.error('ensurePrinterRoutingUniqueIndex:', e);
  }
}

function ensureActiveDineInTableGuard(database = db) {
  try {
    database.exec(`
      UPDATE tables
      SET status = 'empty',
          current_order_id = NULL,
          guest_count = 0,
          updated_at = datetime('now')
      WHERE current_order_id IS NOT NULL
        AND NOT EXISTS (
          SELECT 1
          FROM orders o
          WHERE o.id = tables.current_order_id
            AND o.business_id = tables.business_id
            AND o.status NOT IN ('closed', 'cancelled')
        )
    `);

    const dup = database.prepare(`
      SELECT business_id, table_id, COUNT(*) AS c
      FROM orders
      WHERE order_type = 'dine_in'
        AND table_id IS NOT NULL
        AND status NOT IN ('closed', 'cancelled')
      GROUP BY business_id, table_id
      HAVING COUNT(*) > 1
      LIMIT 1
    `).get();
    if (dup) {
      console.warn(
        `⚠️ Aktif masa/sipariş tekilliği için indeks atlandı: table_id=${dup.table_id} açık sipariş sayısı=${dup.c}`,
      );
      return;
    }

    database.exec(`
      CREATE UNIQUE INDEX IF NOT EXISTS idx_orders_active_dine_in_table_unique
      ON orders(business_id, table_id)
      WHERE order_type = 'dine_in'
        AND table_id IS NOT NULL
        AND status NOT IN ('closed', 'cancelled')
    `);
  } catch (e) {
    console.error('ensureActiveDineInTableGuard:', e);
  }
}

function ensureColumnMigrations(database = db) {
  const diningCols = database.prepare('PRAGMA table_info(dining_areas)').all();
  if (!diningCols.some((c) => c.name === 'target_table_count')) {
    database.prepare('ALTER TABLE dining_areas ADD COLUMN target_table_count INTEGER').run();
  }
  const orderCols = database.prepare('PRAGMA table_info(orders)').all();
  if (!orderCols.some((c) => c.name === 'takeaway_out_at')) {
    database.prepare('ALTER TABLE orders ADD COLUMN takeaway_out_at TEXT').run();
  }
  if (!orderCols.some((c) => c.name === 'takeaway_delivered_at')) {
    database.prepare('ALTER TABLE orders ADD COLUMN takeaway_delivered_at TEXT').run();
  }
  const orderColsAfterTakeaway = database.prepare('PRAGMA table_info(orders)').all();
  if (!orderColsAfterTakeaway.some((c) => c.name === 'table_name_snapshot')) {
    database.prepare('ALTER TABLE orders ADD COLUMN table_name_snapshot TEXT').run();
  }
  if (!orderColsAfterTakeaway.some((c) => c.name === 'customer_name_snapshot')) {
    database.prepare('ALTER TABLE orders ADD COLUMN customer_name_snapshot TEXT').run();
  }
  if (!orderColsAfterTakeaway.some((c) => c.name === 'user_name_snapshot')) {
    database.prepare('ALTER TABLE orders ADD COLUMN user_name_snapshot TEXT').run();
  }

  const cpCols = database.prepare('PRAGMA table_info(customer_phones)').all();
  if (cpCols.length && !cpCols.some((c) => c.name === 'normalized_phone')) {
    database.prepare('ALTER TABLE customer_phones ADD COLUMN normalized_phone TEXT').run();
  }

  const printerCols = database.prepare('PRAGMA table_info(printers)').all();
  if (printerCols.length && !printerCols.some((c) => c.name === 'print_options')) {
    database.prepare('ALTER TABLE printers ADD COLUMN print_options TEXT').run();
  }
  if (printerCols.length && !printerCols.some((c) => c.name === 'line_width')) {
    database.prepare('ALTER TABLE printers ADD COLUMN line_width INTEGER').run();
  }
  if (printerCols.length) {
    database.prepare('UPDATE printers SET line_width = 42 WHERE line_width IS NOT NULL AND line_width > 42').run();
    database.prepare('UPDATE printers SET line_width = NULL WHERE line_width IS NOT NULL AND line_width < 32').run();

    const printerOptionRows = database
      .prepare('SELECT id, type, print_options FROM printers WHERE print_options IS NOT NULL AND print_options != ?')
      .all('');
    const updatePrinterOptions = database.prepare('UPDATE printers SET print_options = ? WHERE id = ?');
    for (const row of printerOptionRows) {
      try {
        const parsed = JSON.parse(row.print_options);
        let changed = false;
        if (parsed?.template?.enabled === true) {
          parsed.template = { ...parsed.template, enabled: false };
          changed = true;
        }
        const isReceiptPrinter = String(row.type || 'receipt') === 'receipt';
        if (isReceiptPrinter && parsed?.encodingMode !== 'win1254') {
          parsed.encodingMode = 'win1254';
          changed = true;
        }
        if (isReceiptPrinter && parsed?.escT !== 32) {
          parsed.escT = 32;
          changed = true;
        }
        if (isReceiptPrinter && parsed?.skipPhoenixCmd !== true) {
          parsed.skipPhoenixCmd = true;
          changed = true;
        }
        if (changed) {
          updatePrinterOptions.run(JSON.stringify(parsed), row.id);
        }
      } catch {
        // Invalid printer options should not block startup migrations.
      }
    }
  }

  let pjCols = database.prepare('PRAGMA table_info(print_jobs)').all();
  if (pjCols.length && !pjCols.some((c) => c.name === 'claimed_at')) {
    database.prepare('ALTER TABLE print_jobs ADD COLUMN claimed_at TEXT').run();
  }
  pjCols = database.prepare('PRAGMA table_info(print_jobs)').all();
  if (pjCols.length && !pjCols.some((c) => c.name === 'claimed_by')) {
    database.prepare('ALTER TABLE print_jobs ADD COLUMN claimed_by TEXT').run();
  }
  pjCols = database.prepare('PRAGMA table_info(print_jobs)').all();
  if (pjCols.length && !pjCols.some((c) => c.name === 'claimed_until')) {
    database.prepare('ALTER TABLE print_jobs ADD COLUMN claimed_until TEXT').run();
  }
  pjCols = database.prepare('PRAGMA table_info(print_jobs)').all();
  if (pjCols.length && !pjCols.some((c) => c.name === 'attempt_count')) {
    database.prepare('ALTER TABLE print_jobs ADD COLUMN attempt_count INTEGER NOT NULL DEFAULT 0').run();
  }
  pjCols = database.prepare('PRAGMA table_info(print_jobs)').all();
  if (pjCols.length && !pjCols.some((c) => c.name === 'last_attempt_at')) {
    database.prepare('ALTER TABLE print_jobs ADD COLUMN last_attempt_at TEXT').run();
  }
  pjCols = database.prepare('PRAGMA table_info(print_jobs)').all();
  if (pjCols.length && !pjCols.some((c) => c.name === 'last_error_code')) {
    database.prepare('ALTER TABLE print_jobs ADD COLUMN last_error_code TEXT').run();
  }
  database.exec(`CREATE INDEX IF NOT EXISTS idx_print_jobs_business_status_claimed ON print_jobs(business_id, status, claimed_at, created_at)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_print_jobs_business_status_lease ON print_jobs(business_id, status, claimed_until, created_at)`);

  const paymentCols = database.prepare('PRAGMA table_info(payments)').all();
  if (paymentCols.length && !paymentCols.some((c) => c.name === 'payment_scope')) {
    database.prepare(
      `ALTER TABLE payments ADD COLUMN payment_scope TEXT NOT NULL DEFAULT 'full_order' CHECK(payment_scope IN ('full_order','split_item'))`,
    ).run();
  }
  if (paymentCols.length && !paymentCols.some((c) => c.name === 'payer_no')) {
    database.prepare('ALTER TABLE payments ADD COLUMN payer_no INTEGER').run();
  }
  if (paymentCols.length && !paymentCols.some((c) => c.name === 'payer_label')) {
    database.prepare('ALTER TABLE payments ADD COLUMN payer_label TEXT').run();
  }
  if (paymentCols.length && !paymentCols.some((c) => c.name === 'idempotency_key')) {
    database.prepare('ALTER TABLE payments ADD COLUMN idempotency_key TEXT').run();
  }
  if (paymentCols.length && !paymentCols.some((c) => c.name === 'source')) {
    database.prepare("ALTER TABLE payments ADD COLUMN source TEXT DEFAULT 'manual'").run();
  }
  if (paymentCols.length && !paymentCols.some((c) => c.name === 'tip_amount')) {
    database.prepare('ALTER TABLE payments ADD COLUMN tip_amount REAL DEFAULT 0 CHECK(tip_amount >= 0)').run();
  }
  database.exec(`CREATE UNIQUE INDEX IF NOT EXISTS idx_payments_idempotency ON payments(business_id, order_id, idempotency_key) WHERE idempotency_key IS NOT NULL`);

  database.exec(`
    CREATE TABLE IF NOT EXISTS payment_allocations (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      payment_id TEXT NOT NULL REFERENCES payments(id),
      order_id TEXT NOT NULL REFERENCES orders(id),
      order_item_id TEXT NOT NULL REFERENCES order_items(id),
      quantity INTEGER NOT NULL CHECK(quantity > 0),
      unit_price_snapshot REAL NOT NULL,
      line_total REAL NOT NULL,
      payer_no INTEGER,
      payer_label TEXT,
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_payment_allocations_payment ON payment_allocations(payment_id)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_payment_allocations_order ON payment_allocations(order_id)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_payment_allocations_order_item ON payment_allocations(order_item_id)`);

  database.exec(`
    CREATE TABLE IF NOT EXISTS tips (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      order_id TEXT NOT NULL REFERENCES orders(id),
      payment_id TEXT NOT NULL REFERENCES payments(id),
      amount REAL NOT NULL CHECK(amount > 0),
      created_at TEXT DEFAULT (datetime('now')),
      created_by TEXT REFERENCES users(id)
    )
  `);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_tips_business_created ON tips(business_id, created_at)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_tips_order ON tips(order_id)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_tips_payment ON tips(payment_id)`);

  // order_id NOT NULL → nullable (test job'ları için gerekli; SQLite tablo recreation gerektirir)
  pjCols = database.prepare('PRAGMA table_info(print_jobs)').all();
  const pjOrderIdCol = pjCols.find((c) => c.name === 'order_id');
  if (pjOrderIdCol && pjOrderIdCol.notnull === 1) {
    const colNames = pjCols.map((c) => c.name).join(', ');
    database.exec(`CREATE TABLE print_jobs_new (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      order_id TEXT REFERENCES orders(id),
      printer_id TEXT REFERENCES printers(id),
      job_type TEXT NOT NULL,
      payload TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','printed','failed','cancelled')),
      error_message TEXT,
      idempotency_key TEXT UNIQUE,
      created_at TEXT DEFAULT (datetime('now')),
      printed_at TEXT,
      claimed_at TEXT,
      claimed_by TEXT,
      claimed_until TEXT,
      attempt_count INTEGER NOT NULL DEFAULT 0,
      last_attempt_at TEXT,
      last_error_code TEXT
    )`);
    database.exec(`INSERT INTO print_jobs_new (${colNames}) SELECT ${colNames} FROM print_jobs`);
    database.exec(`DROP TABLE print_jobs`);
    database.exec(`ALTER TABLE print_jobs_new RENAME TO print_jobs`);
    database.exec(`CREATE INDEX IF NOT EXISTS idx_print_jobs_business_status_created ON print_jobs(business_id, status, created_at)`);
    console.log('✅ print_jobs.order_id NOT NULL kısıtı kaldırıldı (nullable yapıldı)');
  }

  ensurePrinterRoutingUniqueIndex(database);
  ensureActiveDineInTableGuard(database);

  database.exec(`
    CREATE TABLE IF NOT EXISTS call_logs (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      phone TEXT NOT NULL,
      normalized_phone TEXT NOT NULL,
      customer_id TEXT REFERENCES customers(id),
      order_id TEXT REFERENCES orders(id),
      customer_name_snapshot TEXT,
      address_snapshot TEXT,
      source_type TEXT DEFAULT 'http',
      status TEXT NOT NULL DEFAULT 'ringing' CHECK(status IN ('ringing','dismissed','opened_order','completed')),
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  const callLogCols = database.prepare('PRAGMA table_info(call_logs)').all();
  if (callLogCols.length && !callLogCols.some((c) => c.name === 'order_id')) {
    database.prepare('ALTER TABLE call_logs ADD COLUMN order_id TEXT REFERENCES orders(id)').run();
  }
  database.exec(`CREATE INDEX IF NOT EXISTS idx_customer_phones_normalized ON customer_phones(normalized_phone)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_call_logs_business_created ON call_logs(business_id, created_at DESC)`);
  database.exec(`CREATE INDEX IF NOT EXISTS idx_call_logs_normalized ON call_logs(normalized_phone)`);

  let oiColsPragma = database.prepare('PRAGMA table_info(order_items)').all();
  if (oiColsPragma.length && !oiColsPragma.some((c) => c.name === 'portion_id')) {
    database.prepare('ALTER TABLE order_items ADD COLUMN portion_id TEXT').run();
    oiColsPragma = database.prepare('PRAGMA table_info(order_items)').all();
  }
  if (oiColsPragma.length && !oiColsPragma.some((c) => c.name === 'portion_label')) {
    database.prepare('ALTER TABLE order_items ADD COLUMN portion_label TEXT').run();
    oiColsPragma = database.prepare('PRAGMA table_info(order_items)').all();
  }
  if (oiColsPragma.length && !oiColsPragma.some((c) => c.name === 'category_id_snapshot')) {
    database.prepare('ALTER TABLE order_items ADD COLUMN category_id_snapshot TEXT').run();
    oiColsPragma = database.prepare('PRAGMA table_info(order_items)').all();
  }
  if (oiColsPragma.length && !oiColsPragma.some((c) => c.name === 'category_name_snapshot')) {
    database.prepare('ALTER TABLE order_items ADD COLUMN category_name_snapshot TEXT').run();
    oiColsPragma = database.prepare('PRAGMA table_info(order_items)').all();
  }
  if (oiColsPragma.length && !oiColsPragma.some((c) => c.name === 'printer_target_snapshot')) {
    database.prepare('ALTER TABLE order_items ADD COLUMN printer_target_snapshot TEXT').run();
  }
  database.exec(`CREATE INDEX IF NOT EXISTS idx_order_items_category_snapshot ON order_items(category_id_snapshot)`);

  // Özellik seçimleri snapshot (attributes modülü)
  const oiColsFinal = database.prepare('PRAGMA table_info(order_items)').all();
  if (oiColsFinal.length && !oiColsFinal.some((c) => c.name === 'selected_attributes')) {
    database.prepare("ALTER TABLE order_items ADD COLUMN selected_attributes TEXT DEFAULT '[]'").run();
  }

  const reservationCols = database.prepare('PRAGMA table_info(reservations)').all();
  if (reservationCols.length && !reservationCols.some((c) => c.name === 'arrived_at')) {
    database.prepare('ALTER TABLE reservations ADD COLUMN arrived_at TEXT').run();
  }
  if (reservationCols.length && !reservationCols.some((c) => c.name === 'seated_order_id')) {
    database.prepare('ALTER TABLE reservations ADD COLUMN seated_order_id TEXT REFERENCES orders(id)').run();
  }
  database.exec('CREATE INDEX IF NOT EXISTS idx_reservations_seated_order ON reservations(seated_order_id)');
}

/** Mevcut ürünler için varsayılan Tam porsiyonu (ürün başına bir kez). */
function ensureProductPortionsSeed() {
  try {
    const tbl = db.prepare(`SELECT name FROM sqlite_master WHERE type='table' AND name='product_portions'`).get();
    if (!tbl) return;
    const products = db.prepare('SELECT id, business_id, price FROM products').all();
    const countStmt = db.prepare('SELECT COUNT(*) as c FROM product_portions WHERE product_id = ?');
    const insertStmt = db.prepare(
      `INSERT INTO product_portions (id, business_id, product_id, label, price, sort_order, is_default)
       VALUES (?, ?, ?, ?, ?, 0, 1)`,
    );
    for (const p of products) {
      if (countStmt.get(p.id).c > 0) continue;
      insertStmt.run(genId(), p.business_id, p.id, 'Tam', p.price);
    }
  } catch (e) {
    console.error('ensureProductPortionsSeed:', e);
  }
}

function backfillCustomerPhoneNormalized() {
  try {
    const rows = db.prepare(
      `SELECT id, phone FROM customer_phones WHERE normalized_phone IS NULL OR normalized_phone = ''`,
    ).all();
    const upd = db.prepare('UPDATE customer_phones SET normalized_phone = ? WHERE id = ?');
    for (const r of rows) {
      const n = normalizePhoneDigits(r.phone);
      if (n) upd.run(n, r.id);
    }
    if (rows.length) console.log(`✅ customer_phones normalized_phone backfill: ${rows.length} satır`);
  } catch (e) {
    console.error('backfillCustomerPhoneNormalized:', e);
  }
}

function backfillOrderItemSnapshots() {
  try {
    const cols = db.prepare('PRAGMA table_info(order_items)').all();
    if (!cols.some((c) => c.name === 'category_name_snapshot')) return;

    const info = db.prepare(`
      UPDATE order_items
      SET
        category_id_snapshot = COALESCE(category_id_snapshot, (
          SELECT p.category_id FROM products p WHERE p.id = order_items.product_id
        )),
        category_name_snapshot = COALESCE(category_name_snapshot, (
          SELECT c.name
          FROM products p
          JOIN categories c ON c.id = p.category_id
          WHERE p.id = order_items.product_id
        )),
        printer_target_snapshot = COALESCE(printer_target_snapshot, (
          SELECT COALESCE(p.printer_target, c.printer_target, 'kitchen')
          FROM products p
          LEFT JOIN categories c ON c.id = p.category_id
          WHERE p.id = order_items.product_id
        ))
      WHERE category_id_snapshot IS NULL
         OR category_name_snapshot IS NULL
         OR printer_target_snapshot IS NULL
    `).run();
    if (info.changes) console.log(`✅ order_items snapshot backfill: ${info.changes} satır`);
  } catch (e) {
    console.error('backfillOrderItemSnapshots:', e);
  }
}

function backfillOrderHeaderSnapshots() {
  try {
    const cols = db.prepare('PRAGMA table_info(orders)').all();
    if (!cols.some((c) => c.name === 'table_name_snapshot')) return;

    const info = db.prepare(`
      UPDATE orders
      SET
        table_name_snapshot = COALESCE(table_name_snapshot, (
          SELECT t.name FROM tables t WHERE t.id = orders.table_id
        )),
        customer_name_snapshot = COALESCE(customer_name_snapshot, (
          SELECT c.full_name FROM customers c WHERE c.id = orders.customer_id
        )),
        user_name_snapshot = COALESCE(user_name_snapshot, (
          SELECT u.full_name FROM users u WHERE u.id = orders.user_id
        ))
      WHERE table_name_snapshot IS NULL
         OR customer_name_snapshot IS NULL
         OR user_name_snapshot IS NULL
    `).run();
    if (info.changes) console.log(`✅ orders header snapshot backfill: ${info.changes} satır`);
  } catch (e) {
    console.error('backfillOrderHeaderSnapshots:', e);
  }
}

export function ensureSchemaMigrationsTable(database = db) {
  database.exec(SCHEMA_MIGRATIONS_TABLE_SQL);
}

function hasLegacyBaselineSchema(database = db) {
  const requiredTables = ['businesses', 'orders', 'payments', 'print_jobs'];
  const existingTables = database
    .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name IN (${requiredTables.map(() => '?').join(',')})`)
    .all(...requiredTables)
    .map((row) => row.name);

  return requiredTables.every((table) => existingTables.includes(table));
}

export function applyLegacyMigrations(database = db) {
  const migrate = database.transaction(() => {
    for (const sql of migrations) {
      database.exec(sql);
    }
    ensureColumnMigrations(database);
  });
  migrate();
}

export function applyVersionedMigrations(database = db) {
  ensureSchemaMigrationsTable(database);
  validateVersionedMigrations(versionedMigrations);

  const applied = new Set(
    database
      .prepare('SELECT version FROM schema_migrations')
      .all()
      .map((row) => row.version),
  );

  const orderedMigrations = [...versionedMigrations].sort((a, b) => a.version.localeCompare(b.version));
  for (const migration of orderedMigrations) {
    if (applied.has(migration.version)) continue;
    if (migration.version === BASELINE_SCHEMA_VERSION && !hasLegacyBaselineSchema(database)) {
      throw new Error('Legacy schema baseline cannot be recorded before core schema exists.');
    }

    const migrate = database.transaction(() => {
      migration.up?.(database);
      database
        .prepare('INSERT INTO schema_migrations (version, name) VALUES (?, ?)')
        .run(migration.version, migration.name);
    });
    migrate();
  }
}

export function validateVersionedMigrations(migrationsToValidate = versionedMigrations) {
  const seen = new Set();

  for (const migration of migrationsToValidate) {
    if (!MIGRATION_VERSION_PATTERN.test(migration?.version || '')) {
      throw new Error(`Invalid migration version: ${migration?.version || '<missing>'}`);
    }
    if (seen.has(migration.version)) {
      throw new Error(`Duplicate migration version: ${migration.version}`);
    }
    if (!migration.name || typeof migration.name !== 'string') {
      throw new Error(`Migration ${migration.version} must define a name.`);
    }
    if (typeof migration.up !== 'function') {
      throw new Error(`Migration ${migration.version} must define an up() function.`);
    }
    if ('down' in migration) {
      throw new Error(`Migration ${migration.version} defines down(); migrations are forward-only.`);
    }

    seen.add(migration.version);
  }
}

export function migrateDatabase(database = db) {
  applyLegacyMigrations(database);
  applyVersionedMigrations(database);
}

export function runMigrations() {
  console.log('🔄 Running migrations...');
  migrateDatabase(db);
  migrateVatInclusivePricingOnce();
  ensureProductPortionsSeed();
  backfillCustomerPhoneNormalized();
  backfillOrderItemSnapshots();
  backfillOrderHeaderSnapshots();
  console.log('✅ Migrations complete.');
}

// Run if called directly
const isMain = process.argv[1]?.includes('migrations/run.js') || process.argv[1]?.includes('migrations\\run.js');
if (isMain) {
  runMigrations();
  process.exit(0);
}
