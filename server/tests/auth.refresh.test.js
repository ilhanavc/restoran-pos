import { describe, it, expect, beforeAll, beforeEach, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';
import { hashToken } from '../utils/tokenUtils.js';

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

let app;
let helpers;
let seeds;

beforeAll(async () => {
  helpers = await import('./integration/helpers.js');
  const { default: authRoutes } = await import('../routes/auth.js');
  app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
});

beforeEach(() => {
  dbRef.current = helpers.createTestDb();
  seeds = helpers.seedBusiness(dbRef.current);
});

async function login(headers = {}) {
  return request(app)
    .post('/api/auth/login')
    .set(headers)
    .send({ email: 'admin@test.com', password: 'test123' });
}

describe('mobile refresh token auth', () => {
  it('login with X-Client-Type: mobile returns refreshToken', async () => {
    const res = await login({ 'X-Client-Type': 'mobile', 'X-Device-Id': 'tablet-1' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.expiresIn).toBe(900);

    const row = dbRef.current
      .prepare('SELECT user_id, token_hash, device_id, client_type FROM refresh_tokens')
      .get();
    expect(row.user_id).toBe(seeds.userId);
    expect(row.token_hash).toBe(hashToken(res.body.refreshToken));
    expect(row.device_id).toBe('tablet-1');
    expect(row.client_type).toBe('mobile');
  });

  it('login with X-Client-Type: desktop does not return refreshToken', async () => {
    const res = await login({ 'X-Client-Type': 'desktop' });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.refreshToken).toBeUndefined();
    expect(res.body.expiresIn).toBeUndefined();
    expect(dbRef.current.prepare('SELECT COUNT(*) AS c FROM refresh_tokens').get().c).toBe(0);
  });

  it('POST /auth/refresh returns a new access token and rotates refreshToken', async () => {
    const loginRes = await login({ 'X-Client-Type': 'mobile', 'X-Device-Id': 'tablet-rotate' });
    const oldRefreshToken = loginRes.body.refreshToken;

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: oldRefreshToken });

    expect(res.status).toBe(200);
    expect(res.body.token).toBeTruthy();
    expect(res.body.refreshToken).toBeTruthy();
    expect(res.body.refreshToken).not.toBe(oldRefreshToken);
    expect(res.body.expiresIn).toBe(900);

    const decoded = jwt.verify(res.body.token, TEST_JWT_SECRET);
    expect(decoded.userId).toBe(seeds.userId);
    expect(decoded.role).toBe('admin');
    expect(decoded.businessId).toBe(seeds.businessId);

    expect(
      dbRef.current.prepare('SELECT COUNT(*) AS c FROM refresh_tokens WHERE token_hash = ?').get(hashToken(oldRefreshToken)).c,
    ).toBe(0);
    const newRow = dbRef.current
      .prepare('SELECT device_id FROM refresh_tokens WHERE token_hash = ?')
      .get(hashToken(res.body.refreshToken));
    expect(newRow.device_id).toBe('tablet-rotate');
  });

  it('POST /auth/refresh expired token returns 401', async () => {
    const loginRes = await login({ 'X-Client-Type': 'mobile' });
    dbRef.current
      .prepare("UPDATE refresh_tokens SET expires_at = datetime('now', '-1 minute') WHERE token_hash = ?")
      .run(hashToken(loginRes.body.refreshToken));

    const res = await request(app)
      .post('/api/auth/refresh')
      .send({ refreshToken: loginRes.body.refreshToken });

    expect(res.status).toBe(401);
    expect(
      dbRef.current
        .prepare('SELECT COUNT(*) AS c FROM refresh_tokens WHERE token_hash = ?')
        .get(hashToken(loginRes.body.refreshToken)).c,
    ).toBe(0);
  });

  it('POST /auth/logout with refreshToken deletes token from DB', async () => {
    const loginRes = await login({ 'X-Client-Type': 'mobile' });

    const res = await request(app)
      .post('/api/auth/logout')
      .set('Authorization', `Bearer ${loginRes.body.token}`)
      .send({ refreshToken: loginRes.body.refreshToken });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);
    expect(
      dbRef.current
        .prepare('SELECT COUNT(*) AS c FROM refresh_tokens WHERE token_hash = ?')
        .get(hashToken(loginRes.body.refreshToken)).c,
    ).toBe(0);
  });
});
