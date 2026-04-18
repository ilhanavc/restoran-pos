import { Router } from 'express';
import { z } from 'zod';
import db from '../config/database.js';
import { authenticate, businessScope, authorize } from '../middleware/auth.js';
import { emitToRoom } from '../socket.js';
import { validate } from '../middleware/validate.js';
import { auditLog } from '../utils/helpers.js';
import {
  enqueueReceiptJobForClosedOrder,
  enqueueTakeawayLabelJob,
  processPendingJobsSync,
} from '../services/printJobs.js';
import {
  getPrintJobSummary,
  createOrder,
  addItemsToOrder,
  updateOrderStatus,
  updateOrderItem,
  updateTakeawayDelivery,
} from '../services/orderService.js';

const router = Router();
router.use(authenticate, businessScope);

// ---------------------------------------------------------------------------
// Schemas
// ---------------------------------------------------------------------------

const selectedAttributeSchema = z.object({
  group_id: z.string().min(1),
  option_ids: z.array(z.string().min(1)).optional(),
  option_id: z.string().min(1).optional(),
}).refine((attr) => (attr.option_ids?.length || 0) > 0 || !!attr.option_id, {
  message: 'En az bir özellik seçeneği gerekli',
});

const orderItemSchema = z.object({
  product_id: z.string().min(1),
  quantity: z.number().int().positive().max(999).default(1),
  portion_id: z.string().optional().nullable(),
  modifiers: z.array(z.any()).optional(),
  note: z.string().max(500).optional().nullable(),
  selected_attributes: z.array(selectedAttributeSchema).optional().nullable(),
});

const createOrderSchema = {
  body: z.object({
    order_type: z.enum(['dine_in', 'takeaway']).optional(),
    table_id: z.string().optional().nullable(),
    customer_id: z.string().optional().nullable(),
    call_log_id: z.string().optional().nullable(),
    items: z.array(orderItemSchema).min(1, 'En az bir ürün gerekli'),
    note: z.string().max(500).optional().nullable(),
    guest_count: z.number().int().min(0).max(999).optional(),
    delivery_address: z.string().max(500).optional().nullable(),
    delivery_note: z.string().max(500).optional().nullable(),
    courier_note: z.string().max(500).optional().nullable(),
  }),
};

const addItemsSchema = {
  body: z.object({
    items: z.array(orderItemSchema).min(1, 'En az bir ürün gerekli'),
  }),
};

const orderStatuses = ['new', 'saved', 'in_kitchen', 'preparing', 'ready', 'served', 'cancelled', 'closed'];
const orderItemStatuses = ['new', 'sent', 'preparing', 'ready', 'served', 'cancelled', 'comped'];

const updateOrderStatusSchema = {
  body: z.object({
    status: z.enum(orderStatuses, { errorMap: () => ({ message: 'Geçerli sipariş durumu gerekli' }) }),
  }),
};

const updateOrderItemSchema = {
  body: z.object({
    status: z.enum(orderItemStatuses).optional(),
    quantity: z.number().int().positive().max(999).optional(),
    note: z.string().max(500).optional().nullable(),
    is_comped: z.boolean().optional(),
    comp_reason: z.string().max(500).optional().nullable(),
    portion_id: z.string().optional().nullable(),
  }).refine((body) => Object.keys(body).length > 0, {
    message: 'En az bir güncellenecek alan gerekli',
  }),
};

const staff = authorize('admin', 'cashier', 'waiter');
const staffAndKitchen = authorize('admin', 'cashier', 'waiter', 'kitchen');

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

