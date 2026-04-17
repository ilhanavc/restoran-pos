import { Router } from 'express';
import { z } from 'zod';
import db from '../config/database.js';
import { authenticate, businessScope, authorize } from '../middleware/auth.js';
import { emitToRoom } from '../socket.js';
import { validate } from '../middleware/validate.js';
import { genId, auditLog, getNextOrderNo, resolveOrderItemPrice } from '../utils/helpers.js';
import {
  enqueueKitchenJobsForSentItems,
  processPendingJobsSync,
  enqueueKitchenAdjustmentJobs,
  enqueueReceiptJobForClosedOrder,
  enqueueTakeawayLabelJob,
} from '../services/printJobs.js';
import { AUTO_PRINT_EVENTS } from '../services/printerAutoPrintPolicy.js';
import { linkCallLogToOrder } from '../services/callerIdService.js';

const router = Router();
router.use(authenticate, businessScope);

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

/**
 * Sipariş satırı özellik seçimlerini doğrular ve fiyat deltasıyla birlikte snapshot döner.
 * @param {string} productId
 * @param {string} categoryId
 * @param {string} businessId
 * @param {Array<{group_id: string, option_ids: string[]}>} selectedAttributes
 * @returns {{ resolvedAttrs: Array, extraPrice: number }}
 */
function normalizeSelectedAttributes(selectedAttributes = []) {
  const byGroup = new Map();
  for (const attr of selectedAttributes || []) {
    if (!attr?.group_id) continue;
    const optionIds = Array.isArray(attr.option_ids)
      ? attr.option_ids
      : attr.option_id
        ? [attr.option_id]
        : [];
    if (optionIds.length === 0) continue;
    const bucket = byGroup.get(attr.group_id) || new Set();
    for (const optionId of optionIds) {
      if (optionId) bucket.add(optionId);
    }
    byGroup.set(attr.group_id, bucket);
  }
  return Array.from(byGroup.entries()).map(([group_id, optionIds]) => ({
    group_id,
    option_ids: Array.from(optionIds),
  }));
}

function resolveSelectedAttributes(productId, categoryId, businessId, selectedAttributes) {
  const normalizedAttributes = normalizeSelectedAttributes(selectedAttributes);
  if (normalizedAttributes.length === 0) {
    return { resolvedAttrs: [], extraPrice: 0 };
  }

  // Efektif özellik gruplarını çek (kategori + ürün)
  const catGroups = categoryId
    ? db
        .prepare(
          `SELECT ag.* FROM category_attribute_groups cag
           JOIN attribute_groups ag ON ag.id = cag.group_id
           WHERE cag.category_id = ? AND cag.business_id = ? AND ag.is_active = 1`,
        )
        .all(categoryId, businessId)
    : [];

  const prodGroups = db
    .prepare(
      `SELECT ag.* FROM product_attribute_groups pag
       JOIN attribute_groups ag ON ag.id = pag.group_id
       WHERE pag.product_id = ? AND pag.business_id = ? AND ag.is_active = 1`,
    )
    .all(productId, businessId);

  const seen = new Set();
  const effectiveGroups = [];
  for (const g of [...prodGroups, ...catGroups]) {
    if (!seen.has(g.id)) {
      seen.add(g.id);
      effectiveGroups.push(g);
    }
  }

  const resolvedAttrs = [];
  let extraPrice = 0;

  for (const sel of normalizedAttributes) {
    const group = effectiveGroups.find((g) => g.id === sel.group_id);
    if (!group) {
      const err = new Error(`Geçersiz özellik grubu: ${sel.group_id}`);
      err.isBadRequest = true;
      throw err;
    }

    // Tekli seçim doğrulama
    if (group.selection_type === 'single' && sel.option_ids.length > 1) {
      const err = new Error(`"${group.name}" grubunda yalnızca tek seçenek seçilebilir`);
      err.isBadRequest = true;
      throw err;
    }

    // Zorunlu grup kontrolü
    if (Number(group.is_required) && sel.option_ids.length === 0) {
      const err = new Error(`"${group.name}" grubu zorunludur`);
      err.isBadRequest = true;
      throw err;
    }

    for (const optId of sel.option_ids) {
      const opt = db
        .prepare(
          'SELECT * FROM attribute_options WHERE id = ? AND group_id = ? AND is_active = 1',
        )
        .get(optId, sel.group_id);
      if (!opt) {
        const err = new Error(`Geçersiz özellik seçeneği: ${optId}`);
        err.isBadRequest = true;
        throw err;
      }
      extraPrice += Number(opt.extra_price) || 0;
      resolvedAttrs.push({
        group_id: group.id,
        group_name: group.name,
        option_id: opt.id,
        option_name: opt.name,
        extra_price: Number(opt.extra_price) || 0,
      });
    }
  }

  // Zorunlu ama hiç gönderilmemiş grupları kontrol et
  for (const g of effectiveGroups) {
    if (!Number(g.is_required)) continue;
    const hasSelection = normalizedAttributes.some((s) => s.group_id === g.id && s.option_ids.length > 0);
    if (!hasSelection) {
      const err = new Error(`"${g.name}" grubu zorunludur`);
      err.isBadRequest = true;
      throw err;
    }
  }

  return { resolvedAttrs, extraPrice };
}

