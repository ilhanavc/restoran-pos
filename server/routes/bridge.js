import { Router } from 'express';
import db from '../config/database.js';
import { bridgeAuth } from '../middleware/bridgeAuth.js';
import { processIncomingCall } from '../services/callerIdService.js';

const router = Router();
router.use(bridgeAuth);
const DISCOVERY_CACHE_KEY = 'bridge.discovered_printers';
const DISCOVERY_REFRESH_REQUEST_KEY = 'bridge.discovery_refresh_request';
const DISCOVERY_STATES = new Set([
  'never_scanned',
  'scanning',
  'success',
  'empty',
  'bridge_unreachable',
  'auth_error',
]);
const PRINT_JOB_LEASE_SECONDS = 90;
const PRINT_JOB_ERROR_CODES = new Set([
  'printer_missing',
  'printer_inactive',
  'network_timeout',
  'usb_print_failed',
  'unsupported_connection',
  'printer_config_missing',
  'render_failed',
  'api_error',
  'unknown_error',
]);

function parsePayload(raw) {
  if (!raw) return null;
  try {
    return typeof raw === 'string' ? JSON.parse(raw) : raw;
  } catch {
    return null;
  }
}

function normalizeBridgePrintOptions(raw, printerType) {
  let printOptions = {};
  if (raw) {
    try {
      printOptions = typeof raw === 'string' ? JSON.parse(raw) : raw;
    } catch {
      printOptions = {};
    }
  }
  if (!printOptions || typeof printOptions !== 'object') printOptions = {};

  const normalized = {
    ...printOptions,
    template:
      printOptions.template && typeof printOptions.template === 'object'
        ? { ...printOptions.template, enabled: false }
        : { enabled: false },
  };

  normalized.encodingMode = normalized.encodingMode === 'pc857' ? 'pc857' : 'win1254';

  if (printerType === 'receipt' || normalized.encodingMode === 'win1254') {
    normalized.encodingMode = 'win1254';
    normalized.escT = 32;
    normalized.skipPhoenixCmd = true;
  }

  return normalized;
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
    claimed_until: row.claimed_until || null,
    attempt_count: Number(row.attempt_count) || 0,
    last_attempt_at: row.last_attempt_at || null,
    last_error_code: row.last_error_code || null,
  };
}

function mapPrinterRow(row) {
  if (!row) return null;
  const type = row.type || 'receipt';
  const print_options = normalizeBridgePrintOptions(row.print_options, type);
  return {
    id: row.id,
    business_id: row.business_id,
    name: row.name,
    type,
    connection_type: row.connection_type || 'network',
    ip_address: row.ip_address,
    port: row.port ?? 9100,
    is_active: row.is_active === 1 || row.is_active === true,
    // USB yazıcı için Windows yazıcı adı — PrinterDetailPage'de fiziksel yazıcı seçiminden gelir
    printer_name: String(print_options?.device?.physicalName || '').trim() || null,
    print_options,
  };
}

function sanitizeDiscoveredPrinters(rawList) {
  if (!Array.isArray(rawList)) return [];
  return rawList
    .map((p) => {
      const name = String(p?.name || '').trim();
      if (!name) return null;
      const connectionType = String(p?.connectionType || '').trim() || 'network';
      const ipAddress = String(p?.ipAddress || '').trim();
      const portName = String(p?.portName || '').trim();
      return {
        name,
        isDefault: p?.isDefault === true,
        isOnline: p?.isOnline !== false,
        connectionType,
        ipAddress,
        portName,
        source: 'windows',
      };
    })
    .filter(Boolean);
}

function upsertSettingByBusiness(businessId, key, valueObj) {
  const serialized = JSON.stringify(valueObj);
  const existing = db.prepare('SELECT id FROM settings WHERE business_id = ? AND key = ?').get(businessId, key);
  if (existing) {
    db.prepare(`UPDATE settings SET value = ?, updated_at = datetime('now') WHERE business_id = ? AND key = ?`).run(
      serialized,
      businessId,
      key,
    );
    return;
  }
  db.prepare(`INSERT INTO settings (id, business_id, key, value, updated_at) VALUES (hex(randomblob(16)), ?, ?, ?, datetime('now'))`).run(
    businessId,
    key,
    serialized,
  );
}

function getJsonSettingByBusiness(businessId, key, fallback = null) {
  const row = db.prepare('SELECT value FROM settings WHERE business_id = ? AND key = ?').get(businessId, key);
  if (!row?.value) return fallback;
  try {
    return JSON.parse(row.value);
  } catch {
    return fallback;
  }
}

function summarizePrintQueue(businessId) {
  const rows = db
    .prepare(`SELECT status, COUNT(*) AS count FROM print_jobs WHERE business_id = ? GROUP BY status`)
    .all(businessId);
  const summary = { pending: 0, printed: 0, failed: 0, cancelled: 0 };
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(summary, row.status)) {
      summary[row.status] = Number(row.count) || 0;
    }
  }
  const staleClaimed =
    db
      .prepare(
        `SELECT COUNT(*) AS c
         FROM print_jobs
         WHERE business_id = ?
           AND status = 'pending'
           AND claimed_until IS NOT NULL
           AND datetime(claimed_until) <= datetime('now')`,
      )
      .get(businessId)?.c || 0;
  return { ...summary, stale_claimed: Number(staleClaimed) || 0 };
}

