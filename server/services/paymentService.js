import db from '../config/database.js';
import { genId, auditLog } from '../utils/helpers.js';
import { enqueueReceiptJobForClosedOrder, processPendingJobsSync } from './printJobs.js';
import { AUTO_PRINT_EVENTS } from './printerAutoPrintPolicy.js';
import { assertPeriodOpenForMutation } from './periodCloseService.js';
import { recordEntityMutation } from './entityMutationService.js';
import { toCents } from '../utils/money.js';

export const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function rangeBounds(from, to) {
  return [`${from} 00:00:00`, `${addDays(to, 1)} 00:00:00`];
}

export function normalizeIdempotencyKey(bodyKey, headerKey) {
  const key = bodyKey || headerKey;
  if (key == null) return null;
  const normalized = String(key).trim();
  return normalized ? normalized.slice(0, 128) : null;
}

export function findExistingPaymentByKey(businessId, orderId, idempotencyKey) {
  if (!idempotencyKey) return null;
  return db.prepare(
    `SELECT * FROM payments WHERE business_id = ? AND order_id = ? AND idempotency_key = ?`,
  ).get(businessId, orderId, idempotencyKey);
}

export function buildPaymentOrderResponse(orderId) {
  const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  updatedOrder.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  return { updatedOrder };
}

export function activePayableItems(orderId) {
  return db.prepare(`
    SELECT * FROM order_items
    WHERE order_id = ? AND status != 'cancelled' AND COALESCE(is_comped, 0) = 0
    ORDER BY created_at
  `).all(orderId);
}

export function paymentTotals(orderId) {
  const paid = db.prepare(
    `SELECT COALESCE(SUM(amount), 0) AS total FROM payments WHERE order_id = ?`,
  ).get(orderId);
  const allocatedPayments = db.prepare(
    `SELECT COUNT(DISTINCT payment_id) AS count FROM payment_allocations WHERE order_id = ?`,
  ).get(orderId);
  const payments = db.prepare(`SELECT COUNT(*) AS count FROM payments WHERE order_id = ?`).get(orderId);
  return {
    paid: round2(paid?.total || 0),
    paymentCount: Number(payments?.count) || 0,
    allocatedPaymentCount: Number(allocatedPayments?.count) || 0,
  };
}

export function itemPricing(order, items) {
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
    prices.set(item.id, { unit_price_snapshot: netUnit, total_quantity: qty });
  }
  return prices;
}

export function allocationQuantityMap(orderId) {
  const rows = db.prepare(`
    SELECT order_item_id, COALESCE(SUM(quantity), 0) AS paid_quantity
    FROM payment_allocations WHERE order_id = ? GROUP BY order_item_id
  `).all(orderId);
  return new Map(rows.map((row) => [row.order_item_id, Number(row.paid_quantity) || 0]));
}

