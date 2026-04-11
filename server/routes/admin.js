import { Router } from 'express';
import bcryptjs from 'bcryptjs';
import { z } from 'zod';
import { getPrinterPreviewPlainLines } from '../../store-bridge/printers/renderers.js';
import db from '../config/database.js';
import config from '../config/index.js';
import { authenticate, businessScope, authorize } from '../middleware/auth.js';
import { genId, auditLog } from '../utils/helpers.js';
import { ORDER_STATUSES_CLOSED } from '../constants/orderStatus.js';

const router = Router();
router.use(authenticate, businessScope, authorize('admin'));
const DISCOVERY_CACHE_KEY = 'bridge.discovered_printers';

function resolveDiscoveryState(payload, printers) {
  const known = new Set(['never_scanned', 'scanning', 'success', 'empty', 'bridge_unreachable', 'auth_error']);
  if (known.has(payload?.scanState)) return payload.scanState;
  if (!payload) return 'never_scanned';
  return printers.length > 0 ? 'success' : 'empty';
}

function discoveryMessageForState(state) {
  if (state === 'never_scanned') return 'StoreBridge yazıcı taraması henüz alınmadı';
  if (state === 'scanning') return 'Windows yazıcıları taranıyor';
  if (state === 'empty') return 'Aktif yazıcı bulunamadı';
  if (state === 'bridge_unreachable') return 'StoreBridge servisine ulaşılamadı';
  if (state === 'auth_error') return 'StoreBridge kimlik doğrulama hatası';
  return null;
}

function getJsonSetting(businessId, key, defaultValue) {
  const row = db.prepare('SELECT value FROM settings WHERE business_id = ? AND key = ?').get(businessId, key);
  if (!row?.value) return defaultValue;
  try {
    return JSON.parse(row.value);
  } catch {
    return defaultValue;
  }
}

function upsertSetting(businessId, key, valueObj) {
  const val = JSON.stringify(valueObj);
  const existing = db.prepare('SELECT id FROM settings WHERE business_id = ? AND key = ?').get(businessId, key);
  if (existing) {
    db.prepare(`UPDATE settings SET value = ?, updated_at = datetime('now') WHERE business_id = ? AND key = ?`).run(
      val,
      businessId,
      key,
    );
  } else {
    db.prepare(`INSERT INTO settings (id, business_id, key, value, updated_at) VALUES (?, ?, ?, ?, datetime('now'))`).run(
      genId(),
      businessId,
      key,
      val,
    );
  }
}

const PRINTER_TYPES = new Set(['receipt', 'kitchen', 'bar']);

const printerPreviewBodySchema = z.object({
  type: z.enum(['kitchen', 'receipt', 'bar']),
  line_width: z.union([z.number(), z.string()]).nullable().optional(),
  print_options: z.any().optional(),
});

function defaultLayoutReceipt() {
  return {
    fontFamily: 'Courier New',
    fontSizeHeader: 18,
    fontSizeSubheader: 13,
    fontSizeItems: 13,
    fontSizeTotal: 16,
    fontSizeFooter: 12,
    marginLeft: 8,
    marginRight: 8,
    footerLine1: 'Afiyet olsun',
    footerLine2: '',
  };
}

function defaultLayoutKitchen() {
  return {
    fontFamily: 'Courier New',
    fontSizeTitle: 15,
    fontSizeItems: 14,
    marginLeft: 6,
    marginRight: 6,
    footerLine1: '',
    footerLine2: '',
  };
}

function defaultLayoutForType(type) {
  if (type === 'kitchen') return defaultLayoutKitchen();
  if (type === 'bar') return { ...defaultLayoutKitchen(), fontSizeTitle: 14, fontSizeItems: 13 };
  return defaultLayoutReceipt();
}

function defaultOutputForType(type) {
  if (type === 'receipt') {
    return {
      showPrices: true,
      showOrderTotal: true,
      showOrderNumber: true,
      showVat: false,
      footerNote: '',
    };
  }
  return {
    showPrices: false,
    showOrderTotal: false,
    showOrderNumber: true,
    showVat: false,
    footerNote: '',
  };
}

function defaultCopies() {
  return {
    dine_in: 1,
    takeaway: 1,
    delivery: 1,
    after_payment: 1,
  };
}

function defaultTemplateForType(type) {
  if (type === 'kitchen' || type === 'bar') {
    return [
      '{{center:MUTFAK}}',
      '{{center:{order_type} | {table}}}',
      'No: {order_no}   {date}',
      '{{line}}',
      'URUN                            ADET',
      '{{line}}',
      '{{items}}',
      '{{line}}',
      '{{center:- {short_no} -}}',
      '{footer1}',
    ].join('\n');
  }
  return [
    '{{center:{business_name}}}',
    '{{center:{business_address}}}',
    '{{center:{business_phone}}}',
    '{{line}}',
    '{{center:{order_type}}}',
    'No: {order_no}   {date}',
    '{table}',
    '{{line}}',
    'URUN              MIKTAR       TUTAR',
    '{{line}}',
    '{{items}}',
    '{{line}}',
    'Ara toplam: {subtotal}',
    'TOPLAM: {total}',
    '{{payments}}',
    '{{line}}',
    '{{center:{footer1}}}',
    '{{center:{footer2}}}',
  ].join('\n');
}

function defaultPrintOptionsForType(type) {
  const pk = type === 'receipt' ? 'receipt' : type === 'kitchen' ? 'kitchen' : 'bar';
  return {
    device: { physicalName: null, source: 'manual' },
    layout: defaultLayoutForType(type),
    copies: defaultCopies(),
    printOnSave: false,
    printOnIntegrationApprove: false,
    skipPhoenixCmd: true,
    encodingMode: 'win1254',
    roles: {
      receipt: pk === 'receipt',
      kitchen: pk === 'kitchen',
      bar: pk === 'bar',
      courier: false,
      server: false,
    },
    kitchenGroups: {
      FIRIN: false,
      IZGARA: false,
      ICECEKLER: false,
    },
    output: defaultOutputForType(type),
    template: {
      enabled: false,
      body: defaultTemplateForType(type),
    },
  };
}

