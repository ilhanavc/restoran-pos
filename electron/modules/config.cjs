const { app } = require('electron');
const path = require('path');
const fs = require('fs');

const DEFAULT_PORT = 3001;
const PLACEHOLDER_JWT = 'GIZLI_JWT_ANAHTARI_BURAYA_DEGISTIRIN';

let posConfig = {};

function getPosConfigPath() {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'pos-config.json')
    : path.join(__dirname, '..', '..', 'pos-config.json');
}

function readPosConfig() {
  const cfgPath = getPosConfigPath();
  console.log('[electron] pos-config.json aranıyor:', cfgPath);
  if (!fs.existsSync(cfgPath)) return {};
  try {
    const raw = fs.readFileSync(cfgPath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[electron] pos-config.json okunamadı:', e?.message || String(e));
    return {};
  }
}

function loadPosConfig() {
  posConfig = readPosConfig();
  if (Object.keys(posConfig).length) {
    console.log('[electron] pos-config.json yüklendi');
  }
  return posConfig;
}

function getPosConfig() {
  return posConfig;
}

function getCloudServerUrl() {
  const raw = posConfig.cloudServerUrl || process.env.CLOUD_SERVER_URL || process.env.POS_CLOUD_SERVER_URL;
  if (!raw || typeof raw !== 'string') return null;
  const trimmed = raw.trim().replace(/\/$/, '');
  return trimmed || null;
}

function ensureJwtSecret() {
  const isPlaceholder = !posConfig.jwtSecret || posConfig.jwtSecret === PLACEHOLDER_JWT;
  if (!isPlaceholder) return;

  const secret = require('crypto').randomBytes(64).toString('hex');
  posConfig.jwtSecret = secret;
  console.log('[electron] JWT secret üretildi, pos-config.json\'a kalıcı olarak kaydediliyor');

  const cfgPath = getPosConfigPath();
  try {
    let cfg = {};
    if (fs.existsSync(cfgPath)) {
      try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (_) { /* bozuk JSON */ }
    }
    cfg.jwtSecret = secret;
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
    console.log('[electron] JWT secret dosyaya yazıldı:', cfgPath);
  } catch (e) {
    console.warn('[electron] JWT secret dosyaya yazılamadı (bellek içi kullanılacak):', e?.message || String(e));
  }
}

function getCodeRoot() {
  if (app.isPackaged) return app.getAppPath();
  return path.join(__dirname, '..', '..');
}

function getPackagedServerRoot() {
  return path.join(process.resourcesPath, 'server');
}

function getStoreBridgeRoot() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'store-bridge');
  return path.join(getCodeRoot(), 'store-bridge');
}

function getToolsRoot() {
  if (app.isPackaged) return path.join(process.resourcesPath, 'tools');
  return path.join(getCodeRoot(), 'tools');
}

function getServerEntryPath() {
  if (app.isPackaged) return path.join(getPackagedServerRoot(), 'index.js');
  return path.join(getCodeRoot(), 'server', 'index.js');
}

function getServerSpawnCwd() {
  if (app.isPackaged) return getPackagedServerRoot();
  return getCodeRoot();
}

function getTargetPort() {
  if (posConfig.port && Number.isInteger(posConfig.port)) return posConfig.port;
  const p = process.env.POS_PORT || process.env.PORT || String(DEFAULT_PORT);
  return parseInt(String(p), 10);
}

