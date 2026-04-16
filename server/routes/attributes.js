import { Router } from 'express';
import { z } from 'zod';
import db from '../config/database.js';
import { authenticate, businessScope, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { genId } from '../utils/helpers.js';

const router = Router();
router.use(authenticate, businessScope);

// ─── Schemas ─────────────────────────────────────────────────────────────────

const groupSchema = {
  body: z.object({
    name: z.string().min(1).max(100),
    selection_type: z.enum(['single', 'multiple']).default('single'),
    is_required: z.boolean().default(false),
    is_active: z.boolean().default(true),
    sort_order: z.number().int().default(0),
  }),
};

const optionSchema = {
  body: z.object({
    name: z.string().min(1).max(100),
    extra_price: z.number().min(0).default(0),
    is_default: z.boolean().default(false),
    is_active: z.boolean().default(true),
    sort_order: z.number().int().default(0),
  }),
};

const assignSchema = {
  body: z.object({
    group_id: z.string().min(1),
  }),
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

function getGroupWithOptions(groupId, businessId) {
  const group = db
    .prepare('SELECT * FROM attribute_groups WHERE id = ? AND business_id = ?')
    .get(groupId, businessId);
  if (!group) return null;
  const options = db
    .prepare(
      'SELECT * FROM attribute_options WHERE group_id = ? AND is_active = 1 ORDER BY sort_order, created_at',
    )
    .all(groupId);
  return { ...group, options };
}

// ─── Özellik Grupları CRUD ────────────────────────────────────────────────────

// GET /api/attributes/groups
router.get('/groups', (req, res) => {
  const { businessId } = req;
  const groups = db
    .prepare(
      `SELECT ag.*,
        (SELECT COUNT(*) FROM attribute_options ao WHERE ao.group_id = ag.id AND ao.is_active = 1) as option_count
       FROM attribute_groups ag
       WHERE ag.business_id = ?
       ORDER BY ag.sort_order, ag.created_at`,
    )
    .all(businessId);

  // Tüm gruplara seçenekleri ekle
  const groupIds = groups.map((g) => g.id);
  let optionsByGroup = {};
  if (groupIds.length > 0) {
    const placeholders = groupIds.map(() => '?').join(',');
    const options = db
      .prepare(
        `SELECT * FROM attribute_options WHERE group_id IN (${placeholders}) AND is_active = 1 ORDER BY sort_order, created_at`,
      )
      .all(...groupIds);
    for (const opt of options) {
      if (!optionsByGroup[opt.group_id]) optionsByGroup[opt.group_id] = [];
      optionsByGroup[opt.group_id].push(opt);
    }
  }

  const result = groups.map((g) => ({
    ...g,
    options: optionsByGroup[g.id] || [],
  }));
  res.json(result);
});

// POST /api/attributes/groups
router.post('/groups', authorize(['admin']), validate(groupSchema), (req, res) => {
  const { businessId } = req;
  const { name, selection_type, is_required, is_active, sort_order } = req.body;
  const id = genId();
  db.prepare(
    `INSERT INTO attribute_groups (id, business_id, name, selection_type, is_required, is_active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, businessId, name.trim(), selection_type, is_required ? 1 : 0, is_active ? 1 : 0, sort_order);
  const created = getGroupWithOptions(id, businessId);
  res.status(201).json(created);
});

// PATCH /api/attributes/groups/:id
router.patch('/groups/:id', authorize(['admin']), validate(groupSchema), (req, res) => {
  const { businessId } = req;
  const { id } = req.params;
  const group = db
    .prepare('SELECT id FROM attribute_groups WHERE id = ? AND business_id = ?')
    .get(id, businessId);
  if (!group) return res.status(404).json({ error: 'Özellik grubu bulunamadı' });

  const { name, selection_type, is_required, is_active, sort_order } = req.body;
  db.prepare(
    `UPDATE attribute_groups
     SET name = ?, selection_type = ?, is_required = ?, is_active = ?, sort_order = ?, updated_at = datetime('now')
     WHERE id = ? AND business_id = ?`,
  ).run(name.trim(), selection_type, is_required ? 1 : 0, is_active ? 1 : 0, sort_order, id, businessId);

  res.json(getGroupWithOptions(id, businessId));
});

// DELETE /api/attributes/groups/:id
router.delete('/groups/:id', authorize(['admin']), (req, res) => {
  const { businessId } = req;
  const { id } = req.params;
  const group = db
    .prepare('SELECT id FROM attribute_groups WHERE id = ? AND business_id = ?')
    .get(id, businessId);
  if (!group) return res.status(404).json({ error: 'Özellik grubu bulunamadı' });

  db.transaction(() => {
    // Atamalar silinir (cascade yoksa manuel)
    db.prepare('DELETE FROM category_attribute_groups WHERE group_id = ?').run(id);
    db.prepare('DELETE FROM product_attribute_groups WHERE group_id = ?').run(id);
    db.prepare('DELETE FROM attribute_options WHERE group_id = ?').run(id);
    db.prepare('DELETE FROM attribute_groups WHERE id = ? AND business_id = ?').run(id, businessId);
  })();

  res.json({ ok: true });
});

// ─── Özellik Seçenekleri ──────────────────────────────────────────────────────

// GET /api/attributes/groups/:id/options
router.get('/groups/:id/options', (req, res) => {
  const { businessId } = req;
  const { id } = req.params;
  const group = db
    .prepare('SELECT id FROM attribute_groups WHERE id = ? AND business_id = ?')
    .get(id, businessId);
  if (!group) return res.status(404).json({ error: 'Özellik grubu bulunamadı' });

  const options = db
    .prepare('SELECT * FROM attribute_options WHERE group_id = ? ORDER BY sort_order, created_at')
    .all(id);
  res.json(options);
});

// POST /api/attributes/groups/:id/options
router.post('/groups/:id/options', authorize(['admin']), validate(optionSchema), (req, res) => {
  const { businessId } = req;
  const { id: groupId } = req.params;
  const group = db
    .prepare('SELECT id FROM attribute_groups WHERE id = ? AND business_id = ?')
    .get(groupId, businessId);
  if (!group) return res.status(404).json({ error: 'Özellik grubu bulunamadı' });

  const { name, extra_price, is_default, is_active, sort_order } = req.body;
  const optId = genId();
  db.prepare(
    `INSERT INTO attribute_options (id, group_id, business_id, name, extra_price, is_default, is_active, sort_order)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(optId, groupId, businessId, name.trim(), extra_price, is_default ? 1 : 0, is_active ? 1 : 0, sort_order);

  const created = db.prepare('SELECT * FROM attribute_options WHERE id = ?').get(optId);
  res.status(201).json(created);
});

// PATCH /api/attributes/options/:optionId
router.patch('/options/:optionId', authorize(['admin']), validate(optionSchema), (req, res) => {
  const { businessId } = req;
  const { optionId } = req.params;
  const opt = db
    .prepare(
      'SELECT ao.* FROM attribute_options ao JOIN attribute_groups ag ON ag.id = ao.group_id WHERE ao.id = ? AND ag.business_id = ?',
    )
    .get(optionId, businessId);
  if (!opt) return res.status(404).json({ error: 'Seçenek bulunamadı' });

  const { name, extra_price, is_default, is_active, sort_order } = req.body;
  db.prepare(
    `UPDATE attribute_options
     SET name = ?, extra_price = ?, is_default = ?, is_active = ?, sort_order = ?
     WHERE id = ?`,
  ).run(name.trim(), extra_price, is_default ? 1 : 0, is_active ? 1 : 0, sort_order, optionId);

  const updated = db.prepare('SELECT * FROM attribute_options WHERE id = ?').get(optionId);
  res.json(updated);
});

// DELETE /api/attributes/options/:optionId
router.delete('/options/:optionId', authorize(['admin']), (req, res) => {
  const { businessId } = req;
  const { optionId } = req.params;
  const opt = db
    .prepare(
      'SELECT ao.id FROM attribute_options ao JOIN attribute_groups ag ON ag.id = ao.group_id WHERE ao.id = ? AND ag.business_id = ?',
    )
    .get(optionId, businessId);
  if (!opt) return res.status(404).json({ error: 'Seçenek bulunamadı' });

  db.prepare('DELETE FROM attribute_options WHERE id = ?').run(optionId);
  res.json({ ok: true });
});

// ─── Kategori Atamaları ───────────────────────────────────────────────────────

// GET /api/attributes/category/:categoryId
router.get('/category/:categoryId', (req, res) => {
  const { businessId } = req;
  const { categoryId } = req.params;
  const rows = db
    .prepare(
      `SELECT ag.*, cag.id as assignment_id
       FROM category_attribute_groups cag
       JOIN attribute_groups ag ON ag.id = cag.group_id
       WHERE cag.category_id = ? AND cag.business_id = ?
       ORDER BY ag.sort_order, ag.name`,
    )
    .all(categoryId, businessId);

  // Seçenekleri de getir
  const groupIds = rows.map((r) => r.id);
  let optionsByGroup = {};
  if (groupIds.length > 0) {
    const placeholders = groupIds.map(() => '?').join(',');
    const options = db
      .prepare(
        `SELECT * FROM attribute_options WHERE group_id IN (${placeholders}) AND is_active = 1 ORDER BY sort_order, created_at`,
      )
      .all(...groupIds);
    for (const opt of options) {
      if (!optionsByGroup[opt.group_id]) optionsByGroup[opt.group_id] = [];
      optionsByGroup[opt.group_id].push(opt);
    }
  }

  res.json(rows.map((r) => ({ ...r, options: optionsByGroup[r.id] || [] })));
});

// POST /api/attributes/category/:categoryId/assign
router.post('/category/:categoryId/assign', authorize(['admin']), validate(assignSchema), (req, res) => {
  const { businessId } = req;
  const { categoryId } = req.params;
  const { group_id } = req.body;

  const cat = db
    .prepare('SELECT id FROM categories WHERE id = ? AND business_id = ?')
    .get(categoryId, businessId);
  if (!cat) return res.status(404).json({ error: 'Kategori bulunamadı' });

  const grp = db
    .prepare('SELECT id FROM attribute_groups WHERE id = ? AND business_id = ?')
    .get(group_id, businessId);
  if (!grp) return res.status(404).json({ error: 'Özellik grubu bulunamadı' });

  const existing = db
    .prepare('SELECT id FROM category_attribute_groups WHERE category_id = ? AND group_id = ?')
    .get(categoryId, group_id);
  if (existing) return res.status(409).json({ error: 'Bu grup zaten bu kategoriye atanmış' });

  const id = genId();
  db.prepare(
    'INSERT INTO category_attribute_groups (id, business_id, category_id, group_id) VALUES (?, ?, ?, ?)',
  ).run(id, businessId, categoryId, group_id);

  res.status(201).json({ id, category_id: categoryId, group_id });
});

// DELETE /api/attributes/category/:categoryId/:groupId
router.delete('/category/:categoryId/:groupId', authorize(['admin']), (req, res) => {
  const { businessId } = req;
  const { categoryId, groupId } = req.params;
  const row = db
    .prepare(
      'SELECT id FROM category_attribute_groups WHERE category_id = ? AND group_id = ? AND business_id = ?',
    )
    .get(categoryId, groupId, businessId);
  if (!row) return res.status(404).json({ error: 'Atama bulunamadı' });

  db.prepare('DELETE FROM category_attribute_groups WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

// ─── Ürün Atamaları ───────────────────────────────────────────────────────────

// GET /api/attributes/product/:productId
router.get('/product/:productId', (req, res) => {
  const { businessId } = req;
  const { productId } = req.params;
  const rows = db
    .prepare(
      `SELECT ag.*, pag.id as assignment_id
       FROM product_attribute_groups pag
       JOIN attribute_groups ag ON ag.id = pag.group_id
       WHERE pag.product_id = ? AND pag.business_id = ?
       ORDER BY ag.sort_order, ag.name`,
    )
    .all(productId, businessId);

  const groupIds = rows.map((r) => r.id);
  let optionsByGroup = {};
  if (groupIds.length > 0) {
    const placeholders = groupIds.map(() => '?').join(',');
    const options = db
      .prepare(
        `SELECT * FROM attribute_options WHERE group_id IN (${placeholders}) AND is_active = 1 ORDER BY sort_order, created_at`,
      )
      .all(...groupIds);
    for (const opt of options) {
      if (!optionsByGroup[opt.group_id]) optionsByGroup[opt.group_id] = [];
      optionsByGroup[opt.group_id].push(opt);
    }
  }

  res.json(rows.map((r) => ({ ...r, options: optionsByGroup[r.id] || [] })));
});

// POST /api/attributes/product/:productId/assign
router.post('/product/:productId/assign', authorize(['admin']), validate(assignSchema), (req, res) => {
  const { businessId } = req;
  const { productId } = req.params;
  const { group_id } = req.body;

  const prod = db
    .prepare('SELECT id FROM products WHERE id = ? AND business_id = ?')
    .get(productId, businessId);
  if (!prod) return res.status(404).json({ error: 'Ürün bulunamadı' });

  const grp = db
    .prepare('SELECT id FROM attribute_groups WHERE id = ? AND business_id = ?')
    .get(group_id, businessId);
  if (!grp) return res.status(404).json({ error: 'Özellik grubu bulunamadı' });

  const existing = db
    .prepare('SELECT id FROM product_attribute_groups WHERE product_id = ? AND group_id = ?')
    .get(productId, group_id);
  if (existing) return res.status(409).json({ error: 'Bu grup zaten bu ürüne atanmış' });

  const id = genId();
  db.prepare(
    'INSERT INTO product_attribute_groups (id, business_id, product_id, group_id) VALUES (?, ?, ?, ?)',
  ).run(id, businessId, productId, group_id);

  res.status(201).json({ id, product_id: productId, group_id });
});

// DELETE /api/attributes/product/:productId/:groupId
router.delete('/product/:productId/:groupId', authorize(['admin']), (req, res) => {
  const { businessId } = req;
  const { productId, groupId } = req.params;
  const row = db
    .prepare(
      'SELECT id FROM product_attribute_groups WHERE product_id = ? AND group_id = ? AND business_id = ?',
    )
    .get(productId, groupId, businessId);
  if (!row) return res.status(404).json({ error: 'Atama bulunamadı' });

  db.prepare('DELETE FROM product_attribute_groups WHERE id = ?').run(row.id);
  res.json({ ok: true });
});

// ─── Efektif Özellik Grupları (kategori + ürün, tekrarsız) ───────────────────

// GET /api/attributes/effective/:productId
router.get('/effective/:productId', (req, res) => {
  const { businessId } = req;
  const { productId } = req.params;

  const product = db
    .prepare('SELECT id, category_id FROM products WHERE id = ? AND business_id = ?')
    .get(productId, businessId);
  if (!product) return res.status(404).json({ error: 'Ürün bulunamadı' });

  // Kategori bazlı gruplar
  const catGroups = product.category_id
    ? db
        .prepare(
          `SELECT ag.*, 'category' as source
           FROM category_attribute_groups cag
           JOIN attribute_groups ag ON ag.id = cag.group_id
           WHERE cag.category_id = ? AND cag.business_id = ? AND ag.is_active = 1
           ORDER BY ag.sort_order, ag.name`,
        )
        .all(product.category_id, businessId)
    : [];

  // Ürün bazlı gruplar
  const prodGroups = db
    .prepare(
      `SELECT ag.*, 'product' as source
       FROM product_attribute_groups pag
       JOIN attribute_groups ag ON ag.id = pag.group_id
       WHERE pag.product_id = ? AND pag.business_id = ? AND ag.is_active = 1
       ORDER BY ag.sort_order, ag.name`,
    )
    .all(productId, businessId);

  // Birleştir, ürün seviyesi öncelikli (tekrar görünmez)
  const seen = new Set();
  const merged = [];
  for (const g of [...prodGroups, ...catGroups]) {
    if (!seen.has(g.id)) {
      seen.add(g.id);
      merged.push(g);
    }
  }

  // Sırala (sort_order)
  merged.sort((a, b) => (a.sort_order - b.sort_order) || a.name.localeCompare(b.name, 'tr'));

  // Seçenekleri ekle
  const groupIds = merged.map((g) => g.id);
  let optionsByGroup = {};
  if (groupIds.length > 0) {
    const placeholders = groupIds.map(() => '?').join(',');
    const options = db
      .prepare(
        `SELECT * FROM attribute_options WHERE group_id IN (${placeholders}) AND is_active = 1 ORDER BY sort_order, created_at`,
      )
      .all(...groupIds);
    for (const opt of options) {
      if (!optionsByGroup[opt.group_id]) optionsByGroup[opt.group_id] = [];
      optionsByGroup[opt.group_id].push(opt);
    }
  }

  res.json(merged.map((g) => ({ ...g, options: optionsByGroup[g.id] || [] })));
});

export default router;
