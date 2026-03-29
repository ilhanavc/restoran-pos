import { Router } from 'express';
import db from '../config/database.js';
import { bridgeAuth } from '../middleware/bridgeAuth.js';
import { processIncomingCall } from '../services/callerIdService.js';

const router = Router();
router.use(bridgeAuth);

function parsePayload(raw) {
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

function mapJobRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    business_id: row.business_id,
    order_id: row.order_id,
    printer_id: row.printer_id,
    job_type: row.job_type,
    payload: parsePayload(row.payload),
    status: row.status,
    error_message: row.error_message,
    idempotency_key: row.idempotency_key,
    created_at: row.created_at,
    printed_at: row.printed_at,
    claimed_at: row.claimed_at || null,
    claimed_by: row.claimed_by || null,
  };
}

function mapPrinterRow(row) {
  if (!row) return null;
  let print_options = {};
  if (row.print_options) {
    try {
      print_options = JSON.parse(row.print_options);
    } catch {
      print_options = {};
    }
  }
  return {
    id: row.id,
    business_id: row.business_id,
    name: row.name,
    type: row.type,
    connection_type: row.connection_type || 'network',
    ip_address: row.ip_address,
    port: row.port ?? 9100,
    is_active: row.is_active === 1 || row.is_active === true,
    print_options,
  };
}

/** GET /api/bridge/health — token doğrulama */
router.get('/health', (req, res) => {
  res.json({ ok: true, business_id: req.businessId, time: new Date().toISOString() });
});

/**
 * POST /api/bridge/caller-id/incoming
 * StoreBridge / CID donanımı — JWT yok, bridgeAuth. processIncomingCall ile call_logs.
 * Body: phone (zorunlu), raw_payload (opsiyonel), source_type (örn. cid812, hardware)
 */
router.post('/caller-id/incoming', (req, res) => {
  try {
    const body = req.body || {};
    const phone = body.phone;
    const rawPayload = body.raw_payload != null ? body.raw_payload : body.rawPayload;
    const sourceType = body.source_type || body.sourceType || 'hardware';

    if (phone == null || String(phone).trim() === '') {
      return res.status(400).json({ error: 'phone gerekli' });
    }

    const result = processIncomingCall({
      businessId: req.businessId,
      userId: null,
      rawPhone: phone,
      sourceType,
      rawPayload: rawPayload ?? null,
    });

    res.json(result);
  } catch (err) {
    if (err.isBadRequest) return res.status(400).json({ error: err.message });
    console.error('[bridge] caller-id/incoming', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

/**
 * GET /api/bridge/print-jobs?status=pending&limit=20&unclaimed_only=1
 */
router.get('/print-jobs', (req, res) => {
  try {
    const status = (req.query.status || 'pending').toLowerCase();
    if (!['pending', 'printed', 'failed', 'cancelled'].includes(status)) {
      return res.status(400).json({ error: 'Geçersiz status' });
    }
    const limit = Math.min(Math.max(parseInt(req.query.limit || '50', 10) || 50, 1), 200);
    const unclaimedOnly = req.query.unclaimed_only === '1' || req.query.unclaimed_only === 'true';

    let sql = `SELECT * FROM print_jobs WHERE business_id = ? AND status = ?`;
    const params = [req.businessId, status];
    if (unclaimedOnly && status === 'pending') {
      sql += ` AND claimed_at IS NULL`;
    }
    sql += ` ORDER BY datetime(created_at) ASC LIMIT ?`;
    params.push(limit);

    const rows = db.prepare(sql).all(...params);
    res.json({ jobs: rows.map(mapJobRow) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

/**
 * POST /api/bridge/print-jobs/:id/claim
 * Atomik: yalnızca pending ve claimed_at boşsa claim eder.
 */
router.post('/print-jobs/:id/claim', (req, res) => {
  try {
    const claimId = String(req.body?.claim_id || 'store-bridge').slice(0, 128);
    const info = db
      .prepare(
        `UPDATE print_jobs SET claimed_at = datetime('now'), claimed_by = ?
         WHERE id = ? AND business_id = ? AND status = 'pending' AND claimed_at IS NULL`,
      )
      .run(claimId, req.params.id, req.businessId);

    if (info.changes === 0) {
      const row = db.prepare(`SELECT * FROM print_jobs WHERE id = ? AND business_id = ?`).get(req.params.id, req.businessId);
      if (!row) return res.status(404).json({ error: 'İş bulunamadı' });
      return res.status(409).json({ error: 'claim_failed', reason: 'not_pending_or_already_claimed', job: mapJobRow(row) });
    }

    const row = db.prepare(`SELECT * FROM print_jobs WHERE id = ?`).get(req.params.id);
    res.json({ job: mapJobRow(row) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

/**
 * PATCH /api/bridge/print-jobs/:id
 * body: { status: 'printed' | 'failed', error_message?: string }
 */
router.patch('/print-jobs/:id', (req, res) => {
  try {
    const { status, error_message: errMsg } = req.body || {};
    if (status !== 'printed' && status !== 'failed') {
      return res.status(400).json({ error: 'status: printed veya failed olmalı' });
    }

    const existing = db.prepare(`SELECT * FROM print_jobs WHERE id = ? AND business_id = ?`).get(req.params.id, req.businessId);
    if (!existing) return res.status(404).json({ error: 'İş bulunamadı' });

    if (status === 'printed') {
      db.prepare(
        `UPDATE print_jobs SET status = 'printed', printed_at = datetime('now'), error_message = NULL WHERE id = ? AND business_id = ?`,
      ).run(req.params.id, req.businessId);
    } else {
      const em = errMsg != null && String(errMsg).trim() ? String(errMsg).trim() : 'Yazdırma başarısız';
      db.prepare(`UPDATE print_jobs SET status = 'failed', error_message = ? WHERE id = ? AND business_id = ?`).run(
        em,
        req.params.id,
        req.businessId,
      );
    }

    const row = db.prepare(`SELECT * FROM print_jobs WHERE id = ?`).get(req.params.id);
    res.json({ job: mapJobRow(row) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

/** GET /api/bridge/printers/:id */
router.get('/printers/:id', (req, res) => {
  try {
    const row = db
      .prepare(`SELECT * FROM printers WHERE id = ? AND business_id = ?`)
      .get(req.params.id, req.businessId);
    if (!row) return res.status(404).json({ error: 'Yazıcı bulunamadı' });
    res.json({ printer: mapPrinterRow(row) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

export default router;
