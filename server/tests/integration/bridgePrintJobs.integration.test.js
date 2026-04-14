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
