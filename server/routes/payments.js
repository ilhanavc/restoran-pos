import { Router } from 'express';
import { z } from 'zod';
import db from '../config/database.js';
import { authenticate, businessScope, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { genId, auditLog } from '../utils/helpers.js';
import { enqueueReceiptJobForClosedOrder, processPendingJobsSync } from '../services/printJobs.js';

const router = Router();
router.use(authenticate, businessScope);

const createPaymentSchema = {
  body: z.object({
    order_id: z.string().min(1, 'Sipariş kimliği gerekli'),
    payment_type: z.enum(['cash', 'card', 'mixed', 'other'], {
      errorMap: () => ({ message: 'Geçerli ödeme tipi: cash, card, mixed, other' }),
    }),
    amount: z.number().positive('Tutar sıfırdan büyük olmalıdır'),
    cash_received: z.number().min(0).optional().nullable(),
    note: z.string().max(500).optional().nullable(),
  }),
};

// POST /api/payments
router.post('/', authorize('admin', 'cashier'), validate(createPaymentSchema), (req, res) => {
  try {
    const { order_id, payment_type, amount, cash_received, note } = req.body;
    const amt = amount; // Zod already validated and coerced

    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND business_id = ?').get(order_id, req.businessId);
    if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });
    if (order.status === 'closed' || order.status === 'cancelled') {
      return res.status(400).json({ error: 'Bu siparişe ödeme eklenemez' });
    }

    const paymentId = genId();
    const cashIn = cash_received != null ? cash_received : amt;
    const changeAmount = payment_type === 'cash' ? Math.max(0, cashIn - amt) : 0;

    const txn = db.transaction(() => {
      db.prepare(`INSERT INTO payments (id, business_id, order_id, payment_type, amount, cash_received, change_amount, note, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        paymentId, req.businessId, order_id, payment_type, amt, cashIn, changeAmount, note || null, req.user.id
      );

      const totalPaid = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE order_id = ?').get(order_id);
      const current = db.prepare('SELECT grand_total FROM orders WHERE id = ?').get(order_id);
      if (totalPaid.total >= current.grand_total) {
        db.prepare("UPDATE orders SET status = 'closed', closed_at = datetime('now'), updated_by = ? WHERE id = ?")
          .run(req.user.id, order_id);
        
        // Free the table
        if (order.table_id) {
          db.prepare("UPDATE tables SET status = 'empty', current_order_id = NULL, guest_count = 0, updated_at = datetime('now') WHERE id = ?")
            .run(order.table_id);
        }

        // Update customer stats
        if (order.customer_id) {
          db.prepare("UPDATE customers SET total_orders = total_orders + 1, last_order_at = datetime('now') WHERE id = ?")
            .run(order.customer_id);
        }
      }
    });
    txn();

    auditLog(req.businessId, req.user.id, 'payment_received', 'payment', paymentId, { payment_type, amount });

    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
    const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(order_id);
    if (updatedOrder.status === 'closed') {
      enqueueReceiptJobForClosedOrder(req.businessId, order_id, req.user.id);
      processPendingJobsSync(req.businessId, req.user.id);
    }

    res.status(201).json({ payment, order: updatedOrder });
  } catch (err) {
    console.error('Payment error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/payments/summary
router.get('/summary', authorize('admin', 'cashier'), (req, res) => {
  try {
    const { date_from, date_to } = req.query;
    const from = date_from || new Date().toISOString().slice(0, 10);
    const to = date_to || from;

    const summary = db.prepare(`
      SELECT payment_type, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
      FROM payments WHERE business_id = ? AND date(created_at) BETWEEN ? AND ?
      GROUP BY payment_type
    `).all(req.businessId, from, to);

    const totalRevenue = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM payments 
      WHERE business_id = ? AND date(created_at) BETWEEN ? AND ?
    `).get(req.businessId, from, to);

    const orderCount = db.prepare(`
      SELECT COUNT(*) as count FROM orders 
      WHERE business_id = ? AND status = 'closed' AND date(closed_at) BETWEEN ? AND ?
    `).get(req.businessId, from, to);

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
