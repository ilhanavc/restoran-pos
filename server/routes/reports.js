import { Router } from 'express';
import db from '../config/database.js';
import config from '../config/index.js';
import { authenticate, businessScope, authorize } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, businessScope);

function toSqliteUtcDateTime(ms) {
  return new Date(ms).toISOString().slice(0, 19).replace('T', ' ');
}

function getTimeZoneOffsetMs(utcMs, timeZone) {
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).formatToParts(new Date(utcMs));
  const map = Object.fromEntries(parts.filter((p) => p.type !== 'literal').map((p) => [p.type, p.value]));
  const asUtc = Date.UTC(
    Number(map.year),
    Number(map.month) - 1,
    Number(map.day),
    Number(map.hour),
    Number(map.minute),
    Number(map.second),
  );
  return asUtc - utcMs;
}

function getUtcRangeForStoreDate(dateStr, timeZone) {
  const [y, m, d] = String(dateStr || '').split('-').map(Number);
  if (!y || !m || !d) return null;
  const baseStart = Date.UTC(y, m - 1, d, 0, 0, 0);
  const baseEnd = Date.UTC(y, m - 1, d + 1, 0, 0, 0);

  let startUtc = baseStart;
  let endUtc = baseEnd;
  for (let i = 0; i < 3; i += 1) {
    startUtc = baseStart - getTimeZoneOffsetMs(startUtc, timeZone);
    endUtc = baseEnd - getTimeZoneOffsetMs(endUtc, timeZone);
  }
  return {
    fromUtc: toSqliteUtcDateTime(startUtc),
    toUtc: toSqliteUtcDateTime(endUtc),
  };
}

