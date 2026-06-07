import { v4 as uuidv4 } from 'uuid';
import db from '../config/database.js';
import { normalizePhoneDigits } from './phoneNormalize.js';
import { getStoreDate } from './time.js';

export const genId = () => uuidv4();

export function auditLog(businessId, userId, action, entityType, entityId, details = null) {
  try {
    db.prepare(`INSERT INTO audit_logs (id, business_id, user_id, action, entity_type, entity_id, details)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(genId(), businessId, userId, action, entityType, entityId, details ? JSON.stringify(details) : null);
  } catch (e) {
    console.error('Audit log error:', e.message);
  }
}

/** Türkçe büyük/küçük harf duyarsız arama için (İ/ı + Unicode NFC) */
export function normalizeTurkishSearch(str) {
  return String(str || '')
    .normalize('NFC')
    .trim()
    .toLocaleLowerCase('tr-TR');
}

/** @deprecated Yeni kod normalizePhoneDigits kullanmalı; uyumluluk için kanonik rakam string döner */
export function normalizePhone(phone) {
  return normalizePhoneDigits(phone);
}

export function getNextOrderNo(businessId) {
  const today = getStoreDate();
  const result = db.prepare(`
    SELECT COALESCE(MAX(order_no), 0) as maxNo FROM orders 
    WHERE business_id = ? AND store_date(created_at) = ?
  `).get(businessId, today);
  return (result?.maxNo || 0) + 1;
}

/**
 * Sipariş satırı birim fiyatı: isteğe bağlı porsiyon tabanı + product_modifiers deltaları.
 * @param {string|null|undefined} portionId - product_portions.id
 */
export function resolveOrderItemPrice(product, modifiersInput, businessId, portionId = null) {
  let itemPrice = Number(product.price);
  let portionLabel = null;

  if (portionId) {
    const prow = db
      .prepare(
        `SELECT * FROM product_portions WHERE id = ? AND product_id = ? AND business_id = ?`,
      )
      .get(portionId, product.id, businessId);
    if (!prow) {
      const err = new Error('Geçersiz veya bu ürüne ait olmayan porsiyon');
      err.isBadRequest = true;
      throw err;
    }
    itemPrice = Number(prow.price);
    portionLabel = prow.label || null;
  }

  const resolved = [];
  for (const mod of modifiersInput || []) {
    if (!mod || !mod.id) {
      const err = new Error('Her ürün seçeneği için geçerli bir id gerekli');
      err.isBadRequest = true;
      throw err;
    }
    const row = db.prepare(`
      SELECT * FROM product_modifiers
      WHERE id = ? AND product_id = ? AND business_id = ? AND is_active = 1
    `).get(mod.id, product.id, businessId);
    if (!row) {
      const err = new Error('Geçersiz veya bu ürüne ait olmayan seçenek');
      err.isBadRequest = true;
      throw err;
    }
    itemPrice += row.price_delta;
    resolved.push({
      id: row.id,
      group_name: row.group_name,
      name: row.name,
      price_delta: row.price_delta,
    });
  }
  return { itemPrice, resolved, portionLabel };
}
