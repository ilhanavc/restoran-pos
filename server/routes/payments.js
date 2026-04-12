import { Router } from 'express';
import { z } from 'zod';
import db from '../config/database.js';
import { authenticate, businessScope, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { genId, auditLog } from '../utils/helpers.js';
import { enqueueReceiptJobForClosedOrder, processPendingJobsSync } from '../services/printJobs.js';
import { emitToRoom } from '../socket.js';

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

const createSplitPaymentSchema = {
  body: z.object({
    order_id: z.string().min(1, 'Sipariş kimliği gerekli'),
    payment_type: z.enum(['cash', 'card', 'other'], {
      errorMap: () => ({ message: 'Geçerli ödeme tipi: cash, card, other' }),
    }),
    cash_received: z.number().min(0).optional().nullable(),
    payer_no: z.number().int().positive().max(999).optional().nullable(),
    payer_label: z.string().max(80).optional().nullable(),
    note: z.string().max(500).optional().nullable(),
    allocations: z.array(z.object({
      order_item_id: z.string().min(1),
      quantity: z.number().int().positive().max(999),
    })).min(1, 'En az bir kalem seçilmeli'),
  }),
};

const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

function activePayableItems(orderId) {
  return db.prepare(`
    SELECT *
    FROM order_items
    WHERE order_id = ?
      AND status != 'cancelled'
      AND COALESCE(is_comped, 0) = 0
    ORDER BY created_at
  `).all(orderId);
}

function paymentTotals(orderId) {
  const paid = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM payments
    WHERE order_id = ?
  `).get(orderId);

  const allocatedPayments = db.prepare(`
    SELECT COUNT(DISTINCT payment_id) AS count
    FROM payment_allocations
    WHERE order_id = ?
  `).get(orderId);

  const payments = db.prepare(`
    SELECT COUNT(*) AS count
    FROM payments
    WHERE order_id = ?
  `).get(orderId);

  return {
    paid: round2(paid?.total || 0),
    paymentCount: Number(payments?.count) || 0,
    allocatedPaymentCount: Number(allocatedPayments?.count) || 0,
  };
}

function itemPricing(order, items) {
  const payableSubtotal = items.reduce((sum, item) => {
    return sum + Math.max(0, Number(item.unit_price || 0) * Number(item.quantity || 0) - Number(item.discount_amount || 0));
  }, 0);
  const grandTotal = Math.max(0, Number(order.grand_total) || 0);
  const discountFactor = payableSubtotal > 0 ? grandTotal / payableSubtotal : 1;
  const prices = new Map();

  for (const item of items) {
    const qty = Number(item.quantity || 0);
    const grossLine = Math.max(0, Number(item.unit_price || 0) * qty - Number(item.discount_amount || 0));
    const netUnit = qty > 0 ? round2((grossLine / qty) * discountFactor) : 0;
    prices.set(item.id, {
      unit_price_snapshot: netUnit,
      total_quantity: qty,
    });
  }

  return prices;
}

function allocationQuantityMap(orderId) {
  const rows = db.prepare(`
    SELECT order_item_id, COALESCE(SUM(quantity), 0) AS paid_quantity
    FROM payment_allocations
    WHERE order_id = ?
    GROUP BY order_item_id
  `).all(orderId);
  return new Map(rows.map((row) => [row.order_item_id, Number(row.paid_quantity) || 0]));
}

function buildSplitState(orderId, businessId) {
  const order = db.prepare(`
    SELECT o.*, t.name AS table_name, c.full_name AS customer_name, u.full_name AS user_name
    FROM orders o
    LEFT JOIN tables t ON o.table_id = t.id
    LEFT JOIN customers c ON o.customer_id = c.id
    LEFT JOIN users u ON o.user_id = u.id
    WHERE o.id = ? AND o.business_id = ?
  `).get(orderId, businessId);
  if (!order) return null;

  const items = activePayableItems(order.id);
  const paidQty = allocationQuantityMap(order.id);
  const prices = itemPricing(order, items);
  const totals = paymentTotals(order.id);
  const remainingTotal = round2(Math.max(0, Number(order.grand_total || 0) - totals.paid));
  const allocations = db.prepare(`
    SELECT pa.*, p.payment_type, p.amount, p.created_at AS payment_created_at
    FROM payment_allocations pa
    JOIN payments p ON p.id = pa.payment_id
    WHERE pa.order_id = ?
    ORDER BY pa.created_at, pa.id
  `).all(order.id);

  return {
    order,
    items: items.map((item) => {
      const pricing = prices.get(item.id) || { unit_price_snapshot: Number(item.unit_price) || 0, total_quantity: Number(item.quantity) || 0 };
      const paid_quantity = paidQty.get(item.id) || 0;
      const remaining_quantity = Math.max(0, pricing.total_quantity - paid_quantity);
      return {
        ...item,
        total_quantity: pricing.total_quantity,
        paid_quantity,
        remaining_quantity,
        unit_price_snapshot: pricing.unit_price_snapshot,
        remaining_total: round2(remaining_quantity * pricing.unit_price_snapshot),
      };
    }),
    payments: db.prepare(`SELECT * FROM payments WHERE order_id = ? ORDER BY created_at`).all(order.id),
    allocations,
    totals: {
      order_total: round2(order.grand_total || 0),
      paid_total: totals.paid,
      remaining_total: remainingTotal,
      has_unallocated_payments: totals.paymentCount > totals.allocatedPaymentCount,
    },
  };
}

function closeOrderIfPaid(order, businessId, userId) {
  const totalPaid = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE order_id = ?').get(order.id);
  const current = db.prepare('SELECT grand_total FROM orders WHERE id = ?').get(order.id);
  if (round2(totalPaid.total || 0) + 0.02 < round2(current?.grand_total || 0)) return false;

  db.prepare("UPDATE orders SET status = 'closed', closed_at = datetime('now'), updated_by = ? WHERE id = ?")
    .run(userId, order.id);

  if (order.table_id) {
    db.prepare("UPDATE tables SET status = 'empty', current_order_id = NULL, guest_count = 0, updated_at = datetime('now') WHERE id = ?")
      .run(order.table_id);
  }

  if (order.customer_id) {
    db.prepare("UPDATE customers SET total_orders = total_orders + 1, last_order_at = datetime('now') WHERE id = ?")
      .run(order.customer_id);
  }

  return true;
}

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

      closeOrderIfPaid(order, req.businessId, req.user.id);
    });
    txn();

    auditLog(req.businessId, req.user.id, 'payment_received', 'payment', paymentId, { payment_type, amount });

    const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
    const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(order_id);
    updatedOrder.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order_id);
    emitToRoom(req.businessId, 'order:updated', { order: updatedOrder });
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

// POST /api/payments/split
router.post('/split', authorize('admin', 'cashier'), validate(createSplitPaymentSchema), (req, res) => {
  try {
    const { order_id, payment_type, cash_received, payer_no, payer_label, note, allocations } = req.body;
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND business_id = ?').get(order_id, req.businessId);
    if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });
    if (order.status === 'closed' || order.status === 'cancelled') {
      return res.status(400).json({ error: 'Bu siparişe ödeme eklenemez' });
    }

    const paymentId = genId();
    let createdPayment = null;
    let closed = false;

    const txn = db.transaction(() => {
      const totalsBefore = paymentTotals(order.id);
      if (totalsBefore.paymentCount > totalsBefore.allocatedPaymentCount) {
        const err = new Error('Bu siparişte kalem bazlı olmayan ödeme var; ayrı ayrı ödeme güvenli şekilde başlatılamaz');
        err.status = 400;
        throw err;
      }

      const items = activePayableItems(order.id);
      if (!items.length) {
        const err = new Error('Ödenecek ürün bulunamadı');
        err.status = 400;
        throw err;
      }

      const itemMap = new Map(items.map((item) => [item.id, item]));
      const paidQty = allocationQuantityMap(order.id);
      const prices = itemPricing(order, items);
      const requested = new Map();
      for (const allocation of allocations) {
        requested.set(
          allocation.order_item_id,
          (requested.get(allocation.order_item_id) || 0) + Number(allocation.quantity || 0),
        );
      }

      const allocationRows = [];
      let amount = 0;
      for (const [itemId, quantity] of requested.entries()) {
        const item = itemMap.get(itemId);
        if (!item) {
          const err = new Error('Seçilen ürün bu siparişte bulunamadı veya ödenemez');
          err.status = 400;
          throw err;
        }
        const pricing = prices.get(itemId);
        const remainingQty = Math.max(0, pricing.total_quantity - (paidQty.get(itemId) || 0));
        if (quantity <= 0 || quantity > remainingQty) {
          const err = new Error(`${item.product_name} için kalan adet yetersiz`);
          err.status = 400;
          throw err;
        }
        const lineTotal = round2(pricing.unit_price_snapshot * quantity);
        amount = round2(amount + lineTotal);
        allocationRows.push({
          order_item_id: itemId,
          quantity,
          unit_price_snapshot: pricing.unit_price_snapshot,
          line_total: lineTotal,
        });
      }

      const remainingTotal = round2(Math.max(0, Number(order.grand_total || 0) - totalsBefore.paid));
      const allRemainingSelected = items.every((item) => {
        const pricing = prices.get(item.id);
        const remainingQty = Math.max(0, pricing.total_quantity - (paidQty.get(item.id) || 0));
        return (requested.get(item.id) || 0) === remainingQty;
      });
      if (allRemainingSelected) amount = remainingTotal;
      if (amount <= 0) {
        const err = new Error('Ödeme tutarı hesaplanamadı');
        err.status = 400;
        throw err;
      }
      if (amount > remainingTotal + 0.02) {
        const err = new Error('Ödeme tutarı kalan bakiyeyi aşıyor');
        err.status = 400;
        throw err;
      }

      const cashIn = cash_received != null ? Number(cash_received) : amount;
      if (payment_type === 'cash' && cashIn + 0.02 < amount) {
        const err = new Error('Alınan nakit tutarı ödeme tutarından düşük olamaz');
        err.status = 400;
        throw err;
      }
      const changeAmount = payment_type === 'cash' ? Math.max(0, round2(cashIn - amount)) : 0;
      const payerNo = payer_no != null ? Number(payer_no) : null;
      const payerLabel = payer_label || (payerNo ? `Kişi ${payerNo}` : null);

      db.prepare(`INSERT INTO payments (
        id, business_id, order_id, payment_type, payment_scope, payer_no, payer_label,
        amount, cash_received, change_amount, note, created_by
      ) VALUES (?, ?, ?, ?, 'split_item', ?, ?, ?, ?, ?, ?, ?)`).run(
        paymentId,
        req.businessId,
        order.id,
        payment_type,
        payerNo,
        payerLabel,
        amount,
        cashIn,
        changeAmount,
        note || null,
        req.user.id,
      );

      const insertAllocation = db.prepare(`INSERT INTO payment_allocations (
        id, business_id, payment_id, order_id, order_item_id, quantity,
        unit_price_snapshot, line_total, payer_no, payer_label
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      for (const row of allocationRows) {
        insertAllocation.run(
          genId(),
          req.businessId,
          paymentId,
          order.id,
          row.order_item_id,
          row.quantity,
          row.unit_price_snapshot,
          row.line_total,
          payerNo,
          payerLabel,
        );
      }

      closed = closeOrderIfPaid(order, req.businessId, req.user.id);
      createdPayment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
    });

    txn();

    auditLog(req.businessId, req.user.id, 'split_payment_received', 'payment', paymentId, {
      payment_type,
      amount: createdPayment?.amount,
      payer_no: payer_no || null,
    });

    if (closed) {
      enqueueReceiptJobForClosedOrder(req.businessId, order.id, req.user.id);
      processPendingJobsSync(req.businessId, req.user.id);
    }

    const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
    updatedOrder.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    emitToRoom(req.businessId, 'order:updated', { order: updatedOrder });
    res.status(201).json({
      payment: createdPayment,
      order: updatedOrder,
      split: buildSplitState(order.id, req.businessId),
    });
  } catch (err) {
    console.error('Split payment error:', err);
    if (err.status === 400) return res.status(400).json({ error: err.message });
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
