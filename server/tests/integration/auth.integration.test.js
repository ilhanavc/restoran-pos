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

  it('must_change_password aktifse 403 ve yönlendirici veri döner', async () => {
    dbRef.current.prepare(`
      UPDATE users
      SET must_change_password = 1
      WHERE email = 'admin@test.com'
    `).run();

    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.com', password: 'test123' });

    expect(res.status).toBe(403);
    expect(res.body.must_change_password).toBe(true);
    expect(res.body.email).toBe('admin@test.com');
    expect(res.body.businessId).toBeTruthy();
  });
});

describe('POST /api/auth/forgot-password', () => {
  it('kayıtlı kullanıcı için pending reset request oluşturur', async () => {
    const res = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'admin@test.com' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    const row = dbRef.current.prepare(`
      SELECT email, status
      FROM password_reset_requests
      WHERE user_id = ?
    `).get(userId);

    expect(row.email).toBe('admin@test.com');
    expect(row.status).toBe('pending');
  });

  it('aynı kullanıcı için ikinci talepte yeni pending kayıt açmaz', async () => {
    await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'admin@test.com' });

    const second = await request(app)
      .post('/api/auth/forgot-password')
      .send({ email: 'admin@test.com' });

    expect(second.status).toBe(200);
    const count = dbRef.current.prepare(`
      SELECT COUNT(*) AS c
      FROM password_reset_requests
      WHERE user_id = ? AND status = 'pending'
    `).get(userId).c;
    expect(count).toBe(1);
  });
});

describe('POST /api/auth/change-password', () => {
  it('geçici şifre sonrası yeni şifreyi kaydedip flagi sıfırlar', async () => {
    dbRef.current.prepare(`
      UPDATE users
      SET must_change_password = 1
      WHERE id = ?
    `).run(userId);

    const changeRes = await request(app)
      .post('/api/auth/change-password')
      .send({
        email: 'admin@test.com',
        oldPassword: 'test123',
        newPassword: 'YeniSifre9',
      });

    expect(changeRes.status).toBe(200);
    expect(changeRes.body.success).toBe(true);

    const user = dbRef.current.prepare(`
      SELECT must_change_password
      FROM users
      WHERE id = ?
    `).get(userId);
    expect(user.must_change_password).toBe(0);

    const loginRes = await request(app)
      .post('/api/auth/login')
      .send({ email: 'admin@test.com', password: 'YeniSifre9' });

    expect(loginRes.status).toBe(200);
    expect(loginRes.body.user.email).toBe('admin@test.com');
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
