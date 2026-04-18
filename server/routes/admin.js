import { Router } from 'express';
import bcryptjs from 'bcryptjs';
import { z } from 'zod';
import fs from 'fs';
import path from 'path';
import Database from 'better-sqlite3';
import { getPrinterPreviewPlainLines } from '../../store-bridge/printers/renderers.js';
import db from '../config/database.js';
import config from '../config/index.js';
import { authenticate, businessScope, authorize } from '../middleware/auth.js';
import { genId, auditLog } from '../utils/helpers.js';
import { ORDER_STATUSES_CLOSED } from '../constants/orderStatus.js';

const router = Router();
router.use(authenticate, businessScope, authorize('admin'));
const DISCOVERY_CACHE_KEY = 'bridge.discovered_printers';
const RESTORE_REQUEST_FILE = 'restore-request.json';
const BACKUP_FILE_RE = /^(pos|pos-manual|restore-safety)-[A-Za-z0-9._-]+\.db$/;

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
    autoPrint: {
      onTableOrderCreate: false,
      onTakeawayOrderCreate: false,
      onOrderAdjustment: false,
      onPaymentComplete: false,
      onTableClose: false,
      onTakeawayComplete: false,
    },
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
    autoPrint: { ...(base.autoPrint || {}), ...(parsed.autoPrint || {}) },
    skipPhoenixCmd:
      typeof parsed.skipPhoenixCmd === 'boolean' ? parsed.skipPhoenixCmd : base.skipPhoenixCmd,
    encodingMode: parsed.encodingMode === 'pc857' ? 'pc857' : base.encodingMode,
    roles: { ...base.roles, ...(parsed.roles || {}) },
    kitchenGroups: { ...base.kitchenGroups, ...(parsed.kitchenGroups || {}) },
    output: { ...base.output, ...(parsed.output || {}) },
    template: {
      ...base.template,
      ...(parsed.template && typeof parsed.template === 'object' ? parsed.template : {}),
      enabled: false,
    },
  };
  // Preserve printer hardware/encoding overrides
  if (parsed.escT != null) merged.escT = parsed.escT;
  if (parsed.skipInit) merged.skipInit = true;
  if (parsed.skipPhoenixCmd) merged.skipPhoenixCmd = true;
  if (parsed.encodingMode === 'pc857' || parsed.encodingMode === 'win1254') {
    merged.encodingMode = parsed.encodingMode;
  }
  if (merged.encodingMode === 'win1254') merged.skipPhoenixCmd = true;
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
    autoPrint: { ...(base.autoPrint || {}), ...(incomingObj.autoPrint || {}) },
    skipPhoenixCmd:
      typeof incomingObj.skipPhoenixCmd === 'boolean' ? incomingObj.skipPhoenixCmd : base.skipPhoenixCmd,
    encodingMode: incomingObj.encodingMode === 'pc857' ? 'pc857' : base.encodingMode,
    roles: { ...base.roles, ...(incomingObj.roles || {}) },
    kitchenGroups: { ...base.kitchenGroups, ...(incomingObj.kitchenGroups || {}) },
    output: { ...base.output, ...(incomingObj.output || {}) },
    template: {
      ...base.template,
      ...(incomingObj.template && typeof incomingObj.template === 'object' ? incomingObj.template : {}),
      enabled: false,
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
  if (out.encodingMode === 'win1254') out.skipPhoenixCmd = true;
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

/** Kalıcı silme öncesi: yalnız bekleyen iş varsa engelle; varsayılan/routing bilgi amaçlı gösterilir. */
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

  const canHardDelete = true;

  return {
    canHardDelete,
    blockers,
    usage: {
      isDefault,
      routingCount,
      pendingJobs,
      totalJobs,
    },
  };
}

