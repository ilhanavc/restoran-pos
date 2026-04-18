import db from '../config/database.js';
import { genId, auditLog, getNextOrderNo, resolveOrderItemPrice } from '../utils/helpers.js';
import {
  enqueueKitchenJobsForSentItems,
  processPendingJobsSync,
  enqueueKitchenAdjustmentJobs,
  enqueueReceiptJobForClosedOrder,
  enqueueTakeawayLabelJob,
} from './printJobs.js';
import { AUTO_PRINT_EVENTS } from './printerAutoPrintPolicy.js';
import { linkCallLogToOrder } from './callerIdService.js';
import { assertPeriodOpenForMutation } from './periodCloseService.js';
import { recordEntityMutation } from './entityMutationService.js';

export function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function normalizeSelectedAttributes(selectedAttributes = []) {
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

export function resolveSelectedAttributes(productId, categoryId, businessId, selectedAttributes) {
  const normalizedAttributes = normalizeSelectedAttributes(selectedAttributes);
  if (normalizedAttributes.length === 0) return { resolvedAttrs: [], extraPrice: 0 };

  const catGroups = categoryId
    ? db.prepare(
        `SELECT ag.* FROM category_attribute_groups cag
         JOIN attribute_groups ag ON ag.id = cag.group_id
         WHERE cag.category_id = ? AND cag.business_id = ? AND ag.is_active = 1`,
      ).all(categoryId, businessId)
    : [];

  const prodGroups = db.prepare(
    `SELECT ag.* FROM product_attribute_groups pag
     JOIN attribute_groups ag ON ag.id = pag.group_id
     WHERE pag.product_id = ? AND pag.business_id = ? AND ag.is_active = 1`,
  ).all(productId, businessId);

  const seen = new Set();
  const effectiveGroups = [];
  for (const g of [...prodGroups, ...catGroups]) {
    if (!seen.has(g.id)) { seen.add(g.id); effectiveGroups.push(g); }
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
    if (group.selection_type === 'single' && sel.option_ids.length > 1) {
      const err = new Error(`"${group.name}" grubunda yalnızca tek seçenek seçilebilir`);
      err.isBadRequest = true;
      throw err;
    }
    if (Number(group.is_required) && sel.option_ids.length === 0) {
      const err = new Error(`"${group.name}" grubu zorunludur`);
      err.isBadRequest = true;
      throw err;
    }
    for (const optId of sel.option_ids) {
      const opt = db.prepare(
        'SELECT * FROM attribute_options WHERE id = ? AND group_id = ? AND is_active = 1',
      ).get(optId, sel.group_id);
      if (!opt) {
        const err = new Error(`Geçersiz özellik seçeneği: ${optId}`);
        err.isBadRequest = true;
        throw err;
      }
      extraPrice += Number(opt.extra_price) || 0;
      resolvedAttrs.push({
        group_id: group.id, group_name: group.name,
        option_id: opt.id, option_name: opt.name,
        extra_price: Number(opt.extra_price) || 0,
      });
    }
  }

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

export function getOrderPaidTotal(orderId) {
  const row = db.prepare('SELECT COALESCE(SUM(amount), 0) as total FROM payments WHERE order_id = ?').get(orderId);
  return round2(row?.total || 0);
}

export function isOrderFullyPaid(order) {
  return getOrderPaidTotal(order.id) + 0.02 >= round2(order.grand_total || 0);
}

export function isOrderTerminalStatus(status) {
  return status === 'closed' || status === 'cancelled';
}

export function recordTakeawayDeliveryPaymentIfNeeded(order, businessId, userId) {
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
    paymentId, businessId, order.id, due, due,
    'Paket teslim edildiğinde otomatik ödendi olarak işlendi',
    idempotencyKey, userId,
  );
  return paymentId;
}

export function assertAllowedItemStatusTransition(currentStatus, nextStatus) {
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

export function selectProductForOrder(productId, businessId) {
  return db.prepare(`
    SELECT p.*, c.name AS category_name, c.printer_target AS category_printer_target
    FROM products p
    JOIN categories c ON c.id = p.category_id AND c.business_id = p.business_id
    WHERE p.id = ? AND p.business_id = ? AND p.is_deleted = 0
  `).get(productId, businessId);
}

export function orderItemSnapshot(product) {
  return {
    category_id_snapshot: product.category_id || null,
    category_name_snapshot: product.category_name || null,
    printer_target_snapshot: product.printer_target || product.category_printer_target || 'kitchen',
  };
}

export function orderHeaderSnapshot({ tableId, customerId, userId, businessId }) {
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

export function getPrintJobSummary(businessId) {
  const rows = db.prepare(
    `SELECT status, COUNT(*) AS count FROM print_jobs WHERE business_id = ? GROUP BY status`,
  ).all(businessId);
  const summary = { pending: 0, printed: 0, failed: 0, cancelled: 0, stale_claimed: 0 };
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(summary, row.status)) {
      summary[row.status] = Number(row.count) || 0;
    }
  }
  const stale = db.prepare(`
    SELECT COUNT(*) AS c FROM print_jobs
    WHERE business_id = ? AND status = 'pending'
      AND claimed_until IS NOT NULL AND datetime(claimed_until) <= datetime('now')
  `).get(businessId);
  summary.stale_claimed = Number(stale?.c) || 0;
  return summary;
}

export function assertTableCanOpenOrder(tableId, businessId) {
  if (!tableId) return null;
  const table = db.prepare(
    'SELECT * FROM tables WHERE id = ? AND business_id = ? AND is_active = 1',
  ).get(tableId, businessId);
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
    WHERE business_id = ? AND table_id = ? AND order_type = 'dine_in'
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

export function queueKitchenForNewItems(businessId, orderId, itemIds, userId, options = {}) {
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

export function recalcOrderTotals(orderId) {
  const items = db.prepare(
    `SELECT * FROM order_items WHERE order_id = ? AND status != 'cancelled'`,
  ).all(orderId);
  let subtotal = 0;
  for (const item of items) {
    if (item.is_comped) continue;
    subtotal += item.unit_price * item.quantity - (item.discount_amount || 0);
  }
  const order = db.prepare('SELECT discount_amount FROM orders WHERE id = ?').get(orderId);
  const grandTotal = subtotal - (order?.discount_amount || 0);
  db.prepare(
    "UPDATE orders SET subtotal = ?, vat_total = 0, grand_total = ?, updated_at = datetime('now') WHERE id = ?",
  ).run(subtotal, grandTotal, orderId);
}

export function autoCancelOrderIfNoActiveItems(orderId, businessId, userId) {
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

// ---------------------------------------------------------------------------
// Domain operations (transactions + side effects)
// ---------------------------------------------------------------------------

export function createOrder(businessId, branchId, userId, orderData, auditContext = {}) {
  const { table_id, order_type, customer_id, call_log_id, items, note, guest_count,
    delivery_address, delivery_note, courier_note } = orderData;

  const resolvedType = order_type || 'dine_in';
  assertPeriodOpenForMutation(businessId, new Date().toISOString().slice(0, 10));
  if (resolvedType === 'takeaway' && table_id) {
    const err = new Error('Paket siparişlerde masa kimliği (table_id) gönderilemez');
    err.isBadRequest = true;
    throw err;
  }

  const orderId = genId();
  let createdItemIds = [];

  db.transaction(() => {
    const orderNo = getNextOrderNo(businessId);
    if (resolvedType === 'dine_in' && table_id) assertTableCanOpenOrder(table_id, businessId);

    let subtotal = 0;
    const lines = [];

    for (const item of items) {
      const product = selectProductForOrder(item.product_id, businessId);
      if (!product) {
        const err = new Error(`Ürün bulunamadı: ${item.product_id}`);
        err.isBadRequest = true;
        throw err;
      }
      const { itemPrice, resolved, portionLabel } = resolveOrderItemPrice(
        product, item.modifiers, businessId, item.portion_id || null,
      );
      const { resolvedAttrs, extraPrice } = resolveSelectedAttributes(
        product.id, product.category_id, businessId, item.selected_attributes || [],
      );
      const finalPrice = itemPrice + extraPrice;
      const qty = item.quantity || 1;
      subtotal += finalPrice * qty;
      lines.push({
        product, qty, itemPrice: finalPrice, resolved, resolvedAttrs,
        note: item.note || null, portion_id: item.portion_id || null, portion_label: portionLabel,
        snapshot: orderItemSnapshot(product),
      });
    }

    const grandTotal = subtotal;
    const headerSnapshot = orderHeaderSnapshot({
      tableId: table_id || null, customerId: customer_id || null, userId, businessId,
    });

    db.prepare(`INSERT INTO orders (id, business_id, branch_id, order_no, order_type, table_id, customer_id, user_id,
      subtotal, vat_total, grand_total, note, delivery_address, delivery_note, courier_note, guest_count,
      table_name_snapshot, customer_name_snapshot, user_name_snapshot, status, created_by)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, 'saved', ?)`).run(
      orderId, businessId, branchId, orderNo, resolvedType,
      table_id || null, customer_id || null, userId,
      subtotal, 0, grandTotal, note || null,
      delivery_address || null, delivery_note || null, courier_note || null,
      guest_count || 0,
      headerSnapshot.table_name_snapshot, headerSnapshot.customer_name_snapshot, headerSnapshot.user_name_snapshot,
      userId,
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
        userId, line.portion_id || null, line.portion_label || null,
        JSON.stringify(line.resolvedAttrs || []),
      );
    }

    if (table_id) {
      const info = db.prepare(
        `UPDATE tables SET status = 'occupied', current_order_id = ?, guest_count = ?, updated_at = datetime('now')
         WHERE id = ? AND business_id = ? AND status = 'empty' AND current_order_id IS NULL`,
      ).run(orderId, guest_count || 0, table_id, businessId);
      if (info.changes !== 1) {
        const err = new Error('Masa başka bir işlem tarafından açılmış olabilir. Lütfen masaları yenileyin.');
        err.isBadRequest = true;
        throw err;
      }
    }

    if (resolvedType === 'takeaway') enqueueTakeawayLabelJob(businessId, orderId, userId);
    if (call_log_id) linkCallLogToOrder(businessId, call_log_id, orderId);

    queueKitchenForNewItems(businessId, orderId, createdItemIds, userId, {
      eventType: resolvedType === 'takeaway'
        ? AUTO_PRINT_EVENTS.KITCHEN_TAKEAWAY_ORDER_CREATE
        : AUTO_PRINT_EVENTS.KITCHEN_TABLE_ORDER_CREATE,
    });

    const insertedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    const insertedItems = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY created_at').all(orderId);
    recordEntityMutation({
      businessId,
      entityTable: 'orders',
      entityId: orderId,
      action: 'create',
      after: { ...insertedOrder, items: insertedItems },
      actorUserId: userId,
      reason: note || null,
      requestId: auditContext.requestId || null,
      source: 'api.orders.create',
    });
  })();

  processPendingJobsSync(businessId, userId);
  auditLog(businessId, userId, 'order_create', 'order', orderId, { order_type: resolvedType, table_id });

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  return order;
}

export function addItemsToOrder(businessId, orderId, userId, items) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND business_id = ?').get(orderId, businessId);
  if (!order) {
    const err = new Error('Sipariş bulunamadı');
    err.isNotFound = true;
    throw err;
  }
  if (order.status === 'closed' || order.status === 'cancelled') {
    const err = new Error('Kapalı siparişe ürün eklenemez');
    err.isBadRequest = true;
    throw err;
  }
  assertPeriodOpenForMutation(businessId, new Date().toISOString().slice(0, 10));

  let newItemIds = [];
  db.transaction(() => {
    let addedSubtotal = 0;
    for (const item of items) {
      const product = selectProductForOrder(item.product_id, businessId);
      if (!product) {
        const err = new Error(`Ürün bulunamadı: ${item.product_id}`);
        err.isBadRequest = true;
        throw err;
      }
      const { itemPrice, resolved, portionLabel } = resolveOrderItemPrice(
        product, item.modifiers, businessId, item.portion_id || null,
      );
      const { resolvedAttrs, extraPrice } = resolveSelectedAttributes(
        product.id, product.category_id, businessId, item.selected_attributes || [],
      );
      const finalItemPrice = itemPrice + extraPrice;
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
        itemId, orderId, product.id, product.name, qty, finalItemPrice,
        JSON.stringify(resolved), item.note || null, 0,
        snapshot.category_id_snapshot, snapshot.category_name_snapshot, snapshot.printer_target_snapshot,
        userId, item.portion_id || null, portionLabel,
        JSON.stringify(resolvedAttrs || []),
      );
    }
    db.prepare(
      `UPDATE orders SET subtotal = subtotal + ?, vat_total = 0,
       grand_total = grand_total + ?, updated_at = datetime('now'), updated_by = ? WHERE id = ?`,
    ).run(addedSubtotal, addedSubtotal, userId, orderId);

    queueKitchenForNewItems(businessId, orderId, newItemIds, userId, {
      eventType: AUTO_PRINT_EVENTS.KITCHEN_ORDER_ADJUSTMENT,
    });
  })();

  processPendingJobsSync(businessId, userId);

  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  updated.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  return updated;
}

export function updateOrderStatus(businessId, orderId, userId, status, user, auditContext = {}) {
  const order = db.prepare('SELECT * FROM orders WHERE id = ? AND business_id = ?').get(orderId, businessId);
  if (!order) {
    const err = new Error('Sipariş bulunamadı');
    err.isNotFound = true;
    throw err;
  }

  if (status === 'cancelled') {
    const canCancel = user.permissions?.all || ['admin', 'cashier', 'waiter'].includes(user.role_slug);
    if (!canCancel) {
      const err = new Error('Bu işlem için yetkiniz yok');
      err.isForbidden = true;
      throw err;
    }
    if (order.status === 'closed' || order.status === 'cancelled') {
      const err = new Error('Sipariş zaten kapalı veya iptal edilmiş');
      err.isBadRequest = true;
      throw err;
    }
    const payments = db.prepare('SELECT COUNT(*) as c FROM payments WHERE order_id = ?').get(order.id);
    if (payments.c > 0) {
      const err = new Error('Ödeme kaydı olan sipariş iptal edilemez');
      err.isBadRequest = true;
      throw err;
    }
    db.transaction(() => {
      db.prepare(
        `UPDATE orders SET status = 'cancelled', updated_at = datetime('now'), updated_by = ? WHERE id = ? AND business_id = ?`,
      ).run(userId, orderId, businessId);
      db.prepare(
        `UPDATE tables SET status = 'empty', current_order_id = NULL, guest_count = 0, updated_at = datetime('now')
         WHERE business_id = ? AND current_order_id = ?`,
      ).run(businessId, orderId);
      db.prepare(`UPDATE order_items SET status = 'cancelled' WHERE order_id = ?`).run(orderId);
      const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
      const updatedItems = db.prepare('SELECT * FROM order_items WHERE order_id = ? ORDER BY created_at').all(orderId);
      recordEntityMutation({
        businessId,
        entityTable: 'orders',
        entityId: orderId,
        action: 'status_change',
        before: order,
        after: { ...updatedOrder, items: updatedItems },
        actorUserId: userId,
        reason: 'cancelled',
        requestId: auditContext.requestId || null,
        source: 'api.orders.status',
      });
    })();
    auditLog(businessId, userId, 'order_cancelled', 'order', orderId);
    const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    updated.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
    return updated;
  }

  if (status === 'closed') {
    if (order.status === 'closed') {
      const err = new Error('Sipariş zaten kapalı');
      err.isBadRequest = true;
      throw err;
    }
    if (order.status === 'cancelled') {
      const err = new Error('İptal sipariş kapatılamaz');
      err.isBadRequest = true;
      throw err;
    }
  }

  if (status === 'cancelled' && order.status === 'closed') {
    const err = new Error('Kapalı sipariş iptal edilemez');
    err.isBadRequest = true;
    throw err;
  }

  let sentItemIds = [];
  if (status === 'in_kitchen') {
    const rows = db.prepare(`SELECT id FROM order_items WHERE order_id = ? AND status = 'new'`).all(orderId);
    sentItemIds = rows.map((r) => r.id);
  }

  const updates = ['status = ?', `updated_at = datetime('now')`, 'updated_by = ?'];
  const params = [status, userId];

  if (status === 'closed') {
    if (!isOrderFullyPaid(order)) {
      const err = new Error('Ödeme tamamlanmadan sipariş kapatılamaz');
      err.isBadRequest = true;
      throw err;
    }
    updates.push(`closed_at = datetime('now')`);
  }
  params.push(orderId, businessId);

  db.transaction(() => {
    if (status === 'in_kitchen' && sentItemIds.length) {
      db.prepare(
        `UPDATE order_items SET status = 'sent', sent_to_kitchen_at = datetime('now') WHERE order_id = ? AND status = 'new'`,
      ).run(orderId);
    }
    db.prepare(`UPDATE orders SET ${updates.join(', ')} WHERE id = ? AND business_id = ?`).run(...params);
    if (status === 'closed' && order.table_id) {
      db.prepare(
        `UPDATE tables SET status = 'empty', current_order_id = NULL, guest_count = 0, updated_at = datetime('now')
         WHERE business_id = ? AND current_order_id = ?`,
      ).run(businessId, orderId);
    }
    if (status === 'closed' && order.customer_id && !isOrderTerminalStatus(order.status)) {
      db.prepare(
        "UPDATE customers SET total_orders = total_orders + 1, last_order_at = datetime('now') WHERE id = ?",
      ).run(order.customer_id);
    }
    const updatedOrder = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
    recordEntityMutation({
      businessId,
      entityTable: 'orders',
      entityId: orderId,
      action: 'status_change',
      before: order,
      after: updatedOrder,
      actorUserId: userId,
      reason: status,
      requestId: auditContext.requestId || null,
      source: 'api.orders.status',
    });
  })();

  auditLog(businessId, userId, `order_${status}`, 'order', orderId);

  if (status === 'in_kitchen' && sentItemIds.length) {
    enqueueKitchenJobsForSentItems(businessId, orderId, sentItemIds, userId);
    processPendingJobsSync(businessId, userId);
  }
  if (status === 'closed' && order.order_type !== 'takeaway') {
    enqueueReceiptJobForClosedOrder(businessId, orderId, userId, {
      applyAutoPrintPolicy: true,
      eventType: AUTO_PRINT_EVENTS.RECEIPT_TABLE_CLOSE,
    });
    processPendingJobsSync(businessId, userId);
  }

  const updated = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  updated.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  return updated;
}

export function updateOrderItem(businessId, orderId, itemId, userId, updates) {
  const { status, quantity, note, is_comped, comp_reason, portion_id: portionIdBody } = updates;

  const item = db.prepare(`
    SELECT oi.*, o.status AS order_status FROM order_items oi
    JOIN orders o ON oi.order_id = o.id
    WHERE oi.id = ? AND oi.order_id = ? AND o.business_id = ?
  `).get(itemId, orderId, businessId);
  if (!item) {
    const err = new Error('Ürün bulunamadı');
    err.isNotFound = true;
    throw err;
  }
  if (['closed', 'cancelled'].includes(item.order_status)) {
    const err = new Error('Kapalı siparişte satır değiştirilemez');
    err.isBadRequest = true;
    throw err;
  }
  assertAllowedItemStatusTransition(item.status, status);

  const prevStatus = item.status;
  const prevQty = item.quantity;
  const beforeSnap = {
    id: item.id, product_id: item.product_id, product_name: item.product_name,
    quantity: item.quantity, note: item.note, status: item.status, portion_label: item.portion_label,
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
      const err = new Error('Porsiyon yalnızca mutfağa gönderilmemiş satırlarda değiştirilebilir');
      err.isBadRequest = true;
      throw err;
    }
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND business_id = ?').get(item.product_id, businessId);
    if (!product) {
      const err = new Error('Ürün bulunamadı');
      err.isNotFound = true;
      throw err;
    }
    let modifiersInput = [];
    try { modifiersInput = JSON.parse(item.modifiers || '[]'); } catch { modifiersInput = []; }
    const { itemPrice, resolved, portionLabel } = resolveOrderItemPrice(
      product, modifiersInput, businessId, portionIdBody || null,
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
      params.push(itemId);
      db.prepare(`UPDATE order_items SET ${sets.join(', ')} WHERE id = ?`).run(...params);
    }
    recalcOrderTotals(orderId);
    autoCancelOrderIfNoActiveItems(orderId, businessId, userId);

    if (shouldEnqueueCancel) {
      enqueueKitchenAdjustmentJobs(businessId, orderId, beforeSnap, { type: 'cancel' }, userId,
        { eventType: AUTO_PRINT_EVENTS.KITCHEN_ORDER_ADJUSTMENT });
      shouldProcessPrintJobs = true;
    } else if (shouldEnqueueReduce) {
      enqueueKitchenAdjustmentJobs(businessId, orderId, beforeSnap,
        { type: 'reduce', previousQty: prevQty, newQty: nq }, userId,
        { eventType: AUTO_PRINT_EVENTS.KITCHEN_ORDER_ADJUSTMENT });
      shouldProcessPrintJobs = true;
    }
  })();

  if (shouldProcessPrintJobs) processPendingJobsSync(businessId, userId);

  const order = db.prepare('SELECT * FROM orders WHERE id = ?').get(orderId);
  order.items = db.prepare('SELECT * FROM order_items WHERE order_id = ?').all(orderId);
  return order;
}

