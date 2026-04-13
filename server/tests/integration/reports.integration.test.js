/**
 * Reports route entegrasyon testleri.
 * GET /api/reports/daily, /closed-orders, /closed-orders/export uçlarını test eder.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';

// ── vi.hoisted ────────────────────────────────────────────────────────────────
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

vi.mock('../../config/database.js', () => ({
  get default() { return dbRef.current; },
}));
vi.mock('../../config/index.js', () => ({ default: testConfig }));

// ── Test data setup ───────────────────────────────────────────────────────────
let app;
let authHeader;
let seeds;

beforeAll(async () => {
  const { createTestDb, seedBusiness } = await import('./helpers.js');
  dbRef.current = createTestDb();
  seeds = seedBusiness(dbRef.current);

  const token = jwt.sign({ userId: seeds.userId }, TEST_JWT_SECRET);
  authHeader = `Bearer ${token}`;

  // Demo kapanan sipariş + ödeme (rapor verisi için)
  const db = dbRef.current;
  const today = new Date().toISOString().slice(0, 10);

  db.prepare(
    `INSERT OR IGNORE INTO orders
     (id, business_id, table_id, user_id, order_type, status, grand_total, created_at, updated_at, closed_at)
     VALUES ('rpt-order-1', ?, ?, ?, 'dine_in', 'closed', 250, datetime('now'), datetime('now'), datetime('now'))`,
  ).run(seeds.businessId, seeds.tableId, seeds.userId);

  db.prepare(
    `INSERT OR IGNORE INTO payments (id, order_id, business_id, amount, payment_type, created_at, created_by)
     VALUES ('rpt-pay-1', 'rpt-order-1', ?, 250, 'cash', datetime('now'), ?)`,
  ).run(seeds.businessId, seeds.userId);

  const { default: reportsRoutes } = await import('../../routes/reports.js');
  app = express();
  app.use(express.json());
  app.use('/api/reports', reportsRoutes);
});

// ── GET /api/reports/daily ────────────────────────────────────────────────────

describe('GET /api/reports/daily', () => {
  it('günlük rapor 200 ile döner ve gerekli alanları içerir', async () => {
    const res = await request(app)
      .get('/api/reports/daily')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('revenue');
    expect(res.body).toHaveProperty('orderStats');
    expect(res.body).toHaveProperty('paymentBreakdown');
    expect(res.body).toHaveProperty('topProducts');
    expect(res.body).toHaveProperty('avgOrderValue');
    expect(typeof res.body.revenue).toBe('number');
    expect(res.body.orderStats.total_orders).toBe(1);
    expect(res.body.revenue).toBe(250);
    expect(res.body.avgOrderValue).toBe(250);
  });

  it('?date parametresiyle belirli gün raporu döner', async () => {
    const res = await request(app)
      .get('/api/reports/daily?date=2020-01-01')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.date).toBe('2020-01-01');
    expect(res.body.revenue).toBe(0);
  });

  it('token olmadan 401 döner', async () => {
    const res = await request(app).get('/api/reports/daily');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/reports/closed-orders ───────────────────────────────────────────

describe('GET /api/reports/closed-orders', () => {
  it('bugünkü kapanan siparişler 200 döner', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await request(app)
      .get(`/api/reports/closed-orders?date=${today}`)
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.orders)).toBe(true);
    expect(res.body).toHaveProperty('total');
    expect(res.body).toHaveProperty('has_more');
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it('veri olmayan tarih aralığı boş liste döner', async () => {
    const res = await request(app)
      .get('/api/reports/closed-orders?from=2000-01-01&to=2000-12-31')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(0);
    expect(res.body.total).toBe(0);
  });

  it('min_amount filtresi çalışır', async () => {
    const res = await request(app)
      .get('/api/reports/closed-orders?min_amount=999999')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.orders).toHaveLength(0);
  });

  it('sayfalama parametreleri yanıtta yansır', async () => {
    const res = await request(app)
      .get('/api/reports/closed-orders?page=1&limit=10')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.page).toBe(1);
    expect(res.body.limit).toBe(10);
  });
});

// ── GET /api/reports/closed-orders/export ────────────────────────────────────

describe('GET /api/reports/closed-orders/export', () => {
  it('tüm siparişleri sayfalama olmadan döner', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const res = await request(app)
      .get(`/api/reports/closed-orders/export?date=${today}`)
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.orders)).toBe(true);
    expect(res.body).toHaveProperty('total');
    expect(res.body).not.toHaveProperty('has_more');
    expect(res.body).not.toHaveProperty('page');
    expect(res.body.total).toBeGreaterThanOrEqual(1);
  });

  it('token olmadan 401 döner', async () => {
    const res = await request(app).get('/api/reports/closed-orders/export');
    expect(res.status).toBe(401);
  });
});

// ── GET /api/reports/hourly ───────────────────────────────────────────────────

describe('GET /api/reports/hourly', () => {
  it('saatlik veri 200 döner ve 24 slot içerir', async () => {
    const res = await request(app)
      .get('/api/reports/hourly')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('data');
    expect(res.body.data).toHaveLength(24);
  });
});
