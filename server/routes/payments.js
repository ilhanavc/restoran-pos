import { Router } from 'express';
import { z } from 'zod';
import db from '../config/database.js';
import { authenticate, businessScope, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { emitToRoom } from '../socket.js';
import {
  normalizeIdempotencyKey, rangeBounds,
  buildSplitState, createPayment, createSplitPayment,
} from '../services/paymentService.js';

const router = Router();
router.use(authenticate, businessScope);

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const createPaymentSchema = {
  body: z.object({
    order_id: z.string().min(1, 'Sipariş kimliği gerekli'),
    payment_type: z.enum(['cash', 'card'], {
      errorMap: () => ({ message: 'Geçerli ödeme tipi: cash, card' }),
    }),
    amount: z.number().positive('Tutar sıfırdan büyük olmalıdır'),
    tip_amount: z.number().min(0).optional().nullable(),
    cash_received: z.number().min(0).optional().nullable(),
    note: z.string().max(500).optional().nullable(),
    idempotency_key: z.string().trim().min(1).max(128).optional().nullable(),
    close_order: z.boolean().optional().default(false),
    print_receipt: z.boolean().optional().default(false),
    print_printer_id: z.string().trim().min(1).max(128).optional().nullable(),
  }),
};

const createSplitPaymentSchema = {
  body: z.object({
    order_id: z.string().min(1, 'Sipariş kimliği gerekli'),
    payment_type: z.enum(['cash', 'card'], {
      errorMap: () => ({ message: 'Geçerli ödeme tipi: cash, card' }),
    }),
    tip_amount: z.number().min(0).optional().nullable(),
    cash_received: z.number().min(0).optional().nullable(),
    payer_no: z.number().int().positive().max(999).optional().nullable(),
    payer_label: z.string().max(80).optional().nullable(),
    note: z.string().max(500).optional().nullable(),
    idempotency_key: z.string().trim().min(1).max(128).optional().nullable(),
    allocations: z.array(z.object({
      order_item_id: z.string().min(1),
      quantity: z.number().int().positive().max(999),
    })).min(1, 'En az bir kalem seçilmeli'),
  }),
};

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /api/payments/orders/:orderId/split-state
router.get('/orders/:orderId/split-state', authorize('admin', 'cashier'), (req, res) => {
  try {
    const state = buildSplitState(req.params.orderId, req.businessId);
    if (!state) return res.status(404).json({ error: 'Sipariş bulunamadı' });
    res.json(state);
  } catch (err) {
    console.error('Split payment state error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/payments
router.post('/', authorize('admin', 'cashier'), validate(createPaymentSchema), (req, res) => {
  try {
    const idempotencyKey = normalizeIdempotencyKey(req.body?.idempotency_key, req.get('Idempotency-Key'));
    const result = createPayment(req.businessId, req.user.id, req.body, idempotencyKey);
    if (result.idempotent_replay) return res.status(200).json({ ...result });
    emitToRoom(req.businessId, 'order:updated', { order: result.order });
    res.status(201).json(result);
  } catch (err) {
    console.error('Payment error:', err);
    if (err.status === 409) return res.status(409).json({ error: err.message });
    if (err.isNotFound) return res.status(404).json({ error: err.message });
    if (err.isBadRequest || err.status === 400) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/payments/split
router.post('/split', authorize('admin', 'cashier'), validate(createSplitPaymentSchema), (req, res) => {
  try {
    const idempotencyKey = normalizeIdempotencyKey(req.body?.idempotency_key, req.get('Idempotency-Key'));
    const result = createSplitPayment(req.businessId, req.user.id, req.body, idempotencyKey);
    if (result.idempotent_replay) return res.status(200).json({ ...result });
    emitToRoom(req.businessId, 'order:updated', { order: result.order });
    res.status(201).json(result);
  } catch (err) {
    console.error('Split payment error:', err);
    if (err.status === 409) return res.status(409).json({ error: err.message });
    if (err.isNotFound) return res.status(404).json({ error: err.message });
    if (err.isBadRequest || err.status === 400) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/payments/summary
router.get('/summary', authorize('admin', 'cashier'), (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    const from = date_from || new Date().toISOString().slice(0, 10);
    const to = date_to || from;
    const [startAt, endAt] = rangeBounds(from, to);

    const summary = db.prepare(`
      SELECT payment_type, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
      FROM payments WHERE business_id = ? AND created_at >= ? AND created_at < ?
      GROUP BY payment_type
    `).all(req.businessId, startAt, endAt);

    const totalRevenue = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM payments
      WHERE business_id = ? AND created_at >= ? AND created_at < ?
    `).get(req.businessId, startAt, endAt);

    const orderCount = db.prepare(`
      SELECT COUNT(*) as count FROM orders
      WHERE business_id = ? AND status = 'closed' AND closed_at >= ? AND closed_at < ?
    `).get(req.businessId, startAt, endAt);

    res.json({
      summary,
      totalRevenue: totalRevenue.total,
      orderCount: orderCount.count,
      avgOrderValue: orderCount.count > 0 ? totalRevenue.total / orderCount.count : 0,
    });
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

export default router;
