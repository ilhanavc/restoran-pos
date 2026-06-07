import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';

const { dbRef, testConfig } = vi.hoisted(() => ({
  dbRef: { current: null },
  testConfig: {
    nodeEnv: 'test',
    storeTimezone: 'Europe/Istanbul',
    bridge: { token: 'bridge-test-token', businessId: 'bridge-biz' },
  },
}));

vi.mock('../../config/database.js', () => ({
  get default() { return dbRef.current; },
}));
vi.mock('../../config/index.js', () => ({ default: testConfig }));

let app;
let helpers;
let seeds;

beforeAll(async () => {
  helpers = await import('./helpers.js');
  const { default: bridgeRoutes } = await import('../../routes/bridge.js');
  app = express();
  app.use(express.json());
  app.use('/api/bridge', bridgeRoutes);
});

beforeEach(() => {
  dbRef.current = helpers.createTestDb();
  seeds = helpers.seedBusiness(dbRef.current);
  testConfig.bridge.businessId = seeds.businessId;
});

function withBridgeAuth(req) {
  return req.set('X-Bridge-Token', testConfig.bridge.token);
}

function insertPrintJob({ id = 'job-1', status = 'pending', claimedUntil = null, claimedBy = null } = {}) {
  dbRef.current.prepare(`
    INSERT INTO print_jobs (
      id, business_id, order_id, printer_id, job_type, payload, status,
      idempotency_key, claimed_at, claimed_by, claimed_until, created_at
    ) VALUES (?, ?, NULL, NULL, 'test', '{}', ?, ?, ?, ?, ?, datetime('now'))
  `).run(
    id,
    seeds.businessId,
    status,
    `idem-${id}`,
    claimedBy ? '2026-01-01 00:00:00' : null,
    claimedBy,
    claimedUntil,
  );
  return id;
}

describe('bridge print job lease behavior', () => {
  it('claims a pending job with a lease and blocks a second active claim', async () => {
    const jobId = insertPrintJob();

    const first = await withBridgeAuth(request(app).post(`/api/bridge/print-jobs/${jobId}/claim`))
      .send({ claim_id: 'bridge-a' });

    expect(first.status).toBe(200);
    expect(first.body.job.claimed_by).toBe('bridge-a');
    expect(first.body.job.claimed_until).toBeTruthy();
    expect(first.body.job.attempt_count).toBe(1);

    const second = await withBridgeAuth(request(app).post(`/api/bridge/print-jobs/${jobId}/claim`))
      .send({ claim_id: 'bridge-b' });

    expect(second.status).toBe(409);
    expect(second.body.reason).toBe('not_pending_or_lease_active');
  });

  it('allows a stale claimed job to be reclaimed', async () => {
    const jobId = insertPrintJob({
      id: 'job-stale',
      claimedBy: 'dead-bridge',
      claimedUntil: '2020-01-01 00:00:00',
    });

    const res = await withBridgeAuth(request(app).post(`/api/bridge/print-jobs/${jobId}/claim`))
      .send({ claim_id: 'bridge-live' });

    expect(res.status).toBe(200);
    expect(res.body.job.claimed_by).toBe('bridge-live');
    expect(res.body.job.attempt_count).toBe(1);
  });

  it('requires the active claim owner for status updates', async () => {
    const jobId = insertPrintJob();
    await withBridgeAuth(request(app).post(`/api/bridge/print-jobs/${jobId}/claim`))
      .send({ claim_id: 'bridge-a' });

    const mismatch = await withBridgeAuth(request(app).patch(`/api/bridge/print-jobs/${jobId}`))
      .send({ status: 'printed', claim_id: 'bridge-b' });

    expect(mismatch.status).toBe(409);
    expect(mismatch.body.error).toBe('claim_mismatch');

    const ok = await withBridgeAuth(request(app).patch(`/api/bridge/print-jobs/${jobId}`))
      .send({ status: 'printed', claim_id: 'bridge-a' });

    expect(ok.status).toBe(200);
    expect(ok.body.job.status).toBe('printed');
    expect(ok.body.job.claimed_until).toBeNull();
  });

  it('stores classified failure codes without auto-retrying failed jobs', async () => {
    const jobId = insertPrintJob({ id: 'job-fail' });
    await withBridgeAuth(request(app).post(`/api/bridge/print-jobs/${jobId}/claim`))
      .send({ claim_id: 'bridge-a' });

    const failed = await withBridgeAuth(request(app).patch(`/api/bridge/print-jobs/${jobId}`))
      .send({
        status: 'failed',
        claim_id: 'bridge-a',
        error_message: 'USB spooler failed',
        error_code: 'usb_print_failed',
      });

    expect(failed.status).toBe(200);
    expect(failed.body.job.status).toBe('failed');
    expect(failed.body.job.last_error_code).toBe('usb_print_failed');

    const list = await withBridgeAuth(request(app).get('/api/bridge/print-jobs?status=pending&unclaimed_only=1'));
    expect(list.status).toBe(200);
    expect(list.body.jobs.find((job) => job.id === jobId)).toBeUndefined();
  });
});

