/**
 * Electron main: child process'te Express (server/index.js), BrowserWindow ile http://127.0.0.1:PORT
 * Express kodu Electron içine gömülmez; file:// kullanılmaz.
 * pos-config.json mevcutsa ayarlar oradan okunur; Store Bridge otomatik başlatılır.
 */
const { app, BrowserWindow, dialog, ipcMain } = require('electron');
const { spawn } = require('child_process');
const { execFileSync } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

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
/** @type {NodeJS.Timeout | null} */
let bridgeRestartTimer = null;
/** @type {boolean} */
let bridgeStopped = false;
/** @type {number} */
let bridgePort = 0;
/** Arka arkaya kaç kez yeniden başlatıldı; başarılı başlangıçta sıfırlanır. */
let bridgeRestartCount = 0;
const BRIDGE_MAX_RESTARTS = 10;
/** @type {import('child_process').ChildProcessWithoutNullStreams | null} */
let callerIdHelperProcess = null;
/** @type {NodeJS.Timeout | null} */
let callerIdHelperRestartTimer = null;
/** @type {boolean} */
let callerIdHelperStopped = false;
/** @type {BrowserWindow | null} */
let mainWindow = null;
/** @type {Record<string, unknown>} */
let posConfig = {};
/** @type {fs.WriteStream | null} */
let logStream = null;

function formatLogArg(arg) {
  if (arg instanceof Error) return `${arg.stack || arg.message}`;
  if (typeof arg === 'string') return arg;
  try {
    return JSON.stringify(arg);
  } catch {
    return String(arg);
  }
}

function setupFileLogging() {
  const logsDir = path.join(app.getPath('userData'), 'logs');
  fs.mkdirSync(logsDir, { recursive: true });
  const logPath = path.join(logsDir, 'electron-main.log');
  logStream = fs.createWriteStream(logPath, { flags: 'a' });

  const original = {
    log: console.log.bind(console),
    warn: console.warn.bind(console),
    error: console.error.bind(console),
  };

  const write = (level, args) => {
    const line = `[${new Date().toISOString()}] [${level}] ${args.map(formatLogArg).join(' ')}\n`;
    try {
      logStream?.write(line);
    } catch {
      /* logging must never crash the app */
    }
  };

  console.log = (...args) => {
    write('info', args);
    original.log(...args);
  };
  console.warn = (...args) => {
    write('warn', args);
    original.warn(...args);
  };
  console.error = (...args) => {
    write('error', args);
    original.error(...args);
  };

  process.on('uncaughtException', (err) => {
    console.error('[electron] uncaughtException', err);
  });
  process.on('unhandledRejection', (err) => {
    console.error('[electron] unhandledRejection', err);
  });

  console.log('[electron] log file:', logPath);
}

// ---------------------------------------------------------------------------
// pos-config.json
// ---------------------------------------------------------------------------

/**
 * pos-config.json dosya yolu — packaged: userData, dev: repo kökü.
 * app.getPath('userData') app.whenReady öncesinde de kullanılabilir.
 */
function getPosConfigPath() {
  return app.isPackaged
    ? path.join(app.getPath('userData'), 'pos-config.json')
    : path.join(__dirname, '..', 'pos-config.json');
}

function readPosConfig() {
  const cfgPath = getPosConfigPath();
  console.log('[electron] pos-config.json aranıyor:', cfgPath);
  if (!fs.existsSync(cfgPath)) return {};
  try {
    const raw = fs.readFileSync(cfgPath, 'utf8');
    return JSON.parse(raw);
  } catch (e) {
    console.warn('[electron] pos-config.json okunamadı:', e && e.message ? e.message : String(e));
    return {};
  }
}

const PLACEHOLDER_JWT = 'GIZLI_JWT_ANAHTARI_BURAYA_DEGISTIRIN';

/**
 * jwtSecret eksikse veya örnek değerdeyse güvenli rastgele secret üret ve pos-config.json'a yaz.
 * Böylece Electron her yeniden başlatmada aynı secret'ı kullanır; aktif oturumlar kopmaz.
 */
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
      try { cfg = JSON.parse(fs.readFileSync(cfgPath, 'utf8')); } catch (_) { /* bozuk JSON — temizden yaz */ }
    }
    cfg.jwtSecret = secret;
    fs.writeFileSync(cfgPath, JSON.stringify(cfg, null, 2), 'utf8');
    console.log('[electron] JWT secret dosyaya yazıldı:', cfgPath);
  } catch (e) {
    console.warn('[electron] JWT secret dosyaya yazılamadı (bellek içi kullanılacak):', e && e.message ? e.message : String(e));
  }
}

// ---------------------------------------------------------------------------
// Yol yardımcıları (packaging desteği)
// ---------------------------------------------------------------------------

/**
 * Kod kökü: client/dist (ve dev'de server) — paketli: app.asar içi kök.
 */
function getCodeRoot() {
  if (app.isPackaged) {
    return app.getAppPath();
  }
  return path.join(__dirname, '..');
}

/**
 * Paketli modda backend `extraResources` ile resources/server altında (asar dışı, tam node_modules).
 * Geliştirmede repo kökündeki server/.
 */
function getPackagedServerRoot() {
  return path.join(process.resourcesPath, 'server');
}

/**
 * Store Bridge kök dizini — paketli: resources/store-bridge, geliştirme: repo/store-bridge.
 */
function getStoreBridgeRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'store-bridge');
  }
  return path.join(getCodeRoot(), 'store-bridge');
}

/**
 * Tools kök dizini — paketli: resources/tools, geliştirme: repo/tools.
 */
function getToolsRoot() {
  if (app.isPackaged) {
    return path.join(process.resourcesPath, 'tools');
  }
  return path.join(getCodeRoot(), 'tools');
}

/** Backend giriş dosyası — modül çözümlemesi server/node_modules ile aynı dizin ağacında olmalı */
function getServerEntryPath() {
  if (app.isPackaged) {
    return path.join(getPackagedServerRoot(), 'index.js');
  }
  return path.join(getCodeRoot(), 'server', 'index.js');
}

/** Child spawn cwd */
function getServerSpawnCwd() {
  if (app.isPackaged) {
    return getPackagedServerRoot();
  }
  return getCodeRoot();
}

function getTargetPort() {
  // pos-config.json > ortam değişkeni > varsayılan
  if (posConfig.port && Number.isInteger(posConfig.port)) return posConfig.port;
  const p = process.env.POS_PORT || process.env.PORT || String(DEFAULT_PORT);
  return parseInt(String(p), 10);
}

// ---------------------------------------------------------------------------
// Ortam değişkeni oluşturucular
// ---------------------------------------------------------------------------

/**
 * @param {number} port
 * @param {string} absoluteDbPath
 * @param {string} codeRoot — getCodeRoot()
 */
