import { Router } from 'express';
import { z } from 'zod';
import db from '../config/database.js';
import { authenticate, businessScope, authorize } from '../middleware/auth.js';
import { validate } from '../middleware/validate.js';
import { genId } from '../utils/helpers.js';
import { recordEntityMutation } from '../services/entityMutationService.js';

const router = Router();
router.use(authenticate, businessScope);

const stockItemSchema = z.object({
  name: z.string().min(1).max(100),
  unit: z.string().min(1).max(20).default('adet'),
  quantity: z.number().default(0),
  min_quantity: z.number().min(0).default(0),
  cost_price: z.number().min(0).default(0),
});

const movementSchema = z.object({
  stock_item_id: z.string().min(1),
  movement_type: z.enum(['in', 'out', 'adjustment', 'waste']),
  quantity: z.number().positive(),
  notes: z.string().max(200).optional().nullable(),
});

// GET /api/stock
router.get('/', authorize('admin', 'cashier'), (req, res) => {
  try {
    const items = db.prepare(`
      SELECT * FROM stock_items WHERE business_id = ? AND is_active = 1 ORDER BY name
    `).all(req.businessId);
    res.json(items);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/stock
router.post('/', authorize('admin'), validate({ body: stockItemSchema }), (req, res) => {
  try {
    const id = genId();
    const { name, unit, quantity, min_quantity, cost_price } = req.body;
    db.prepare(`
      INSERT INTO stock_items (id, business_id, name, unit, quantity, min_quantity, cost_price)
      VALUES (?, ?, ?, ?, ?, ?, ?)
    `).run(id, req.businessId, name, unit, quantity, min_quantity, cost_price);
    const created = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(id);
    recordEntityMutation({
      businessId: req.businessId,
      entityTable: 'stock_items',
      entityId: id,
      action: 'create',
      after: created,
      actorUserId: req.user.id,
      requestId: req.requestId,
    });
    res.status(201).json(created);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// PATCH /api/stock/:id
router.patch('/:id', authorize('admin'), (req, res) => {
  try {
    const { id } = req.params;
    const item = db.prepare('SELECT * FROM stock_items WHERE id = ? AND business_id = ?').get(id, req.businessId);
    if (!item) return res.status(404).json({ error: 'Stok kalemi bulunamadı' });

    const allowed = ['name', 'unit', 'min_quantity', 'cost_price', 'is_active'];
    const fields = Object.keys(req.body).filter(k => allowed.includes(k));
    if (fields.length === 0) return res.status(400).json({ error: 'Güncellenecek alan yok' });

    const sets = fields.map(f => `${f} = ?`).join(', ');
    db.prepare(`UPDATE stock_items SET ${sets}, updated_at = datetime('now') WHERE id = ?`).run(...fields.map(f => req.body[f]), id);
    const updatedItem = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(id);
    recordEntityMutation({
      businessId: req.businessId,
      entityTable: 'stock_items',
      entityId: id,
      action: 'update',
      before: item,
      after: updatedItem,
      actorUserId: req.user.id,
      requestId: req.requestId,
    });
    res.json(updatedItem);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// DELETE /api/stock/:id  (soft delete)
router.delete('/:id', authorize('admin'), (req, res) => {
  try {
    const { id } = req.params;
    const item = db.prepare('SELECT id FROM stock_items WHERE id = ? AND business_id = ?').get(id, req.businessId);
    if (!item) return res.status(404).json({ error: 'Stok kalemi bulunamadı' });
    const deletedItem = db.prepare('SELECT * FROM stock_items WHERE id = ?').get(id);
    db.prepare(`UPDATE stock_items SET is_active = 0, updated_at = datetime('now') WHERE id = ?`).run(id);
    recordEntityMutation({
      businessId: req.businessId,
      entityTable: 'stock_items',
      entityId: id,
      action: 'delete',
      before: deletedItem,
      actorUserId: req.user.id,
      requestId: req.requestId,
    });
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/stock/:id/movements
router.get('/:id/movements', authorize('admin', 'cashier'), (req, res) => {
  try {
    const { id } = req.params;
    const rows = db.prepare(`
      SELECT m.*, u.full_name as user_name
      FROM stock_movements m LEFT JOIN users u ON m.created_by = u.id
      WHERE m.stock_item_id = ? AND m.business_id = ?
      ORDER BY m.created_at DESC LIMIT 100
    `).all(id, req.businessId);
    res.json(rows);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/stock/movements
router.post('/movements', authorize('admin', 'cashier'), validate({ body: movementSchema }), (req, res) => {
  try {
    const { stock_item_id, movement_type, quantity, notes } = req.body;
    const item = db.prepare('SELECT * FROM stock_items WHERE id = ? AND business_id = ?').get(stock_item_id, req.businessId);
    if (!item) return res.status(404).json({ error: 'Stok kalemi bulunamadı' });

    const delta = (movement_type === 'out' || movement_type === 'waste') ? -quantity : quantity;

    let movementId;
    db.transaction(() => {
      movementId = genId();
      db.prepare(`
        INSERT INTO stock_movements (id, business_id, stock_item_id, movement_type, quantity, notes, created_by)
        VALUES (?, ?, ?, ?, ?, ?, ?)
      `).run(movementId, req.businessId, stock_item_id, movement_type, quantity, notes || null, req.user.id);

      db.prepare(`UPDATE stock_items SET quantity = quantity + ?, updated_at = datetime('now') WHERE id = ?`).run(delta, stock_item_id);
    })();

    recordEntityMutation({
      businessId: req.businessId,
      entityTable: 'stock_movements',
      entityId: movementId,
      action: 'create',
      after: { stock_item_id, movement_type, quantity, delta, notes: notes || null },
      actorUserId: req.user.id,
      requestId: req.requestId,
    });
    res.status(201).json(db.prepare('SELECT * FROM stock_items WHERE id = ?').get(stock_item_id));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

export default router;
