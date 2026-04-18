/**
 * Entegrasyon test yardımcıları.
 *
 * createTestApp(seedFn?) — in-memory SQLite + Express app döner.
 * seedBusiness()         — standart demo işletme + kullanıcı verisi döner.
 *
 * Kullanım:
 *   vi.mock('../../config/database.js', () => ({ default: testDb }));
 *   vi.mock('../../config/index.js', () => ({ default: testConfig }));
 *   // Ardından routes/app import et.
 */
import Database from 'better-sqlite3';
import { migrateDatabase } from '../../migrations/run.js';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

export const TEST_JWT_SECRET = 'integration-test-secret-key-32chars!';

export const testConfig = {
  jwt: { secret: TEST_JWT_SECRET, expiresIn: '24h' },
  nodeEnv: 'test',
  storeTimezone: 'Europe/Istanbul',
  port: 3001,
  clientDist: '',
  corsOrigins: [],
};

/**
 * In-memory SQLite veritabanı oluşturur, migrationları uygular
 * ve ensureColumnMigrations'ın eklediği ekstra kolonları da ekler.
 */
export function createTestDb() {
  const db = new Database(':memory:');
  migrateDatabase(db);
  return db;
}

/**
 * Standart test verisi: business, dining_area, table, role (admin), user.
 * @param {import('better-sqlite3').Database} db
 */
export function seedBusiness(db) {
  const businessId = uuidv4();
  const areaId = uuidv4();
  const tableId = uuidv4();
  const roleId = uuidv4();
  const userId = uuidv4();
  const categoryId = uuidv4();
  const productId = uuidv4();

  db.prepare(`INSERT INTO businesses (id, name, is_active) VALUES (?, 'Test Restoran', 1)`).run(businessId);
  db.prepare(`INSERT INTO dining_areas (id, business_id, name, is_active, sort_order) VALUES (?, ?, 'İç Salon', 1, 1)`).run(areaId, businessId);
  db.prepare(`INSERT INTO tables (id, business_id, dining_area_id, name, capacity, status, is_active, sort_order)
              VALUES (?, ?, ?, 'Masa 1', 4, 'empty', 1, 1)`).run(tableId, businessId, areaId);
  db.prepare(`INSERT INTO roles (id, business_id, name, slug, permissions) VALUES (?, ?, 'Admin', 'admin', '{"all":true}')`).run(roleId, businessId);

  const passwordHash = bcrypt.hashSync('test123', 8);
  db.prepare(`INSERT INTO users (id, business_id, full_name, email, password_hash, role_id, is_active)
              VALUES (?, ?, 'Test Admin', 'admin@test.com', ?, ?, 1)`).run(userId, businessId, passwordHash, roleId);

  db.prepare(`INSERT INTO categories (id, business_id, name, is_active, sort_order) VALUES (?, ?, 'Ana Yemek', 1, 1)`).run(categoryId, businessId);
  db.prepare(`INSERT INTO products (id, business_id, category_id, name, price, is_active, sort_order)
              VALUES (?, ?, ?, 'Lahmacun', 80.00, 1, 1)`).run(productId, businessId, categoryId);

  return { businessId, areaId, tableId, roleId, userId, categoryId, productId };
}

/**
 * JWT token üretir.
 * Kullanım: import jwt from 'jsonwebtoken';
 *           const token = jwt.sign({ userId }, TEST_JWT_SECRET);
 * Bu util, test dosyalarındaki tekrarlı import satırlarını azaltmak için tanımlanmıştır.
 * (jwt'nin sync sign API'ı: jwt.sign(payload, secret) )
 */
