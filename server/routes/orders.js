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

const router = Router();
router.use(authenticate, businessScope);

const orderItemSchema = z.object({
  product_id: z.string().min(1),
  quantity: z.number().int().positive().max(999).default(1),
  portion_id: z.string().optional().nullable(),
  modifiers: z.array(z.any()).optional(),
  note: z.string().max(500).optional().nullable(),
});

const createOrderSchema = {
  body: z.object({
    order_type: z.enum(['dine_in', 'takeaway', 'delivery']).optional(),
    table_id: z.string().optional().nullable(),
    customer_id: z.string().optional().nullable(),
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

const staff = authorize('admin', 'cashier', 'waiter');
const staffAndKitchen = authorize('admin', 'cashier', 'waiter', 'kitchen');

/** Yeni eklenen kalemler için mutfak job + satır sent + sipariş mutfakta (kapalı/iptal hariç). */
function finalizeKitchenForNewItems(businessId, orderId, itemIds, userId) {
  if (!itemIds?.length) return;
  const placeholders = itemIds.map(() => '?').join(',');
  db.prepare(
    `UPDATE order_items SET status = 'sent', sent_to_kitchen_at = datetime('now') WHERE id IN (${placeholders}) AND order_id = ?`,
  ).run(...itemIds, orderId);

  db.prepare(
    `UPDATE orders SET status = 'in_kitchen', updated_at = datetime('now'), updated_by = ? WHERE id = ? AND business_id = ?
     AND status NOT IN ('closed', 'cancelled')`,
  ).run(userId, orderId, businessId);

  enqueueKitchenJobsForSentItems(businessId, orderId, itemIds, userId);
  processPendingJobsSync(businessId, userId);
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

// GET /api/orders/takeaway/open — masalar ekranı yan paneli
router.get('/takeaway/open', staff, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT o.id, o.order_no, o.grand_total, o.created_at, o.status,
        o.takeaway_out_at as takeaway_out_at, o.takeaway_delivered_at as takeaway_delivered_at,
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
    if (['closed', 'cancelled'].includes(o.status)) {
      return res.status(400).json({ error: 'Sipariş kapalı' });
    }
    if (o.takeaway_delivered_at) {
      if (action === 'out_for_delivery') {
        return res.status(400).json({ error: 'Teslim edilmiş sipariş teslimata çıkarılamaz' });
      }
      return res.json({ ok: true, skipped: 'already_delivered' });
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
    db.prepare(`
      UPDATE orders SET takeaway_delivered_at = datetime('now'), status = 'closed', closed_at = datetime('now'),
        updated_at = datetime('now'), updated_by = ? WHERE id = ?
    `).run(req.user.id, req.params.id);
    auditLog(req.businessId, req.user.id, 'takeaway_delivered', 'order', req.params.id, {});
    emitToRoom(req.businessId, 'order:takeaway_delivery', { orderId: req.params.id, action });
    return res.json({ ok: true });
  } catch (err) {
    console.error('Takeaway delivery error:', err);
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
    if (cid) {
      const cust = db.prepare('SELECT id FROM customers WHERE id = ? AND business_id = ?').get(cid, req.businessId);
      if (!cust) return res.status(400).json({ error: 'Müşteri bulunamadı' });
    } else {
      cid = null;
    }

    db.prepare(
      `UPDATE orders SET customer_id = ?, updated_at = datetime('now'), updated_by = ? WHERE id = ? AND business_id = ?`,
    ).run(cid, req.user.id, req.params.id, req.businessId);

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
    const { table_id, order_type, customer_id, items, note, guest_count, delivery_address, delivery_note, courier_note } = req.body;

    if (!items || !items.length) {
      return res.status(400).json({ error: 'Sipariş için en az bir ürün gerekli' });
    }

    const orderId = genId();
    let createdItemIds = [];

    const txn = db.transaction(() => {
      const orderNo = getNextOrderNo(req.businessId);

      let subtotal = 0;
      const lines = [];

      for (const item of items) {
        const product = db.prepare('SELECT * FROM products WHERE id = ? AND business_id = ?').get(item.product_id, req.businessId);
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

        const qty = item.quantity || 1;
        const lineTotal = itemPrice * qty;
        subtotal += lineTotal;

        lines.push({
          product,
          qty,
          itemPrice,
          resolved,
          note: item.note || null,
          portion_id: item.portion_id || null,
          portion_label: portionLabel,
        });
      }

      const vatTotal = 0;
      const grandTotal = subtotal;

      db.prepare(`INSERT INTO orders (id, business_id, branch_id, order_no, order_type, table_id, customer_id, user_id, 
        subtotal, vat_total, grand_total, note, delivery_address, delivery_note, courier_note, guest_count, status, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'saved', ?)`).run(
        orderId, req.businessId, req.branchId, orderNo, order_type || 'dine_in',
        table_id || null, customer_id || null, req.user.id,
        subtotal, vatTotal, grandTotal, note || null,
        delivery_address || null, delivery_note || null, courier_note || null,
        guest_count || 0, req.user.id
      );

      const insertItem = db.prepare(`INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, modifiers, note, vat_rate, created_by, portion_id, portion_label)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
      createdItemIds = [];
      for (const line of lines) {
        const itemId = genId();
        createdItemIds.push(itemId);
        insertItem.run(
          itemId, orderId, line.product.id, line.product.name, line.qty, line.itemPrice,
          JSON.stringify(line.resolved), line.note, 0, req.user.id,
          line.portion_id || null, line.portion_label || null,
        );
      }

      if (table_id) {
        db.prepare("UPDATE tables SET status = 'occupied', current_order_id = ?, guest_count = ?, updated_at = datetime('now') WHERE id = ?")
          .run(orderId, guest_count || 0, table_id);
      }
    });

    txn();

    if ((order_type || 'dine_in') === 'takeaway') {
      enqueueTakeawayLabelJob(req.businessId, orderId, req.user.id);
    }

    finalizeKitchenForNewItems(req.businessId, orderId, createdItemIds, req.user.id);

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
    res.status(500).json({ error: err.message || 'Sunucu hatası' });
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
        const product = db.prepare('SELECT * FROM products WHERE id = ? AND business_id = ?').get(item.product_id, req.businessId);
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

        const qty = item.quantity || 1;
        addedSubtotal += itemPrice * qty;

        const itemId = genId();
        newItemIds.push(itemId);
        db.prepare(`INSERT INTO order_items (id, order_id, product_id, product_name, quantity, unit_price, modifiers, note, vat_rate, created_by, portion_id, portion_label)
          VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
          itemId, order.id, product.id, product.name, qty, itemPrice,
          JSON.stringify(resolved), item.note || null, 0, req.user.id,
          item.portion_id || null, portionLabel,
        );
      }

      db.prepare(`UPDATE orders SET subtotal = subtotal + ?, vat_total = 0, 
        grand_total = grand_total + ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
        .run(addedSubtotal, addedSubtotal, req.user.id, order.id);
    });
    txn();

    finalizeKitchenForNewItems(req.businessId, order.id, newItemIds, req.user.id);

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
router.patch('/:id/status', staffAndKitchen, (req, res) => {
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
      return res.json(updated);
    }

    let sentItemIds = [];
    if (status === 'in_kitchen') {
      const rows = db.prepare(`SELECT id FROM order_items WHERE order_id = ? AND status = 'new'`).all(order.id);
      sentItemIds = rows.map((r) => r.id);
    }

    const updates = ['status = ?', `updated_at = datetime('now')`, 'updated_by = ?'];
    const params = [status, req.user.id];

    if (status === 'closed') {
      updates.push(`closed_at = datetime('now')`);
    }
    params.push(req.params.id, req.businessId);

    db.transaction(() => {
      if (status === 'in_kitchen' && sentItemIds.length) {
        db.prepare(`UPDATE order_items SET status = 'sent', sent_to_kitchen_at = datetime('now') WHERE order_id = ? AND status = 'new'`)
          .run(order.id);
      }
      db.prepare(`UPDATE orders SET ${updates.join(', ')} WHERE id = ? AND business_id = ?`).run(...params);
    })();

    auditLog(req.businessId, req.user.id, `order_${status}`, 'order', req.params.id);

    if (status === 'in_kitchen' && sentItemIds.length) {
      enqueueKitchenJobsForSentItems(req.businessId, order.id, sentItemIds, req.user.id);
      processPendingJobsSync(req.businessId, req.user.id);
    }

    if (status === 'closed' && order.order_type !== 'takeaway') {
      enqueueReceiptJobForClosedOrder(req.businessId, order.id, req.user.id);
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
router.patch('/:orderId/items/:itemId', staffAndKitchen, (req, res) => {
  try {
    const { status, quantity, note, is_comped, comp_reason, portion_id: portionIdBody } = req.body;
    const item = db.prepare(`SELECT oi.*, o.status AS order_status FROM order_items oi 
      JOIN orders o ON oi.order_id = o.id
      WHERE oi.id = ? AND oi.order_id = ? AND o.business_id = ?`).get(req.params.itemId, req.params.orderId, req.businessId);
    if (!item) return res.status(404).json({ error: 'Ürün bulunamadı' });
    if (['closed', 'cancelled'].includes(item.order_status)) {
      return res.status(400).json({ error: 'Kapalı siparişte satır değiştirilemez' });
    }

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

    if (sets.length) {
      params.push(req.params.itemId);
      db.prepare(`UPDATE order_items SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }

    recalcOrderTotals(req.params.orderId);
    autoCancelOrderIfNoActiveItems(req.params.orderId, req.businessId, req.user.id);

    if (status === 'cancelled' && prevStatus !== 'cancelled') {
      enqueueKitchenAdjustmentJobs(req.businessId, req.params.orderId, beforeSnap, { type: 'cancel' }, req.user.id);
      processPendingJobsSync(req.businessId, req.user.id);
    } else if (quantity !== undefined && prevStatus !== 'cancelled') {
      const nq = parseInt(String(quantity), 10);
      if (Number.isFinite(nq) && nq >= 1 && nq < prevQty) {
        enqueueKitchenAdjustmentJobs(
          req.businessId,
          req.params.orderId,
          beforeSnap,
          { type: 'reduce', previousQty: prevQty, newQty: nq },
          req.user.id,
        );
        processPendingJobsSync(req.businessId, req.user.id);
      }
    }

    const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.orderId);
    order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    emitToRoom(req.businessId, 'order:item_updated', { order });
    res.json(order);
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// PATCH /api/orders/:id/discount
router.patch('/:id/discount', authorize('admin', 'cashier'), (req, res) => {
  try {
    const { discount_amount, discount_percent } = req.body;
    const order = db.prepare('SELECT * FROM orders WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });
    const paymentCount = db.prepare('SELECT COUNT(*) as c FROM payments WHERE order_id = ?').get(order.id);
    if ((paymentCount?.c || 0) > 0) {
      return res.status(400).json({ error: 'Ödeme alındıktan sonra indirim değiştirilemez' });
    }

    const pct = discount_percent != null && discount_percent !== '' ? parseFloat(discount_percent) : null;
    const amt = discount_amount != null && discount_amount !== '' ? parseFloat(discount_amount) : null;

    let discAmt = 0;
    let storedPercent = 0;
    if (pct != null && !Number.isNaN(pct) && pct > 0) {
      discAmt = order.subtotal * (pct / 100);
      storedPercent = pct;
    } else if (amt != null && !Number.isNaN(amt) && amt >= 0) {
      discAmt = amt;
    }

    db.prepare(`UPDATE orders SET discount_amount = ?, discount_percent = ?, 
      grand_total = subtotal - ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`)
      .run(discAmt, storedPercent, discAmt, req.user.id, req.params.id);

    auditLog(req.businessId, req.user.id, 'order_discount', 'order', req.params.id, { discount_amount: discAmt, discount_percent: storedPercent });

    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(req.params.id);
    updated.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(order.id);
    res.json(updated);
  } catch (err) {
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

  const txn = db.transaction(() => {
    db.prepare(
      `UPDATE orders SET status = 'cancelled', updated_at = datetime('now'), updated_by = ? WHERE id = ? AND business_id = ?`,
    ).run(userId, orderId, businessId);
    db.prepare(
      `UPDATE tables SET status = 'empty', current_order_id = NULL, guest_count = 0, updated_at = datetime('now')
       WHERE business_id = ? AND current_order_id = ?`,
    ).run(businessId, orderId);
    db.prepare(`UPDATE order_items SET status = 'cancelled' WHERE order_id = ?`).run(orderId);
  });
  txn();

  auditLog(businessId, userId, 'order_cancelled_empty_items', 'order', orderId);
}

export default router;
