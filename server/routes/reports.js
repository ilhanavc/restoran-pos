import { Router } from 'express';
import db from '../config/database.js';
import { authenticate, businessScope, authorize } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, businessScope);

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00.000Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

function dayBounds(date) {
  return [`${date} 00:00:00`, `${addDays(date, 1)} 00:00:00`];
}

function rangeBounds(from, to) {
  return [`${from} 00:00:00`, `${addDays(to, 1)} 00:00:00`];
}

const paymentAmountCents = 'COALESCE(amount_cents, ROUND(amount * 100))';
const paymentTipCents = 'COALESCE(tip_cents, ROUND(COALESCE(tip_amount, 0) * 100))';
const refundAmountCents = 'COALESCE(amount_cents, ROUND(amount * 100))';
const orderGrandTotalCents = 'COALESCE(grand_total_cents, ROUND(grand_total * 100))';
const orderGrandTotalCentsO = 'COALESCE(o.grand_total_cents, ROUND(o.grand_total * 100))';
const orderDiscountCents = 'COALESCE(discount_cents, ROUND(COALESCE(discount_amount, 0) * 100))';
const orderItemSubtotalCents = 'COALESCE(oi.subtotal_cents, ROUND((oi.unit_price * oi.quantity) * 100))';

// GET /api/reports/daily
router.get('/daily', authorize('admin', 'cashier'), (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const [startAt, endAt] = dayBounds(targetDate);

    const revenue = db.prepare(`
      SELECT COALESCE(SUM(${paymentAmountCents}), 0) / 100.0 as total FROM payments
      WHERE business_id = ? AND created_at >= ? AND created_at < ?
    `).get(req.businessId, startAt, endAt);

    const refundSummary = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(${refundAmountCents}), 0) / 100.0 as total
      FROM refunds
      WHERE business_id = ? AND status = 'completed' AND created_at >= ? AND created_at < ?
    `).get(req.businessId, startAt, endAt);
    const tipSummary = db.prepare(`
      SELECT COUNT(*) as count, COALESCE(SUM(${paymentTipCents}), 0) / 100.0 as total
      FROM payments
      WHERE business_id = ? AND ${paymentTipCents} > 0 AND created_at >= ? AND created_at < ?
    `).get(req.businessId, startAt, endAt);

    const orderStats = db.prepare(`
      SELECT COUNT(*) as total_orders,
        SUM(CASE WHEN order_type = 'dine_in' THEN 1 ELSE 0 END) as dine_in_count,
        SUM(CASE WHEN order_type = 'takeaway' THEN 1 ELSE 0 END) as takeaway_count,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count,
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN ${orderGrandTotalCents} ELSE 0 END), 0) / 100.0 as total_sales,
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN ${orderDiscountCents} ELSE 0 END), 0) / 100.0 as total_discounts
      FROM orders WHERE business_id = ? AND created_at >= ? AND created_at < ?
    `).get(req.businessId, startAt, endAt);

    const paymentBreakdown = db.prepare(`
      SELECT
        CASE
          WHEN source = 'system_takeaway_delivery' THEN 'system_takeaway_delivery'
          ELSE payment_type
        END AS payment_type,
        COUNT(*) as count,
        COALESCE(SUM(${paymentAmountCents}), 0) / 100.0 as total
      FROM payments
      WHERE business_id = ? AND created_at >= ? AND created_at < ?
      GROUP BY CASE
        WHEN source = 'system_takeaway_delivery' THEN 'system_takeaway_delivery'
        ELSE payment_type
      END
    `).all(req.businessId, startAt, endAt);

    const topProducts = db.prepare(`
      SELECT oi.product_name, SUM(oi.quantity) as total_qty, COALESCE(SUM(${orderItemSubtotalCents}), 0) / 100.0 as total_revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.business_id = ? AND o.created_at >= ? AND o.created_at < ? AND oi.status != 'cancelled'
      GROUP BY oi.product_name ORDER BY total_qty DESC LIMIT 10
    `).all(req.businessId, startAt, endAt);

    const categoryBreakdown = db.prepare(`
      SELECT COALESCE(oi.category_name_snapshot, 'Kategorisiz') as category_name,
             oi.category_id_snapshot as category_id,
             SUM(oi.quantity) as total_qty,
             COALESCE(SUM(${orderItemSubtotalCents}), 0) / 100.0 as total_revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.business_id = ? AND o.created_at >= ? AND o.created_at < ? AND oi.status != 'cancelled'
      GROUP BY COALESCE(oi.category_id_snapshot, oi.category_name_snapshot, 'uncategorized'), COALESCE(oi.category_name_snapshot, 'Kategorisiz')
      ORDER BY total_revenue DESC
    `).all(req.businessId, startAt, endAt);

    const userSales = db.prepare(`
      SELECT u.full_name, COUNT(DISTINCT o.id) as order_count, COALESCE(SUM(${paymentAmountCents}), 0) / 100.0 as total_collected
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      JOIN users u ON p.created_by = u.id
      WHERE p.business_id = ? AND p.created_at >= ? AND p.created_at < ?
      GROUP BY u.id ORDER BY total_collected DESC
    `).all(req.businessId, startAt, endAt);

    const compedItems = db.prepare(`
      SELECT oi.product_name, oi.quantity, oi.unit_price, oi.comp_reason, u.full_name as comped_by
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN users u ON oi.created_by = u.id
      WHERE o.business_id = ? AND o.created_at >= ? AND o.created_at < ? AND oi.is_comped = 1
    `).all(req.businessId, startAt, endAt);

    const openOrders = db.prepare(`
      SELECT o.*, COALESCE(o.table_name_snapshot, t.name) as table_name FROM orders o
      LEFT JOIN tables t ON o.table_id = t.id
      WHERE o.business_id = ? AND o.created_at >= ? AND o.created_at < ?
        AND o.status NOT IN ('closed', 'cancelled')
      ORDER BY o.created_at
    `).all(req.businessId, startAt, endAt);

    const avgOrderValue = orderStats.total_orders > 0
      ? revenue.total / orderStats.total_orders
      : 0;

    res.json({
      date: targetDate,
      revenue: revenue.total,
      refundTotal: refundSummary.total,
      refundCount: refundSummary.count,
      netRevenue: revenue.total - refundSummary.total,
      tipTotal: tipSummary.total,
      tipCount: tipSummary.count,
      orderStats,
      paymentBreakdown,
      topProducts,
      categoryBreakdown,
      userSales,
      compedItems,
      openOrders,
      avgOrderValue,
    });
  } catch (err) {
    console.error('Report error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/reports/closed-orders — kapanan siparişler (filtrelenebilir)
// ?date=        — tek gün (from/to yoksa bu kullanılır)
// ?from=&to=    — tarih aralığı
// ?customer=    — müşteri adı araması
// ?min_amount=  — minimum tutar
// ?max_amount=  — maksimum tutar
// ?page=        — sayfa no (varsayılan 1)
// ?limit=       — sayfa boyutu (varsayılan 50, maks 200)
router.get('/closed-orders', authorize('admin', 'cashier'), (req, res) => {
  try {
    const { date, from, to, customer, min_amount, max_amount } = req.query;
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10) || 50));
    const offset = (page - 1) * limit;

    // Tarih aralığı: from/to > date > bugün
    const fromDate = from || date || new Date().toISOString().slice(0, 10);
    const toDate = to || fromDate;
    const [startAt, endAt] = rangeBounds(fromDate, toDate);

    const whereParts = [
      'o.business_id = ?',
      "o.status = 'closed'",
      'o.closed_at >= ? AND o.closed_at < ?',
    ];
    const params = [req.businessId, startAt, endAt];

    if (customer && customer.trim()) {
      whereParts.push('COALESCE(o.customer_name_snapshot, c.full_name) LIKE ?');
      params.push(`%${customer.trim()}%`);
    }
    if (min_amount !== undefined && min_amount !== '') {
      whereParts.push(`(${orderGrandTotalCentsO}) / 100.0 >= ?`);
      params.push(Number(min_amount));
    }
    if (max_amount !== undefined && max_amount !== '') {
      whereParts.push(`(${orderGrandTotalCentsO}) / 100.0 <= ?`);
      params.push(Number(max_amount));
    }

    const where = whereParts.join(' AND ');

    const countRow = db.prepare(`
      SELECT COUNT(*) as cnt FROM orders o
      LEFT JOIN customers c ON o.customer_id = c.id
      WHERE ${where}
    `).get(...params);
    const total = countRow.cnt;

    const rows = db.prepare(`
      SELECT o.id, o.order_no, o.order_type, o.grand_total, o.discount_amount, o.closed_at,
        COALESCE(o.table_name_snapshot, t.name) AS table_name,
        COALESCE(o.user_name_snapshot, u.full_name) AS user_name,
        COALESCE(o.customer_name_snapshot, c.full_name) AS customer_name,
        COALESCE((SELECT SUM(COALESCE(r.amount_cents, ROUND(r.amount * 100))) FROM refunds r WHERE r.order_id = o.id AND r.status = 'completed'), 0) / 100.0 AS refunded_total,
        (SELECT CASE
            WHEN p.source = 'system_takeaway_delivery' THEN 'system_takeaway_delivery'
            ELSE p.payment_type
          END
         FROM payments p
         WHERE p.order_id = o.id
         ORDER BY p.created_at
         LIMIT 1) AS payment_type
      FROM orders o
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN customers c ON o.customer_id = c.id
      WHERE ${where}
      ORDER BY o.closed_at DESC
      LIMIT ? OFFSET ?
    `).all(...params, limit, offset);

    res.json({
      from: fromDate,
      to: toDate,
      orders: rows,
      total,
      page,
      limit,
      has_more: offset + rows.length < total,
    });
  } catch (err) {
    console.error('Closed orders report:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/reports/closed-orders/export — filtreye uyan TÜM siparişleri döner (sayfalama yok, max 5000)
// Aynı filtre parametrelerini kabul eder: date, from, to, customer, min_amount, max_amount
router.get('/closed-orders/export', authorize('admin', 'cashier'), (req, res) => {
  try {
    const { date, from, to, customer, min_amount, max_amount } = req.query;
    const fromDate = from || date || new Date().toISOString().slice(0, 10);
    const toDate = to || fromDate;
    const [startAt, endAt] = rangeBounds(fromDate, toDate);

    const whereParts = [
      'o.business_id = ?',
      "o.status = 'closed'",
      'o.closed_at >= ? AND o.closed_at < ?',
    ];
    const params = [req.businessId, startAt, endAt];

    if (customer && customer.trim()) {
      whereParts.push('COALESCE(o.customer_name_snapshot, c.full_name) LIKE ?');
      params.push(`%${customer.trim()}%`);
    }
    if (min_amount !== undefined && min_amount !== '') {
      whereParts.push(`(${orderGrandTotalCentsO}) / 100.0 >= ?`);
      params.push(Number(min_amount));
    }
    if (max_amount !== undefined && max_amount !== '') {
      whereParts.push(`(${orderGrandTotalCentsO}) / 100.0 <= ?`);
      params.push(Number(max_amount));
    }

    const where = whereParts.join(' AND ');

    const rows = db.prepare(`
      SELECT o.id, o.order_no, o.order_type, o.grand_total, o.discount_amount, o.closed_at,
        COALESCE(o.table_name_snapshot, t.name) AS table_name,
        COALESCE(o.user_name_snapshot, u.full_name) AS user_name,
        COALESCE(o.customer_name_snapshot, c.full_name) AS customer_name,
        COALESCE((SELECT SUM(COALESCE(r.amount_cents, ROUND(r.amount * 100))) FROM refunds r WHERE r.order_id = o.id AND r.status = 'completed'), 0) / 100.0 AS refunded_total,
        (SELECT CASE
            WHEN p.source = 'system_takeaway_delivery' THEN 'system_takeaway_delivery'
            ELSE p.payment_type
          END
         FROM payments p
         WHERE p.order_id = o.id
         ORDER BY p.created_at
         LIMIT 1) AS payment_type
      FROM orders o
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN customers c ON o.customer_id = c.id
      WHERE ${where}
      ORDER BY o.closed_at DESC
      LIMIT 5000
    `).all(...params);

    res.json({ from: fromDate, to: toDate, orders: rows, total: rows.length });
  } catch (err) {
    console.error('Closed orders export:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/reports/range
router.get('/range', authorize('admin', 'cashier'), (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'Tarih aralığı gerekli' });
    const [startAt, endAt] = rangeBounds(from, to);

    const revenue = db.prepare(`
      SELECT date(created_at) as date, COALESCE(SUM(${paymentAmountCents}), 0) / 100.0 as total
      FROM payments WHERE business_id = ? AND created_at >= ? AND created_at < ?
      GROUP BY date(created_at) ORDER BY date
    `).all(req.businessId, startAt, endAt);

    const summary = db.prepare(`
      SELECT COALESCE(SUM(${paymentAmountCents}), 0) / 100.0 as total_revenue, COUNT(*) as total_payments
      FROM payments WHERE business_id = ? AND created_at >= ? AND created_at < ?
    `).get(req.businessId, startAt, endAt);

    const orderCount = db.prepare(`
      SELECT COUNT(*) as count FROM orders 
      WHERE business_id = ? AND status = 'closed' AND closed_at >= ? AND closed_at < ?
    `).get(req.businessId, startAt, endAt);

    res.json({ revenue, summary, orderCount: orderCount.count });
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/reports/hourly — seçilen gün saatlik sipariş ve ciro dağılımı
router.get('/hourly', authorize('admin', 'cashier'), (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().slice(0, 10);
    const [startAt, endAt] = dayBounds(targetDate);

    const rows = db.prepare(`
      SELECT strftime('%H', created_at) as hour,
             COUNT(*) as order_count,
             COALESCE(SUM(${paymentAmountCents}), 0) / 100.0 as revenue
      FROM payments
      WHERE business_id = ? AND created_at >= ? AND created_at < ?
      GROUP BY hour ORDER BY hour
    `).all(req.businessId, startAt, endAt);

    // 0-23 tüm saatler için boş değerlerle doldur
    const byHour = {};
    for (const r of rows) byHour[r.hour] = r;
    const data = Array.from({ length: 24 }, (_, i) => {
      const h = String(i).padStart(2, '0');
      return { hour: h, order_count: byHour[h]?.order_count || 0, revenue: byHour[h]?.revenue || 0 };
    });

    res.json({ date: targetDate, data });
  } catch (err) {
    console.error('Hourly report error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/reports/analytics — tarih aralığı için gelişmiş analitik
// ?from= &to= — zorunlu
router.get('/analytics', authorize('admin', 'cashier'), (req, res) => {
  try {
    const { from, to } = req.query;
    if (!from || !to) return res.status(400).json({ error: 'from ve to parametreleri gerekli' });
    const [startAt, endAt] = rangeBounds(from, to);

    // Top 10 ürün (adet bazlı)
    const topProducts = db.prepare(`
      SELECT oi.product_name, SUM(oi.quantity) AS total_qty, COALESCE(SUM(${orderItemSubtotalCents}), 0) / 100.0 AS total_revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.business_id = ? AND o.closed_at >= ? AND o.closed_at < ?
        AND o.status = 'closed' AND oi.status != 'cancelled'
      GROUP BY oi.product_name
      ORDER BY total_qty DESC
      LIMIT 10
    `).all(req.businessId, startAt, endAt);

    // Saatlik yoğunluk (0-23)
    const hourlyRows = db.prepare(`
      SELECT strftime('%H', p.created_at) AS hour,
             COUNT(*) AS order_count,
             COALESCE(SUM(COALESCE(p.amount_cents, ROUND(p.amount * 100))), 0) / 100.0 AS revenue
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      WHERE p.business_id = ? AND p.created_at >= ? AND p.created_at < ?
      GROUP BY hour ORDER BY hour
    `).all(req.businessId, startAt, endAt);
    const byHour = {};
    for (const r of hourlyRows) byHour[r.hour] = r;
    const peakHours = Array.from({ length: 24 }, (_, i) => {
      const h = String(i).padStart(2, '0');
      return { hour: `${h}:00`, order_count: byHour[h]?.order_count || 0, revenue: byHour[h]?.revenue || 0 };
    });

    // Günlük ciro (seçilen dönem)
    const dailyRevenue = db.prepare(`
      SELECT date(p.created_at) AS date, COALESCE(SUM(COALESCE(p.amount_cents, ROUND(p.amount * 100))), 0) / 100.0 AS revenue, COUNT(*) AS order_count
      FROM payments p
      WHERE p.business_id = ? AND p.created_at >= ? AND p.created_at < ?
      GROUP BY date(p.created_at) ORDER BY date
    `).all(req.businessId, startAt, endAt);

    // Dönem özeti
    const summary = db.prepare(`
      SELECT COALESCE(SUM(COALESCE(p.amount_cents, ROUND(p.amount * 100))), 0) / 100.0 AS total_revenue, COUNT(*) AS total_orders
      FROM payments p
      WHERE p.business_id = ? AND p.created_at >= ? AND p.created_at < ?
    `).get(req.businessId, startAt, endAt);

    res.json({ from, to, topProducts, peakHours, dailyRevenue, summary });
  } catch (err) {
    console.error('Analytics report:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

export default router;
