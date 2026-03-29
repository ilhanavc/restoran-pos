import { Router } from 'express';
import db from '../config/database.js';
import { authenticate, businessScope, authorize } from '../middleware/auth.js';

const router = Router();
router.use(authenticate, businessScope);

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

    const paidOrderCount = db.prepare(`
      SELECT COUNT(DISTINCT order_id) as cnt FROM payments
      WHERE business_id = ? AND date(created_at) = ?
    `).get(req.businessId, targetDate);

    const avgOrderValue = paidOrderCount.cnt > 0
      ? revenue.total / paidOrderCount.cnt
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

// GET /api/reports/closed-orders — seçilen gün kapanan siparişler (özet liste)
router.get('/closed-orders', authorize('admin', 'cashier'), (req, res) => {
  try {
    const { date } = req.query;
    const targetDate = date || new Date().toISOString().slice(0, 10);

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
      WHERE o.business_id = ? AND o.status = 'closed' AND date(o.closed_at) = ?
      ORDER BY o.closed_at DESC
    `).all(req.businessId, targetDate);

    res.json({ date: targetDate, orders: rows });
  } catch (err) {
    console.error('Closed orders report:', err);
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

export default router;
