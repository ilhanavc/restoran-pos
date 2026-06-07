/**
 * Tables route entegrasyon testleri.
 *
 * Kapsam:
 *   GET  /api/tables           — alan + masa listesi, order context
 *   PATCH /api/tables/:id/status — durum kısıtlamaları
 *   POST  /api/tables/:id/transfer — masa transferi
 */
import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
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

let app;
let helpers;
let seeds;
let authHeader;

beforeAll(async () => {
  helpers = await import('./helpers.js');
  const { default: tablesRoutes } = await import('../../routes/tables.js');
  app = express();
  app.use(express.json());
  app.use('/api/tables', tablesRoutes);
});

beforeEach(() => {
  dbRef.current = helpers.createTestDb();
  seeds = helpers.seedBusiness(dbRef.current);
  authHeader = `Bearer ${jwt.sign({ userId: seeds.userId }, TEST_JWT_SECRET)}`;
});

// ── Helper: sipariş oluştur (API'ye gerek duymadan direkt DB) ─────────────────
function insertOrder(db, { tableId, businessId, userId, productId, status = 'saved', total = 80 } = {}) {
  const orderId = `order-${Math.random().toString(36).slice(2)}`;
  const itemId  = `item-${Math.random().toString(36).slice(2)}`;
  db.prepare(`
    INSERT INTO orders (id, business_id, table_id, user_id, order_type, status, subtotal, grand_total, created_by)
    VALUES (?, ?, ?, ?, 'dine_in', ?, ?, ?, ?)
  `).run(orderId, businessId, tableId, userId, status, total, total, userId);
  db.prepare(`
    INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, status, created_by)
    VALUES (?, ?, ?, 'Lahmacun', 1, ?, 'new', ?)
  `).run(itemId, orderId, productId, total, userId);
  return { orderId, itemId };
}

// ── GET /api/tables ───────────────────────────────────────────────────────────
describe('GET /api/tables', () => {
  it('alanları ve masaları döner', async () => {
    const res = await request(app)
      .get('/api/tables')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBeGreaterThanOrEqual(1);

    const area = res.body[0];
    expect(area).toHaveProperty('id');
    expect(Array.isArray(area.tables)).toBe(true);
    expect(area.tables.length).toBeGreaterThanOrEqual(1);
  });

  it('masada aktif sipariş yoksa order_total 0 döner', async () => {
    const res = await request(app)
      .get('/api/tables')
      .set('Authorization', authHeader);

    const table = res.body.flatMap(a => a.tables).find(t => t.id === seeds.tableId);
    expect(table).toBeTruthy();
    expect(table.order_total).toBe(0);
    expect(table.order_started_at).toBeNull();
  });

  it('masada aktif sipariş varsa order_total, order_started_at ve order_line_count dolu döner', async () => {
    const { orderId } = insertOrder(dbRef.current, {
      tableId: seeds.tableId,
      businessId: seeds.businessId,
      userId: seeds.userId,
      productId: seeds.productId,
      total: 80,
    });
    dbRef.current.prepare(
      `UPDATE tables SET status = 'occupied', current_order_id = ? WHERE id = ?`
    ).run(orderId, seeds.tableId);

    const res = await request(app)
      .get('/api/tables')
      .set('Authorization', authHeader);

    const table = res.body.flatMap(a => a.tables).find(t => t.id === seeds.tableId);
    expect(table.order_total).toBe(80);
    expect(table.order_line_count).toBe(1);
    expect(table.order_started_at).toBeTruthy();
  });

  it('token olmadan 401 döner', async () => {
    const res = await request(app).get('/api/tables');
    expect(res.status).toBe(401);
  });
});