// GET /api/orders
router.get('/', staff, (req, res) => {
  try {
    const { status, order_type, table_id, limit } = req.query;
    let sql = `SELECT o.*, u.full_name as user_name, t.name as table_name, c.full_name as customer_name
               FROM orders o
               LEFT JOIN users u ON o.user_id = u.id
               LEFT JOIN tables t ON o.table_id = t.id
               LEFT JOIN customers c ON o.customer_id = c.id
               WHERE o.business_id = ?`;
    const params = [req.businessId];

    if (status) { sql += ' AND o.status = ?'; params.push(status); }
    if (order_type) { sql += ' AND o.order_type = ?'; params.push(order_type); }
    if (table_id) { sql += ' AND o.table_id = ?'; params.push(table_id); }

    sql += ' ORDER BY o.created_at DESC';
    if (limit) {
      const lim = parseInt(limit, 10);
      if (!Number.isNaN(lim) && lim > 0) { sql += ' LIMIT ?'; params.push(lim); }
    }

    res.json(db.prepare(sql).all(...params));
  } catch (err) {
    console.error('Orders list error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/orders/print-health
router.get('/print-health', staff, (req, res) => {
  try {
    const recentFailed = db.prepare(`
      SELECT pj.id, pj.order_id, pj.printer_id, pj.job_type, pj.error_message, pj.last_error_code, pj.created_at,
             p.name AS printer_name
      FROM print_jobs pj
      LEFT JOIN printers p ON p.id = pj.printer_id
      WHERE pj.business_id = ? AND pj.status = 'failed'
      ORDER BY datetime(pj.created_at) DESC
      LIMIT 5
    `).all(req.businessId);
    res.json({ summary: getPrintJobSummary(req.businessId), recentFailed });
  } catch (err) {
    console.error('Print health error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/orders/print-jobs/:id/retry
router.post('/print-jobs/:id/retry', staff, (req, res) => {
  try {
    const job = db.prepare('SELECT * FROM print_jobs WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!job) return res.status(404).json({ error: 'Yazdırma işi bulunamadı' });
    if (job.status !== 'failed') {
      return res.status(409).json({ error: 'Yalnızca başarısız yazdırma işleri yeniden denenebilir' });
    }
    db.prepare(`
      UPDATE print_jobs SET status = 'pending', error_message = NULL, last_error_code = NULL,
        claimed_at = NULL, claimed_by = NULL, claimed_until = NULL, printed_at = NULL
      WHERE id = ? AND business_id = ?
    `).run(req.params.id, req.businessId);
    auditLog(req.businessId, req.user.id, 'print_job_retry_from_ops', 'print_job', req.params.id, {
      previous_error_code: job.last_error_code || null,
    });
    res.json({ ok: true, message: 'Yazdırma işi yeniden kuyruğa alındı' });
  } catch (err) {
    console.error('Print job retry error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/orders/takeaway/open
router.get('/takeaway/open', staff, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT o.id, o.order_no, o.grand_total, o.created_at, o.status,
        o.takeaway_out_at, o.takeaway_delivered_at,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.order_id = o.id), 0) as paid_total,
        u.full_name as user_name, c.full_name as customer_name
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN customers c ON o.customer_id = c.id
      WHERE o.business_id = ? AND o.order_type = 'takeaway'
        AND o.status NOT IN ('closed', 'cancelled')
        AND (o.takeaway_delivered_at IS NULL OR o.takeaway_delivered_at = '')
      ORDER BY o.created_at DESC
    `).all(req.businessId);

    const countStmt = db.prepare(
      `SELECT COUNT(*) as c FROM order_items WHERE order_id = ? AND status != 'cancelled'`,
    );

    res.json(rows.map((o) => ({
      id: o.id, order_no: o.order_no, total: o.grand_total,
      paid_total: o.paid_total || 0, created_at: o.created_at, status: o.status,
      user_name: o.user_name || null, customer_name: o.customer_name || null,
      takeaway_out_at: o.takeaway_out_at || null, takeaway_delivered_at: o.takeaway_delivered_at || null,
      item_count: countStmt.get(o.id).c,
    })));
  } catch (err) {
    console.error('Takeaway open orders error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// PATCH /api/orders/:id/takeaway/delivery
router.patch('/:id/takeaway/delivery', staff, (req, res) => {
  try {
    const { action } = req.body || {};
    if (action !== 'out_for_delivery' && action !== 'delivered') {
      return res.status(400).json({ error: 'Geçersiz aksiyon' });
    }
    const result = updateTakeawayDelivery(req.businessId, req.params.id, req.user.id, action);
    if (result.skipped) return res.json({ ok: true, skipped: result.skipped });
    emitToRoom(req.businessId, 'order:takeaway_delivery', { orderId: req.params.id, action });
    return res.json({ ok: true, ...result });
  } catch (err) {
    if (err.isNotFound) return res.status(404).json({ error: err.message });
    if (err.isBadRequest) return res.status(400).json({ error: err.message });
    console.error('Takeaway delivery error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/orders/:id/takeaway/print-label
router.post('/:id/takeaway/print-label', staff, (req, res) => {
  try {
    const printerId = req.body?.printer_id ? String(req.body.printer_id).trim() : null;
    const order = db.prepare(
      `SELECT id, order_type, status, takeaway_delivered_at FROM orders WHERE id = ? AND business_id = ?`,
    ).get(req.params.id, req.businessId);
    if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });
    if (order.order_type !== 'takeaway') {
      return res.status(400).json({ error: 'Sadece paket sipariş yazdırılabilir' });
    }
    if (['closed', 'cancelled'].includes(order.status) || order.takeaway_delivered_at) {
      return res.status(400).json({ error: 'Kapalı veya teslim edilmiş sipariş yazdırılamaz' });
    }

    const result = enqueueTakeawayLabelJob(req.businessId, order.id, req.user.id, {
      idempotencySuffix: `manual_${Date.now()}_${req.user.id}`,
      forcedPrinterId: printerId || null,
    });
    processPendingJobsSync(req.businessId, req.user.id);

    if (result.failed) {
      if (result.reason === 'printer_role_mismatch') {
        return res.status(400).json({ error: 'Paket etiketi için yalnız mutfak yazıcısı seçilebilir' });
      }
      if (result.reason === 'printer_not_found_or_inactive') {
        return res.status(400).json({ error: 'Seçilen yazıcı aktif değil veya bulunamadı' });
      }
      return res.status(400).json({ error: 'Paket etiketi için aktif yazıcı bulunamadı' });
    }
    return res.json({ ok: true, printJob: result });
  } catch (err) {
    console.error('Takeaway print label error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/orders/:id/print-receipt
router.post('/:id/print-receipt', staff, (req, res) => {
  try {
    const printerId = req.body?.printer_id ? String(req.body.printer_id).trim() : null;
    const order = db.prepare(
      `SELECT id, status FROM orders WHERE id = ? AND business_id = ?`,
    ).get(req.params.id, req.businessId);
    if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });
    if (order.status === 'cancelled') {
      return res.status(400).json({ error: 'İptal sipariş yazdırılamaz' });
    }

    const result = enqueueReceiptJobForClosedOrder(req.businessId, order.id, req.user.id, {
      idempotencySuffix: `manual_${Date.now()}_${req.user.id}`,
      forcedPrinterId: printerId || null,
    });
    processPendingJobsSync(req.businessId, req.user.id);

    if (result.failed) {
      if (result.reason === 'printer_role_mismatch') {
        return res.status(400).json({ error: 'Fiş için yalnız müşteri fişi yazıcısı seçilebilir' });
      }
      if (result.reason === 'printer_not_found_or_inactive') {
        return res.status(400).json({ error: 'Seçilen yazıcı aktif değil veya bulunamadı' });
      }
      return res.status(400).json({ error: 'Fiş yazıcısı bulunamadı' });
    }
    return res.json({ ok: true, printJob: result });
  } catch (err) {
    console.error('Manual receipt print error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/orders/active
router.get('/active', authorize('admin', 'kitchen'), (req, res) => {
  try {
    const orders = db.prepare(`
      SELECT o.*, t.name as table_name, c.full_name as customer_name, u.full_name as user_name
      FROM orders o
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN customers c ON o.customer_id = c.id
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.business_id = ? AND o.status IN ('in_kitchen', 'preparing', 'ready')
      ORDER BY o.created_at ASC
    `).all(req.businessId);

    for (const order of orders) {
      order.items = db.prepare(`
        SELECT oi.*, p.name as product_name_ref FROM order_items oi
        LEFT JOIN products p ON oi.product_id = p.id
        WHERE oi.order_id = ? AND oi.status != 'cancelled'
        ORDER BY oi.created_at
      `).all(order.id);
    }

    res.json(orders);
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/orders/:id
router.get('/:id', staffAndKitchen, (req, res) => {
  try {
    const order = db.prepare(`
      SELECT o.*, t.name as table_name, c.full_name as customer_name, u.full_name as user_name
      FROM orders o
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN customers c ON o.customer_id = c.id
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.id = ? AND o.business_id = ?
    `).get(req.params.id, req.businessId);
    if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });

    order.items = db.prepare(`SELECT * FROM order_items WHERE order_id = ? ORDER BY created_at`).all(order.id);
    order.payments = db.prepare(`SELECT * FROM payments WHERE order_id = ? ORDER BY created_at`).all(order.id);
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// PATCH /api/orders/:id/customer
router.patch('/:id/customer', staff, (req, res) => {
  try {
    const { customer_id } = req.body || {};
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });
    if (['closed', 'cancelled'].includes(order.status)) {
      return res.status(400).json({ error: 'Kapalı siparişte müşteri değiştirilemez' });
    }
    if (order.order_type !== 'dine_in') {
      return res.status(400).json({ error: 'Sadece salon siparişlerinde müşteri atanabilir' });
    }

    let cid = customer_id != null && customer_id !== '' ? String(customer_id) : null;
    let customerNameSnapshot = null;
    if (cid) {
      const cust = db.prepare('SELECT id, full_name FROM customers WHERE id = ? AND business_id = ?').get(cid, req.businessId);
      if (!cust) return res.status(400).json({ error: 'Müşteri bulunamadı' });
      customerNameSnapshot = cust.full_name;
    } else {
      cid = null;
    }

    db.prepare(
      `UPDATE orders SET customer_id = ?, customer_name_snapshot = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ? AND business_id = ?`,
    ).run(cid, customerNameSnapshot, req.user.id, req.params.id, req.businessId);
    auditLog(req.businessId, req.user.id, 'order_customer', 'order', req.params.id, { customer_id: cid });

    const updated = db.prepare(`
      SELECT o.*, t.name as table_name, c.full_name as customer_name, u.full_name as user_name
      FROM orders o
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN customers c ON o.customer_id = c.id
      LEFT JOIN users u ON o.user_id = u.id
      WHERE o.id = ? AND o.business_id = ?
    `).get(req.params.id, req.businessId);
    updated.items = db.prepare(`SELECT * FROM order_items WHERE order_id = ? ORDER BY created_at`).all(updated.id);
    updated.payments = db.prepare(`SELECT * FROM payments WHERE order_id = ? ORDER BY created_at`).all(updated.id);
    res.json(updated);
  } catch (err) {
    console.error('Order customer patch error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/orders
router.post('/', staff, validate(createOrderSchema), (req, res) => {
  try {
    const order = createOrder(req.businessId, req.branchId, req.user.id, req.body);
    emitToRoom(req.businessId, 'order:created', { order });
    res.status(201).json(order);
  } catch (err) {
    if (err.isBadRequest) return res.status(400).json({ error: err.message });
    console.error('Order create error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/orders/:id/items
router.post('/:id/items', staff, validate(addItemsSchema), (req, res) => {
  try {
    const updated = addItemsToOrder(req.businessId, req.params.id, req.user.id, req.body.items);
    emitToRoom(req.businessId, 'order:items_added', { order: updated });
    res.json(updated);
  } catch (err) {
    if (err.isNotFound) return res.status(404).json({ error: err.message });
    if (err.isBadRequest) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// PATCH /api/orders/:id/status
router.patch('/:id/status', staffAndKitchen, validate(updateOrderStatusSchema), (req, res) => {
  try {
    const updated = updateOrderStatus(req.businessId, req.params.id, req.user.id, req.body.status, req.user);
    emitToRoom(req.businessId, 'order:updated', { order: updated });
    res.json(updated);
  } catch (err) {
    if (err.isNotFound) return res.status(404).json({ error: err.message });
    if (err.isForbidden) return res.status(403).json({ error: err.message });
    if (err.isBadRequest) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// PATCH /api/orders/:orderId/items/:itemId
router.patch('/:orderId/items/:itemId', staffAndKitchen, validate(updateOrderItemSchema), (req, res) => {
  try {
    const order = updateOrderItem(req.businessId, req.params.orderId, req.params.itemId, req.user.id, req.body);
    emitToRoom(req.businessId, 'order:item_updated', { order });
    res.json(order);
  } catch (err) {
    if (err.isNotFound) return res.status(404).json({ error: err.message });
    if (err.isBadRequest || err.status === 400) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

export default router;
