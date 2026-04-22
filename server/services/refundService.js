import db from '../config/database.js';
import { genId, auditLog } from '../utils/helpers.js';
import { assertPeriodOpenForMutation } from './periodCloseService.js';
import { recordEntityMutation } from './entityMutationService.js';
import { toCents } from '../utils/money.js';
import { getStoreDate } from '../utils/time.js';

export const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

function badRequest(message) {
  const err = new Error(message);
  err.isBadRequest = true;
  err.status = 400;
  return err;
}

export function paymentRefundedTotal(paymentId) {
  const row = db.prepare(`
    SELECT COALESCE(SUM(amount), 0) AS total
    FROM refunds
    WHERE payment_id = ? AND status = 'completed'
  `).get(paymentId);
  return round2(row?.total || 0);
}

export function getRefundablePaymentsForOrder(businessId, orderId) {
  return db.prepare(`
    SELECT p.*, o.status AS order_status, o.order_no,
      COALESCE((SELECT SUM(r.amount) FROM refunds r WHERE r.payment_id = p.id AND r.status = 'completed'), 0) AS refunded_total
    FROM payments p
    JOIN orders o ON o.id = p.order_id AND o.business_id = p.business_id
    WHERE p.business_id = ? AND p.order_id = ?
    ORDER BY p.created_at, p.id
  `).all(businessId, orderId).map((payment) => ({
    ...payment,
    refunded_total: round2(payment.refunded_total),
    refundable_amount: round2(Math.max(0, Number(payment.amount || 0) - Number(payment.refunded_total || 0))),
  }));
}

function assertPaymentRefundable(payment, businessId, amount) {
  if (!payment || payment.business_id !== businessId) {
    const err = new Error('Ödeme bulunamadı');
    err.isNotFound = true;
    throw err;
  }
  if (payment.order_status === 'cancelled') throw badRequest('İptal sipariş için iade oluşturulamaz');

  assertPeriodOpenForMutation(businessId, getStoreDate());
  assertPeriodOpenForMutation(businessId, payment.created_at);

  const remaining = round2(Math.max(0, Number(payment.amount || 0) - paymentRefundedTotal(payment.id)));
  if (remaining <= 0) throw badRequest('Bu ödeme tamamen iade edilmiş');
  if (amount <= 0 || amount > remaining + 0.02) throw badRequest('İade tutarı kalan iade edilebilir tutarı aşıyor');
  return remaining;
}

export function createRefundForPayment(businessId, userId, { payment_id, amount, reason }, auditContext = {}) {
  const refundAmount = round2(amount);
  const payment = db.prepare(`
    SELECT p.*, o.status AS order_status
    FROM payments p
    JOIN orders o ON o.id = p.order_id AND o.business_id = p.business_id
    WHERE p.id = ? AND p.business_id = ?
  `).get(payment_id, businessId);
  assertPaymentRefundable(payment, businessId, refundAmount);

  const refundId = genId();
  db.transaction(() => {
    db.prepare(`
      INSERT INTO refunds (id, business_id, order_id, payment_id, amount, amount_cents, reason, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?)
    `).run(refundId, businessId, payment.order_id, payment.id, refundAmount, toCents(refundAmount), reason || null, userId);
    const insertedRefund = db.prepare('SELECT * FROM refunds WHERE id = ?').get(refundId);
    recordEntityMutation({
      businessId,
      entityTable: 'refunds',
      entityId: refundId,
      action: 'refund',
      after: insertedRefund,
      actorUserId: userId,
      reason: reason || null,
      requestId: auditContext.requestId || null,
      source: 'api.refunds.create',
    });
  })();

  auditLog(businessId, userId, 'refund_created', 'refund', refundId, {
    order_id: payment.order_id,
    payment_id: payment.id,
    amount: refundAmount,
  });
  return db.prepare('SELECT * FROM refunds WHERE id = ?').get(refundId);
}

export function createFullRefundForOrder(businessId, userId, orderId, reason, auditContext = {}) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND business_id = ?').get(orderId, businessId);
  if (!order) {
    const err = new Error('Sipariş bulunamadı');
    err.isNotFound = true;
    throw err;
  }
  if (order.status !== 'closed') throw badRequest('Yalnızca kapanmış siparişler iade edilebilir');

  const payments = getRefundablePaymentsForOrder(businessId, orderId);
  const refundablePayments = payments.filter((payment) => payment.refundable_amount > 0.02);
  if (!refundablePayments.length) throw badRequest('Bu sipariş için iade edilebilir ödeme bulunmuyor');

  assertPeriodOpenForMutation(businessId, getStoreDate());
  for (const payment of refundablePayments) {
    assertPeriodOpenForMutation(businessId, payment.created_at);
  }

  const refunds = db.transaction(() => {
    const created = [];
    const insert = db.prepare(`
      INSERT INTO refunds (id, business_id, order_id, payment_id, amount, amount_cents, reason, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, 'completed', ?)
    `);
    for (const payment of refundablePayments) {
      const refundId = genId();
      insert.run(
        refundId,
        businessId,
        orderId,
        payment.id,
        payment.refundable_amount,
        toCents(payment.refundable_amount),
        reason || 'Tam sipariş iadesi',
        userId,
      );
      const insertedRefund = db.prepare('SELECT * FROM refunds WHERE id = ?').get(refundId);
      recordEntityMutation({
        businessId,
        entityTable: 'refunds',
        entityId: refundId,
        action: 'refund',
        after: insertedRefund,
        actorUserId: userId,
        reason: reason || 'Tam sipariş iadesi',
        requestId: auditContext.requestId || null,
        source: 'api.refunds.full_order',
      });
      created.push(insertedRefund);
    }
    return created;
  })();

  const total = round2(refunds.reduce((sum, refund) => sum + Number(refund.amount || 0), 0));
  auditLog(businessId, userId, 'order_refund_created', 'order', orderId, {
    refund_count: refunds.length,
    amount: total,
  });

  return { order, refunds, total };
}
