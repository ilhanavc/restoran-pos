import crypto from 'crypto';
import db from '../config/database.js';
import config from '../config/index.js';
import { genId, auditLog } from '../utils/helpers.js';
import {
  resolvePrinterForKitchenLine,
  resolveReceiptPrinter,
  resolveTakeawayLabelPrinter,
  stationFromPrinter,
} from './printRouting.js';
import { isAutoPrintEnabledForPrinter } from './printerAutoPrintPolicy.js';

/** Mutfağa görünür satırlar: iptal/azaltma fişi yalnız bunlar için basılır (varsayılan). */
const KITCHEN_VISIBLE_STATUSES = new Set(['sent', 'preparing', 'ready', 'served']);

function getPrinterConfig(businessId) {
  const row = db.prepare(`SELECT value FROM settings WHERE business_id = ? AND key = ?`).get(businessId, 'printer.config');
  if (!row?.value) return {};
  try {
    return JSON.parse(row.value);
  } catch {
    return {};
  }
}

/**
 * İptal/azaltma fişi: varsayılan yalnız mutfağa gitmiş satırlar (sent+).
 * printer.config.kitchenAdjustmentIncludeNew === true ise `new` satırlar da yazdırılır.
 */
function shouldPrintKitchenAdjustment(businessId, beforeStatus) {
  const cfg = getPrinterConfig(businessId);
  if (cfg.kitchenAdjustmentIncludeNew === true) {
    return beforeStatus !== 'cancelled';
  }
  return KITCHEN_VISIBLE_STATUSES.has(beforeStatus);
}

function paymentSummaryForOrder(orderId) {
  const sumRow = db.prepare(`SELECT COALESCE(SUM(amount), 0) AS paid, COUNT(*) AS cnt FROM payments WHERE order_id = ?`).get(orderId);
  const order = db.prepare(`SELECT grand_total FROM orders WHERE id = ?`).get(orderId);
  const paid = Number(sumRow?.paid) || 0;
  const gt = order?.grand_total != null ? Number(order.grand_total) : 0;
  return {
    paid_total: paid,
    payment_count: Number(sumRow?.cnt) || 0,
    grand_total: gt,
    balance: Math.max(0, gt - paid),
    has_payments: (Number(sumRow?.cnt) || 0) > 0,
  };
}

function hashBatch(ids) {
  return crypto.createHash('sha256').update([...ids].sort().join(',')).digest('hex').slice(0, 24);
}