function getOrderPaidTotal(orderId) {
  const row = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE order_id = ?').get(orderId);
  return round2(row?.total || 0);
}

function isOrderFullyPaid(order) {
  return getOrderPaidTotal(order.id) + 0.02 >= round2(order.grand_total || 0);
}

function isOrderTerminalStatus(status) {
  return status === 'closed' || status === 'cancelled';
}

function recordTakeawayDeliveryPaymentIfNeeded(order, businessId, userId) {
  const total = round2(order?.grand_total || 0);
  const paid = getOrderPaidTotal(order.id);
  const due = round2(Math.max(0, total - paid));
  if (due <= 0.02) return null;

  const paymentId = genId();
  const idempotencyKey = `takeaway-delivery:${order.id}`;
  const existing = db.prepare(
    `SELECT id FROM payments WHERE business_id = ? AND order_id = ? AND idempotency_key = ?`,
  ).get(businessId, order.id, idempotencyKey);
  if (existing) return existing.id;

  db.prepare(`INSERT INTO payments (
    id, business_id, order_id, payment_type, amount, cash_received, change_amount, note, idempotency_key, source, created_by
  ) VALUES (?, ?, ?, 'other', ?, ?, 0, ?, ?, 'system_takeaway_delivery', ?)`).run(
    paymentId,
    businessId,
    order.id,
    due,
    due,
    'Paket teslim edildiğinde otomatik ödendi olarak işlendi',
    idempotencyKey,
    userId,
  );
  return paymentId;
}

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
    status: z.enum(orderStatuses, {
      errorMap: () => ({ message: 'Geçerli sipariş durumu gerekli' }),
    }),
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

function assertAllowedItemStatusTransition(currentStatus, nextStatus) {
  if (!nextStatus || nextStatus === currentStatus) return;
  const allowed = {
    new: ['sent', 'cancelled', 'comped'],
    sent: ['preparing', 'ready', 'served', 'cancelled', 'comped'],
    preparing: ['ready', 'served', 'cancelled', 'comped'],
    ready: ['served', 'cancelled', 'comped'],
    served: ['cancelled', 'comped'],
    cancelled: [],
    comped: [],
  };
  if (!(allowed[currentStatus] || []).includes(nextStatus)) {
    const err = new Error('Bu ürün için geçersiz durum geçişi');
    err.status = 400;
    throw err;
  }
}

function selectProductForOrder(productId, businessId) {
  return db.prepare(`
    SELECT p.*, c.name AS category_name, c.printer_target AS category_printer_target
    FROM products p
    JOIN categories c ON c.id = p.category_id AND c.business_id = p.business_id
    WHERE p.id = ? AND p.business_id = ? AND p.is_deleted = 0
  `).get(productId, businessId);
}

function orderItemSnapshot(product) {
  return {
    category_id_snapshot: product.category_id || null,
    category_name_snapshot: product.category_name || null,
    printer_target_snapshot: product.printer_target || product.category_printer_target || 'kitchen',
  };
}

function orderHeaderSnapshot({ tableId, customerId, userId, businessId }) {
  const table = tableId
    ? db.prepare('SELECT name FROM tables WHERE id = ? AND business_id = ?').get(tableId, businessId)
    : null;
  const customer = customerId
    ? db.prepare('SELECT full_name FROM customers WHERE id = ? AND business_id = ?').get(customerId, businessId)
    : null;
  const user = userId
    ? db.prepare('SELECT full_name FROM users WHERE id = ? AND business_id = ?').get(userId, businessId)
    : null;

  return {
    table_name_snapshot: table?.name || null,
    customer_name_snapshot: customer?.full_name || null,
    user_name_snapshot: user?.full_name || null,
  };
}

const staff = authorize('admin', 'cashier', 'waiter');
const staffAndKitchen = authorize('admin', 'cashier', 'waiter', 'kitchen');

