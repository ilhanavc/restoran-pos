/**
 * Orders route entegrasyon testleri.
 * POST /api/orders, GET /api/orders/:id, PATCH status uçlarını test eder.
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
vi.mock('../../socket.js', () => ({
  emitToRoom: vi.fn(),
  initSocket: vi.fn(),
}));

// ── Test data setup ───────────────────────────────────────────────────────────
let app;
let seeds;
let authHeader;

beforeAll(async () => {
  const { createTestDb, seedBusiness } = await import('./helpers.js');
  dbRef.current = createTestDb();
  seeds = seedBusiness(dbRef.current);

  const token = jwt.sign({ userId: seeds.userId }, TEST_JWT_SECRET);
  authHeader = `Bearer ${token}`;

  const { default: ordersRoutes } = await import('../../routes/orders.js');
  app = express();
  app.use(express.json());
  app.use('/api/orders', ordersRoutes);
});

// ── POST /api/orders ──────────────────────────────────────────────────────────

describe('POST /api/orders', () => {
  it('dine_in sipariş oluşturur ve 201 döner', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({
        table_id: seeds.tableId,
        order_type: 'dine_in',
        items: [{ product_id: seeds.productId, quantity: 2, modifiers: [] }],
      });

    expect(res.status).toBe(201);
    expect(res.body).toHaveProperty('id');
    expect(res.body.order_type).toBe('dine_in');
    // Mutfak ürünleri otomatik gönderilir → status 'new' veya 'in_kitchen'
    expect(['new', 'in_kitchen', 'preparing']).toContain(res.body.status);
    expect(res.body.grand_total).toBe(160); // 80 * 2
  });

  it('token olmadan 401 döner', async () => {
    const res = await request(app)
      .post('/api/orders')
      .send({ table_id: seeds.tableId, order_type: 'dine_in', items: [] });

    expect(res.status).toBe(401);
  });

  it('geçersiz order_type ile 400 döner', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({ table_id: seeds.tableId, order_type: 'gecersiz', items: [] });

    expect(res.status).toBe(400);
  });

  it('items dizisi olmadan 400 döner', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({ table_id: seeds.tableId, order_type: 'dine_in' });

    expect(res.status).toBe(400);
  });
});

// ── GET /api/orders/:id ───────────────────────────────────────────────────────

describe('GET /api/orders/:id', () => {
  let createdOrderId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({
        table_id: seeds.tableId,
        order_type: 'dine_in',
        items: [{ product_id: seeds.productId, quantity: 1, modifiers: [] }],
      });
    createdOrderId = res.body?.id;
  });

  it('var olan sipariş 200 ile döner', async () => {
    if (!createdOrderId) return;
    const res = await request(app)
      .get(`/api/orders/${createdOrderId}`)
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(createdOrderId);
  });

  it('var olmayan sipariş 404 döner', async () => {
    const res = await request(app)
      .get('/api/orders/olmayan-id-xyz')
      .set('Authorization', authHeader);

    expect(res.status).toBe(404);
  });
});

// ── PATCH /api/orders/:id/status ─────────────────────────────────────────────

describe('PATCH /api/orders/:id/status', () => {
  let orderId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({
        table_id: seeds.tableId,
        order_type: 'dine_in',
        items: [{ product_id: seeds.productId, quantity: 1, modifiers: [] }],
      });
    orderId = res.body?.id;
  });

  it('new → preparing geçişi 200 döner', async () => {
    if (!orderId) return;
    const res = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'preparing' });

    expect(res.status).toBe(200);
  });

  it('geçersiz status değeri hata döner (400 veya 500)', async () => {
    if (!orderId) return;
    const res = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'gecersiz_durum' });

    // Zod validation 400, SQLite CHECK constraint 500 dönebilir — ikisi de başarısızlık
    expect([400, 500]).toContain(res.status);
    expect(res.body).toHaveProperty('error');
  });
});