function buildChildEnv(port, absoluteDbPath, codeRoot) {
  const env = { ...process.env };
  env.NODE_ENV = 'production';
  env.PORT = String(port);
  env.DB_PATH = absoluteDbPath;
  env.USER_DATA_PATH = app.getPath('userData');
  env.APP_VERSION = app.getVersion();
  const dist = path.join(codeRoot, 'client', 'dist');
  if (!env.CLIENT_DIST_PATH) {
    env.CLIENT_DIST_PATH = dist;
  }
  // JWT_SECRET: pos-config.json > ortam değişkeni > her başlangıçta güvenli rastgele üret
  env.JWT_SECRET =
    (posConfig.jwtSecret ? String(posConfig.jwtSecret) : null) ||
    process.env.JWT_SECRET ||
    require('crypto').randomBytes(64).toString('hex');
  // Sunucu bridge middleware'i BRIDGE_TOKEN + BRIDGE_BUSINESS_ID'yi kendi ortamında bekler
  const b = posConfig.bridge || {};
  if (b.token) env.BRIDGE_TOKEN = String(b.token);
  if (b.businessId != null) env.BRIDGE_BUSINESS_ID = String(b.businessId);
  console.log('[electron] buildChildEnv: BRIDGE_TOKEN =', env.BRIDGE_TOKEN ? '***' : '(tanımsız)');
  console.log('[electron] buildChildEnv: BRIDGE_BUSINESS_ID =', env.BRIDGE_BUSINESS_ID || '(tanımsız)');
  // Mock mod: pos-config.json bridge.disablePrintJobMock ile override edilebilir
  // Varsayılan: true (mock KAPALI). Açmak için pos-config.json'a "disablePrintJobMock": false ekle.
  if (b.disablePrintJobMock != null) {
    env.DISABLE_PRINT_JOB_MOCK = b.disablePrintJobMock ? '1' : '0';
  }
  // CORS: LAN'dan erişen tablet/cihazların origin'lerini virgülle gir
  // Örnek: corsOrigins: ["http://192.168.1.50:3001"]
  const corsOrigins = posConfig.corsOrigins;
  if (Array.isArray(corsOrigins) && corsOrigins.length) {
    env.CORS_ORIGINS = corsOrigins.join(',');
  } else if (typeof corsOrigins === 'string' && corsOrigins) {
    env.CORS_ORIGINS = corsOrigins;
  }
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
  if (b.apiTimeoutMs != null) env.BRIDGE_API_TIMEOUT_MS = String(b.apiTimeoutMs);
  if (b.healthRetryMs != null) env.BRIDGE_HEALTH_RETRY_MS = String(b.healthRetryMs);
  if (b.claimId) env.BRIDGE_CLAIM_ID = String(b.claimId);
  if (b.socketTimeoutMs != null) env.PRINT_SOCKET_TIMEOUT_MS = String(b.socketTimeoutMs);
  // ESC t kod sayfası: 12 = PC857 (Turkish), 28 = WPC1254 — yazıcı modeline göre ayarla
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

// ---------------------------------------------------------------------------
// SQLite legacy taşıma
// ---------------------------------------------------------------------------

/**
 * userData'da pos.db yoksa ve proje altında legacy DB varsa, bir kez güvenli kopya.
 * userData'da pos.db varsa hiçbir şey yapılmaz (üzerine yazılmaz).
 * Kopya başarısız olursa oluşturulan hedef dosyalar geri alınır.
 *
 * @param {string} userDataDbPath — örn. .../userData/pos.db
 * @param {string} legacyDbMain   — kaynak pos.db (paketli veya dev)
 */
function copyLegacySqliteToUserDataIfNeeded(userDataDbPath, legacyDbMain) {
  if (fs.existsSync(userDataDbPath)) {
    console.log('[electron] SQLite: userData veritabanı zaten mevcut, legacy taşınmadı:', userDataDbPath);
    return;
  }

  if (!fs.existsSync(legacyDbMain)) {
    console.log(
      '[electron] SQLite: legacy bulunamadı (ilk çalıştırma); boş DB oluşturulacak. Kaynak:',
      legacyDbMain,
    );
    return;
  }

  const userDataDir = path.dirname(userDataDbPath);
  fs.mkdirSync(userDataDir, { recursive: true });

  const suffixes = ['', '-wal', '-shm'];
  const sources = suffixes.map((s) => (s === '' ? legacyDbMain : legacyDbMain + s));
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
    const codeRoot = getCodeRoot();
    const serverEntry = getServerEntryPath();
    const spawnCwd = getServerSpawnCwd();
    const serverDepsRoot = path.join(path.dirname(serverEntry), 'node_modules');

    if (!fs.existsSync(serverEntry)) {
      reject(new Error(`Sunucu dosyası bulunamadı: ${serverEntry}`));
      return;
    }

    const port = getTargetPort();
    if (Number.isNaN(port) || port < 1 || port > 65535) {
      reject(new Error(`Geçersiz port: ${posConfig.port || process.env.POS_PORT || process.env.PORT}`));
      return;
    }

    const env = buildChildEnv(port, absoluteDbPath, codeRoot);
    const clientDistPath = env.CLIENT_DIST_PATH || path.join(codeRoot, 'client', 'dist');

    console.log('[electron] runtime: packaged =', app.isPackaged);
    console.log('[electron] paths: codeRoot (asar, client) =', codeRoot);
    console.log('[electron] paths: resourcesPath =', app.isPackaged ? process.resourcesPath : '(n/a)');
    console.log('[electron] paths: serverEntry =', serverEntry);
    console.log('[electron] paths: server spawn cwd =', spawnCwd);
    console.log('[electron] paths: server node_modules (beklenen) =', serverDepsRoot);
    console.log('[electron] paths: CLIENT_DIST_PATH =', clientDistPath);
    console.log('[electron] SQLite: backend DB_PATH =', absoluteDbPath);
    console.log('[electron] spawn öncesi env.BRIDGE_TOKEN =', env.BRIDGE_TOKEN ? '***' : '(tanımsız)');

    let stderrBuf = '';

    /** Kurulumlu uygulamada sistem Node yok; Electron ikilisi Node olarak kullanılır */
    const useElectronAsNode = app.isPackaged;
    const spawnCmd = useElectronAsNode ? process.execPath : 'node';
    const spawnArgs = [serverEntry];
    const childEnv = useElectronAsNode ? { ...env, ELECTRON_RUN_AS_NODE: '1' } : env;

    const child = spawn(spawnCmd, spawnArgs, {
      cwd: spawnCwd,
      env: childEnv,
      stdio: ['ignore', 'pipe', 'pipe'],
      windowsHide: true,
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
      const detail = [
        err.message,
        `execPath=${spawnCmd}`,
        `cwd=${spawnCwd}`,
        `serverEntry=${serverEntry}`,
        `CLIENT_DIST_PATH=${clientDistPath}`,
      ].join(' | ');
      fail(new Error(`API süreci başlatılamadı: ${detail}`));
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
  const bridgeRoot = getStoreBridgeRoot();
  const bridgeEntry = path.join(bridgeRoot, 'index.js');

  if (!fs.existsSync(bridgeEntry)) {
    console.warn('[electron] Store Bridge bulunamadı, atlanıyor:', bridgeEntry);
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

  // Packaged modda sistem Node yok — Electron ikilisini Node olarak kullan
  const useElectronAsNode = app.isPackaged;
  const spawnCmd = useElectronAsNode ? process.execPath : 'node';
  const childEnv = useElectronAsNode ? { ...env, ELECTRON_RUN_AS_NODE: '1' } : env;

  console.log('[electron] Store Bridge cmd:', spawnCmd, bridgeEntry);

  const restartMs = Math.max(
    5000,
    parseInt(String(posConfig.bridgeRestartMs || process.env.BRIDGE_RESTART_MS || '10000'), 10) || 10000,
  );

  const child = spawn(spawnCmd, [bridgeEntry], {
    cwd: bridgeRoot,
    env: childEnv,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  bridgeProcess = child;
  bridgePort = port;

  child.stdout.on('data', (d) => process.stdout.write(`[store-bridge] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[store-bridge] ${d}`));

  child.on('exit', (code) => {
    bridgeProcess = null;
    console.log(`[electron] Store Bridge kapandı (kod: ${code ?? 'null'})`);
    if (!bridgeStopped) {
      scheduleBridgeRestart(port, restartMs);
    }
  });
  child.on('error', (err) => {
    console.error('[electron] Store Bridge başlatılamadı:', err.message);
    bridgeProcess = null;
    if (!bridgeStopped) {
      scheduleBridgeRestart(port, restartMs);
    }
  });

  bridgeRestartCount = 0; // başarılı başlatma — sayacı sıfırla
  console.log(`[electron] Store Bridge başlatıldı pid=${child.pid} api=http://127.0.0.1:${port}/api`);
}

function scheduleBridgeRestart(port, restartMs) {
  if (bridgeStopped) return;

  bridgeRestartCount += 1;
  if (bridgeRestartCount > BRIDGE_MAX_RESTARTS) {
    console.error(
      `[electron] Store Bridge ${BRIDGE_MAX_RESTARTS} kez art arda yeniden başlatıldı ve başarısız oldu.` +
      ' Otomatik yeniden başlatma durduruldu. Yazıcı bağlantısı çalışmıyor olabilir.' +
      ' Uygulamayı kapatıp açarak sorunu giderin.',
    );
    return;
  }

  if (bridgeRestartTimer) clearTimeout(bridgeRestartTimer);
  console.log(
    `[electron] Store Bridge ${restartMs / 1000} s sonra yeniden başlatılacak... (deneme ${bridgeRestartCount}/${BRIDGE_MAX_RESTARTS})`,
  );
  bridgeRestartTimer = setTimeout(() => {
    bridgeRestartTimer = null;
    startStoreBridge(port);
  }, restartMs);
  bridgeRestartTimer.unref?.();
}

// ---------------------------------------------------------------------------
// Caller ID SDK Helper
// ---------------------------------------------------------------------------

/**
 * CallerIdSdkHelper'ı dotnet run ile başlatır.
 * Çökerse CALLER_ID_RESTART_MS (varsayılan 15 s) sonra yeniden başlatır.
 * @param {number} port
 */
function startCallerIdHelper(port) {
  if (callerIdHelperStopped) return;

  const toolsRoot = getToolsRoot();
  const helperDir = path.join(toolsRoot, 'callerid-sdk-helper');

  // Packaged modda pre-built exe; dev modda dotnet run ile kaynak derleme
  const isPackaged = app.isPackaged;
  const exePath = path.join(helperDir, 'bin', 'Release', 'net8.0', 'CallerIdSdkHelper.exe');
  const csprojPath = path.join(helperDir, 'CallerIdSdkHelper.csproj');

  const existenceTarget = isPackaged ? exePath : csprojPath;
  if (!fs.existsSync(existenceTarget)) {
    console.warn('[electron] CallerIdSdkHelper bulunamadı, atlanıyor:', existenceTarget);
    return;
  }

  const b = posConfig.bridge || {};
  const token = b.token || process.env.BRIDGE_TOKEN;
  if (!token) {
    console.warn('[electron] CallerIdSdkHelper: bridge.token tanımsız, helper atlanıyor.');
    return;
  }

  const restartMs = Math.max(
    5000,
    parseInt(String(posConfig.callerIdHelperRestartMs || process.env.CALLER_ID_RESTART_MS || '15000'), 10) || 15000,
  );

  // Packaged: doğrudan exe; dev: dotnet run
  let cmd, args, spawnCwd;
  if (isPackaged) {
    // DLL yolu: resources/tools/callerid-sdk-helper/cidshow_x64/cid.dll
    const dllPath = path.join(process.resourcesPath, 'tools', 'callerid-sdk-helper', 'cidshow_x64', 'cid.dll');
    cmd = exePath;
    args = [
      '--bridge-token', token,
      '--post-enabled', 'true',
      '--api-base', `http://127.0.0.1:${port}/api`,
      '--dll-path', dllPath,
    ];
    spawnCwd = helperDir;
  } else {
    cmd = 'dotnet';
    args = [
      'run',
      '--project', csprojPath,
      '--',
      '--bridge-token', token,
      '--post-enabled', 'true',
      '--api-base', `http://127.0.0.1:${port}/api`,
    ];
    spawnCwd = helperDir;
  }

  console.log('[electron] CallerIdSdkHelper başlatılıyor...');
  if (isPackaged) {
    console.log('[electron] CallerIdSdkHelper exe:', exePath);
  }

  const child = spawn(cmd, args, {
    cwd: spawnCwd,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
  });
  callerIdHelperProcess = child;

  child.stdout.on('data', (d) => process.stdout.write(`[callerid-helper] ${d}`));
  child.stderr.on('data', (d) => process.stderr.write(`[callerid-helper] ${d}`));

  child.on('error', (err) => {
    console.error('[electron] CallerIdSdkHelper başlatılamadı:', err.message);
    callerIdHelperProcess = null;
    scheduleCallerIdHelperRestart(port, restartMs);
  });

  child.on('exit', (code) => {
    callerIdHelperProcess = null;
    console.log(`[electron] CallerIdSdkHelper kapandı (kod: ${code ?? 'null'})`);
    if (!callerIdHelperStopped) {
      scheduleCallerIdHelperRestart(port, restartMs);
    }
  });

  console.log(`[electron] CallerIdSdkHelper başlatıldı pid=${child.pid}`);
}

function scheduleCallerIdHelperRestart(port, restartMs) {
  if (callerIdHelperStopped) return;
  if (callerIdHelperRestartTimer) clearTimeout(callerIdHelperRestartTimer);
  console.log(`[electron] CallerIdSdkHelper ${restartMs / 1000} s sonra yeniden başlatılacak...`);
  callerIdHelperRestartTimer = setTimeout(() => {
    callerIdHelperRestartTimer = null;
    startCallerIdHelper(port);
  }, restartMs);
  callerIdHelperRestartTimer.unref?.();
}

// ---------------------------------------------------------------------------
// Otomatik DB Yedekleme
// ---------------------------------------------------------------------------

/** @type {NodeJS.Timeout | null} */
let backupTimer = null;

const BACKUP_KEEP_DAYS = 30;
const BACKUP_HOUR = 2; // gece 02:00

function requireBetterSqlite3ForBackup() {
  const serverRoot = app.isPackaged ? getPackagedServerRoot() : path.join(getCodeRoot(), 'server');
  const modulePath = path.join(serverRoot, 'node_modules', 'better-sqlite3');
  return require(modulePath);
}

function verifySqliteBackup(Database, backupPath) {
  const backupDb = new Database(backupPath, { readonly: true, fileMustExist: true });
  try {
    const result = backupDb.pragma('integrity_check', { simple: true });
    if (result !== 'ok') {
      throw new Error(`integrity_check=${result}`);
    }
  } finally {
    backupDb.close();
  }
}

/**
 * Yedek alınmadan önce backupsDir disk alanını kontrol eder.
 * dbSize * 3 bayttan az serbest alan varsa uyarı gönderir.
 */
async function checkDiskSpaceForBackup(dbPath, backupsDir) {
  try {
    const dbSize = fs.existsSync(dbPath) ? fs.statSync(dbPath).size : 0;
    if (dbSize === 0) return;
    let freeBytes = Infinity;
    if (typeof fs.statfsSync === 'function') {
      const stat = fs.statfsSync(backupsDir);
      freeBytes = stat.bfree * stat.bsize;
    } else {
      return; // Node sürümü statfsSync desteklemiyor, atla
    }
    const threshold = dbSize * 3;
    if (freeBytes < threshold) {
      const msg = `Disk alanı yetersiz: ${Math.round(freeBytes / 1024 / 1024)} MB serbest, en az ${Math.round(threshold / 1024 / 1024)} MB gerekli`;
      console.warn('[backup] ' + msg);
      mainWindow?.webContents?.send('backup-disk-warning', { message: msg, freeBytes, dbSize });
    }
  } catch (e) {
    console.warn('[backup] Disk alanı kontrolü yapılamadı (kritik değil):', e?.message || e);
  }
}

/**
 * pos.db'yi userData/backups/pos-YYYY-MM-DD.db olarak SQLite backup API ile alır.
 * WAL modunda duz dosya kopyası guvenli olmadigi icin backup snapshot'i kullanilir.
 * Ayrıca uploads/products/, pos-config.json ve backup-meta.json sidecar dosyaları da yedeklenir.
 */
async function performBackup(dbPath) {
  const backupsDir = path.join(app.getPath('userData'), 'backups');
  let tempPath = null;
  try {
    if (!fs.existsSync(dbPath)) {
      console.warn('[backup] Veritabanı bulunamadı, yedek atlandı:', dbPath);
      return;
    }
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }

    await checkDiskSpaceForBackup(dbPath, backupsDir);

    const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const backupPath = path.join(backupsDir, `pos-${dateStr}.db`);
    if (fs.existsSync(backupPath)) {
      console.log('[backup] Bugünkü yedek zaten mevcut:', backupPath);
      return;
    }

    const Database = requireBetterSqlite3ForBackup();
    const liveDb = new Database(dbPath, { readonly: true, fileMustExist: true });
    tempPath = `${backupPath}.tmp-${process.pid}`;
    try {
      await liveDb.backup(tempPath);
    } finally {
      liveDb.close();
    }
    verifySqliteBackup(Database, tempPath);
    fs.renameSync(tempPath, backupPath);
    tempPath = null;
    console.log('[backup] ✅ WAL-güvenli veritabanı yedeklendi:', backupPath);

    // uploads/products/ klasörünü yedekle (kritik değil, hata yedeklemeyi durdurmaz)
    try {
      const userDataPath = app.getPath('userData');
      const srcUploads = path.join(userDataPath, 'uploads', 'products');
      const destUploads = path.join(backupsDir, `uploads-${dateStr}`);
      if (fs.existsSync(srcUploads) && !fs.existsSync(destUploads)) {
        fs.mkdirSync(destUploads, { recursive: true });
        for (const file of fs.readdirSync(srcUploads)) {
          fs.copyFileSync(path.join(srcUploads, file), path.join(destUploads, file));
        }
        console.log('[backup] uploads/products/ yedeklendi:', destUploads);
      }
    } catch (uploadErr) {
      console.warn('[backup] uploads yedeklemesi başarısız (kritik değil):', uploadErr?.message || uploadErr);
    }

    // pos-config.json'ı yedekle (JWT secret + bridge token içerir — kritik değil)
    try {
      const configSrcPath = getPosConfigPath();
      if (configSrcPath && fs.existsSync(configSrcPath)) {
        const configDestPath = path.join(backupsDir, `pos-${dateStr}.config.json`);
        if (!fs.existsSync(configDestPath)) {
          fs.copyFileSync(configSrcPath, configDestPath);
          console.log('[backup] pos-config.json yedeklendi:', configDestPath);
        }
      }
    } catch (cfgErr) {
      console.warn('[backup] pos-config.json yedeği alınamadı (kritik değil):', cfgErr?.message || cfgErr);
    }

    // Sidecar meta dosyası yaz (schema versiyonu, satır sayıları, bütünlük bilgisi)
    try {
      const metaDb = new Database(backupPath, { readonly: true, fileMustExist: true });
      let schemaVersion = 0;
      let rowCounts = {};
      let integrityResult = 'unknown';
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
      let appVersion = 'unknown';
      try {
        const pkgPath = app.isPackaged
          ? path.join(app.getAppPath(), 'package.json')
          : path.join(__dirname, '..', 'package.json');
        appVersion = JSON.parse(fs.readFileSync(pkgPath, 'utf8')).version || 'unknown';
      } catch { /* ignore */ }

      let sha256 = null;
      try {
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256');
        hash.update(fs.readFileSync(backupPath));
        sha256 = hash.digest('hex');
      } catch { /* ignore */ }

      const meta = {
        appVersion,
        schemaVersion,
        createdAt: new Date().toISOString(),
        type: 'automatic',
        rowCounts,
        integrityCheck: integrityResult,
        dbSizeBytes: fs.statSync(backupPath).size,
        sha256,
      };
      const metaPath = path.join(backupsDir, `pos-${dateStr}.meta.json`);
      fs.writeFileSync(metaPath, JSON.stringify(meta, null, 2), 'utf8');
      console.log('[backup] Meta dosyası yazıldı (sha256:', sha256?.slice(0, 12), '...):', metaPath);
    } catch (metaErr) {
      console.warn('[backup] Meta dosyası yazılamadı (kritik değil):', metaErr?.message || metaErr);
    }

    cleanOldBackups(backupsDir);
  } catch (e) {
    if (tempPath && fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        /* ignore */
      }
    }
    const errMsg = e && e.message ? e.message : String(e);
    console.error('[backup] Yedekleme hatası:', errMsg);
    mainWindow?.webContents?.send('backup-failed', { message: errMsg });
  }
}

function cleanOldBackups(backupsDir) {
  try {
    const cutoffMs = Date.now() - BACKUP_KEEP_DAYS * 24 * 60 * 60 * 1000;
    for (const entry of fs.readdirSync(backupsDir)) {
      const fp = path.join(backupsDir, entry);
      try {
        const stat = fs.statSync(fp);
        if (stat.mtimeMs >= cutoffMs) continue;

        // .db yedek dosyaları
        if (entry.startsWith('pos-') && entry.endsWith('.db')) {
          fs.unlinkSync(fp);
          console.log('[backup] Eski yedek silindi:', entry);
          continue;
        }
        // .meta.json sidecar dosyaları
        if (entry.startsWith('pos-') && entry.endsWith('.meta.json')) {
          fs.unlinkSync(fp);
          console.log('[backup] Eski meta dosyası silindi:', entry);
          continue;
        }
        // .config.json sidecar dosyaları
        if (entry.startsWith('pos-') && entry.endsWith('.config.json')) {
          fs.unlinkSync(fp);
          console.log('[backup] Eski config yedeği silindi:', entry);
          continue;
        }
        // uploads-YYYY-MM-DD klasörleri
        if (entry.startsWith('uploads-') && stat.isDirectory()) {
          fs.rmSync(fp, { recursive: true, force: true });
          console.log('[backup] Eski uploads yedeği silindi:', entry);
        }
      } catch { /* dosya/klasör silinemezse atla */ }
    }
  } catch (e) {
    console.warn('[backup] Eski yedek temizleme hatası:', e && e.message ? e.message : String(e));
  }
}

/** Bir sonraki saat BACKUP_HOUR:00:00'e kadar kalan ms. */
function msUntilNextBackupHour() {
  const now = new Date();
  const next = new Date(now);
  next.setHours(BACKUP_HOUR, 0, 0, 0);
  if (next <= now) next.setDate(next.getDate() + 1);
  return next.getTime() - now.getTime();
}

/**
 * Uygulama başlarken çalışır:
 * 1. Bugün yedek yoksa hemen alır.
 * 2. Bir sonraki gece 02:00'de yedek alır, sonra her 24 saatte tekrar.
 */
function scheduleBackup(dbPath) {
  // Başlangıçta hemen kontrol — bugün yedek yoksa al
  performBackup(dbPath).catch((err) => {
    console.error('[backup] Başlangıç yedeği alınamadı:', err && err.message ? err.message : String(err));
  });

  const msFirst = msUntilNextBackupHour();
  console.log(`[backup] Sonraki otomatik yedek: ${Math.round(msFirst / 60000)} dakika sonra (gece ${BACKUP_HOUR}:00)`);

  backupTimer = setTimeout(() => {
    performBackup(dbPath).catch((err) => {
      console.error('[backup] Zamanlanmış yedek alınamadı:', err && err.message ? err.message : String(err));
    });
    backupTimer = setInterval(() => {
      performBackup(dbPath).catch((err) => {
        console.error('[backup] Günlük yedek alınamadı:', err && err.message ? err.message : String(err));
      });
    }, 24 * 60 * 60 * 1000);
    backupTimer?.unref?.();
  }, msFirst);
  backupTimer?.unref?.();
}

function safeRestoreBackupName(value) {
  const fileName = path.basename(String(value || '').trim());
  if (!/^(pos|pos-manual|restore-safety)-[A-Za-z0-9._-]+\.db$/.test(fileName)) return null;
  return fileName;
}

function removeSqliteSidecars(dbPath) {
  for (const suffix of ['-wal', '-shm']) {
    const sidecar = `${dbPath}${suffix}`;
    if (!fs.existsSync(sidecar)) continue;
    try {
      fs.unlinkSync(sidecar);
    } catch (err) {
      console.warn('[restore] SQLite yan dosyası silinemedi:', sidecar, err?.message || err);
    }
  }
}

async function createRestoreSafetyBackup(Database, dbPath, backupsDir) {
  if (!fs.existsSync(dbPath)) return null;
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const safetyPath = path.join(backupsDir, `restore-safety-${stamp}.db`);
  const liveDb = new Database(dbPath, { readonly: true, fileMustExist: true });
  try {
    await liveDb.backup(safetyPath);
  } finally {
    liveDb.close();
  }
  verifySqliteBackup(Database, safetyPath);
  return safetyPath;
}

async function applyPendingRestoreIfAny(dbPath) {
  const userDataPath = app.getPath('userData');
  const requestPath = path.join(userDataPath, 'restore-request.json');
  if (!fs.existsSync(requestPath)) return;

  let request;
  try {
    request = JSON.parse(fs.readFileSync(requestPath, 'utf8'));
  } catch (err) {
    console.error('[restore] Restore isteği okunamadı:', err?.message || err);
    fs.unlinkSync(requestPath);
    return;
  }

  const backupName = safeRestoreBackupName(request?.backupFile);
  if (!backupName) {
    console.error('[restore] Geçersiz restore dosyası:', request?.backupFile);
    fs.unlinkSync(requestPath);
    return;
  }

  const backupsDir = path.join(userDataPath, 'backups');
  const backupPath = path.join(backupsDir, backupName);
  if (!fs.existsSync(backupPath)) {
    console.error('[restore] Restore yedeği bulunamadı:', backupPath);
    fs.unlinkSync(requestPath);
    return;
  }

  // SHA-256 hash doğrulaması — meta.json varsa ve hash kaydedilmişse kontrol et
  try {
    const metaName = backupName.replace(/\.db$/, '.meta.json');
    const metaPath = path.join(backupsDir, metaName);
    if (fs.existsSync(metaPath)) {
      const meta = JSON.parse(fs.readFileSync(metaPath, 'utf8'));
      if (meta?.sha256) {
        const crypto = require('crypto');
        const hash = crypto.createHash('sha256');
        hash.update(fs.readFileSync(backupPath));
        const actual = hash.digest('hex');
        if (actual !== meta.sha256) {
          throw new Error(`Yedek dosyası bozuk: SHA-256 uyuşmuyor. Beklenen=${meta.sha256.slice(0, 12)}… Gerçek=${actual.slice(0, 12)}…`);
        }
        console.log('[restore] SHA-256 doğrulandı:', actual.slice(0, 12) + '…');
      }
    }
  } catch (hashErr) {
    if (hashErr.message.startsWith('Yedek dosyası bozuk')) throw hashErr;
    console.warn('[restore] SHA-256 doğrulaması yapılamadı (kritik değil):', hashErr?.message);
  }

  const Database = requireBetterSqlite3ForBackup();
  const tempPath = `${dbPath}.restore-${process.pid}.tmp`;
  let safetyPath = null;
  try {
    verifySqliteBackup(Database, backupPath);
    fs.copyFileSync(backupPath, tempPath);
    verifySqliteBackup(Database, tempPath);
    safetyPath = await createRestoreSafetyBackup(Database, dbPath, backupsDir);

    removeSqliteSidecars(dbPath);
    if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
    fs.renameSync(tempPath, dbPath);
    removeSqliteSidecars(dbPath);

    // Post-restore bütünlük doğrulaması — başarısız olursa safety yedeğine geri dön
    try {
      const postDb = new Database(dbPath, { readonly: true, fileMustExist: true });
      let postIntegrity;
      try {
        postIntegrity = postDb.pragma('integrity_check', { simple: true });
      } finally {
        postDb.close();
      }
      if (postIntegrity !== 'ok') {
        console.error('[restore] Post-restore integrity_check başarısız:', postIntegrity, '— safety yedeğine geri dönülüyor');
        if (safetyPath && fs.existsSync(safetyPath)) {
          removeSqliteSidecars(dbPath);
          if (fs.existsSync(dbPath)) fs.unlinkSync(dbPath);
          fs.copyFileSync(safetyPath, dbPath);
          console.error('[restore] Safety yedeğine geri dönüldü:', safetyPath);
        }
        throw new Error(`Restore sonrası integrity_check başarısız: ${postIntegrity}`);
      }
      console.log('[restore] Post-restore integrity_check: ok');
    } catch (verifyErr) {
      if (verifyErr.message.startsWith('Restore sonrası')) throw verifyErr;
      console.warn('[restore] Post-restore doğrulama çalıştırılamadı (kritik değil):', verifyErr?.message);
    }

    // uploads/products/ geri yükle — varsa (kritik değil)
    try {
      const dateStamp = backupName.replace(/^pos-/, '').replace(/\.db$/, '');
      const backupUploads = path.join(backupsDir, `uploads-${dateStamp}`);
      if (fs.existsSync(backupUploads)) {
        const userDataPath = app.getPath('userData');
        const destUploads = path.join(userDataPath, 'uploads', 'products');
        fs.mkdirSync(destUploads, { recursive: true });
        for (const file of fs.readdirSync(backupUploads)) {
          fs.copyFileSync(path.join(backupUploads, file), path.join(destUploads, file));
        }
        console.log('[restore] uploads/products/ geri yüklendi:', backupUploads);
      }
    } catch (uploadErr) {
      console.warn('[restore] uploads geri yükleme başarısız (kritik değil):', uploadErr?.message || uploadErr);
    }

    // pos-config.json geri yükle — varsa (JWT secret + bridge token, kritik değil)
    try {
      const dateStamp = backupName.replace(/^pos-/, '').replace(/\.db$/, '');
      const configBackupPath = path.join(backupsDir, `pos-${dateStamp}.config.json`);
      if (fs.existsSync(configBackupPath)) {
        const configDestPath = getPosConfigPath();
        if (configDestPath) {
          fs.copyFileSync(configBackupPath, configDestPath);
          console.log('[restore] pos-config.json geri yüklendi. JWT secret ve bridge token yeniden yükleniyor.');
        }
      }
    } catch (cfgErr) {
      console.warn('[restore] pos-config.json geri yükleme başarısız (kritik değil):', cfgErr?.message || cfgErr);
    }

    // requestPath'i başarı onaylandıktan sonra sil
    fs.unlinkSync(requestPath);
    console.log('[restore] ✅ Yedek geri yüklendi:', backupName, safetyPath ? `safety=${safetyPath}` : '');
  } catch (err) {
    if (fs.existsSync(tempPath)) {
      try {
        fs.unlinkSync(tempPath);
      } catch {
        /* ignore */
      }
    }
    console.error('[restore] Restore uygulanamadı:', err?.message || err);
    throw err;
  }
}

// ---------------------------------------------------------------------------
// BrowserWindow
// ---------------------------------------------------------------------------

function createWindow(port) {
  const preloadPath = app.isPackaged
    ? path.join(app.getAppPath(), 'electron', 'preload.cjs')
    : path.join(__dirname, 'preload.cjs');

  mainWindow = new BrowserWindow({
    width: 1366,
    height: 768,
    show: false,
    webPreferences: {
      nodeIntegration: false,
      contextIsolation: true,
      preload: preloadPath,
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
  // app.getName() varsayılan olarak package.json "name" alanını döndürür ("restoran-pos").
  // app.getPath('userData') bunu kullandığı için %APPDATA%\restoran-pos\ olur.
  // Kullanıcıya görünen doğru ad ("Restoran POS") ile userData yolunu garantile.
  app.setName('Restoran POS');
  setupFileLogging();

  posConfig = readPosConfig();
  if (Object.keys(posConfig).length) {
    console.log('[electron] pos-config.json yüklendi');
  }
  ensureJwtSecret();

  const codeRoot = getCodeRoot();
  const distIndex = path.join(codeRoot, 'client', 'dist', 'index.html');
  if (!fs.existsSync(distIndex)) {
    dialog.showErrorBox(
      'Eksik build',
      'client/dist bulunamadı. Önce proje kökünde "npm run build" çalıştırın, ardından Electron\'u yeniden başlatın.',
    );
    app.quit();
    return;
  }

  const userDataDbPath = path.join(app.getPath('userData'), 'pos.db');
  const legacyDbMain = app.isPackaged
    ? path.join(getPackagedServerRoot(), 'data', 'pos.db')
    : path.join(codeRoot, 'server', 'data', 'pos.db');

  try {
    copyLegacySqliteToUserDataIfNeeded(userDataDbPath, legacyDbMain);
    await applyPendingRestoreIfAny(userDataDbPath);
    const port = await startServerAndWaitForHealth(userDataDbPath);
    scheduleBackup(userDataDbPath);
    createWindow(port);
    startStoreBridge(port);
    const cidTimer = setTimeout(() => startCallerIdHelper(port), 3000);
    cidTimer.unref?.();
  } catch (err) {
    const msg = err && err.message ? err.message : String(err);
    dialog.showErrorBox('POS sunucusu başlatılamadı', msg);
    app.quit();
  }
});

// ---------------------------------------------------------------------------
// electron-updater — otomatik güncelleme
// Yalnızca paketlenmiş uygulamada çalışır. Dev modunda atlanır.
// publish.yml / GitHub Actions release pipeline kurulunca devreye girer.
// ---------------------------------------------------------------------------

function initAutoUpdater() {
  if (!app.isPackaged) return; // Dev modda güncelleme kontrolü yapma

  let autoUpdater;
  try {
    autoUpdater = require('electron-updater').autoUpdater;
  } catch {
    console.log('[updater] electron-updater yüklü değil; güncelleme devre dışı.');
    return;
  }

  autoUpdater.autoDownload = true;
  autoUpdater.autoInstallOnAppQuit = true;

  autoUpdater.on('checking-for-update', () => {
    console.log('[updater] Güncelleme kontrol ediliyor...');
  });

  autoUpdater.on('update-available', (info) => {
    console.log(`[updater] Güncelleme mevcut: v${info.version}`);
    mainWindow?.webContents.send('update-available', {
      version: info.version,
      releaseNotes: info.releaseNotes || '',
    });
  });

  autoUpdater.on('update-not-available', () => {
    console.log('[updater] Uygulama güncel.');
  });

  autoUpdater.on('download-progress', (progress) => {
    mainWindow?.webContents.send('download-progress', {
      percent: Math.round(progress.percent),
      transferred: progress.transferred,
      total: progress.total,
      bytesPerSecond: progress.bytesPerSecond,
    });
  });

  autoUpdater.on('update-downloaded', (info) => {
    console.log(`[updater] v${info.version} indirildi, kurulum bekliyor.`);
    mainWindow?.webContents.send('update-downloaded', { version: info.version });
  });

  autoUpdater.on('error', (err) => {
    const msg = err?.message || String(err);
    console.error('[updater] Hata:', msg);
    mainWindow?.webContents.send('update-error', { message: msg });
  });

  // IPC: renderer'dan güncelleme kur
  ipcMain.on('install-update', () => {
    autoUpdater.quitAndInstall();
  });

  // IPC: renderer'dan güncelleme kontrolü
  ipcMain.on('check-for-updates', () => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.error('[updater] checkForUpdates hatası:', err?.message);
    });
  });

  // Uygulama açıldıktan 10 saniye sonra kontrol et (ani yavaşlamayı önle)
  const timer = setTimeout(() => {
    autoUpdater.checkForUpdates().catch((err) => {
      console.log('[updater] Güncelleme kontrolü yapılamadı:', err?.message || err);
    });
  }, 10000);
  timer.unref?.();
}

app.whenReady().then(() => initAutoUpdater());

ipcMain.on('restart-app', () => {
  app.relaunch();
  app.quit();
});

// ---------------------------------------------------------------------------
// P3-1: Windows Görev Zamanlayıcı ile harici yedek kopyalama
// ---------------------------------------------------------------------------

const SCHTASK_NAME = 'RestaurantPOS-BackupCopy';

/**
 * Hedef klasör seçim dialogu açar.
 */
ipcMain.handle('backup:pick-external-folder', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Yedeklerin kopyalanacağı klasörü seçin (USB, ağ sürücüsü...)',
    properties: ['openDirectory', 'createDirectory'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  return result.filePaths[0];
});

/**
 * Mevcut Görev Zamanlayıcı görevi durumunu döner.
 * { exists, taskName, destFolder, lastResult, nextRunTime }
 */
ipcMain.handle('backup:scheduler-status', async () => {
  const { execFile } = require('child_process');
  return new Promise((resolve) => {
    execFile(
      'schtasks',
      ['/Query', '/TN', SCHTASK_NAME, '/FO', 'LIST', '/V'],
      { encoding: 'buffer', windowsHide: true },
      (err, stdout) => {
        if (err) return resolve({ exists: false });
        const out = Buffer.isBuffer(stdout) ? stdout.toString('utf8') : stdout;
        const destMatch = out.match(/Comment:\s*(.+)/i);
        const lastMatch = out.match(/Last Result:\s*(.+)/i);
        const nextMatch = out.match(/Next Run Time:\s*(.+)/i);
        resolve({
          exists: true,
          taskName: SCHTASK_NAME,
          destFolder: destMatch ? destMatch[1].trim() : null,
          lastResult: lastMatch ? lastMatch[1].trim() : null,
          nextRunTime: nextMatch ? nextMatch[1].trim() : null,
        });
      },
    );
  });
});

/**
 * Windows Görev Zamanlayıcı görevi oluşturur veya günceller.
 * Her gece 03:00'te robocopy ile backupsDir → destFolder kopyalar.
 * destFolder görev Comment alanına kaydedilir (durum sorgusunda okunur).
 */
ipcMain.handle('backup:scheduler-save', async (_event, destFolder) => {
  if (!destFolder || typeof destFolder !== 'string') throw new Error('Hedef klasör belirtilmedi');

  const backupsDir = path.join(app.getPath('userData'), 'backups');
  // robocopy komutu: sadece pos-*.db dosyalarını kopyalar, eski üzerine yazar
  const action = `robocopy "${backupsDir}" "${destFolder}" pos-*.db /XO /NJH /NJS /NDL /R:2 /W:5`;
  const { execFile } = require('child_process');

  // Önce varsa sil, sonra tekrar oluştur (güncelleme için en güvenli yol)
  await new Promise((resolve) => {
    execFile('schtasks', ['/Delete', '/TN', SCHTASK_NAME, '/F'], { windowsHide: true }, () => resolve());
  });

  return new Promise((resolve, reject) => {
    execFile(
      'schtasks',
      [
        '/Create',
        '/TN', SCHTASK_NAME,
        '/TR', `cmd /c ${action}`,
        '/SC', 'DAILY',
        '/ST', '03:00',
        '/RL', 'HIGHEST',
        '/F',
        // Comment alanına hedef klasörü kaydet (durum sorgusunda okunur)
        '/MO', '1',
      ],
      { windowsHide: true },
      (err, _stdout, stderr) => {
        if (err) return reject(new Error(`Görev oluşturulamadı: ${stderr || err.message}`));
        // schtasks /Comment parametresi desteklenmiyor; hedef klasörü ayrı bir dosyaya yaz
        try {
          const cfgPath = path.join(app.getPath('userData'), 'backup-scheduler.json');
          fs.writeFileSync(cfgPath, JSON.stringify({ destFolder, taskName: SCHTASK_NAME, createdAt: new Date().toISOString() }, null, 2), 'utf8');
        } catch { /* ignore */ }
        console.log('[backup:scheduler] Görev oluşturuldu. Hedef:', destFolder);
        resolve({ ok: true, destFolder });
      },
    );
  });
});

/**
 * Görev Zamanlayıcı görevini kaldırır.
 */
ipcMain.handle('backup:scheduler-remove', async () => {
  const { execFile } = require('child_process');
  return new Promise((resolve, reject) => {
    execFile(
      'schtasks',
      ['/Delete', '/TN', SCHTASK_NAME, '/F'],
      { windowsHide: true },
      (err, _stdout, stderr) => {
        if (err) return reject(new Error(`Görev kaldırılamadı: ${stderr || err.message}`));
        try {
          const cfgPath = path.join(app.getPath('userData'), 'backup-scheduler.json');
          if (fs.existsSync(cfgPath)) fs.unlinkSync(cfgPath);
        } catch { /* ignore */ }
        console.log('[backup:scheduler] Görev kaldırıldı.');
        resolve({ ok: true });
      },
    );
  });
});

/**
 * Görevi hemen bir kez çalıştırır (test/manuel tetikleme).
 */
ipcMain.handle('backup:scheduler-run-now', async () => {
  // Önce kayıtlı hedef klasörü oku
  let destFolder = null;
  try {
    const cfgPath = path.join(app.getPath('userData'), 'backup-scheduler.json');
    if (fs.existsSync(cfgPath)) {
      destFolder = JSON.parse(fs.readFileSync(cfgPath, 'utf8')).destFolder;
    }
  } catch { /* ignore */ }

  if (!destFolder) throw new Error('Görev yapılandırması bulunamadı. Önce hedef klasörü kaydedin.');

  const backupsDir = path.join(app.getPath('userData'), 'backups');
  const { execFile } = require('child_process');
  return new Promise((resolve, reject) => {
    execFile(
      'robocopy',
      [backupsDir, destFolder, 'pos-*.db', '/XO', '/NJH', '/NJS', '/NDL', '/R:2', '/W:5'],
      { windowsHide: true },
      (err, stdout) => {
        // robocopy exit code 0-7 = başarılı (0=değişiklik yok, 1+=kopyalandı, vb.)
        const code = err?.code ?? 0;
        if (code > 7) return reject(new Error(`robocopy başarısız (exit ${code}): ${err?.message}`));
        const copiedMatch = (stdout || '').match(/(\d+)\s+Files Copied/i);
        const copied = copiedMatch ? parseInt(copiedMatch[1], 10) : 0;
        console.log(`[backup:scheduler] Elle kopyalama tamamlandı. ${copied} dosya → ${destFolder}`);
        resolve({ ok: true, copied, destFolder });
      },
    );
  });
});

/**
 * Kayıtlı Görev Zamanlayıcı yapılandırmasını okur (hedef klasör + görev durumu birleşik).
 */
ipcMain.handle('backup:scheduler-config', () => {
  try {
    const cfgPath = path.join(app.getPath('userData'), 'backup-scheduler.json');
    if (!fs.existsSync(cfgPath)) return null;
    return JSON.parse(fs.readFileSync(cfgPath, 'utf8'));
  } catch {
    return null;
  }
});

// IPC: Kullanıcı dışarıdan .db dosyası seçer → yedekler klasörüne manuel yedek olarak kopyalar
ipcMain.handle('backup:pick-external-db', async () => {
  const result = await dialog.showOpenDialog(mainWindow, {
    title: 'Geri yüklenecek veritabanı dosyasını seçin',
    filters: [{ name: 'SQLite Veritabanı', extensions: ['db'] }],
    properties: ['openFile'],
  });
  if (result.canceled || !result.filePaths.length) return null;
  const srcPath = result.filePaths[0];
  const Database = requireBetterSqlite3ForBackup();
  const backupsDir = path.join(app.getPath('userData'), 'backups');
  fs.mkdirSync(backupsDir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:T]/g, '-').slice(0, 19);
  const fileName = `pos-manual-${stamp}.db`;
  const destPath = path.join(backupsDir, fileName);
  fs.copyFileSync(srcPath, destPath);
  try {
    verifySqliteBackup(Database, destPath);
  } catch (verifyErr) {
    try { fs.unlinkSync(destPath); } catch { /* ignore */ }
    throw new Error(`Seçilen dosya geçerli bir SQLite veritabanı değil: ${verifyErr.message}`);
  }
  console.log('[backup] Dış kaynaklı yedek eklendi:', fileName);
  return fileName;
});

// IPC: Mevcut bir yedek dosyasını kullanıcının seçtiği konuma kopyalar
ipcMain.handle('backup:export', async (_event, backupFileName) => {
  const safeName = path.basename(String(backupFileName || '').trim());
  if (!/^(pos|pos-manual|restore-safety)-[A-Za-z0-9._-]+\.db$/.test(safeName)) {
    throw new Error('Geçersiz yedek dosyası adı');
  }
  const backupsDir = path.join(app.getPath('userData'), 'backups');
  const srcPath = path.join(backupsDir, safeName);
  if (!fs.existsSync(srcPath)) throw new Error('Yedek dosyası bulunamadı');

  const result = await dialog.showSaveDialog(mainWindow, {
    title: 'Yedeği farklı kaydet',
    defaultPath: safeName,
    filters: [{ name: 'SQLite Veritabanı', extensions: ['db'] }],
  });
  if (result.canceled || !result.filePath) return null;
  fs.copyFileSync(srcPath, result.filePath);
  console.log('[backup] Yedek dışa aktarıldı:', result.filePath);
  return result.filePath;
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('before-quit', () => {
  callerIdHelperStopped = true;
  if (callerIdHelperRestartTimer) {
    clearTimeout(callerIdHelperRestartTimer);
    callerIdHelperRestartTimer = null;
  }
  if (callerIdHelperProcess && !callerIdHelperProcess.killed) {
    killProcess(callerIdHelperProcess);
    forceKillAfterTimeout(callerIdHelperProcess);
  }
  if (serverProcess && !serverProcess.killed) {
    killProcess(serverProcess);
    forceKillAfterTimeout(serverProcess);
  }
  bridgeStopped = true;
  bridgeRestartCount = 0;
  if (bridgeRestartTimer) { clearTimeout(bridgeRestartTimer); bridgeRestartTimer = null; }
  if (bridgeProcess && !bridgeProcess.killed) {
    killProcess(bridgeProcess);
    forceKillAfterTimeout(bridgeProcess);
  }
  if (logStream) {
    try {
      logStream.end();
    } catch {
      /* ignore */
    }
    logStream = null;
  }
});
