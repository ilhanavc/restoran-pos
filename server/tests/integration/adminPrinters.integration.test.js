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
      bridge: { token: 'bridge-test-token', businessId: 'bridge-biz' },
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
  const { default: adminRoutes } = await import('../../routes/admin.js');
  app = express();
  app.use(express.json());
  app.use('/api/admin', adminRoutes);
});

beforeEach(() => {
  dbRef.current = helpers.createTestDb();
  seeds = helpers.seedBusiness(dbRef.current);
  authHeader = `Bearer ${jwt.sign({ userId: seeds.userId }, TEST_JWT_SECRET)}`;
});

function insertPrinter({ id = 'printer-1', name = 'Ana Yazici' } = {}) {
  dbRef.current.prepare(`
    INSERT INTO printers (
      id, business_id, branch_id, name, type, connection_type, ip_address, port, is_active, line_width, print_options
    ) VALUES (?, ?, NULL, ?, 'receipt', 'network', '127.0.0.1', 9100, 1, 42, '{}')
  `).run(id, seeds.businessId, name);
  return id;
}

function insertOrder({ id = 'order-1' } = {}) {
  dbRef.current.prepare(`
    INSERT INTO orders (
      id, business_id, user_id, order_type, status, subtotal, grand_total, created_by
    ) VALUES (?, ?, ?, 'takeaway', 'saved', 10, 10, ?)
  `).run(id, seeds.businessId, seeds.userId, seeds.userId);
  return id;
}

describe('admin printer delete behavior', () => {
  it('allows deleting the only printer even when it is the default printer', async () => {
    const printerId = insertPrinter({ id: 'printer-default-only', name: 'Tek Yazici' });
    dbRef.current.prepare(`
      INSERT INTO settings (id, business_id, key, value, updated_at)
      VALUES (?, ?, 'printer.config', ?, datetime('now'))
    `).run('setting-printer-config', seeds.businessId, JSON.stringify({ defaultPrinterId: printerId }));

    const eligibilityRes = await request(app)
      .get(`/api/admin/printers/${printerId}/delete-eligibility`)
      .set('Authorization', authHeader);

    expect(eligibilityRes.status).toBe(200);
    expect(eligibilityRes.body.canHardDelete).toBe(true);
    expect(eligibilityRes.body.usage.isDefault).toBe(true);

    const deleteRes = await request(app)
      .delete(`/api/admin/printers/${printerId}`)
      .set('Authorization', authHeader);

    expect(deleteRes.status).toBe(200);

    const printer = dbRef.current.prepare('SELECT id FROM printers WHERE id = ?').get(printerId);
    expect(printer).toBeUndefined();

    const setting = dbRef.current.prepare(`
      SELECT value FROM settings WHERE business_id = ? AND key = 'printer.config'
    `).get(seeds.businessId);
    expect(JSON.parse(setting.value).defaultPrinterId).toBeNull();
  });

  it('allows deleting a printer that is still referenced by category routing', async () => {
    const printerId = insertPrinter({ id: 'printer-routed', name: 'Yonlendirilmis Yazici' });
    dbRef.current.prepare(`
      INSERT INTO printer_routing (id, business_id, category_id, printer_id)
      VALUES (?, ?, ?, ?)
    `).run('routing-1', seeds.businessId, seeds.categoryId, printerId);

    const eligibilityRes = await request(app)
      .get(`/api/admin/printers/${printerId}/delete-eligibility`)
      .set('Authorization', authHeader);

    expect(eligibilityRes.status).toBe(200);
    expect(eligibilityRes.body.canHardDelete).toBe(true);
    expect(eligibilityRes.body.usage.routingCount).toBe(1);

    const deleteRes = await request(app)
      .delete(`/api/admin/printers/${printerId}`)
      .set('Authorization', authHeader);

    expect(deleteRes.status).toBe(200);

    const routing = dbRef.current.prepare('SELECT COUNT(*) AS c FROM printer_routing WHERE printer_id = ?').get(printerId);
    expect(routing.c).toBe(0);
  });

  it('deletes printer and its pending print jobs together', async () => {
    const printerId = insertPrinter({ id: 'printer-pending', name: 'Bekleyen Yazici' });
    const orderId = insertOrder({ id: 'order-pending-printer' });
    dbRef.current.prepare(`
      INSERT INTO print_jobs (id, business_id, order_id, printer_id, job_type, payload, status, idempotency_key, created_at)
      VALUES (?, ?, ?, ?, 'receipt', '{}', 'pending', ?, datetime('now'))
    `).run('job-1', seeds.businessId, orderId, printerId, 'idem-1');

    const eligibilityRes = await request(app)
      .get(`/api/admin/printers/${printerId}/delete-eligibility`)
      .set('Authorization', authHeader);

    expect(eligibilityRes.status).toBe(200);
    expect(eligibilityRes.body.canHardDelete).toBe(true);
    expect(eligibilityRes.body.usage.pendingJobs).toBe(1);

    const deleteRes = await request(app)
      .delete(`/api/admin/printers/${printerId}`)
      .set('Authorization', authHeader);

    expect(deleteRes.status).toBe(200);

    const remainingJob = dbRef.current.prepare('SELECT COUNT(*) AS c FROM print_jobs WHERE id = ?').get('job-1');
    expect(remainingJob.c).toBe(0);
  });
});