describe('bridge health and discovery contract', () => {
  it('falls back to the legacy printer record name for usb printers when physicalName is missing', async () => {
    dbRef.current.prepare(`
      INSERT INTO printers (
        id, business_id, branch_id, name, type, connection_type, ip_address, port, is_active, print_options, created_at
      ) VALUES (?, ?, ?, ?, 'receipt', 'usb', NULL, 9100, 1, ?, datetime('now'))
    `).run(
      'printer-usb-legacy',
      seeds.businessId,
      seeds.branchId,
      'EPSON TM-T20III USB',
      JSON.stringify({ device: { physicalName: '' } }),
    );

    const res = await withBridgeAuth(request(app).get('/api/bridge/printers/printer-usb-legacy'));

    expect(res.status).toBe(200);
    expect(res.body.printer).toEqual(
      expect.objectContaining({
        id: 'printer-usb-legacy',
        connection_type: 'usb',
        printer_name: 'EPSON TM-T20III USB',
      }),
    );
  });

  it('returns structured health with discovery, refresh request and queue summary', async () => {
    insertPrintJob({ id: 'health-pending', status: 'pending' });
    dbRef.current.prepare(`
      INSERT INTO print_jobs (
        id, business_id, order_id, printer_id, job_type, payload, status,
        error_message, last_error_code, idempotency_key, created_at
      ) VALUES (?, ?, NULL, NULL, 'test', '{}', 'failed', 'USB hata', 'usb_print_failed', ?, datetime('now'))
    `).run('health-failed', seeds.businessId, 'idem-health-failed');
    dbRef.current.prepare(`
      INSERT INTO settings (id, business_id, key, value, updated_at)
      VALUES ('discovery-cache', ?, 'bridge.discovered_printers', ?, datetime('now'))
    `).run(
      seeds.businessId,
      JSON.stringify({
        scanState: 'success',
        lastErrorCode: null,
        updatedAt: '2026-04-16T13:00:00.000Z',
        printers: [{ name: 'USB-1', isOnline: true }],
      }),
    );
    dbRef.current.prepare(`
      INSERT INTO settings (id, business_id, key, value, updated_at)
      VALUES ('refresh-request', ?, 'bridge.discovery_refresh_request', ?, datetime('now'))
    `).run(
      seeds.businessId,
      JSON.stringify({
        requestId: 'scan-1',
        requestedAt: '2026-04-16T13:01:00.000Z',
        status: 'requested',
        source: 'admin',
      }),
    );

    const res = await withBridgeAuth(request(app).get('/api/bridge/health'));

    expect(res.status).toBe(200);
    expect(res.body.ok).toBe(true);
    expect(res.body.discovery.scanState).toBe('success');
    expect(res.body.discovery.printers).toEqual([expect.objectContaining({ name: 'USB-1' })]);
    expect(res.body.refreshRequest).toEqual(expect.objectContaining({ requestId: 'scan-1', status: 'requested' }));
    expect(res.body.queueSummary).toEqual(expect.objectContaining({ pending: 1, failed: 1, stale_claimed: 0 }));
    expect(res.body.lastErrorCode).toBe('usb_print_failed');
  });

  it('tracks discovery refresh lifecycle and normalizes cache payload', async () => {
    const refreshRes = await withBridgeAuth(request(app).post('/api/bridge/printers/discovered/refresh')).send({});
    expect(refreshRes.status).toBe(200);
    expect(refreshRes.body.scanState).toBe('scanning');
    expect(refreshRes.body.request).toEqual(expect.objectContaining({ status: 'requested' }));

    const requestState = await withBridgeAuth(request(app).get('/api/bridge/printers/discovered/refresh-request'));
    expect(requestState.status).toBe(200);
    expect(requestState.body.hasPending).toBe(true);

    const discoveredRes = await withBridgeAuth(request(app).post('/api/bridge/printers/discovered'))
      .send({
        requestId: refreshRes.body.requestId,
        scanState: 'success',
        printers: [{ name: 'Windows Printer', isDefault: true, isOnline: true, connectionType: 'usb', portName: 'USB001' }],
      });
    expect(discoveredRes.status).toBe(200);

    const listRes = await withBridgeAuth(request(app).get('/api/bridge/printers/discovered'));
    expect(listRes.status).toBe(200);
    expect(listRes.body.scanState).toBe('success');
    expect(listRes.body.printers).toEqual([
      expect.objectContaining({
        name: 'Windows Printer',
        connectionType: 'usb',
        portName: 'USB001',
        source: 'windows',
      }),
    ]);

    const requestDone = await withBridgeAuth(request(app).get('/api/bridge/printers/discovered/refresh-request'));
    expect(requestDone.status).toBe(200);
    expect(requestDone.body.request).toEqual(expect.objectContaining({ status: 'completed' }));
    expect(requestDone.body.hasPending).toBe(false);
  });

  it('preserves auth and business isolation for discovery cache', async () => {
    const otherSeeds = helpers.seedBusiness(dbRef.current);
    dbRef.current.prepare(`
      INSERT INTO settings (id, business_id, key, value, updated_at)
      VALUES ('discovery-current', ?, 'bridge.discovered_printers', ?, datetime('now'))
    `).run(seeds.businessId, JSON.stringify({ scanState: 'success', printers: [{ name: 'Current' }] }));
    dbRef.current.prepare(`
      INSERT INTO settings (id, business_id, key, value, updated_at)
      VALUES ('discovery-other', ?, 'bridge.discovered_printers', ?, datetime('now'))
    `).run(otherSeeds.businessId, JSON.stringify({ scanState: 'success', printers: [{ name: 'Other' }] }));

    const currentRes = await withBridgeAuth(request(app).get('/api/bridge/printers/discovered'));
    expect(currentRes.status).toBe(200);
    expect(currentRes.body.printers).toEqual([expect.objectContaining({ name: 'Current' })]);

    const unauthRes = await request(app).get('/api/bridge/health');
    expect(unauthRes.status).toBe(401);
  });
});

