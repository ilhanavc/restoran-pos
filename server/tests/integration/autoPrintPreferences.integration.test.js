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

function seedPrinter(db, { id, businessId, type, autoPrint }) {
  const po = {
    device: { physicalName: `${type}-device`, source: 'manual' },
    autoPrint,
  };
  db.prepare(`
    INSERT INTO printers (id, business_id, name, type, connection_type, ip_address, port, is_active, print_options)
    VALUES (?, ?, ?, ?, 'network', '127.0.0.1', 9100, 1, ?)
  `).run(id, businessId, `${type}-printer`, type, JSON.stringify(po));
}

function setDefaultReceiptPrinter(db, businessId, printerId) {
  db.prepare(`
    INSERT OR REPLACE INTO settings (business_id, key, value)
    VALUES (?, 'printer.config', ?)
  `).run(businessId, JSON.stringify({ defaultPrinterId: printerId }));
}

function countJobs(db, orderId, jobType) {
  return db.prepare(`SELECT COUNT(*) AS c FROM print_jobs WHERE order_id = ? AND job_type = ?`).get(orderId, jobType).c;
}

function addEmptyTable(db, businessId, areaId, name = 'Masa 2') {
  const tableId = `table-${name.replace(/\s+/g, '-').toLowerCase()}`;
  db.prepare(`
    INSERT INTO tables (id, business_id, dining_area_id, name, capacity, status, is_active, sort_order)
    VALUES (?, ?, ?, ?, 4, 'empty', 1, 99)
  `).run(tableId, businessId, areaId, name);
  return tableId;
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

describe('Auto print preferences policy', () => {
  it('mutfak yazıcısı create tercihine göre masa siparişi print eder', async () => {
    const kitchenPrinterId = 'kitchen-printer-1';
    seedPrinter(dbRef.current, {
      id: kitchenPrinterId,
      businessId: seeds.businessId,
      type: 'kitchen',
      autoPrint: {
        onTableOrderCreate: false,
        onTakeawayOrderCreate: false,
        onOrderAdjustment: true,
      },
    });

    const created1 = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({
        table_id: seeds.tableId,
        order_type: 'dine_in',
        items: [{ product_id: seeds.productId, quantity: 1 }],
      });
    expect(created1.status).toBe(201);
    expect(countJobs(dbRef.current, created1.body.id, 'kitchen')).toBe(0);

    dbRef.current.prepare(`UPDATE printers SET print_options = ? WHERE id = ?`).run(
      JSON.stringify({
        device: { physicalName: 'kitchen-device', source: 'manual' },
        autoPrint: {
          onTableOrderCreate: true,
          onTakeawayOrderCreate: false,
          onOrderAdjustment: true,
        },
      }),
      kitchenPrinterId,
    );

    const created2 = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({
        table_id: addEmptyTable(dbRef.current, seeds.businessId, seeds.areaId, 'Masa 2'),
        order_type: 'dine_in',
        items: [{ product_id: seeds.productId, quantity: 1 }],
      });
    expect(created2.status).toBe(201);
    expect(countJobs(dbRef.current, created2.body.id, 'kitchen')).toBeGreaterThan(0);
  });

  it('mutfak yazıcısı takeaway create ve adjustment tercihlerini uygular', async () => {
    seedPrinter(dbRef.current, {
      id: 'kitchen-printer-2',
      businessId: seeds.businessId,
      type: 'kitchen',
      autoPrint: {
        onTableOrderCreate: false,
        onTakeawayOrderCreate: true,
        onOrderAdjustment: false,
      },
    });

    const created = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({
        order_type: 'takeaway',
        customer_id: null,
        items: [{ product_id: seeds.productId, quantity: 2 }],
      });
    expect(created.status).toBe(201);
    expect(countJobs(dbRef.current, created.body.id, 'kitchen')).toBeGreaterThan(0);

    const item = dbRef.current.prepare(`SELECT id FROM order_items WHERE order_id = ? LIMIT 1`).get(created.body.id);
    const adjust = await request(app)
      .patch(`/api/orders/${created.body.id}/items/${item.id}`)
      .set('Authorization', authHeader)
      .send({ quantity: 1 });
    expect(adjust.status).toBe(200);
    expect(countJobs(dbRef.current, created.body.id, 'kitchen_adjustment')).toBe(0);
  });

  it('müşteri fişi ödeme ve masa kapama tercihlerini uygular', async () => {
    const receiptPrinterId = 'receipt-printer-1';
    seedPrinter(dbRef.current, {
      id: receiptPrinterId,
      businessId: seeds.businessId,
      type: 'receipt',
      autoPrint: {
        onPaymentComplete: true,
        onTableClose: false,
        onTakeawayComplete: false,
      },
    });
    setDefaultReceiptPrinter(dbRef.current, seeds.businessId, receiptPrinterId);

    const created = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({
        table_id: seeds.tableId,
        order_type: 'dine_in',
        items: [{ product_id: seeds.productId, quantity: 1 }],
      });
    expect(created.status).toBe(201);

    const payment = await request(app)
      .post('/api/payments')
      .set('Authorization', authHeader)
      .send({
        order_id: created.body.id,
        payment_type: 'cash',
        amount: 80,
        cash_received: 80,
        print_receipt: true,
      });
    expect(payment.status).toBe(201);
    expect(countJobs(dbRef.current, created.body.id, 'receipt')).toBeGreaterThan(0);

    const closed = await request(app)
      .patch(`/api/orders/${created.body.id}/status`)
      .set('Authorization', authHeader)
      .send({ status: 'closed' });
    expect(closed.status).toBe(200);
    // table close kapalı olduğu için yeni bir fiş job'ı üretilmemeli (idempotency korunur)
    expect(countJobs(dbRef.current, created.body.id, 'receipt')).toBe(1);
  });

  it('payment complete kapalı + table close açık kombinasyonunda close_order ile fiş üretir', async () => {
    const receiptPrinterId = 'receipt-printer-3';
    seedPrinter(dbRef.current, {
      id: receiptPrinterId,
      businessId: seeds.businessId,
      type: 'receipt',
      autoPrint: {
        onPaymentComplete: false,
        onTableClose: true,
        onTakeawayComplete: false,
      },
    });
    setDefaultReceiptPrinter(dbRef.current, seeds.businessId, receiptPrinterId);

    const created = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({
        table_id: seeds.tableId,
        order_type: 'dine_in',
        items: [{ product_id: seeds.productId, quantity: 1 }],
      });
    expect(created.status).toBe(201);

    const paidAndClosed = await request(app)
      .post('/api/payments')
      .set('Authorization', authHeader)
      .send({
        order_id: created.body.id,
        payment_type: 'cash',
        amount: 80,
        cash_received: 80,
        print_receipt: true,
        close_order: true,
      });
    expect(paidAndClosed.status).toBe(201);
    expect(countJobs(dbRef.current, created.body.id, 'receipt')).toBe(1);
  });

  it('otomatik fiş kapalıyken manuel fiş yazdırma yine çalışır', async () => {
    const receiptPrinterId = 'receipt-printer-4';
    seedPrinter(dbRef.current, {
      id: receiptPrinterId,
      businessId: seeds.businessId,
      type: 'receipt',
      autoPrint: {
        onPaymentComplete: false,
        onTableClose: false,
        onTakeawayComplete: false,
      },
    });
    setDefaultReceiptPrinter(dbRef.current, seeds.businessId, receiptPrinterId);

    const created = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({
        table_id: seeds.tableId,
        order_type: 'dine_in',
        items: [{ product_id: seeds.productId, quantity: 1 }],
      });
    expect(created.status).toBe(201);

    const manualPrint = await request(app)
      .post(`/api/orders/${created.body.id}/print-receipt`)
      .set('Authorization', authHeader)
      .send({ printer_id: receiptPrinterId });
    expect(manualPrint.status).toBe(200);
    expect(countJobs(dbRef.current, created.body.id, 'receipt')).toBe(1);
  });

  it('takeaway tamamlandı tercihinde müşteri fişi otomatik oluşur', async () => {
    const receiptPrinterId = 'receipt-printer-2';
    seedPrinter(dbRef.current, {
      id: receiptPrinterId,
      businessId: seeds.businessId,
      type: 'receipt',
      autoPrint: {
        onPaymentComplete: false,
        onTableClose: false,
        onTakeawayComplete: true,
      },
    });
    seedPrinter(dbRef.current, {
      id: 'kitchen-printer-3',
      businessId: seeds.businessId,
      type: 'kitchen',
      autoPrint: {
        onTableOrderCreate: false,
        onTakeawayOrderCreate: false,
        onOrderAdjustment: false,
      },
    });
    setDefaultReceiptPrinter(dbRef.current, seeds.businessId, receiptPrinterId);

    const created = await request(app)
      .post('/api/orders')
      .set('Authorization', authHeader)
      .send({
        order_type: 'takeaway',
        items: [{ product_id: seeds.productId, quantity: 1 }],
      });
    expect(created.status).toBe(201);
    const labelJob = dbRef.current
      .prepare(`SELECT printer_id FROM print_jobs WHERE order_id = ? AND job_type = 'takeaway_label'`)
      .get(created.body.id);
    expect(labelJob?.printer_id).toBe('kitchen-printer-3');

    const out = await request(app)
      .patch(`/api/orders/${created.body.id}/takeaway/delivery`)
      .set('Authorization', authHeader)
      .send({ action: 'out_for_delivery' });
    expect(out.status).toBe(200);

    const delivered = await request(app)
      .patch(`/api/orders/${created.body.id}/takeaway/delivery`)
      .set('Authorization', authHeader)
      .send({ action: 'delivered' });
    expect(delivered.status).toBe(200);
    expect(countJobs(dbRef.current, created.body.id, 'receipt')).toBeGreaterThan(0);
  });
});
