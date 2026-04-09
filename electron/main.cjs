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
  if (b.claimId) env.BRIDGE_CLAIM_ID = String(b.claimId);
  if (b.socketTimeoutMs != null) env.PRINT_SOCKET_TIMEOUT_MS = String(b.socketTimeoutMs);
  // ESC t kod sayfası: 12 = PC857 (Turkish), 28 = WPC1254 — yazıcı modeline göre ayarla
  if (b.printEscT != null) env.BRIDGE_PRINT_ESC_T = String(b.printEscT);

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

  console.log(`[electron] Store Bridge başlatıldı pid=${child.pid} api=http://127.0.0.1:${port}/api`);
}

function scheduleBridgeRestart(port, restartMs) {
  if (bridgeStopped) return;
  if (bridgeRestartTimer) clearTimeout(bridgeRestartTimer);
  console.log(`[electron] Store Bridge ${restartMs / 1000} s sonra yeniden başlatılacak...`);
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

/**
 * pos.db'yi userData/backups/pos-YYYY-MM-DD.db olarak kopyalar.
 * Günde bir kez alır (aynı gün yedek varsa atlar).
 * 30 günden eski yedekleri temizler.
 */
function performBackup(dbPath) {
  const backupsDir = path.join(app.getPath('userData'), 'backups');
  try {
    if (!fs.existsSync(dbPath)) {
      console.warn('[backup] Veritabanı bulunamadı, yedek atlandı:', dbPath);
      return;
    }
    if (!fs.existsSync(backupsDir)) {
      fs.mkdirSync(backupsDir, { recursive: true });
    }
    const dateStr = new Date().toISOString().slice(0, 10); // YYYY-MM-DD
    const backupPath = path.join(backupsDir, `pos-${dateStr}.db`);
    if (fs.existsSync(backupPath)) {
      console.log('[backup] Bugünkü yedek zaten mevcut:', backupPath);
      return;
    }
    fs.copyFileSync(dbPath, backupPath);
    console.log('[backup] ✅ Veritabanı yedeklendi:', backupPath);
    cleanOldBackups(backupsDir);
  } catch (e) {
    console.error('[backup] Yedekleme hatası:', e && e.message ? e.message : String(e));
  }
}

function cleanOldBackups(backupsDir) {
  try {
    const cutoffMs = Date.now() - BACKUP_KEEP_DAYS * 24 * 60 * 60 * 1000;
    for (const file of fs.readdirSync(backupsDir)) {
      if (!file.startsWith('pos-') || !file.endsWith('.db')) continue;
      const fp = path.join(backupsDir, file);
      try {
        if (fs.statSync(fp).mtimeMs < cutoffMs) {
          fs.unlinkSync(fp);
          console.log('[backup] Eski yedek silindi:', file);
        }
      } catch { /* dosya silinemezse atla */ }
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
  performBackup(dbPath);

  const msFirst = msUntilNextBackupHour();
  console.log(`[backup] Sonraki otomatik yedek: ${Math.round(msFirst / 60000)} dakika sonra (gece ${BACKUP_HOUR}:00)`);

  backupTimer = setTimeout(() => {
    performBackup(dbPath);
    backupTimer = setInterval(() => performBackup(dbPath), 24 * 60 * 60 * 1000);
    backupTimer?.unref?.();
  }, msFirst);
  backupTimer?.unref?.();
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
  // app.getName() varsayılan olarak package.json "name" alanını döndürür ("restoran-pos").
  // app.getPath('userData') bunu kullandığı için %APPDATA%\restoran-pos\ olur.
  // Kullanıcıya görünen doğru ad ("Restoran POS") ile userData yolunu garantile.
  app.setName('Restoran POS');

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
    const port = await startServerAndWaitForHealth(userDataDbPath);
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
  if (bridgeRestartTimer) { clearTimeout(bridgeRestartTimer); bridgeRestartTimer = null; }
  if (bridgeProcess && !bridgeProcess.killed) {
    killProcess(bridgeProcess);
    forceKillAfterTimeout(bridgeProcess);
  }
});
