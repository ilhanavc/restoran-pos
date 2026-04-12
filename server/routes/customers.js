import { Router } from 'express';
import db from '../config/database.js';
import { authenticate, businessScope } from '../middleware/auth.js';
import { genId, normalizePhone } from '../utils/helpers.js';
import { normalizePhoneDigits } from '../utils/phoneNormalize.js';

const router = Router();
router.use(authenticate, businessScope);

const importPreviewCache = new Map();
const IMPORT_PREVIEW_TTL_MS = 15 * 60 * 1000;
const DEFAULT_PREVIEW_PAGE_SIZE = 250;
const MAX_PREVIEW_PAGE_SIZE = 500;

function cleanText(value) {
  if (value == null) return '';
  return String(value).trim();
}

function normalizeSearchTextTR(value) {
  const t = cleanText(value);
  if (!t) return '';
  return t
    .replace(/İ/g, 'i')
    .replace(/I/g, 'ı')
    .toLocaleLowerCase('tr-TR');
}

function parseMoney(value) {
  const raw = cleanText(value);
  if (!raw) return 0;
  const normalized = raw.replace(/\./g, '').replace(',', '.').replace(/[^\d.-]/g, '');
  const n = parseFloat(normalized);
  return Number.isFinite(n) ? n : 0;
}

function parseIntSafe(value) {
  const raw = cleanText(value);
  if (!raw) return 0;
  const n = parseInt(raw.replace(/[^\d-]/g, ''), 10);
  return Number.isFinite(n) ? n : 0;
}

function rowPick(row, keys) {
  if (!row || typeof row !== 'object') return '';
  for (const key of keys) {
    if (Object.prototype.hasOwnProperty.call(row, key)) return row[key];
  }
  return '';
}

function normalizeImportRow(row) {
  const full_name = cleanText(rowPick(row, ['Ad Soyad', 'ad soyad', 'full_name', 'name', 'Müşteri', 'musteri']));
  const phoneRaw = cleanText(rowPick(row, ['Telefon', 'telefon', 'phone', 'Telefon Numarası', 'Tel']));
  const normalizedPhone = normalizePhoneDigits(phoneRaw);
  const phone = normalizedPhone || (phoneRaw ? normalizePhone(phoneRaw) : '');
  const address = cleanText(rowPick(row, ['Adres', 'adres', 'address']));
  const district = cleanText(rowPick(row, ['Mahalle', 'mahalle', 'district']));
  const legacyNo = cleanText(rowPick(row, ['No', 'no', 'Müşteri No']));
  const legacyBalance = parseMoney(rowPick(row, ['Bakiye', 'bakiye', 'balance']));
  const legacyTotalAmount = parseMoney(rowPick(row, ['Toplam Tutar', 'toplam tutar', 'total_amount']));
  const legacyDiscountAmount = parseMoney(rowPick(row, ['İndirim Tutarı', 'indirim tutarı', 'Indirim Tutari', 'discount_amount']));
  const totalOrders = parseIntSafe(rowPick(row, ['Toplam Sipariş Sayısı', 'Toplam Siparis Sayisi', 'toplam sipariş sayısı', 'total_orders']));
  return {
    full_name,
    phone,
    normalized_phone: normalizedPhone || '',
    address,
    district,
    legacy_no: legacyNo || null,
    legacy_balance: legacyBalance,
    legacy_total_amount: legacyTotalAmount,
    legacy_discount_amount: legacyDiscountAmount,
    total_orders: totalOrders,
  };
}

function findExistingCustomerId(businessId, normalizedPhone, fullName) {
  if (normalizedPhone) {
    const byPhone = db.prepare(`
      SELECT c.id
      FROM customers c
      JOIN customer_phones cp ON cp.customer_id = c.id
      WHERE c.business_id = ? AND cp.normalized_phone = ?
      ORDER BY c.created_at ASC
      LIMIT 1
    `).get(businessId, normalizedPhone);
    if (byPhone?.id) return byPhone.id;
  }
  if (fullName) {
    const byName = db.prepare(`
      SELECT id FROM customers
      WHERE business_id = ? AND lower(trim(full_name)) = lower(trim(?))
      ORDER BY created_at ASC
      LIMIT 1
    `).get(businessId, fullName);
    if (byName?.id) return byName.id;
  }
  return null;
}

