import db from '../config/database.js';
import { genId, auditLog } from '../utils/helpers.js';

export const round2 = (value) => Math.round((Number(value) || 0) * 100) / 100;

export function isValidPeriodDate(date) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(date || ''))) return false;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date;
}

export function normalizePeriodDate(date) {
  const targetDate = date || new Date().toISOString().slice(0, 10);
  if (!isValidPeriodDate(targetDate)) {
    const err = new Error('Geçersiz tarih');
    err.status = 400;
    err.isBadRequest = true;
    throw err;
  }
  return targetDate;
}

export function addDays(date, days) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function dayBounds(date) {
  return [`${date} 00:00:00`, `${addDays(date, 1)} 00:00:00`];
}

function dateFromTimestampOrDate(timestampOrDate) {
  if (!timestampOrDate) return new Date().toISOString().slice(0, 10);
  const text = String(timestampOrDate);
  if (/^\d{4}-\d{2}-\d{2}$/.test(text)) return text;
  if (/^\d{4}-\d{2}-\d{2}[ T]/.test(text)) return text.slice(0, 10);
  const parsed = new Date(text);
  if (Number.isNaN(parsed.getTime())) return new Date().toISOString().slice(0, 10);
  return parsed.toISOString().slice(0, 10);
}

function mapPaymentType(type) {
  if (['cash', 'card', 'mixed', 'other'].includes(type)) return type;
  return 'other';
}

function rowsToTotals(rows, keyName) {
  return rows.map((row) => ({
    [keyName]: row[keyName],
    count: Number(row.count) || 0,
    total: round2(row.total),
  }));
}

export function getPeriodStatus(businessId, date) {
  const periodDate = normalizePeriodDate(date);
  const row = db.prepare(`
    SELECT pc.*, u.full_name AS closed_by_name
    FROM period_closes pc
    LEFT JOIN users u ON u.id = pc.closed_by
    WHERE pc.business_id = ? AND pc.period_date = ?
  `).get(businessId, periodDate);
  return {
    date: periodDate,
    status: row?.status === 'closed' ? 'closed' : 'open',
    period: row || null,
  };
}

export function buildPeriodReport(businessId, date) {
  const periodDate = normalizePeriodDate(date);
  const [startAt, endAt] = dayBounds(periodDate);

  const payments = db.prepare(`
    SELECT p.*, COALESCE(u.full_name, 'Bilinmeyen') AS cashier_name
    FROM payments p
    LEFT JOIN users u ON u.id = p.created_by
    WHERE p.business_id = ? AND p.created_at >= ? AND p.created_at < ?
    ORDER BY p.created_at, p.id
  `).all(businessId, startAt, endAt);

  const paymentBuckets = new Map();
  const cashierBuckets = new Map();
  let totalRevenue = 0;
  for (const payment of payments) {
    const amount = Number(payment.amount) || 0;
    totalRevenue = round2(totalRevenue + amount);

    const paymentType = payment.source === 'system_takeaway_delivery'
      ? 'system_takeaway_delivery'
      : mapPaymentType(payment.payment_type);
    const pBucket = paymentBuckets.get(paymentType) || { payment_type: paymentType, count: 0, total: 0 };
    pBucket.count += 1;
    pBucket.total = round2(pBucket.total + amount);
    paymentBuckets.set(paymentType, pBucket);

    const cashierId = payment.created_by || 'unknown';
    const cBucket = cashierBuckets.get(cashierId) || {
      user_id: payment.created_by || null,
      full_name: payment.cashier_name || 'Bilinmeyen',
      payment_count: 0,
      total_collected: 0,
    };
    cBucket.payment_count += 1;
    cBucket.total_collected = round2(cBucket.total_collected + amount);
    cashierBuckets.set(cashierId, cBucket);
  }

  const orderStats = db.prepare(`
    SELECT
      COUNT(*) AS total_orders,
      COALESCE(SUM(CASE WHEN status = 'closed' THEN 1 ELSE 0 END), 0) AS closed_orders,
      COALESCE(SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END), 0) AS cancelled_orders,
      COALESCE(SUM(CASE WHEN status NOT IN ('closed','cancelled') THEN 1 ELSE 0 END), 0) AS open_orders,
      COALESCE(SUM(CASE WHEN order_type = 'dine_in' THEN 1 ELSE 0 END), 0) AS dine_in_count,
      COALESCE(SUM(CASE WHEN order_type = 'takeaway' THEN 1 ELSE 0 END), 0) AS takeaway_count,
      COALESCE(SUM(CASE WHEN status != 'cancelled' THEN grand_total ELSE 0 END), 0) AS gross_sales,
      COALESCE(SUM(CASE WHEN status != 'cancelled' THEN discount_amount ELSE 0 END), 0) AS total_discounts
    FROM orders
    WHERE business_id = ? AND created_at >= ? AND created_at < ?
  `).get(businessId, startAt, endAt);

  const closedOrders = db.prepare(`
    SELECT o.id, o.order_no, o.order_type, o.status, o.grand_total, o.discount_amount,
      o.created_at, o.closed_at,
      COALESCE(o.table_name_snapshot, t.name) AS table_name,
      COALESCE(o.customer_name_snapshot, c.full_name) AS customer_name,
      COALESCE(o.user_name_snapshot, u.full_name) AS user_name
    FROM orders o
    LEFT JOIN tables t ON t.id = o.table_id
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN users u ON u.id = o.user_id
    WHERE o.business_id = ? AND o.status = 'closed' AND o.closed_at >= ? AND o.closed_at < ?
    ORDER BY o.closed_at, o.id
  `).all(businessId, startAt, endAt);

  const cancelledOrders = db.prepare(`
    SELECT id, order_no, order_type, grand_total, created_at, updated_at
    FROM orders
    WHERE business_id = ? AND status = 'cancelled' AND created_at >= ? AND created_at < ?
    ORDER BY created_at, id
  `).all(businessId, startAt, endAt);

  const openOrders = db.prepare(`
    SELECT o.id, o.order_no, o.order_type, o.status, o.grand_total, o.created_at,
      COALESCE(o.table_name_snapshot, t.name) AS table_name,
      COALESCE(o.customer_name_snapshot, c.full_name) AS customer_name,
      COALESCE(o.user_name_snapshot, u.full_name) AS user_name
    FROM orders o
    LEFT JOIN tables t ON t.id = o.table_id
    LEFT JOIN customers c ON c.id = o.customer_id
    LEFT JOIN users u ON u.id = o.user_id
    WHERE o.business_id = ? AND o.created_at >= ? AND o.created_at < ?
      AND o.status NOT IN ('closed', 'cancelled')
    ORDER BY o.created_at, o.id
  `).all(businessId, startAt, endAt);

  const orderTypeBreakdown = rowsToTotals(db.prepare(`
    SELECT order_type, COUNT(*) AS count, COALESCE(SUM(grand_total), 0) AS total
    FROM orders
    WHERE business_id = ? AND created_at >= ? AND created_at < ? AND status != 'cancelled'
    GROUP BY order_type
    ORDER BY order_type
  `).all(businessId, startAt, endAt), 'order_type');

  const status = getPeriodStatus(businessId, periodDate);
  return {
    date: periodDate,
    period_status: status.status,
    closed_at: status.period?.closed_at || null,
    closed_by: status.period?.closed_by || null,
    opened_at: startAt,
    bounds: { start_at: startAt, end_at: endAt },
    summary: {
      total_revenue: round2(totalRevenue),
      payment_count: payments.length,
      closed_order_count: Number(orderStats.closed_orders) || 0,
      cancelled_order_count: Number(orderStats.cancelled_orders) || 0,
      open_order_count: Number(orderStats.open_orders) || 0,
      total_orders: Number(orderStats.total_orders) || 0,
      gross_sales: round2(orderStats.gross_sales),
      total_discounts: round2(orderStats.total_discounts),
      dine_in_count: Number(orderStats.dine_in_count) || 0,
      takeaway_count: Number(orderStats.takeaway_count) || 0,
    },
    payment_breakdown: Array.from(paymentBuckets.values()),
    cashier_breakdown: Array.from(cashierBuckets.values()),
    order_type_breakdown: orderTypeBreakdown,
    closed_orders: closedOrders,
    cancelled_orders: cancelledOrders,
    open_orders: openOrders,
  };
}

