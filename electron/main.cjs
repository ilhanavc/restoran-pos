/**
 * Electron main: child process'te Express (server/index.js), BrowserWindow ile http://127.0.0.1:PORT
 * Express kodu Electron içine gömülmez; file:// kullanılmaz.
 * pos-config.json mevcutsa ayarlar oradan okunur; Store Bridge otomatik başlatılır.
 */
const { app, BrowserWindow, dialog } = require('electron');
const { spawn } = require('child_process');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const PROJECT_ROOT = path.join(__dirname, '..');
const SERVER_ENTRY = path.join(PROJECT_ROOT, 'server', 'index.js');
const BRIDGE_ENTRY = path.join(PROJECT_ROOT, 'store-bridge', 'index.js');
const POS_CONFIG_PATH = path.join(PROJECT_ROOT, 'pos-config.json');
/** Eski (proje altı) SQLite — yalnızca Electron ilk açılışında userData boşsa tek seferlik kopya kaynağı */
const LEGACY_DB_MAIN = path.join(PROJECT_ROOT, 'server', 'data', 'pos.db');
const DEFAULT_PORT = 3001;
const HEALTH_HOST = '127.0.0.1';
const HEALTH_PATH = '/api/health';
const HEALTH_TIMEOUT_MS = 45000;
const HEALTH_INTERVAL_MS = 200;
const KILL_FORCE_MS = 4000;

/** @type {import('child_process').ChildProcessWithoutNullStreams | null} */
let serverProcess = null;
/** @type {import('child_process').ChildProcessWithoutNullStreams | null} */
let bridgeProcess = null;
/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {Record<string, unknown>} */
let posConfig = {};

// ---------------------------------------------------------------------------
// pos-config.json
// ---------------------------------------------------------------------------

function readPosConfig() {
  if (!fs.existsSync(POS_CONFIG_PATH)) return {};
  try {
    const raw = fs.readFileSync(POS_CONFIG_PATH, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[electron] pos-config.json okunamadı:', e && e.message ? e.message : String(e));
    return {};
  }
}

// ---------------------------------------------------------------------------
// Port / env yardımcıları
// ---------------------------------------------------------------------------

function getTargetPort() {
  // pos-config.json > ortam değişkeni > varsayılan
  if (posConfig.port && Number.isInteger(posConfig.port)) return posConfig.port;
  const p = process.env.POS_PORT || process.env.PORT || String(DEFAULT_PORT);
  return parseInt(String(p), 10);
}

/**
 * @param {number} port
 * @param {string} absoluteDbPath — backend `resolveDbPath` ile uyumlu mutlak SQLite yolu (Electron: userData)
 */
function buildChildEnv(port, absoluteDbPath) {
  const env = { ...process.env };
  env.NODE_ENV = 'production';
  env.PORT = String(port);
  env.DB_PATH = absoluteDbPath;
  const dist = path.join(PROJECT_ROOT, 'client', 'dist');
  if (!env.CLIENT_DIST_PATH) {
    env.CLIENT_DIST_PATH = dist;
  }
  const jwtSecret = posConfig.jwtSecret || process.env.JWT_SECRET;
  if (jwtSecret) env.JWT_SECRET = String(jwtSecret);
  return env;
}

/**
 * Store Bridge için ortam değişkenleri — pos-config.json öncelikli, mevcut env fallback.
 * @param {number} port
 */
function buildBridgeEnv(port) {
  const env = { ...process.env };
  env.NODE_ENV = 'production';
  env.API_BASE = `http://127.0.0.1:${port}/api`;

  const b = posConfig.bridge || {};
  if (b.token) env.BRIDGE_TOKEN = String(b.token);
  if (b.businessId != null) env.BRIDGE_BUSINESS_ID = String(b.businessId);
  if (b.dryRun != null) env.BRIDGE_DRY_RUN = b.dryRun ? '1' : '0';
  if (b.pollIntervalMs != null) env.POLL_INTERVAL_MS = String(b.pollIntervalMs);
  if (b.claimId) env.BRIDGE_CLAIM_ID = String(b.claimId);
  if (b.socketTimeoutMs != null) env.PRINT_SOCKET_TIMEOUT_MS = String(b.socketTimeoutMs);

  const c = posConfig.callerid || {};
  if (c.enabled != null) env.CID812_ENABLED = c.enabled ? '1' : '0';
  if (c.mode) env.CID812_MODE = String(c.mode);
  if (c.debounceMs != null) env.CID812_DEBOUNCE_MS = String(c.debounceMs);
  if (c.enableParse != null) env.CID812_ENABLE_PARSE = c.enableParse ? '1' : '0';
  if (c.phoneRegex) env.CID812_PHONE_REGEX = String(c.phoneRegex);

  const h = c.hid || {};
  if (h.vid) env.CID812_HID_VID = String(h.vid);
  if (h.pid) env.CID812_HID_PID = String(h.pid);
  if (h.serial != null) env.CID812_HID_SERIAL = String(h.serial);
  if (h.reconnectIntervalMs != null) env.CID812_RECONNECT_INTERVAL_MS = String(h.reconnectIntervalMs);

  return env;
}

// ---------------------------------------------------------------------------
// SQLite legacy taşıma
// ---------------------------------------------------------------------------

/**
 * userData'da pos.db yoksa ve proje altında legacy DB varsa, bir kez güvenli kopya.
 * userData'da pos.db varsa hiçbir şey yapılmaz (üzerine yazılmaz).
 *
 * @param {string} userDataDbPath — örn. .../userData/pos.db
 */
function copyLegacySqliteToUserDataIfNeeded(userDataDbPath) {
  if (fs.existsSync(userDataDbPath)) {
    console.log('[electron] SQLite: userData veritabanı zaten mevcut, legacy taşınmadı:', userDataDbPath);
    return;
  }

  if (!fs.existsSync(LEGACY_DB_MAIN)) {
    console.log(
      '[electron] SQLite: legacy bulunamadı (ilk çalıştırma); boş DB oluşturulacak. Kaynak:',
      LEGACY_DB_MAIN,
    );
    return;
  }

  const userDataDir = path.dirname(userDataDbPath);
  fs.mkdirSync(userDataDir, { recursive: true });

  const suffixes = ['', '-wal', '-shm'];
  const sources = suffixes.map((s) => (s === '' ? LEGACY_DB_MAIN : LEGACY_DB_MAIN + s));
  const copied = [];

  try {
    for (const src of sources) {
      if (!fs.existsSync(src)) continue;
      const dest = path.join(userDataDir, path.basename(src));
      fs.copyFileSync(src, dest);
      copied.push(path.basename(dest));
    }
    console.log(
      '[electron] SQLite: legacy tek seferlik kopyalandı →',
      userDataDir,
      copied.length ? `(${copied.join(', ')})` : '',
    );
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    for (const name of copied) {
      const p = path.join(userDataDir, name);
      try {
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {
        /* ignore */
      }
    }
    console.error('[electron] SQLite: legacy kopyası başarısız, userData tarafı geri alındı:', msg);
    throw new Error(`Veritabanı taşınamadı (legacy kopyası): ${msg}`);
  }
}

// ---------------------------------------------------------------------------
// Sunucu sağlık kontrolü
// ---------------------------------------------------------------------------

function httpHealthCheck(port) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      {
        hostname: HEALTH_HOST,
        port,
        path: HEALTH_PATH,
        method: 'GET',
        timeout: 3000,
      },
      (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else reject(new Error(`Health yanıtı: HTTP ${res.statusCode}`));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => {
      req.destroy();
      reject(new Error('Health isteği zaman aşımı'));
    });
    req.end();
  });
}