function buildPreview(rows, businessId) {
  const previewRows = [];
  const summary = { insert_count: 0, update_count: 0, skip_count: 0, error_count: 0, warning_count: 0 };
  for (let i = 0; i < rows.length; i++) {
    const source = rows[i];
    const normalized = normalizeImportRow(source);
    const issues = [];
    if (!normalized.full_name || normalized.full_name.length < 2) {
      issues.push({ level: 'error', message: 'Ad Soyad geçersiz veya boş' });
    }
    if (!normalized.normalized_phone) {
      issues.push({ level: 'warning', message: 'Telefon yok/geçersiz; isimle eşleme denenecek' });
    }
    const existingCustomerId = normalized.full_name
      ? findExistingCustomerId(businessId, normalized.normalized_phone, normalized.full_name)
      : null;
    let action = existingCustomerId ? 'update' : 'insert';
    if (issues.some((x) => x.level === 'error')) {
      action = 'skip';
      summary.error_count += 1;
      summary.skip_count += 1;
    } else if (action === 'update') {
      summary.update_count += 1;
    } else {
      summary.insert_count += 1;
    }
    if (issues.some((x) => x.level === 'warning')) summary.warning_count += 1;
    previewRows.push({
      row_number: i + 2,
      action,
      existing_customer_id: existingCustomerId,
      issues,
      normalized,
    });
  }
  return { previewRows, summary };
}

function parsePositiveInt(value, fallback) {
  const n = parseInt(String(value ?? ''), 10);
  if (!Number.isFinite(n) || n <= 0) return fallback;
  return n;
}

function paginateRows(rows, page, pageSize) {
  const totalRows = rows.length;
  const totalPages = Math.max(1, Math.ceil(totalRows / pageSize));
  const safePage = Math.min(Math.max(1, page), totalPages);
  const start = (safePage - 1) * pageSize;
  const end = start + pageSize;
  return {
    pageRows: rows.slice(start, end),
    page: safePage,
    page_size: pageSize,
    total_rows: totalRows,
    total_pages: totalPages,
  };
}

function pickPrimaryOrFirst(rows, primaryField) {
  if (!Array.isArray(rows) || rows.length === 0) return null;
  return rows.find((r) => Number(r?.[primaryField]) === 1) || rows[0];
}