export function updateTakeawayDelivery(businessId, orderId, userId, action) {
  const o = db.prepare(`
    SELECT id, order_type, status, takeaway_out_at, takeaway_delivered_at, grand_total
    FROM orders WHERE id = ? AND business_id = ?
  `).get(orderId, businessId);
  if (!o) {
    const err = new Error('Sipariş bulunamadı');
    err.isNotFound = true;
    throw err;
  }
  if (o.order_type !== 'takeaway') {
    const err = new Error('Sadece paket siparişleri güncellenebilir');
    err.isBadRequest = true;
    throw err;
  }
  assertPeriodOpenForMutation(businessId, new Date().toISOString().slice(0, 10));
  if (o.takeaway_delivered_at) {
    if (action === 'out_for_delivery') {
      const err = new Error('Teslim edilmiş sipariş teslimata çıkarılamaz');
      err.isBadRequest = true;
      throw err;
    }
    return { skipped: 'already_delivered' };
  }
  if (['closed', 'cancelled'].includes(o.status)) {
    const err = new Error('Sipariş kapalı');
    err.isBadRequest = true;
    throw err;
  }

  if (action === 'out_for_delivery') {
    if (o.takeaway_out_at) return { skipped: 'already_out_for_delivery' };
    db.prepare(
      `UPDATE orders SET takeaway_out_at = datetime('now'), updated_at = datetime('now'), updated_by = ? WHERE id = ?`,
    ).run(userId, orderId);
    auditLog(businessId, userId, 'takeaway_out', 'order', orderId, {});
    return {};
  }

  if (!o.takeaway_out_at) {
    const err = new Error('Önce teslimata çıkarılmalı');
    err.isBadRequest = true;
    throw err;
  }

  const autoPaymentId = db.transaction(() => {
    const createdPaymentId = recordTakeawayDeliveryPaymentIfNeeded(o, businessId, userId);
    db.prepare(`
      UPDATE orders SET takeaway_delivered_at = datetime('now'), status = 'closed', closed_at = datetime('now'),
        updated_at = datetime('now'), updated_by = ? WHERE id = ?
    `).run(userId, orderId);
    return createdPaymentId;
  })();

  auditLog(businessId, userId, 'takeaway_delivered', 'order', orderId, { auto_payment_id: autoPaymentId });
  enqueueReceiptJobForClosedOrder(businessId, orderId, userId, {
    applyAutoPrintPolicy: true,
    eventType: AUTO_PRINT_EVENTS.RECEIPT_TAKEAWAY_COMPLETE,
  });
  processPendingJobsSync(businessId, userId);
  return { auto_payment_id: autoPaymentId };
}