function mergePrintOptions(rawJson, type) {
  const base = defaultPrintOptionsForType(type);
  let parsed = {};
  if (rawJson) {
    try {
      parsed = typeof rawJson === 'string' ? JSON.parse(rawJson) : rawJson;
    } catch {
      parsed = {};
    }
  }
  const layoutLegacy = {};
  if (!parsed.layout?.footerLine1 && parsed.output?.footerNote) {
    layoutLegacy.footerLine1 = parsed.output.footerNote;
  }
  const merged = {
    device: { ...base.device, ...(parsed.device || {}) },
    layout: { ...base.layout, ...layoutLegacy, ...(parsed.layout || {}) },
    copies: { ...base.copies, ...(parsed.copies || {}) },
    printOnSave: typeof parsed.printOnSave === 'boolean' ? parsed.printOnSave : base.printOnSave,
    printOnIntegrationApprove:
      typeof parsed.printOnIntegrationApprove === 'boolean'
        ? parsed.printOnIntegrationApprove
        : base.printOnIntegrationApprove,
    skipPhoenixCmd:
      typeof parsed.skipPhoenixCmd === 'boolean' ? parsed.skipPhoenixCmd : base.skipPhoenixCmd,
    encodingMode: parsed.encodingMode === 'pc857' ? 'pc857' : base.encodingMode,
    roles: { ...base.roles, ...(parsed.roles || {}) },
    kitchenGroups: { ...base.kitchenGroups, ...(parsed.kitchenGroups || {}) },
    output: { ...base.output, ...(parsed.output || {}) },
    template: {
      ...base.template,
      ...(parsed.template && typeof parsed.template === 'object' ? parsed.template : {}),
    },
  };
  // Preserve printer hardware/encoding overrides
  if (parsed.escT != null) merged.escT = parsed.escT;
  if (parsed.skipInit) merged.skipInit = true;
  if (parsed.skipPhoenixCmd) merged.skipPhoenixCmd = true;
  if (parsed.encodingMode === 'pc857' || parsed.encodingMode === 'win1254') {
    merged.encodingMode = parsed.encodingMode;
  }
  const pk = type === 'receipt' ? 'receipt' : type === 'kitchen' ? 'kitchen' : 'bar';
  merged.roles[pk] = true;
  return merged;
}

function mergePrintOptionsPatch(existingRaw, incomingObj, type) {
  const base = mergePrintOptions(existingRaw, type);
  if (!incomingObj || typeof incomingObj !== 'object') return base;
  const out = {
    device: { ...base.device, ...(incomingObj.device || {}) },
    layout: { ...base.layout, ...(incomingObj.layout || {}) },
    copies: { ...base.copies, ...(incomingObj.copies || {}) },
    printOnSave:
      typeof incomingObj.printOnSave === 'boolean' ? incomingObj.printOnSave : base.printOnSave,
    printOnIntegrationApprove:
      typeof incomingObj.printOnIntegrationApprove === 'boolean'
        ? incomingObj.printOnIntegrationApprove
        : base.printOnIntegrationApprove,
    skipPhoenixCmd:
      typeof incomingObj.skipPhoenixCmd === 'boolean' ? incomingObj.skipPhoenixCmd : base.skipPhoenixCmd,
    encodingMode: incomingObj.encodingMode === 'pc857' ? 'pc857' : base.encodingMode,
    roles: { ...base.roles, ...(incomingObj.roles || {}) },
    kitchenGroups: { ...base.kitchenGroups, ...(incomingObj.kitchenGroups || {}) },
    output: { ...base.output, ...(incomingObj.output || {}) },
    template: {
      ...base.template,
      ...(incomingObj.template && typeof incomingObj.template === 'object' ? incomingObj.template : {}),
    },
  };
  // Preserve printer hardware/encoding overrides
  if (Object.prototype.hasOwnProperty.call(incomingObj, 'escT')) {
    const escT = parseInt(incomingObj.escT, 10);
    if (Number.isFinite(escT) && escT >= 0 && escT <= 255) out.escT = escT;
  } else if (base.escT != null) {
    out.escT = base.escT;
  }
  out.skipInit = incomingObj.skipInit != null ? !!incomingObj.skipInit : !!base.skipInit || undefined;
  const encMode = incomingObj.encodingMode != null ? incomingObj.encodingMode : base.encodingMode;
  out.encodingMode = encMode === 'pc857' ? 'pc857' : 'win1254';
  if (!out.skipInit) delete out.skipInit;
  const pk = type === 'receipt' ? 'receipt' : type === 'kitchen' ? 'kitchen' : 'bar';
  out.roles[pk] = true;
  return out;
}

function mapPrinterRow(row) {
  if (!row) return null;
  const print_options = mergePrintOptions(row.print_options, row.type);
  return {
    id: row.id,
    business_id: row.business_id,
    branch_id: row.branch_id,
    name: row.name,
    type: row.type,
    connection_type: row.connection_type,
    ip_address: row.ip_address,
    port: row.port,
    is_active: row.is_active === 1 || row.is_active === true,
    created_at: row.created_at,
    print_options,
  };
}

/** Kalıcı silme öncesi: varsayılan, yönlendirme, bekleyen iş; toplam iş sayısı bilgi amaçlı. */
function getPrinterDeleteEligibility(businessId, printerId) {
  const row = db.prepare(`SELECT * FROM printers WHERE id = ? AND business_id = ?`).get(printerId, businessId);
  if (!row) return null;

  const cfg = getJsonSetting(businessId, 'printer.config', {});
  const pid = String(printerId);
  const defId = cfg.defaultPrinterId != null ? String(cfg.defaultPrinterId) : '';
  const isDefault = defId !== '' && defId === pid;

  const routingCount =
    db
      .prepare(`SELECT COUNT(*) as c FROM printer_routing WHERE business_id = ? AND printer_id = ?`)
      .get(businessId, printerId).c || 0;

  const pendingJobs =
    db
      .prepare(
        `SELECT COUNT(*) as c FROM print_jobs WHERE business_id = ? AND printer_id = ? AND status = 'pending'`,
      )
      .get(businessId, printerId).c || 0;

  const totalJobs =
    db
      .prepare(`SELECT COUNT(*) as c FROM print_jobs WHERE business_id = ? AND printer_id = ?`)
      .get(businessId, printerId).c || 0;

  const blockers = [];
  if (isDefault) {
    blockers.push('Bu yazıcı varsayılan yazıcı. Önce başka bir yazıcıyı varsayılan yapın veya varsayılanı kaldırın.');
  }
  if (routingCount > 0) {
    blockers.push(
      'Bu yazıcı bir veya daha fazla kategori yönlendirmesinde kullanılıyor. Kategori → Yazıcı ekranından eşleşmeleri kaldırın veya yazıcıyı pasifleştirin (pasifleştirmede yönlendirmeler temizlenir).',
    );
  }
  if (pendingJobs > 0) {
    blockers.push('Bu yazıcıya ait bekleyen yazdırma işi var. İşlem bitene veya iptal edilene kadar kalıcı silinemez.');
  }

  const canHardDelete = !isDefault && routingCount === 0 && pendingJobs === 0;
  const canDeactivate = row.is_active === 1 || row.is_active === true;

  return {
    canHardDelete,
    canDeactivate,
    blockers,
    usage: {
      isDefault,
      routingCount,
      pendingJobs,
      totalJobs,
    },
  };
}

