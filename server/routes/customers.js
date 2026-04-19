import { Router } from 'express';
import db from '../config/database.js';
import { authenticate, businessScope } from '../middleware/auth.js';
import { genId } from '../utils/helpers.js';
import { recordEntityMutation } from '../services/entityMutationService.js';
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

function splitFullName(full) {
  const trimmed = cleanText(full).replace(/\s+/g, ' ');
  if (!trimmed) return { first_name: '', last_name: '' };
  const parts = trimmed.split(' ');
  if (parts.length === 1) return { first_name: parts[0], last_name: '' };
  return { first_name: parts[0], last_name: parts.slice(1).join(' ') };
}

function composeFullName(first, last) {
  return [cleanText(first), cleanText(last)].filter(Boolean).join(' ');
}

function normalizeImportRow(row) {
  const firstDirect = cleanText(rowPick(row, ['Müşteri Adı', 'Musteri Adi', 'first_name']));
  const lastDirect = cleanText(rowPick(row, ['Müşteri Soyadı', 'Musteri Soyadi', 'last_name']));
  let first_name = firstDirect;
  let last_name = lastDirect;
  let full_name = composeFullName(first_name, last_name);
  if (!first_name && !last_name) {
    const raw = cleanText(rowPick(row, ['Ad Soyad', 'ad soyad', 'full_name', 'name', 'Müşteri', 'musteri']));
    if (raw) {
      const split = splitFullName(raw);
      first_name = split.first_name;
      last_name = split.last_name;
      full_name = raw;
    }
  }

  const phoneRaw = cleanText(rowPick(row, ['Müşteri Telefonu', 'Telefon', 'telefon', 'phone', 'Telefon Numarası', 'Tel']));
  const phone2Raw = cleanText(rowPick(row, ['Müşteri Telefonu 2', 'Telefon 2', 'phone_2', 'Tel 2']));
  const phone = normalizePhoneDigits(phoneRaw);
  const phone_2 = normalizePhoneDigits(phone2Raw);

  const address = cleanText(rowPick(row, ['Müşteri Adresi', 'Adres', 'adres', 'address']));
  const address_title = cleanText(rowPick(row, ['Adres Başlığı', 'Adres Basligi', 'title'])) || 'Ev';
  const address_note = cleanText(rowPick(row, ['Adres Tarifi', 'Adres Notu', 'address_note']));
  const province = cleanText(rowPick(row, ['İl', 'Il', 'province']));
  const district = cleanText(rowPick(row, ['İlçe', 'Ilce', 'district']));
  const neighborhood = cleanText(rowPick(row, ['Mahalle', 'mahalle', 'neighborhood']));
  const totalOrders = parseIntSafe(rowPick(row, ['Toplam Sipariş Sayısı', 'Toplam Siparis Sayisi', 'toplam sipariş sayısı', 'total_orders']));
  return {
    full_name,
    first_name,
    last_name,
    phone,
    phone_2,
    normalized_phone: phone,
    address,
    address_title,
    address_note,
    province,
    district,
    neighborhood,
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
                id, business_id, full_name, first_name, last_name, total_orders
              ) VALUES (?, ?, ?, ?, ?, ?)
            `).run(
              customerId,
              req.businessId,
              n.full_name,
              n.first_name || null,
              n.last_name || null,
              n.total_orders || 0,
            );
            result.inserted += 1;
          } else {
            db.prepare(`
              UPDATE customers
              SET
                full_name = COALESCE(NULLIF(?, ''), full_name),
                first_name = COALESCE(NULLIF(?, ''), first_name),
                last_name = COALESCE(NULLIF(?, ''), last_name),
                total_orders = CASE WHEN ? > total_orders THEN ? ELSE total_orders END,
                updated_at = datetime('now')
              WHERE id = ? AND business_id = ?
            `).run(
              n.full_name,
              n.first_name,
              n.last_name,
              n.total_orders || 0,
              n.total_orders || 0,
              customerId,
              req.businessId,
            );
            result.updated += 1;
          }

          const phonesToInsert = [n.phone, n.phone_2].filter(Boolean);
          for (const p of phonesToInsert) {
            const existsPhone = db.prepare(
              'SELECT id FROM customer_phones WHERE customer_id = ? AND (normalized_phone = ? OR phone = ?)',
            ).get(customerId, p, p);
            if (!existsPhone) {
              const hasPrimary = db.prepare('SELECT id FROM customer_phones WHERE customer_id = ? AND is_primary = 1 LIMIT 1').get(customerId);
              db.prepare(`
                INSERT INTO customer_phones (id, customer_id, phone, is_primary, normalized_phone)
                VALUES (?, ?, ?, ?, ?)
              `).run(genId(), customerId, p, hasPrimary ? 0 : 1, p);
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
                INSERT INTO customer_addresses (id, customer_id, title, address, address_note, province, district, neighborhood, is_default)
                VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
              `).run(
                genId(),
                customerId,
                n.address_title || 'Ev',
                n.address,
                n.address_note || null,
                n.province || null,
                n.district || null,
                n.neighborhood || null,
                hasDefault ? 0 : 1,
              );
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
      const phonesArr = phoneMap[c.id] || [];
      const primaryPhone = pickPrimaryOrFirst(phonesArr, 'is_primary');
      const secondaryPhone = phonesArr.find((p) => p && p.id !== primaryPhone?.id) || null;
      const selectedAddress = pickPrimaryOrFirst(addressMap[c.id], 'is_default');
      const first = c.first_name || (c.full_name ? splitFullName(c.full_name).first_name : '');
      const last = c.last_name || (c.full_name ? splitFullName(c.full_name).last_name : '');
      return {
        'Müşteri Adı': first || '',
        'Müşteri Soyadı': last || '',
        'Müşteri Telefonu': primaryPhone?.phone || '',
        'Müşteri Telefonu 2': secondaryPhone?.phone || '',
        'Adres Başlığı': selectedAddress?.title || '',
        Adres: selectedAddress?.address || '',
        'Adres Tarifi': selectedAddress?.address_note || '',
        İl: selectedAddress?.province || '',
        İlçe: selectedAddress?.district || '',
        Mahalle: selectedAddress?.neighborhood || '',
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
    const {
      first_name: firstRaw,
      last_name: lastRaw,
      full_name: fullRaw,
      phone,
      phone_2,
      address,
      address_title,
      address_note,
      province,
      district,
      neighborhood,
      address_is_default,
      note,
    } = req.body;

    let first_name = cleanText(firstRaw);
    let last_name = cleanText(lastRaw);
    if (!first_name && !last_name && fullRaw) {
      const split = splitFullName(fullRaw);
      first_name = split.first_name;
      last_name = split.last_name;
    }
    if (!first_name) return res.status(400).json({ error: 'Müşteri adı gerekli' });
    const full_name = composeFullName(first_name, last_name);

    const phonesToInsert = [];
    const phone1Norm = normalizePhoneDigits(phone);
    if (phone1Norm) phonesToInsert.push(phone1Norm);
    const phone2Norm = normalizePhoneDigits(phone_2);
    if (phone2Norm && phone2Norm !== phone1Norm) phonesToInsert.push(phone2Norm);

    const customerId = genId();
    const txn = db.transaction(() => {
      db.prepare('INSERT INTO customers (id, business_id, full_name, first_name, last_name, note) VALUES (?, ?, ?, ?, ?, ?)')
        .run(customerId, req.businessId, full_name, first_name || null, last_name || null, note || null);

      phonesToInsert.forEach((p, idx) => {
        db.prepare(
          'INSERT INTO customer_phones (id, customer_id, phone, is_primary, normalized_phone) VALUES (?, ?, ?, ?, ?)',
        ).run(genId(), customerId, p, idx === 0 ? 1 : 0, p);
      });

      if (address) {
        db.prepare(
          `INSERT INTO customer_addresses (id, customer_id, title, address, address_note, province, district, neighborhood, is_default)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
        ).run(
          genId(),
          customerId,
          cleanText(address_title) || 'Ev',
          cleanText(address),
          cleanText(address_note) || null,
          cleanText(province) || null,
          cleanText(district) || null,
          cleanText(neighborhood) || null,
          address_is_default === false ? 0 : 1,
        );
      }
    });
    txn();

    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
    customer.phones = db.prepare('SELECT * FROM customer_phones WHERE customer_id = ?').all(customerId);
    customer.addresses = db.prepare('SELECT * FROM customer_addresses WHERE customer_id = ?').all(customerId);
    recordEntityMutation({
      businessId: req.businessId,
      entityTable: 'customers',
      entityId: customerId,
      action: 'create',
      after: customer,
      actorUserId: req.user?.id || null,
      requestId: req.requestId,
    });
    res.status(201).json(customer);
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// PATCH /api/customers/:id
router.patch('/:id', (req, res) => {
  try {
    const { first_name: firstRaw, last_name: lastRaw, full_name: fullRaw, note } = req.body;
    const before = db.prepare('SELECT * FROM customers WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!before) return res.status(404).json({ error: 'Müşteri bulunamadı' });

    let first_name = firstRaw != null ? cleanText(firstRaw) : null;
    let last_name = lastRaw != null ? cleanText(lastRaw) : null;
    if (first_name == null && last_name == null && fullRaw != null) {
      const split = splitFullName(fullRaw);
      first_name = split.first_name;
      last_name = split.last_name;
    }
    const newFirst = first_name != null ? first_name : before.first_name;
    const newLast = last_name != null ? last_name : before.last_name;
    const full_name = composeFullName(newFirst, newLast) || (fullRaw != null ? cleanText(fullRaw) : before.full_name);

    db.prepare(
      `UPDATE customers
       SET full_name = ?, first_name = ?, last_name = ?, note = COALESCE(?, note), updated_at = datetime('now')
       WHERE id = ? AND business_id = ?`,
    ).run(full_name || null, newFirst || null, newLast || null, note ?? null, req.params.id, req.businessId);

    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    customer.phones = db.prepare('SELECT * FROM customer_phones WHERE customer_id = ?').all(customer.id);
    customer.addresses = db.prepare('SELECT * FROM customer_addresses WHERE customer_id = ?').all(customer.id);
    recordEntityMutation({
      businessId: req.businessId,
      entityTable: 'customers',
      entityId: req.params.id,
      action: 'update',
      before,
      after: customer,
      actorUserId: req.user?.id || null,
      requestId: req.requestId,
    });
    res.json(customer);
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/customers/:id/phones
router.post('/:id/phones', (req, res) => {
  try {
    const { phone } = req.body;
    const stored = normalizePhoneDigits(phone);
    if (!stored) return res.status(400).json({ error: 'Telefon gerekli' });
    db.prepare(
      'INSERT INTO customer_phones (id, customer_id, phone, normalized_phone) VALUES (?, ?, ?, ?)',
    ).run(genId(), req.params.id, stored, stored);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/customers/:id/addresses
router.post('/:id/addresses', (req, res) => {
  try {
    const {
      title,
      address,
      address_note,
      province,
      district,
      neighborhood,
      is_default,
    } = req.body;
    if (!address) return res.status(400).json({ error: 'Adres gerekli' });
    const titleVal = cleanText(title).slice(0, 15) || 'Diğer';

    const txn = db.transaction(() => {
      if (is_default) {
        db.prepare('UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?').run(req.params.id);
      }
      db.prepare(
        `INSERT INTO customer_addresses
         (id, customer_id, title, address, address_note, province, district, neighborhood, is_default)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).run(
        genId(),
        req.params.id,
        titleVal,
        cleanText(address),
        cleanText(address_note) || null,
        cleanText(province) || null,
        cleanText(district) || null,
        cleanText(neighborhood) || null,
        is_default ? 1 : 0,
      );
    });
    txn();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// PATCH /api/customers/:id/addresses/:addressId
router.patch('/:id/addresses/:addressId', (req, res) => {
  try {
    const {
      title,
      address,
      address_note,
      province,
      district,
      neighborhood,
      is_default,
    } = req.body;

    const existing = db
      .prepare('SELECT id FROM customer_addresses WHERE id = ? AND customer_id = ?')
      .get(req.params.addressId, req.params.id);
    if (!existing) return res.status(404).json({ error: 'Adres bulunamadı' });

    const txn = db.transaction(() => {
      if (is_default) {
        db.prepare('UPDATE customer_addresses SET is_default = 0 WHERE customer_id = ?').run(req.params.id);
      }
      const titleVal = title != null ? cleanText(title).slice(0, 15) : null;
      db.prepare(
        `UPDATE customer_addresses
         SET title = COALESCE(?, title),
             address = COALESCE(?, address),
             address_note = COALESCE(?, address_note),
             province = COALESCE(?, province),
             district = COALESCE(?, district),
             neighborhood = COALESCE(?, neighborhood),
             is_default = CASE WHEN ? IS NOT NULL THEN ? ELSE is_default END
         WHERE id = ? AND customer_id = ?`,
      ).run(
        titleVal || null,
        address != null ? cleanText(address) : null,
        address_note != null ? cleanText(address_note) : null,
        province != null ? cleanText(province) : null,
        district != null ? cleanText(district) : null,
        neighborhood != null ? cleanText(neighborhood) : null,
        is_default === undefined ? null : (is_default ? 1 : 0),
        is_default ? 1 : 0,
        req.params.addressId,
        req.params.id,
      );
    });
    txn();
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// DELETE /api/customers/:id/addresses/:addressId
router.delete('/:id/addresses/:addressId', (req, res) => {
  try {
    const info = db
      .prepare('DELETE FROM customer_addresses WHERE id = ? AND customer_id = ?')
      .run(req.params.addressId, req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Adres bulunamadı' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// DELETE /api/customers/:id/phones/:phoneId
router.delete('/:id/phones/:phoneId', (req, res) => {
  try {
    const info = db
      .prepare('DELETE FROM customer_phones WHERE id = ? AND customer_id = ?')
      .run(req.params.phoneId, req.params.id);
    if (info.changes === 0) return res.status(404).json({ error: 'Telefon bulunamadı' });
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

export default router;
