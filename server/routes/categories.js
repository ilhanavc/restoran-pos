import { Router } from 'express';
import db from '../config/database.js';
import { authenticate, businessScope, authorize } from '../middleware/auth.js';
import { genId, auditLog } from '../utils/helpers.js';

const router = Router();
router.use(authenticate, businessScope);

const staffMenu = authorize('admin', 'cashier');

// GET /api/categories — include_inactive=1 ile pasif kategoriler (menü yönetimi)
router.get('/', (req, res) => {
  try {
    const includeInactive = req.query.include_inactive === '1' || req.query.include_inactive === 'true';
    let sql = 'SELECT * FROM categories WHERE business_id = ?';
    const params = [req.businessId];
    if (!includeInactive) {
      sql += ' AND is_active = 1';
    }
    sql += ' ORDER BY sort_order, name';
    res.json(db.prepare(sql).all(...params));
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/categories
router.post('/', staffMenu, (req, res) => {
  try {
    const { name, color, icon, printer_target } = req.body;
    if (!name) return res.status(400).json({ error: 'Kategori adı gerekli' });
    
    const id = genId();
    const maxSort = db.prepare('SELECT MAX(sort_order) as m FROM categories WHERE business_id = ?').get(req.businessId);
    
    db.prepare(`INSERT INTO categories (id, business_id, name, color, icon, printer_target, sort_order)
      VALUES (?, ?, ?, ?, ?, ?, ?)`).run(id, req.businessId, name, color || '#6366f1', icon || '', printer_target || 'kitchen', (maxSort?.m || 0) + 1);
    
    const cat = db.prepare('SELECT * FROM categories WHERE id = ?').get(id);
    res.status(201).json(cat);
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// PATCH /api/categories/:id
router.patch('/:id', staffMenu, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM categories WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!row) return res.status(404).json({ error: 'Kategori bulunamadı' });

    const { name, color, icon, sort_order, printer_target, is_active } = req.body;
    if (name !== undefined && !String(name).trim()) {
      return res.status(400).json({ error: 'Kategori adı boş olamaz' });
    }

    const dup = db.prepare(`
      SELECT id FROM categories WHERE business_id = ? AND LOWER(TRIM(name)) = LOWER(TRIM(?)) AND id != ? AND is_active = 1
    `).get(req.businessId, name !== undefined ? String(name).trim() : row.name, req.params.id);
    if (dup) {
      return res.status(400).json({ error: 'Bu isimde aktif bir kategori zaten var' });
    }

    db.prepare(`UPDATE categories SET
      name = COALESCE(?, name),
      color = COALESCE(?, color),
      icon = COALESCE(?, icon),
      sort_order = COALESCE(?, sort_order),
      printer_target = COALESCE(?, printer_target),
      is_active = COALESCE(?, is_active),
      updated_at = datetime('now')
      WHERE id = ? AND business_id = ?`).run(
      name !== undefined ? String(name).trim() : null,
      color ?? null,
      icon ?? null,
      sort_order !== undefined ? Number(sort_order) : null,
      printer_target ?? null,
      is_active !== undefined ? (is_active ? 1 : 0) : null,
      req.params.id,
      req.businessId,
    );

    auditLog(req.businessId, req.user.id, 'category_update', 'category', req.params.id, { name, is_active });
    const updated = db.prepare('SELECT * FROM categories WHERE id = ?').get(req.params.id);
    res.json(updated);
  } catch (err) {
    console.error('Category patch:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// DELETE /api/categories/:id — soft delete; ürünler is_deleted=1 yapılır
router.delete('/:id', staffMenu, (req, res) => {
  try {
    const row = db.prepare('SELECT * FROM categories WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!row) return res.status(404).json({ error: 'Kategori bulunamadı' });
    // SQLite: is_active 1/0; null veya 0 ise zaten pasif sayılır
    if (Number(row.is_active) !== 1) {
      return res.status(400).json({ error: 'Bu kategori zaten kaldırılmış' });
    }

    const txn = db.transaction(() => {
      db.prepare(`UPDATE categories SET is_active = 0, updated_at = datetime('now') WHERE id = ? AND business_id = ?`).run(
        req.params.id,
        req.businessId,
      );
      db.prepare(`UPDATE products SET is_deleted = 1, is_active = 0, updated_at = datetime('now')
        WHERE business_id = ? AND category_id = ?`).run(req.businessId, req.params.id);
    });
    txn();

    auditLog(req.businessId, req.user.id, 'category_delete', 'category', req.params.id, {});
    res.json({ success: true });
  } catch (err) {
    console.error('Category delete:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

export default router;