function waitForHealth(port) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (Date.now() > deadline) {
        reject(
          new Error(
            `${HEALTH_TIMEOUT_MS / 1000} sn içinde /api/health yanıt vermedi. Port ${port} dinlenmiyor olabilir veya sunucu hata veriyor.`,
          ),
        );
        return;
      }
      try {
        await httpHealthCheck(port);
        resolve();
      } catch {
        setTimeout(tick, HEALTH_INTERVAL_MS);
      }
    };
    tick();
  });
}

// ---------------------------------------------------------------------------
// Süreç yaşam döngüsü
// ---------------------------------------------------------------------------

function killProcess(child) {
  if (!child || child.killed) return;
  try {
    if (process.platform === 'win32' && child.pid) {
      try {
        execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
          stdio: 'ignore',
          windowsHide: true,
        });
      } catch {
        child.kill();
      }
    } else {
      child.kill('SIGTERM');
    }
  } catch {
    try {
      child.kill('SIGKILL');
    } catch {
      /* ignore */
    }
  }
}

function forceKillAfterTimeout(child) {
  const t = setTimeout(() => {
    if (child && !child.killed && child.pid) {
      try {
        if (process.platform === 'win32') {
          execFileSync('taskkill', ['/PID', String(child.pid), '/T', '/F'], {
            stdio: 'ignore',
            windowsHide: true,
          });
        } else {
          child.kill('SIGKILL');
        }
      } catch {
        /* ignore */
      }
    }
  }, KILL_FORCE_MS);
  t.unref();
}

/**
 * @param {string} absoluteDbPath
 * @returns {Promise<number>} port
 */
