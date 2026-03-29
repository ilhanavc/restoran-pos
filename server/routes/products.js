import { Router } from 'express';
import db from '../config/database.js';
import { authenticate, businessScope, authorize } from '../middleware/auth.js';
import { genId, auditLog, normalizeTurkishSearch } from '../utils/helpers.js';

const router = Router();
router.use(authenticate, businessScope);

const staffMenu = authorize('admin', 'cashier');

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
    const { name, category_id, price, description, barcode, printer_target } = req.body;
    if (!name || !category_id || price === undefined) {
      return res.status(400).json({ error: 'Ürün adı, kategori ve fiyat gerekli' });
    }
    const id = genId();
    db.prepare(`INSERT INTO products (id, business_id, category_id, name, price, description, barcode, vat_rate, printer_target)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`).run(id, req.businessId, category_id, name, price, description || '', barcode || '', 0, printer_target || null);
    const product = db.prepare('SELECT * FROM products WHERE id = ?').get(id);
    res.status(201).json(product);
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/products/:id/modifiers
router.get('/:id/modifiers', (req, res) => {
  try {
    const modifiers = db.prepare(`
      SELECT * FROM product_modifiers WHERE product_id = ? AND business_id = ? AND is_active = 1 ORDER BY group_name, sort_order
    `).all(req.params.id, req.businessId);
    
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

// PATCH /api/products/:id
router.patch('/:id', staffMenu, (req, res) => {
  try {
    const { name, price, category_id, description, is_active, barcode, is_deleted, sort_order } = req.body;
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });

    db.prepare(`UPDATE products SET 
      name = COALESCE(?, name), price = COALESCE(?, price), category_id = COALESCE(?, category_id),
      description = COALESCE(?, description), is_active = COALESCE(?, is_active),
      barcode = COALESCE(?, barcode), vat_rate = 0,
      is_deleted = COALESCE(?, is_deleted),
      sort_order = COALESCE(?, sort_order),
      updated_at = datetime('now') WHERE id = ? AND business_id = ?`)
      .run(
        name ?? null,
        price ?? null,
        category_id ?? null,
        description ?? null,
        is_active !== undefined ? (is_active ? 1 : 0) : null,
        barcode ?? null,
        is_deleted !== undefined ? (is_deleted ? 1 : 0) : null,
        sort_order !== undefined ? Number(sort_order) : null,
        req.params.id,
        req.businessId,
      );

    auditLog(req.businessId, req.user.id, 'product_update', 'product', req.params.id, { name, is_deleted });
    const updated = db.prepare('SELECT * FROM products WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    console.error('Product patch:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// DELETE /api/products/:id — soft delete (is_deleted=1, is_active=0)
router.delete('/:id', staffMenu, (req, res) => {
  try {
    const product = db.prepare('SELECT * FROM products WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });

    db.prepare(`UPDATE products SET is_deleted = 1, is_active = 0, updated_at = datetime('now')
      WHERE id = ? AND business_id = ?`).run(req.params.id, req.businessId);

    auditLog(req.businessId, req.user.id, 'product_delete', 'product', req.params.id, {});
    res.json({ success: true });
  } catch (err) {
    console.error('Product delete:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

export default router;
