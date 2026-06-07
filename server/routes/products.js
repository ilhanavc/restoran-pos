import { Router } from 'express';
import path from 'path';
import fs from 'fs';
import multer from 'multer';
import config from '../config/index.js';
import db from '../config/database.js';
import { authenticate, businessScope, authorize } from '../middleware/auth.js';
import { genId, auditLog, normalizeTurkishSearch } from '../utils/helpers.js';
import { recordEntityMutation } from '../services/entityMutationService.js';
import { toCents } from '../utils/money.js';

const userDataPath = config.userDataPath || process.env.USER_DATA_PATH || path.join(process.cwd(), 'data');
const UPLOADS_DIR = path.join(userDataPath, 'uploads', 'products');
fs.mkdirSync(UPLOADS_DIR, { recursive: true });

const storage = multer.diskStorage({
  destination: (_req, _file, cb) => cb(null, UPLOADS_DIR),
  filename: (_req, file, cb) => {
    const ext = path.extname(file.originalname).toLowerCase() || '.jpg';
    cb(null, `${Date.now()}-${Math.random().toString(36).slice(2)}${ext}`);
  },
});
const upload = multer({
  storage,
  limits: { fileSize: 5 * 1024 * 1024 },
  fileFilter: (_req, file, cb) => {
    if (file.mimetype.startsWith('image/')) cb(null, true);
    else cb(new Error('Sadece görsel dosyası yüklenebilir'));
  },
});

const router = Router();
router.use(authenticate, businessScope);

const staffMenu = authorize('admin', 'cashier');
const staff = authorize('admin', 'cashier', 'waiter');

/** @param {unknown} portions @param {number} basePrice */
function normalizePortionsInput(portions, basePrice) {
  const base = Number(basePrice);
  let list =
    Array.isArray(portions) && portions.length > 0
      ? portions.map((p, i) => ({
          label: String(p.label || '').trim(),
          price: Number(p.price),
          sort_order: p.sort_order !== undefined ? Number(p.sort_order) : i,
          is_default: !!p.is_default,
        }))
      : [{ label: 'Tam', price: base, sort_order: 0, is_default: true }];

  for (const p of list) {
    if (!p.label) {
      throw new Error('Porsiyon adı gerekli');
    }
    if (!Number.isFinite(p.price) || p.price <= 0) {
      throw new Error('Geçerli porsiyon fiyatı gerekli');
    }
  }
  list.sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0));
  let defIdx = list.findIndex((p) => p.is_default);
  if (defIdx < 0) {
    list[0].is_default = true;
    defIdx = 0;
  }
  list = list.map((p, i) => ({ ...p, is_default: i === defIdx }));
  return list;
}

function defaultPortionPrice(list) {
  const d = list.find((p) => p.is_default);
  return d ? d.price : list[0].price;
}

function assertValidBasePrice(price) {
  const value = Number(price);
  if (!Number.isFinite(value) || value <= 0) {
    const err = new Error('Geçerli ürün fiyatı gerekli');
    err.status = 400;
    throw err;
  }
  return value;
}

function assertCategoryExists(categoryId, businessId) {
  const category = db.prepare(
    'SELECT id FROM categories WHERE id = ? AND business_id = ? AND is_active = 1',
  ).get(categoryId, businessId);
  if (!category) {
    const err = new Error('Geçerli kategori gerekli');
    err.status = 400;
    throw err;
  }
}