export function buildSplitState(orderId, businessId) {
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
    WHERE pa.order_id = ? ORDER BY pa.created_at, pa.id
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

export function closeOrderAndTableIfPaid(order, businessId, userId) {
  const totalPaid = db.prepare(
    'SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE order_id = ?',
  ).get(order.id);
  const current = db.prepare(
    'SELECT id, business_id, status, grand_total, table_id, customer_id FROM orders WHERE id = ? AND business_id = ?',
  ).get(order.id, businessId);
  if (!current) return false;
  if (current.status === 'closed') return true;
  if (current.status === 'cancelled') return false;
  if (round2(totalPaid.total || 0) + 0.02 < round2(current?.grand_total || 0)) return false;

  db.prepare(
    "UPDATE orders SET status = 'closed', closed_at = datetime('now'), updated_by = ? WHERE id = ? AND business_id = ?",
  ).run(userId, order.id, businessId);

  if (current.table_id) {
    db.prepare(
      "UPDATE tables SET status = 'empty', current_order_id = NULL, guest_count = 0, updated_at = datetime('now') WHERE id = ? AND business_id = ? AND current_order_id = ?",
    ).run(current.table_id, businessId, order.id);
  }
  if (current.customer_id) {
    db.prepare(
      "UPDATE customers SET total_orders = total_orders + 1, last_order_at = datetime('now') WHERE id = ? AND business_id = ?",
    ).run(current.customer_id, businessId);
  }
  return true;
}

// ---------------------------------------------------------------------------
// Domain operations
// ---------------------------------------------------------------------------

export function createPayment(businessId, userId, paymentData, idempotencyKey, auditContext = {}) {
  const { order_id, payment_type, amount, tip_amount, cash_received, note, close_order, print_receipt, print_printer_id } = paymentData;
  const tipAmount = round2(tip_amount || 0);

  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND business_id = ?').get(order_id, businessId);
  if (!order) {
    const err = new Error('Sipariş bulunamadı');
    err.isNotFound = true;
    throw err;
  }

  if (print_printer_id && (print_receipt || close_order)) {
    const forcedPrinter = db.prepare(
      `SELECT id, type, is_active FROM printers WHERE id = ? AND business_id = ?`,
    ).get(print_printer_id, businessId);
    if (!forcedPrinter || !forcedPrinter.is_active) {
      const err = new Error('Seçilen yazıcı aktif değil veya bulunamadı');
      err.isBadRequest = true;
      throw err;
    }
    if (forcedPrinter.type !== 'receipt') {
      const err = new Error('Fiş için yalnız müşteri fişi yazıcısı seçilebilir');
      err.isBadRequest = true;
      throw err;
    }
  }

  const existingPayment = findExistingPaymentByKey(businessId, order_id, idempotencyKey);
  if (existingPayment) {
    const { updatedOrder } = buildPaymentOrderResponse(order_id);
    return { payment: existingPayment, order: updatedOrder, idempotent_replay: true };
  }

  if (order.status === 'closed' || order.status === 'cancelled') {
    const err = new Error('Bu siparişe ödeme eklenemez');
    err.isBadRequest = true;
    throw err;
  }
  assertPeriodOpenForMutation(businessId, new Date().toISOString().slice(0, 10));

  const paymentId = genId();
  const cashIn = cash_received != null ? cash_received : amount + tipAmount;
  const cashDue = round2(amount + tipAmount);
  const changeAmount = payment_type === 'cash' ? Math.max(0, round2(cashIn - cashDue)) : 0;
  let closed = false;

  db.transaction(() => {
    const totalsBefore = paymentTotals(order_id);
    const remainingTotal = round2(Math.max(0, Number(order.grand_total || 0) - totalsBefore.paid));
    if (remainingTotal <= 0.02) {
      const err = new Error('Sipariş için kalan ödeme bulunmuyor');
      err.status = 400;
      throw err;
    }
    if (amount > remainingTotal + 0.02) {
      const err = new Error('Ödeme tutarı kalan bakiyeyi aşıyor');
      err.status = 400;
      throw err;
    }
    if (payment_type === 'cash' && cashIn + 0.02 < cashDue) {
      const err = new Error('Alınan nakit tutarı ödeme tutarından düşük olamaz');
      err.status = 400;
      throw err;
    }
    db.prepare(`INSERT INTO payments (
      id, business_id, order_id, payment_type, amount, cash_received, change_amount,
      amount_cents, change_cents, tip_cents, note,
      idempotency_key, source, tip_amount, created_by
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual', ?, ?)`).run(
      paymentId, businessId, order_id, payment_type, amount, cashIn, changeAmount,
      toCents(amount), toCents(changeAmount), toCents(tipAmount),
      note || null, idempotencyKey, tipAmount, userId,
    );
    const insertedPayment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
    recordEntityMutation({
      businessId,
      entityTable: 'payments',
      entityId: paymentId,
      action: 'create',
      after: insertedPayment,
      actorUserId: userId,
      reason: note || null,
      requestId: auditContext.requestId || null,
      source: 'api.payments.create',
    });
    if (tipAmount > 0) {
      db.prepare(`
        INSERT INTO tips (id, business_id, order_id, payment_id, amount, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(genId(), businessId, order_id, paymentId, tipAmount, userId);
    }
    if (close_order) {
      closed = closeOrderAndTableIfPaid(order, businessId, userId);
      if (!closed) {
        const err = new Error('Sipariş tamamen ödenmeden masa kapatılamaz');
        err.status = 400;
        throw err;
      }
    }
  })();

  auditLog(businessId, userId, 'payment_received', 'payment', paymentId, { payment_type, amount, tip_amount: tipAmount });

  const payment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
  const { updatedOrder } = buildPaymentOrderResponse(order_id);

  if (print_receipt || closed) {
    let attempted = false;
    if (print_receipt) {
      attempted = true;
      enqueueReceiptJobForClosedOrder(businessId, order_id, userId, {
        forcedPrinterId: print_printer_id || null,
        applyAutoPrintPolicy: true,
        eventType: AUTO_PRINT_EVENTS.RECEIPT_PAYMENT_COMPLETE,
      });
    }
    if (closed) {
      attempted = true;
      enqueueReceiptJobForClosedOrder(businessId, order_id, userId, {
        forcedPrinterId: print_printer_id || null,
        applyAutoPrintPolicy: true,
        eventType: order.order_type === 'takeaway'
          ? AUTO_PRINT_EVENTS.RECEIPT_TAKEAWAY_COMPLETE
          : AUTO_PRINT_EVENTS.RECEIPT_TABLE_CLOSE,
      });
    }
    if (attempted) processPendingJobsSync(businessId, userId);
  }

  return { payment, order: updatedOrder };
}

export function createSplitPayment(businessId, userId, paymentData, idempotencyKey, auditContext = {}) {
  const { order_id, payment_type, tip_amount, cash_received, payer_no, payer_label, note, allocations } = paymentData;
  const tipAmount = round2(tip_amount || 0);

  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND business_id = ?').get(order_id, businessId);
  if (!order) {
    const err = new Error('Sipariş bulunamadı');
    err.isNotFound = true;
    throw err;
  }

  const existingPayment = findExistingPaymentByKey(businessId, order_id, idempotencyKey);
  if (existingPayment) {
    const { updatedOrder } = buildPaymentOrderResponse(order_id);
    return {
      payment: existingPayment,
      order: updatedOrder,
      split: buildSplitState(order.id, businessId),
      idempotent_replay: true,
    };
  }

  if (order.status === 'closed' || order.status === 'cancelled') {
    const err = new Error('Bu siparişe ödeme eklenemez');
    err.isBadRequest = true;
    throw err;
  }
  assertPeriodOpenForMutation(businessId, new Date().toISOString().slice(0, 10));

  const paymentId = genId();
  let createdPayment = null;

  db.transaction(() => {
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
        order_item_id: itemId, quantity,
        unit_price_snapshot: pricing.unit_price_snapshot, line_total: lineTotal,
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

    const cashDue = round2(amount + tipAmount);
    const cashIn = cash_received != null ? Number(cash_received) : cashDue;
    if (payment_type === 'cash' && cashIn + 0.02 < cashDue) {
      const err = new Error('Alınan nakit tutarı ödeme tutarından düşük olamaz');
      err.status = 400;
      throw err;
    }
    const changeAmount = payment_type === 'cash' ? Math.max(0, round2(cashIn - cashDue)) : 0;
    const payerNo = payer_no != null ? Number(payer_no) : null;
    const payerLabel = payer_label || (payerNo ? `Kişi ${payerNo}` : null);

    db.prepare(`INSERT INTO payments (
      id, business_id, order_id, payment_type, payment_scope, payer_no, payer_label,
      amount, cash_received, change_amount, amount_cents, change_cents, tip_cents,
      note, idempotency_key, source, tip_amount, created_by
    ) VALUES (?, ?, ?, ?, 'split_item', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'manual_split', ?, ?)`).run(
      paymentId, businessId, order.id, payment_type,
      payerNo, payerLabel, amount, cashIn, changeAmount,
      toCents(amount), toCents(changeAmount), toCents(tipAmount),
      note || null, idempotencyKey, tipAmount, userId,
    );
    if (tipAmount > 0) {
      db.prepare(`
        INSERT INTO tips (id, business_id, order_id, payment_id, amount, created_by)
        VALUES (?, ?, ?, ?, ?, ?)
      `).run(genId(), businessId, order.id, paymentId, tipAmount, userId);
    }

    const insertAllocation = db.prepare(`INSERT INTO payment_allocations (
      id, business_id, payment_id, order_id, order_item_id, quantity,
      unit_price_snapshot, line_total, payer_no, payer_label
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    for (const row of allocationRows) {
      insertAllocation.run(
        genId(), businessId, paymentId, order.id,
        row.order_item_id, row.quantity,
        row.unit_price_snapshot, row.line_total,
        payerNo, payerLabel,
      );
    }

    createdPayment = db.prepare('SELECT * FROM payments WHERE id = ?').get(paymentId);
    recordEntityMutation({
      businessId,
      entityTable: 'payments',
      entityId: paymentId,
      action: 'create',
      after: createdPayment,
      actorUserId: userId,
      reason: note || null,
      requestId: auditContext.requestId || null,
      source: 'api.payments.split',
    });
  })();

  auditLog(businessId, userId, 'split_payment_received', 'payment', paymentId, {
    payment_type, amount: createdPayment?.amount, tip_amount: tipAmount, payer_no: payer_no || null,
  });

  const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(order.id);
  updatedOrder.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);

  return {
    payment: createdPayment,
    order: updatedOrder,
    split: buildSplitState(order.id, businessId),
  };
}
