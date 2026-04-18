import db from '../config/database.js';
import bcryptjs from 'bcryptjs';
import { v4 as uuid } from 'uuid';
import { runMigrations } from '../migrations/run.js';

try {
  const force = process.argv.includes('--force');
  if (process.env.NODE_ENV === 'production' && !force) {
    throw new Error('Production ortamında destructive seed çalıştırılamaz. Bilinçliyseniz --force parametresi kullanın.');
  }

  runMigrations();
  
  console.log('Seeding database...');

  // Önceleri mevcut verileri temizle
  const tablesToClear = ['call_logs', 'incoming_calls', 'entity_mutations', 'audit_logs', 'settings', 'print_jobs', 'printer_routing', 'printers',
    'payments', 'order_items', 'orders', 'customer_addresses', 'customer_phones', 'customers',
    'product_modifiers', 'product_portions', 'products', 'categories', 'tables', 'dining_areas', 'users', 'roles', 'branches', 'businesses'];
  
  for (const t of tablesToClear) {
    try { db.prepare(`DELETE FROM ${t}`).run(); } catch(e) { /* skip */ }
  }
  console.log('   Eski veriler temizlendi');

  const businessId = uuid();
  const branchId = uuid();

  // Business
  db.prepare(`INSERT INTO businesses (id, name, phone, address, tax_id, tax_office, receipt_header, receipt_footer)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?)`).run(
    businessId, 'Demo Restoran', '0312 555 0001', 'Atatürk Bulvarı No:42, Kızılay/Ankara',
    '1234567890', 'Kızılay VD', 'DEMO RESTORAN', 'Bizi tercih ettiğiniz için teşekkürler!'
  );
  console.log('   Business oluşturuldu');

  // Branch
  db.prepare(`INSERT INTO branches (id, business_id, name, phone, address)
    VALUES (?, ?, ?, ?, ?)`).run(
    branchId, businessId, 'Merkez Şube', '0312 555 0001', 'Atatürk Bulvarı No:42'
  );
  console.log('   Branch oluşturuldu');

  // Roles
  const adminRoleId = uuid();
  const cashierRoleId = uuid();
  const waiterRoleId = uuid();
  const kitchenRoleId = uuid();

  db.prepare(`INSERT INTO roles (id, business_id, name, slug, permissions) VALUES (?, ?, ?, ?, ?)`)
    .run(adminRoleId, businessId, 'Yönetici', 'admin', JSON.stringify({ all: true }));
  db.prepare(`INSERT INTO roles (id, business_id, name, slug, permissions) VALUES (?, ?, ?, ?, ?)`)
    .run(cashierRoleId, businessId, 'Kasiyer', 'cashier', JSON.stringify({ orders: true, payments: true, customers: true, reports_basic: true }));
  db.prepare(`INSERT INTO roles (id, business_id, name, slug, permissions) VALUES (?, ?, ?, ?, ?)`)
    .run(waiterRoleId, businessId, 'Garson', 'waiter', JSON.stringify({ tables: true, orders_create: true, orders_send: true }));
  db.prepare(`INSERT INTO roles (id, business_id, name, slug, permissions) VALUES (?, ?, ?, ?, ?)`)
    .run(kitchenRoleId, businessId, 'Muıtfak', 'kitchen', JSON.stringify({ kitchen_screen: true, order_status: true }));
  console.log('   Roller oluşturuldu');

  // Users
  const hash = bcryptjs.hashSync('123456', 10);
  console.log('   Şifre hash:', hash.substring(0, 20) + '...');

  const roleMap = { admin: adminRoleId, cashier: cashierRoleId, waiter: waiterRoleId, kitchen: kitchenRoleId };
  const users = [
    { email: 'admin@demo.com', name: 'Ali Yılmaz', role: 'admin' },
    { email: 'kasiyer@demo.com', name: 'Ayşe Demir', role: 'cashier' },
    { email: 'smoke.kasiyer@demo.com', name: 'Smoke Kasiyer', role: 'cashier' },
    { email: 'garson@demo.com', name: 'Mehmet Kaya', role: 'waiter' },
    { email: 'mutfak@demo.com', name: 'Fatma Çelik', role: 'kitchen' },
  ];
  
  for (const u of users) {
    const userId = uuid();
    db.prepare(`INSERT INTO users (id, business_id, branch_id, role_id, email, password_hash, full_name)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(userId, businessId, branchId, roleMap[u.role], u.email, hash, u.name);
    console.log('   Kullanıcı oluşturuldu:', u.email);
  }

  // Dining Areas
  const area1 = uuid(), area2 = uuid(), area3 = uuid(), area4 = uuid();
  db.prepare(`INSERT INTO dining_areas (id, business_id, branch_id, name, sort_order) VALUES (?, ?, ?, ?, ?)`).run(area1, businessId, branchId, 'İç Salon', 0);
  db.prepare(`INSERT INTO dining_areas (id, business_id, branch_id, name, sort_order) VALUES (?, ?, ?, ?, ?)`).run(area2, businessId, branchId, 'Bahçe', 1);
  db.prepare(`INSERT INTO dining_areas (id, business_id, branch_id, name, sort_order) VALUES (?, ?, ?, ?, ?)`).run(area3, businessId, branchId, 'VIP', 2);
  db.prepare(`INSERT INTO dining_areas (id, business_id, branch_id, name, sort_order) VALUES (?, ?, ?, ?, ?)`).run(area4, businessId, branchId, 'Üst Kat', 3);
  console.log('   Alanlar oluşturuldu');

  // Tables
  const areaIds = [area1, area2, area3, area4];
  const tableConfigs = [
    { area: 0, prefix: 'M', count: 10, cap: 4 },
    { area: 1, prefix: 'B', count: 6, cap: 6 },
    { area: 2, prefix: 'V', count: 3, cap: 8 },
    { area: 3, prefix: 'U', count: 5, cap: 4 },
  ];
  let tableCount = 0;
  for (const tc of tableConfigs) {
    for (let i = 1; i <= tc.count; i++) {
      db.prepare(`INSERT INTO tables (id, business_id, branch_id, dining_area_id, name, capacity, sort_order)
        VALUES (?, ?, ?, ?, ?, ?, ?)`).run(uuid(), businessId, branchId, areaIds[tc.area], tc.prefix + i, tc.cap, i);
      tableCount++;
    }
  }
  console.log('   ' + tableCount + ' masa oluşturuldu');

  // Deterministic smoke fixture: en az bir aktif kategori + ürün.
  const smokeCategoryId = uuid();
  const smokeProductId = uuid();
  db.prepare(`INSERT INTO categories (id, business_id, name, color, icon, sort_order, printer_target, is_active)
    VALUES (?, ?, ?, ?, ?, ?, ?, 1)`).run(
    smokeCategoryId,
    businessId,
    'Smoke Menü',
    '#16a34a',
    '🍔',
    0,
    'kitchen',
  );
  db.prepare(`INSERT INTO products (id, business_id, category_id, name, description, price, vat_rate, printer_target, sort_order, is_active, is_deleted)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 1, 0)`).run(
    smokeProductId,
    businessId,
    smokeCategoryId,
    'Smoke Köfte',
    'Playwright smoke testi için sabit ürün',
    120,
    10,
    'kitchen',
    0,
  );
  console.log('   Smoke fixture kategori/ürün oluşturuldu');

  // Demo Customers
  const cust1 = uuid(), cust2 = uuid(), cust3 = uuid();
  const smokeCustomer = uuid();
  
  db.prepare(`INSERT INTO customers (id, business_id, full_name, total_orders) VALUES (?, ?, ?, ?)`).run(cust1, businessId, 'Ahmet Yıldız', 12);
  db.prepare(`INSERT INTO customers (id, business_id, full_name, total_orders) VALUES (?, ?, ?, ?)`).run(cust2, businessId, 'Zeynep Kara', 5);
  db.prepare(`INSERT INTO customers (id, business_id, full_name, total_orders) VALUES (?, ?, ?, ?)`).run(cust3, businessId, 'Mustafa Arslan', 8);
  db.prepare(`INSERT INTO customers (id, business_id, full_name, total_orders) VALUES (?, ?, ?, ?)`).run(smokeCustomer, businessId, 'Smoke Müşteri', 0);

  db.prepare(`INSERT INTO customer_phones (id, customer_id, phone, is_primary, normalized_phone) VALUES (?, ?, ?, 1, ?)`).run(uuid(), cust1, '905321234567', '905321234567');
  db.prepare(`INSERT INTO customer_phones (id, customer_id, phone, is_primary, normalized_phone) VALUES (?, ?, ?, 0, ?)`).run(uuid(), cust1, '905551234567', '905551234567');
  db.prepare(`INSERT INTO customer_phones (id, customer_id, phone, is_primary, normalized_phone) VALUES (?, ?, ?, 1, ?)`).run(uuid(), cust2, '905339876543', '905339876543');
  db.prepare(`INSERT INTO customer_phones (id, customer_id, phone, is_primary, normalized_phone) VALUES (?, ?, ?, 1, ?)`).run(uuid(), cust3, '905447654321', '905447654321');
  db.prepare(`INSERT INTO customer_phones (id, customer_id, phone, is_primary, normalized_phone) VALUES (?, ?, ?, 1, ?)`).run(uuid(), smokeCustomer, '905300000001', '905300000001');

  db.prepare(`INSERT INTO customer_addresses (id, customer_id, title, address, is_default) VALUES (?, ?, ?, ?, 1)`).run(uuid(), cust1, 'Ev', 'Kızılay Mah. GMK Blv. No:15/3');
  db.prepare(`INSERT INTO customer_addresses (id, customer_id, title, address, is_default) VALUES (?, ?, ?, ?, 0)`).run(uuid(), cust1, 'İş', 'Söğütözü Cad. No:42 Çankaya');
  db.prepare(`INSERT INTO customer_addresses (id, customer_id, title, address, is_default) VALUES (?, ?, ?, ?, 1)`).run(uuid(), cust2, 'Ev', 'Bahçelievler 7. Cadde No:8/12');
  db.prepare(`INSERT INTO customer_addresses (id, customer_id, title, address, is_default) VALUES (?, ?, ?, ?, 1)`).run(uuid(), cust3, 'Ev', 'Tunalı Hilmi Cad. No:120/5');
  db.prepare(`INSERT INTO customer_addresses (id, customer_id, title, address, is_default) VALUES (?, ?, ?, ?, 1)`).run(uuid(), smokeCustomer, 'Ev', 'Smoke Mah. Test Sok. No:1');
  console.log('   4 demo müşteri oluşturuldu');

  // Mock Printers
  db.prepare(`INSERT INTO printers (id, business_id, branch_id, name, type, connection_type, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(uuid(), businessId, branchId, 'Muıtfak Yazıcısı', 'kitchen', 'network', '192.168.1.100');
  db.prepare(`INSERT INTO printers (id, business_id, branch_id, name, type, connection_type, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(uuid(), businessId, branchId, 'Bar Yazıcısı', 'bar', 'network', '192.168.1.101');
  db.prepare(`INSERT INTO printers (id, business_id, branch_id, name, type, connection_type, ip_address)
    VALUES (?, ?, ?, ?, ?, ?, ?)`).run(uuid(), businessId, branchId, 'Kasa Yazıcısı', 'receipt', 'network', '192.168.1.102');
  console.log('   3 yazıcı oluşturuldu');

  // Doğrulama
  const adminUser = db.prepare(`SELECT id FROM users WHERE email = 'admin@demo.com' AND business_id = ?`).get(businessId);
  if (adminUser) {
    db.prepare(`INSERT INTO settings (id, business_id, key, value, updated_at) VALUES (?, ?, 'app.setup', ?, datetime('now'))`)
      .run(uuid(), businessId, JSON.stringify({ completedAt: new Date().toISOString(), completedBy: adminUser.id }));
  }

  const userCount = db.prepare('SELECT COUNT(*) as c FROM users').get();
  const productCount = db.prepare('SELECT COUNT(*) as c FROM products').get();
  const tableCountCheck = db.prepare('SELECT COUNT(*) as c FROM tables').get();

  console.log('');
  console.log('Seed tamamlandı!');
  console.log('   ' + userCount.c + ' kullanıcı, ' + productCount.c + ' ürün (menüyü Ayarlar > Menüden ekleyin), ' + tableCountCheck.c + ' masa');
  console.log('');
  console.log('Demo Giriş Bilgileri:');
  console.log('   Yönetici: admin@demo.com / 123456');
  console.log('   Kasiyer:  kasiyer@demo.com / 123456');
  console.log('   Smoke Kasiyer: smoke.kasiyer@demo.com / 123456');
  console.log('   Garson:   garson@demo.com / 123456');
  console.log('   Muıtfak:   mutfak@demo.com / 123456');

} catch (err) {
  console.error('SEED HATASI:', err.message);
  console.error(err.stack);
}

process.exit(0);
