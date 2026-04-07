import db from '../config/database.js';
import { normalizePhoneDigits } from '../utils/phoneNormalize.js';
import { genId } from '../utils/helpers.js';

const migrations = [
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
    price REAL NOT NULL,
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
    subtotal REAL DEFAULT 0,
    discount_amount REAL DEFAULT 0,
    discount_percent REAL DEFAULT 0,
    service_charge REAL DEFAULT 0,
    vat_total REAL DEFAULT 0,
    grand_total REAL DEFAULT 0,
    note TEXT,
    delivery_address TEXT,
    delivery_note TEXT,
    courier_note TEXT,
    guest_count INTEGER DEFAULT 0,
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
    quantity INTEGER DEFAULT 1,
    unit_price REAL NOT NULL,
    modifiers TEXT DEFAULT '[]',
    note TEXT,
    status TEXT DEFAULT 'new' CHECK(status IN ('new','sent','preparing','ready','served','cancelled','comped')),
    discount_amount REAL DEFAULT 0,
    is_comped INTEGER DEFAULT 0,
    comp_reason TEXT,
    vat_rate REAL DEFAULT 10.0,
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
    amount REAL NOT NULL,
    cash_received REAL DEFAULT 0,
    change_amount REAL DEFAULT 0,
    note TEXT,
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
    printed_at TEXT
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
  `CREATE INDEX IF NOT EXISTS idx_orders_business ON orders(business_id)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_table ON orders(table_id)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_status ON orders(status)`,
  `CREATE INDEX IF NOT EXISTS idx_orders_type ON orders(order_type)`,
  `CREATE INDEX IF NOT EXISTS idx_order_items_order ON order_items(order_id)`,
  `CREATE INDEX IF NOT EXISTS idx_products_business ON products(business_id)`,
  `CREATE INDEX IF NOT EXISTS idx_products_category ON products(category_id)`,
  `CREATE INDEX IF NOT EXISTS idx_product_portions_product ON product_portions(product_id)`,
  `CREATE INDEX IF NOT EXISTS idx_categories_business ON categories(business_id)`,
  `CREATE INDEX IF NOT EXISTS idx_customers_business ON customers(business_id)`,
  `CREATE INDEX IF NOT EXISTS idx_customer_phones_customer ON customer_phones(customer_id)`,
  `CREATE INDEX IF NOT EXISTS idx_customer_phones_phone ON customer_phones(phone)`,
  `CREATE INDEX IF NOT EXISTS idx_payments_order ON payments(order_id)`,
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
function ensurePrinterRoutingUniqueIndex() {
  try {
    const hasIdx = db
      .prepare(`SELECT 1 FROM sqlite_master WHERE type = 'index' AND name = 'idx_printer_routing_business_category'`)
      .get();
    if (hasIdx) return;

    const dupGroups = db
      .prepare(
        `SELECT business_id, category_id FROM printer_routing GROUP BY business_id, category_id HAVING COUNT(*) > 1`,
      )
      .all();
    for (const g of dupGroups) {
      const rows = db
        .prepare(
          `SELECT id FROM printer_routing WHERE business_id = ? AND category_id = ? ORDER BY datetime(created_at), id`,
        )
        .all(g.business_id, g.category_id);
      for (let i = 1; i < rows.length; i++) {
        db.prepare('DELETE FROM printer_routing WHERE id = ?').run(rows[i].id);
      }
    }
    db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_printer_routing_business_category ON printer_routing(business_id, category_id)`,
    );
  } catch (e) {
    console.error('ensurePrinterRoutingUniqueIndex:', e);
  }
}

function ensureColumnMigrations() {
  const diningCols = db.prepare('PRAGMA table_info(dining_areas)').all();
  if (!diningCols.some((c) => c.name === 'target_table_count')) {
    db.prepare('ALTER TABLE dining_areas ADD COLUMN target_table_count INTEGER').run();
  }
  const orderCols = db.prepare('PRAGMA table_info(orders)').all();
  if (!orderCols.some((c) => c.name === 'takeaway_out_at')) {
    db.prepare('ALTER TABLE orders ADD COLUMN takeaway_out_at TEXT').run();
  }
  if (!orderCols.some((c) => c.name === 'takeaway_delivered_at')) {
    db.prepare('ALTER TABLE orders ADD COLUMN takeaway_delivered_at TEXT').run();
  }

  const cpCols = db.prepare('PRAGMA table_info(customer_phones)').all();
  if (cpCols.length && !cpCols.some((c) => c.name === 'normalized_phone')) {
    db.prepare('ALTER TABLE customer_phones ADD COLUMN normalized_phone TEXT').run();
  }

  const printerCols = db.prepare('PRAGMA table_info(printers)').all();
  if (printerCols.length && !printerCols.some((c) => c.name === 'print_options')) {
    db.prepare('ALTER TABLE printers ADD COLUMN print_options TEXT').run();
  }
  if (printerCols.length && !printerCols.some((c) => c.name === 'line_width')) {
    db.prepare('ALTER TABLE printers ADD COLUMN line_width INTEGER').run();
  }

  let pjCols = db.prepare('PRAGMA table_info(print_jobs)').all();
  if (pjCols.length && !pjCols.some((c) => c.name === 'claimed_at')) {
    db.prepare('ALTER TABLE print_jobs ADD COLUMN claimed_at TEXT').run();
  }
  pjCols = db.prepare('PRAGMA table_info(print_jobs)').all();
  if (pjCols.length && !pjCols.some((c) => c.name === 'claimed_by')) {
    db.prepare('ALTER TABLE print_jobs ADD COLUMN claimed_by TEXT').run();
  }

  // order_id NOT NULL → nullable (test job'ları için gerekli; SQLite tablo recreation gerektirir)
  pjCols = db.prepare('PRAGMA table_info(print_jobs)').all();
  const pjOrderIdCol = pjCols.find((c) => c.name === 'order_id');
  if (pjOrderIdCol && pjOrderIdCol.notnull === 1) {
    const colNames = pjCols.map((c) => c.name).join(', ');
    db.exec(`CREATE TABLE print_jobs_new (
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
      claimed_by TEXT
    )`);
    db.exec(`INSERT INTO print_jobs_new (${colNames}) SELECT ${colNames} FROM print_jobs`);
    db.exec(`DROP TABLE print_jobs`);
    db.exec(`ALTER TABLE print_jobs_new RENAME TO print_jobs`);
    db.exec(`CREATE INDEX IF NOT EXISTS idx_print_jobs_business_status_created ON print_jobs(business_id, status, created_at)`);
    console.log('✅ print_jobs.order_id NOT NULL kısıtı kaldırıldı (nullable yapıldı)');
  }

  ensurePrinterRoutingUniqueIndex();

  db.exec(`
    CREATE TABLE IF NOT EXISTS call_logs (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      phone TEXT NOT NULL,
      normalized_phone TEXT NOT NULL,
      customer_id TEXT REFERENCES customers(id),
      customer_name_snapshot TEXT,
      address_snapshot TEXT,
      source_type TEXT DEFAULT 'http',
      status TEXT NOT NULL DEFAULT 'ringing' CHECK(status IN ('ringing','dismissed','opened_order','completed')),
      created_at TEXT DEFAULT (datetime('now'))
    )
  `);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_customer_phones_normalized ON customer_phones(normalized_phone)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_call_logs_business_created ON call_logs(business_id, created_at DESC)`);
  db.exec(`CREATE INDEX IF NOT EXISTS idx_call_logs_normalized ON call_logs(normalized_phone)`);

  let oiColsPragma = db.prepare('PRAGMA table_info(order_items)').all();
  if (oiColsPragma.length && !oiColsPragma.some((c) => c.name === 'portion_id')) {
    db.prepare('ALTER TABLE order_items ADD COLUMN portion_id TEXT').run();
    oiColsPragma = db.prepare('PRAGMA table_info(order_items)').all();
  }
  if (oiColsPragma.length && !oiColsPragma.some((c) => c.name === 'portion_label')) {
    db.prepare('ALTER TABLE order_items ADD COLUMN portion_label TEXT').run();
  }
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

export function runMigrations() {
  console.log('🔄 Running migrations...');
  const migrate = db.transaction(() => {
    for (const sql of migrations) {
      db.exec(sql);
    }
    ensureColumnMigrations();
  });
  migrate();
  migrateVatInclusivePricingOnce();
  ensureProductPortionsSeed();
  backfillCustomerPhoneNormalized();
  console.log('✅ Migrations complete.');
}

// Run if called directly
const isMain = process.argv[1]?.includes('migrations/run.js') || process.argv[1]?.includes('migrations\\run.js');
if (isMain) {
  runMigrations();
  process.exit(0);
}