function insertJob({
  businessId,
  orderId,
  printerId,
  jobType,
  payload,
  status,
  errorMessage,
  idempotencyKey,
}) {
  const id = genId();
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO print_jobs (id, business_id, order_id, printer_id, job_type, payload, status, error_message, idempotency_key, created_at, printed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, datetime('now'), ?)`,
    )
    .run(
      id,
      businessId,
      orderId,
      printerId || null,
      jobType,
      JSON.stringify(payload),
      status,
      errorMessage || null,
      idempotencyKey,
      null,
    );
  if (info.changes === 0) {
    return { id: null, inserted: false, duplicate: true };
  }
  return { id, inserted: true };
}

function customerInfoForOrder(order) {
  let customer_name = null;
  let customer_phone = null;
  if (order?.customer_id) {
    const c = db.prepare(`SELECT full_name FROM customers WHERE id = ? AND business_id = ?`).get(order.customer_id, order.business_id);
    customer_name = c?.full_name || null;
    const ph = db
      .prepare(
        `SELECT phone FROM customer_phones WHERE customer_id = ? ORDER BY is_primary DESC, created_at ASC LIMIT 1`,
      )
      .get(order.customer_id);
    customer_phone = ph?.phone || null;
  }
  return { customer_name, customer_phone };
}

/**
 * Mutfağa gönderilen kalemler için yazıcı başına (veya çözülemeyenler için) job.
 */
export function enqueueKitchenJobsForSentItems(businessId, orderId, orderItemIds, userId, options = {}) {
  const eventType = options?.eventType || null;
  if (!orderItemIds?.length) return { created: 0, skipped: 0 };

  const order = db
    .prepare(
      `SELECT o.*, t.name AS table_name, da.name AS dining_area_name, u.full_name AS user_name
       FROM orders o
       LEFT JOIN tables t ON o.table_id = t.id
       LEFT JOIN dining_areas da ON t.dining_area_id = da.id
       LEFT JOIN users u ON o.user_id = u.id
       WHERE o.id = ? AND o.business_id = ?`,
    )
    .get(orderId, businessId);
  if (!order) return { created: 0, skipped: 0 };

  const { customer_name, customer_phone } = customerInfoForOrder(order);
  const biz = db.prepare(`SELECT name FROM businesses WHERE id = ?`).get(businessId);
  const payment_summary = paymentSummaryForOrder(orderId);

  const lines = [];
  for (const oiId of orderItemIds) {
    const oi = db.prepare(`SELECT * FROM order_items WHERE id = ? AND order_id = ?`).get(oiId, orderId);
    if (!oi) continue;
    const liveMeta = db
      .prepare(
        `SELECT p.category_id, c.name AS category_name, COALESCE(p.printer_target, c.printer_target, 'kitchen') AS printer_target
         FROM products p LEFT JOIN categories c ON p.category_id = c.id
         WHERE p.id = ? AND p.business_id = ?`,
      )
      .get(oi.product_id, businessId);
    const categoryId = oi.category_id_snapshot || liveMeta?.category_id || null;
    if (!categoryId) continue;
    const categoryName = oi.category_name_snapshot || liveMeta?.category_name || 'Kategori';

    const resolved = resolvePrinterForKitchenLine(businessId, categoryId, oi.product_id);
    if (eventType && resolved?.printer && !isAutoPrintEnabledForPrinter(resolved.printer, eventType)) {
      continue;
    }
    lines.push({
      orderItemId: oi.id,
      productId: oi.product_id,
      productName: oi.product_name,
      quantity: oi.quantity,
      note: oi.note,
      portionLabel: oi.portion_label || null,
      categoryId,
      categoryName,
      resolved,
    });
  }

  const byPrinter = new Map();
  const unresolved = [];

  for (const line of lines) {
    const p = line.resolved.printer;
    if (!p) {
      unresolved.push(line);
      continue;
    }
    const pid = p.id;
    if (!byPrinter.has(pid)) {
      byPrinter.set(pid, { printer: p, lines: [], source: line.resolved.source });
    }
    byPrinter.get(pid).lines.push(line);
  }

  let created = 0;
  let skipped = 0;

  const batchHash = hashBatch(orderItemIds);

  for (const [printerId, group] of byPrinter) {
    const station = stationFromPrinter(group.printer);
    const itemIds = group.lines.map((l) => l.orderItemId);
    const idempotencyKey = `kitchen|${businessId}|${orderId}|${printerId}|${hashBatch(itemIds)}`;

    const payload = {
      kind: 'kitchen',
      order_id: orderId,
      order_no: order.order_no,
      order_type: order.order_type,
      table_name: order.table_name,
      dining_area_name: order.dining_area_name || null,
      delivery_address: order.delivery_address || null,
      created_at: order.created_at,
      user_name: order.user_name || null,
      business_name: biz?.name || null,
      customer_name,
      customer_phone,
      payment_summary,
      station,
      routing_source: group.source,
      printer_name: group.printer.name,
      line_width: group.printer.line_width || null,
      lines: group.lines.map((l) => ({
        order_item_id: l.orderItemId,
        product_name: l.productName,
        quantity: l.quantity,
        note: l.note,
        category_name: l.categoryName,
        portion_label: l.portionLabel || null,
        station,
      })),
    };

    const r = insertJob({
      businessId,
      orderId,
      printerId,
      jobType: 'kitchen',
      payload,
      status: 'pending',
      idempotencyKey,
    });
    if (r.inserted) created += 1;
    else if (r.duplicate) skipped += 1;
  }

  if (unresolved.length) {
    const idempotencyKey = `kitchen|${businessId}|${orderId}|unresolved|${batchHash}`;
    const r = insertJob({
      businessId,
      orderId,
      printerId: null,
      jobType: 'kitchen',
      payload: {
        kind: 'kitchen',
        order_id: orderId,
        order_no: order.order_no,
        dining_area_name: order.dining_area_name || null,
        delivery_address: order.delivery_address || null,
        business_name: biz?.name || null,
        customer_name,
        customer_phone,
        payment_summary,
        error: 'Yazıcı çözümlenemedi',
        lines: unresolved.map((l) => ({
          order_item_id: l.orderItemId,
          product_name: l.productName,
          quantity: l.quantity,
          category_name: l.categoryName,
          portion_label: l.portionLabel || null,
        })),
      },
      status: 'failed',
      errorMessage: 'Aktif yazıcı bulunamadı (routing + fallback)',
      idempotencyKey,
    });
    if (r.inserted) created += 1;
    else if (r.duplicate) skipped += 1;
  }

  if (created && userId) {
    auditLog(businessId, userId, 'print_jobs_enqueued', 'order', orderId, { kind: 'kitchen', count: created });
  }

  return { created, skipped };
}

/**
 * İptal veya miktar azaltma sonrası mutfak yazıcılarına bildirim.
 * @param {object} beforeItem - Güncellemeden önceki order_items satırı
 * @param {{ type: 'cancel' } | { type: 'reduce', previousQty: number, newQty: number }} adjustment
 */
export function enqueueKitchenAdjustmentJobs(businessId, orderId, beforeItem, adjustment, userId, options = {}) {
  const eventType = options?.eventType || null;
  if (!beforeItem || !shouldPrintKitchenAdjustment(businessId, beforeItem.status)) {
    return { created: 0, skipped: 0 };
  }

  const order = db
    .prepare(
      `SELECT o.*, t.name AS table_name, da.name AS dining_area_name, u.full_name AS user_name
       FROM orders o
       LEFT JOIN tables t ON o.table_id = t.id
       LEFT JOIN dining_areas da ON t.dining_area_id = da.id
       LEFT JOIN users u ON o.user_id = u.id
       WHERE o.id = ? AND o.business_id = ?`,
    )
    .get(orderId, businessId);
  if (!order || ['closed', 'cancelled'].includes(order.status)) return { created: 0, skipped: 0 };

  const liveMeta = db
    .prepare(
      `SELECT p.category_id, c.name AS category_name
       FROM products p LEFT JOIN categories c ON p.category_id = c.id
       WHERE p.id = ? AND p.business_id = ?`,
    )
    .get(beforeItem.product_id, businessId);
  const categoryId = beforeItem.category_id_snapshot || liveMeta?.category_id || null;
  if (!categoryId) return { created: 0, skipped: 0 };
  const categoryName = beforeItem.category_name_snapshot || liveMeta?.category_name || 'Kategori';

  const resolved = resolvePrinterForKitchenLine(businessId, categoryId, beforeItem.product_id);
  if (eventType && resolved?.printer && !isAutoPrintEnabledForPrinter(resolved.printer, eventType)) {
    return { created: 0, skipped: 0, policySkipped: true };
  }
  const { customer_name, customer_phone } = customerInfoForOrder(order);
  const bizAdj = db.prepare(`SELECT name FROM businesses WHERE id = ?`).get(businessId);
  const payment_summary = paymentSummaryForOrder(orderId);
  const station = resolved.printer ? stationFromPrinter(resolved.printer) : 'KITCHEN';

  let idempotencyKey;
  let linePayload;
  if (adjustment.type === 'cancel') {
    idempotencyKey = `kadj|cancel|${businessId}|${orderId}|${beforeItem.id}`;
    linePayload = {
      product_name: beforeItem.product_name,
      quantity: beforeItem.quantity,
      note: beforeItem.note,
      portion_label: beforeItem.portion_label || null,
      category_name: categoryName,
      station,
    };
  } else if (adjustment.type === 'reduce') {
    const { previousQty, newQty } = adjustment;
    const delta = previousQty - newQty;
    if (delta <= 0) return { created: 0, skipped: 0 };
    idempotencyKey = `kadj|reduce|${businessId}|${orderId}|${beforeItem.id}|${previousQty}|${newQty}`;
    linePayload = {
      product_name: beforeItem.product_name,
      quantity: delta,
      note: beforeItem.note,
      portion_label: beforeItem.portion_label || null,
      category_name: categoryName,
      station,
      previous_quantity: previousQty,
      new_quantity: newQty,
      delta_quantity: delta,
    };
  } else {
    return { created: 0, skipped: 0 };
  }

  const basePayload = {
    kind: 'kitchen_adjustment',
    adjustment_type: adjustment.type,
    order_id: orderId,
    order_no: order.order_no,
    order_type: order.order_type,
    table_name: order.table_name,
    dining_area_name: order.dining_area_name || null,
    delivery_address: order.delivery_address || null,
    created_at: order.created_at,
    user_name: order.user_name || null,
    business_name: bizAdj?.name || null,
    customer_name,
    customer_phone,
    payment_summary,
    station,
    routing_source: resolved.source,
    line: linePayload,
  };

  if (!resolved.printer) {
    const r = insertJob({
      businessId,
      orderId,
      printerId: null,
      jobType: 'kitchen_adjustment',
      payload: {
        ...basePayload,
        error: 'Yazıcı çözümlenemedi',
      },
      status: 'failed',
      errorMessage: 'Aktif yazıcı bulunamadı (iptal/azaltma)',
      idempotencyKey: `${idempotencyKey}|unresolved`,
    });
    if (r.inserted && userId) {
      auditLog(businessId, userId, 'print_job_failed', 'order', orderId, { kind: 'kitchen_adjustment' });
    }
    return { created: r.inserted ? 1 : 0, skipped: r.duplicate ? 1 : 0, failed: true };
  }

  basePayload.printer_name = resolved.printer.name;
  const r = insertJob({
    businessId,
    orderId,
    printerId: resolved.printer.id,
    jobType: 'kitchen_adjustment',
    payload: basePayload,
    status: 'pending',
    idempotencyKey,
  });

  if (r.inserted && userId) {
    auditLog(businessId, userId, 'print_jobs_enqueued', 'order', orderId, { kind: 'kitchen_adjustment', adjustment: adjustment.type });
  }

  return { created: r.inserted ? 1 : 0, skipped: r.duplicate ? 1 : 0 };
}

export function enqueueReceiptJobForClosedOrder(businessId, orderId, userId, options = {}) {
  const suffix = options?.idempotencySuffix ? `|${String(options.idempotencySuffix).slice(0, 80)}` : '';
  const forcedPrinterId = options?.forcedPrinterId ? String(options.forcedPrinterId) : null;
  const eventType = options?.eventType || null;
  const applyAutoPrintPolicy = options?.applyAutoPrintPolicy === true;
  const idempotencyKey = `receipt|${businessId}|${orderId}${suffix}`;
  const existing = db.prepare(`SELECT id FROM print_jobs WHERE idempotency_key = ?`).get(idempotencyKey);
  if (existing) return { created: 0, skipped: 1, duplicate: true };

  const order = db
    .prepare(
      `SELECT o.*, t.name AS table_name, da.name AS dining_area_name, c.full_name AS customer_name,
              u.full_name AS user_name
       FROM orders o
       LEFT JOIN tables t ON o.table_id = t.id
       LEFT JOIN dining_areas da ON t.dining_area_id = da.id
       LEFT JOIN customers c ON o.customer_id = c.id
       LEFT JOIN users u ON o.user_id = u.id
       WHERE o.id = ? AND o.business_id = ?`,
    )
    .get(orderId, businessId);
  if (!order) return { created: 0, skipped: 0 };

  let customer_phone = null;
  if (order.customer_id) {
    const ph = db
      .prepare(
        `SELECT phone FROM customer_phones WHERE customer_id = ? ORDER BY is_primary DESC, created_at ASC LIMIT 1`,
      )
      .get(order.customer_id);
    customer_phone = ph?.phone || null;
  }

  const items = db
    .prepare(`SELECT * FROM order_items WHERE order_id = ? AND status != 'cancelled'`)
    .all(orderId);
  const payments = db.prepare(`SELECT * FROM payments WHERE order_id = ? ORDER BY created_at`).all(orderId);

  const biz = db.prepare(`SELECT name, phone, address, receipt_header, receipt_footer FROM businesses WHERE id = ?`).get(businessId);

  let resolved = resolveReceiptPrinter(businessId);
  if (forcedPrinterId) {
    const forced = db
      .prepare(`SELECT * FROM printers WHERE id = ? AND business_id = ? AND is_active = 1`)
      .get(forcedPrinterId, businessId);
    if (!forced) {
      return { created: 0, skipped: 0, failed: true, reason: 'printer_not_found_or_inactive' };
    }
    if (forced.type !== 'receipt') {
      return { created: 0, skipped: 0, failed: true, reason: 'printer_role_mismatch' };
    }
    resolved = { printer: forced, source: 'manual_override' };
  }
  if (applyAutoPrintPolicy && resolved.printer && !isAutoPrintEnabledForPrinter(resolved.printer, eventType)) {
    return { created: 0, skipped: 0, policySkipped: true };
  }
  const payload = {
    kind: 'receipt',
    order_id: orderId,
    order_no: order.order_no,
    order_type: order.order_type,
    table_name: order.table_name,
    dining_area_name: order.dining_area_name || null,
    delivery_address: order.delivery_address || null,
    customer_name: order.customer_name,
    customer_phone: customer_phone,
    created_at: order.created_at,
    user_name: order.user_name || null,
    business_name: biz?.name || null,
    business_phone: biz?.phone || null,
    business_address: biz?.address || null,
    receipt_header: biz?.receipt_header || null,
    receipt_footer: biz?.receipt_footer || null,
    grand_total: order.grand_total,
    subtotal: order.subtotal,
    discount_amount: order.discount_amount,
    routing_source: resolved.source,
    items: items.map((i) => ({
      product_name: i.product_name,
      quantity: i.quantity,
      unit_price: i.unit_price,
      modifiers: i.modifiers,
      note: i.note,
      status: i.status,
      portion_label: i.portion_label || null,
    })),
    payments: payments.map((p) => ({
      payment_type: p.payment_type,
      amount: p.amount,
      change_amount: p.change_amount,
    })),
  };

  if (!resolved.printer) {
    insertJob({
      businessId,
      orderId,
      printerId: null,
      jobType: 'receipt',
      payload,
      status: 'failed',
      errorMessage: 'Fiş yazıcısı bulunamadı (varsayılan veya type=receipt)',
      idempotencyKey,
    });
    if (userId) auditLog(businessId, userId, 'print_job_failed', 'order', orderId, { kind: 'receipt' });
    return { created: 1, skipped: 0, failed: true };
  }

  payload.printer_name = resolved.printer.name;
  if (resolved.printer.line_width) payload.line_width = resolved.printer.line_width;
  const r = insertJob({
    businessId,
    orderId,
    printerId: resolved.printer.id,
    jobType: 'receipt',
    payload,
    status: 'pending',
    idempotencyKey,
  });

  if (r.inserted && userId) {
    auditLog(businessId, userId, 'print_jobs_enqueued', 'order', orderId, { kind: 'receipt' });
  }

  return { created: r.inserted ? 1 : 0, skipped: r.duplicate ? 1 : 0 };
}

/**
 * Paket sipariş etiketi: varsayılan yazıcıdan kurye kağıdı basar.
 * Sadece order_type='takeaway' siparişlerde çağrılır.
 */
export function enqueueTakeawayLabelJob(businessId, orderId, userId, options = {}) {
  const suffix = options?.idempotencySuffix ? `|${String(options.idempotencySuffix).slice(0, 80)}` : '';
  const forcedPrinterId = options?.forcedPrinterId ? String(options.forcedPrinterId) : null;
  const idempotencyKey = `takeaway_label|${businessId}|${orderId}${suffix}`;
  const existing = db.prepare(`SELECT id FROM print_jobs WHERE idempotency_key = ?`).get(idempotencyKey);
  if (existing) return { created: 0, skipped: 1, duplicate: true };

  const order = db
    .prepare(
      `SELECT o.*, c.full_name AS customer_name, u.full_name AS user_name
       FROM orders o
       LEFT JOIN customers c ON o.customer_id = c.id
       LEFT JOIN users u ON o.user_id = u.id
       WHERE o.id = ? AND o.business_id = ?`,
    )
    .get(orderId, businessId);
  if (!order || order.order_type !== 'takeaway') return { created: 0, skipped: 0 };

  let customer_phone = null;
  if (order.customer_id) {
    const ph = db
      .prepare(
        `SELECT phone FROM customer_phones WHERE customer_id = ? ORDER BY is_primary DESC, created_at ASC LIMIT 1`,
      )
      .get(order.customer_id);
    customer_phone = ph?.phone || null;
  }

  const items = db
    .prepare(`SELECT * FROM order_items WHERE order_id = ? AND status != 'cancelled'`)
    .all(orderId);

  const biz = db.prepare(`SELECT name FROM businesses WHERE id = ?`).get(businessId);
  let resolved = resolveTakeawayLabelPrinter(businessId);
  if (forcedPrinterId) {
    const forced = db
      .prepare(`SELECT * FROM printers WHERE id = ? AND business_id = ? AND is_active = 1`)
      .get(forcedPrinterId, businessId);
    if (!forced) {
      return { created: 0, skipped: 0, failed: true, reason: 'printer_not_found_or_inactive' };
    }
    if (forced.type !== 'kitchen') {
      return { created: 0, skipped: 0, failed: true, reason: 'printer_role_mismatch' };
    }
    resolved = { printer: forced, source: 'manual_override' };
  }

  const payload = {
    kind: 'takeaway_label',
    order_id: orderId,
    order_no: order.order_no,
    customer_name: order.customer_name || null,
    customer_phone,
    delivery_address: order.delivery_address || null,
    delivery_note: order.delivery_note || null,
    courier_note: order.courier_note || null,
    note: order.note || null,
    business_name: biz?.name || null,
    created_at: order.created_at,
    user_name: order.user_name || null,
    routing_source: resolved.source,
    items: items.map((i) => ({
      product_name: i.product_name,
      quantity: i.quantity,
      note: i.note,
      portion_label: i.portion_label || null,
    })),
  };

  if (!resolved.printer) {
    insertJob({
      businessId,
      orderId,
      printerId: null,
      jobType: 'takeaway_label',
      payload,
      status: 'failed',
      errorMessage: 'Paket etiketi için aktif mutfak yazıcısı bulunamadı',
      idempotencyKey,
    });
    if (userId) auditLog(businessId, userId, 'print_job_failed', 'order', orderId, { kind: 'takeaway_label' });
    return { created: 1, skipped: 0, failed: true };
  }

  payload.printer_name = resolved.printer.name;
  if (resolved.printer.line_width) payload.line_width = resolved.printer.line_width;
  const r = insertJob({
    businessId,
    orderId,
    printerId: resolved.printer.id,
    jobType: 'takeaway_label',
    payload,
    status: 'pending',
    idempotencyKey,
  });

  if (r.inserted && userId) {
    auditLog(businessId, userId, 'print_jobs_enqueued', 'order', orderId, { kind: 'takeaway_label' });
  }

  return { created: r.inserted ? 1 : 0, skipped: r.duplicate ? 1 : 0 };
}

/**
 * Pending job'ları mock işler: printed + printed_at.
 * DISABLE_PRINT_JOB_MOCK=true iken atlanır (StoreBridge gerçek yazdırır).
 * claimed_at dolu işler köprü tarafından alınmış sayılır; mock bunları işlemez.
 */
export function processPendingJobsSync(businessId, userId) {
  if (config.nodeEnv === 'production' && process.env.ALLOW_PRINT_JOB_MOCK !== '1') {
    return { processed: 0, skipped: true, reason: 'mock_disabled_in_production' };
  }
  if (config.disablePrintJobMock) {
    return { processed: 0, skipped: true };
  }

  const jobs = db
    .prepare(
      `SELECT * FROM print_jobs WHERE business_id = ? AND status = 'pending' AND claimed_at IS NULL ORDER BY created_at ASC`,
    )
    .all(businessId);

  let processed = 0;
  for (const job of jobs) {
    try {
      console.log(
        `🖨️ [print_job mock] ${job.job_type} order=${job.order_id} printer=${job.printer_id || '—'} id=${job.id}`,
      );
      db.prepare(`UPDATE print_jobs SET status = 'printed', printed_at = datetime('now'), error_message = NULL WHERE id = ?`).run(
        job.id,
      );
      auditLog(businessId, userId || null, 'print_job_printed', 'print_job', job.id, {
        job_type: job.job_type,
        order_id: job.order_id,
      });
      processed += 1;
    } catch (e) {
      db.prepare(`UPDATE print_jobs SET status = 'failed', error_message = ? WHERE id = ?`).run(
        e.message || String(e),
        job.id,
      );
    }
  }
  return { processed };
}
