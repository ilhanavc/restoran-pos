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
  app = express();
  app.use(express.json());
  app.use('/api/payments', paymentsRoutes);
});

beforeEach(() => {
  dbRef.current = helpers.createTestDb();
  seeds = helpers.seedBusiness(dbRef.current);
  authHeader = `Bearer ${jwt.sign({ userId: seeds.userId }, TEST_JWT_SECRET)}`;
});

function createOrder({ quantity = 4, total = 320 } = {}) {
  const orderId = 'order-split-1';
  const itemId = 'order-item-lahmacun';
  dbRef.current.prepare(`
    INSERT INTO orders (id, business_id, table_id, user_id, order_type, status, subtotal, grand_total, created_by)
    VALUES (?, ?, ?, ?, 'dine_in', 'served', ?, ?, ?)
  `).run(orderId, seeds.businessId, seeds.tableId, seeds.userId, total, total, seeds.userId);
  dbRef.current.prepare(`
    INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, status, created_by)
    VALUES (?, ?, ?, 'Lahmacun', ?, 80, 'served', ?)
  `).run(itemId, orderId, seeds.productId, quantity, seeds.userId);
  dbRef.current.prepare(`
    UPDATE tables SET status = 'occupied', current_order_id = ?, guest_count = 4 WHERE id = ?
  `).run(orderId, seeds.tableId);
  return { orderId, itemId };
}

describe('split payments', () => {
  it('returns item-level remaining quantities', async () => {
    const { orderId, itemId } = createOrder();

    const res = await request(app)
      .get(`/api/payments/orders/${orderId}/split-state`)
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.totals.order_total).toBe(320);
    expect(res.body.totals.remaining_total).toBe(320);
    expect(res.body.items).toHaveLength(1);
    expect(res.body.items[0]).toMatchObject({
      id: itemId,
      total_quantity: 4,
      paid_quantity: 0,
      remaining_quantity: 4,
      unit_price_snapshot: 80,
    });
  });

  it('records a payer payment for part of an item quantity', async () => {
    const { orderId, itemId } = createOrder();

    const res = await request(app)
      .post('/api/payments/split')
      .set('Authorization', authHeader)
      .send({
        order_id: orderId,
        payment_type: 'cash',
        cash_received: 200,
        payer_no: 1,
        payer_label: 'Kişi 1',
        allocations: [{ order_item_id: itemId, quantity: 2 }],
      });

    expect(res.status).toBe(201);
    expect(res.body.payment.amount).toBe(160);
    expect(res.body.payment.change_amount).toBe(40);
    expect(res.body.order.status).toBe('served');
    expect(res.body.split.items[0].paid_quantity).toBe(2);
    expect(res.body.split.items[0].remaining_quantity).toBe(2);
    expect(res.body.split.totals.paid_total).toBe(160);
    expect(res.body.split.totals.remaining_total).toBe(160);
  });

  it('prevents double payment and keeps the table open when the last remaining quantity is paid', async () => {
    const { orderId, itemId } = createOrder();

    await request(app)
      .post('/api/payments/split')
      .set('Authorization', authHeader)
      .send({
        order_id: orderId,
        payment_type: 'card',
        payer_no: 1,
        payer_label: 'Kişi 1',
        allocations: [{ order_item_id: itemId, quantity: 2 }],
      })
      .expect(201);

    const overpay = await request(app)
      .post('/api/payments/split')
      .set('Authorization', authHeader)
      .send({
        order_id: orderId,
        payment_type: 'card',
        payer_no: 2,
        payer_label: 'Kişi 2',
        allocations: [{ order_item_id: itemId, quantity: 3 }],
      });
    expect(overpay.status).toBe(400);
    expect(overpay.body.error).toContain('kalan adet yetersiz');

    const finalPay = await request(app)
      .post('/api/payments/split')
      .set('Authorization', authHeader)
      .send({
        order_id: orderId,
        payment_type: 'card',
        payer_no: 2,
        payer_label: 'Kişi 2',
        allocations: [{ order_item_id: itemId, quantity: 2 }],
    });

    expect(finalPay.status).toBe(201);
    expect(finalPay.body.order.status).not.toBe('closed');
    expect(finalPay.body.split.totals.remaining_total).toBe(0);

    const table = dbRef.current.prepare('SELECT status, current_order_id, guest_count FROM tables WHERE id = ?').get(seeds.tableId);
    expect(table.status).toBe('occupied');
    expect(table.current_order_id).toBe(orderId);
    expect(table.guest_count).toBe(4);
  });
});

describe('full payments', () => {
  it('rejects payments above the remaining order total', async () => {
    const { orderId } = createOrder({ quantity: 2, total: 160 });

    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', authHeader)
      .send({
        order_id: orderId,
        payment_type: 'card',
        amount: 200,
      });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('kalan bakiyeyi aşıyor');

    const payments = dbRef.current.prepare('SELECT COUNT(*) AS c FROM payments WHERE order_id = ?').get(orderId);
    expect(payments.c).toBe(0);
  });

  it('deduplicates repeated full payment requests with an idempotency key', async () => {
    const { orderId } = createOrder({ quantity: 2, total: 160 });
    const payload = {
      order_id: orderId,
      payment_type: 'cash',
      amount: 160,
      cash_received: 200,
      close_order: true,
    };

    const first = await request(app)
      .post('/api/payments')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', 'pay-order-160')
      .send(payload);

    expect(first.status).toBe(201);
    expect(first.body.payment.amount).toBe(160);
    expect(first.body.order.status).toBe('closed');

    const replay = await request(app)
      .post('/api/payments')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', 'pay-order-160')
      .send(payload);

    expect(replay.status).toBe(200);
    expect(replay.body.idempotent_replay).toBe(true);
    expect(replay.body.payment.id).toBe(first.body.payment.id);

    const payments = dbRef.current.prepare('SELECT COUNT(*) AS c FROM payments WHERE order_id = ?').get(orderId);
    expect(payments.c).toBe(1);
  });

  it('deduplicates repeated split payment requests with an idempotency key', async () => {
    const { orderId, itemId } = createOrder();
    const payload = {
      order_id: orderId,
      payment_type: 'card',
      payer_no: 1,
      allocations: [{ order_item_id: itemId, quantity: 2 }],
    };

    const first = await request(app)
      .post('/api/payments/split')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', 'split-person-1')
      .send(payload);

    expect(first.status).toBe(201);
    expect(first.body.payment.amount).toBe(160);

    const replay = await request(app)
      .post('/api/payments/split')
      .set('Authorization', authHeader)
      .set('Idempotency-Key', 'split-person-1')
      .send(payload);

    expect(replay.status).toBe(200);
    expect(replay.body.idempotent_replay).toBe(true);
    expect(replay.body.payment.id).toBe(first.body.payment.id);
    expect(replay.body.split.totals.paid_total).toBe(160);

    const payments = dbRef.current.prepare('SELECT COUNT(*) AS c FROM payments WHERE order_id = ?').get(orderId);
    const allocations = dbRef.current.prepare('SELECT COUNT(*) AS c FROM payment_allocations WHERE order_id = ?').get(orderId);
    expect(payments.c).toBe(1);
    expect(allocations.c).toBe(1);
  });
});
