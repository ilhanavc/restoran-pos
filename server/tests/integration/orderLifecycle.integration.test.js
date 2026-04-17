/**
 * Sipariş yaşam döngüsü entegrasyon testleri.
 *
 * Kapsam:
 *   POST /api/orders/:id/items   — mevcut siparişe ürün ekleme
 *   PATCH /api/orders/:id/status cancelled — iptal + masa boşaltma, ödeme engeli
 *   PATCH /api/orders/:id/status closed   — ödeme tamamlandığında kapanma + masa boşaltma
 *   PATCH /api/orders/:orderId/items/:itemId — item status geçişleri, otomatik iptal
 *   GET /api/orders              — filtreleme (status, order_type)
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
  const { default: ordersRoutes }   = await import('../../routes/orders.js');
  const { default: paymentsRoutes } = await import('../../routes/payments.js');
  app = express();
  app.use(express.json());
  app.use('/api/orders',   ordersRoutes);
  app.use('/api/payments', paymentsRoutes);
});

beforeEach(() => {
  dbRef.current = helpers.createTestDb();
  seeds = helpers.seedBusiness(dbRef.current);
  authHeader = `Bearer ${jwt.sign({ userId: seeds.userId }, TEST_JWT_SECRET)}`;
});

// ── Yardımcı: API üzerinden sipariş oluştur ────────────────────────────────
async function createOrder(overrides = {}) {
  const res = await request(app)
    .post('/api/orders')
    .set('Authorization', authHeader)
    .send({
      table_id: seeds.tableId,
      order_type: 'dine_in',
      items: [{ product_id: seeds.productId, quantity: 1 }],
      ...overrides,
    });
  return res;
}

// ── POST /api/orders/:id/items ────────────────────────────────────────────────
describe('POST /api/orders/:id/items — mevcut siparişe ürün ekleme', () => {
  it('var olan siparişe ürün ekler, grand_total güncellenir', async () => {
    const created = await createOrder();
    expect(created.status).toBe(201);
    const orderId = created.body.id;
    const initialTotal = created.body.grand_total; // 80

    const res = await request(app)
      .post(`/api/orders/${orderId}/items`)
      .set('Authorization', authHeader)
      .send({ items: [{ product_id: seeds.productId, quantity: 2 }] });

    expect(res.status).toBe(200);
    expect(res.body.grand_total).toBe(initialTotal + 160); // 80 + 2*80
    expect(res.body.items.filter(i => i.status !== 'cancelled').length).toBeGreaterThanOrEqual(2);
  });

  it('var olmayan siparişe ürün ekleme 404 döner', async () => {
    const res = await request(app)
      .post('/api/orders/olmayan-id/items')
      .set('Authorization', authHeader)
      .send({ items: [{ product_id: seeds.productId, quantity: 1 }] });

    expect(res.status).toBe(404);
  });

  it('var olmayan ürün id ile 400 döner', async () => {
    const created = await createOrder();
    const res = await request(app)
      .post(`/api/orders/${created.body.id}/items`)
      .set('Authorization', authHeader)
      .send({ items: [{ product_id: 'olmayan-urun-id', quantity: 1 }] });

    expect(res.status).toBe(400);
  });

  it('kapalı siparişe ürün eklenemez → 400', async () => {
    const created = await createOrder();
    const orderId = created.body.id;

    // Siparişi DB üzerinde direkt kapalı yap
    dbRef.current.prepare(`UPDATE orders SET status = 'closed', closed_at = datetime('now') WHERE id = ?`).run(orderId);

    const res = await request(app)
      .post(`/api/orders/${orderId}/items`)
      .set('Authorization', authHeader)
      .send({ items: [{ product_id: seeds.productId, quantity: 1 }] });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/kapalı/i);
  });

  it('items dizisi olmadan 400 döner', async () => {
    const created = await createOrder();
    const res = await request(app)
      .post(`/api/orders/${created.body.id}/items`)
      .set('Authorization', authHeader)
      .send({ items: [] });

    expect(res.status).toBe(400);
  });
});

// ── PATCH /api/orders/:id/status (cancelled) ─────────────────────────────────
describe('PATCH /api/orders/:id/status — sipariş iptali', () => {
  it('ödeme olmayan sipariş iptal edilir, masa boşalır', async () => {
    const created = await createOrder();
    const orderId = created.body.id;

    const res = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'cancelled' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('cancelled');

    const table = dbRef.current.prepare('SELECT * FROM tables WHERE id = ?').get(seeds.tableId);
    expect(table.status).toBe('empty');
    expect(table.current_order_id).toBeNull();

    // Tüm kalemler de iptal edilmeli
    const items = dbRef.current.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
    items.forEach(item => expect(item.status).toBe('cancelled'));
  });

  it('ödeme kaydı olan sipariş iptal edilemez → 400', async () => {
    const created = await createOrder();
    const orderId = created.body.id;

    // Kısmi ödeme ekle
    dbRef.current.prepare(`
      INSERT INTO payments (id, business_id, order_id, payment_type, amount, created_by)
      VALUES ('pay-test-1', ?, ?, 'cash', 40, ?)
    `).run(seeds.businessId, orderId, seeds.userId);

    const res = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'cancelled' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ödeme/i);
  });

  it('zaten iptal edilmiş sipariş tekrar iptal edilemez → 400', async () => {
    const created = await createOrder();
    const orderId = created.body.id;

    await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'cancelled' });

    const res = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'cancelled' });

    expect(res.status).toBe(400);
  });
});

// ── PATCH /api/orders/:id/status (closed) ─────────────────────────────────────
describe('PATCH /api/orders/:id/status — sipariş kapanması', () => {
  it('tam ödenmiş sipariş kapatılır, masa boşalır', async () => {
    const created = await createOrder();
    const orderId = created.body.id;
    const total = created.body.grand_total; // 80

    // Tam ödeme ekle
    dbRef.current.prepare(`
      INSERT INTO payments (id, business_id, order_id, payment_type, amount, created_by)
      VALUES ('pay-close-1', ?, ?, 'cash', ?, ?)
    `).run(seeds.businessId, orderId, total, seeds.userId);

    const res = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'closed' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('closed');

    const table = dbRef.current.prepare('SELECT * FROM tables WHERE id = ?').get(seeds.tableId);
    expect(table.status).toBe('empty');
    expect(table.current_order_id).toBeNull();
  });

  it('kısmen ödenmiş sipariş kapatılamaz → 400', async () => {
    const created = await createOrder();
    const orderId = created.body.id;
    const total = created.body.grand_total; // 80

    // Eksik ödeme
    dbRef.current.prepare(`
      INSERT INTO payments (id, business_id, order_id, payment_type, amount, created_by)
      VALUES ('pay-partial-1', ?, ?, 'cash', ?, ?)
    `).run(seeds.businessId, orderId, total - 10, seeds.userId);

    const res = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'closed' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/ödeme/i);
  });

  it('zaten kapalı sipariş tekrar kapatılamaz → 400 ve side-effect tekrarlanmaz', async () => {
    const created = await createOrder();
    const orderId = created.body.id;
    const total = created.body.grand_total;

    dbRef.current.prepare(`
      INSERT INTO customers (id, business_id, full_name, total_orders)
      VALUES ('customer-close-repeat', ?, 'Tekrar Musteri', 0)
    `).run(seeds.businessId);
    dbRef.current.prepare(`UPDATE orders SET customer_id = ? WHERE id = ?`).run('customer-close-repeat', orderId);

    dbRef.current.prepare(`
      INSERT INTO payments (id, business_id, order_id, payment_type, amount, created_by)
      VALUES ('pay-close-repeat-1', ?, ?, 'cash', ?, ?)
    `).run(seeds.businessId, orderId, total, seeds.userId);

    const first = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'closed' });
    expect(first.status).toBe(200);

    const customerAfterFirst = dbRef.current.prepare('SELECT total_orders FROM customers WHERE id = ?').get('customer-close-repeat');

    const second = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'closed' });

    expect(second.status).toBe(400);
    expect(second.body.error).toMatch(/zaten kapalı/i);

    const customerAfterSecond = dbRef.current.prepare('SELECT total_orders FROM customers WHERE id = ?').get('customer-close-repeat');
    expect(customerAfterSecond.total_orders).toBe(customerAfterFirst.total_orders);
  });

  it('iptal sipariş kapatılamaz → 400', async () => {
    const created = await createOrder();
    const orderId = created.body.id;

    await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'cancelled' })
      .expect(200);

    const res = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'closed' });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('sipariş');
  });
});

// ── PATCH /api/orders/:id/status → in_kitchen ─────────────────────────────────
describe('PATCH /api/orders/:id/status → in_kitchen', () => {
  it('in_kitchen geçişinde new kalemlerin status\'ü sent olur', async () => {
    const created = await createOrder();
    const orderId = created.body.id;

    // Eğer kalemler zaten sent durumuna geçtiyse (createOrder bunu yapıyor),
    // DB'yi sıfırlayalım
    dbRef.current.prepare(
      `UPDATE order_items SET status = 'new', sent_to_kitchen_at = NULL WHERE order_id = ?`
    ).run(orderId);
    dbRef.current.prepare(
      `UPDATE orders SET status = 'saved' WHERE id = ?`
    ).run(orderId);

    const res = await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'in_kitchen' });

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('in_kitchen');

    const items = dbRef.current.prepare(
      `SELECT * FROM order_items WHERE order_id = ? AND status = 'sent'`
    ).all(orderId);
    expect(items.length).toBeGreaterThanOrEqual(1);
  });
});

// ── PATCH /api/orders/:orderId/items/:itemId — item durum geçişleri ───────────
describe('PATCH /api/orders/:orderId/items/:itemId — item state machine', () => {
  let orderId;
  let itemId;

  beforeEach(async () => {
    const created = await createOrder();
    orderId = created.body.id;
    // İlk kalem — items içinde sent veya new olabilir
    itemId = created.body.items?.[0]?.id;
    // new durumuna döndür
    dbRef.current.prepare(`UPDATE order_items SET status = 'new' WHERE id = ?`).run(itemId);
    dbRef.current.prepare(`UPDATE orders SET status = 'saved' WHERE id = ?`).run(orderId);
  });

  it('new → sent geçişi başarılı', async () => {
    const res = await request(app)
      .patch(`/api/orders/${orderId}/items/${itemId}`)
      .set('Authorization', authHeader)
      .send({ status: 'sent' });

    expect(res.status).toBe(200);
    const item = res.body.items.find(i => i.id === itemId);
    expect(item.status).toBe('sent');
  });

  it('new → preparing geçişi yasak → 400', async () => {
    const res = await request(app)
      .patch(`/api/orders/${orderId}/items/${itemId}`)
      .set('Authorization', authHeader)
      .send({ status: 'preparing' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/geçersiz durum/i);
  });

  it('new → cancelled geçişi başarılı', async () => {
    const res = await request(app)
      .patch(`/api/orders/${orderId}/items/${itemId}`)
      .set('Authorization', authHeader)
      .send({ status: 'cancelled' });

    expect(res.status).toBe(200);
    const item = res.body.items.find(i => i.id === itemId);
    expect(item.status).toBe('cancelled');
  });

  it('sent → preparing geçişi başarılı', async () => {
    dbRef.current.prepare(`UPDATE order_items SET status = 'sent' WHERE id = ?`).run(itemId);

    const res = await request(app)
      .patch(`/api/orders/${orderId}/items/${itemId}`)
      .set('Authorization', authHeader)
      .send({ status: 'preparing' });

    expect(res.status).toBe(200);
  });

  it('ready → new geçişi yasak → 400', async () => {
    dbRef.current.prepare(`UPDATE order_items SET status = 'ready' WHERE id = ?`).run(itemId);

    const res = await request(app)
      .patch(`/api/orders/${orderId}/items/${itemId}`)
      .set('Authorization', authHeader)
      .send({ status: 'new' });

    expect(res.status).toBe(400);
  });

  it('cancelled → served geçişi yasak → 400', async () => {
    dbRef.current.prepare(`UPDATE order_items SET status = 'cancelled' WHERE id = ?`).run(itemId);

    const res = await request(app)
      .patch(`/api/orders/${orderId}/items/${itemId}`)
      .set('Authorization', authHeader)
      .send({ status: 'served' });

    expect(res.status).toBe(400);
  });

  it('item notu güncelleme başarılı', async () => {
    const res = await request(app)
      .patch(`/api/orders/${orderId}/items/${itemId}`)
      .set('Authorization', authHeader)
      .send({ note: 'Az baharatlı' });

    expect(res.status).toBe(200);
    const item = res.body.items.find(i => i.id === itemId);
    expect(item.note).toBe('Az baharatlı');
  });

  it('kapalı siparişte item güncellenemez → 400', async () => {
    dbRef.current.prepare(
      `UPDATE orders SET status = 'closed', closed_at = datetime('now') WHERE id = ?`
    ).run(orderId);

    const res = await request(app)
      .patch(`/api/orders/${orderId}/items/${itemId}`)
      .set('Authorization', authHeader)
      .send({ note: 'Değişmemeli' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/kapalı/i);
  });
});

// ── Auto-cancel: tüm kalemler iptal edilince sipariş otomatik iptal ────────────
describe('Auto-cancel: tüm kalemler iptal → sipariş ve masa otomatik iptal', () => {
  it('ödeme yokken son kalem iptal edilince sipariş ve masa boşalır', async () => {
    const created = await createOrder();
    const orderId = created.body.id;
    const itemId  = created.body.items[0]?.id;

    // Kalemi new yapıp iptal edelim
    dbRef.current.prepare(`UPDATE order_items SET status = 'new' WHERE id = ?`).run(itemId);

    const res = await request(app)
      .patch(`/api/orders/${orderId}/items/${itemId}`)
      .set('Authorization', authHeader)
      .send({ status: 'cancelled' });

    expect(res.status).toBe(200);

    const order = dbRef.current.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
    expect(order.status).toBe('cancelled');

    const table = dbRef.current.prepare('SELECT * FROM tables WHERE id = ?').get(seeds.tableId);
    expect(table.status).toBe('empty');
    expect(table.current_order_id).toBeNull();
  });

  it('ödeme varken son kalem iptal edilse bile sipariş otomatik iptal olmaz', async () => {
    const created = await createOrder();
    const orderId = created.body.id;
    const itemId  = created.body.items[0]?.id;

    // Ödeme ekle
    dbRef.current.prepare(`
      INSERT INTO payments (id, business_id, order_id, payment_type, amount, created_by)
      VALUES ('pay-auto-1', ?, ?, 'cash', 40, ?)
    `).run(seeds.businessId, orderId, seeds.userId);

    dbRef.current.prepare(`UPDATE order_items SET status = 'new' WHERE id = ?`).run(itemId);

    const res = await request(app)
      .patch(`/api/orders/${orderId}/items/${itemId}`)
      .set('Authorization', authHeader)
      .send({ status: 'cancelled' });

    expect(res.status).toBe(200);

    const order = dbRef.current.prepare('SELECT status FROM orders WHERE id = ?').get(orderId);
    // Ödeme varsa otomatik iptal olmaz
    expect(order.status).not.toBe('cancelled');
  });
});

// ── Grand total recalculation: item iptal sonrası toplam düşer ────────────────
describe('Grand total recalculation — item iptal sonrası', () => {
  it('item iptal sonrası grand_total azalır', async () => {
    // 2 ürünlü sipariş oluştur
    const created = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({
        table_id: seeds.tableId,
        order_type: 'dine_in',
        items: [
          { product_id: seeds.productId, quantity: 2 },
        ],
      });

    expect(created.status).toBe(201);
    const orderId = created.body.id;
    const itemId  = created.body.items[0]?.id;
    expect(created.body.grand_total).toBe(160); // 2 * 80

    // Miktarı 1'e düşür
    dbRef.current.prepare(`UPDATE order_items SET status = 'new', quantity = 2 WHERE id = ?`).run(itemId);

    const res = await request(app)
      .patch(`/api/orders/${orderId}/items/${itemId}`)
      .set('Authorization', authHeader)
      .send({ quantity: 1 });

    expect(res.status).toBe(200);
    expect(res.body.grand_total).toBe(80); // 1 * 80
  });
});

// ── P1-01: Mutfak fiş job otomatik kuyruğa alma ──────────────────────────────
describe('Print job auto-enqueue — mutfak (P1-01)', () => {
  it('sipariş oluşturulunca print_jobs tablosunda kitchen job kaydı oluşur', async () => {
    const res = await createOrder();
    expect(res.status).toBe(201);
    const orderId = res.body.id;

    const jobs = dbRef.current.prepare(
      `SELECT * FROM print_jobs WHERE order_id = ? AND job_type = 'kitchen'`
    ).all(orderId);

    // Yazıcı olmasa da kayıt oluşmalı (failed veya printed)
    expect(jobs.length).toBeGreaterThanOrEqual(1);
    jobs.forEach(j => {
      expect(['pending', 'printed', 'failed']).toContain(j.status);
    });
  });

  it('mevcut siparişe ürün eklenince yeni kitchen job oluşur', async () => {
    const created = await createOrder();
    const orderId = created.body.id;

    const jobsBefore = dbRef.current.prepare(
      `SELECT COUNT(*) as c FROM print_jobs WHERE order_id = ? AND job_type = 'kitchen'`
    ).get(orderId).c;

    await request(app)
      .post(`/api/orders/${orderId}/items`)
      .set('Authorization', authHeader)
      .send({ items: [{ product_id: seeds.productId, quantity: 1 }] });

    const jobsAfter = dbRef.current.prepare(
      `SELECT COUNT(*) as c FROM print_jobs WHERE order_id = ? AND job_type = 'kitchen'`
    ).get(orderId).c;

    // Her ürün ekleme yeni bir kitchen job üretmeli
    expect(jobsAfter).toBeGreaterThan(jobsBefore);
  });

  it('in_kitchen status geçişinde print job oluşur', async () => {
    const created = await createOrder();
    const orderId = created.body.id;

    // Kalemleri new durumuna döndür
    dbRef.current.prepare(`UPDATE order_items SET status = 'new' WHERE order_id = ?`).run(orderId);
    dbRef.current.prepare(`UPDATE orders SET status = 'saved' WHERE id = ?`).run(orderId);

    // Mevcut print_jobs'u temizle (temiz baseline)
    dbRef.current.prepare(`DELETE FROM print_jobs WHERE order_id = ?`).run(orderId);

    await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'in_kitchen' });

    const jobs = dbRef.current.prepare(
      `SELECT * FROM print_jobs WHERE order_id = ? AND job_type = 'kitchen'`
    ).all(orderId);

    expect(jobs.length).toBeGreaterThanOrEqual(1);
  });
});

// ── P1-02: Fiş job otomatik kuyruğa alma ─────────────────────────────────────
describe('Print job auto-enqueue — fiş/receipt (P1-02)', () => {
  it('sipariş kapatılınca print_jobs tablosunda receipt job kaydı oluşur', async () => {
    const created = await createOrder();
    const orderId = created.body.id;
    const total = created.body.grand_total;

    // Tam ödeme ekle
    dbRef.current.prepare(`
      INSERT INTO payments (id, business_id, order_id, payment_type, amount, created_by)
      VALUES ('pay-receipt-1', ?, ?, 'cash', ?, ?)
    `).run(seeds.businessId, orderId, total, seeds.userId);

    await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'closed' });

    const jobs = dbRef.current.prepare(
      `SELECT * FROM print_jobs WHERE order_id = ? AND job_type = 'receipt'`
    ).all(orderId);

    // Yazıcı olmasa da kayıt oluşmalı (failed veya printed)
    expect(jobs.length).toBeGreaterThanOrEqual(1);
    jobs.forEach(j => {
      expect(['pending', 'printed', 'failed']).toContain(j.status);
    });
  });

  it('receipt job idempotency — aynı sipariş için ikinci kez oluşturulmaz', async () => {
    const created = await createOrder();
    const orderId = created.body.id;
    const total = created.body.grand_total;

    dbRef.current.prepare(`
      INSERT INTO payments (id, business_id, order_id, payment_type, amount, created_by)
      VALUES ('pay-receipt-2', ?, ?, 'cash', ?, ?)
    `).run(seeds.businessId, orderId, total, seeds.userId);

    // İlk kapanma
    await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'closed' });

    const firstCount = dbRef.current.prepare(
      `SELECT COUNT(*) as c FROM print_jobs WHERE order_id = ? AND job_type = 'receipt'`
    ).get(orderId).c;

    // Aynı endpoint tekrar çağrılsa bile job sayısı artmamalı
    await request(app)
      .patch(`/api/orders/${orderId}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'closed' });

    const secondCount = dbRef.current.prepare(
      `SELECT COUNT(*) as c FROM print_jobs WHERE order_id = ? AND job_type = 'receipt'`
    ).get(orderId).c;

    expect(secondCount).toBe(firstCount);
  });
});

// ── P1-03: served ve comped item geçişleri ────────────────────────────────────
describe('Item state machine — served ve comped geçişleri (P1-03)', () => {
  let orderId;
  let itemId;

  beforeEach(async () => {
    const created = await createOrder();
    orderId = created.body.id;
    itemId = created.body.items?.[0]?.id;
  });

  it('sent → served geçişi başarılı', async () => {
    dbRef.current.prepare(`UPDATE order_items SET status = 'sent' WHERE id = ?`).run(itemId);

    const res = await request(app)
      .patch(`/api/orders/${orderId}/items/${itemId}`)
      .set('Authorization', authHeader)
      .send({ status: 'served' });

    expect(res.status).toBe(200);
    const item = res.body.items.find(i => i.id === itemId);
    expect(item.status).toBe('served');
  });

  it('ready → served geçişi başarılı', async () => {
    dbRef.current.prepare(`UPDATE order_items SET status = 'ready' WHERE id = ?`).run(itemId);

    const res = await request(app)
      .patch(`/api/orders/${orderId}/items/${itemId}`)
      .set('Authorization', authHeader)
      .send({ status: 'served' });

    expect(res.status).toBe(200);
    const item = res.body.items.find(i => i.id === itemId);
    expect(item.status).toBe('served');
  });

  it('new → comped geçişi başarılı', async () => {
    dbRef.current.prepare(`UPDATE order_items SET status = 'new' WHERE id = ?`).run(itemId);

    const res = await request(app)
      .patch(`/api/orders/${orderId}/items/${itemId}`)
      .set('Authorization', authHeader)
      .send({ status: 'comped' });

    expect(res.status).toBe(200);
    const item = res.body.items.find(i => i.id === itemId);
    expect(item.status).toBe('comped');
  });

  it('is_comped=true + comp_reason güncelleme başarılı', async () => {
    dbRef.current.prepare(`UPDATE order_items SET status = 'served' WHERE id = ?`).run(itemId);

    const res = await request(app)
      .patch(`/api/orders/${orderId}/items/${itemId}`)
      .set('Authorization', authHeader)
      .send({ is_comped: true, comp_reason: 'Müşteri şikayeti' });

    expect(res.status).toBe(200);
    const item = res.body.items.find(i => i.id === itemId);
    expect(item.is_comped).toBeTruthy();
    expect(item.comp_reason).toBe('Müşteri şikayeti');
  });

  it('comped item grand_total hesabına dahil edilmez', async () => {
    dbRef.current.prepare(`UPDATE order_items SET status = 'new', quantity = 2 WHERE id = ?`).run(itemId);
    dbRef.current.prepare(`UPDATE orders SET grand_total = 160, subtotal = 160 WHERE id = ?`).run(orderId);

    // Kalemi comped yap (is_comped=1 → grand_total düşer)
    dbRef.current.prepare(`UPDATE order_items SET is_comped = 1 WHERE id = ?`).run(itemId);

    // Status güncellemesi tetikleyerek recalc çalıştır
    const res = await request(app)
      .patch(`/api/orders/${orderId}/items/${itemId}`)
      .set('Authorization', authHeader)
      .send({ note: 'recalc trigger' });

    expect(res.status).toBe(200);
    // is_comped=1 olan kalem subtotal hesabının dışında kalmalı
    expect(res.body.grand_total).toBe(0);
  });
});

// ── GET /api/orders filtreleme ────────────────────────────────────────────────
describe('GET /api/orders — filtreleme', () => {
  it('status filtresi yalnız eşleşen siparişleri döner', async () => {
    // Bir sipariş oluştur
    const c1 = await createOrder();
    expect(c1.status).toBe(201);

    // Başka status'te sipariş yok
    const res = await request(app)
      .get('/api/orders?status=closed')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    // Hiç kapalı sipariş olmadığı için boş dönmeli
    expect(res.body.length).toBe(0);
  });

  it('order_type=takeaway filtresi yalnız paket siparişleri döner', async () => {
    await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({
        order_type: 'takeaway',
        customer_id: null,
        items: [{ product_id: seeds.productId, quantity: 1 }],
      });

    const res = await request(app)
      .get('/api/orders?order_type=takeaway')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    res.body.forEach(o => expect(o.order_type).toBe('takeaway'));
  });

  it('limit parametresi çalışır', async () => {
    // 3 sipariş oluştur
    for (let i = 0; i < 3; i++) {
      await createOrder();
    }

    const res = await request(app)
      .get('/api/orders?limit=2')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.length).toBeLessThanOrEqual(2);
  });
});