function getPrintJobSummary(businessId) {
  const rows = db
    .prepare(`SELECT status, COUNT(*) AS count FROM print_jobs WHERE business_id = ? GROUP BY status`)
    .all(businessId);
  const summary = { pending: 0, printed: 0, failed: 0, cancelled: 0, stale_claimed: 0 };
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(summary, row.status)) {
      summary[row.status] = Number(row.count) || 0;
    }
  }
  const stale = db.prepare(`
    SELECT COUNT(*) AS c
    FROM print_jobs
    WHERE business_id = ?
      AND status = 'pending'
      AND claimed_until IS NOT NULL
      AND datetime(claimed_until) <= datetime('now')
  `).get(businessId);
  summary.stale_claimed = Number(stale?.c) || 0;
  return summary;
}

function assertTableCanOpenOrder(tableId, businessId) {
  if (!tableId) return null;
  const table = db.prepare('SELECT * FROM tables WHERE id = ? AND business_id = ? AND is_active = 1').get(tableId, businessId);
  if (!table) {
    const err = new Error('Masa bulunamadı');
    err.isBadRequest = true;
    throw err;
  }
  if (table.status !== 'empty' || table.current_order_id) {
    const err = new Error('Bu masada zaten açık bir adisyon var');
    err.isBadRequest = true;
    throw err;
  }
  const active = db.prepare(`
    SELECT id FROM orders
    WHERE business_id = ?
      AND table_id = ?
      AND order_type = 'dine_in'
      AND status NOT IN ('closed', 'cancelled')
    LIMIT 1
  `).get(businessId, tableId);
  if (active) {
    const err = new Error('Bu masaya bağlı açık sipariş bulundu');
    err.isBadRequest = true;
    throw err;
  }
  return table;
}

function queueKitchenForNewItems(businessId, orderId, itemIds, userId, options = {}) {
  if (!itemIds?.length) return;
  const placeholders = itemIds.map(() => '?').join(',');
  db.prepare(
    `UPDATE order_items SET status = 'sent', sent_to_kitchen_at = datetime('now') WHERE id IN (${placeholders}) AND order_id = ?`,
  ).run(...itemIds, orderId);

  db.prepare(
    `UPDATE orders SET status = 'in_kitchen', updated_at = datetime('now'), updated_by = ? WHERE id = ? AND business_id = ?
     AND status NOT IN ('closed', 'cancelled')`,
  ).run(userId, orderId, businessId);

  enqueueKitchenJobsForSentItems(businessId, orderId, itemIds, userId, options);
}

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

// GET /api/orders/print-health - operasyon ekranları için yazdırma sağlığı
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

