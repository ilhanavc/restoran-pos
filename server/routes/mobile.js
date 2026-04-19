import { Router } from 'express';
import { z } from 'zod';
import db from '../config/database.js';
import { requireMobile } from '../middleware/requireMobile.js';
import { validate } from '../middleware/validate.js';
import { addItemsToOrder } from '../services/orderService.js';
import { emitToRoom } from '../socket.js';
import { genId } from '../utils/helpers.js';

const router = Router();
router.use(requireMobile);

// ---------------------------------------------------------------------------
// GET /api/mobile/tables
// Flat masa listesi — alan adı, durum, aktif sipariş özeti dahil.
// ---------------------------------------------------------------------------
router.get('/tables', (req, res) => {
  try {
    const rows = db.prepare(`
      SELECT
        t.id, t.name, t.status, t.capacity, t.sort_order,
        da.name AS area_name,
        t.current_order_id,
        CASE WHEN t.current_order_id IS NOT NULL
          THEN (SELECT grand_total FROM orders WHERE id = t.current_order_id)
          ELSE NULL END AS order_total,
        CASE WHEN t.current_order_id IS NOT NULL
          THEN (SELECT COUNT(*) FROM order_items oi
                WHERE oi.order_id = t.current_order_id AND oi.status != 'cancelled')
          ELSE NULL END AS order_item_count
      FROM tables t
      LEFT JOIN dining_areas da ON t.dining_area_id = da.id
      WHERE t.business_id = ? AND t.is_active = 1
      ORDER BY da.sort_order, t.sort_order
    `).all(req.businessId);

    const tables = rows.map((t) => ({
      id: t.id,
      name: t.name,
      area_name: t.area_name,
      status: t.status,
      capacity: t.capacity,
      active_order: t.current_order_id
        ? { id: t.current_order_id, item_count: t.order_item_count ?? 0, total: t.order_total ?? 0 }
        : null,
    }));

    res.json(tables);
  } catch (err) {
    console.error('[mobile] GET /tables:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/mobile/tables/:tableId/order
// Masanın aktif siparişi (open|draft) + kalemleri.
// ---------------------------------------------------------------------------
router.get('/tables/:tableId/order', (req, res) => {
  try {
    const order = db.prepare(`
      SELECT o.id, o.status, o.grand_total, o.note, o.created_at
      FROM orders o
      JOIN tables t ON t.current_order_id = o.id
      WHERE t.id = ? AND t.business_id = ? AND o.status IN ('new', 'saved')
    `).get(req.params.tableId, req.businessId);

    if (!order) return res.status(404).json({ error: 'Bu masada aktif sipariş yok' });

    const items = db.prepare(`
      SELECT oi.id, oi.product_id, oi.product_name,
             oi.quantity, oi.unit_price, oi.status, oi.note
      FROM order_items oi
      WHERE oi.order_id = ? AND oi.status != 'cancelled'
      ORDER BY oi.created_at
    `).all(order.id);

    res.json({ order: { ...order, items } });
  } catch (err) {
    console.error('[mobile] GET /tables/:tableId/order:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/mobile/orders/:orderId/items
// Mevcut açık siparişe tek kalem ekle.
// ---------------------------------------------------------------------------
const addItemSchema = {
  body: z.object({
    product_id: z.string().min(1),
    quantity: z.number().int().positive().max(99).default(1),
    note: z.string().max(500).optional().nullable(),
    portion_id: z.string().optional().nullable(),
  }),
};

router.post('/orders/:orderId/items', validate(addItemSchema), (req, res) => {
  try {
    const order = db
      .prepare('SELECT id, status FROM orders WHERE id = ? AND business_id = ?')
      .get(req.params.orderId, req.businessId);

    if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });
    if (!['new', 'saved'].includes(order.status)) {
      return res.status(409).json({ error: 'Bu sipariş artık düzenlenemez' });
    }

    const { product_id, quantity, note, portion_id } = req.body;
    const result = addItemsToOrder(req.businessId, req.params.orderId, req.user.id, [
      { product_id, quantity, note: note ?? null, portion_id: portion_id ?? null },
    ]);

    emitToRoom(req.businessId, 'order:updated', { orderId: req.params.orderId });
    res.status(201).json(result);
  } catch (err) {
    console.error('[mobile] POST /orders/:orderId/items:', err);
    res.status(500).json({ error: err.message || 'Sunucu hatası' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/mobile/categories
// Aktif kategoriler + her kategorinin aktif ürünleri (mobil optimize payload).
// ---------------------------------------------------------------------------
router.get('/categories', (req, res) => {
  try {
    const categories = db.prepare(`
      SELECT id, name, color, icon, sort_order
      FROM categories
      WHERE business_id = ? AND is_active = 1
      ORDER BY sort_order, name
    `).all(req.businessId);

    const products = db.prepare(`
      SELECT id, category_id, name, price, price_cents, image_url, description
      FROM products
      WHERE business_id = ? AND is_active = 1 AND is_deleted = 0
      ORDER BY sort_order, name
    `).all(req.businessId);

    const byCategory = {};
    for (const p of products) {
      if (!byCategory[p.category_id]) byCategory[p.category_id] = [];
      byCategory[p.category_id].push(p);
    }

    res.json(categories.map((c) => ({ ...c, products: byCategory[c.id] ?? [] })));
  } catch (err) {
    console.error('[mobile] GET /categories:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// ---------------------------------------------------------------------------
// POST /api/mobile/waiter-call
// Garson çağrısı socket olayı yayınlar.
// ---------------------------------------------------------------------------
const waiterCallSchema = {
  body: z.object({
    table_id: z.string().min(1),
  }),
};

router.post('/waiter-call', validate(waiterCallSchema), (req, res) => {
  try {
    const table = db
      .prepare('SELECT id, name FROM tables WHERE id = ? AND business_id = ?')
      .get(req.body.table_id, req.businessId);

    if (!table) return res.status(404).json({ error: 'Masa bulunamadı' });

    emitToRoom(req.businessId, 'waiter:call', {
      tableId: table.id,
      tableName: table.name,
      requestedBy: req.user.full_name,
      requestedAt: new Date().toISOString(),
    });

    res.json({ success: true });
  } catch (err) {
    console.error('[mobile] POST /waiter-call:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// ---------------------------------------------------------------------------
// GET /api/mobile/me
// Oturum açan kullanıcının özet bilgisi.
// ---------------------------------------------------------------------------
router.get('/me', (req, res) => {
  res.json({
    id: req.user.id,
    full_name: req.user.full_name,
    email: req.user.email,
    role: req.user.role_slug,
    business_id: req.user.business_id,
  });
});

// ---------------------------------------------------------------------------
// POST /api/mobile/devices/register
// Eşleştirme token'ı ile cihazı sisteme kaydet.
// ---------------------------------------------------------------------------
const registerDeviceSchema = {
  body: z.object({
    pairing_token: z.string().min(1),
    device_name: z.string().min(1).max(100),
    platform: z.enum(['android', 'ios', 'unknown']).default('unknown'),
  }),
};

router.post('/devices/register', validate(registerDeviceSchema), (req, res) => {
  try {
    const { pairing_token, device_name, platform } = req.body;

    const pairingRow = db
      .prepare(`SELECT * FROM device_pairing_tokens WHERE token = ? AND business_id = ?`)
      .get(pairing_token, req.businessId);

    if (!pairingRow) return res.status(400).json({ error: 'Geçersiz eşleştirme kodu' });

    if (new Date(pairingRow.expires_at) < new Date()) {
      db.prepare('DELETE FROM device_pairing_tokens WHERE id = ?').run(pairingRow.id);
      return res.status(400).json({ error: 'Eşleştirme kodunun süresi dolmuş' });
    }

    const deviceId = genId();
    db.transaction(() => {
      db.prepare(`
        INSERT INTO devices (id, user_id, business_id, device_name, platform)
        VALUES (?, ?, ?, ?, ?)
      `).run(deviceId, req.user.id, req.businessId, device_name, platform);
      db.prepare('DELETE FROM device_pairing_tokens WHERE id = ?').run(pairingRow.id);
    })();

    const device = db.prepare('SELECT * FROM devices WHERE id = ?').get(deviceId);
    res.status(201).json(device);
  } catch (err) {
    console.error('[mobile] POST /devices/register:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

export default router;
