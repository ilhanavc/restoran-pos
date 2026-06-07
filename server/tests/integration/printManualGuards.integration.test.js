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
  get default() {
    return dbRef.current;
  },
}));
vi.mock('../../config/index.js', () => ({ default: testConfig }));
vi.mock('../../socket.js', () => ({
  emitToRoom: vi.fn(),
  initSocket: vi.fn(),
}));

let app;
let helpers;
let seeds;
let authHeader;

function seedPrinter(db, { id, businessId, type }) {
  db.prepare(`
    INSERT INTO printers (id, business_id, name, type, connection_type, ip_address, port, is_active, print_options)
    VALUES (?, ?, ?, ?, 'network', '127.0.0.1', 9100, 1, ?)
  `).run(
    id,
    businessId,
    `${type}-printer`,
    type,
    JSON.stringify({
      device: { physicalName: `${type}-device`, source: 'manual' },
      autoPrint: {
        onTableOrderCreate: true,
        onTakeawayOrderCreate: true,
        onOrderAdjustment: true,
        onPaymentComplete: true,
        onTableClose: true,
        onTakeawayComplete: true,
      },
    }),
  );
}

beforeAll(async () => {
  helpers = await import('./helpers.js');
  const { default: ordersRoutes } = await import('../../routes/orders.js');
  const { default: paymentsRoutes } = await import('../../routes/payments.js');
  app = express();
  app.use(express.json());
  app.use('/api/orders', ordersRoutes);
  app.use('/api/payments', paymentsRoutes);
});

beforeEach(() => {
  dbRef.current = helpers.createTestDb();
  seeds = helpers.seedBusiness(dbRef.current);
  authHeader = `Bearer ${jwt.sign({ userId: seeds.userId }, TEST_JWT_SECRET)}`;
});

describe('Manual print role guards', () => {
  it('manuel fiş endpointi kitchen yazıcıyı reddeder', async () => {
    seedPrinter(dbRef.current, { id: 'k-pr-1', businessId: seeds.businessId, type: 'kitchen' });
    const created = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({
        table_id: seeds.tableId,
        order_type: 'dine_in',
        items: [{ product_id: seeds.productId, quantity: 1 }],
      });
    expect(created.status).toBe(201);

    const res = await request(app)
      .post(`/api/orders/${created.body.id}/print-receipt`)
      .set('Authorization', authHeader)
      .send({ printer_id: 'k-pr-1' });

    expect(res.status).toBe(400);
    expect(String(res.body.error || '')).toMatch(/müşteri fişi/i);
  });

  it('manuel paket etiketi endpointi receipt yazıcıyı reddeder', async () => {
    seedPrinter(dbRef.current, { id: 'r-pr-1', businessId: seeds.businessId, type: 'receipt' });
    const created = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({
        order_type: 'takeaway',
        items: [{ product_id: seeds.productId, quantity: 1 }],
      });
    expect(created.status).toBe(201);

    const res = await request(app)
      .post(`/api/orders/${created.body.id}/takeaway/print-label`)
      .set('Authorization', authHeader)
      .send({ printer_id: 'r-pr-1' });

    expect(res.status).toBe(400);
    expect(String(res.body.error || '')).toMatch(/mutfak yazıcısı/i);
  });

  it('ödeme endpointi print_printer_id için receipt dışı rolü reddeder', async () => {
    seedPrinter(dbRef.current, { id: 'k-pr-2', businessId: seeds.businessId, type: 'kitchen' });
    const created = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({
        table_id: seeds.tableId,
        order_type: 'dine_in',
        items: [{ product_id: seeds.productId, quantity: 1 }],
      });
    expect(created.status).toBe(201);

    const res = await request(app)
      .post('/api/payments')
      .set('Authorization', authHeader)
      .send({
        order_id: created.body.id,
        payment_type: 'cash',
        amount: 80,
        cash_received: 80,
        print_receipt: true,
        print_printer_id: 'k-pr-2',
      });

    expect(res.status).toBe(400);
    expect(String(res.body.error || '')).toMatch(/müşteri fişi/i);
  });
});
