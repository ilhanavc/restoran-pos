import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';

const { dbRef, TEST_JWT_SECRET, testConfig, emitToRoomMock } = vi.hoisted(() => {
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
    emitToRoomMock: vi.fn(),
  };
});

vi.mock('../../config/database.js', () => ({
  get default() { return dbRef.current; },
}));
vi.mock('../../config/index.js', () => ({ default: testConfig }));
vi.mock('../../socket.js', () => ({ emitToRoom: emitToRoomMock }));

let app;
let helpers;
let seeds;
let authHeader;

beforeAll(async () => {
  helpers = await import('./helpers.js');
  const { default: ordersRoutes } = await import('../../routes/orders.js');
  app = express();
  app.use(express.json());
  app.use('/api/orders', ordersRoutes);
});

beforeEach(() => {
  dbRef.current = helpers.createTestDb();
  seeds = helpers.seedBusiness(dbRef.current);
  authHeader = `Bearer ${jwt.sign({ userId: seeds.userId }, TEST_JWT_SECRET)}`;
  emitToRoomMock.mockClear();
});

function createTakeawayOrder({ orderId = 'takeaway-order-1', total = 240, paid = 0 } = {}) {
  dbRef.current.prepare(`
    INSERT INTO orders (
      id, business_id, user_id, order_type, status, subtotal, grand_total,
      takeaway_out_at, created_by
    ) VALUES (?, ?, ?, 'takeaway', 'in_kitchen', ?, ?, datetime('now'), ?)
  `).run(orderId, seeds.businessId, seeds.userId, total, total, seeds.userId);

  dbRef.current.prepare(`
    INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, status, created_by)
    VALUES (?, ?, ?, 'Lahmacun', 3, 80, 'sent', ?)
  `).run(`${orderId}-item`, orderId, seeds.productId, seeds.userId);

  if (paid > 0) {
    dbRef.current.prepare(`
      INSERT INTO payments (id, business_id, order_id, payment_type, amount, cash_received, change_amount, note, created_by)
      VALUES (?, ?, ?, 'cash', ?, ?, 0, 'Kısmi ödeme', ?)
    `).run(`${orderId}-partial-payment`, seeds.businessId, orderId, paid, paid, seeds.userId);
  }

  return orderId;
}

describe('takeaway delivery payment behavior', () => {
  it('marks a takeaway order as out for delivery without requiring any payment', async () => {
    const orderId = createTakeawayOrder({ orderId: 'takeaway-order-out-only', total: 240, paid: 0 });

    const res = await request(app)
      .patch(`/api/orders/${orderId}/takeaway/delivery`)
      .set('Authorization', authHeader)
      .send({ action: 'out_for_delivery' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);

    const order = dbRef.current.prepare('SELECT status, takeaway_out_at, takeaway_delivered_at FROM orders WHERE id = ?').get(orderId);
    expect(order.status).toBe('in_kitchen');
    expect(order.takeaway_out_at).toBeTruthy();
    expect(order.takeaway_delivered_at).toBeFalsy();

    const payments = dbRef.current.prepare('SELECT COUNT(*) AS c FROM payments WHERE order_id = ?').get(orderId);
    expect(payments.c).toBe(0);
  });

  it('closes an unpaid takeaway order and records the remaining total as paid on delivery', async () => {
    const orderId = createTakeawayOrder({ total: 240, paid: 0 });

    const res = await request(app)
      .patch(`/api/orders/${orderId}/takeaway/delivery`)
      .set('Authorization', authHeader)
      .send({ action: 'delivered' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.auto_payment_id).toBeTruthy();

    const order = dbRef.current.prepare('SELECT status, closed_at, takeaway_delivered_at FROM orders WHERE id = ?').get(orderId);
    expect(order.status).toBe('closed');
    expect(order.closed_at).toBeTruthy();
    expect(order.takeaway_delivered_at).toBeTruthy();

    const payment = dbRef.current.prepare('SELECT payment_type, source, amount, note FROM payments WHERE order_id = ?').get(orderId);
    expect(payment.payment_type).toBe('other');
    expect(payment.source).toBe('system_takeaway_delivery');
    expect(payment.amount).toBe(240);
    expect(payment.note).toContain('Paket teslim');
  });

  it('records only the unpaid remainder when a takeaway order has a partial payment', async () => {
    const orderId = createTakeawayOrder({ orderId: 'takeaway-order-partial', total: 240, paid: 100 });

    const res = await request(app)
      .patch(`/api/orders/${orderId}/takeaway/delivery`)
      .set('Authorization', authHeader)
      .send({ action: 'delivered' });

    expect(res.status).toBe(200);

    const totalPaid = dbRef.current.prepare('SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE order_id = ?').get(orderId);
    expect(totalPaid.total).toBe(240);

    const autoPayment = dbRef.current.prepare(`
      SELECT amount FROM payments WHERE order_id = ? AND note LIKE 'Paket teslim edildiğinde otomatik%'
    `).get(orderId);
    expect(autoPayment.amount).toBe(140);
  });

  it('does not create an extra payment row when delivery is completed after full payment', async () => {
    const orderId = createTakeawayOrder({ orderId: 'takeaway-order-paid', total: 240, paid: 240 });

    const res = await request(app)
      .patch(`/api/orders/${orderId}/takeaway/delivery`)
      .set('Authorization', authHeader)
      .send({ action: 'delivered' });

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.auto_payment_id).toBeNull();

    const payments = dbRef.current.prepare('SELECT COUNT(*) AS c FROM payments WHERE order_id = ?').get(orderId);
    expect(payments.c).toBe(1);

    const order = dbRef.current.prepare('SELECT status, closed_at, takeaway_delivered_at FROM orders WHERE id = ?').get(orderId);
    expect(order.status).toBe('closed');
    expect(order.closed_at).toBeTruthy();
    expect(order.takeaway_delivered_at).toBeTruthy();
  });
});
