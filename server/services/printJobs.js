import crypto from 'crypto';
import db from '../config/database.js';
import config from '../config/index.js';
import { genId, auditLog } from '../utils/helpers.js';
import { resolvePrinterForKitchenLine, resolveReceiptPrinter, stationFromPrinter } from './printRouting.js';

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

/**
 * Mutfağa gönderilen kalemler için yazıcı başına (veya çözülemeyenler için) job.
 */
export function enqueueKitchenJobsForSentItems(businessId, orderId, orderItemIds, userId) {
  if (!orderItemIds?.length) return { created: 0, skipped: 0 };

  const order = db
    .prepare(
      `SELECT o.*, t.name AS table_name, u.full_name AS user_name
       FROM orders o
       LEFT JOIN tables t ON o.table_id = t.id
       LEFT JOIN users u ON o.user_id = u.id
       WHERE o.id = ? AND o.business_id = ?`,
    )
    .get(orderId, businessId);
  if (!order) return { created: 0, skipped: 0 };

  const lines = [];
  for (const oiId of orderItemIds) {
    const oi = db.prepare(`SELECT * FROM order_items WHERE id = ? AND order_id = ?`).get(oiId, orderId);
    if (!oi) continue;
    const meta = db
      .prepare(
        `SELECT p.category_id, c.name AS category_name
         FROM products p JOIN categories c ON p.category_id = c.id
         WHERE p.id = ? AND p.business_id = ?`,
      )
      .get(oi.product_id, businessId);
    if (!meta) continue;

    const resolved = resolvePrinterForKitchenLine(businessId, meta.category_id, oi.product_id);
    lines.push({
      orderItemId: oi.id,
      productId: oi.product_id,
      productName: oi.product_name,
      quantity: oi.quantity,
      note: oi.note,
      categoryId: meta.category_id,
      categoryName: meta.category_name,
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
      created_at: order.created_at,
      user_name: order.user_name || null,
      station,
      routing_source: group.source,
      printer_name: group.printer.name,
      lines: group.lines.map((l) => ({
        order_item_id: l.orderItemId,
        product_name: l.productName,
        quantity: l.quantity,
        note: l.note,
        category_name: l.categoryName,
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
        error: 'Yazıcı çözümlenemedi',
        lines: unresolved.map((l) => ({
          order_item_id: l.orderItemId,
          product_name: l.productName,
          quantity: l.quantity,
          category_name: l.categoryName,
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

export function enqueueReceiptJobForClosedOrder(businessId, orderId, userId) {
  const idempotencyKey = `receipt|${businessId}|${orderId}`;
  const existing = db.prepare(`SELECT id FROM print_jobs WHERE idempotency_key = ?`).get(idempotencyKey);
  if (existing) return { created: 0, skipped: 1, duplicate: true };

  const order = db
    .prepare(
      `SELECT o.*, t.name AS table_name, c.full_name AS customer_name,
              u.full_name AS user_name
       FROM orders o
       LEFT JOIN tables t ON o.table_id = t.id
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

  const resolved = resolveReceiptPrinter(businessId);
  const payload = {
    kind: 'receipt',
    order_id: orderId,
    order_no: order.order_no,
    order_type: order.order_type,
    table_name: order.table_name,
    customer_name: order.customer_name,
    customer_phone: customer_phone,
    created_at: order.created_at,
    user_name: order.user_name || null,
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
 * Pending job'ları mock işler: printed + printed_at.
 * DISABLE_PRINT_JOB_MOCK=true iken atlanır (StoreBridge gerçek yazdırır).
 * claimed_at dolu işler köprü tarafından alınmış sayılır; mock bunları işlemez.
 */
export function processPendingJobsSync(businessId, userId) {
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
