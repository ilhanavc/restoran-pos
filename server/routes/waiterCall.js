/**
 * Garson çağırma modülü.
 *
 * Public endpoint (auth yok): masadaki QR kodu tarandığında çağrı oluşturur.
 * Authenticated endpoints: bekleyen çağrıları listele, çözümle, QR setup bilgisi al.
 *
 * Güvenlik: token = settings tablosundaki 'waiter_call_token' (UUID).
 * Rate limit: index.js'de waiterCallLimiter (60 req/dk/IP).
 */
import { Router } from 'express';
import { z } from 'zod';
import db from '../config/database.js';
import { authenticate, businessScope, authorize } from '../middleware/auth.js';
import { genId } from '../utils/helpers.js';
import { emitToRoom } from '../socket.js';

const router = Router();

// ── Token yardımcıları ────────────────────────────────────────────────────────

/** İşletme için waiter_call_token döner; yoksa üretir ve kaydeder. */
function getOrCreateToken(businessId) {
  const row = db
    .prepare(`SELECT value FROM settings WHERE business_id = ? AND key = 'waiter_call_token'`)
    .get(businessId);
  if (row?.value) return row.value;

  const token = genId(); // UUID
  db.prepare(
    `INSERT OR IGNORE INTO settings (id, business_id, key, value)
     VALUES (?, ?, 'waiter_call_token', ?)`,
  ).run(genId(), businessId, token);
  return token;
}

/** Verilen businessId+token çiftini doğrular. */
function verifyToken(businessId, token) {
  if (!businessId || !token) return false;
  const row = db
    .prepare(`SELECT value FROM settings WHERE business_id = ? AND key = 'waiter_call_token'`)
    .get(businessId);
  return row?.value === token;
}

// ── Public: QR taranınca çağrı oluştur ────────────────────────────────────────

// GET /api/waiter-call/call?t=TABLE_ID&b=BUSINESS_ID&k=TOKEN
// Telefon tarayıcısı bu URL'yi açtığında HTML sayfa döner.
router.get('/call', (req, res) => {
  const { t: tableId, b: businessId, k: token } = req.query;

  if (!verifyToken(businessId, token)) {
    return res.status(403).send(callPage('Geçersiz QR Kod', 'Bu QR kodu artık geçerli değil.', false));
  }

  const table = db
    .prepare(`SELECT id, name FROM tables WHERE id = ? AND business_id = ? AND is_active = 1`)
    .get(tableId, businessId);

  if (!table) {
    return res.status(404).send(callPage('Masa Bulunamadı', 'Bu masa mevcut değil.', false));
  }

  // Zaten bekleyen bir çağrı varsa tekrar kaydetme
  const existing = db
    .prepare(`SELECT id FROM waiter_calls WHERE business_id = ? AND table_id = ? AND status = 'pending'`)
    .get(businessId, tableId);

  if (!existing) {
    const callId = genId();
    db.prepare(
      `INSERT INTO waiter_calls (id, business_id, table_id, table_name, status, created_at)
       VALUES (?, ?, ?, ?, 'pending', datetime('now'))`,
    ).run(callId, businessId, tableId, table.name);

    emitToRoom(businessId, 'waiter_call', {
      id: callId,
      tableId: table.id,
      tableName: table.name,
      createdAt: new Date().toISOString(),
    });
  }

  res.setHeader('Content-Type', 'text/html; charset=utf-8');
  res.send(callPage(
    `${table.name} — Garson Çağırıldı`,
    'Garsonunuz en kısa sürede gelecektir. Teşekkür ederiz.',
    true,
  ));
});

function callPage(title, message, success) {
  const color = success ? '#22c55e' : '#ef4444';
  const icon = success ? '🔔' : '⚠️';
  return `<!DOCTYPE html><html lang="tr"><head>
  <meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">
  <title>${title}</title>
  <style>
    *{box-sizing:border-box;margin:0;padding:0}
    body{font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;
         background:#f8fafc;display:flex;align-items:center;justify-content:center;min-height:100vh;padding:20px}
    .card{background:#fff;border-radius:16px;padding:40px 32px;text-align:center;
          box-shadow:0 4px 24px rgba(0,0,0,.08);max-width:380px;width:100%}
    .icon{font-size:56px;margin-bottom:16px}
    h1{font-size:22px;font-weight:700;color:#111;margin-bottom:10px}
    p{font-size:15px;color:#555;line-height:1.5}
    .badge{display:inline-block;margin-top:20px;padding:6px 16px;border-radius:999px;
           background:${color}18;color:${color};font-size:13px;font-weight:600}
  </style>
  </head><body>
  <div class="card">
    <div class="icon">${icon}</div>
    <h1>${title}</h1>
    <p>${message}</p>
    <div class="badge">${success ? 'Çağrı İletildi' : 'Hata'}</div>
  </div>
  </body></html>`;
}

// ── Authenticated endpoints ───────────────────────────────────────────────────
router.use(authenticate, businessScope);

// GET /api/waiter-call/setup — QR kurulum bilgisi (token + masalar)
router.get('/setup', authorize('admin', 'cashier', 'waiter'), (req, res) => {
  try {
    const token = getOrCreateToken(req.businessId);
    const tables = db
      .prepare(`SELECT t.id, t.name, a.name as area_name
                FROM tables t JOIN dining_areas a ON t.dining_area_id = a.id
                WHERE t.business_id = ? AND t.is_active = 1
                ORDER BY a.sort_order, t.sort_order`)
      .all(req.businessId);

    res.json({ token, tables });
  } catch (err) {
    console.error('waiter-call setup:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/waiter-call/pending — bekleyen çağrılar
router.get('/pending', authorize('admin', 'cashier', 'waiter'), (req, res) => {
  try {
    const calls = db
      .prepare(
        `SELECT id, table_id, table_name, status, created_at
         FROM waiter_calls
         WHERE business_id = ? AND status = 'pending'
         ORDER BY created_at ASC`,
      )
      .all(req.businessId);
    res.json({ calls });
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// PATCH /api/waiter-call/:id/resolve — çağrıyı çözümle
const resolveSchema = z.object({});
router.patch('/:id/resolve', authorize('admin', 'cashier', 'waiter'), (req, res) => {
  try {
    const { id } = req.params;
    const call = db
      .prepare(`SELECT id, business_id FROM waiter_calls WHERE id = ? AND business_id = ?`)
      .get(id, req.businessId);

    if (!call) return res.status(404).json({ error: 'Çağrı bulunamadı' });

    db.prepare(
      `UPDATE waiter_calls SET status = 'resolved', resolved_at = datetime('now'), resolved_by = ?
       WHERE id = ?`,
    ).run(req.user.id, id);

    emitToRoom(req.businessId, 'waiter_call:resolved', { id });
    res.json({ ok: true });
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

export default router;