function getPrintJobSummary(businessId) {
  const rows = db
    .prepare(`SELECT status, COUNT(*) AS count FROM print_jobs WHERE business_id = ? GROUP BY status`)
    .all(businessId);
  const byStatus = { pending: 0, printed: 0, failed: 0, cancelled: 0 };
  for (const row of rows) {
    if (Object.prototype.hasOwnProperty.call(byStatus, row.status)) {
      byStatus[row.status] = Number(row.count) || 0;
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
      .get(businessId).c || 0;
  return { ...byStatus, stale_claimed: Number(staleClaimed) || 0 };
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

function latestBackupInfo() {
  const userDataPath = process.env.USER_DATA_PATH || '';
  if (!userDataPath) {
    return {
      configured: false,
      latest: null,
      message: 'Electron kullanıcı veri klasörü bulunamadı',
    };
  }

  const backupsDir = path.join(userDataPath, 'backups');
  if (!fs.existsSync(backupsDir)) {
    return {
      configured: true,
      latest: null,
      message: 'Henüz yedek alınmamış',
      backupsDir,
    };
  }

  const files = fs
    .readdirSync(backupsDir)
    .filter((name) => /^pos-\d{4}-\d{2}-\d{2}\.db$/.test(name))
    .map((name) => {
      const fullPath = path.join(backupsDir, name);
      const stat = fs.statSync(fullPath);
      return {
        name,
        path: fullPath,
        size: stat.size,
        modified_at: stat.mtime.toISOString(),
      };
    })
    .sort((a, b) => String(b.modified_at).localeCompare(String(a.modified_at)));

  return {
    configured: true,
    latest: files[0] || null,
    message: files[0] ? 'Yedek klasörü hazır' : 'Henüz yedek alınmamış',
    backupsDir,
  };
}

function getUserDataPath() {
  return process.env.USER_DATA_PATH || '';
}

function getBackupsDir() {
  const userDataPath = getUserDataPath();
  return userDataPath ? path.join(userDataPath, 'backups') : '';
}

function getRestoreRequestPath() {
  const userDataPath = getUserDataPath();
  return userDataPath ? path.join(userDataPath, RESTORE_REQUEST_FILE) : '';
}

function ensureBackupsDir() {
  const backupsDir = getBackupsDir();
  if (!backupsDir) {
    const err = new Error('Electron kullanıcı veri klasörü bulunamadı');
    err.status = 503;
    throw err;
  }
  fs.mkdirSync(backupsDir, { recursive: true });
  return backupsDir;
}

function safeBackupFileName(value) {
  const fileName = path.basename(String(value || '').trim());
  if (!BACKUP_FILE_RE.test(fileName)) return null;
  return fileName;
}

function verifySqliteFile(filePath) {
  const backupDb = new Database(filePath, { readonly: true, fileMustExist: true });
  try {
    const result = backupDb.pragma('integrity_check', { simple: true });
    if (result !== 'ok') {
      const err = new Error(`Yedek doğrulaması başarısız: ${result}`);
      err.status = 422;
      throw err;
    }
  } finally {
    backupDb.close();
  }
}

function readBackupMeta(backupsDir, dbFileName) {
  const metaName = dbFileName.replace(/\.db$/, '.meta.json');
  const metaPath = path.join(backupsDir, metaName);
  if (!fs.existsSync(metaPath)) return null;
  try {
    return JSON.parse(fs.readFileSync(metaPath, 'utf8'));
  } catch {
    return null;
  }
}

function listBackupFiles() {
  const backupsDir = getBackupsDir();
  if (!backupsDir || !fs.existsSync(backupsDir)) return [];
  return fs
    .readdirSync(backupsDir)
    .filter((name) => BACKUP_FILE_RE.test(name))
    .map((name) => {
      const fullPath = path.join(backupsDir, name);
      const stat = fs.statSync(fullPath);
      return {
        id: name,
        name,
        size: stat.size,
        modified_at: stat.mtime.toISOString(),
        kind: name.startsWith('pos-manual-') ? 'manual' : name.startsWith('restore-safety-') ? 'safety' : 'auto',
        meta: readBackupMeta(backupsDir, name),
        hasConfigBackup: fs.existsSync(path.join(backupsDir, name.replace(/\.db$/, '.config.json'))),
      };
    })
    .sort((a, b) => String(b.modified_at).localeCompare(String(a.modified_at)));
}

function readRestoreRequest() {
  const restorePath = getRestoreRequestPath();
  if (!restorePath || !fs.existsSync(restorePath)) return null;
  try {
    const parsed = JSON.parse(fs.readFileSync(restorePath, 'utf8'));
    if (!parsed?.backupFile) return null;
    return parsed;
  } catch {
    return null;
  }
}

async function createManualBackup() {
  const backupsDir = ensureBackupsDir();
  if (!config.db?.path || !fs.existsSync(config.db.path)) {
    const err = new Error('Aktif veritabanı dosyası bulunamadı');
    err.status = 503;
    throw err;
  }

  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const fileName = `pos-manual-${stamp}.db`;
  const backupPath = path.join(backupsDir, fileName);
  const tempPath = `${backupPath}.tmp-${process.pid}`;
  const liveDb = new Database(config.db.path, { readonly: true, fileMustExist: true });
  try {
    await liveDb.backup(tempPath);
    verifySqliteFile(tempPath);
    fs.renameSync(tempPath, backupPath);
  } finally {
    liveDb.close();
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        /* ignore cleanup failure */
      }
    }
  }

  // Manuel yedek için sidecar meta dosyası yaz
  try {
    const metaDb = new Database(backupPath, { readonly: true, fileMustExist: true });
    let schemaVersion = 0, rowCounts = {}, integrityResult = 'unknown';
    try {
      schemaVersion = metaDb.pragma('user_version', { simple: true });
      integrityResult = metaDb.pragma('integrity_check', { simple: true });
      rowCounts = {
        orders: metaDb.prepare('SELECT COUNT(*) AS c FROM orders').get()?.c ?? 0,
        payments: metaDb.prepare('SELECT COUNT(*) AS c FROM payments').get()?.c ?? 0,
        customers: metaDb.prepare('SELECT COUNT(*) AS c FROM customers').get()?.c ?? 0,
      };
    } finally {
      metaDb.close();
    }
    let sha256 = null;
    try {
      const { createHash } = await import('crypto');
      const hash = createHash('sha256');
      hash.update(fs.readFileSync(backupPath));
      sha256 = hash.digest('hex');
    } catch { /* ignore */ }

    const metaPath = path.join(backupsDir, fileName.replace(/\.db$/, '.meta.json'));
    fs.writeFileSync(metaPath, JSON.stringify({
      appVersion: process.env.APP_VERSION || 'unknown',
      schemaVersion,
      createdAt: new Date().toISOString(),
      type: 'manual',
      rowCounts,
      integrityCheck: integrityResult,
      dbSizeBytes: fs.statSync(backupPath).size,
      sha256,
    }, null, 2), 'utf8');
  } catch (metaErr) {
    console.warn('[admin:backup:manual] Meta dosyası yazılamadı (kritik değil):', metaErr?.message);
  }

  return listBackupFiles().find((b) => b.id === fileName) || { id: fileName, name: fileName };
}

function writeRestoreRequest({ businessId, userId, backupId }) {
  const fileName = safeBackupFileName(backupId);
  if (!fileName) {
    const err = new Error('Geçersiz yedek dosyası');
    err.status = 400;
    throw err;
  }

  const backupsDir = ensureBackupsDir();
  const backupPath = path.join(backupsDir, fileName);
  if (!fs.existsSync(backupPath)) {
    const err = new Error('Yedek dosyası bulunamadı');
    err.status = 404;
    throw err;
  }

  verifySqliteFile(backupPath);

  const restorePath = getRestoreRequestPath();
  const request = {
    backupFile: fileName,
    requestedAt: new Date().toISOString(),
    requestedBy: userId,
    businessId,
  };
  fs.writeFileSync(restorePath, JSON.stringify(request, null, 2), 'utf8');
  return request;
}

function readinessStatus({ ok, warning = false }) {
  if (ok) return 'ok';
  return warning ? 'warning' : 'blocker';
}

function buildDesktopReadiness(businessId) {
  const business = db
    .prepare(
      `SELECT id, name, address, tax_id, phone, receipt_header, receipt_footer
       FROM businesses WHERE id = ?`,
    )
    .get(businessId);
  const settings = getJsonSetting(businessId, 'app.setup', {});
  const printerConfig = getJsonSetting(businessId, 'printer.config', {});

  const counts = {
    activeAdmins:
      db
        .prepare(
          `SELECT COUNT(*) AS c
           FROM users u
           JOIN roles r ON r.id = u.role_id
           WHERE u.business_id = ? AND u.is_active = 1 AND r.slug = 'admin'`,
        )
        .get(businessId).c || 0,
    activeUsers:
      db.prepare(`SELECT COUNT(*) AS c FROM users WHERE business_id = ? AND is_active = 1`).get(businessId).c || 0,
    activeAreas:
      db
        .prepare(`SELECT COUNT(*) AS c FROM dining_areas WHERE business_id = ? AND is_active = 1`)
        .get(businessId).c || 0,
    activeTables:
      db.prepare(`SELECT COUNT(*) AS c FROM tables WHERE business_id = ? AND is_active = 1`).get(businessId).c || 0,
    activeCategories:
      db
        .prepare(`SELECT COUNT(*) AS c FROM categories WHERE business_id = ? AND is_active = 1`)
        .get(businessId).c || 0,
    activeProducts:
      db.prepare(`SELECT COUNT(*) AS c FROM products WHERE business_id = ? AND is_active = 1`).get(businessId).c || 0,
    activePrinters:
      db.prepare(`SELECT COUNT(*) AS c FROM printers WHERE business_id = ? AND is_active = 1`).get(businessId).c || 0,
    receiptPrinters:
      db
        .prepare(`SELECT COUNT(*) AS c FROM printers WHERE business_id = ? AND is_active = 1 AND type = 'receipt'`)
        .get(businessId).c || 0,
    kitchenPrinters:
      db
        .prepare(`SELECT COUNT(*) AS c FROM printers WHERE business_id = ? AND is_active = 1 AND type = 'kitchen'`)
        .get(businessId).c || 0,
  };

  const configuredReceiptPrinter =
    printerConfig.defaultPrinterId || printerConfig.usagePaymentId || null;
  const configuredKitchenPrinter =
    printerConfig.takeawayLabelPrinterId || printerConfig.usageKitchenId || null;
  const configuredReceiptOk =
    !!configuredReceiptPrinter &&
    !!db
      .prepare(`SELECT 1 FROM printers WHERE id = ? AND business_id = ? AND is_active = 1 AND type = 'receipt'`)
      .get(configuredReceiptPrinter, businessId);
  const configuredKitchenOk =
    !!configuredKitchenPrinter &&
    !!db
      .prepare(`SELECT 1 FROM printers WHERE id = ? AND business_id = ? AND is_active = 1 AND type = 'kitchen'`)
      .get(configuredKitchenPrinter, businessId);

  const backup = latestBackupInfo();
  const bridgeCache = getJsonSetting(businessId, DISCOVERY_CACHE_KEY, null);
  const bridgeReady =
    bridgeCache?.scanState === 'success' ||
    (Array.isArray(bridgeCache?.printers) && bridgeCache.printers.length > 0);

  const checks = [
    {
      key: 'business',
      title: 'İşletme bilgileri',
      status: readinessStatus({ ok: !!business?.name && !!business?.tax_id }),
      message:
        business?.name && business?.tax_id
          ? 'İşletme adı ve vergi bilgisi hazır'
          : 'İşletme adı ve vergi numarası tamamlanmalı',
      action: '/settings/business',
    },
    {
      key: 'users',
      title: 'Yönetici kullanıcı',
      status: readinessStatus({ ok: counts.activeAdmins >= 1 }),
      message:
        counts.activeAdmins >= 1
          ? `${counts.activeAdmins} aktif yönetici var`
          : 'En az bir aktif yönetici kullanıcısı gerekli',
      action: '/settings/users',
    },
    {
      key: 'tables',
      title: 'Salon ve masa düzeni',
      status: readinessStatus({ ok: counts.activeAreas >= 1 && counts.activeTables >= 1 }),
      message:
        counts.activeAreas >= 1 && counts.activeTables >= 1
          ? `${counts.activeAreas} bölge, ${counts.activeTables} aktif masa hazır`
          : 'En az bir bölge ve bir aktif masa gerekli',
      action: '/settings/dining-areas',
    },
    {
      key: 'menu',
      title: 'Menü ve ürünler',
      status: readinessStatus({ ok: counts.activeCategories >= 1 && counts.activeProducts >= 1 }),
      message:
        counts.activeCategories >= 1 && counts.activeProducts >= 1
          ? `${counts.activeCategories} kategori, ${counts.activeProducts} aktif ürün hazır`
          : 'Sipariş alabilmek için en az bir kategori ve ürün gerekli',
      action: '/settings/menu',
    },
    {
      key: 'receipt_printer',
      title: 'Kasa fişi yazıcısı',
      status: readinessStatus({ ok: counts.receiptPrinters >= 1 && configuredReceiptOk, warning: true }),
      message:
        counts.receiptPrinters >= 1 && configuredReceiptOk
          ? 'Aktif kasa fişi yazıcısı seçilmiş'
          : 'Aktif bir kasa fişi yazıcısı seçilmeli',
      action: '/settings/printers',
    },
    {
      key: 'kitchen_printer',
      title: 'Mutfak yazıcısı',
      status: readinessStatus({ ok: counts.kitchenPrinters >= 1 && configuredKitchenOk, warning: true }),
      message:
        counts.kitchenPrinters >= 1 && configuredKitchenOk
          ? 'Aktif mutfak yazıcısı seçilmiş'
          : 'Mutfak akışı için aktif bir mutfak yazıcısı seçilmeli',
      action: '/settings/printers',
    },
    {
      key: 'backup',
      title: 'Yerel yedekleme',
      status: readinessStatus({ ok: backup.configured && !!backup.latest, warning: true }),
      message: backup.latest
        ? `Son yedek: ${backup.latest.name}`
        : backup.message || 'Yedek durumu doğrulanamadı',
      action: null,
    },
    {
      key: 'storebridge',
      title: 'StoreBridge yazıcı servisi',
      status: readinessStatus({ ok: bridgeReady, warning: true }),
      message: bridgeReady
        ? 'Yazıcı tarama verisi alındı'
        : discoveryMessageForState(bridgeCache?.scanState) || 'StoreBridge taraması henüz doğrulanmadı',
      action: '/settings/printers',
    },
  ];

  const blockerCount = checks.filter((c) => c.status === 'blocker').length;
  const warningCount = checks.filter((c) => c.status === 'warning').length;

  return {
    completed: !!settings.completedAt,
    completed_at: settings.completedAt || null,
    completed_by: settings.completedBy || null,
    ready: blockerCount === 0,
    blockerCount,
    warningCount,
    checks,
    counts,
    backup,
  };
}

function getBridgeLogPathCandidates() {
  const userDataPath = getUserDataPath();
  if (!userDataPath) return [];
  const logsDir = path.join(userDataPath, 'logs');
  return [
    { path: path.join(logsDir, 'store-bridge.log'), source: 'store-bridge' },
    { path: path.join(logsDir, 'electron-main.log'), source: 'electron-main' },
  ];
}

function readLogTail({ filePath, source, limit = 200 }) {
  if (!filePath || !fs.existsSync(filePath)) {
    return { source, file: path.basename(filePath || ''), exists: false, lines: [] };
  }
  const raw = fs.readFileSync(filePath, 'utf8');
  const allLines = raw.split(/\r?\n/);
  const filtered = source === 'electron-main'
    ? allLines.filter((line) => line.includes('[store-bridge]'))
    : allLines;
  const token = String(config.bridge?.token || '').trim();
  const lines = filtered
    .map((line) => (token ? line.replaceAll(token, '***') : line))
    .filter(Boolean)
    .slice(-limit);
  return {
    source,
    file: path.basename(filePath),
    exists: true,
    lines,
  };
}

function buildStoreBridgeHealth(businessId) {
  const discovery = getJsonSetting(businessId, DISCOVERY_CACHE_KEY, null);
  const queueSummary = getPrintJobSummary(businessId);
  const printerConfig = getJsonSetting(businessId, 'printer.config', {});
  const configuredPrinters = db
    .prepare(
      `SELECT id, type, is_active, print_options
       FROM printers
       WHERE business_id = ?
         AND is_active = 1
         AND type IN ('receipt', 'kitchen')`,
    )
    .all(businessId)
    .map((row) => mapPrinterRow(row));
  const discoveredNames = new Set(
    (Array.isArray(discovery?.printers) ? discovery.printers : [])
      .map((printer) => String(printer?.name || '').trim().toLowerCase())
      .filter(Boolean),
  );
  const selectedPhysicalNames = configuredPrinters
    .map((printer) => ({
      type: printer.type,
      physicalName: String(printer?.print_options?.device?.physicalName || '').trim(),
    }))
    .filter((item) => item.physicalName);
  const missingConfiguredPhysical = selectedPhysicalNames.filter(
    (item) => discoveredNames.size > 0 && !discoveredNames.has(item.physicalName.toLowerCase()),
  );
  const latestFailedJob = db
    .prepare(
      `SELECT id, printer_id, error_message, last_error_code, created_at, last_attempt_at
       FROM print_jobs
       WHERE business_id = ? AND status = 'failed'
       ORDER BY datetime(COALESCE(last_attempt_at, created_at)) DESC
       LIMIT 1`,
    )
    .get(businessId);
  const latestJob = db
    .prepare(
      `SELECT id, status, created_at, printed_at, last_attempt_at, last_error_code
       FROM print_jobs
       WHERE business_id = ?
       ORDER BY datetime(COALESCE(last_attempt_at, printed_at, created_at)) DESC
       LIMIT 1`,
    )
    .get(businessId);
  const bridgeConfigured = !!config.bridge?.token && !!config.bridge?.businessId;
  const scanState = resolveDiscoveryState(discovery, Array.isArray(discovery?.printers) ? discovery.printers : []);

  let status = 'ok';
  let message = 'StoreBridge görünümü sağlıklı.';
  if (!bridgeConfigured) {
    status = 'unconfigured';
    message = 'Bridge yapılandırması eksik.';
  } else if (scanState === 'bridge_unreachable' || scanState === 'auth_error') {
    status = 'down';
    message = discoveryMessageForState(scanState) || 'StoreBridge servisine ulaşılamadı.';
  } else if (
    scanState === 'never_scanned' ||
    scanState === 'scanning' ||
    queueSummary.failed > 0 ||
    queueSummary.stale_claimed > 0 ||
    missingConfiguredPhysical.length > 0 ||
    scanState === 'empty'
  ) {
    status = 'degraded';
    message = latestFailedJob?.last_error_code
      ? `Son yazdırma hatası: ${latestFailedJob.last_error_code}`
      : discoveryMessageForState(scanState) || 'StoreBridge dikkat gerektiriyor.';
  }

  const lastSeenAt = discovery?.updatedAt || null;
  const logs = getBridgeLogPathCandidates().map(({ path: filePath, source }) => ({
    source,
    file: path.basename(filePath),
    exists: fs.existsSync(filePath),
  }));

  return {
    status,
    running: status === 'ok' || status === 'degraded',
    configured: bridgeConfigured,
    message,
    scanState,
    lastSeenAt,
    lastJobAt: latestJob?.created_at || null,
    lastAttemptAt: latestJob?.last_attempt_at || null,
    queueSummary,
    lastErrorCode: latestFailedJob?.last_error_code || discovery?.lastErrorCode || null,
    discovery: {
      available: Array.isArray(discovery?.printers) && discovery.printers.length > 0,
      updatedAt: discovery?.updatedAt || null,
      printerCount: Array.isArray(discovery?.printers) ? discovery.printers.length : 0,
      printers: Array.isArray(discovery?.printers) ? discovery.printers : [],
      lastErrorCode: discovery?.lastErrorCode || null,
    },
    selectedPrinters: {
      receiptPrinterId: printerConfig.defaultPrinterId || printerConfig.usagePaymentId || null,
      kitchenPrinterId: printerConfig.takeawayLabelPrinterId || printerConfig.usageKitchenId || null,
      missingConfiguredPhysical,
    },
    latestFailedJob: latestFailedJob || null,
    logs,
  };
}

router.get('/desktop-readiness', (req, res) => {
  try {
    res.json(buildDesktopReadiness(req.businessId));
  } catch (err) {
    console.error('[admin:desktop-readiness:get]', err);
    res.status(500).json({ error: 'Kurulum durumu alınamadı' });
  }
});

router.post('/desktop-readiness/complete', (req, res) => {
  try {
    const readiness = buildDesktopReadiness(req.businessId);
    if (!readiness.ready) {
      return res.status(409).json({
        error: 'Kurulum tamamlanmadan önce bloklayıcı eksikler giderilmeli',
        readiness,
      });
    }

    const setup = {
      completedAt: new Date().toISOString(),
      completedBy: req.user.id,
    };
    upsertSetting(req.businessId, 'app.setup', setup);
    auditLog(req.businessId, req.user.id, 'desktop_setup_complete', 'settings', 'app.setup', {
      warningCount: readiness.warningCount,
    });
    res.json({ ...buildDesktopReadiness(req.businessId), message: 'Kurulum kontrolü tamamlandı' });
  } catch (err) {
    console.error('[admin:desktop-readiness:complete]', err);
    res.status(500).json({ error: 'Kurulum tamamlanamadı' });
  }
});

router.get('/storebridge/health', (req, res) => {
  try {
    res.json(buildStoreBridgeHealth(req.businessId));
  } catch (err) {
    console.error('[admin:storebridge:health]', err);
    res.status(500).json({ error: 'StoreBridge sağlık durumu alınamadı' });
  }
});

router.get('/storebridge/logs', (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || '200', 10) || 200, 10), 1000);
    const candidates = getBridgeLogPathCandidates();
    const primary = candidates.find((candidate) => fs.existsSync(candidate.path)) || candidates[0];
    const log = readLogTail({ filePath: primary?.path, source: primary?.source || 'store-bridge', limit });
    res.json({
      source: log.source,
      file: log.file,
      exists: log.exists,
      lines: log.lines,
    });
  } catch (err) {
    console.error('[admin:storebridge:logs]', err);
    res.status(500).json({ error: 'StoreBridge logları alınamadı' });
  }
});