export function closePeriod(businessId, branchId, userId, date, note) {
  const periodDate = normalizePeriodDate(date);
  const existing = getPeriodStatus(businessId, periodDate);
  if (existing.status === 'closed') {
    const err = new Error('Bu dönem zaten kapatılmış');
    err.status = 409;
    throw err;
  }

  const report = buildPeriodReport(businessId, periodDate);
  if (report.open_orders.length > 0) {
    const err = new Error('Açık adisyonlar kapatılmadan Z raporu alınamaz');
    err.status = 400;
    err.openOrders = report.open_orders;
    throw err;
  }

  const snapshotJson = JSON.stringify(report);
  const id = existing.period?.id || genId();
  db.transaction(() => {
    db.prepare(`
      INSERT INTO period_closes (
        id, business_id, branch_id, period_date, opened_at, closed_at, closed_by,
        status, x_snapshot_json, z_snapshot_json, note
      )
      VALUES (?, ?, ?, ?, ?, datetime('now'), ?, 'closed', ?, ?, ?)
      ON CONFLICT(business_id, period_date) DO UPDATE SET
        branch_id = excluded.branch_id,
        closed_at = datetime('now'),
        closed_by = excluded.closed_by,
        status = 'closed',
        x_snapshot_json = excluded.x_snapshot_json,
        z_snapshot_json = excluded.z_snapshot_json,
        note = excluded.note
      WHERE period_closes.status != 'closed'
    `).run(
      id, businessId, branchId || null, periodDate, report.opened_at, userId,
      snapshotJson, snapshotJson, note || null,
    );
  })();

  const closed = getPeriodStatus(businessId, periodDate);
  if (closed.status !== 'closed') {
    const err = new Error('Bu dönem zaten kapatılmış');
    err.status = 409;
    throw err;
  }

  auditLog(businessId, userId, 'period_z_close', 'period_close', closed.period.id, { period_date: periodDate });
  return { period: closed.period, report: { ...report, period_status: 'closed', closed_at: closed.period.closed_at } };
}

export function assertPeriodOpenForMutation(businessId, timestampOrDate) {
  const periodDate = normalizePeriodDate(dateFromTimestampOrDate(timestampOrDate));
  const closed = db.prepare(`
    SELECT id, closed_at FROM period_closes
    WHERE business_id = ? AND period_date = ? AND status = 'closed'
  `).get(businessId, periodDate);
  if (!closed) return;
  const err = new Error('Bu dönem kapatılmış; yeni sipariş veya ödeme eklenemez');
  err.status = 409;
  err.isBadRequest = true;
  throw err;
}
