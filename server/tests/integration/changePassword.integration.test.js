/**
 * POST /api/auth/change-password + must_change_password zorunlu değişim akışı.
 * FAZ 0 — Görev 0.5 regresyonu.
 */
import { describe, it, expect, beforeAll, vi } from 'vitest';
import request from 'supertest';
import express from 'express';
import bcrypt from 'bcryptjs';
import { v4 as uuidv4 } from 'uuid';

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

let app;
let forceChangeUserId;

beforeAll(async () => {
  const { createTestDb, seedBusiness } = await import('./helpers.js');
  dbRef.current = createTestDb();
  const seeds = seedBusiness(dbRef.current);

  // İkinci kullanıcı: must_change_password=1 (zorla değiştirme senaryosu)
  forceChangeUserId = uuidv4();
  const hash = bcrypt.hashSync('TempPass1', 8);
  dbRef.current.prepare(
    `INSERT INTO users (id, business_id, full_name, email, password_hash, role_id, is_active, must_change_password)
     VALUES (?, ?, 'Force Change User', 'force@test.com', ?, ?, 1, 1)`,
  ).run(forceChangeUserId, seeds.businessId, hash, seeds.roleId);

  const { default: authRoutes } = await import('../../routes/auth.js');
  app = express();
  app.use(express.json());
  app.use('/api/auth', authRoutes);
});

describe('POST /api/auth/login — must_change_password=1', () => {
  it('zorunlu değişim bekleyen kullanıcı 403 + must_change_password: true alır', async () => {
    const res = await request(app)
      .post('/api/auth/login')
      .send({ email: 'force@test.com', password: 'TempPass1' });

    expect(res.status).toBe(403);
    expect(res.body.must_change_password).toBe(true);
    expect(res.body.email).toBe('force@test.com');
    expect(res.body).not.toHaveProperty('token');
  });
});

describe('POST /api/auth/change-password', () => {
  it('yanlış eski şifre → 401', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .send({ email: 'force@test.com', oldPassword: 'yanlis', newPassword: 'NewPass1234' });

    expect(res.status).toBe(401);
  });

  it('zayıf yeni şifre → 400 (politika ihlali)', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .send({ email: 'force@test.com', oldPassword: 'TempPass1', newPassword: '123456' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/en az 8 karakter/);
  });

  it('büyük harf yok → 400', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .send({ email: 'force@test.com', oldPassword: 'TempPass1', newPassword: 'abcdef12' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/büyük harf/);
  });

  it('yeni şifre eskiyle aynı → 400', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .send({ email: 'force@test.com', oldPassword: 'TempPass1', newPassword: 'TempPass1' });

    expect(res.status).toBe(400);
    expect(res.body.error).toMatch(/farklı/);
  });

  it('geçerli değişim → 200, must_change_password=0, yeni şifre ile login geçer', async () => {
    // Değiştir
    const res = await request(app)
      .post('/api/auth/change-password')
      .send({ email: 'force@test.com', oldPassword: 'TempPass1', newPassword: 'NewPass1234' });

    expect(res.status).toBe(200);
    expect(res.body.success).toBe(true);

    // DB kontrolü: flag sıfırlandı
    const row = dbRef.current.prepare(
      'SELECT must_change_password FROM users WHERE id = ?',
    ).get(forceChangeUserId);
    expect(Number(row.must_change_password)).toBe(0);

    // Yeni şifreyle login artık 200 döner
    const login = await request(app)
      .post('/api/auth/login')
      .send({ email: 'force@test.com', password: 'NewPass1234' });
    expect(login.status).toBe(200);
    expect(login.body).toHaveProperty('token');

    // Eski şifre artık geçmez
    const loginOld = await request(app)
      .post('/api/auth/login')
      .send({ email: 'force@test.com', password: 'TempPass1' });
    expect(loginOld.status).toBe(401);
  });

  it('var olmayan kullanıcı → 401', async () => {
    const res = await request(app)
      .post('/api/auth/change-password')
      .send({ email: 'yok@test.com', oldPassword: 'TempPass1', newPassword: 'NewPass1234' });

    expect(res.status).toBe(401);
  });
});
