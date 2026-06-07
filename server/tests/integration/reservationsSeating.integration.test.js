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
  get default() { return dbRef.current; },
}));
vi.mock('../../config/index.js', () => ({ default: testConfig }));

let app;
let helpers;
let seeds;
let authHeader;

beforeAll(async () => {
  helpers = await import('./helpers.js');
  const { default: reservationsRoutes } = await import('../../routes/reservations.js');
  app = express();
  app.use(express.json());
  app.use('/api/reservations', reservationsRoutes);
});

beforeEach(() => {
  dbRef.current = helpers.createTestDb();
  seeds = helpers.seedBusiness(dbRef.current);
  authHeader = `Bearer ${jwt.sign({ userId: seeds.userId }, TEST_JWT_SECRET)}`;
});

async function createReservation(overrides = {}) {
  const payload = {
    customer_name: 'Ayşe Yılmaz',
    customer_phone: '05550000000',
    party_size: 3,
    reservation_date: new Date().toISOString().slice(0, 10),
    reservation_time: '19:30',
    table_id: seeds.tableId,
    ...overrides,
  };
  const res = await request(app)
    .post('/api/reservations')
    .set('Authorization', authHeader)
    .send(payload);
  expect(res.status).toBe(201);
  return res.body;
}

describe('reservation seating flow', () => {
  it('seats a confirmed reservation by opening a table order', async () => {
    const reservation = await createReservation();

    const res = await request(app)
      .post(`/api/reservations/${reservation.id}/seat`)
      .set('Authorization', authHeader)
      .send({ table_id: seeds.tableId });

    expect(res.status).toBe(201);
    expect(res.body.reservation.status).toBe('arrived');
    expect(res.body.reservation.seated_order_id).toBe(res.body.order.id);
    expect(res.body.order.status).toBe('saved');
    expect(res.body.order.items).toHaveLength(0);

    const table = dbRef.current.prepare('SELECT status, current_order_id, guest_count FROM tables WHERE id = ?').get(seeds.tableId);
    expect(table.status).toBe('occupied');
    expect(table.current_order_id).toBe(res.body.order.id);
    expect(table.guest_count).toBe(3);
  });

  it('rejects seating when the target table already has an active order', async () => {
    const reservation = await createReservation();
    dbRef.current.prepare(`
      INSERT INTO orders (id, business_id, table_id, user_id, order_type, status, subtotal, grand_total, created_by)
      VALUES ('existing-active-order', ?, ?, ?, 'dine_in', 'saved', 0, 0, ?)
    `).run(seeds.businessId, seeds.tableId, seeds.userId, seeds.userId);
    dbRef.current.prepare(`
      UPDATE tables SET status = 'occupied', current_order_id = 'existing-active-order' WHERE id = ?
    `).run(seeds.tableId);

    const res = await request(app)
      .post(`/api/reservations/${reservation.id}/seat`)
      .set('Authorization', authHeader)
      .send({ table_id: seeds.tableId });

    expect(res.status).toBe(400);
    expect(res.body.error).toContain('açık');
  });

  it('keeps cancelled and no-show reservations from being seated or reopened', async () => {
    const cancelled = await createReservation({ status: 'cancelled' });

    const seatCancelled = await request(app)
      .post(`/api/reservations/${cancelled.id}/seat`)
      .set('Authorization', authHeader)
      .send({ table_id: seeds.tableId });
    expect(seatCancelled.status).toBe(400);

    const reopen = await request(app)
      .patch(`/api/reservations/${cancelled.id}`)
      .set('Authorization', authHeader)
      .send({ status: 'confirmed' });
    expect(reopen.status).toBe(400);
  });
});
