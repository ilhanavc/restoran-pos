import db from '../config/database.js';

function getJsonSetting(businessId, key, defaultValue) {
  const row = db.prepare('SELECT value FROM settings WHERE business_id = ? AND key = ?').get(businessId, key);
  if (!row?.value) return defaultValue;
  try {
    return JSON.parse(row.value);
  } catch {
    return defaultValue;
  }
}

function parsePrintOptions(raw) {
  if (!raw) return {};
  try {
    return JSON.parse(raw);
  } catch {
    return {};
  }
}

/** Yazıcı kaydından istasyon etiketi (payload için). */
export function stationFromPrinter(pr) {
  const po = parsePrintOptions(pr.print_options);
  const kg = po.kitchenGroups || {};
  if (kg.IZGARA) return 'IZGARA';
  if (kg.FIRIN) return 'FIRIN';
  if (kg.ICECEKLER) return 'ICECEKLER';
  if (pr.type === 'bar') return 'BAR';
  return 'KITCHEN';
}

function getActivePrinter(printerId, businessId) {
  return db.prepare(`SELECT * FROM printers WHERE id = ? AND business_id = ? AND is_active = 1`).get(printerId, businessId);
}

function findFirstPrinterByType(businessId, type) {
  return db
    .prepare(`SELECT * FROM printers WHERE business_id = ? AND type = ? AND is_active = 1 ORDER BY name LIMIT 1`)
    .get(businessId, type);
}

/**
 * Muıtfak satırı için hedef yazıcı.
 * a) printer_routing (category_id)
 * b) product / category printer_target (kitchen | bar)
 * c) type=kitchen / type=bar ilk aktif yazıcı
 * d) son çare: ilk aktif yazıcı
 */
export function resolvePrinterForKitchenLine(businessId, categoryId, productId) {
  const routed = db
    .prepare(`SELECT printer_id FROM printer_routing WHERE business_id = ? AND category_id = ?`)
    .get(businessId, categoryId);
  if (routed?.printer_id) {
    const pr = getActivePrinter(routed.printer_id, businessId);
    if (pr) return { printer: pr, source: 'printer_routing' };
  }

  const row = db
    .prepare(
      `SELECT p.printer_target AS pt, c.printer_target AS ct
       FROM products p JOIN categories c ON p.category_id = c.id
       WHERE p.id = ? AND p.business_id = ?`,
    )
    .get(productId, businessId);

  const target = String(row?.pt || row?.ct || 'kitchen')
    .toLowerCase()
    .trim();

  if (target === 'bar') {
    const pr = findFirstPrinterByType(businessId, 'bar');
    if (pr) return { printer: pr, source: 'printer_target_bar' };
  } else {
    const pr = findFirstPrinterByType(businessId, 'kitchen');
    if (pr) return { printer: pr, source: 'printer_target_kitchen' };
  }

  const fallback = db
    .prepare(`SELECT * FROM printers WHERE business_id = ? AND is_active = 1 ORDER BY name LIMIT 1`)
    .get(businessId);
  if (fallback) return { printer: fallback, source: 'fallback_active' };

  return { printer: null, source: 'none' };
}

/**
 * Fiş: defaultPrinterId (aktif) veya type=receipt ilk yazıcı.
 */
export function resolveReceiptPrinter(businessId) {
  const cfg = getJsonSetting(businessId, 'printer.config', {});
  if (cfg.defaultPrinterId) {
    const pr = getActivePrinter(cfg.defaultPrinterId, businessId);
    if (pr) return { printer: pr, source: 'defaultPrinterId' };
  }
  const pr = findFirstPrinterByType(businessId, 'receipt');
  if (pr) return { printer: pr, source: 'type_receipt' };
  return { printer: null, source: 'none' };
}