// GET /api/reports/daily
router.get('/daily', authorize('admin', 'cashier'), (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().slice(0, 10);

    const revenue = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total FROM payments 
      WHERE business_id = ? AND date(created_at) = ?
    `).get(req.businessId, targetDate);

    const orderStats = db.prepare(`
      SELECT COUNT(*) as total_orders,
        SUM(CASE WHEN order_type = 'dine_in' THEN 1 ELSE 0 END) as dine_in_count,
        SUM(CASE WHEN order_type = 'takeaway' THEN 1 ELSE 0 END) as takeaway_count,
        SUM(CASE WHEN status = 'cancelled' THEN 1 ELSE 0 END) as cancelled_count,
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN grand_total ELSE 0 END), 0) as total_sales,
        COALESCE(SUM(CASE WHEN status != 'cancelled' THEN discount_amount ELSE 0 END), 0) as total_discounts
      FROM orders WHERE business_id = ? AND date(created_at) = ?
    `).get(req.businessId, targetDate);

    const paymentBreakdown = db.prepare(`
      SELECT payment_type, COUNT(*) as count, COALESCE(SUM(amount), 0) as total
      FROM payments WHERE business_id = ? AND date(created_at) = ?
      GROUP BY payment_type
    `).all(req.businessId, targetDate);

    const topProducts = db.prepare(`
      SELECT oi.product_name, SUM(oi.quantity) as total_qty, SUM(oi.unit_price * oi.quantity) as total_revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.business_id = ? AND date(o.created_at) = ? AND oi.status != 'cancelled'
      GROUP BY oi.product_name ORDER BY total_qty DESC LIMIT 10
    `).all(req.businessId, targetDate);

    const categoryBreakdown = db.prepare(`
      SELECT c.name as category_name, SUM(oi.quantity) as total_qty, SUM(oi.unit_price * oi.quantity) as total_revenue
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      JOIN products p ON oi.product_id = p.id
      JOIN categories c ON p.category_id = c.id
      WHERE o.business_id = ? AND date(o.created_at) = ? AND oi.status != 'cancelled'
      GROUP BY c.id ORDER BY total_revenue DESC
    `).all(req.businessId, targetDate);

    const userSales = db.prepare(`
      SELECT u.full_name, COUNT(DISTINCT o.id) as order_count, COALESCE(SUM(p.amount), 0) as total_collected
      FROM payments p
      JOIN orders o ON p.order_id = o.id
      JOIN users u ON p.created_by = u.id
      WHERE p.business_id = ? AND date(p.created_at) = ?
      GROUP BY u.id ORDER BY total_collected DESC
    `).all(req.businessId, targetDate);

    const compedItems = db.prepare(`
      SELECT oi.product_name, oi.quantity, oi.unit_price, oi.comp_reason, u.full_name as comped_by
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      LEFT JOIN users u ON oi.created_by = u.id
      WHERE o.business_id = ? AND date(o.created_at) = ? AND oi.is_comped = 1
    `).all(req.businessId, targetDate);

    const openOrders = db.prepare(`
      SELECT o.*, t.name as table_name FROM orders o
      LEFT JOIN tables t ON o.table_id = t.id
      WHERE o.business_id = ? AND date(o.created_at) = ?
        AND o.status NOT IN ('closed', 'cancelled')
      ORDER BY o.created_at
    `).all(req.businessId, targetDate);

    const storeDateRange = getUtcRangeForStoreDate(targetDate, config.storeTimezone || 'Europe/Istanbul');
    const closedOrderStatsForAvg = storeDateRange
      ? db.prepare(`
        SELECT COUNT(*) as cnt, COALESCE(SUM(grand_total), 0) as total
        FROM orders
        WHERE business_id = ?
          AND status = 'closed'
          AND closed_at IS NOT NULL
          AND closed_at >= ?
          AND closed_at < ?
      `).get(req.businessId, storeDateRange.fromUtc, storeDateRange.toUtc)
      : { cnt: 0, total: 0 };

    const avgOrderValue = closedOrderStatsForAvg.cnt > 0
      ? closedOrderStatsForAvg.total / closedOrderStatsForAvg.cnt
      : 0;

    res.json({
      date: targetDate,
      revenue: revenue.total,
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

    const whereParts = [
      'o.business_id = ?',
      "o.status = 'closed'",
      'date(o.closed_at) BETWEEN ? AND ?',
    ];
    const params = [req.businessId, fromDate, toDate];

    if (customer && customer.trim()) {
      whereParts.push('c.full_name LIKE ?');
      params.push(`%${customer.trim()}%`);
    }
    if (min_amount !== undefined && min_amount !== '') {
      whereParts.push('o.grand_total >= ?');
      params.push(Number(min_amount));
    }
    if (max_amount !== undefined && max_amount !== '') {
      whereParts.push('o.grand_total <= ?');
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
        t.name AS table_name,
        u.full_name AS user_name,
        c.full_name AS customer_name,
        (SELECT p.payment_type FROM payments p WHERE p.order_id = o.id ORDER BY p.created_at LIMIT 1) AS payment_type
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

    const whereParts = [
      'o.business_id = ?',
      "o.status = 'closed'",
      'date(o.closed_at) BETWEEN ? AND ?',
    ];
    const params = [req.businessId, fromDate, toDate];

    if (customer && customer.trim()) {
      whereParts.push('c.full_name LIKE ?');
      params.push(`%${customer.trim()}%`);
    }
    if (min_amount !== undefined && min_amount !== '') {
      whereParts.push('o.grand_total >= ?');
      params.push(Number(min_amount));
    }
    if (max_amount !== undefined && max_amount !== '') {
      whereParts.push('o.grand_total <= ?');
      params.push(Number(max_amount));
    }

    const where = whereParts.join(' AND ');

    const rows = db.prepare(`
      SELECT o.id, o.order_no, o.order_type, o.grand_total, o.discount_amount, o.closed_at,
        t.name AS table_name,
        u.full_name AS user_name,
        c.full_name AS customer_name,
        (SELECT p.payment_type FROM payments p WHERE p.order_id = o.id ORDER BY p.created_at LIMIT 1) AS payment_type
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

    const revenue = db.prepare(`
      SELECT date(created_at) as date, COALESCE(SUM(amount), 0) as total
      FROM payments WHERE business_id = ? AND date(created_at) BETWEEN ? AND ?
      GROUP BY date(created_at) ORDER BY date
    `).all(req.businessId, from, to);

    const summary = db.prepare(`
      SELECT COALESCE(SUM(amount), 0) as total_revenue, COUNT(*) as total_payments
      FROM payments WHERE business_id = ? AND date(created_at) BETWEEN ? AND ?
    `).get(req.businessId, from, to);

    const orderCount = db.prepare(`
      SELECT COUNT(*) as count FROM orders 
      WHERE business_id = ? AND status = 'closed' AND date(closed_at) BETWEEN ? AND ?
    `).get(req.businessId, from, to);

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

    const rows = db.prepare(`
      SELECT strftime('%H', created_at) as hour,
             COUNT(*) as order_count,
             COALESCE(SUM(amount), 0) as revenue
      FROM payments
      WHERE business_id = ? AND date(created_at) = ?
      GROUP BY hour ORDER BY hour
    `).all(req.businessId, targetDate);

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

export default router;
