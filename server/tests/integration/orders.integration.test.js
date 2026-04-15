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
  const { default: callerIdRoutes } = await import('../../routes/callerid.js');
  app = express();
  app.use(express.json());
  app.use('/api/orders', ordersRoutes);
  app.use('/api/caller-id', callerIdRoutes);
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
    expect(res.body.table_name_snapshot).toBe('Masa 1');
    expect(res.body.user_name_snapshot).toBe('Test Admin');
    expect(res.body.items[0].category_id_snapshot).toBe(seeds.categoryId);
    expect(res.body.items[0].category_name_snapshot).toBe('Ana Yemek');
    expect(res.body.items[0].printer_target_snapshot).toBe('kitchen');
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

  it('DB tarafında desteklenmeyen delivery order_type değerini API seviyesinde reddeder', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({
        table_id: seeds.tableId,
        order_type: 'delivery',
        items: [{ product_id: seeds.productId, quantity: 1, modifiers: [] }],
      });

    expect(res.status).toBe(400);
  });

  it('items dizisi olmadan 400 döner', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({ table_id: seeds.tableId, order_type: 'dine_in' });

    expect(res.status).toBe(400);
  });

  it('call_log_id ile arama kaydini siparise baglar', async () => {
    const incomingRes = await request(app)
      .post('/api/caller-id/simulate')
      .set('Authorization', authHeader)
      .send({ phone: '05321234567' });

    expect(incomingRes.status).toBe(200);
    expect(incomingRes.body).toHaveProperty('callLogId');

    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({
        table_id: seeds.tableId,
        order_type: 'dine_in',
        call_log_id: incomingRes.body.callLogId,
        items: [{ product_id: seeds.productId, quantity: 1, modifiers: [] }],
      });

    expect(createRes.status).toBe(201);
    expect(createRes.body).toHaveProperty('id');

    const historyRes = await request(app)
      .get('/api/caller-id/history')
      .set('Authorization', authHeader);

    expect(historyRes.status).toBe(200);
    expect(Array.isArray(historyRes.body)).toBe(true);

    const linkedCall = historyRes.body.find((row) => row.id === incomingRes.body.callLogId);
    expect(linkedCall).toBeTruthy();
    expect(linkedCall.status).toBe('opened_order');
    expect(linkedCall.order_id).toBe(createRes.body.id);
    expect(linkedCall.order_no).toBe(createRes.body.order_no);
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

  it('geçersiz status değeri 400 döner', async () => {
    if (!orderId) return;
    const res = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'gecersiz_durum' });

    expect(res.status).toBe(400);
    expect(res.body).toHaveProperty('error');
  });
});

describe('PATCH /api/orders/:orderId/items/:itemId', () => {
  let orderId;
  let itemId;

  beforeAll(async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({
        table_id: seeds.tableId,
        order_type: 'dine_in',
        items: [{ product_id: seeds.productId, quantity: 2, modifiers: [] }],
      });
    orderId = res.body?.id;
    itemId = res.body?.items?.[0]?.id;
  });

  it('geçersiz ürün adedi için 400 döner', async () => {
    if (!orderId || !itemId) return;
    const res = await request(app)
      .patch(`/api/orders/${orderId}/items/${itemId}`)
      .set('Authorization', authHeader)
      .send({ quantity: -1 });

    expect(res.status).toBe(400);
  });

  it('geçersiz ürün status değerini 400 ile reddeder', async () => {
    if (!orderId || !itemId) return;
    const res = await request(app)
      .patch(`/api/orders/${orderId}/items/${itemId}`)
      .set('Authorization', authHeader)
      .send({ status: 'mutfakta_kayboldu' });

    expect(res.status).toBe(400);
  });
});

// ── P2-A: Sipariş notu — order.note ve item.note validasyonu ─────────────────