// ── P2: Print queue filtre ve özet endpoint testleri ─────────────────────────

describe('GET /api/bridge/print-jobs — filtre ve özet (P2)', () => {
  beforeEach(() => {
    dbRef.current = helpers.createTestDb();
    seeds = helpers.seedBusiness(dbRef.current);
    testConfig.bridge.businessId = seeds.businessId;
  });

  it('status=pending ile yalnızca pending işler döner', async () => {
    insertPrintJob({ id: 'p2-pend-1', status: 'pending' });
    insertPrintJob({ id: 'p2-fail-1', status: 'failed' });
    insertPrintJob({ id: 'p2-done-1', status: 'printed' });

    const res = await withBridgeAuth(request(app).get('/api/bridge/print-jobs?status=pending'));
    expect(res.status).toBe(200);
    const ids = res.body.jobs.map((j) => j.id);
    expect(ids).toContain('p2-pend-1');
    expect(ids).not.toContain('p2-fail-1');
    expect(ids).not.toContain('p2-done-1');
  });

  it('status=failed ile yalnızca failed işler döner', async () => {
    insertPrintJob({ id: 'p2-pend-2', status: 'pending' });
    insertPrintJob({ id: 'p2-fail-2', status: 'failed' });

    const res = await withBridgeAuth(request(app).get('/api/bridge/print-jobs?status=failed'));
    expect(res.status).toBe(200);
    const ids = res.body.jobs.map((j) => j.id);
    expect(ids).toContain('p2-fail-2');
    expect(ids).not.toContain('p2-pend-2');
  });

  it('unclaimed_only=1 ile aktif kiralanmış işler hariç tutulur', async () => {
    const future = new Date(Date.now() + 60_000).toISOString().replace('T', ' ').slice(0, 19);
    insertPrintJob({ id: 'p2-claimed', status: 'pending', claimedBy: 'bridge-x', claimedUntil: future });
    insertPrintJob({ id: 'p2-free', status: 'pending' });

    const res = await withBridgeAuth(
      request(app).get('/api/bridge/print-jobs?status=pending&unclaimed_only=1'),
    );
    expect(res.status).toBe(200);
    const ids = res.body.jobs.map((j) => j.id);
    expect(ids).toContain('p2-free');
    expect(ids).not.toContain('p2-claimed');
  });

  it('limit parametresi sonuç sayısını kısıtlar', async () => {
    for (let i = 1; i <= 5; i++) {
      insertPrintJob({ id: `p2-lim-${i}`, status: 'pending' });
    }
    const res = await withBridgeAuth(request(app).get('/api/bridge/print-jobs?status=pending&limit=2'));
    expect(res.status).toBe(200);
    expect(res.body.jobs.length).toBeLessThanOrEqual(2);
  });

  it('geçersiz status değeri 400 döner', async () => {
    const res = await withBridgeAuth(request(app).get('/api/bridge/print-jobs?status=gecersiz'));
    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/geçersiz/i);
  });

  it('Bridge-Token olmadan 401 döner', async () => {
    const res = await request(app).get('/api/bridge/print-jobs');
    expect(res.status).toBe(401);
  });
});