describe('admin print job queue behavior', () => {
  it('returns queue summary and manually retries only failed jobs', async () => {
    const printerId = insertPrinter({ id: 'printer-retry', name: 'Retry Yazici' });
    const orderId = insertOrder({ id: 'order-retry-printer' });
    dbRef.current.prepare(`
      INSERT INTO print_jobs (
        id, business_id, order_id, printer_id, job_type, payload, status,
        error_message, last_error_code, idempotency_key, created_at
      ) VALUES (?, ?, ?, ?, 'receipt', '{}', 'failed', 'USB hata', 'usb_print_failed', ?, datetime('now'))
    `).run('job-retry-1', seeds.businessId, orderId, printerId, 'idem-retry-1');

    const listRes = await request(app)
      .get('/api/admin/print-jobs')
      .set('Authorization', authHeader);

    expect(listRes.status).toBe(200);
    expect(listRes.body.summary.failed).toBe(1);
    expect(listRes.body.jobs[0].last_error_code).toBe('usb_print_failed');

    const retryRes = await request(app)
      .post('/api/admin/print-jobs/job-retry-1/retry')
      .set('Authorization', authHeader);

    expect(retryRes.status).toBe(200);
    expect(retryRes.body.job.status).toBe('pending');
    expect(retryRes.body.job.error_message).toBeNull();
    expect(retryRes.body.job.last_error_code).toBeNull();
  });

  it('does not retry printed jobs', async () => {
    const printerId = insertPrinter({ id: 'printer-printed', name: 'Printed Yazici' });
    const orderId = insertOrder({ id: 'order-printed-printer' });
    dbRef.current.prepare(`
      INSERT INTO print_jobs (
        id, business_id, order_id, printer_id, job_type, payload, status,
        idempotency_key, created_at, printed_at
      ) VALUES (?, ?, ?, ?, 'receipt', '{}', 'printed', ?, datetime('now'), datetime('now'))
    `).run('job-printed-1', seeds.businessId, orderId, printerId, 'idem-printed-1');

    const retryRes = await request(app)
      .post('/api/admin/print-jobs/job-printed-1/retry')
      .set('Authorization', authHeader);

    expect(retryRes.status).toBe(409);
  });
});

describe('PATCH /api/admin/users/:id — şifre güncelleme guard (G-1)', () => {
  it('3 karakterlik şifre ile güncelleme → 400', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${seeds.userId}`)
      .set('Authorization', authHeader)
      .send({ password: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/4 karakter/);
  });

  it('1 karakterlik şifre ile güncelleme → 400', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${seeds.userId}`)
      .set('Authorization', authHeader)
      .send({ password: 'x' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/4 karakter/);
  });

  it('4 karakterlik şifre (minimum sınırda) → 200', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${seeds.userId}`)
      .set('Authorization', authHeader)
      .send({ password: '1234' });
    expect(res.status).toBe(200);
  });

  it('şifre alanı gönderilmezse mevcut şifre korunur → 200', async () => {
    const before = dbRef.current
      .prepare('SELECT password_hash FROM users WHERE id = ?')
      .get(seeds.userId);
    const res = await request(app)
      .patch(`/api/admin/users/${seeds.userId}`)
      .set('Authorization', authHeader)
      .send({ full_name: 'Güncel Ad' });
    expect(res.status).toBe(200);
    const after = dbRef.current
      .prepare('SELECT password_hash FROM users WHERE id = ?')
      .get(seeds.userId);
    expect(after.password_hash).toBe(before.password_hash);
  });
});