// ── PATCH /api/tables/:id/status ─────────────────────────────────────────────
describe('PATCH /api/tables/:id/status', () => {
  it('guest_count güncellemesi 200 döner', async () => {
    const res = await request(app)
      .patch(`/api/tables/${seeds.tableId}/status`)
      .set('Authorization', authHeader)
      .send({ guest_count: 4 });

    expect(res.status).toBe(200);
    expect(res.body.guest_count).toBe(4);
  });

  it('not güncellemesi 200 döner', async () => {
    const res = await request(app)
      .patch(`/api/tables/${seeds.tableId}/status`)
      .set('Authorization', authHeader)
      .send({ note: 'Pencere kenarı' });

    expect(res.status).toBe(200);
    expect(res.body.note).toBe('Pencere kenarı');
  });

  it('aktif sipariş olmadan occupied yapılamaz → 400', async () => {
    const res = await request(app)
      .patch(`/api/tables/${seeds.tableId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'occupied' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/aktif sipariş/i);
  });

  it('aktif siparişi olan masa empty yapılamaz → 400', async () => {
    const { orderId } = insertOrder(dbRef.current, {
      tableId: seeds.tableId,
      businessId: seeds.businessId,
      userId: seeds.userId,
      productId: seeds.productId,
    });
    dbRef.current.prepare(
      `UPDATE tables SET status = 'occupied', current_order_id = ? WHERE id = ?`
    ).run(orderId, seeds.tableId);

    const res = await request(app)
      .patch(`/api/tables/${seeds.tableId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'empty' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/aktif sipari/i);
  });

  it('aktif siparişi olan masa reserved yapılamaz → 400', async () => {
    const { orderId } = insertOrder(dbRef.current, {
      tableId: seeds.tableId,
      businessId: seeds.businessId,
      userId: seeds.userId,
      productId: seeds.productId,
    });
    dbRef.current.prepare(
      `UPDATE tables SET status = 'occupied', current_order_id = ? WHERE id = ?`
    ).run(orderId, seeds.tableId);

    const res = await request(app)
      .patch(`/api/tables/${seeds.tableId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'reserved' });

    expect(res.status).toBe(400);
  });

  it('var olmayan masa 404 döner', async () => {
    const res = await request(app)
      .patch('/api/tables/olmayan-id/status')
      .set('Authorization', authHeader)
      .send({ guest_count: 2 });

    expect(res.status).toBe(404);
  });

  it('body olmadan 400 döner (en az bir alan gerekli)', async () => {
    const res = await request(app)
      .patch(`/api/tables/${seeds.tableId}/status`)
      .set('Authorization', authHeader)
      .send({});

    expect(res.status).toBe(400);
  });
});

// ── POST /api/tables/:id/transfer ────────────────────────────────────────────
describe('POST /api/tables/:id/transfer', () => {
  let table2Id;

  beforeEach(() => {
    // İkinci bir masa ekle
    table2Id = `table2-${Math.random().toString(36).slice(2)}`;
    dbRef.current.prepare(`
      INSERT INTO tables (id, business_id, dining_area_id, name, capacity, status, is_active, sort_order)
      VALUES (?, ?, ?, 'Masa 2', 4, 'empty', 1, 2)
    `).run(table2Id, seeds.businessId, seeds.areaId);
  });

  it('sipariş dolu masadan boş masaya taşınır — kaynak boşalır, hedef dolulur', async () => {
    const { orderId } = insertOrder(dbRef.current, {
      tableId: seeds.tableId,
      businessId: seeds.businessId,
      userId: seeds.userId,
      productId: seeds.productId,
      total: 160,
    });
    dbRef.current.prepare(
      `UPDATE tables SET status = 'occupied', current_order_id = ?, guest_count = 3 WHERE id = ?`
    ).run(orderId, seeds.tableId);

    const res = await request(app)
      .post(`/api/tables/${seeds.tableId}/transfer`)
      .set('Authorization', authHeader)
      .send({ targetTableId: table2Id });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const source = dbRef.current.prepare('SELECT * FROM tables WHERE id = ?').get(seeds.tableId);
    const target = dbRef.current.prepare('SELECT * FROM tables WHERE id = ?').get(table2Id);

    expect(source.status).toBe('empty');
    expect(source.current_order_id).toBeNull();
    expect(target.status).toBe('occupied');
    expect(target.current_order_id).toBe(orderId);
    expect(target.guest_count).toBe(3);

    // Siparişin table_id'si güncellendi mi?
    const order = dbRef.current.prepare('SELECT table_id FROM orders WHERE id = ?').get(orderId);
    expect(order.table_id).toBe(table2Id);
  });

  it('hedef masa boş değilse transfer reddedilir → 400', async () => {
    const { orderId: o1 } = insertOrder(dbRef.current, {
      tableId: seeds.tableId,
      businessId: seeds.businessId,
      userId: seeds.userId,
      productId: seeds.productId,
    });
    dbRef.current.prepare(`UPDATE tables SET status = 'occupied', current_order_id = ? WHERE id = ?`)
      .run(o1, seeds.tableId);

    const { orderId: o2 } = insertOrder(dbRef.current, {
      tableId: table2Id,
      businessId: seeds.businessId,
      userId: seeds.userId,
      productId: seeds.productId,
    });
    dbRef.current.prepare(`UPDATE tables SET status = 'occupied', current_order_id = ? WHERE id = ?`)
      .run(o2, table2Id);

    const res = await request(app)
      .post(`/api/tables/${seeds.tableId}/transfer`)
      .set('Authorization', authHeader)
      .send({ targetTableId: table2Id });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/boş olmalı/i);
  });

  it('kaynak ve hedef aynı masa ise reddedilir → 400', async () => {
    const res = await request(app)
      .post(`/api/tables/${seeds.tableId}/transfer`)
      .set('Authorization', authHeader)
      .send({ targetTableId: seeds.tableId });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/aynı/i);
  });

  it('targetTableId olmadan 400 döner', async () => {
    const res = await request(app)
      .post(`/api/tables/${seeds.tableId}/transfer`)
      .set('Authorization', authHeader)
      .send({});

    expect(res.status).toBe(400);
  });

  it('var olmayan kaynak masa 404 döner', async () => {
    const res = await request(app)
      .post('/api/tables/olmayan-masa/transfer')
      .set('Authorization', authHeader)
      .send({ targetTableId: table2Id });

    expect(res.status).toBe(404);
  });
});

// ── P2: Masa durum geçişi — empty → reserved ─────────────────────────────────

describe('PATCH /api/tables/:id/status — rezervasyon geçişi (P2)', () => {
  it('aktif siparişi olmayan empty masa, reserved durumuna geçirilebilir', async () => {
    // Masa başlangıçta 'empty' ve current_order_id = NULL (beforeEach sıfırlar)
    const before = dbRef.current
      .prepare('SELECT status, current_order_id FROM tables WHERE id = ?')
      .get(seeds.tableId);
    expect(before.status).toBe('empty');
    expect(before.current_order_id).toBeNull();

    const res = await request(app)
      .patch(`/api/tables/${seeds.tableId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'reserved' });

    expect(res.status).toBe(200);

    const after = dbRef.current
      .prepare('SELECT status FROM tables WHERE id = ?')
      .get(seeds.tableId);
    expect(after.status).toBe('reserved');
  });

  it('reserved → empty geçişi de başarılı olur', async () => {
    dbRef.current
      .prepare("UPDATE tables SET status = 'reserved' WHERE id = ?")
      .run(seeds.tableId);

    const res = await request(app)
      .patch(`/api/tables/${seeds.tableId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'empty' });

    expect(res.status).toBe(200);
    const after = dbRef.current
      .prepare('SELECT status FROM tables WHERE id = ?')
      .get(seeds.tableId);
    expect(after.status).toBe('empty');
  });

  it('aktif siparişi olan masayı reserved yapmaya çalışmak 400 döner', async () => {
    const { orderId } = insertOrder(dbRef.current, {
      tableId: seeds.tableId,
      businessId: seeds.businessId,
      userId: seeds.userId,
      productId: seeds.productId,
    });
    dbRef.current
      .prepare("UPDATE tables SET status = 'occupied', current_order_id = ? WHERE id = ?")
      .run(orderId, seeds.tableId);

    const res = await request(app)
      .patch(`/api/tables/${seeds.tableId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'reserved' });

    expect(res.status).toBe(400);
  });
});
