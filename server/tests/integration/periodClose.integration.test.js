import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';

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

let app;
let helpers;
let seeds;
let authHeader;

beforeAll(async () => {
  helpers = await import('./helpers.js');
  const { default: periodCloseRoutes } = await import('../../routes/periodClose.js');
  const { default: paymentsRoutes } = await import('../../routes/payments.js');
  const { default: ordersRoutes } = await import('../../routes/orders.js');
  app = express();
  app.use(express.json());
  app.use('/api/period-close', periodCloseRoutes);
  app.use('/api/payments', paymentsRoutes);
  app.use('/api/orders', ordersRoutes);
});

beforeEach(() => {
  dbRef.current = helpers.createTestDb();
  seeds = helpers.seedBusiness(dbRef.current);
  authHeader = `Bearer ${jwt.sign({ userId: seeds.userId }, TEST_JWT_SECRET)}`;
});

function insertOrder({
  id,
  date = '2026-04-17',
  status = 'closed',
  orderType = 'dine_in',
  total = 100,
  discount = 0,
} = {}) {
  const orderId = id || `period-order-${Math.random().toString(16).slice(2)}`;
  const closedAt = status === 'closed' ? `${date} 12:30:00` : null;
  dbRef.current.prepare(`
    INSERT INTO orders (
      id, business_id, table_id, user_id, order_type, status, subtotal,
      discount_amount, grand_total, created_at, updated_at, closed_at, created_by
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    orderId,
    seeds.businessId,
    orderType === 'dine_in' ? seeds.tableId : null,
    seeds.userId,
    orderType,
    status,
    total + discount,
    discount,
    total,
    `${date} 10:00:00`,
    `${date} 12:30:00`,
    closedAt,
    seeds.userId,
  );
  return orderId;
}

function insertPayment({ id, orderId, date = '2026-04-17', type = 'cash', amount = 100 }) {
  dbRef.current.prepare(`
    INSERT INTO payments (id, business_id, order_id, payment_type, amount, cash_received, change_amount, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(id, seeds.businessId, orderId, type, amount, amount, `${date} 12:35:00`, seeds.userId);
}

describe('period close X/Z reports', () => {
  it('returns X report totals without creating a close record', async () => {
    const orderId = insertOrder({ id: 'x-order-1', total: 120, discount: 10 });
    insertPayment({ id: 'x-pay-1', orderId, amount: 120, type: 'cash' });

    const res = await request(app)
      .get('/api/period-close/x-report?date=2026-04-17')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.period_status).toBe('open');
    expect(res.body.summary.total_revenue).toBe(120);
    expect(res.body.summary.total_discounts).toBe(10);
    expect(res.body.payment_breakdown).toEqual([
      expect.objectContaining({ payment_type: 'cash', total: 120, count: 1 }),
    ]);

    const closeCount = dbRef.current.prepare('SELECT COUNT(*) AS c FROM period_closes').get();
    expect(closeCount.c).toBe(0);
  });

  it('rejects Z close while open orders exist and returns the open order list', async () => {
    insertOrder({ id: 'z-open-order', status: 'served', total: 90 });

    const res = await request(app)
      .post('/api/period-close/z-close')
      .set('Authorization', authHeader)
      .send({ date: '2026-04-17' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('Açık adisyonlar');
    expect(res.body.open_orders).toHaveLength(1);
    expect(res.body.open_orders[0].id).toBe('z-open-order');
  });

  it('stores a Z snapshot when there are no open orders', async () => {
    const orderId = insertOrder({ id: 'z-closed-order', total: 150 });
    insertPayment({ id: 'z-pay-card', orderId, amount: 150, type: 'card' });

    const res = await request(app)
      .post('/api/period-close/z-close')
      .set('Authorization', authHeader)
      .send({ date: '2026-04-17', note: 'Gün sonu tamam' });

    expect(res.status).toBe(201);
    expect(res.body.period.status).toBe('closed');
    expect(res.body.report.summary.total_revenue).toBe(150);

    const row = dbRef.current.prepare('SELECT * FROM period_closes WHERE business_id = ? AND period_date = ?')
      .get(seeds.businessId, '2026-04-17');
    expect(row.status).toBe('closed');
    expect(row.note).toBe('Gün sonu tamam');
    expect(JSON.parse(row.z_snapshot_json).summary.total_revenue).toBe(150);
  });

  it('does not close the same date twice', async () => {
    const orderId = insertOrder({ id: 'z-once-order', total: 80 });
    insertPayment({ id: 'z-once-pay', orderId, amount: 80 });

    await request(app)
      .post('/api/period-close/z-close')
      .set('Authorization', authHeader)
      .send({ date: '2026-04-17' })
      .expect(201);

    const res = await request(app)
      .post('/api/period-close/z-close')
      .set('Authorization', authHeader)
      .send({ date: '2026-04-17' });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('zaten kapatılmış');
  });

  it('groups cash, card and mixed payment breakdowns', async () => {
    const cashOrder = insertOrder({ id: 'cash-order', total: 40 });
    const cardOrder = insertOrder({ id: 'card-order', total: 60, orderType: 'takeaway' });
    const mixedOrder = insertOrder({ id: 'mixed-order', total: 100 });
    insertPayment({ id: 'cash-pay', orderId: cashOrder, amount: 40, type: 'cash' });
    insertPayment({ id: 'card-pay', orderId: cardOrder, amount: 60, type: 'card' });
    insertPayment({ id: 'mixed-pay', orderId: mixedOrder, amount: 100, type: 'mixed' });

    const res = await request(app)
      .get('/api/period-close/x-report?date=2026-04-17')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.payment_breakdown).toEqual(expect.arrayContaining([
      expect.objectContaining({ payment_type: 'cash', total: 40 }),
      expect.objectContaining({ payment_type: 'card', total: 60 }),
      expect.objectContaining({ payment_type: 'mixed', total: 100 }),
    ]));
    expect(res.body.summary.dine_in_count).toBe(2);
    expect(res.body.summary.takeaway_count).toBe(1);
  });
});

describe('closed period mutation guards', () => {
  it('rejects payments for a closed period', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const orderId = insertOrder({ id: 'guard-payment-order', date: today, status: 'served', total: 80 });
    dbRef.current.prepare(`
      INSERT INTO period_closes (id, business_id, period_date, opened_at, closed_at, closed_by, status)
      VALUES ('closed-period-today', ?, ?, ?, datetime('now'), ?, 'closed')
    `).run(seeds.businessId, today, `${today} 00:00:00`, seeds.userId);

    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', authHeader)
      .send({ order_id: orderId, payment_type: 'cash', amount: 80 });

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('dönem kapatılmış');
  });

  it('rejects new orders for a closed period', async () => {
    const today = new Date().toISOString().slice(0, 10);
    dbRef.current.prepare(`
      INSERT INTO period_closes (id, business_id, period_date, opened_at, closed_at, closed_by, status)
      VALUES ('closed-period-orders', ?, ?, ?, datetime('now'), ?, 'closed')
    `).run(seeds.businessId, today, `${today} 00:00:00`, seeds.userId);

    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({
        order_type: 'takeaway',
        items: [{ product_id: seeds.productId, quantity: 1 }],
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('dönem kapatılmış');
  });
});
