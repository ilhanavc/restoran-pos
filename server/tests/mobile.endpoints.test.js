import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { v4 as uuidv4 } from 'uuid';

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
vi.mock('../socket.js', () => ({ emitToRoom: vi.fn() }));

let app;
let helpers;
let seeds;

function mobileToken() {
  return jwt.sign(
    { userId: seeds.userId, role: 'admin', businessId: seeds.businessId },
    TEST_JWT_SECRET,
    { expiresIn: '15m' },
  );
}

function mobileHeaders() {
  return { 'X-Client-Type': 'mobile', Authorization: `Bearer ${mobileToken()}` };
}

beforeAll(async () => {
  helpers = await import('./integration/helpers.js');
  const { default: mobileRoutes } = await import('../routes/mobile.js');
  app = express();
  app.use(express.json());
  app.use('/api/mobile', mobileRoutes);
});

beforeEach(() => {
  dbRef.current = helpers.createTestDb();
  seeds = helpers.seedBusiness(dbRef.current);
});

// ---------------------------------------------------------------------------
describe('GET /api/mobile/tables', () => {
  it('X-Client-Type olmadan 400 döner', async () => {
    const token = jwt.sign({ userId: seeds.userId }, TEST_JWT_SECRET);
    const res = await request(app)
      .get('/api/mobile/tables')
      .set('Authorization', `Bearer ${token}`);
    expect(res.status).toBe(400);
  });

  it('masa listesini döner', async () => {
    const res = await request(app)
      .get('/api/mobile/tables')
      .set(mobileHeaders());
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    const table = res.body[0];
    expect(table).toHaveProperty('id');
    expect(table).toHaveProperty('name');
    expect(table).toHaveProperty('area_name');
    expect(table).toHaveProperty('status');
    expect(table.active_order).toBeNull();
  });

  it('aktif siparişi olan masada active_order dolu gelir', async () => {
    const orderId = uuidv4();
    dbRef.current.prepare(`
      INSERT INTO orders (id, business_id, table_id, order_type, status, subtotal, grand_total, created_by)
      VALUES (?, ?, ?, 'dine_in', 'new', 80, 80, ?)
    `).run(orderId, seeds.businessId, seeds.tableId, seeds.userId);
    dbRef.current.prepare(`
      UPDATE tables SET current_order_id = ?, status = 'occupied' WHERE id = ?
    `).run(orderId, seeds.tableId);

    const res = await request(app)
      .get('/api/mobile/tables')
      .set(mobileHeaders());

    expect(res.status).toBe(200);
    const table = res.body.find((t) => t.id === seeds.tableId);
    expect(table.active_order).not.toBeNull();
    expect(table.active_order.id).toBe(orderId);
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/mobile/tables/:tableId/order', () => {
  it('aktif sipariş yoksa 404 döner', async () => {
    const res = await request(app)
      .get(`/api/mobile/tables/${seeds.tableId}/order`)
      .set(mobileHeaders());
    expect(res.status).toBe(404);
  });

  it('aktif sipariş varsa order + items döner', async () => {
    const orderId = uuidv4();
    const itemId = uuidv4();
    dbRef.current.prepare(`
      INSERT INTO orders (id, business_id, table_id, order_type, status, subtotal, grand_total, created_by)
      VALUES (?, ?, ?, 'dine_in', 'new', 80, 80, ?)
    `).run(orderId, seeds.businessId, seeds.tableId, seeds.userId);
    dbRef.current.prepare(`
      UPDATE tables SET current_order_id = ?, status = 'occupied' WHERE id = ?
    `).run(orderId, seeds.tableId);
    dbRef.current.prepare(`
      INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, status)
      VALUES (?, ?, ?, 'Lahmacun', 1, 80, 'new')
    `).run(itemId, orderId, seeds.productId);

    const res = await request(app)
      .get(`/api/mobile/tables/${seeds.tableId}/order`)
      .set(mobileHeaders());

    expect(res.status).toBe(200);
    expect(res.body.order.id).toBe(orderId);
    expect(res.body.order.items.length).toBe(1);
    expect(res.body.order.items[0].product_name).toBe('Lahmacun');
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/mobile/orders/:orderId/items', () => {
  it('kapalı siparişe kalem eklemeye çalışınca 409 döner', async () => {
    const orderId = uuidv4();
    dbRef.current.prepare(`
      INSERT INTO orders (id, business_id, table_id, order_type, status, subtotal, grand_total, created_by)
      VALUES (?, ?, ?, 'dine_in', 'cancelled', 80, 80, ?)
    `).run(orderId, seeds.businessId, seeds.tableId, seeds.userId);

    const res = await request(app)
      .post(`/api/mobile/orders/${orderId}/items`)
      .set(mobileHeaders())
      .send({ product_id: seeds.productId, quantity: 1 });

    expect(res.status).toBe(409);
  });

  it('olmayan siparişe kalem eklemeye çalışınca 404 döner', async () => {
    const res = await request(app)
      .post(`/api/mobile/orders/${uuidv4()}/items`)
      .set(mobileHeaders())
      .send({ product_id: seeds.productId, quantity: 1 });

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/mobile/categories', () => {
  it('kategori + ürün listesini döner', async () => {
    const res = await request(app)
      .get('/api/mobile/categories')
      .set(mobileHeaders());

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThan(0);
    const cat = res.body[0];
    expect(cat).toHaveProperty('id');
    expect(cat).toHaveProperty('products');
    expect(Array.isArray(cat.products)).toBe(true);
    expect(cat.products[0].name).toBe('Lahmacun');
  });
});

// ---------------------------------------------------------------------------
describe('POST /api/mobile/waiter-call', () => {
  it('geçerli masa_id ile 200 döner', async () => {
    const res = await request(app)
      .post('/api/mobile/waiter-call')
      .set(mobileHeaders())
      .send({ table_id: seeds.tableId });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
  });

  it('olmayan masa_id ile 404 döner', async () => {
    const res = await request(app)
      .post('/api/mobile/waiter-call')
      .set(mobileHeaders())
      .send({ table_id: uuidv4() });

    expect(res.status).toBe(404);
  });
});

// ---------------------------------------------------------------------------
describe('GET /api/mobile/me', () => {
  it('oturum açan kullanıcı bilgisini döner', async () => {
    const res = await request(app)
      .get('/api/mobile/me')
      .set(mobileHeaders());

    expect(res.status).toBe(200);
    expect(res.body.id).toBe(seeds.userId);
    expect(res.body.role).toBe('admin');
    expect(res.body).not.toHaveProperty('password_hash');
  });
});
