const { app } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');
const http = require('http');

const {
  getCodeRoot, getServerEntryPath, getServerSpawnCwd, getTargetPort, buildChildEnv,
} = require('./config.cjs');
const { killProcess } = require('./processUtils.cjs');

const HEALTH_HOST = '127.0.0.1';
const HEALTH_PATH = '/api/health';
const HEALTH_TIMEOUT_MS = 45000;
const HEALTH_INTERVAL_MS = 200;

/** @type {import('child_process').ChildProcessWithoutNullStreams | null} */
let serverProcess = null;

function getServerProcess() { return serverProcess; }

function httpHealthCheck(port) {
  return new Promise((resolve, reject) => {
    const req = http.request(
      { hostname: HEALTH_HOST, port, path: HEALTH_PATH, method: 'GET', timeout: 3000 },
      (res) => {
        res.resume();
        if (res.statusCode === 200) resolve();
        else reject(new Error(`Health yanıtı: HTTP ${res.statusCode}`));
      },
    );
    req.on('error', reject);
    req.on('timeout', () => { req.destroy(); reject(new Error('Health isteği zaman aşımı')); });
    req.end();
  });
}

function waitForHealth(port) {
  const deadline = Date.now() + HEALTH_TIMEOUT_MS;
  return new Promise((resolve, reject) => {
    const tick = async () => {
      if (Date.now() > deadline) {
        reject(new Error(
          `${HEALTH_TIMEOUT_MS / 1000} sn içinde /api/health yanıt vermedi. Port ${port} dinlenmiyor olabilir veya sunucu hata veriyor.`,
        ));
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
      reject(new Error(`Geçersiz port: ${port}`));
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

    child.stdout.on('data', (d) => { process.stdout.write(`[pos-api] ${d}`); });
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
          ? ` Port ${port} başka bir program tarafından kullanılıyor olabilir.`
          : ` ${stderrBuf.slice(-1200)}`;
      fail(new Error(
        `API süreci beklenmedik şekilde kapandı (kod: ${code ?? 'null'}, sinyal: ${signal ?? 'yok'}).${hint}`,
      ));
    });

    waitForHealth(port)
      .then(() => {
        child.removeAllListeners('exit');
        child.on('exit', () => { serverProcess = null; });
        succeed();
      })
      .catch((err) => { fail(err); });
  });
}

function stopServerProcess() {
  if (serverProcess && !serverProcess.killed) {
    const { forceKillAfterTimeout } = require('./processUtils.cjs');
    killProcess(serverProcess);
    forceKillAfterTimeout(serverProcess);
  }
}

module.exports = { startServerAndWaitForHealth, stopServerProcess, getServerProcess, HEALTH_HOST };
