import { Router } from 'express';
import { z } from 'zod';
import db from '../config/database.js';
import { authenticate, businessScope, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { genId } from '../utils/helpers.js';
import { createOrder } from '../services/orderService.js';

const router = Router();
router.use(authenticate, businessScope);

const reservationSchema = z.object({
  table_id: z.string().optional().nullable(),
  customer_name: z.string().min(1).max(100),
  customer_phone: z.string().max(20).optional().nullable(),
  party_size: z.number().int().min(1).max(100).default(2),
  reservation_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, 'YYYY-MM-DD formatında olmalı'),
  reservation_time: z.string().regex(/^\d{2}:\d{2}$/, 'HH:MM formatında olmalı'),
  notes: z.string().max(500).optional().nullable(),
  status: z.enum(['confirmed', 'arrived', 'cancelled', 'no_show']).default('confirmed'),
});

const seatReservationSchema = {
  body: z.object({
    table_id: z.string().min(1).optional().nullable(),
  }),
};

// GET /api/reservations?date=YYYY-MM-DD
router.get('/', authorize('admin', 'cashier'), (req, res) => {
  try {
    const { date, from, to } = req.query;
    let rows;
    if (from && to) {
      rows = db.prepare(`
        SELECT r.*, t.name as table_name
        FROM reservations r LEFT JOIN tables t ON r.table_id = t.id
        WHERE r.business_id = ? AND r.reservation_date BETWEEN ? AND ?
        ORDER BY r.reservation_date, r.reservation_time
      `).all(req.businessId, from, to);
    } else {
      const targetDate = date || new Date().toISOString().slice(0, 10);
      rows = db.prepare(`
        SELECT r.*, t.name as table_name
        FROM reservations r LEFT JOIN tables t ON r.table_id = t.id
        WHERE r.business_id = ? AND r.reservation_date = ?
        ORDER BY r.reservation_time
      `).all(req.businessId, targetDate);
    }
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/reservations
router.post('/', authorize('admin', 'cashier'), validate({ body: reservationSchema }), (req, res) => {
  try {
    const id = genId();
    const { table_id, customer_name, customer_phone, party_size, reservation_date, reservation_time, notes, status } = req.body;
    db.prepare(`
      INSERT INTO reservations (id, business_id, table_id, customer_name, customer_phone, party_size, reservation_date, reservation_time, notes, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.businessId, table_id || null, customer_name, customer_phone || null, party_size, reservation_date, reservation_time, notes || null, status, req.user.id);
    const row = db.prepare(`SELECT r.*, t.name as table_name FROM reservations r LEFT JOIN tables t ON r.table_id = t.id WHERE r.id = ?`).get(id);
    res.status(201).json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// PATCH /api/reservations/:id
router.patch('/:id', authorize('admin', 'cashier'), (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT * FROM reservations WHERE id = ? AND business_id = ?').get(id, req.businessId);
    if (!existing) return res.status(404).json({ error: 'Rezervasyon bulunamadı' });

    const allowed = ['table_id', 'customer_name', 'customer_phone', 'party_size', 'reservation_date', 'reservation_time', 'notes', 'status'];
    const fields = Object.keys(req.body).filter(k => allowed.includes(k));
    if (fields.length === 0) return res.status(400).json({ error: 'Güncellenecek alan yok' });
    if (['cancelled', 'no_show'].includes(existing.status) && req.body.status && req.body.status !== existing.status) {
      return res.status(400).json({ error: 'İptal veya gelmedi durumundaki rezervasyon yeniden açılamaz' });
    }

    const sets = fields.map(f => `${f} = ?`).join(', ');
    const vals = fields.map(f => req.body[f] ?? null);
    db.prepare(`UPDATE reservations SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...vals, id);
    if (req.body.status === 'arrived' && !existing.arrived_at) {
      db.prepare(`UPDATE reservations SET arrived_at = datetime('now') WHERE id = ?`).run(id);
    }

    const row = db.prepare(`SELECT r.*, t.name as table_name FROM reservations r LEFT JOIN tables t ON r.table_id = t.id WHERE r.id = ?`).get(id);
    res.json(row);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/reservations/:id/seat
router.post('/:id/seat', authorize('admin', 'cashier'), validate(seatReservationSchema), (req, res) => {
  try {
    const reservation = db.prepare('SELECT * FROM reservations WHERE id = ? AND business_id = ?')
      .get(req.params.id, req.businessId);
    if (!reservation) return res.status(404).json({ error: 'Rezervasyon bulunamadı' });
    if (['cancelled', 'no_show'].includes(reservation.status)) {
      return res.status(400).json({ error: 'İptal veya gelmedi durumundaki rezervasyon masaya oturtulamaz' });
    }
    if (reservation.seated_order_id) {
      return res.status(409).json({ error: 'Bu rezervasyon zaten masaya oturtulmuş' });
    }

    const tableId = req.body.table_id || reservation.table_id;
    if (!tableId) return res.status(400).json({ error: 'Masa seçimi gerekli' });

    const order = createOrder(req.businessId, req.branchId, req.user.id, {
      order_type: 'dine_in',
      table_id: tableId,
      items: [],
      guest_count: reservation.party_size || 0,
      note: `Rezervasyon: ${reservation.customer_name}`,
    });

    db.prepare(`
      UPDATE reservations
      SET table_id = ?, status = 'arrived', arrived_at = COALESCE(arrived_at, datetime('now')),
          seated_order_id = ?, updated_at = datetime('now')
      WHERE id = ? AND business_id = ?
    `).run(tableId, order.id, reservation.id, req.businessId);

    const row = db.prepare(`
      SELECT r.*, t.name as table_name
      FROM reservations r LEFT JOIN tables t ON r.table_id = t.id
      WHERE r.id = ?
    `).get(reservation.id);
    res.status(201).json({ reservation: row, order });
  } catch (err) {
    if (err.isBadRequest || err.status === 400) return res.status(400).json({ error: err.message });
    if (err.status === 409) return res.status(409).json({ error: err.message });
    console.error('Reservation seating error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// DELETE /api/reservations/:id
router.delete('/:id', authorize('admin', 'cashier'), (req, res) => {
  try {
    const { id } = req.params;
    const existing = db.prepare('SELECT id FROM reservations WHERE id = ? AND business_id = ?').get(id, req.businessId);
    if (!existing) return res.status(404).json({ error: 'Rezervasyon bulunamadı' });
    db.prepare('DELETE FROM reservations WHERE id = ?').run(id);
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

export default router;
