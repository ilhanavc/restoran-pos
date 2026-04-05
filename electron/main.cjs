/**
 * Electron main: child process'te Express (server/index.js), BrowserWindow ile http://127.0.0.1:PORT
 * Express kodu Electron içine gömülmez; file:// kullanılmaz.
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
/** @type {BrowserWindow | null} */
let mainWindow = null;

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
  const p = process.env.POS_PORT || process.env.PORT || String(DEFAULT_PORT);
  return parseInt(String(p), 10);
}

/**
 * @param {number} port
 * @param {string} absoluteDbPath — backend `resolveDbPath` ile uyumlu mutlak SQLite yolu (Electron: userData)
 * @param {string} codeRoot — getCodeRoot() (asar veya repo kökü)
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
  // JWT_SECRET: dışarıdan set edilmişse kullan, yoksa her başlangıçta güvenli rastgele üret
  env.JWT_SECRET = process.env.JWT_SECRET || require('crypto').randomBytes(64).toString('hex');
  return env;
}

/**
 * userData'da pos.db yoksa ve proje altında legacy DB varsa, bir kez güvenli kopya.
 * userData'da pos.db varsa hiçbir şey yapılmaz (üzerine yazılmaz).
 * Kopya başarısız olursa oluşturulan hedef dosyalar geri alınır.
 *
 * @param {string} userDataDbPath — örn. .../userData/pos.db
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

function killServerProcess(child) {
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
      reject(new Error(`Geçersiz port: ${process.env.POS_PORT || process.env.PORT}`));
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
      killServerProcess(child);
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

app.whenReady().then(async () => {
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
    killServerProcess(serverProcess);
    forceKillAfterTimeout(serverProcess);
  }
});
