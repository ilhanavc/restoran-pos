/**
 * Caller ID API — kaynak: call_logs. /api/callerid ve /api/caller-id aynı router.
 * Geçmişte kullanılan incoming_calls tablosu yalnızca callerIdService içinde isteğe bağlı legacy yazım.
 */
import { Router } from 'express';
import db from '../config/database.js';
import { authenticate, businessScope } from '../middleware/auth.js';
import {
  processIncomingCall,
  updateCallLogStatus,
  listRecentCallLogs,
} from '../services/callerIdService.js';

const router = Router();
router.use(authenticate, businessScope);

function handleIncoming(req, res, sourceType) {
  try {
    const { phone, sourceType: st, rawPayload } = req.body;
    const src = sourceType || st || 'http';
    if (!phone) return res.status(400).json({ error: 'Telefon numarası gerekli' });

    const result = processIncomingCall({
      businessId: req.businessId,
      userId: req.user.id,
      rawPhone: phone,
      sourceType: src,
      rawPayload,
    });

    res.json(result);
  } catch (err) {
    if (err.isBadRequest) return res.status(400).json({ error: err.message });
    console.error('Caller ID error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
}

// POST /incoming — cihaz / manuel HTTP
router.post('/incoming', (req, res) => handleIncoming(req, res, req.body.sourceType || 'http'));

// POST /simulate — geliştirme
router.post('/simulate', (req, res) => handleIncoming(req, res, 'simulate'));

// GET /history — CallerIdScreen uyumluluğu (call_logs)
router.get('/history', (req, res) => {
  try {
    const calls = db.prepare(`
      SELECT cl.*,
        cl.customer_name_snapshot AS customer_name,
        o.order_no,
        CASE WHEN cl.customer_id IS NOT NULL THEN 1 ELSE 0 END AS matched
      FROM call_logs cl
      LEFT JOIN orders o ON o.id = cl.order_id AND o.business_id = cl.business_id
      WHERE cl.business_id = ?
      ORDER BY cl.created_at DESC LIMIT 50
    `).all(req.businessId);
    res.json(calls);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /recent — global popup polling
router.get('/recent', (req, res) => {
  try {
    const limit = Math.min(Number(req.query.limit) || 40, 100);
    const rows = listRecentCallLogs(req.businessId, limit);
    res.json(rows);
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// PATCH /logs/:id/status
router.patch('/logs/:id/status', (req, res) => {
  try {
    const { status } = req.body;
    if (!status) return res.status(400).json({ error: 'status gerekli' });
    const row = updateCallLogStatus(req.businessId, req.params.id, status);
    if (!row) return res.status(404).json({ error: 'Kayıt bulunamadı' });
    res.json(row);
  } catch (err) {
    if (err.isBadRequest) return res.status(400).json({ error: err.message });
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

export default router;
