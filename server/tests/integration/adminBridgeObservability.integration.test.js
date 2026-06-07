import { describe, it, expect, beforeAll, beforeEach, afterEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import fs from 'fs';
import os from 'os';
import path from 'path';

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
  tempUserData = fs.mkdtempSync(path.join(os.tmpdir(), 'pos-bridge-logs-'));
  process.env.USER_DATA_PATH = tempUserData;
});

afterEach(() => {
  if (tempUserData) {
    fs.rmSync(tempUserData, { recursive: true, force: true });
    tempUserData = null;
  }
  delete process.env.USER_DATA_PATH;
});

describe('admin storebridge log observability', () => {
  it('returns empty log payload when no bridge log exists', async () => {
    const res = await request(app)
      .get('/api/admin/storebridge/logs')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(false);
    expect(res.body.lines).toEqual([]);
  });

  it('masks bridge token while returning the latest log lines', async () => {
    const logsDir = path.join(tempUserData, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(
      path.join(logsDir, 'store-bridge.log'),
      [
        '[store-bridge] started',
        `[store-bridge] token=${testConfig.bridge.token}`,
        '[store-bridge] usb_print_failed job=abc',
      ].join('\n'),
      'utf8',
    );

    const res = await request(app)
      .get('/api/admin/storebridge/logs?limit=2')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(true);
    expect(res.body.source).toBe('store-bridge');
    expect(res.body.lines).toHaveLength(3);
    expect(res.body.lines.join('\n')).not.toContain(testConfig.bridge.token);
    expect(res.body.lines.join('\n')).toContain('***');
  });

  it('falls back to filtered electron main logs when dedicated storebridge log is missing', async () => {
    const logsDir = path.join(tempUserData, 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    fs.writeFileSync(
      path.join(logsDir, 'electron-main.log'),
      [
        '[server] backend ready',
        '[store-bridge] bridge online',
        '[store-bridge] auth token ***',
      ].join('\n'),
      'utf8',
    );

    const res = await request(app)
      .get('/api/admin/storebridge/logs')
      .set('Authorization', authHeader);

    expect(res.status).toBe(200);
    expect(res.body.exists).toBe(true);
    expect(res.body.source).toBe('electron-main');
    expect(res.body.lines).toEqual([
      '[store-bridge] bridge online',
      '[store-bridge] auth token ***',
    ]);
  });

  it('rejects non-admin access to bridge logs', async () => {
    const waiterRoleId = 'role-waiter';
    const waiterUserId = 'user-waiter';
    dbRef.current
      .prepare(`INSERT INTO roles (id, business_id, name, slug, permissions) VALUES (?, ?, 'Garson', 'waiter', '{}')`)
      .run(waiterRoleId, seeds.businessId);
    dbRef.current
      .prepare(`
        INSERT INTO users (id, business_id, full_name, email, password_hash, role_id, is_active)
        VALUES (?, ?, 'Waiter User', 'waiter@test.com', 'hash', ?, 1)
      `)
      .run(waiterUserId, seeds.businessId, waiterRoleId);
    const waiterToken = jwt.sign({ userId: waiterUserId }, TEST_JWT_SECRET);

    const res = await request(app)
      .get('/api/admin/storebridge/logs')
      .set('Authorization', `Bearer ${waiterToken}`);

    expect(res.status).toBe(403);
  });
});