function buildChildEnv(port, absoluteDbPath, codeRoot) {
  const env = { ...process.env };
  env.NODE_ENV = 'production';
  env.PORT = String(port);
  env.DB_PATH = absoluteDbPath;
  env.USER_DATA_PATH = app.getPath('userData');
  env.APP_VERSION = app.getVersion();
  const dist = path.join(codeRoot, 'client', 'dist');
  if (!env.CLIENT_DIST_PATH) env.CLIENT_DIST_PATH = dist;
  env.JWT_SECRET =
    (posConfig.jwtSecret ? String(posConfig.jwtSecret) : null) ||
    process.env.JWT_SECRET ||
    require('crypto').randomBytes(64).toString('hex');
  const b = posConfig.bridge || {};
  if (b.token) env.BRIDGE_TOKEN = String(b.token);
  if (b.businessId != null) env.BRIDGE_BUSINESS_ID = String(b.businessId);
  console.log('[electron] buildChildEnv: BRIDGE_TOKEN =', env.BRIDGE_TOKEN ? '***' : '(tanımsız)');
  console.log('[electron] buildChildEnv: BRIDGE_BUSINESS_ID =', env.BRIDGE_BUSINESS_ID || '(tanımsız)');
  if (b.disablePrintJobMock != null) {
    env.DISABLE_PRINT_JOB_MOCK = b.disablePrintJobMock ? '1' : '0';
  }
  const corsOrigins = posConfig.corsOrigins;
  if (Array.isArray(corsOrigins) && corsOrigins.length) {
    env.CORS_ORIGINS = corsOrigins.join(',');
  } else if (typeof corsOrigins === 'string' && corsOrigins) {
    env.CORS_ORIGINS = corsOrigins;
  }
  return env;
}

function buildBridgeEnv(port, apiBaseUrl = null) {
  const env = { ...process.env };
  env.NODE_ENV = 'production';
  env.API_BASE = apiBaseUrl
    ? `${String(apiBaseUrl).replace(/\/$/, '')}/api`
    : `http://127.0.0.1:${port}/api`;

  const b = posConfig.bridge || {};
  if (b.token) env.BRIDGE_TOKEN = String(b.token);
  if (b.businessId != null) env.BRIDGE_BUSINESS_ID = String(b.businessId);
  if (b.dryRun != null) env.BRIDGE_DRY_RUN = b.dryRun ? '1' : '0';
  if (b.pollIntervalMs != null) env.POLL_INTERVAL_MS = String(b.pollIntervalMs);
  if (b.apiTimeoutMs != null) env.BRIDGE_API_TIMEOUT_MS = String(b.apiTimeoutMs);
  if (b.healthRetryMs != null) env.BRIDGE_HEALTH_RETRY_MS = String(b.healthRetryMs);
  if (b.claimId) env.BRIDGE_CLAIM_ID = String(b.claimId);
  if (b.socketTimeoutMs != null) env.PRINT_SOCKET_TIMEOUT_MS = String(b.socketTimeoutMs);
  if (b.printEscT != null) env.BRIDGE_PRINT_ESC_T = String(b.printEscT);
  if (b.printEncodingMode) env.BRIDGE_PRINT_ENCODING_MODE = String(b.printEncodingMode);

  const c = posConfig.callerid || {};
  if (c.enabled != null) env.CID812_ENABLED = c.enabled ? '1' : '0';
  if (c.mode) env.CID812_MODE = String(c.mode);
  if (c.debounceMs != null) env.CID812_DEBOUNCE_MS = String(c.debounceMs);
  if (c.postRetryAttempts != null) env.CID812_POST_RETRY_ATTEMPTS = String(c.postRetryAttempts);
  if (c.postRetryMs != null) env.CID812_POST_RETRY_MS = String(c.postRetryMs);
  if (c.postQueueMax != null) env.CID812_POST_QUEUE_MAX = String(c.postQueueMax);
  if (c.enableParse != null) env.CID812_ENABLE_PARSE = c.enableParse ? '1' : '0';
  if (c.phoneRegex) env.CID812_PHONE_REGEX = String(c.phoneRegex);

  const h = c.hid || {};
  if (h.vid) env.CID812_HID_VID = String(h.vid);
  if (h.pid) env.CID812_HID_PID = String(h.pid);
  if (h.serial != null) env.CID812_HID_SERIAL = String(h.serial);
  if (h.reconnectIntervalMs != null) env.CID812_RECONNECT_INTERVAL_MS = String(h.reconnectIntervalMs);

  return env;
}

module.exports = {
  getPosConfigPath, readPosConfig, loadPosConfig, getPosConfig, getCloudServerUrl, ensureJwtSecret,
  getCodeRoot, getPackagedServerRoot, getStoreBridgeRoot, getToolsRoot,
  getServerEntryPath, getServerSpawnCwd, getTargetPort,
  buildChildEnv, buildBridgeEnv,
};