describe('Sipariş ve kalem notu validasyonu (P2)', () => {
  it('order.note sipariş oluşturulurken kaydedilir ve GET ile döner', async () => {
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({
        table_id: seeds.tableId,
        order_type: 'dine_in',
        note: 'Fıstık alerjisi var',
        items: [{ product_id: seeds.productId, quantity: 1, modifiers: [] }],
      });

    expect(createRes.status).toBe(201);
    const newOrderId = createRes.body.id;

    const getRes = await request(app)
      .get(`/api/orders/${newOrderId}`)
      .set('Authorization', authHeader);

    expect(getRes.status).toBe(200);
    expect(getRes.body.note).toBe('Fıstık alerjisi var');
  });

  it('item.note 500 karakteri aşarsa 400 döner (Zod max validasyonu)', async () => {
    // Önce sipariş oluştur
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({
        table_id: seeds.tableId,
        order_type: 'dine_in',
        items: [{ product_id: seeds.productId, quantity: 1, modifiers: [] }],
      });
    const oid = createRes.body?.id;
    const iid = createRes.body?.items?.[0]?.id;
    if (!oid || !iid) return;

    const longNote = 'x'.repeat(501);
    const res = await request(app)
      .patch(`/api/orders/${oid}/items/${iid}`)
      .set('Authorization', authHeader)
      .send({ note: longNote });

    expect(res.status).toBe(400);
  });

  it('item.note 500 karakter sınırında geçerlidir', async () => {
    const createRes = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({
        table_id: seeds.tableId,
        order_type: 'dine_in',
        items: [{ product_id: seeds.productId, quantity: 1, modifiers: [] }],
      });
    const oid = createRes.body?.id;
    const iid = createRes.body?.items?.[0]?.id;
    if (!oid || !iid) return;

    const exactNote = 'y'.repeat(500);
    const res = await request(app)
      .patch(`/api/orders/${oid}/items/${iid}`)
      .set('Authorization', authHeader)
      .send({ note: exactNote });

    expect(res.status).toBe(200);
    // PATCH order item endpoint tüm order objesini döndürür (items dizisiyle)
    const updatedItem = res.body.items?.find((i) => i.id === iid);
    expect(updatedItem?.note).toBe(exactNote);
  });
});

// ── P2-B: GET /api/orders/active — mutfak ekranı ────────────────────────────

describe('GET /api/orders/active — mutfak ekranı (P2)', () => {
  it('token olmadan 401 döner', async () => {
    const res = await request(app).get('/api/orders/active');
    expect(res.status).toBe(401);
  });

  it('in_kitchen durumdaki siparişleri döner, saved olanları döndürmez', async () => {
    // saved sipariş oluştur
    const savedRes = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({
        table_id: seeds.tableId,
        order_type: 'dine_in',
        items: [{ product_id: seeds.productId, quantity: 1, modifiers: [] }],
      });
    const savedId = savedRes.body?.id;

    // in_kitchen'a çek
    await request(app)
      .patch(`/api/orders/${savedId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'in_kitchen' });

    const res = await request(app)
      .get('/api/orders/active')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);

    const ids = res.body.map((o) => o.id);
    expect(ids).toContain(savedId); // in_kitchen oldu → görünmeli

    // saved durumundaki siparişler görünmemeli
    const statuses = res.body.map((o) => o.status);
    for (const s of statuses) {
      expect(['in_kitchen', 'preparing', 'ready']).toContain(s);
    }
  });

  it('dönen siparişlerin items dizisi dolu gelir', async () => {
    const res = await request(app)
      .get('/api/orders/active')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    // En az bir sipariş olmalı (önceki testten)
    expect(res.body.length).toBeGreaterThan(0);
    const firstOrder = res.body[0];
    expect(Array.isArray(firstOrder.items)).toBe(true);
    expect(firstOrder.items.length).toBeGreaterThan(0);
  });
});

// ── P2-C: CallerID durum geçişleri ──────────────────────────────────────────

describe('PATCH /api/caller-id/logs/:id/status — durum geçişleri (P2)', () => {
  let callLogId;

  beforeAll(async () => {
    // Yeni çağrı kaydı oluştur (ringing)
    const simRes = await request(app)
      .post('/api/caller-id/simulate')
      .set('Authorization', authHeader)
      .send({ phone: '0532 999 00 11' });
    callLogId = simRes.body?.callLogId;
  });

  it('ringing → opened_order geçişi 200 döner', async () => {
    if (!callLogId) return;
    const res = await request(app)
      .patch(`/api/caller-id/logs/${callLogId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'opened_order' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('opened_order');
  });

  it('opened_order → completed geçişi 200 döner', async () => {
    if (!callLogId) return;
    const res = await request(app)
      .patch(`/api/caller-id/logs/${callLogId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'completed' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('completed');
  });

  it('geçersiz status değeri 400 döner', async () => {
    if (!callLogId) return;
    const res = await request(app)
      .patch(`/api/caller-id/logs/${callLogId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'gecersiz_durum' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/geçersiz/i);
  });

  it('var olmayan log id 404 döner', async () => {
    const res = await request(app)
      .patch('/api/caller-id/logs/olmayan-id/status')
      .set('Authorization', authHeader)
      .send({ status: 'completed' });

    expect(res.status).toBe(404);
  });

  it('status alanı olmadan 400 döner', async () => {
    if (!callLogId) return;
    const res = await request(app)
      .patch(`/api/caller-id/logs/${callLogId}/status`)
      .set('Authorization', authHeader)
      .send({});

    expect(res.status).toBe(400);
  });
});

describe('POST /api/orders — takeaway + table_id çakışma guard (G-2)', () => {
  it('takeaway siparişinde table_id gönderilirse 400 döner', async () => {
    const res = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({
        order_type: 'takeaway',
        table_id: seeds.tableId,
        items: [{ product_id: seeds.productId, quantity: 1 }],
      });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/table_id/);
  });
});
