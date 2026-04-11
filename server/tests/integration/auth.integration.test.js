/**
 * Auth route entegrasyon testleri.
 * POST /api/auth/login ve GET /api/auth/me uçlarını HTTP düzeyinde test eder.
 *
 * vi.hoisted() — mock fabrikası çalışmadan önce değerleri tanımlar.
 * Testler in-memory SQLite ile gerçek route handler'larını çalıştırır.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import jwt from 'jsonwebtoken';

// ── vi.hoisted: vi.mock factory'den önce çalışır ───────────────────────────
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

// ── Test data setup ───────────────────────────────────────────────────────────
let app;
let userId;

beforeAll(async () => {
  const { createTestDb, seedBusiness } = await import('./helpers.js');
  dbRef.current = createTestDb();
  const seeds = seedBusiness(dbRef.current);
  userId = seeds.userId;

  const { default: authRoutes } = await import('../../routes/auth.js');
  app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
});

// ── POST /api/auth/login ──────────────────────────────────────────────────────

describe('POST /api/auth/login', () => {
  it('doğru kimlik bilgileriyle 200 ve token döner', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.com', password: 'test123' });

    expect(res.status).toBe(200);
    expect(res.body).toHaveProperty('token');
    expect(res.body).toHaveProperty('user');
    expect(res.body.user.email).toBe('admin@test.com');
    expect(res.body.user.role).toBe('admin');
  });

  it('yanlış parolayla 401 döner', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.com', password: 'yanlis_parola' });

    expect(res.status).toBe(401);
    expect(res.body).toHaveProperty('error');
  });

  it('var olmayan e-posta ile 401 döner', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'olmayan@test.com', password: 'test123' });

    expect(res.status).toBe(401);
  });

  it('e-posta alanı eksikse 400 döner', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ password: 'test123' });

    expect(res.status).toBe(400);
  });

  it('boş body ile 400 döner', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({});

    expect(res.status).toBe(400);
  });
});

// ── GET /api/auth/me ──────────────────────────────────────────────────────────

describe('GET /api/auth/me', () => {
  it('geçerli token ile 200 ve kullanıcı bilgisi döner', async () => {
    const token = jwt.sign({ userId }, TEST_JWT_SECRET);

    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${token}`);

    expect(res.status).toBe(200);
    expect(res.body.user.email).toBe('admin@test.com');
  });

  it('token yoksa 401 döner', async () => {
    const res = await request(app).get('/api/auth/me');
    expect(res.status).toBe(401);
  });

  it('geçersiz token ile 401 döner', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', 'Bearer gecersiz.token.xyz');
    expect(res.status).toBe(401);
  });
});
