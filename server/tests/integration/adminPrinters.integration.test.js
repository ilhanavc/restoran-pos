import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import os from 'os';
import path from 'path';
import Database from 'better-sqlite3';

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
let tempUserData;

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
  tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-maintenance-'));
  process.env.USER_DATA_PATH = tempUserData;
  testConfig.bridge.token = 'bridge-test-token';
  testConfig.bridge.businessId = 'bridge-biz';
});

afterEach(() => {
  if (tempUserData) {
    fs.rmSync(tempUserData, { recursive: true, force: true });
    tempUserData = null;
  }
  delete process.env.USER_DATA_PATH;
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

function upsertSetting(key, value, businessId = seeds.businessId) {
  const existing = dbRef.current.prepare(`SELECT id FROM settings WHERE business_id = ? AND key = ?`).get(businessId, key);
  if (existing) {
    dbRef.current
      .prepare(`UPDATE settings SET value = ?, updated_at = datetime('now') WHERE business_id = ? AND key = ?`)
      .run(JSON.stringify(value), businessId, key);
    return existing.id;
  }
  const id = `setting-${key}-${Math.random().toString(36).slice(2, 8)}`;
  dbRef.current
    .prepare(`INSERT INTO settings (id, business_id, key, value, updated_at) VALUES (?, ?, ?, ?, datetime('now'))`)
    .run(id, businessId, key, JSON.stringify(value));
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

describe('admin desktop readiness', () => {
  it('reports blocking setup gaps and refuses completion while required checks fail', async () => {
    const readinessRes = await request(app)
      .get('/api/admin/desktop-readiness')
      .set('Authorization', authHeader);

    expect(readinessRes.status).toBe(200);
    expect(readinessRes.body.ready).toBe(false);
    expect(readinessRes.body.blockerCount).toBeGreaterThan(0);
    expect(readinessRes.body.checks.some((check) => check.key === 'receipt_printer' && check.status === 'warning')).toBe(true);

    const completeRes = await request(app)
      .post('/api/admin/desktop-readiness/complete')
      .set('Authorization', authHeader);

    expect(completeRes.status).toBe(409);
    expect(completeRes.body.readiness.ready).toBe(false);
  });

  it('marks setup completed when all blocking checks pass', async () => {
    dbRef.current
      .prepare(`UPDATE businesses SET tax_id = '1234567890', address = 'Test Adres' WHERE id = ?`)
      .run(seeds.businessId);

    const receiptPrinterId = insertPrinter({ id: 'readiness-receipt-printer', name: 'Kasa Yazici' });
    dbRef.current
      .prepare(`UPDATE printers SET type = 'receipt', is_active = 1 WHERE id = ?`)
      .run(receiptPrinterId);

    const kitchenPrinterId = insertPrinter({ id: 'readiness-kitchen-printer', name: 'Mutfak Yazici' });
    dbRef.current
      .prepare(`UPDATE printers SET type = 'kitchen', is_active = 1 WHERE id = ?`)
      .run(kitchenPrinterId);

    dbRef.current
      .prepare(
        `INSERT INTO settings (id, business_id, key, value, updated_at)
         VALUES (?, ?, 'printer.config', ?, datetime('now'))`,
      )
      .run(
        'readiness-printer-config',
        seeds.businessId,
        JSON.stringify({
          defaultPrinterId: receiptPrinterId,
          usagePaymentId: receiptPrinterId,
          usageKitchenId: kitchenPrinterId,
        }),
      );

    const readinessRes = await request(app)
      .get('/api/admin/desktop-readiness')
      .set('Authorization', authHeader);

    expect(readinessRes.status).toBe(200);
    expect(readinessRes.body.ready).toBe(true);
    expect(readinessRes.body.blockerCount).toBe(0);
    expect(readinessRes.body.warningCount).toBeGreaterThanOrEqual(0);

    const completeRes = await request(app)
      .post('/api/admin/desktop-readiness/complete')
      .set('Authorization', authHeader);

    expect(completeRes.status).toBe(200);
    expect(completeRes.body.completed).toBe(true);
    expect(completeRes.body.completed_at).toBeTruthy();

    const setting = dbRef.current
      .prepare(`SELECT value FROM settings WHERE business_id = ? AND key = 'app.setup'`)
      .get(seeds.businessId);
    expect(JSON.parse(setting.value).completedBy).toBe(seeds.userId);
  });
});

describe('admin storebridge observability', () => {
  it('reports degraded health when failed jobs and stale claims exist', async () => {
    const kitchenPrinterId = insertPrinter({ id: 'printer-health-kitchen', name: 'Mutfak Health' });
    dbRef.current.prepare(`UPDATE printers SET type = 'kitchen', print_options = ? WHERE id = ?`).run(
      JSON.stringify({ device: { physicalName: 'Mutfak USB' } }),
      kitchenPrinterId,
    );
    const receiptPrinterId = insertPrinter({ id: 'printer-health-receipt', name: 'Kasa Health' });
    dbRef.current.prepare(`UPDATE printers SET print_options = ? WHERE id = ?`).run(
      JSON.stringify({ device: { physicalName: 'Kasa USB' } }),
      receiptPrinterId,
    );
    upsertSetting('printer.config', {
      defaultPrinterId: receiptPrinterId,
      usagePaymentId: receiptPrinterId,
      usageKitchenId: kitchenPrinterId,
    });
    upsertSetting('bridge.discovered_printers', {
      scanState: 'success',
      lastErrorCode: null,
      updatedAt: '2026-04-16T10:00:00.000Z',
      printers: [{ name: 'Kasa USB', isOnline: true }],
    });

    const orderId = insertOrder({ id: 'order-health-1' });
    dbRef.current.prepare(`
      INSERT INTO print_jobs (
        id, business_id, order_id, printer_id, job_type, payload, status,
        error_message, last_error_code, idempotency_key, created_at, claimed_until
      ) VALUES (?, ?, ?, ?, 'receipt', '{}', 'failed', 'USB hata', 'usb_print_failed', ?, datetime('now'), NULL)
    `).run('job-health-failed', seeds.businessId, orderId, receiptPrinterId, 'idem-health-failed');
    dbRef.current.prepare(`
      INSERT INTO print_jobs (
        id, business_id, order_id, printer_id, job_type, payload, status,
        idempotency_key, created_at, claimed_by, claimed_until
      ) VALUES (?, ?, ?, ?, 'kitchen', '{}', 'pending', ?, datetime('now'), 'dead-bridge', '2020-01-01 00:00:00')
    `).run('job-health-stale', seeds.businessId, orderId, kitchenPrinterId, 'idem-health-stale');

    const res = await request(app)
      .get('/api/admin/storebridge/health')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.status).toBe('degraded');
    expect(res.body.queueSummary.failed).toBe(1);
    expect(res.body.queueSummary.stale_claimed).toBe(1);
    expect(res.body.lastErrorCode).toBe('usb_print_failed');
    expect(res.body.discovery.printerCount).toBe(1);
    expect(res.body.selectedPrinters.missingConfiguredPhysical).toEqual([
      expect.objectContaining({ type: 'kitchen', physicalName: 'Mutfak USB' }),
    ]);
  });

  it('reports unconfigured health without mutating readiness completion state', async () => {
    testConfig.bridge.token = '';
    testConfig.bridge.businessId = '';
    upsertSetting('app.setup', {
      completedAt: '2026-04-16T11:00:00.000Z',
      completedBy: seeds.userId,
    });
    upsertSetting('bridge.discovered_printers', {
      scanState: 'bridge_unreachable',
      lastErrorCode: 'bridge_not_configured',
      updatedAt: '2026-04-16T11:05:00.000Z',
      printers: [],
    });

    const healthRes = await request(app)
      .get('/api/admin/storebridge/health')
      .set('Authorization', authHeader);
    const readinessRes = await request(app)
      .get('/api/admin/desktop-readiness')
      .set('Authorization', authHeader);

    expect(healthRes.status).toBe(200);
    expect(healthRes.body.status).toBe('unconfigured');
    expect(healthRes.body.configured).toBe(false);

    expect(readinessRes.status).toBe(200);
    expect(readinessRes.body.completed).toBe(true);
    expect(readinessRes.body.checks.some((check) => check.key === 'storebridge' && check.status === 'warning')).toBe(true);
  });

  it('isolates storebridge health to the authenticated business', async () => {
    const otherSeeds = helpers.seedBusiness(dbRef.current);
    upsertSetting('bridge.discovered_printers', {
      scanState: 'success',
      lastErrorCode: null,
      updatedAt: '2026-04-16T12:00:00.000Z',
      printers: [{ name: 'Ana USB', isOnline: true }],
    });
    upsertSetting('bridge.discovered_printers', {
      scanState: 'bridge_unreachable',
      lastErrorCode: 'bridge_unreachable',
      updatedAt: '2026-04-16T12:05:00.000Z',
      printers: [],
    }, otherSeeds.businessId);

    const res = await request(app)
      .get('/api/admin/storebridge/health')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.scanState).toBe('success');
    expect(res.body.discovery.printers).toEqual([expect.objectContaining({ name: 'Ana USB' })]);
    expect(res.body.lastErrorCode).toBeNull();
  });
});

describe('admin maintenance backup restore planning', () => {
  it('lists backups, writes a verified restore request and cancels it', async () => {
    const backupsDir = path.join(tempUserData, 'backups');
    fs.mkdirSync(backupsDir, { recursive: true });
    const backupName = 'pos-2026-04-16.db';
    const backupPath = path.join(backupsDir, backupName);
    const backupDb = new Database(backupPath);
    backupDb.exec('CREATE TABLE sample (id TEXT PRIMARY KEY); INSERT INTO sample (id) VALUES (\'ok\');');
    backupDb.close();

    const listRes = await request(app)
      .get('/api/admin/maintenance')
      .set('Authorization', authHeader);

    expect(listRes.status).toBe(200);
    expect(listRes.body.backups.some((backup) => backup.id === backupName)).toBe(true);
    expect(listRes.body.pendingRestore).toBeNull();

    const restoreRes = await request(app)
      .post('/api/admin/maintenance/restore-request')
      .set('Authorization', authHeader)
      .send({ backup_id: backupName });

    expect(restoreRes.status).toBe(200);
    expect(restoreRes.body.pendingRestore.backupFile).toBe(backupName);

    const requestPath = path.join(tempUserData, 'restore-request.json');
    expect(fs.existsSync(requestPath)).toBe(true);
    expect(JSON.parse(fs.readFileSync(requestPath, 'utf8')).requestedBy).toBe(seeds.userId);

    const cancelRes = await request(app)
      .delete('/api/admin/maintenance/restore-request')
      .set('Authorization', authHeader);

    expect(cancelRes.status).toBe(200);
    expect(fs.existsSync(requestPath)).toBe(false);
  });
});

describe('PATCH /api/admin/users/:id — şifre güncelleme guard (G-1 / FAZ 0 — 0.5)', () => {
  it('3 karakterlik şifre ile güncelleme → 400 (min 8)', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${seeds.userId}`)
      .set('Authorization', authHeader)
      .send({ password: 'abc' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/en az 8 karakter/);
  });

  it('7 karakterlik şifre (sınırın altında) → 400', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${seeds.userId}`)
      .set('Authorization', authHeader)
      .send({ password: 'Abc1234' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/en az 8 karakter/);
  });

  it('büyük harf içermeyen 8+ karakter → 400', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${seeds.userId}`)
      .set('Authorization', authHeader)
      .send({ password: 'abcdef12' });
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/büyük harf/);
  });

  it('politika uyumlu şifre (8+ / büyük / rakam) → 200', async () => {
    const res = await request(app)
      .patch(`/api/admin/users/${seeds.userId}`)
      .set('Authorization', authHeader)
      .send({ password: 'Pass1234' });
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