router.get('/maintenance/open-orders', (req, res) => {
  try {
    const row = db
      .prepare(
        `SELECT COUNT(*) AS c FROM orders
         WHERE business_id = ? AND status NOT IN (${ORDER_STATUSES_CLOSED.map(() => '?').join(',')})`,
      )
      .get(req.businessId, ...ORDER_STATUSES_CLOSED);
    res.json({ openOrderCount: row?.c ?? 0 });
  } catch (err) {
    console.error('[admin:maintenance:open-orders]', err);
    res.status(500).json({ error: 'Açık sipariş sayısı alınamadı' });
  }
});

router.get('/maintenance', (req, res) => {
  try {
    const backups = listBackupFiles();
    const latest = backups[0] || null;
    res.json({
      dbPath: config.db?.path || null,
      userDataPath: getUserDataPath() || null,
      backupsDir: getBackupsDir() || null,
      backups,
      latest,
      pendingRestore: readRestoreRequest(),
    });
  } catch (err) {
    console.error('[admin:maintenance:get]', err);
    res.status(500).json({ error: 'Bakım durumu alınamadı' });
  }
});

router.post('/maintenance/backups', async (req, res) => {
  try {
    const backup = await createManualBackup();
    auditLog(req.businessId, req.user.id, 'manual_backup_created', 'backup', backup.id);
    res.status(201).json({
      backup,
      backups: listBackupFiles(),
      message: 'Manuel yedek alındı',
    });
  } catch (err) {
    console.error('[admin:maintenance:backup]', err);
    res.status(err.status || 500).json({ error: err.message || 'Yedek alınamadı' });
  }
});

