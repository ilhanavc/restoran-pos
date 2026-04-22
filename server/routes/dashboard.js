import { Router } from 'express';
import db from '../config/database.js';
import { authenticate, businessScope, authorize } from '../middleware/auth.js';
import {
  addDaysToDateString,
  dayBoundsInStoreTime,
  getStoreDate,
  getStoreDateTime,
  getStoreTime,
  toSqliteUtcTimestamp,
  zonedDateTimeToUtc,
} from '../utils/time.js';

const router = Router();
router.use(authenticate, businessScope);

const paymentAmountCents = 'COALESCE(amount_cents, ROUND(amount * 100))';
const orderGrandTotalCents = 'COALESCE(grand_total_cents, ROUND(grand_total * 100))';

/**
 * GET /api/dashboard/live
 * Canlı operasyon şeridi için hızlı sayımlar (<50 ms hedefi).
 */
router.get('/live', authorize('admin', 'cashier', 'waiter'), (req, res) => {
  try {
    const today = getStoreDate();
    const [startAt, endAt] = dayBoundsInStoreTime(today);

    const occupiedTables = db.prepare(`
      SELECT COUNT(*) as cnt FROM tables
      WHERE business_id = ? AND status = 'occupied' AND is_active = 1
    `).get(req.businessId);

    const kitchenAgg = db.prepare(`
      SELECT
        COUNT(*) AS total,
        SUM(CASE WHEN (julianday('now') - julianday(oi.sent_to_kitchen_at)) * 24 * 60 >= 20 THEN 1 ELSE 0 END) AS red,
        SUM(CASE WHEN (julianday('now') - julianday(oi.sent_to_kitchen_at)) * 24 * 60 >= 10
                  AND (julianday('now') - julianday(oi.sent_to_kitchen_at)) * 24 * 60 < 20 THEN 1 ELSE 0 END) AS yellow
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.business_id = ?
        AND o.status NOT IN ('closed', 'cancelled')
        AND oi.status IN ('sent', 'preparing')
        AND oi.sent_to_kitchen_at IS NOT NULL
    `).get(req.businessId);

    const activeTakeaway = db.prepare(`
      SELECT COUNT(*) as cnt FROM orders
      WHERE business_id = ? AND order_type = 'takeaway'
        AND status NOT IN ('closed', 'cancelled')
    `).get(req.businessId);

    const unpaidOrders = db.prepare(`
      SELECT o.id,
        ${orderGrandTotalCents} AS grand_cents,
        COALESCE((SELECT SUM(${paymentAmountCents}) FROM payments p WHERE p.order_id = o.id), 0) AS paid_cents
      FROM orders o
      WHERE o.business_id = ?
        AND o.status NOT IN ('cancelled')
        AND o.created_at >= ? AND o.created_at < ?
    `).all(req.businessId, startAt, endAt);
    const unpaidCount = unpaidOrders.filter((r) => (r.grand_cents || 0) > (r.paid_cents || 0)).length;

    const activeWaiterCalls = db.prepare(`
      SELECT COUNT(*) as cnt FROM waiter_calls
      WHERE business_id = ? AND status = 'pending'
    `).get(req.businessId);

    res.json({
      asOf: getStoreDateTime(),
      occupiedTables: occupiedTables.cnt,
      kitchenInProgress: kitchenAgg.total || 0,
      kitchenOldYellow: kitchenAgg.yellow || 0,
      kitchenOldRed: kitchenAgg.red || 0,
      activeTakeaway: activeTakeaway.cnt,
      unpaidOrders: unpaidCount,
      waiterCalls: activeWaiterCalls.cnt,
    });
  } catch (err) {
    console.error('Dashboard live error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

/**
 * GET /api/dashboard/compare
 * Bugün şu ana kadar vs dün aynı saat vs geçen hafta aynı gün aynı saat.
 */
router.get('/compare', authorize('admin', 'cashier'), (req, res) => {
  try {
    const now = new Date();
    const today = getStoreDate(now);
    const currentTime = getStoreTime(now);
    const cutoff = `${today} ${currentTime}`;
    const yesterday = addDaysToDateString(today, -1);
    const lastWeek = addDaysToDateString(today, -7);

    function sliceFor(date) {
      const startAt = toSqliteUtcTimestamp(zonedDateTimeToUtc(date, '00:00:00'));
      const endAt = toSqliteUtcTimestamp(zonedDateTimeToUtc(date, currentTime));
      const rev = db.prepare(`
        SELECT COALESCE(SUM(${paymentAmountCents}), 0) / 100.0 AS total, COUNT(*) AS count
        FROM payments
        WHERE business_id = ? AND created_at >= ? AND created_at < ?
      `).get(req.businessId, startAt, endAt);
      const orders = db.prepare(`
        SELECT COUNT(*) AS count
        FROM orders
        WHERE business_id = ? AND created_at >= ? AND created_at < ? AND status != 'cancelled'
      `).get(req.businessId, startAt, endAt);
      return {
        revenue: Number(rev.total || 0),
        paymentCount: Number(rev.count || 0),
        orderCount: Number(orders.count || 0),
      };
    }

    res.json({
      cutoff,
      today: sliceFor(today),
      yesterday: sliceFor(yesterday),
      lastWeek: sliceFor(lastWeek),
    });
  } catch (err) {
    console.error('Dashboard compare error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

/**
 * GET /api/dashboard/alerts
 * Aksiyon gerektiren uyarılar — yalnızca tetiklenenler döner.
 */
router.get('/alerts', authorize('admin', 'cashier'), (req, res) => {
  try {
    const alerts = [];

    const lowStock = db.prepare(`
      SELECT COUNT(*) AS cnt FROM stock_items
      WHERE business_id = ? AND is_active = 1 AND min_quantity > 0 AND quantity <= min_quantity
    `).get(req.businessId);
    if ((lowStock?.cnt || 0) > 0) {
      alerts.push({
        id: 'low-stock',
        severity: 'warning',
        title: 'Stok uyarısı',
        message: `${lowStock.cnt} ürün kritik seviyede`,
        href: '/settings/stock',
      });
    }

    const failedPrint = db.prepare(`
      SELECT COUNT(*) AS cnt FROM print_jobs
      WHERE business_id = ? AND status = 'failed'
    `).get(req.businessId);
    if ((failedPrint?.cnt || 0) > 0) {
      alerts.push({
        id: 'print-failed',
        severity: 'danger',
        title: 'Yazıcı hatası',
        message: `${failedPrint.cnt} fiş basılamadı`,
        href: '/settings/bridge',
      });
    }

    const today = getStoreDate();
    const [startAt, endAt] = dayBoundsInStoreTime(today);
    const staleKitchen = db.prepare(`
      SELECT COUNT(*) AS cnt
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.business_id = ?
        AND o.status NOT IN ('closed', 'cancelled')
        AND oi.status IN ('sent', 'preparing')
        AND oi.sent_to_kitchen_at IS NOT NULL
        AND (julianday('now') - julianday(oi.sent_to_kitchen_at)) * 24 * 60 >= 20
    `).get(req.businessId);
    if ((staleKitchen?.cnt || 0) > 0) {
      alerts.push({
        id: 'kitchen-stale',
        severity: 'danger',
        title: 'Mutfakta geciken sipariş',
        message: `${staleKitchen.cnt} kalem 20+ dakikadır bekliyor`,
        href: '/kitchen',
      });
    }

    const upcomingRes = db.prepare(`
      SELECT COUNT(*) AS cnt FROM reservations
      WHERE business_id = ? AND reservation_date = ? AND status = 'confirmed'
        AND (arrived_at IS NULL)
    `).get(req.businessId, today);
    if ((upcomingRes?.cnt || 0) > 0) {
      alerts.push({
        id: 'reservations',
        severity: 'info',
        title: 'Bugünkü rezervasyonlar',
        message: `${upcomingRes.cnt} onaylı rezervasyon bekleniyor`,
        href: '/reservations',
      });
    }

    const unpaidToday = db.prepare(`
      SELECT COUNT(*) AS cnt FROM orders o
      WHERE o.business_id = ? AND o.status NOT IN ('cancelled', 'closed')
        AND o.created_at >= ? AND o.created_at < ?
        AND ${orderGrandTotalCents} > COALESCE(
          (SELECT SUM(${paymentAmountCents}) FROM payments p WHERE p.order_id = o.id), 0
        )
    `).get(req.businessId, startAt, endAt);
    if ((unpaidToday?.cnt || 0) > 0) {
      alerts.push({
        id: 'unpaid',
        severity: 'info',
        title: 'Bekleyen ödeme',
        message: `${unpaidToday.cnt} açık sipariş tahsilat bekliyor`,
        href: '/orders',
      });
    }

    res.json({ alerts });
  } catch (err) {
    console.error('Dashboard alerts error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

/**
 * GET /api/dashboard/recent-orders
 * Son N sipariş (varsayılan 10) — canlı akış bölümü için.
 */
router.get('/recent-orders', authorize('admin', 'cashier', 'waiter'), (req, res) => {
  try {
    const limit = Math.min(50, Math.max(1, parseInt(req.query.limit || '10', 10) || 10));
    const rows = db.prepare(`
      SELECT o.id, o.order_no, o.order_type, o.status, o.created_at, o.closed_at,
        ${orderGrandTotalCents} / 100.0 AS grand_total,
        COALESCE(o.table_name_snapshot, t.name) AS table_name,
        COALESCE(o.customer_name_snapshot, c.full_name) AS customer_name,
        COALESCE(o.user_name_snapshot, u.full_name) AS user_name
      FROM orders o
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN customers c ON o.customer_id = c.id
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.business_id = ?
      ORDER BY o.created_at DESC
      LIMIT ?
    `).all(req.businessId, limit);
    res.json({ orders: rows });
  } catch (err) {
    console.error('Dashboard recent orders error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

export default router;