function getLatestJobTimestamps(businessId) {
  const latestJob = db
    .prepare(
      `SELECT created_at, printed_at, last_attempt_at, last_error_code
       FROM print_jobs
       WHERE business_id = ?
       ORDER BY datetime(COALESCE(last_attempt_at, printed_at, created_at)) DESC
       LIMIT 1`,
    )
    .get(businessId);
  return {
    lastJobAt: latestJob?.created_at || null,
    lastAttemptAt: latestJob?.last_attempt_at || null,
    lastErrorCode: latestJob?.last_error_code || null,
  };
}

/** GET /api/bridge/health — token doğrulama */
router.get('/health', (req, res) => {
  const discovery = getJsonSettingByBusiness(req.businessId, DISCOVERY_CACHE_KEY, null);
  const refreshRequest = getJsonSettingByBusiness(req.businessId, DISCOVERY_REFRESH_REQUEST_KEY, null);
  const printers = sanitizeDiscoveredPrinters(discovery?.printers);
  const scanState = DISCOVERY_STATES.has(discovery?.scanState)
    ? discovery.scanState
    : printers.length > 0
      ? 'success'
      : 'never_scanned';
  const queueSummary = summarizePrintQueue(req.businessId);
  const latest = getLatestJobTimestamps(req.businessId);
  res.json({
    ok: true,
    business_id: req.businessId,
    time: new Date().toISOString(),
    discovery: {
      available: printers.length > 0,
      printers,
      scanState,
      lastErrorCode: discovery?.lastErrorCode || null,
      updatedAt: discovery?.updatedAt || null,
      source: 'storebridge',
    },
    refreshRequest: refreshRequest || null,
    queueSummary,
    ...latest,
  });
});

/**
 * Bridge agent discovered printer cache:
 * - POST: bridge bilgisayardaki yazıcı listesini gönderir
 * - GET: admin UI için son bilinen listeyi döner
 */
