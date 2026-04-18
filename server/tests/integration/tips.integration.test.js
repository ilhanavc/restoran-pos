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
  const { default: paymentsRoutes } = await import('../../routes/payments.js');
  const { default: reportsRoutes } = await import('../../routes/reports.js');
  const { default: periodCloseRoutes } = await import('../../routes/periodClose.js');
  app = express();
  app.use(express.json());
  app.use('/api/payments', paymentsRoutes);
  app.use('/api/reports', reportsRoutes);
  app.use('/api/period-close', periodCloseRoutes);
});

beforeEach(() => {
  dbRef.current = helpers.createTestDb();
  seeds = helpers.seedBusiness(dbRef.current);
  authHeader = `Bearer ${jwt.sign({ userId: seeds.userId }, TEST_JWT_SECRET)}`;
});

function createOrder({ total = 100 } = {}) {
  const orderId = `tip-order-${Math.random().toString(16).slice(2)}`;
  dbRef.current.prepare(`
    INSERT INTO orders (id, business_id, table_id, user_id, order_type, status, subtotal, grand_total, created_by)
    VALUES (?, ?, ?, ?, 'dine_in', 'served', ?, ?, ?)
  `).run(orderId, seeds.businessId, seeds.tableId, seeds.userId, total, total, seeds.userId);
  dbRef.current.prepare(`
    INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, status, created_by)
    VALUES (?, ?, ?, 'Lahmacun', 1, ?, 'served', ?)
  `).run(`tip-item-${orderId}`, orderId, seeds.productId, total, seeds.userId);
  dbRef.current.prepare(`
    UPDATE tables SET status = 'occupied', current_order_id = ?, guest_count = 2 WHERE id = ?
  `).run(orderId, seeds.tableId);
  return orderId;
}

describe('tip tracking', () => {
  it('records tip separately from the payable order amount', async () => {
    const orderId = createOrder({ total: 100 });

    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', authHeader)
      .send({
        order_id: orderId,
        payment_type: 'cash',
        amount: 100,
        tip_amount: 25,
        cash_received: 150,
        close_order: true,
      });

    expect(res.status).toBe(201);
    expect(res.body.payment.amount).toBe(100);
    expect(res.body.payment.tip_amount).toBe(25);
    expect(res.body.payment.change_amount).toBe(25);
    expect(res.body.order.status).toBe('closed');

    const tip = dbRef.current.prepare('SELECT * FROM tips WHERE payment_id = ?').get(res.body.payment.id);
    expect(tip).toMatchObject({ order_id: orderId, amount: 25 });
  });

  it('includes tip totals in daily and X/Z reports', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const orderId = createOrder({ total: 80 });

    await request(app)
      .post('/api/payments')
      .set('Authorization', authHeader)
      .send({
        order_id: orderId,
        payment_type: 'card',
        amount: 80,
        tip_amount: 12,
        close_order: true,
      })
      .expect(201);

    const daily = await request(app)
      .get(`/api/reports/daily?date=${today}`)
      .set('Authorization', authHeader);
    expect(daily.status).toBe(200);
    expect(daily.body.revenue).toBe(80);
    expect(daily.body.tipTotal).toBe(12);

    const period = await request(app)
      .get(`/api/period-close/x-report?date=${today}`)
      .set('Authorization', authHeader);
    expect(period.status).toBe(200);
    expect(period.body.summary.total_revenue).toBe(80);
    expect(period.body.summary.tip_total).toBe(12);
  });
});