router.post('/maintenance/restore-request', (req, res) => {
  try {
    const request = writeRestoreRequest({
      businessId: req.businessId,
      userId: req.user.id,
      backupId: req.body?.backup_id,
    });
    auditLog(req.businessId, req.user.id, 'restore_requested', 'backup', request.backupFile);
    res.json({
      pendingRestore: request,
      message: 'Restore isteği kaydedildi. Uygulamayı yeniden başlatınca seçilen yedek uygulanacak.',
    });
  } catch (err) {
    console.error('[admin:maintenance:restore-request]', err);
    res.status(err.status || 500).json({ error: err.message || 'Restore isteği kaydedilemedi' });
  }
});

router.delete('/maintenance/restore-request', (req, res) => {
  try {
    const restorePath = getRestoreRequestPath();
    if (restorePath && fs.existsSync(restorePath)) {
      fs.unlinkSync(restorePath);
      auditLog(req.businessId, req.user.id, 'restore_request_cancelled', 'backup', 'restore-request');
    }
    res.json({ pendingRestore: null, message: 'Bekleyen restore isteği iptal edildi' });
  } catch (err) {
    console.error('[admin:maintenance:restore-cancel]', err);
    res.status(500).json({ error: 'Restore isteği iptal edilemedi' });
  }
});

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
    console.error('[admin:business:get]', err);
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
    console.error('[admin:business:update]', err);
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
    console.error('[admin:display-settings:update]', err);
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
    console.error('[admin:printer-settings:get]', err);
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
    console.error('[admin:printers:discovered]', err);
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
    console.error('[admin:printer-settings:update]', err);
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
    const lw = Number.isFinite(lwNum) && lwNum >= 32 && lwNum <= 42 ? lwNum : null;
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
    console.error('[admin:printers:create]', err);
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
    console.error('[admin] Yazıcı önizleme hatası:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.get('/printers/:id/delete-eligibility', (req, res) => {
  try {
    const el = getPrinterDeleteEligibility(req.businessId, req.params.id);
    if (!el) return res.status(404).json({ error: 'Yazıcı bulunamadı' });
    res.json(el);
  } catch (err) {
    console.error('[admin:printers:eligibility]', err);
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
    console.error('[admin:printers:get]', err);
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
      ? (Number.isFinite(lwNum) && lwNum >= 32 && lwNum <= 42 ? lwNum : null)
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
    console.error('[admin:printers:update]', err);
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
      db.prepare(`DELETE FROM print_jobs WHERE business_id = ? AND printer_id = ? AND status = 'pending'`).run(
        req.businessId,
        req.params.id,
      );
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
    console.error('[admin:printers:delete]', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.get('/print-jobs', (req, res) => {
  try {
    const limit = Math.min(Math.max(parseInt(req.query.limit || '30', 10) || 30, 1), 100);
    const jobs = db
      .prepare(
        `SELECT id, order_id, printer_id, job_type, status, error_message, idempotency_key, created_at, printed_at,
                claimed_at, claimed_by, claimed_until, attempt_count, last_attempt_at, last_error_code, payload
         FROM print_jobs WHERE business_id = ? ORDER BY datetime(created_at) DESC LIMIT ?`,
      )
      .all(req.businessId, limit);
    res.json({ jobs, summary: getPrintJobSummary(req.businessId) });
  } catch (err) {
    console.error('[admin:print-jobs:list]', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

router.post('/print-jobs/:id/retry', (req, res) => {
  try {
    const job = db
      .prepare(`SELECT * FROM print_jobs WHERE id = ? AND business_id = ?`)
      .get(req.params.id, req.businessId);
    if (!job) return res.status(404).json({ error: 'Yazdırma işi bulunamadı' });
    if (job.status !== 'failed') {
      return res.status(409).json({
        error: 'Yalnızca başarısız yazdırma işleri yeniden kuyruğa alınabilir',
        status: job.status,
      });
    }

    db.prepare(
      `UPDATE print_jobs
       SET status = 'pending',
           error_message = NULL,
           last_error_code = NULL,
           claimed_at = NULL,
           claimed_by = NULL,
           claimed_until = NULL,
           printed_at = NULL
       WHERE id = ? AND business_id = ?`,
    ).run(req.params.id, req.businessId);

    auditLog(req.businessId, req.user.id, 'print_job_retry', 'print_job', req.params.id, {
      previous_error_code: job.last_error_code || null,
      attempt_count: Number(job.attempt_count) || 0,
    });

    const updated = db.prepare(`SELECT * FROM print_jobs WHERE id = ? AND business_id = ?`).get(req.params.id, req.businessId);
    res.json({ job: updated, message: 'Yazdırma işi yeniden kuyruğa alındı' });
  } catch (err) {
    console.error('[admin:print-jobs:retry]', err);
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
    console.error('[admin:printer-routing:get]', err);
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
    console.error('[admin:printer-routing:update]', err);
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
    console.error('[admin:printers:test]', err);
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
    console.error('[admin:users:list]', err);
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
    console.error('[admin:users:create]', err);
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
    // Şifre güncelleme: verilmişse uzunluk kontrolü yap
    if (password !== undefined && password !== null) {
      const pwStr = String(password).trim();
      if (pwStr.length > 0 && pwStr.length < 4) {
        return res.status(400).json({ error: 'Şifre en az 4 karakter olmalıdır' });
      }
    }
    const hash = password && String(password).trim().length > 0 ? bcryptjs.hashSync(String(password).trim(), 10) : null;
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
    console.error('[admin:users:delete]', err);
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
    console.error('[admin:dining-areas:list]', err);
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
    console.error('[admin:dining-areas:list]', err);
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
    console.error('[admin:dining-areas:update]', err);
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
    console.error('[admin:dining-areas:delete]', err);
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
    console.error('[admin:dining-areas:sync-tables]', err);
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
    console.error('[admin:dining-areas:sync-tables]', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// ── Support Bundle ──────────────────────────────────────────────────────────
// GET /admin/support-bundle
// Returns a JSON payload with system info, print queue summary, last failed
// jobs, recent audit log, backup summary and log tails — suitable for
// attaching to a support ticket or exporting from the maintenance UI.
router.get('/support-bundle', (req, res) => {
  try {
    const userDataPath = getUserDataPath();
    const dbPath = config.db?.path || null;
    const backupsDir = getBackupsDir();

    // DB file size
    let dbSizeBytes = null;
    try {
      if (dbPath && fs.existsSync(dbPath)) dbSizeBytes = fs.statSync(dbPath).size;
    } catch { /* ignore */ }

    // Print queue counts + last 5 failed jobs
    const queueSummary = getPrintJobSummary(req.businessId);
    const recentFailedJobs = db
      .prepare(
        `SELECT id, printer_id, status, last_error_code, error_message,
                created_at, last_attempt_at, attempt_count
         FROM print_jobs
         WHERE business_id = ? AND status = 'failed'
         ORDER BY datetime(COALESCE(last_attempt_at, created_at)) DESC
         LIMIT 10`,
      )
      .all(req.businessId);

    // Recent audit log (last 30 entries)
    const recentAudit = db
      .prepare(
        `SELECT action, entity_type, entity_id, created_at
         FROM audit_logs
         WHERE business_id = ?
         ORDER BY id DESC
         LIMIT 30`,
      )
      .all(req.businessId);

    // Backup summary
    const backups = listBackupFiles();
    const latestBackup = backups[0] || null;

    // Bridge health
    const bridgeHealth = buildStoreBridgeHealth(req.businessId);

    // Log tails — electron-main (full, last 100 lines) + store-bridge (last 150 lines)
    const logsDir = userDataPath ? path.join(userDataPath, 'logs') : null;
    const token = String(config.bridge?.token || '').trim();

    function readRawTail(filePath, limit) {
      if (!filePath || !fs.existsSync(filePath)) return { exists: false, lines: [] };
      const raw = fs.readFileSync(filePath, 'utf8');
      const lines = raw
        .split(/\r?\n/)
        .map((l) => (token ? l.replaceAll(token, '***') : l))
        .filter(Boolean)
        .slice(-limit);
      return { exists: true, lines };
    }

    const electronLog = logsDir
      ? readRawTail(path.join(logsDir, 'electron-main.log'), 100)
      : { exists: false, lines: [] };
    const bridgeLog = logsDir
      ? readRawTail(path.join(logsDir, 'store-bridge.log'), 150)
      : { exists: false, lines: [] };

    res.json({
      generatedAt: new Date().toISOString(),
      system: {
        nodeVersion: process.version,
        platform: process.platform,
        arch: process.arch,
        userDataPath: userDataPath || null,
        dbPath,
        dbSizeBytes,
        backupsDir: backupsDir || null,
        backupCount: backups.length,
        latestBackup: latestBackup
          ? { name: latestBackup.name, modified_at: latestBackup.modified_at, size: latestBackup.size }
          : null,
      },
      bridge: {
        status: bridgeHealth.status,
        message: bridgeHealth.message,
        scanState: bridgeHealth.scanState,
        lastSeenAt: bridgeHealth.lastSeenAt,
        lastErrorCode: bridgeHealth.lastErrorCode,
        discoveredPrinters: bridgeHealth.discovery?.printerCount ?? 0,
      },
      printQueue: {
        summary: queueSummary,
        recentFailedJobs,
      },
      recentAudit,
      logs: {
        electronMain: electronLog,
        storeBridge: bridgeLog,
      },
    });
  } catch (err) {
    console.error('[admin:support-bundle]', err);
    res.status(500).json({ error: 'Destek paketi oluşturulamadı' });
  }
});

export default router;