// POST /api/customers/import/preview
router.post('/import/preview', (req, res) => {
  try {
    const page = parsePositiveInt(req.body?.page, 1);
    const pageSize = Math.min(MAX_PREVIEW_PAGE_SIZE, parsePositiveInt(req.body?.page_size, DEFAULT_PREVIEW_PAGE_SIZE));
    const existingToken = cleanText(req.body?.preview_token);
    let token = existingToken;
    let cached = existingToken ? importPreviewCache.get(existingToken) : null;

    if (!cached) {
      const rows = Array.isArray(req.body?.rows) ? req.body.rows : [];
      if (!rows.length) return res.status(400).json({ error: 'İçe aktarma için satır bulunamadı' });
      if (rows.length > 10000) return res.status(400).json({ error: 'Tek seferde en fazla 10000 satır yüklenebilir' });
      const { previewRows, summary } = buildPreview(rows, req.businessId);
      token = genId();
      cached = {
        businessId: req.businessId,
        createdAt: Date.now(),
        previewRows,
        summary,
      };
      importPreviewCache.set(token, cached);
    } else {
      if (cached.businessId !== req.businessId) return res.status(403).json({ error: 'Bu preview size ait değil' });
      cached.createdAt = Date.now();
    }

    const pager = paginateRows(cached.previewRows, page, pageSize);
    for (const [k, v] of importPreviewCache.entries()) {
      if (Date.now() - v.createdAt > IMPORT_PREVIEW_TTL_MS) importPreviewCache.delete(k);
    }
    res.json({
      preview_token: token,
      ...cached.summary,
      rows: pager.pageRows,
      page: pager.page,
      page_size: pager.page_size,
      total_rows: pager.total_rows,
      total_pages: pager.total_pages,
    });
  } catch (err) {
    console.error('customers import preview error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/customers/import/commit
router.post('/import/commit', (req, res) => {
  try {
    const previewToken = cleanText(req.body?.preview_token);
    if (!previewToken) return res.status(400).json({ error: 'preview_token gerekli' });
    const cached = importPreviewCache.get(previewToken);
    if (!cached) return res.status(400).json({ error: 'Preview bulunamadı veya süresi doldu' });
    if (cached.businessId !== req.businessId) return res.status(403).json({ error: 'Bu preview size ait değil' });

    const result = {
      inserted: 0,
      updated: 0,
      skipped: 0,
      errors: [],
    };

    const tx = db.transaction(() => {
      for (const row of cached.previewRows) {
        if (row.action === 'skip') {
          result.skipped += 1;
          continue;
        }
        const n = row.normalized;
        try {
          let customerId = row.existing_customer_id || null;
          if (!customerId) {
            customerId = genId();
            db.prepare(`
              INSERT INTO customers (
                id, business_id, full_name, total_orders,
                legacy_no, legacy_balance, legacy_total_amount, legacy_discount_amount
              ) VALUES (?, ?, ?, ?, ?, ?, ?, ?)
            `).run(
              customerId,
              req.businessId,
              n.full_name,
              n.total_orders || 0,
              n.legacy_no,
              n.legacy_balance || 0,
              n.legacy_total_amount || 0,
              n.legacy_discount_amount || 0,
            );
            result.inserted += 1;
          } else {
            db.prepare(`
              UPDATE customers
              SET
                full_name = COALESCE(NULLIF(?, ''), full_name),
                total_orders = CASE WHEN ? > total_orders THEN ? ELSE total_orders END,
                legacy_no = COALESCE(?, legacy_no),
                legacy_balance = ?,
                legacy_total_amount = ?,
                legacy_discount_amount = ?,
                updated_at = datetime('now')
              WHERE id = ? AND business_id = ?
            `).run(
              n.full_name,
              n.total_orders || 0,
              n.total_orders || 0,
              n.legacy_no,
              n.legacy_balance || 0,
              n.legacy_total_amount || 0,
              n.legacy_discount_amount || 0,
              customerId,
              req.businessId,
            );
            result.updated += 1;
          }

          if (n.phone) {
            const existsPhone = n.normalized_phone
              ? db.prepare('SELECT id FROM customer_phones WHERE customer_id = ? AND normalized_phone = ?').get(customerId, n.normalized_phone)
              : db.prepare('SELECT id FROM customer_phones WHERE customer_id = ? AND phone = ?').get(customerId, n.phone);
            if (!existsPhone) {
              const hasPrimary = db.prepare('SELECT id FROM customer_phones WHERE customer_id = ? AND is_primary = 1 LIMIT 1').get(customerId);
              db.prepare(`
                INSERT INTO customer_phones (id, customer_id, phone, is_primary, normalized_phone)
                VALUES (?, ?, ?, ?, ?)
              `).run(genId(), customerId, n.phone, hasPrimary ? 0 : 1, n.normalized_phone || n.phone);
            }
          }

          if (n.address) {
            const existsAddr = db.prepare(`
              SELECT id FROM customer_addresses
              WHERE customer_id = ? AND lower(trim(address)) = lower(trim(?))
              LIMIT 1
            `).get(customerId, n.address);
            if (!existsAddr) {
              const hasDefault = db.prepare('SELECT id FROM customer_addresses WHERE customer_id = ? AND is_default = 1 LIMIT 1').get(customerId);
              db.prepare(`
                INSERT INTO customer_addresses (id, customer_id, title, address, address_note, is_default)
                VALUES (?, ?, ?, ?, ?, ?)
              `).run(genId(), customerId, 'Ev', n.address, n.district || null, hasDefault ? 0 : 1);
            }
          }
        } catch (e) {
          result.skipped += 1;
          result.errors.push({ row_number: row.row_number, error: e.message || 'Kayıt işlenemedi' });
        }
      }
    });
    tx();
    importPreviewCache.delete(previewToken);
    res.json(result);
  } catch (err) {
    console.error('customers import commit error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/customers
// ?search=  — isim araması (min 2 karakter)
// ?phone=   — telefon araması
// ?page=    — sayfa no (varsayılan 1), sadece search/phone yokken geçerli
// ?limit=   — sayfa boyutu (varsayılan 50, maks 200)
router.get('/', (req, res) => {
  try {
    const { search, phone } = req.query;
    const page = Math.max(1, parseInt(req.query.page || '1', 10) || 1);
    const limit = Math.min(200, Math.max(1, parseInt(req.query.limit || '50', 10) || 50));
    const offset = (page - 1) * limit;

    const normalizedSearch = normalizeSearchTextTR(search);
    let customers = [];
    let total = 0;

    if (phone) {
      const normalized = normalizePhoneDigits(phone);
      const phoneResults = normalized
        ? db.prepare(`
        SELECT c.* FROM customers c
        JOIN customer_phones cp ON c.id = cp.customer_id
        WHERE c.business_id = ? AND (
          cp.normalized_phone = ?
          OR cp.phone LIKE ?
          OR cp.phone LIKE ?
        )
        ORDER BY c.full_name
        LIMIT 50
      `).all(req.businessId, normalized, `%${phone}%`, `%${normalized}%`)
        : db.prepare(`
        SELECT c.* FROM customers c
        JOIN customer_phones cp ON c.id = cp.customer_id
        WHERE c.business_id = ? AND cp.phone LIKE ?
        ORDER BY c.full_name
        LIMIT 50
      `).all(req.businessId, `%${phone}%`);

      // Deduplicate
      const seen = new Set();
      for (const r of phoneResults) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        customers.push(r);
      }
      total = customers.length;
    } else {
      const whereParts = ['business_id = ?'];
      const params = [req.businessId];
      if (normalizedSearch) {
        whereParts.push('lower(replace(replace(full_name, \'İ\', \'i\'), \'I\', \'ı\')) LIKE ?');
        params.push(`%${normalizedSearch}%`);
      }
      const where = whereParts.join(' AND ');
      const countRow = db.prepare(`SELECT COUNT(*) as cnt FROM customers WHERE ${where}`).get(...params);
      total = countRow.cnt;
      customers = db.prepare(`SELECT * FROM customers WHERE ${where} ORDER BY full_name LIMIT ? OFFSET ?`)
        .all(...params, limit, offset);
    }

    // İlişkili veriler (N+1 önleme)
    const customerIds = customers.map(c => c.id);
    if (customerIds.length > 0) {
      const placeholders = customerIds.map(() => '?').join(',');
      const allPhones = db.prepare(`SELECT * FROM customer_phones WHERE customer_id IN (${placeholders})`).all(...customerIds);
      const allAddresses = db.prepare(`SELECT * FROM customer_addresses WHERE customer_id IN (${placeholders})`).all(...customerIds);

      const phoneMap = {};
      const addressMap = {};
      for (const p of allPhones) {
        if (!phoneMap[p.customer_id]) phoneMap[p.customer_id] = [];
        phoneMap[p.customer_id].push(p);
      }
      for (const a of allAddresses) {
        if (!addressMap[a.customer_id]) addressMap[a.customer_id] = [];
        addressMap[a.customer_id].push(a);
      }
      for (const c of customers) {
        c.phones = phoneMap[c.id] || [];
        c.addresses = addressMap[c.id] || [];
      }
    }

    res.json({
      customers,
      total,
      page: phone || normalizedSearch ? 1 : page,
      limit,
      has_more: !phone && !normalizedSearch && offset + customers.length < total,
    });
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/customers/export
router.get('/export', (req, res) => {
  try {
    const customers = db.prepare(`
      SELECT *
      FROM customers
      WHERE business_id = ?
      ORDER BY full_name
    `).all(req.businessId);

    if (!customers.length) return res.json([]);

    const customerIds = customers.map((c) => c.id);
    const placeholders = customerIds.map(() => '?').join(',');
    const allPhones = db.prepare(`SELECT * FROM customer_phones WHERE customer_id IN (${placeholders})`).all(...customerIds);
    const allAddresses = db.prepare(`SELECT * FROM customer_addresses WHERE customer_id IN (${placeholders})`).all(...customerIds);

    const phoneMap = {};
    const addressMap = {};
    for (const p of allPhones) {
      if (!phoneMap[p.customer_id]) phoneMap[p.customer_id] = [];
      phoneMap[p.customer_id].push(p);
    }
    for (const a of allAddresses) {
      if (!addressMap[a.customer_id]) addressMap[a.customer_id] = [];
      addressMap[a.customer_id].push(a);
    }

    const rows = customers.map((c) => {
      const selectedPhone = pickPrimaryOrFirst(phoneMap[c.id], 'is_primary');
      const selectedAddress = pickPrimaryOrFirst(addressMap[c.id], 'is_default');
      return {
        No: c.legacy_no || '',
        'Ad Soyad': c.full_name || '',
        Telefon: selectedPhone?.phone || '',
        Mahalle: selectedAddress?.address_note || '',
        Adres: selectedAddress?.address || '',
        Bakiye: Number(c.legacy_balance || 0),
        'Toplam Tutar': Number(c.legacy_total_amount || 0),
        'İndirim Tutarı': Number(c.legacy_discount_amount || 0),
        'Toplam Sipariş Sayısı': Number(c.total_orders || 0),
      };
    });

    res.json(rows);
  } catch (err) {
    console.error('customers export error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/customers/:id
router.get('/:id', (req, res) => {
  try {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!customer) return res.status(404).json({ error: 'Müşteri bulunamadı' });
    
    customer.phones = db.prepare('SELECT * FROM customer_phones WHERE customer_id = ?').all(customer.id);
    customer.addresses = db.prepare('SELECT * FROM customer_addresses WHERE customer_id = ?').all(customer.id);
    customer.recentOrders = db.prepare(`
      SELECT o.*, GROUP_CONCAT(oi.product_name || ' x' || oi.quantity, ', ') as items_summary
      FROM orders o 
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.customer_id = ? AND o.business_id = ?
      GROUP BY o.id
      ORDER BY o.created_at DESC LIMIT 10
    `).all(customer.id, req.businessId);
    
    res.json(customer);
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/customers
router.post('/', (req, res) => {
  try {
    const { full_name, phone, address, address_title, address_note, note } = req.body;
    if (!full_name) return res.status(400).json({ error: 'Müşteri adı gerekli' });

    const customerId = genId();
    const txn = db.transaction(() => {
      db.prepare('INSERT INTO customers (id, business_id, full_name, note) VALUES (?, ?, ?, ?)')
        .run(customerId, req.businessId, full_name, note || null);

      if (phone) {
        const digits = normalizePhoneDigits(phone);
        const stored = digits || normalizePhone(phone);
        db.prepare(
          'INSERT INTO customer_phones (id, customer_id, phone, is_primary, normalized_phone) VALUES (?, ?, ?, 1, ?)',
        ).run(genId(), customerId, stored, digits || stored);
      }
      if (address) {
        db.prepare('INSERT INTO customer_addresses (id, customer_id, title, address, address_note, is_default) VALUES (?, ?, ?, ?, ?, 1)')
          .run(genId(), customerId, address_title || 'Ev', address, address_note || null);
      }
    });
    txn();

    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
    customer.phones = db.prepare('SELECT * FROM customer_phones WHERE customer_id = ?').all(customerId);
    customer.addresses = db.prepare('SELECT * FROM customer_addresses WHERE customer_id = ?').all(customerId);
    res.status(201).json(customer);
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// PATCH /api/customers/:id
router.patch('/:id', (req, res) => {
  try {
    const { full_name, note } = req.body;
    db.prepare("UPDATE customers SET full_name = COALESCE(?, full_name), note = COALESCE(?, note), updated_at = datetime('now') WHERE id = ? AND business_id = ?")
      .run(full_name, note, req.params.id, req.businessId);
    
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    customer.phones = db.prepare('SELECT * FROM customer_phones WHERE customer_id = ?').all(customer.id);
    customer.addresses = db.prepare('SELECT * FROM customer_addresses WHERE customer_id = ?').all(customer.id);
    res.json(customer);
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/customers/:id/phones
router.post('/:id/phones', (req, res) => {
  try {
    const { phone } = req.body;
    const digits = normalizePhoneDigits(phone);
    const stored = digits || normalizePhone(phone);
    db.prepare(
      'INSERT INTO customer_phones (id, customer_id, phone, normalized_phone) VALUES (?, ?, ?, ?)',
    ).run(genId(), req.params.id, stored, digits || stored);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/customers/:id/stats — müşteri 360 profil istatistikleri
router.get('/:id/stats', (req, res) => {
  try {
    const customer = db.prepare('SELECT id FROM customers WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!customer) return res.status(404).json({ error: 'Müşteri bulunamadı' });

    const spend = db.prepare(`
      SELECT COALESCE(SUM(p.amount), 0) AS total_spend, COUNT(DISTINCT o.id) AS order_count
      FROM orders o
      JOIN payments p ON p.order_id = o.id
      WHERE o.customer_id = ? AND o.business_id = ? AND o.status = 'closed'
    `).get(req.params.id, req.businessId);

    const lastVisit = db.prepare(`
      SELECT MAX(closed_at) AS last_visit FROM orders
      WHERE customer_id = ? AND business_id = ? AND status = 'closed'
    `).get(req.params.id, req.businessId);

    const favorites = db.prepare(`
      SELECT oi.product_name, SUM(oi.quantity) AS total_qty
      FROM order_items oi
      JOIN orders o ON oi.order_id = o.id
      WHERE o.customer_id = ? AND o.business_id = ? AND o.status = 'closed' AND oi.status != 'cancelled'
      GROUP BY oi.product_name
      ORDER BY total_qty DESC
      LIMIT 3
    `).all(req.params.id, req.businessId);

    res.json({
      total_spend: spend.total_spend,
      order_count: spend.order_count,
      last_visit: lastVisit.last_visit,
      favorite_products: favorites,
    });
  } catch (err) {
    console.error('Customer stats:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/customers/:id/addresses
router.post('/:id/addresses', (req, res) => {
  try {
    const { title, address, address_note } = req.body;
    db.prepare('INSERT INTO customer_addresses (id, customer_id, title, address, address_note) VALUES (?, ?, ?, ?, ?)')
      .run(genId(), req.params.id, title || 'Diğer', address, address_note || null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

export default router;
