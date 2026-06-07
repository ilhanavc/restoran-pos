import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import Database from 'better-sqlite3';
import * as snapshotColumns from '../migrations/versions/0003_snapshot_columns.js';

const { dbRef, TEST_JWT_SECRET, testConfig } = vi.hoisted(() => {
  const secret = 'integration-test-secret-32chars!!';
  return {
    dbRef: { current: null },
    TEST_JWT_SECRET: secret,
    testConfig: {
      jwt: { secret, expiresIn: '24h' },
      nodeEnv: 'test',
      storeTimezone: 'Europe/Istanbul',
      port: 3001,
      clientDist: '',
      corsOrigins: [],
    },
  };
});

vi.mock('../config/database.js', () => ({
  get default() { return dbRef.current; },
}));
vi.mock('../config/index.js', () => ({ default: testConfig }));
vi.mock('../socket.js', () => ({
  emitToRoom: vi.fn(),
  initSocket: vi.fn(),
}));

let app;
let seeds;
let authHeader;

beforeAll(async () => {
  const { createTestDb, seedBusiness } = await import('./integration/helpers.js');
  dbRef.current = createTestDb();
  seeds = seedBusiness(dbRef.current);
  authHeader = `Bearer ${jwt.sign({ userId: seeds.userId }, TEST_JWT_SECRET)}`;

  const { default: ordersRoutes } = await import('../routes/orders.js');
  app = express();
  app.use(express.json());
  app.use('/api/orders', ordersRoutes);
});

describe('order snapshot columns', () => {
  it('pricing_policy_version sipariş oluşturulunca ürün menü versiyonundan dolar', async () => {
    dbRef.current.prepare(`
      INSERT INTO settings (id, business_id, key, value)
      VALUES ('service-charge-setting', ?, 'business.service_charge', ?)
    `).run(seeds.businessId, JSON.stringify(0.1));

    const expectedMenuVersion = dbRef.current
      .prepare('SELECT MAX(updated_at) as v FROM products WHERE business_id = ?')
      .get(seeds.businessId).v;

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({
        order_type: 'takeaway',
        items: [{ product_id: seeds.productId, quantity: 1, modifiers: [] }],
      });

    expect(res.status).toBe(201);
    const order = dbRef.current
      .prepare('SELECT pricing_policy_version, service_charge_rate, service_charge_amount, service_charge_cents, grand_total FROM orders WHERE id = ?')
      .get(res.body.id);

    expect(order.pricing_policy_version).toBe(expectedMenuVersion);
    expect(order.service_charge_rate).toBe(0.1);
    expect(order.service_charge_amount).toBe(order.grand_total * 0.1);
    expect(order.service_charge_cents).toBe(800);
  });

  it('vat_rate_snapshot order_item vat_rate değerini kopyalar', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({
        order_type: 'takeaway',
        items: [{ product_id: seeds.productId, quantity: 1, modifiers: [] }],
      });

    expect(res.status).toBe(201);
    const item = dbRef.current
      .prepare('SELECT vat_rate, vat_rate_snapshot FROM order_items WHERE order_id = ? LIMIT 1')
      .get(res.body.id);

    expect(item.vat_rate_snapshot).toBe(item.vat_rate);
  });
});

describe('0003_snapshot_columns migration', () => {
  it('snapshot kolonlarını backfill eder ve tekrar çalıştırılabilir', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE orders (
        id TEXT PRIMARY KEY,
        grand_total REAL DEFAULT 0,
        discount_amount REAL DEFAULT 0
      );
      CREATE TABLE order_items (
        id TEXT PRIMARY KEY,
        vat_rate REAL DEFAULT 10.0
      );

      INSERT INTO orders (id, grand_total, discount_amount) VALUES ('o1', 100, 0);
      INSERT INTO order_items (id, vat_rate) VALUES ('oi1', 8.0);
    `);

    expect(() => snapshotColumns.up(db)).not.toThrow();
    expect(() => snapshotColumns.up(db)).not.toThrow();

    const orderCols = db.prepare('PRAGMA table_info(orders)').all().map((column) => column.name);
    expect(orderCols).toEqual(expect.arrayContaining([
      'pricing_policy_version',
      'service_charge_rate',
      'service_charge_amount',
      'service_charge_cents',
    ]));

    const order = db
      .prepare('SELECT pricing_policy_version, service_charge_rate, service_charge_amount, service_charge_cents FROM orders WHERE id = ?')
      .get('o1');
    expect(order).toEqual({
      pricing_policy_version: null,
      service_charge_rate: 0,
      service_charge_amount: 0,
      service_charge_cents: 0,
    });

    const item = db.prepare('SELECT vat_rate_snapshot FROM order_items WHERE id = ?').get('oi1');
    expect(item.vat_rate_snapshot).toBe(8);

    db.close();
  });
});
