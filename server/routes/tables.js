import { Router } from 'express';
import db from '../config/database.js';
import { authenticate, businessScope, authorize } from '../middleware/auth.js';
import { auditLog } from '../utils/helpers.js';
import { emitToRoom } from '../socket.js';

const router = Router();
router.use(authenticate, businessScope);

const tableStaff = authorize('admin', 'cashier', 'waiter');

// GET /api/tables - list all tables with areas
router.get('/', tableStaff, (req, res) => {
  try {
    const areas = db.prepare(`
      SELECT * FROM dining_areas WHERE business_id = ? AND is_active = 1 ORDER BY sort_order
    `).all(req.businessId);

    const tables = db.prepare(`
      SELECT t.*, 
        CASE WHEN t.current_order_id IS NOT NULL 
          THEN (SELECT grand_total FROM orders WHERE id = t.current_order_id) 
          ELSE 0 END as order_total,
        CASE WHEN t.current_order_id IS NOT NULL
          THEN (SELECT COALESCE(SUM(amount), 0) FROM payments WHERE order_id = t.current_order_id)
          ELSE 0 END as order_paid_total,
        CASE WHEN t.current_order_id IS NOT NULL 
          THEN (SELECT created_at FROM orders WHERE id = t.current_order_id) 
          ELSE NULL END as order_started_at,
        (SELECT u.full_name FROM orders o 
          LEFT JOIN users u ON o.user_id = u.id 
          WHERE o.id = t.current_order_id) as waiter_name,
        CASE WHEN t.current_order_id IS NOT NULL THEN
          (SELECT COUNT(*) FROM order_items oi 
            WHERE oi.order_id = t.current_order_id AND oi.status != 'cancelled')
        ELSE 0 END as order_line_count,
        CASE WHEN t.current_order_id IS NOT NULL AND EXISTS (
          SELECT 1 FROM order_items oi 
          WHERE oi.order_id = t.current_order_id AND oi.status = 'ready'
        ) THEN 1 ELSE 0 END as has_ready_items
      FROM tables t 
      WHERE t.business_id = ? AND t.is_active = 1 
      ORDER BY t.sort_order
    `).all(req.businessId);

    const result = areas.map(area => ({
      ...area,
      tables: tables.filter(t => t.dining_area_id === area.id),
    }));

    res.json(result);
  } catch (err) {
    console.error('Tables error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// PATCH /api/tables/:id/status
router.patch('/:id/status', tableStaff, (req, res) => {
  try {
    const { status, guest_count, note } = req.body;
    const table = db.prepare('SELECT * FROM tables WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!table) return res.status(404).json({ error: 'Masa bulunamadı' });

    const updates = [];
    const params = [];
    if (status) { updates.push('status = ?'); params.push(status); }
    if (guest_count !== undefined) { updates.push('guest_count = ?'); params.push(guest_count); }
    if (note !== undefined) { updates.push('note = ?'); params.push(note); }
    updates.push("updated_at = datetime('now')");
    params.push(req.params.id, req.businessId);

    db.prepare(`UPDATE tables SET ${updates.join(', ')} WHERE id = ? AND business_id = ?`).run(...params);
    auditLog(req.businessId, req.user.id, 'table_status_change', 'table', req.params.id, { status });

    const updated = db.prepare('SELECT * FROM tables WHERE id = ?').get(req.params.id);
    emitToRoom(req.businessId, 'table:updated', { table: updated });
    res.json(updated);
  } catch (err) {
    console.error('Table update error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/tables/:id/transfer
router.post('/:id/transfer', tableStaff, (req, res) => {
  try {
    const { targetTableId } = req.body;
    if (!targetTableId) {
      return res.status(400).json({ error: 'Hedef masa (targetTableId) gerekli' });
    }
    if (targetTableId === req.params.id) {
      return res.status(400).json({ error: 'Kaynak ve hedef masa aynı olamaz' });
    }
    const source = db.prepare('SELECT * FROM tables WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    const target = db.prepare('SELECT * FROM tables WHERE id = ? AND business_id = ?').get(targetTableId, req.businessId);
    
    if (!source || !target) return res.status(404).json({ error: 'Masa bulunamadı' });
    if (target.status === 'occupied') return res.status(400).json({ error: 'Hedef masa dolu' });

    const txn = db.transaction(() => {
      if (source.current_order_id) {
        db.prepare('UPDATE orders SET table_id = ? WHERE id = ?').run(targetTableId, source.current_order_id);
      }
      db.prepare("UPDATE tables SET status = ?, current_order_id = ?, guest_count = ?, updated_at = datetime('now') WHERE id = ?")
        .run(source.status, source.current_order_id, source.guest_count, targetTableId);
      db.prepare(`UPDATE tables SET status = 'empty', current_order_id = NULL, guest_count = 0, updated_at = datetime('now') WHERE id = ?`)
        .run(req.params.id);
    });
    txn();

    auditLog(req.businessId, req.user.id, 'table_transfer', 'table', req.params.id, { targetTableId });
    emitToRoom(req.businessId, 'table:transferred', { sourceTableId: req.params.id, targetTableId });
    res.json({ success: true });
  } catch (err) {
    console.error('Table transfer error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

export default router;