router.post('/printers/discovered', (req, res) => {
  try {
    const printers = sanitizeDiscoveredPrinters(req.body?.printers);
    const requestedState = String(req.body?.scanState || '').trim();
    const scanState = DISCOVERY_STATES.has(requestedState)
      ? requestedState
      : printers.length > 0
        ? 'success'
        : 'empty';
    const payload = {
      available: printers.length > 0,
      printers,
      scanState,
      lastErrorCode: req.body?.lastErrorCode ? String(req.body.lastErrorCode) : null,
      updatedAt: new Date().toISOString(),
      source: 'storebridge',
    };
    upsertSettingByBusiness(req.businessId, DISCOVERY_CACHE_KEY, payload);
    if (req.body?.requestId) {
      const currentReq = getJsonSettingByBusiness(req.businessId, DISCOVERY_REFRESH_REQUEST_KEY, {});
      if (currentReq?.requestId && currentReq.requestId === req.body.requestId) {
        upsertSettingByBusiness(req.businessId, DISCOVERY_REFRESH_REQUEST_KEY, {
          ...currentReq,
          status: 'completed',
          completedAt: new Date().toISOString(),
        });
      }
    }
    res.json({ ok: true, printers: payload.printers, updatedAt: payload.updatedAt });
  } catch (err) {
    console.error('[bridge] printers/discovered POST', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.get('/printers/discovered', (req, res) => {
  try {
    const parsed = getJsonSettingByBusiness(req.businessId, DISCOVERY_CACHE_KEY, null);
    if (!parsed) {
      return res.json({
        available: false,
        printers: [],
        scanState: 'never_scanned',
        lastErrorCode: null,
        updatedAt: null,
        source: 'storebridge',
        message: 'Henüz yazıcı taraması alınmadı',
      });
    }
    const printers = sanitizeDiscoveredPrinters(parsed.printers);
    const scanState = DISCOVERY_STATES.has(parsed.scanState)
      ? parsed.scanState
      : printers.length > 0
        ? 'success'
        : 'empty';
    res.json({
      available: printers.length > 0,
      printers,
      scanState,
      lastErrorCode: parsed.lastErrorCode || null,
      updatedAt: parsed.updatedAt || null,
      source: 'storebridge',
      message: printers.length ? null : 'Aktif yazıcı bulunamadı',
    });
  } catch (err) {
    console.error('[bridge] printers/discovered GET', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.post('/printers/discovered/refresh', (req, res) => {
  try {
    const requestId = `scan_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const requestedAt = new Date().toISOString();
    upsertSettingByBusiness(req.businessId, DISCOVERY_REFRESH_REQUEST_KEY, {
      requestId,
      requestedAt,
      status: 'requested',
      source: 'admin',
    });
    const currentCache = getJsonSettingByBusiness(req.businessId, DISCOVERY_CACHE_KEY, {});
    upsertSettingByBusiness(req.businessId, DISCOVERY_CACHE_KEY, {
      ...currentCache,
      scanState: 'scanning',
      available: false,
      updatedAt: currentCache?.updatedAt || null,
      source: 'storebridge',
      lastErrorCode: null,
    });
    res.json({
      ok: true,
      requestId,
      scanState: 'scanning',
      requestedAt,
      request: {
        requestId,
        requestedAt,
        status: 'requested',
        source: 'admin',
      },
    });
  } catch (err) {
    console.error('[bridge] printers/discovered/refresh POST', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.get('/printers/discovered/refresh-request', (req, res) => {
  try {
    const reqState = getJsonSettingByBusiness(req.businessId, DISCOVERY_REFRESH_REQUEST_KEY, null);
    res.json({
      request: reqState || null,
      hasPending: !!reqState && reqState.status === 'requested',
    });
  } catch (err) {
    console.error('[bridge] printers/discovered/refresh-request GET', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
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
      sql += ` AND (claimed_until IS NULL OR datetime(claimed_until) <= datetime('now'))`;
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
 * Atomik: yalnızca pending ve claim lease boş/süresi geçmişse claim eder.
 */
router.post('/print-jobs/:id/claim', (req, res) => {
  try {
    const claimId = String(req.body?.claim_id || 'store-bridge').slice(0, 128);
    const leaseSecondsRaw = parseInt(req.body?.lease_seconds || PRINT_JOB_LEASE_SECONDS, 10);
    const leaseSeconds = Math.min(Math.max(Number.isFinite(leaseSecondsRaw) ? leaseSecondsRaw : PRINT_JOB_LEASE_SECONDS, 30), 600);
    const info = db
      .prepare(
        `UPDATE print_jobs
         SET claimed_at = datetime('now'),
             claimed_by = ?,
             claimed_until = datetime('now', '+' || ? || ' seconds'),
             attempt_count = COALESCE(attempt_count, 0) + 1,
             last_attempt_at = datetime('now'),
             error_message = NULL,
             last_error_code = NULL
         WHERE id = ?
           AND business_id = ?
           AND status = 'pending'
           AND (claimed_until IS NULL OR datetime(claimed_until) <= datetime('now'))`,
      )
      .run(claimId, leaseSeconds, req.params.id, req.businessId);

    if (info.changes === 0) {
      const row = db.prepare(`SELECT * FROM print_jobs WHERE id = ? AND business_id = ?`).get(req.params.id, req.businessId);
      if (!row) return res.status(404).json({ error: 'İş bulunamadı' });
      return res.status(409).json({ error: 'claim_failed', reason: 'not_pending_or_lease_active', job: mapJobRow(row) });
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
    const claimId = req.body?.claim_id != null ? String(req.body.claim_id).slice(0, 128) : null;
    const rawErrorCode = req.body?.error_code != null ? String(req.body.error_code).trim() : '';
    const errorCode = PRINT_JOB_ERROR_CODES.has(rawErrorCode) ? rawErrorCode : rawErrorCode ? 'unknown_error' : null;
    if (status !== 'printed' && status !== 'failed') {
      return res.status(400).json({ error: 'status: printed veya failed olmalı' });
    }

    const existing = db.prepare(`SELECT * FROM print_jobs WHERE id = ? AND business_id = ?`).get(req.params.id, req.businessId);
    if (!existing) return res.status(404).json({ error: 'İş bulunamadı' });
    if (existing.status !== 'pending') {
      return res.status(409).json({ error: 'invalid_job_state', reason: 'job_not_pending', job: mapJobRow(existing) });
    }
    if (claimId && existing.claimed_by && existing.claimed_by !== claimId) {
      return res.status(409).json({ error: 'claim_mismatch', reason: 'claimed_by_another_bridge', job: mapJobRow(existing) });
    }
    const claimedUntilMs = existing.claimed_until
      ? new Date(`${String(existing.claimed_until).replace(' ', 'T')}Z`).getTime()
      : NaN;
    if (Number.isFinite(claimedUntilMs) && claimedUntilMs <= Date.now()) {
      return res.status(409).json({ error: 'claim_expired', reason: 'lease_expired', job: mapJobRow(existing) });
    }

    if (status === 'printed') {
      db.prepare(
        `UPDATE print_jobs
         SET status = 'printed',
             printed_at = datetime('now'),
             error_message = NULL,
             last_error_code = NULL,
             claimed_until = NULL
         WHERE id = ? AND business_id = ?`,
      ).run(req.params.id, req.businessId);
    } else {
      const em = errMsg != null && String(errMsg).trim() ? String(errMsg).trim() : 'Yazdırma başarısız';
      db.prepare(
        `UPDATE print_jobs
         SET status = 'failed',
             error_message = ?,
             last_error_code = ?,
             claimed_until = NULL
         WHERE id = ? AND business_id = ?`,
      ).run(
        em,
        errorCode,
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
