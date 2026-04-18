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
  const { default: refundsRoutes } = await import('../../routes/refunds.js');
  const { default: reportsRoutes } = await import('../../routes/reports.js');
  const { default: periodCloseRoutes } = await import('../../routes/periodClose.js');
  app = express();
  app.use(express.json());
  app.use('/api/refunds', refundsRoutes);
  app.use('/api/reports', reportsRoutes);
  app.use('/api/period-close', periodCloseRoutes);
});

beforeEach(() => {
  dbRef.current = helpers.createTestDb();
  seeds = helpers.seedBusiness(dbRef.current);
  authHeader = `Bearer ${jwt.sign({ userId: seeds.userId }, TEST_JWT_SECRET)}`;
});

function insertPaidOrder({ date = new Date().toISOString().slice(0, 10), amount = 120, paymentType = 'cash' } = {}) {
  const orderId = `refund-order-${Math.random().toString(16).slice(2)}`;
  const paymentId = `refund-payment-${Math.random().toString(16).slice(2)}`;
  dbRef.current.prepare(`
    INSERT INTO orders (
      id, business_id, table_id, user_id, order_type, status, subtotal,
      grand_total, created_at, updated_at, closed_at, created_by
    )
    VALUES (?, ?, ?, ?, 'dine_in', 'closed', ?, ?, ?, ?, ?, ?)
  `).run(
    orderId,
    seeds.businessId,
    seeds.tableId,
    seeds.userId,
    amount,
    amount,
    `${date} 10:00:00`,
    `${date} 11:00:00`,
    `${date} 11:00:00`,
    seeds.userId,
  );
  dbRef.current.prepare(`
    INSERT INTO payments (id, business_id, order_id, payment_type, amount, cash_received, change_amount, created_at, created_by)
    VALUES (?, ?, ?, ?, ?, ?, 0, ?, ?)
  `).run(paymentId, seeds.businessId, orderId, paymentType, amount, amount, `${date} 11:05:00`, seeds.userId);
  return { orderId, paymentId };
}

describe('refund flow', () => {
  it('creates refund records tied to the original order and payment', async () => {
    const { orderId, paymentId } = insertPaidOrder({ amount: 150 });

    const res = await request(app)
      .post(`/api/refunds/orders/${orderId}/full`)
      .set('Authorization', authHeader)
      .send({ reason: 'Müşteri iadesi' });

    expect(res.status).toBe(201);
    expect(res.body.total).toBe(150);
    expect(res.body.refunds).toHaveLength(1);
    expect(res.body.refunds[0]).toMatchObject({
      order_id: orderId,
      payment_id: paymentId,
      amount: 150,
      reason: 'Müşteri iadesi',
      status: 'completed',
    });
  });

  it('prevents refunding more than the remaining payment amount', async () => {
    const { paymentId } = insertPaidOrder({ amount: 100 });

    await request(app)
      .post('/api/refunds')
      .set('Authorization', authHeader)
      .send({ payment_id: paymentId, amount: 60 })
      .expect(201);

    const res = await request(app)
      .post('/api/refunds')
      .set('Authorization', authHeader)
      .send({ payment_id: paymentId, amount: 50 });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('aşıyor');
  });

  it('rejects refunds when the original payment period is closed', async () => {
    const paymentDate = '2026-04-17';
    const { orderId } = insertPaidOrder({ date: paymentDate, amount: 90 });
    dbRef.current.prepare(`
      INSERT INTO period_closes (id, business_id, period_date, opened_at, closed_at, closed_by, status)
      VALUES ('refund-closed-original', ?, ?, ?, datetime('now'), ?, 'closed')
    `).run(seeds.businessId, paymentDate, `${paymentDate} 00:00:00`, seeds.userId);

    const res = await request(app)
      .post(`/api/refunds/orders/${orderId}/full`)
      .set('Authorization', authHeader)
      .send({});

    expect(res.status).toBe(409);
    expect(res.body.error).toContain('dönem kapatılmış');
  });

  it('shows refund totals separately in daily and X/Z reports', async () => {
    const today = new Date().toISOString().slice(0, 10);
    const { orderId } = insertPaidOrder({ date: today, amount: 200, paymentType: 'card' });

    await request(app)
      .post(`/api/refunds/orders/${orderId}/full`)
      .set('Authorization', authHeader)
      .send({ reason: 'Test iade' })
      .expect(201);

    const daily = await request(app)
      .get(`/api/reports/daily?date=${today}`)
      .set('Authorization', authHeader);
    expect(daily.status).toBe(200);
    expect(daily.body.revenue).toBe(200);
    expect(daily.body.refundTotal).toBe(200);
    expect(daily.body.netRevenue).toBe(0);

    const period = await request(app)
      .get(`/api/period-close/x-report?date=${today}`)
      .set('Authorization', authHeader);
    expect(period.status).toBe(200);
    expect(period.body.summary.total_revenue).toBe(200);
    expect(period.body.summary.refund_total).toBe(200);
    expect(period.body.summary.net_revenue).toBe(0);
  });
});