function countActiveAdmins(businessId) {
  return db
    .prepare(
      `SELECT COUNT(*) as c FROM users u
       JOIN roles r ON u.role_id = r.id
       WHERE u.business_id = ? AND u.is_active = 1 AND r.slug = 'admin'`,
    )
    .get(businessId).c;
}

function getUserRoleSlug(userId) {
  const r = db.prepare(`SELECT r.slug FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?`).get(userId);
  return r?.slug || null;
}

// ── Business ──
router.get('/business', (req, res) => {
  try {
    const b = db.prepare(
      `SELECT id, name, address, tax_id, receipt_header, phone, tax_office, receipt_footer
       FROM businesses WHERE id = ?`,
    ).get(req.businessId);
    if (!b) return res.status(404).json({ error: 'İşletme bulunamadı' });
    res.json({ business: b });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.patch('/business', (req, res) => {
  try {
    const { name, address, tax_id, receipt_header, phone, receipt_footer } = req.body;
    const n = (name ?? '').trim();
    if (!n) return res.status(400).json({ error: 'İşletme adı boş olamaz' });
    const tax = (tax_id ?? '').trim();
    if (!tax) return res.status(400).json({ error: 'Vergi numarası zorunludur' });
    if (tax.length < 5 || !/^[\dA-Za-z]+$/.test(tax)) {
      return res.status(400).json({ error: 'Vergi numarası en az 5 karakter ve yalnızca harf/rakam olmalıdır' });
    }
    db.prepare(
      `UPDATE businesses SET name = ?, address = ?, tax_id = ?, receipt_header = ?, phone = ?, receipt_footer = ?, updated_at = datetime('now')
       WHERE id = ?`,
    ).run(
      n,
      (address ?? '').trim(),
      tax,
      (receipt_header ?? '').trim(),
      (phone ?? '').trim() || null,
      (receipt_footer ?? '').trim() || null,
      req.businessId,
    );
    auditLog(req.businessId, req.user.id, 'update_business', 'business', req.businessId);
    const b = db.prepare(
      `SELECT id, name, address, tax_id, receipt_header, phone, tax_office, receipt_footer FROM businesses WHERE id = ?`,
    ).get(req.businessId);
    res.json({ business: b, message: 'İşletme bilgileri kaydedildi' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// ── Display (JSON in settings) ──
router.get('/display-settings', (req, res) => {
  const defaults = { theme: 'dark', language: 'tr', density: 'comfortable' };
  const stored = getJsonSetting(req.businessId, 'app.display', {});
  res.json({ display: { ...defaults, ...stored } });
});

router.patch('/display-settings', (req, res) => {
  try {
    const { theme, language, density } = req.body;
    const allowedTheme = ['dark', 'light', 'system'];
    const allowedLang = ['tr', 'en'];
    const allowedDensity = ['comfortable', 'compact'];
    const t = allowedTheme.includes(theme) ? theme : 'dark';
    const l = allowedLang.includes(language) ? language : 'tr';
    const d = allowedDensity.includes(density) ? density : 'comfortable';
    const next = { theme: t, language: l, density: d };
    upsertSetting(req.businessId, 'app.display', next);
    auditLog(req.businessId, req.user.id, 'update_display', 'settings', 'app.display');
    res.json({ display: next, message: 'Ekran ayarları kaydedildi' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// ── Printer list + config ──
router.get('/printer-settings', (req, res) => {
  try {
    const rows = db
      .prepare(
        `SELECT id, business_id, branch_id, name, type, connection_type, ip_address, port, is_active, created_at, print_options
         FROM printers WHERE business_id = ? ORDER BY name`,
      )
      .all(req.businessId);
    const printers = rows.map((r) => mapPrinterRow(r));
    const defaults = {
      defaultPrinterId: printers[0]?.id || null,
      usageKitchenId: null,
      usagePaymentId: null,
      usageBeverageLabelId: null,
      kitchenAdjustmentIncludeNew: false,
    };
    const stored = getJsonSetting(req.businessId, 'printer.config', {});
    const config = { ...defaults, ...stored };
    res.json({ printers, config });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.get('/printers/discovered', (req, res) => {
  try {
    const cached = getJsonSetting(req.businessId, DISCOVERY_CACHE_KEY, null);
    const printers = Array.isArray(cached?.printers)
      ? cached.printers
          .map((p) => {
            const name = String(p?.name || '').trim();
            if (!name) return null;
            return {
              name,
              isDefault: p?.isDefault === true,
              isOnline: p?.isOnline !== false,
              connectionType: String(p?.connectionType || '').trim() || 'network',
              ipAddress: String(p?.ipAddress || '').trim(),
              portName: String(p?.portName || '').trim(),
              source: 'windows',
            };
          })
          .filter(Boolean)
      : [];
    const scanState = resolveDiscoveryState(cached, printers);
    res.json({
      available: printers.length > 0,
      printers,
      scanState,
      lastErrorCode: cached?.lastErrorCode || null,
      updatedAt: cached?.updatedAt || null,
      source: 'storebridge',
      message: discoveryMessageForState(scanState),
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.post('/printers/discovered/refresh', async (req, res) => {
  const host = req.get('host') || `127.0.0.1:${config.port}`;
  const baseUrl = `${req.protocol}://${host}/api/bridge/printers/discovered/refresh`;
  try {
    if (!config.bridge?.token || !config.bridge?.businessId) {
      const fallback = getJsonSetting(req.businessId, DISCOVERY_CACHE_KEY, {});
      upsertSetting(req.businessId, DISCOVERY_CACHE_KEY, {
        ...fallback,
        scanState: 'bridge_unreachable',
        lastErrorCode: 'bridge_not_configured',
        updatedAt: new Date().toISOString(),
        source: 'storebridge',
      });
      return res.status(503).json({ error: 'Bridge yapılandırması eksik', scanState: 'bridge_unreachable' });
    }

    const bridgeRes = await fetch(baseUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'X-Bridge-Token': config.bridge.token,
      },
      body: '{}',
    });

    let data = {};
    try {
      data = await bridgeRes.json();
    } catch {
      data = {};
    }

    if (!bridgeRes.ok) {
      const fallback = getJsonSetting(req.businessId, DISCOVERY_CACHE_KEY, {});
      const scanState = bridgeRes.status === 401 ? 'auth_error' : 'bridge_unreachable';
      upsertSetting(req.businessId, DISCOVERY_CACHE_KEY, {
        ...fallback,
        scanState,
        lastErrorCode: bridgeRes.status === 401 ? 'auth_error' : 'bridge_unreachable',
        updatedAt: new Date().toISOString(),
        source: 'storebridge',
      });
      return res.status(bridgeRes.status).json({
        error: data.error || 'Bridge refresh çağrısı başarısız',
        scanState,
      });
    }

    res.json({
      ok: true,
      scanState: data.scanState || 'scanning',
      requestId: data.requestId || null,
      requestedAt: data.requestedAt || new Date().toISOString(),
    });
  } catch (err) {
    const fallback = getJsonSetting(req.businessId, DISCOVERY_CACHE_KEY, {});
    upsertSetting(req.businessId, DISCOVERY_CACHE_KEY, {
      ...fallback,
      scanState: 'bridge_unreachable',
      lastErrorCode: 'bridge_unreachable',
      updatedAt: new Date().toISOString(),
      source: 'storebridge',
    });
    res.status(503).json({ error: 'StoreBridge servisine ulaşılamadı', scanState: 'bridge_unreachable' });
  }
});

router.patch('/printer-settings', (req, res) => {
  try {
    const printerRows = db.prepare(`SELECT id FROM printers WHERE business_id = ?`).all(req.businessId);
    const ids = new Set(printerRows.map((p) => p.id));
    const pick = (v) => (v && ids.has(v) ? v : null);
    const baseDefaults = {
      defaultPrinterId: printerRows[0]?.id || null,
      usageKitchenId: null,
      usagePaymentId: null,
      usageBeverageLabelId: null,
      kitchenAdjustmentIncludeNew: false,
    };
    const stored = getJsonSetting(req.businessId, 'printer.config', {});
    const prev = { ...baseDefaults, ...stored };
    const body = req.body || {};
    const config = {
      defaultPrinterId: Object.prototype.hasOwnProperty.call(body, 'defaultPrinterId')
        ? pick(body.defaultPrinterId)
        : pick(prev.defaultPrinterId),
      usageKitchenId: Object.prototype.hasOwnProperty.call(body, 'usageKitchenId')
        ? pick(body.usageKitchenId)
        : pick(prev.usageKitchenId),
      usagePaymentId: Object.prototype.hasOwnProperty.call(body, 'usagePaymentId')
        ? pick(body.usagePaymentId)
        : pick(prev.usagePaymentId),
      usageBeverageLabelId: Object.prototype.hasOwnProperty.call(body, 'usageBeverageLabelId')
        ? pick(body.usageBeverageLabelId)
        : pick(prev.usageBeverageLabelId),
      kitchenAdjustmentIncludeNew: Object.prototype.hasOwnProperty.call(body, 'kitchenAdjustmentIncludeNew')
        ? !!body.kitchenAdjustmentIncludeNew
        : !!prev.kitchenAdjustmentIncludeNew,
    };
    upsertSetting(req.businessId, 'printer.config', config);
    auditLog(req.businessId, req.user.id, 'update_printer_settings', 'settings', 'printer.config');
    res.json({ config, message: 'Yazıcı ayarları kaydedildi' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.post('/printers', (req, res) => {
  try {
    const { name, type, connection_type, ip_address, port, is_active, line_width, print_options } = req.body;
    const n = (name ?? '').trim();
    if (!n) return res.status(400).json({ error: 'Yazıcı adı zorunludur' });
    const t = PRINTER_TYPES.has(type) ? type : 'receipt';
    const conn = ['network', 'usb'].includes(connection_type) ? connection_type : 'network';
    const portNum = port != null && port !== '' ? parseInt(port, 10) : 9100;
    if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
      return res.status(400).json({ error: 'Geçerli bir port girin' });
    }
    const lwNum = line_width != null ? parseInt(line_width, 10) : null;
    const lw = Number.isFinite(lwNum) && lwNum >= 32 && lwNum <= 64 ? lwNum : null;
    const branch = db.prepare(`SELECT id FROM branches WHERE business_id = ? LIMIT 1`).get(req.businessId);
    const branchId = branch?.id || null;
    const id = genId();
    const mergedPo = mergePrintOptionsPatch(null, print_options, t);
    const active = is_active === false || is_active === 0 ? 0 : 1;
    db.prepare(
      `INSERT INTO printers (id, business_id, branch_id, name, type, connection_type, ip_address, port, is_active, line_width, print_options)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      req.businessId,
      branchId,
      n,
      t,
      conn,
      (ip_address ?? '').trim() || null,
      portNum,
      active,
      lw,
      JSON.stringify(mergedPo),
    );
    auditLog(req.businessId, req.user.id, 'create_printer', 'printer', id);
    const row = db
      .prepare(`SELECT * FROM printers WHERE id = ? AND business_id = ?`)
      .get(id, req.businessId);
    res.status(201).json({ printer: mapPrinterRow(row), message: 'Yazıcı oluşturuldu' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.post('/printers/preview', (req, res) => {
  try {
    const parsed = printerPreviewBodySchema.safeParse(req.body);
    if (!parsed.success) {
      return res.status(400).json({ error: 'Geçersiz istek', details: parsed.error.flatten() });
    }
    const { type, line_width, print_options } = parsed.data;
    const lines = getPrinterPreviewPlainLines(type, line_width ?? undefined, print_options || {});
    res.json({ lines });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Sunucu hatası' });
  }
});

router.get('/printers/:id/delete-eligibility', (req, res) => {
  try {
    const el = getPrinterDeleteEligibility(req.businessId, req.params.id);
    if (!el) return res.status(404).json({ error: 'Yazıcı bulunamadı' });
    res.json(el);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

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

router.patch('/printers/:id', (req, res) => {
  try {
    const existing = db
      .prepare(`SELECT * FROM printers WHERE id = ? AND business_id = ?`)
      .get(req.params.id, req.businessId);
    if (!existing) return res.status(404).json({ error: 'Yazıcı bulunamadı' });

    const { name, type, connection_type, ip_address, port, is_active, line_width, print_options } = req.body;
    let nextName = existing.name;
    if (name !== undefined) {
      const n = String(name).trim();
      if (!n) return res.status(400).json({ error: 'Yazıcı adı boş olamaz' });
      nextName = n;
    }
    let nextType = existing.type;
    if (type !== undefined) {
      if (!PRINTER_TYPES.has(type)) return res.status(400).json({ error: 'Geçersiz yazıcı türü' });
      nextType = type;
    }
    let nextConn = existing.connection_type || 'network';
    if (connection_type !== undefined) {
      nextConn = ['network', 'usb'].includes(connection_type) ? connection_type : 'network';
    }
    let nextIp = existing.ip_address;
    if (ip_address !== undefined) nextIp = String(ip_address).trim() || null;
    let nextPort = existing.port ?? 9100;
    if (port !== undefined && port !== null && port !== '') {
      const portNum = parseInt(port, 10);
      if (Number.isNaN(portNum) || portNum < 1 || portNum > 65535) {
        return res.status(400).json({ error: 'Geçerli bir port girin' });
      }
      nextPort = portNum;
    }
    let nextActive = existing.is_active === 1 || existing.is_active === true ? 1 : 0;
    if (is_active !== undefined) {
      nextActive = is_active === false || is_active === 0 ? 0 : 1;
    }

    let poJson = existing.print_options;
    if (print_options !== undefined && print_options !== null && typeof print_options === 'object') {
      poJson = JSON.stringify(mergePrintOptionsPatch(existing.print_options, print_options, nextType));
    } else if (nextType !== existing.type) {
      poJson = JSON.stringify(mergePrintOptions(existing.print_options, nextType));
    }

    const lwNum = line_width != null ? parseInt(line_width, 10) : null;
    const nextLw = line_width !== undefined
      ? (Number.isFinite(lwNum) && lwNum >= 32 && lwNum <= 64 ? lwNum : null)
      : (existing.line_width ?? null);

    db.prepare(
      `UPDATE printers SET name = ?, type = ?, connection_type = ?, ip_address = ?, port = ?, is_active = ?, line_width = ?, print_options = ?
       WHERE id = ? AND business_id = ?`,
    ).run(nextName, nextType, nextConn, nextIp, nextPort, nextActive, nextLw, poJson, req.params.id, req.businessId);

    let responseMessage = 'Yazıcı güncellendi';
    const wasActive = existing.is_active === 1 || existing.is_active === true;
    if (nextActive === 0) {
      const cfg = getJsonSetting(req.businessId, 'printer.config', {});
      const hadDefault =
        cfg.defaultPrinterId != null && String(cfg.defaultPrinterId) === String(req.params.id);
      const routingDel = db
        .prepare(`DELETE FROM printer_routing WHERE business_id = ? AND printer_id = ?`)
        .run(req.businessId, req.params.id);
      if (hadDefault) {
        upsertSetting(req.businessId, 'printer.config', { ...cfg, defaultPrinterId: null });
      }
      if (wasActive) {
        responseMessage = 'Yazıcı pasifleştirildi.';
        if (hadDefault) responseMessage += ' Varsayılan yazıcı ayarı kaldırıldı.';
        if (routingDel.changes > 0) {
          responseMessage += ` ${routingDel.changes} kategori yönlendirmesi kaldırıldı.`;
        }
      }
    }

    auditLog(req.businessId, req.user.id, 'update_printer', 'printer', req.params.id);
    const row = db
      .prepare(`SELECT * FROM printers WHERE id = ? AND business_id = ?`)
      .get(req.params.id, req.businessId);
    res.json({ printer: mapPrinterRow(row), message: responseMessage });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.delete('/printers/:id', (req, res) => {
  try {
    const el = getPrinterDeleteEligibility(req.businessId, req.params.id);
    if (!el) return res.status(404).json({ error: 'Yazıcı bulunamadı' });
    if (!el.canHardDelete) {
      return res.status(400).json({
        error: 'Bu yazıcı şu an kalıcı olarak silinemez.',
        blockers: el.blockers,
        usage: el.usage,
      });
    }

    db.transaction(() => {
      db.prepare(`DELETE FROM printer_routing WHERE business_id = ? AND printer_id = ?`).run(req.businessId, req.params.id);
      db.prepare(`UPDATE print_jobs SET printer_id = NULL WHERE business_id = ? AND printer_id = ?`).run(
        req.businessId,
        req.params.id,
      );
      const cfg = getJsonSetting(req.businessId, 'printer.config', {});
      if (cfg.defaultPrinterId != null && String(cfg.defaultPrinterId) === String(req.params.id)) {
        upsertSetting(req.businessId, 'printer.config', { ...cfg, defaultPrinterId: null });
      }
      const del = db.prepare(`DELETE FROM printers WHERE id = ? AND business_id = ?`).run(req.params.id, req.businessId);
      if (del.changes === 0) throw new Error('Yazıcı silinemedi');
    })();

    auditLog(req.businessId, req.user.id, 'delete_printer', 'printer', req.params.id);
    res.json({ message: 'Yazıcı kalıcı olarak silindi' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Sunucu hatası' });
  }
});

router.get('/print-jobs', (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || '30', 10) || 30, 1), 100);
    const jobs = db
      .prepare(
        `SELECT id, order_id, printer_id, job_type, status, error_message, idempotency_key, created_at, printed_at, payload
         FROM print_jobs WHERE business_id = ? ORDER BY datetime(created_at) DESC LIMIT ?`,
      )
      .all(req.businessId, limit);
    res.json({ jobs });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// ── Kategori → yazıcı (printer_routing) ──
router.get('/printer-routing', (req, res) => {
  try {
    const categories = db
      .prepare(
        `SELECT id, name, sort_order, printer_target, is_active FROM categories WHERE business_id = ? AND is_active = 1 ORDER BY sort_order, name`,
      )
      .all(req.businessId);

    const printerRows = db
      .prepare(
        `SELECT id, business_id, branch_id, name, type, connection_type, ip_address, port, is_active, created_at, print_options
         FROM printers WHERE business_id = ? AND is_active = 1 ORDER BY name`,
      )
      .all(req.businessId);
    const printers = printerRows.map((r) => mapPrinterRow(r));

    const routingRows = db.prepare(`SELECT id, category_id, printer_id FROM printer_routing WHERE business_id = ?`).all(req.businessId);
    const assignments = routingRows.map((r) => ({ category_id: r.category_id, printer_id: r.printer_id }));

    res.json({ categories, printers, assignments });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.patch('/printer-routing', (req, res) => {
  try {
    const { assignments } = req.body;
    if (!Array.isArray(assignments)) {
      return res.status(400).json({ error: 'assignments dizisi gerekli' });
    }

    const run = db.transaction(() => {
      for (const a of assignments) {
        const categoryId = a.category_id;
        const printerId = a.printer_id;

        if (!categoryId) {
          const err = new Error('category_id gerekli');
          err.status = 400;
          throw err;
        }

        const cat = db.prepare(`SELECT id FROM categories WHERE id = ? AND business_id = ?`).get(categoryId, req.businessId);
        if (!cat) {
          const err = new Error('Kategori bulunamadı');
          err.status = 400;
          throw err;
        }

        db.prepare(`DELETE FROM printer_routing WHERE business_id = ? AND category_id = ?`).run(req.businessId, categoryId);

        if (printerId != null && printerId !== '') {
          const pr = db
            .prepare(`SELECT id FROM printers WHERE id = ? AND business_id = ? AND is_active = 1`)
            .get(printerId, req.businessId);
          if (!pr) {
            const err = new Error('Yazıcı bulunamadı veya pasif');
            err.status = 400;
            throw err;
          }
          const rid = genId();
          db.prepare(
            `INSERT INTO printer_routing (id, business_id, category_id, printer_id, created_at) VALUES (?, ?, ?, ?, datetime('now'))`,
          ).run(rid, req.businessId, categoryId, printerId);
        }
      }
    });

    run();
    auditLog(req.businessId, req.user.id, 'update_printer_routing', 'settings', 'printer_routing');

    const routingRows = db.prepare(`SELECT id, category_id, printer_id FROM printer_routing WHERE business_id = ?`).all(req.businessId);
    const assignmentsOut = routingRows.map((r) => ({ category_id: r.category_id, printer_id: r.printer_id }));
    res.json({ assignments: assignmentsOut, message: 'Yazıcı yönlendirmesi kaydedildi' });
  } catch (err) {
    if (err.status === 400) {
      return res.status(400).json({ error: err.message });
    }
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.post('/printers/test', (req, res) => {
  try {
    const { printer_id } = req.body;
    if (!printer_id) return res.status(400).json({ error: 'Yazıcı seçin' });
    const p = db
      .prepare(`SELECT * FROM printers WHERE id = ? AND business_id = ?`)
      .get(printer_id, req.businessId);
    if (!p) return res.status(404).json({ error: 'Yazıcı bulunamadı' });

    let po = {};
    try {
      po = p.print_options ? JSON.parse(p.print_options) : {};
    } catch {
      po = {};
    }
    const physicalName = String(po?.device?.physicalName || '').trim();
    const nowIso = new Date().toISOString();
    const testPayload = {
      kind: 'test',
      encoding_diagnostic: true,
      printer_name: p.name,
      connection_type: p.connection_type || 'network',
      address: p.connection_type === 'usb'
        ? (physicalName || p.name)
        : `${p.ip_address || '-'}:${p.port || 9100}`,
      created_at: nowIso,
      order_no: `TEST-${Date.now().toString().slice(-6)}`,
      lines: [
        'Restoran POS fiziksel yazici testi',
        'Bu cikti StoreBridge print_jobs zinciriyle gonderilmistir.',
      ],
    };
    const jobId = genId();
    const idempotencyKey = `test|${req.businessId}|${printer_id}|${jobId}`;
    db.prepare(
      `INSERT INTO print_jobs (id, business_id, order_id, printer_id, job_type, payload, status, error_message, idempotency_key, created_at, printed_at)
       VALUES (?, ?, NULL, ?, ?, ?, 'pending', NULL, ?, datetime('now'), NULL)`,
    ).run(jobId, req.businessId, printer_id, 'test', JSON.stringify(testPayload), idempotencyKey);

    auditLog(req.businessId, req.user.id, 'printer_test', 'printer', printer_id);
    res.json({
      success: true,
      queued: true,
      jobId,
      message: `Test çıktısı kuyruğa alındı: ${p.name}`,
    });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// ── Roles (for user form) ──
router.get('/roles', (req, res) => {
  const roles = db
    .prepare(`SELECT id, name, slug FROM roles WHERE business_id = ? ORDER BY name`)
    .all(req.businessId);
  res.json({ roles });
});

// ── Users ──
const emailRe = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

router.get('/users', (req, res) => {
  try {
    const users = db
      .prepare(
        `SELECT u.id, u.email, u.full_name, u.is_active, u.created_at,
                r.id as role_id, r.name as role_name, r.slug as role_slug
         FROM users u
         JOIN roles r ON u.role_id = r.id
         WHERE u.business_id = ?
         ORDER BY u.full_name`,
      )
      .all(req.businessId);
    res.json({ users });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.post('/users', (req, res) => {
  try {
    const { full_name, email, password, role_slug, is_active } = req.body;
    const fn = (full_name ?? '').trim();
    if (!fn) return res.status(400).json({ error: 'Ad soyad zorunludur' });
    const em = (email ?? '').toLowerCase().trim();
    if (!emailRe.test(em)) return res.status(400).json({ error: 'Geçerli bir e-posta girin' });
    const pw = password ?? '';
    if (!pw || pw.length < 4) return res.status(400).json({ error: 'Şifre en az 4 karakter olmalıdır' });
    const role = db
      .prepare(`SELECT id FROM roles WHERE business_id = ? AND slug = ?`)
      .get(req.businessId, role_slug || 'waiter');
    if (!role) return res.status(400).json({ error: 'Geçersiz rol' });
    const dup = db.prepare(`SELECT id FROM users WHERE business_id = ? AND lower(email) = ?`).get(req.businessId, em);
    if (dup) return res.status(400).json({ error: 'Bu e-posta bu işletmede zaten kayıtlı' });
    const id = genId();
    const hash = bcryptjs.hashSync(pw, 10);
    const active = is_active === false ? 0 : 1;
    let branchId = req.branchId || null;
    if (!branchId) {
      const b = db.prepare(`SELECT id FROM branches WHERE business_id = ? LIMIT 1`).get(req.businessId);
      branchId = b?.id || null;
    }
    db.prepare(
      `INSERT INTO users (id, business_id, branch_id, role_id, email, password_hash, full_name, is_active, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, datetime('now'))`,
    ).run(id, req.businessId, branchId, role.id, em, hash, fn, active);
    auditLog(req.businessId, req.user.id, 'create_user', 'user', id);
    const u = db
      .prepare(
        `SELECT u.id, u.email, u.full_name, u.is_active, r.name as role_name, r.slug as role_slug
         FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?`,
      )
      .get(id);
    res.status(201).json({ user: u, message: 'Kullanıcı oluşturuldu' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.patch('/users/:id', (req, res) => {
  try {
    const userId = req.params.id;
    const row = db.prepare(`SELECT * FROM users WHERE id = ? AND business_id = ?`).get(userId, req.businessId);
    if (!row) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    const { full_name, email, password, role_slug, is_active } = req.body;
    const fn = full_name !== undefined ? (full_name ?? '').trim() : row.full_name;
    if (!fn) return res.status(400).json({ error: 'Ad soyad zorunludur' });
    let em = row.email;
    if (email !== undefined) {
      em = (email ?? '').toLowerCase().trim();
      if (!emailRe.test(em)) return res.status(400).json({ error: 'Geçerli bir e-posta girin' });
      const dup = db
        .prepare(`SELECT id FROM users WHERE business_id = ? AND lower(email) = ? AND id != ?`)
        .get(req.businessId, em, userId);
      if (dup) return res.status(400).json({ error: 'Bu e-posta başka kullanıcıda kayıtlı' });
    }
    let roleId = row.role_id;
    if (role_slug !== undefined) {
      const role = db.prepare(`SELECT id, slug FROM roles WHERE business_id = ? AND slug = ?`).get(req.businessId, role_slug);
      if (!role) return res.status(400).json({ error: 'Geçersiz rol' });
      const wasAdmin = getUserRoleSlug(userId) === 'admin';
      const willBeAdmin = role.slug === 'admin';
      if (wasAdmin && !willBeAdmin && countActiveAdmins(req.businessId) <= 1) {
        return res.status(400).json({ error: 'Son yönetici rolünü kaldıramazsınız' });
      }
      roleId = role.id;
    }
    let nextActive = row.is_active;
    if (is_active !== undefined) nextActive = is_active ? 1 : 0;
    const slug = db.prepare(`SELECT slug FROM roles WHERE id = ?`).get(roleId)?.slug;
    if (slug === 'admin' && !nextActive && countActiveAdmins(req.businessId) <= 1 && getUserRoleSlug(userId) === 'admin') {
      return res.status(400).json({ error: 'Son aktif yöneticiyi pasifleştiremezsiniz' });
    }
    if (userId === req.user.id && !nextActive) {
      return res.status(400).json({ error: 'Kendi hesabınızı pasifleştiremezsiniz' });
    }
    const hash = password && String(password).length > 0 ? bcryptjs.hashSync(password, 10) : null;
    if (hash) {
      db.prepare(
        `UPDATE users SET full_name = ?, email = ?, role_id = ?, is_active = ?, password_hash = ?, updated_at = datetime('now')
         WHERE id = ? AND business_id = ?`,
      ).run(fn, em, roleId, nextActive, hash, userId, req.businessId);
    } else {
      db.prepare(
        `UPDATE users SET full_name = ?, email = ?, role_id = ?, is_active = ?, updated_at = datetime('now')
         WHERE id = ? AND business_id = ?`,
      ).run(fn, em, roleId, nextActive, userId, req.businessId);
    }
    auditLog(req.businessId, req.user.id, 'update_user', 'user', userId);
    const u = db
      .prepare(
        `SELECT u.id, u.email, u.full_name, u.is_active, r.name as role_name, r.slug as role_slug
         FROM users u JOIN roles r ON u.role_id = r.id WHERE u.id = ?`,
      )
      .get(userId);
    res.json({ user: u, message: 'Kullanıcı güncellendi' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.delete('/users/:id', (req, res) => {
  try {
    const userId = req.params.id;
    if (userId === req.user.id) return res.status(400).json({ error: 'Kendi hesabınızı silemezsiniz' });
    const row = db.prepare(`SELECT * FROM users WHERE id = ? AND business_id = ?`).get(userId, req.businessId);
    if (!row) return res.status(404).json({ error: 'Kullanıcı bulunamadı' });
    if (!row.is_active) return res.status(400).json({ error: 'Kullanıcı zaten pasif' });
    if (getUserRoleSlug(userId) === 'admin' && countActiveAdmins(req.businessId) <= 1) {
      return res.status(400).json({ error: 'Son yönetici kaldırılamaz' });
    }
    db.prepare(`UPDATE users SET is_active = 0, updated_at = datetime('now') WHERE id = ? AND business_id = ?`).run(
      userId,
      req.businessId,
    );
    auditLog(req.businessId, req.user.id, 'deactivate_user', 'user', userId);
    res.json({ message: 'Kullanıcı pasifleştirildi' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// ── Yemek bölgeleri + masa sayısı senkronu (POStoran benzeri) ──
router.get('/dining-areas', (req, res) => {
  try {
    const areas = db
      .prepare(
        `SELECT da.*,
          (SELECT COUNT(*) FROM tables t WHERE t.dining_area_id = da.id AND t.business_id = da.business_id AND t.is_active = 1) AS active_table_count
         FROM dining_areas da
         WHERE da.business_id = ? AND da.is_active = 1
         ORDER BY da.sort_order, da.name`,
      )
      .all(req.businessId);
    res.json({ areas });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

function resolveBranchIdForDining(req) {
  let branchId = req.branchId || null;
  if (!branchId) {
    branchId = db.prepare(`SELECT id FROM branches WHERE business_id = ? LIMIT 1`).get(req.businessId)?.id || null;
  }
  return branchId;
}

function diningAreaNameTaken(businessId, nameTrimmed, excludeAreaId = null) {
  const dup = excludeAreaId
    ? db
        .prepare(
          `SELECT id FROM dining_areas WHERE business_id = ? AND is_active = 1 AND id != ? AND LOWER(TRIM(name)) = LOWER(?)`,
        )
        .get(businessId, excludeAreaId, nameTrimmed)
    : db
        .prepare(
          `SELECT id FROM dining_areas WHERE business_id = ? AND is_active = 1 AND LOWER(TRIM(name)) = LOWER(?)`,
        )
        .get(businessId, nameTrimmed);
  return !!dup;
}

router.post('/dining-areas', (req, res) => {
  try {
    const nameTrimmed = String(req.body?.name ?? '').trim();
    if (!nameTrimmed) {
      return res.status(400).json({ error: 'Bölge adı gerekli' });
    }
    if (diningAreaNameTaken(req.businessId, nameTrimmed)) {
      return res.status(400).json({ error: 'Bu isimde aktif bir bölge zaten var' });
    }

    const branchId = resolveBranchIdForDining(req);
    const maxSort = db
      .prepare(`SELECT COALESCE(MAX(sort_order), -1) AS m FROM dining_areas WHERE business_id = ?`)
      .get(req.businessId).m;
    const sortOrder =
      req.body.sort_order !== undefined && req.body.sort_order !== null
        ? Math.floor(Number(req.body.sort_order))
        : maxSort + 1;

    const id = genId();
    db.prepare(
      `INSERT INTO dining_areas (id, business_id, branch_id, name, sort_order, is_active, target_table_count, created_at)
       VALUES (?, ?, ?, ?, ?, 1, 0, datetime('now'))`,
    ).run(id, req.businessId, branchId, nameTrimmed, sortOrder);

    auditLog(req.businessId, req.user.id, 'dining_area_create', 'dining_area', id, { name: nameTrimmed });
    const area = db.prepare(`SELECT * FROM dining_areas WHERE id = ?`).get(id);
    res.status(201).json({ area });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.patch('/dining-areas/:id', (req, res) => {
  try {
    const area = db
      .prepare(`SELECT * FROM dining_areas WHERE id = ? AND business_id = ? AND is_active = 1`)
      .get(req.params.id, req.businessId);
    if (!area) {
      return res.status(404).json({ error: 'Bölge bulunamadı' });
    }

    const { name, sort_order } = req.body;
    if (name !== undefined) {
      const nameTrimmed = String(name).trim();
      if (!nameTrimmed) {
        return res.status(400).json({ error: 'Bölge adı boş olamaz' });
      }
      if (diningAreaNameTaken(req.businessId, nameTrimmed, area.id)) {
        return res.status(400).json({ error: 'Bu isimde aktif bir bölge zaten var' });
      }
      db.prepare(`UPDATE dining_areas SET name = ? WHERE id = ? AND business_id = ?`).run(nameTrimmed, area.id, req.businessId);
    }
    if (sort_order !== undefined && sort_order !== null) {
      const so = Math.floor(Number(sort_order));
      if (Number.isFinite(so)) {
        db.prepare(`UPDATE dining_areas SET sort_order = ? WHERE id = ? AND business_id = ?`).run(so, area.id, req.businessId);
      }
    }

    auditLog(req.businessId, req.user.id, 'dining_area_update', 'dining_area', area.id, { name, sort_order });
    const updated = db.prepare(`SELECT * FROM dining_areas WHERE id = ?`).get(area.id);
    res.json({ area: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.delete('/dining-areas/:id', (req, res) => {
  try {
    const area = db
      .prepare(`SELECT * FROM dining_areas WHERE id = ? AND business_id = ? AND is_active = 1`)
      .get(req.params.id, req.businessId);
    if (!area) {
      return res.status(404).json({ error: 'Bölge bulunamadı' });
    }

    const activeCount = db
      .prepare(
        `SELECT COUNT(*) AS c FROM tables WHERE dining_area_id = ? AND business_id = ? AND is_active = 1`,
      )
      .get(area.id, req.businessId).c;
    if (activeCount > 0) {
      return res.status(400).json({
        error:
          'Bu bölgede hâlâ aktif masa var. Önce hedef masa sayısını azaltarak tüm masaları kaldırın, sonra silmeyi deneyin.',
      });
    }

    db.prepare(`UPDATE dining_areas SET is_active = 0 WHERE id = ? AND business_id = ?`).run(area.id, req.businessId);
    auditLog(req.businessId, req.user.id, 'dining_area_delete', 'dining_area', area.id, {});
    res.json({ success: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.post('/dining-areas/:areaId/sync-tables', (req, res) => {
  try {
    const { target_table_count: rawTarget } = req.body;
    const target = Math.max(0, Math.floor(Number(rawTarget)));
    if (!Number.isFinite(target)) {
      return res.status(400).json({ error: 'Geçerli masa sayısı girin' });
    }

    const area = db
      .prepare(`SELECT * FROM dining_areas WHERE id = ? AND business_id = ?`)
      .get(req.params.areaId, req.businessId);
    if (!area) return res.status(404).json({ error: 'Bölge bulunamadı' });

    const branchId = resolveBranchIdForDining(req);

    const activeTables = db
      .prepare(
        `SELECT * FROM tables WHERE dining_area_id = ? AND business_id = ? AND is_active = 1 ORDER BY sort_order, name`,
      )
      .all(area.id, req.businessId);

    const current = activeTables.length;

    let toDeactivate = [];
    if (target < current) {
      const need = current - target;
      const tail = db
        .prepare(
          `SELECT id, name, status, current_order_id FROM tables
           WHERE dining_area_id = ? AND business_id = ? AND is_active = 1
           ORDER BY sort_order DESC, name DESC LIMIT ?`,
        )
        .all(area.id, req.businessId, need);

      const closedPlaceholders = ORDER_STATUSES_CLOSED.map(() => '?').join(', ');
      const openOrderForTable = db.prepare(
        `SELECT 1 FROM orders WHERE table_id = ? AND business_id = ? AND status NOT IN (${closedPlaceholders}) LIMIT 1`,
      );

      const blockerMsgs = [];
      const labels = [];
      const seen = new Set();
      for (const t of tail) {
        const label = String(t.name || 'Masa').trim() || 'Masa';
        const noCurrentOrder =
          t.current_order_id == null || String(t.current_order_id).trim() === '';
        const empty = t.status === 'empty';
        const orphanOpen = openOrderForTable.get(t.id, req.businessId, ...ORDER_STATUSES_CLOSED);
        const canRemove = empty && noCurrentOrder && !orphanOpen;
        if (canRemove) continue;
        if (seen.has(t.id)) continue;
        seen.add(t.id);
        labels.push(label);
        blockerMsgs.push(
          `${label}: Bu masada açık sipariş veya dolu adisyon var. Önce masayı kapatın veya siparişi iptal edin.`,
        );
      }

      if (blockerMsgs.length > 0) {
        const namesJoined = labels.join(', ');
        const summary =
          blockerMsgs.length === 1
            ? blockerMsgs[0]
            : `${namesJoined} masaları aktif kullanımda olduğu için hedef ${target} uygulanamadı. Önce bu masaları boşaltın veya adisyonları kapatın.`;

        return res.status(409).json({
          error: summary,
          blockers: blockerMsgs,
        });
      }

      toDeactivate = tail.map((row) => ({ id: row.id }));
    }

    const txn = db.transaction(() => {
      if (target > current) {
        let prefix = 'M';
        let maxSuffix = 0;
        if (activeTables.length === 0) {
          const base = String(area.name || 'M')
            .replace(/[^a-zA-ZĞğÜüŞşİıÖöÇç0-9]/g, '')
            .slice(0, 2)
            .toUpperCase();
          prefix = base || 'M';
        } else {
          const first = String(activeTables[0].name || '').match(/^(.+?)(\d+)$/);
          if (first) prefix = first[1];
          for (const t of activeTables) {
            const m = String(t.name || '').match(/^(.+?)(\d+)$/);
            if (m) maxSuffix = Math.max(maxSuffix, parseInt(m[2], 10));
          }
        }
        const maxSort =
          db
            .prepare(`SELECT COALESCE(MAX(sort_order), 0) as m FROM tables WHERE dining_area_id = ? AND business_id = ?`)
            .get(area.id, req.businessId).m || 0;

        for (let k = 0; k < target - current; k += 1) {
          maxSuffix += 1;
          const id = genId();
          const name = `${prefix}${maxSuffix}`;
          const sort = maxSort + k + 1;
          db.prepare(
            `INSERT INTO tables (id, business_id, branch_id, dining_area_id, name, capacity, sort_order, status, is_active, updated_at)
             VALUES (?, ?, ?, ?, ?, 4, ?, 'empty', 1, datetime('now'))`,
          ).run(id, req.businessId, branchId, area.id, name, sort);
        }
      } else if (target < current) {
        for (const row of toDeactivate) {
          db.prepare(`UPDATE tables SET is_active = 0, updated_at = datetime('now') WHERE id = ?`).run(row.id);
        }
      }

      db.prepare(`UPDATE dining_areas SET target_table_count = ? WHERE id = ? AND business_id = ?`).run(
        target,
        area.id,
        req.businessId,
      );
    });

    txn();

    auditLog(req.businessId, req.user.id, 'dining_area_sync_tables', 'dining_area', area.id, { target });
    const activeCount = db
      .prepare(
        `SELECT COUNT(*) as c FROM tables WHERE dining_area_id = ? AND business_id = ? AND is_active = 1`,
      )
      .get(area.id, req.businessId).c;
    res.json({ success: true, target_table_count: target, active_table_count: activeCount });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: err.message || 'Sunucu hatası' });
  }
});

export default router;