// POST /api/orders/print-jobs/:id/retry - operasyon ekranından başarısız işi tekrar kuyruğa al
router.post('/print-jobs/:id/retry', staff, (req, res) => {
  try {
    const job = db.prepare('SELECT * FROM print_jobs WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!job) return res.status(404).json({ error: 'Yazdırma işi bulunamadı' });
    if (job.status !== 'failed') {
      return res.status(409).json({ error: 'Yalnızca başarısız yazdırma işleri yeniden denenebilir' });
    }
    db.prepare(`
      UPDATE print_jobs
      SET status = 'pending',
          error_message = NULL,
          last_error_code = NULL,
          claimed_at = NULL,
          claimed_by = NULL,
          claimed_until = NULL,
          printed_at = NULL
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

// GET /api/orders/takeaway/open — masalar ekranı yan paneli
router.get('/takeaway/open', staff, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT o.id, o.order_no, o.grand_total, o.created_at, o.status,
        o.takeaway_out_at as takeaway_out_at, o.takeaway_delivered_at as takeaway_delivered_at,
        COALESCE((SELECT SUM(p.amount) FROM payments p WHERE p.order_id = o.id), 0) as paid_total,
        u.full_name as user_name, c.full_name as customer_name
      FROM orders o
      LEFT JOIN users u ON o.user_id = u.id
      LEFT JOIN customers c ON o.customer_id = c.id
      WHERE o.business_id = ?
        AND o.order_type = 'takeaway'
        AND o.status NOT IN ('closed', 'cancelled')
        AND (o.takeaway_delivered_at IS NULL OR o.takeaway_delivered_at = '')
      ORDER BY o.created_at DESC
    `).all(req.businessId);

    const countStmt = db.prepare(`
      SELECT COUNT(*) as c FROM order_items WHERE order_id = ? AND status != 'cancelled'
    `);

    const result = rows.map((o) => ({
      id: o.id,
      order_no: o.order_no,
      total: o.grand_total,
      paid_total: o.paid_total || 0,
      created_at: o.created_at,
      status: o.status,
      user_name: o.user_name || null,
      customer_name: o.customer_name || null,
      takeaway_out_at: o.takeaway_out_at || null,
      takeaway_delivered_at: o.takeaway_delivered_at || null,
      item_count: countStmt.get(o.id).c,
    }));

    res.json(result);
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
    const o = db.prepare(`
      SELECT id, order_type, status, takeaway_out_at, takeaway_delivered_at
      FROM orders WHERE id = ? AND business_id = ?
    `).get(req.params.id, req.businessId);
    if (!o) return res.status(404).json({ error: 'Sipariş bulunamadı' });
    if (o.order_type !== 'takeaway') {
      return res.status(400).json({ error: 'Sadece paket siparişleri güncellenebilir' });
    }
    if (o.takeaway_delivered_at) {
      if (action === 'out_for_delivery') {
        return res.status(400).json({ error: 'Teslim edilmiş sipariş teslimata çıkarılamaz' });
      }
      return res.json({ ok: true, skipped: 'already_delivered' });
    }
    if (['closed', 'cancelled'].includes(o.status)) {
      return res.status(400).json({ error: 'Sipariş kapalı' });
    }
    if (action === 'out_for_delivery') {
      if (o.takeaway_out_at) {
        return res.json({ ok: true, skipped: 'already_out_for_delivery' });
      }
      db.prepare(`UPDATE orders SET takeaway_out_at = datetime('now'), updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
        .run(req.user.id, req.params.id);
      auditLog(req.businessId, req.user.id, 'takeaway_out', 'order', req.params.id, {});
      return res.json({ ok: true });
    }
    if (!o.takeaway_out_at) {
      return res.status(400).json({ error: 'Önce teslimata çıkarılmalı' });
    }
    const fullOrder = db.prepare('SELECT id, grand_total FROM orders WHERE id = ? AND business_id = ?')
      .get(req.params.id, req.businessId);

    const paymentId = db.transaction(() => {
      const createdPaymentId = recordTakeawayDeliveryPaymentIfNeeded(fullOrder, req.businessId, req.user.id);
      db.prepare(`
        UPDATE orders SET takeaway_delivered_at = datetime('now'), status = 'closed', closed_at = datetime('now'),
          updated_at = datetime('now'), updated_by = ? WHERE id = ?
      `).run(req.user.id, req.params.id);
      return createdPaymentId;
    })();

    auditLog(req.businessId, req.user.id, 'takeaway_delivered', 'order', req.params.id, { auto_payment_id: paymentId });
    enqueueReceiptJobForClosedOrder(req.businessId, req.params.id, req.user.id, {
      applyAutoPrintPolicy: true,
      eventType: AUTO_PRINT_EVENTS.RECEIPT_TAKEAWAY_COMPLETE,
    });
    processPendingJobsSync(req.businessId, req.user.id);
    emitToRoom(req.businessId, 'order:takeaway_delivery', { orderId: req.params.id, action });
    return res.json({ ok: true, auto_payment_id: paymentId });
  } catch (err) {
    console.error('Takeaway delivery error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/orders/:id/takeaway/print-label — açık paket sipariş için manuel tekrar yazdırma
router.post('/:id/takeaway/print-label', staff, (req, res) => {
  try {
    const printerId = req.body?.printer_id ? String(req.body.printer_id).trim() : null;
    const order = db.prepare(`
      SELECT id, order_type, status, takeaway_delivered_at
      FROM orders WHERE id = ? AND business_id = ?
    `).get(req.params.id, req.businessId);
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

// POST /api/orders/:id/print-receipt — manuel fiş yazdırma (seçili yazıcı destekli)
router.post('/:id/print-receipt', staff, (req, res) => {
  try {
    const printerId = req.body?.printer_id ? String(req.body.printer_id).trim() : null;
    const order = db.prepare(`
      SELECT id, status
      FROM orders WHERE id = ? AND business_id = ?
    `).get(req.params.id, req.businessId);
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

// GET /api/orders/active - for kitchen screen
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

    order.items = db.prepare(`
      SELECT * FROM order_items WHERE order_id = ? ORDER BY created_at
    `).all(order.id);

    order.payments = db.prepare(`
      SELECT * FROM payments WHERE order_id = ? ORDER BY created_at
    `).all(order.id);

    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// PATCH /api/orders/:id/customer — açık salon siparişine kayıtlı müşteri bağla / kaldır
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
    const { table_id, order_type, customer_id, call_log_id, items, note, guest_count, delivery_address, delivery_note, courier_note } = req.body;

    if (!items || !items.length) {
      return res.status(400).json({ error: 'Sipariş için en az bir ürün gerekli' });
    }

    // Paket siparişte masa kimliği geçersiz — masa yanlışlıkla occupied kalır
    const resolvedType = order_type || 'dine_in';
    if (resolvedType === 'takeaway' && table_id) {
      return res.status(400).json({ error: 'Paket siparişlerde masa kimliği (table_id) gönderilemez' });
    }

    const orderId = genId();
    let createdItemIds = [];

    const txn = db.transaction(() => {
      const orderNo = getNextOrderNo(req.businessId);

      if (resolvedType === 'dine_in' && table_id) {
        assertTableCanOpenOrder(table_id, req.businessId);
      }

      let subtotal = 0;
      const lines = [];

      for (const item of items) {
        const product = selectProductForOrder(item.product_id, req.businessId);
        if (!product) {
          const err = new Error(`Ürün bulunamadı: ${item.product_id}`);
          err.isBadRequest = true;
          throw err;
        }

        const { itemPrice, resolved, portionLabel } = resolveOrderItemPrice(
          product,
          item.modifiers,
          req.businessId,
          item.portion_id || null,
        );

        const { resolvedAttrs, extraPrice } = resolveSelectedAttributes(
          product.id,
          product.category_id,
          req.businessId,
          item.selected_attributes || [],
        );

        const finalPrice = itemPrice + extraPrice;
        const qty = item.quantity || 1;
        const lineTotal = finalPrice * qty;
        subtotal += lineTotal;

        lines.push({
          product,
          qty,
          itemPrice: finalPrice,
          resolved,
          resolvedAttrs,
          note: item.note || null,
          portion_id: item.portion_id || null,
          portion_label: portionLabel,
          snapshot: orderItemSnapshot(product),
        });
      }

      const vatTotal = 0;
      const grandTotal = subtotal;
      const headerSnapshot = orderHeaderSnapshot({
        tableId: table_id || null,
        customerId: customer_id || null,
        userId: req.user.id,
        businessId: req.businessId,
      });

      db.prepare(`INSERT INTO orders (id, business_id, branch_id, order_no, order_type, table_id, customer_id, user_id, 
        subtotal, vat_total, grand_total, note, delivery_address, delivery_note, courier_note, guest_count,
        table_name_snapshot, customer_name_snapshot, user_name_snapshot, status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'saved', ?)`).run(
        orderId, req.businessId, req.branchId, orderNo, order_type || 'dine_in',
        table_id || null, customer_id || null, req.user.id,
        subtotal, vatTotal, grandTotal, note || null,
        delivery_address || null, delivery_note || null, courier_note || null,
        guest_count || 0,
        headerSnapshot.table_name_snapshot, headerSnapshot.customer_name_snapshot, headerSnapshot.user_name_snapshot,
        req.user.id
      );

      const insertItem = db.prepare(`INSERT INTO order_items (
        id, order_id, product_id, product_name, quantity, unit_price, modifiers, note, vat_rate,
        category_id_snapshot, category_name_snapshot, printer_target_snapshot,
        created_by, portion_id, portion_label, selected_attributes
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      createdItemIds = [];
      for (const line of lines) {
        const itemId = genId();
        createdItemIds.push(itemId);
        insertItem.run(
          itemId, orderId, line.product.id, line.product.name, line.qty, line.itemPrice,
          JSON.stringify(line.resolved), line.note, 0,
          line.snapshot.category_id_snapshot, line.snapshot.category_name_snapshot, line.snapshot.printer_target_snapshot,
          req.user.id,
          line.portion_id || null, line.portion_label || null,
          JSON.stringify(line.resolvedAttrs || []),
        );
      }

      if (table_id) {
        const info = db.prepare(
          `UPDATE tables
           SET status = 'occupied', current_order_id = ?, guest_count = ?, updated_at = datetime('now')
           WHERE id = ? AND business_id = ? AND status = 'empty' AND current_order_id IS NULL`,
        ).run(orderId, guest_count || 0, table_id, req.businessId);
        if (info.changes !== 1) {
          const err = new Error('Masa başka bir işlem tarafından açılmış olabilir. Lütfen masaları yenileyin.');
          err.isBadRequest = true;
          throw err;
        }
      }

      if ((order_type || 'dine_in') === 'takeaway') {
        enqueueTakeawayLabelJob(req.businessId, orderId, req.user.id);
      }

      if (call_log_id) {
        linkCallLogToOrder(req.businessId, call_log_id, orderId);
      }

      queueKitchenForNewItems(req.businessId, orderId, createdItemIds, req.user.id, {
        eventType:
          (order_type || 'dine_in') === 'takeaway'
            ? AUTO_PRINT_EVENTS.KITCHEN_TAKEAWAY_ORDER_CREATE
            : AUTO_PRINT_EVENTS.KITCHEN_TABLE_ORDER_CREATE,
      });
    });

    txn();
    processPendingJobsSync(req.businessId, req.user.id);

    auditLog(req.businessId, req.user.id, 'order_create', 'order', orderId, { order_type, table_id });

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
    emitToRoom(req.businessId, 'order:created', { order });
    res.status(201).json(order);
  } catch (err) {
    if (err.isBadRequest) {
      return res.status(400).json({ error: err.message });
    }
    console.error('Order create error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/orders/:id/items - add items to existing order
router.post('/:id/items', staff, validate(addItemsSchema), (req, res) => {
  try {
    const { items } = req.body;
    if (!items || !Array.isArray(items) || items.length === 0) {
      return res.status(400).json({ error: 'Eklenecek ürün listesi gerekli' });
    }

    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });
    if (order.status === 'closed' || order.status === 'cancelled') {
      return res.status(400).json({ error: 'Kapalı siparişe ürün eklenemez' });
    }

    let newItemIds = [];
    const txn = db.transaction(() => {
      let addedSubtotal = 0;

      for (const item of items) {
        const product = selectProductForOrder(item.product_id, req.businessId);
        if (!product) {
          const err = new Error(`Ürün bulunamadı: ${item.product_id}`);
          err.isBadRequest = true;
          throw err;
        }

        const { itemPrice, resolved, portionLabel } = resolveOrderItemPrice(
          product,
          item.modifiers,
          req.businessId,
          item.portion_id || null,
        );

        const { resolvedAttrs: itemResolvedAttrs, extraPrice: itemExtraPrice } = resolveSelectedAttributes(
          product.id,
          product.category_id,
          req.businessId,
          item.selected_attributes || [],
        );

        const finalItemPrice = itemPrice + itemExtraPrice;
        const qty = item.quantity || 1;
        addedSubtotal += finalItemPrice * qty;

        const itemId = genId();
        newItemIds.push(itemId);
        const snapshot = orderItemSnapshot(product);
        db.prepare(`INSERT INTO order_items (
          id, order_id, product_id, product_name, quantity, unit_price, modifiers, note, vat_rate,
          category_id_snapshot, category_name_snapshot, printer_target_snapshot,
          created_by, portion_id, portion_label, selected_attributes
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          itemId, order.id, product.id, product.name, qty, finalItemPrice,
          JSON.stringify(resolved), item.note || null, 0,
          snapshot.category_id_snapshot, snapshot.category_name_snapshot, snapshot.printer_target_snapshot,
          req.user.id,
          item.portion_id || null, portionLabel,
          JSON.stringify(itemResolvedAttrs || []),
        );
      }

      db.prepare(`UPDATE orders SET subtotal = subtotal + ?, vat_total = 0, 
        grand_total = grand_total + ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
        .run(addedSubtotal, addedSubtotal, req.user.id, order.id);

      queueKitchenForNewItems(req.businessId, order.id, newItemIds, req.user.id, {
        eventType: AUTO_PRINT_EVENTS.KITCHEN_ORDER_ADJUSTMENT,
      });
    });
    txn();
    processPendingJobsSync(req.businessId, req.user.id);

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    updated.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    emitToRoom(req.businessId, 'order:items_added', { order: updated });
    res.json(updated);
  } catch (err) {
    if (err.isBadRequest) {
      return res.status(400).json({ error: err.message });
    }
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// PATCH /api/orders/:id/status
router.patch('/:id/status', staffAndKitchen, validate(updateOrderStatusSchema), (req, res) => {
  try {
    const { status } = req.body;
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });

    if (status === 'cancelled') {
      const canCancel = req.user.permissions?.all || ['admin', 'cashier', 'waiter'].includes(req.user.role_slug);
      if (!canCancel) {
        return res.status(403).json({ error: 'Bu işlem için yetkiniz yok' });
      }
      if (order.status === 'closed' || order.status === 'cancelled') {
        return res.status(400).json({ error: 'Sipariş zaten kapalı veya iptal edilmiş' });
      }
      const payments = db.prepare('SELECT COUNT(*) as c FROM payments WHERE order_id = ?').get(order.id);
      if (payments.c > 0) {
        return res.status(400).json({ error: 'Ödeme kaydı olan sipariş iptal edilemez' });
      }

      const txn = db.transaction(() => {
        db.prepare(
          `UPDATE orders SET status = 'cancelled', updated_at = datetime('now'), updated_by = ? WHERE id = ? AND business_id = ?`,
        ).run(req.user.id, order.id, req.businessId);
        db.prepare(
          `UPDATE tables SET status = 'empty', current_order_id = NULL, guest_count = 0, updated_at = datetime('now')
           WHERE business_id = ? AND current_order_id = ?`,
        ).run(req.businessId, order.id);
        db.prepare(`UPDATE order_items SET status = 'cancelled' WHERE order_id = ?`).run(order.id);
      });
      txn();

      auditLog(req.businessId, req.user.id, 'order_cancelled', 'order', req.params.id);

      const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
      updated.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
      emitToRoom(req.businessId, 'order:updated', { order: updated });
      return res.json(updated);
    }

    if (status === 'closed') {
      if (order.status === 'closed') {
        return res.status(400).json({ error: 'Sipariş zaten kapalı' });
      }
      if (order.status === 'cancelled') {
        return res.status(400).json({ error: 'İptal sipariş kapatılamaz' });
      }
    }

    if (status === 'cancelled' && order.status === 'closed') {
      return res.status(400).json({ error: 'Kapalı sipariş iptal edilemez' });
    }

    let sentItemIds = [];
    if (status === 'in_kitchen') {
      const rows = db.prepare(`SELECT id FROM order_items WHERE order_id = ? AND status = 'new'`).all(order.id);
      sentItemIds = rows.map((r) => r.id);
    }

    const updates = ['status = ?', `updated_at = datetime('now')`, 'updated_by = ?'];
    const params = [status, req.user.id];

    if (status === 'closed') {
      if (!isOrderFullyPaid(order)) {
        return res.status(400).json({ error: 'Ödeme tamamlanmadan sipariş kapatılamaz' });
      }
      updates.push(`closed_at = datetime('now')`);
    }
    params.push(req.params.id, req.businessId);

    db.transaction(() => {
      if (status === 'in_kitchen' && sentItemIds.length) {
        db.prepare(`UPDATE order_items SET status = 'sent', sent_to_kitchen_at = datetime('now') WHERE order_id = ? AND status = 'new'`)
          .run(order.id);
      }
      db.prepare(`UPDATE orders SET ${updates.join(', ')} WHERE id = ? AND business_id = ?`).run(...params);
      if (status === 'closed' && order.table_id) {
        db.prepare(
          `UPDATE tables SET status = 'empty', current_order_id = NULL, guest_count = 0, updated_at = datetime('now')
           WHERE business_id = ? AND current_order_id = ?`,
        ).run(req.businessId, order.id);
      }
      if (status === 'closed' && order.customer_id && !isOrderTerminalStatus(order.status)) {
        db.prepare("UPDATE customers SET total_orders = total_orders + 1, last_order_at = datetime('now') WHERE id = ?")
          .run(order.customer_id);
      }
    })();

    auditLog(req.businessId, req.user.id, `order_${status}`, 'order', req.params.id);

    if (status === 'in_kitchen' && sentItemIds.length) {
      enqueueKitchenJobsForSentItems(req.businessId, order.id, sentItemIds, req.user.id);
      processPendingJobsSync(req.businessId, req.user.id);
    }

    if (status === 'closed' && order.order_type !== 'takeaway') {
      enqueueReceiptJobForClosedOrder(req.businessId, order.id, req.user.id, {
        applyAutoPrintPolicy: true,
        eventType: AUTO_PRINT_EVENTS.RECEIPT_TABLE_CLOSE,
      });
      processPendingJobsSync(req.businessId, req.user.id);
    }

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    updated.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    emitToRoom(req.businessId, 'order:updated', { order: updated });
    res.json(updated);
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// PATCH /api/orders/:orderId/items/:itemId
router.patch('/:orderId/items/:itemId', staffAndKitchen, validate(updateOrderItemSchema), (req, res) => {
  try {
    const { status, quantity, note, is_comped, comp_reason, portion_id: portionIdBody } = req.body;
    const item = db.prepare(`SELECT oi.*, o.status AS order_status FROM order_items oi 
      JOIN orders o ON oi.order_id = o.id
      WHERE oi.id = ? AND oi.order_id = ? AND o.business_id = ?`).get(req.params.itemId, req.params.orderId, req.businessId);
    if (!item) return res.status(404).json({ error: 'Ürün bulunamadı' });
    if (['closed', 'cancelled'].includes(item.order_status)) {
      return res.status(400).json({ error: 'Kapalı siparişte satır değiştirilemez' });
    }
    assertAllowedItemStatusTransition(item.status, status);

    const prevStatus = item.status;
    const prevQty = item.quantity;
    const beforeSnap = {
      id: item.id,
      product_id: item.product_id,
      product_name: item.product_name,
      quantity: item.quantity,
      note: item.note,
      status: item.status,
      portion_label: item.portion_label,
    };

    const sets = [];
    const params = [];
    if (status !== undefined) { sets.push('status = ?'); params.push(status); }
    if (quantity !== undefined) { sets.push('quantity = ?'); params.push(quantity); }
    if (note !== undefined) { sets.push('note = ?'); params.push(note); }
    if (is_comped !== undefined) { sets.push('is_comped = ?'); params.push(is_comped ? 1 : 0); }
    if (comp_reason !== undefined) { sets.push('comp_reason = ?'); params.push(comp_reason); }
    if (status === 'preparing') { sets.push(`prepared_at = datetime('now')`); }

    if (portionIdBody !== undefined) {
      if (item.status !== 'new') {
        return res.status(400).json({ error: 'Porsiyon yalnızca mutfağa gönderilmemiş satırlarda değiştirilebilir' });
      }
      const product = db.prepare('SELECT * FROM products WHERE id = ? AND business_id = ?').get(item.product_id, req.businessId);
      if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });
      let modifiersInput = [];
      try {
        modifiersInput = JSON.parse(item.modifiers || '[]');
      } catch {
        modifiersInput = [];
      }
      const { itemPrice, resolved, portionLabel } = resolveOrderItemPrice(
        product,
        modifiersInput,
        req.businessId,
        portionIdBody || null,
      );
      sets.push('unit_price = ?'); params.push(itemPrice);
      sets.push('modifiers = ?'); params.push(JSON.stringify(resolved));
      sets.push('portion_id = ?'); params.push(portionIdBody || null);
      sets.push('portion_label = ?'); params.push(portionLabel);
    }

    const shouldEnqueueCancel = status === 'cancelled' && prevStatus !== 'cancelled';
    const nq = quantity !== undefined ? Number(quantity) : null;
    const shouldEnqueueReduce = quantity !== undefined && prevStatus !== 'cancelled' && Number.isFinite(nq) && nq >= 1 && nq < prevQty;
    let shouldProcessPrintJobs = false;
    db.transaction(() => {
      if (sets.length) {
        params.push(req.params.itemId);
        db.prepare(`UPDATE order_items SET ${sets.join(', ')} WHERE id = ?`).run(...params);
      }

      recalcOrderTotals(req.params.orderId);
      autoCancelOrderIfNoActiveItems(req.params.orderId, req.businessId, req.user.id);

      if (shouldEnqueueCancel) {
        enqueueKitchenAdjustmentJobs(
          req.businessId,
          req.params.orderId,
          beforeSnap,
          { type: 'cancel' },
          req.user.id,
          { eventType: AUTO_PRINT_EVENTS.KITCHEN_ORDER_ADJUSTMENT },
        );
        shouldProcessPrintJobs = true;
      } else if (shouldEnqueueReduce) {
        enqueueKitchenAdjustmentJobs(
          req.businessId,
          req.params.orderId,
          beforeSnap,
          { type: 'reduce', previousQty: prevQty, newQty: nq },
          req.user.id,
          { eventType: AUTO_PRINT_EVENTS.KITCHEN_ORDER_ADJUSTMENT },
        );
        shouldProcessPrintJobs = true;
      }
    })();

    if (shouldProcessPrintJobs) {
      processPendingJobsSync(req.businessId, req.user.id);
    }

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId);
    order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    emitToRoom(req.businessId, 'order:item_updated', { order });
    res.json(order);
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

function recalcOrderTotals(orderId) {
  const items = db.prepare(`SELECT * FROM order_items WHERE order_id = ? AND status != 'cancelled'`).all(orderId);
  let subtotal = 0;
  for (const item of items) {
    if (item.is_comped) continue;
    const line = item.unit_price * item.quantity - (item.discount_amount || 0);
    subtotal += line;
  }
  const order = db.prepare('SELECT discount_amount FROM orders WHERE id = ?').get(orderId);
  const grandTotal = subtotal - (order?.discount_amount || 0);
  db.prepare("UPDATE orders SET subtotal = ?, vat_total = 0, grand_total = ?, updated_at = datetime('now') WHERE id = ?")
    .run(subtotal, grandTotal, orderId);
}

/** Tüm satırlar iptal edildiğinde ve ödeme yoksa siparişi iptal et ve masayı boşalt. */
function autoCancelOrderIfNoActiveItems(orderId, businessId, userId) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND business_id = ?').get(orderId, businessId);
  if (!order || ['closed', 'cancelled'].includes(order.status)) return;

  const active = db.prepare(
    `SELECT COUNT(*) as c FROM order_items WHERE order_id = ? AND status != 'cancelled'`,
  ).get(orderId);
  if (active.c > 0) return;

  const payments = db.prepare('SELECT COUNT(*) as c FROM payments WHERE order_id = ?').get(orderId);
  if (payments.c > 0) return;

  db.prepare(
    `UPDATE orders SET status = 'cancelled', updated_at = datetime('now'), updated_by = ? WHERE id = ? AND business_id = ?`,
  ).run(userId, orderId, businessId);
  db.prepare(
    `UPDATE tables SET status = 'empty', current_order_id = NULL, guest_count = 0, updated_at = datetime('now')
     WHERE business_id = ? AND current_order_id = ?`,
  ).run(businessId, orderId);
  db.prepare(`UPDATE order_items SET status = 'cancelled' WHERE order_id = ?`).run(orderId);

  auditLog(businessId, userId, 'order_cancelled_empty_items', 'order', orderId);
}

export default router;