function replaceProductPortions(businessId, productId, list) {
  db.prepare('DELETE FROM product_portions WHERE product_id = ? AND business_id = ?').run(productId, businessId);
  const ins = db.prepare(
    `INSERT INTO product_portions (id, business_id, product_id, label, price, price_cents, sort_order, is_default)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  );
  for (let i = 0; i < list.length; i++) {
    const p = list[i];
    ins.run(genId(), businessId, productId, p.label, p.price, toCents(p.price), i, p.is_default ? 1 : 0);
  }
}

// GET /api/products — include_deleted=1 menü yönetimi için silinmiş ürünleri de listeler
router.get('/', (req, res) => {
  try {
    const { category_id, search, include_deleted } = req.query;
    const withDeleted = include_deleted === '1' || include_deleted === 'true';
    let sql = `SELECT p.*, c.name as category_name FROM products p 
               JOIN categories c ON p.category_id = c.id 
               WHERE p.business_id = ?`;
    const params = [req.businessId];

    if (!withDeleted) {
      sql += ' AND p.is_active = 1 AND p.is_deleted = 0';
    }
    if (category_id) {
      sql += ' AND p.category_id = ?';
      params.push(category_id);
    }
    sql += ' ORDER BY p.sort_order, p.name';
    const rows = db.prepare(sql).all(...params);
    if (search) {
      const needle = normalizeTurkishSearch(search);
      if (!needle) {
        return res.json([]);
      }
      const filtered = rows.filter((r) => normalizeTurkishSearch(r.name).includes(needle));
      return res.json(filtered);
    }
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/products
router.post('/', staffMenu, (req, res) => {
  try {
    const { name, category_id, price, description, barcode, printer_target, portions } = req.body;
    if (!name || !category_id || price === undefined) {
      return res.status(400).json({ error: 'Ürün adı, kategori ve fiyat gerekli' });
    }
    const basePrice = assertValidBasePrice(price);
    assertCategoryExists(category_id, req.businessId);
    let normalized;
    try {
      normalized = normalizePortionsInput(portions, basePrice);
    } catch (e) {
      return res.status(400).json({ error: e.message || 'Porsiyon hatası' });
    }
    const salePrice = defaultPortionPrice(normalized);
    const id = genId();

    db.transaction(() => {
      db.prepare(`INSERT INTO products (id, business_id, category_id, name, price, price_cents, description, barcode, vat_rate, printer_target)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(
        id,
        req.businessId,
        category_id,
        name,
        salePrice,
        toCents(salePrice),
        description || '',
        barcode || '',
        0,
        printer_target || null,
      );
      replaceProductPortions(req.businessId, id, normalized);
    })();

    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    const portionRows = db
      .prepare(
        `SELECT * FROM product_portions WHERE product_id = ? AND business_id = ? ORDER BY sort_order, label`,
      )
      .all(id, req.businessId);
    recordEntityMutation({
      businessId: req.businessId,
      entityTable: 'products',
      entityId: id,
      action: 'create',
      after: { ...product, portions: portionRows },
      actorUserId: req.user.id,
      requestId: req.requestId,
    });
    res.status(201).json({ ...product, portions: portionRows });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('Product post:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/products/:id/modifiers
router.get('/:id/modifiers', (req, res) => {
  try {
    const modifiers = db
      .prepare(`
      SELECT * FROM product_modifiers WHERE product_id = ? AND business_id = ? AND is_active = 1 ORDER BY group_name, sort_order
    `)
      .all(req.params.id, req.businessId);

    const groups = {};
    for (const m of modifiers) {
      if (!groups[m.group_name]) groups[m.group_name] = [];
      groups[m.group_name].push(m);
    }
    res.json(groups);
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/products/:id — tek ürün + porsiyonlar (menü detay + sipariş ekranı)
router.get('/:id', staff, (req, res) => {
  try {
    const product = db
      .prepare(
        `SELECT p.*, c.name as category_name FROM products p
         JOIN categories c ON p.category_id = c.id
         WHERE p.id = ? AND p.business_id = ?`,
      )
      .get(req.params.id, req.businessId);
    if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });
    const portions = db
      .prepare(
        `SELECT * FROM product_portions WHERE product_id = ? AND business_id = ? ORDER BY sort_order, label`,
      )
      .all(req.params.id, req.businessId);
    res.json({ ...product, portions });
  } catch (err) {
    console.error('Product get:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// PATCH /api/products/:id
router.patch('/:id', staffMenu, (req, res) => {
  try {
    const {
      name,
      price,
      category_id,
      description,
      is_active,
      barcode,
      is_deleted,
      sort_order,
      printer_target,
      portions,
    } = req.body;
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });

    let normalized = null;
    let priceCoalesce = price !== undefined && price !== null ? Number(price) : null;
    if (price !== undefined && price !== null) {
      priceCoalesce = assertValidBasePrice(price);
    }
    if (category_id !== undefined && category_id !== null) {
      assertCategoryExists(category_id, req.businessId);
    }
    if (portions !== undefined) {
      try {
        normalized = normalizePortionsInput(portions, product.price);
        priceCoalesce = defaultPortionPrice(normalized);
      } catch (e) {
        return res.status(400).json({ error: e.message || 'Porsiyon hatası' });
      }
    }

    db.transaction(() => {
      if (normalized) {
        replaceProductPortions(req.businessId, req.params.id, normalized);
      } else if (price !== undefined && price !== null) {
        const defRow = db
          .prepare(
            `SELECT id FROM product_portions WHERE product_id = ? AND business_id = ? AND is_default = 1 LIMIT 1`,
          )
          .get(req.params.id, req.businessId);
        if (defRow) {
          db.prepare(`UPDATE product_portions SET price = ?, price_cents = ? WHERE id = ?`)
            .run(Number(price), toCents(price), defRow.id);
        }
      }
      db.prepare(`UPDATE products SET 
      name = COALESCE(?, name), price = COALESCE(?, price), price_cents = COALESCE(?, price_cents), category_id = COALESCE(?, category_id),
      description = COALESCE(?, description), is_active = COALESCE(?, is_active),
      barcode = COALESCE(?, barcode),
      printer_target = COALESCE(?, printer_target),
      is_deleted = COALESCE(?, is_deleted),
      sort_order = COALESCE(?, sort_order),
      updated_at = datetime('now') WHERE id = ? AND business_id = ?`)
        .run(
          name ?? null,
          priceCoalesce,
          priceCoalesce != null ? toCents(priceCoalesce) : null,
          category_id ?? null,
          description ?? null,
          is_active !== undefined ? (is_active ? 1 : 0) : null,
          barcode ?? null,
          printer_target !== undefined ? printer_target : null,
          is_deleted !== undefined ? (is_deleted ? 1 : 0) : null,
          sort_order !== undefined ? Number(sort_order) : null,
          req.params.id,
          req.businessId,
        );
    })();

    auditLog(req.businessId, req.user.id, 'product_update', 'product', req.params.id, { name, is_deleted });
    const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    const portionRows = db
      .prepare(
        `SELECT * FROM product_portions WHERE product_id = ? AND business_id = ? ORDER BY sort_order, label`,
      )
      .all(req.params.id, req.businessId);
    recordEntityMutation({
      businessId: req.businessId,
      entityTable: 'products',
      entityId: req.params.id,
      action: 'update',
      before: product,
      after: { ...updated, portions: portionRows },
      actorUserId: req.user.id,
      requestId: req.requestId,
    });
    res.json({ ...updated, portions: portionRows });
  } catch (err) {
    if (err.status === 400) return res.status(400).json({ error: err.message });
    console.error('Product patch:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/products/:id/image — görsel yükle
router.post('/:id/image', staffMenu, upload.single('image'), (req, res) => {
  try {
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });
    if (!req.file) return res.status(400).json({ error: 'Görsel dosyası gerekli' });

    // Delete old image if exists
    if (product.image_url) {
      const oldPath = path.join(UPLOADS_DIR, path.basename(product.image_url));
      fs.unlink(oldPath, () => {});
    }

    const imageUrl = `/uploads/products/${req.file.filename}`;
    db.prepare("UPDATE products SET image_url = ?, updated_at = datetime('now') WHERE id = ? AND business_id = ?")
      .run(imageUrl, req.params.id, req.businessId);

    res.json({ image_url: imageUrl });
  } catch (err) {
    console.error('Product image upload:', err);
    res.status(500).json({ error: 'Görsel yükleme başarısız' });
  }
});

// DELETE /api/products/:id/image — görseli kaldır
router.delete('/:id/image', staffMenu, (req, res) => {
  try {
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });

    if (product.image_url) {
      const oldPath = path.join(UPLOADS_DIR, path.basename(product.image_url));
      fs.unlink(oldPath, () => {});
      db.prepare("UPDATE products SET image_url = NULL, updated_at = datetime('now') WHERE id = ? AND business_id = ?")
        .run(req.params.id, req.businessId);
    }
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/products/:id/combos — combo içeriği listele
router.get('/:id/combos', staff, (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT pc.id, pc.child_product_id, pc.quantity, pc.sort_order,
             p.name AS child_name, p.price AS child_price, p.image_url AS child_image_url
      FROM product_combos pc
      JOIN products p ON pc.child_product_id = p.id
      WHERE pc.parent_product_id = ? AND pc.business_id = ?
      ORDER BY pc.sort_order, pc.created_at
    `).all(req.params.id, req.businessId);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/products/:id/combos — combo öğesi ekle
router.post('/:id/combos', staffMenu, (req, res) => {
  try {
    const { child_product_id, quantity = 1 } = req.body;
    if (!child_product_id) return res.status(400).json({ error: 'Alt ürün gerekli' });
    if (child_product_id === req.params.id) return res.status(400).json({ error: 'Ürün kendini içeremez' });

    const child = db.prepare('SELECT id, name FROM products WHERE id = ? AND business_id = ? AND is_deleted = 0').get(child_product_id, req.businessId);
    if (!child) return res.status(404).json({ error: 'Alt ürün bulunamadı' });

    const sortOrder = (db.prepare('SELECT COUNT(*) as c FROM product_combos WHERE parent_product_id = ?').get(req.params.id)?.c || 0);
    const id = genId();
    db.prepare(`INSERT OR REPLACE INTO product_combos (id, business_id, parent_product_id, child_product_id, quantity, sort_order)
      VALUES (?, ?, ?, ?, ?, ?)`)
      .run(id, req.businessId, req.params.id, child_product_id, Math.max(1, Number(quantity) || 1), sortOrder);

    res.status(201).json({ id, child_product_id, child_name: child.name, quantity: Number(quantity) || 1 });
  } catch (err) {
    console.error('Add combo:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// DELETE /api/products/:id/combos/:comboId — combo öğesini kaldır
router.delete('/:id/combos/:comboId', staffMenu, (req, res) => {
  try {
    db.prepare('DELETE FROM product_combos WHERE id = ? AND parent_product_id = ? AND business_id = ?')
      .run(req.params.comboId, req.params.id, req.businessId);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// DELETE /api/products/:id — hybrid: hard-delete if no order history, soft-delete otherwise
router.delete('/:id', staffMenu, (req, res) => {
  try {
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });

    const hasOrders = db.prepare('SELECT 1 FROM order_items WHERE product_id = ? LIMIT 1').get(req.params.id);

    let deleted = false;
    if (hasOrders) {
      // Soft-delete: preserve FK integrity with order history
      db.transaction(() => {
        db.prepare('DELETE FROM product_modifiers WHERE product_id = ?').run(req.params.id);
        db.prepare('DELETE FROM product_combos WHERE parent_product_id = ? OR child_product_id = ?').run(req.params.id, req.params.id);
        db.prepare("UPDATE products SET is_deleted = 1, is_active = 0, updated_at = datetime('now') WHERE id = ? AND business_id = ?")
          .run(req.params.id, req.businessId);
      })();
    } else {
      // Hard-delete: no order history, safe to remove permanently
      db.transaction(() => {
        db.prepare('DELETE FROM product_modifiers WHERE product_id = ?').run(req.params.id);
        db.prepare('DELETE FROM product_combos WHERE parent_product_id = ? OR child_product_id = ?').run(req.params.id, req.params.id);
        db.prepare('DELETE FROM product_portions WHERE product_id = ?').run(req.params.id);
        db.prepare('DELETE FROM product_attribute_groups WHERE product_id = ?').run(req.params.id);
        db.prepare('DELETE FROM products WHERE id = ? AND business_id = ?').run(req.params.id, req.businessId);
      })();
      deleted = true;

      if (product.image_url) {
        const imgFile = path.join(UPLOADS_DIR, path.basename(product.image_url));
        fs.unlink(imgFile, () => {});
      }
    }

    auditLog(req.businessId, req.user.id, 'product_delete', 'product', req.params.id, { hard_delete: deleted });
    recordEntityMutation({
      businessId: req.businessId,
      entityTable: 'products',
      entityId: req.params.id,
      action: 'delete',
      before: product,
      actorUserId: req.user.id,
      requestId: req.requestId,
    });
    res.json({ success: true, hard_delete: deleted });
  } catch (err) {
    console.error('Product delete:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

export default router;