function startServerAndWaitForHealth(absoluteDbPath) {
  return new Promise((resolve, reject) => {
    if (!fs.existsSync(SERVER_ENTRY)) {
      reject(new Error(`Sunucu dosyası bulunamadı: ${SERVER_ENTRY}`));
      return;
    }

    const port = getTargetPort();
    if (Number.isNaN(port) || port < 1 || port > 65535) {
      reject(new Error(`Geçersiz port: ${posConfig.port || process.env.POS_PORT || process.env.PORT}`));
      return;
    }

    console.log('[electron] SQLite: backend DB_PATH =', absoluteDbPath);

    const env = buildChildEnv(port, absoluteDbPath);
    let stderrBuf = '';

    const child = spawn('node', [SERVER_ENTRY], {
      cwd: PROJECT_ROOT,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    serverProcess = child;

    child.stdout.on('data', (d) => {
      process.stdout.write(`[pos-api] ${d}`);
    });
    child.stderr.on('data', (d) => {
      const s = d.toString();
      stderrBuf = (stderrBuf + s).slice(-6000);
      process.stderr.write(`[pos-api] ${d}`);
    });

    let settled = false;

    const fail = (err) => {
      if (settled) return;
      settled = true;
      killProcess(child);
      serverProcess = null;
      reject(err);
    };

    const succeed = () => {
      if (settled) return;
      settled = true;
      resolve(port);
    };

    child.on('error', (err) => {
      fail(new Error(`API süreci başlatılamadı: ${err.message}`));
    });

    child.on('exit', (code, signal) => {
      serverProcess = null;
      if (settled) return;
      const hint =
        stderrBuf.includes('EADDRINUSE') || stderrBuf.includes('address already in use')
          ? ` Port ${port} başka bir program tarafından kullanılıyor olabilir. Diğer POS örneğini kapatın veya POS_PORT ile farklı bir port seçin.`
          : ` ${stderrBuf.slice(-1200)}`;
      fail(
        new Error(
          `API süreci beklenmedik şekilde kapandı (kod: ${code ?? 'null'}, sinyal: ${signal ?? 'yok'}).${hint}`,
        ),
      );
    });

    waitForHealth(port)
      .then(() => {
        child.removeAllListeners('exit');
        child.on('exit', () => {
          serverProcess = null;
        });
        succeed();
      })
      .catch((err) => {
        fail(err);
      });
  });
}

/**
 * Store Bridge'i arka planda başlatır.
 * pos-config.json veya ortam değişkenlerinde bridge.token + bridge.businessId zorunlu.
 * @param {number} port
 */
function startStoreBridge(port) {
  if (!fs.existsSync(BRIDGE_ENTRY)) {
    console.warn('[electron] Store Bridge bulunamadı, atlanıyor:', BRIDGE_ENTRY);
    return;
  }

  const b = posConfig.bridge || {};
  const token = b.token || process.env.BRIDGE_TOKEN;
  const businessId = b.businessId != null ? String(b.businessId) : process.env.BRIDGE_BUSINESS_ID;

  if (!token || !businessId) {
    console.warn(
      '[electron] Store Bridge: pos-config.json bridge.token + bridge.businessId gerekli (veya BRIDGE_TOKEN / BRIDGE_BUSINESS_ID env). Yazıcı köprüsü atlanıyor.',
    );
    return;
  }

  const env = buildBridgeEnv(port);

  const child = spawn('node', [BRIDGE_ENTRY], {
    cwd: PROJECT_ROOT,
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  bridgeProcess = child;

  child.stdout.on('data', (d) => process.stdout.write(`[store-bridge] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[store-bridge] ${d}`));

  child.on('exit', (code) => {
    bridgeProcess = null;
    console.log(`[electron] Store Bridge kapandı (kod: ${code ?? 'null'})`);
  });
  child.on('error', (err) => {
    console.error('[electron] Store Bridge başlatılamadı:', err.message);
    bridgeProcess = null;
  });

  console.log(`[electron] Store Bridge başlatıldı pid=${child.pid} api=http://127.0.0.1:${port}/api`);
}

// ---------------------------------------------------------------------------
// BrowserWindow
// ---------------------------------------------------------------------------

function createWindow(port) {
  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
    },
  });

  const url = `http://${HEALTH_HOST}:${port}/`;
  mainWindow.loadURL(url).catch((err) => {
    dialog.showErrorBox('Yükleme hatası', `Sayfa açılamadı: ${err.message}`);
  });

  mainWindow.once('ready-to-show', () => {
    if (mainWindow) mainWindow.show();
  });

  mainWindow.on('closed', () => {
    mainWindow = null;
  });
}

// ---------------------------------------------------------------------------
// Uygulama olayları
// ---------------------------------------------------------------------------

app.whenReady().then(async () => {
  posConfig = readPosConfig();
  if (Object.keys(posConfig).length) {
    console.log('[electron] pos-config.json yüklendi');
  }

  const distIndex = path.join(PROJECT_ROOT, 'client', 'dist', 'index.html');
  if (!fs.existsSync(distIndex)) {
    dialog.showErrorBox(
      'Eksik build',
      'client/dist bulunamadı. Önce proje kökünde "npm run build" çalıştırın, ardından Electron\'u yeniden başlatın.',
    );
    app.quit();
    return;
  }

  const userDataDbPath = path.join(app.getPath('userData'), 'pos.db');

  try {
    copyLegacySqliteToUserDataIfNeeded(userDataDbPath);
    const port = await startServerAndWaitForHealth(userDataDbPath);
    createWindow(port);
    startStoreBridge(port);
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    dialog.showErrorBox('POS sunucusu başlatılamadı', msg);
    app.quit();
  }
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  if (serverProcess && !serverProcess.killed) {
    killProcess(serverProcess);
    forceKillAfterTimeout(serverProcess);
  }
  if (bridgeProcess && !bridgeProcess.killed) {
    killProcess(bridgeProcess);
    forceKillAfterTimeout(bridgeProcess);
  }
});
