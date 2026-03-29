import db from '../config/database.js';
import { genId, auditLog } from '../utils/helpers.js';
import { normalizePhoneDigits } from '../utils/phoneNormalize.js';

/**
 * @param {string} businessId
 * @param {string} normalizedPhone Kanonik 90… rakamları
 */
export function findCustomerPhoneRow(businessId, normalizedPhone) {
  if (!normalizedPhone) return null;
  let row = db.prepare(`
    SELECT cp.*, c.id as customer_id, c.full_name, c.note as customer_note, c.is_blacklisted, c.blacklist_note
    FROM customer_phones cp
    JOIN customers c ON cp.customer_id = c.id
    WHERE c.business_id = ? AND cp.normalized_phone = ?
  `).get(businessId, normalizedPhone);
  if (row) return row;
  const legacy = db.prepare(`
    SELECT cp.*, c.id as customer_id, c.full_name, c.note as customer_note, c.is_blacklisted, c.blacklist_note
    FROM customer_phones cp
    JOIN customers c ON cp.customer_id = c.id
    WHERE c.business_id = ?
  `).all(businessId);
  for (const cp of legacy) {
    if (normalizePhoneDigits(cp.phone) === normalizedPhone) return cp;
  }
  return null;
}

export function loadCustomerForCallerId(customerId, businessId) {
  const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
  if (!customer) return null;
  customer.phones = db.prepare('SELECT * FROM customer_phones WHERE customer_id = ?').all(customerId);
  customer.addresses = db.prepare('SELECT * FROM customer_addresses WHERE customer_id = ?').all(customerId);
  customer.recentOrders = db.prepare(`
    SELECT o.id, o.order_no, o.grand_total, o.created_at, o.status,
      GROUP_CONCAT(oi.product_name || ' x' || oi.quantity, ', ') as items_summary
    FROM orders o LEFT JOIN order_items oi ON o.id = oi.order_id
    WHERE o.customer_id = ? AND o.business_id = ?
    GROUP BY o.id ORDER BY o.created_at DESC LIMIT 5
  `).all(customerId, businessId);
  return customer;
}

/**
 * @param {{ businessId: string, userId: string, rawPhone: string, sourceType?: string, rawPayload?: unknown }} opts
 */
export function processIncomingCall(opts) {
  const { businessId, userId, rawPhone, sourceType = 'http', rawPayload } = opts;
  const normalized = normalizePhoneDigits(rawPhone);
  if (!normalized) {
    const err = new Error('Geçersiz telefon numarası');
    err.isBadRequest = true;
    throw err;
  }

  const displayPhone = String(rawPhone ?? '').trim() || normalized;
  const phoneRecord = findCustomerPhoneRow(businessId, normalized);
  const matched = phoneRecord ? 1 : 0;
  const customerId = phoneRecord?.customer_id || null;

  let customerNameSnapshot = null;
  let addressSnapshot = null;
  let customer = null;

  if (customerId) {
    customer = loadCustomerForCallerId(customerId, businessId);
    customerNameSnapshot = customer?.full_name || null;
    const defaultAddr = customer.addresses?.find((a) => a.is_default) || customer.addresses?.[0];
    addressSnapshot = defaultAddr?.address || null;
  }

  const logId = genId();
  db.prepare(`
    INSERT INTO call_logs (id, business_id, phone, normalized_phone, customer_id, customer_name_snapshot, address_snapshot, source_type, status)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'ringing')
  `).run(
    logId,
    businessId,
    displayPhone,
    normalized,
    customerId,
    customerNameSnapshot,
    addressSnapshot,
    sourceType || 'http',
  );

  auditLog(businessId, userId, 'incoming_call', 'call_log', logId, {
    phone: displayPhone,
    matched,
    sourceType: sourceType || 'http',
  });

  // TODO(legacy): incoming_calls yalnızca eski uyumluluk; tüm yeni akış call_logs üzerinden.
  // Gerektiğinde bu blok kaldırılıp sadece call_logs bırakılabilir.
  try {
    const legacyId = genId();
    db.prepare(`INSERT INTO incoming_calls (id, business_id, phone, customer_id, matched)
      VALUES (?, ?, ?, ?, ?)`).run(legacyId, businessId, normalized, customerId, matched);
  } catch {
    /* legacy tablo yoksa veya hata: ana kayıt call_logs’ta */
  }

  return {
    callId: logId,
    callLogId: logId,
    phone: normalized,
    displayPhone,
    matched,
    customer,
    rawPayload: rawPayload ?? null,
  };
}

export function updateCallLogStatus(businessId, logId, status) {
  const allowed = ['ringing', 'dismissed', 'opened_order', 'completed'];
  if (!allowed.includes(status)) {
    const err = new Error('Geçersiz durum');
    err.isBadRequest = true;
    throw err;
  }
  const r = db.prepare(
    `UPDATE call_logs SET status = ? WHERE id = ? AND business_id = ?`,
  ).run(status, logId, businessId);
  if (r.changes === 0) return null;
  return db.prepare(`SELECT * FROM call_logs WHERE id = ?`).get(logId);
}

export function listRecentCallLogs(businessId, limit = 40) {
  return db.prepare(`
    SELECT * FROM call_logs WHERE business_id = ? ORDER BY created_at DESC LIMIT ?
  `).all(businessId, limit);
}
