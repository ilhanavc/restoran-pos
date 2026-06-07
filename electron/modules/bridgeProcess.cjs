const { app } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const { getStoreBridgeRoot, buildBridgeEnv, getPosConfig } = require('./config.cjs');
const { killProcess, forceKillAfterTimeout } = require('./processUtils.cjs');
const { writeBridgeLog } = require('./logging.cjs');

const BRIDGE_MAX_RESTARTS = 10;

/** @type {import('child_process').ChildProcessWithoutNullStreams | null} */
let bridgeProcess = null;
/** @type {NodeJS.Timeout | null} */
let bridgeRestartTimer = null;
let bridgeStopped = false;
let bridgePort = 0;
let bridgeRestartCount = 0;

function getBridgeProcess() { return bridgeProcess; }

function startStoreBridge(port, apiBaseUrl = null) {
  const posConfig = getPosConfig();
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
      '[electron] Store Bridge: pos-config.json bridge.token + bridge.businessId gerekli. Yazıcı köprüsü atlanıyor.',
    );
    return;
  }

  const env = buildBridgeEnv(port, apiBaseUrl);
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

  child.stdout.on('data', (d) => { process.stdout.write(`[store-bridge] ${d}`); writeBridgeLog('info', d); });
  child.stderr.on('data', (d) => { process.stderr.write(`[store-bridge] ${d}`); writeBridgeLog('error', d); });

  child.on('exit', (code) => {
    bridgeProcess = null;
    console.log(`[electron] Store Bridge kapandı (kod: ${code ?? 'null'})`);
    if (!bridgeStopped) scheduleBridgeRestart(port, restartMs, apiBaseUrl);
  });
  child.on('error', (err) => {
    console.error('[electron] Store Bridge başlatılamadı:', err.message);
    bridgeProcess = null;
    if (!bridgeStopped) scheduleBridgeRestart(port, restartMs, apiBaseUrl);
  });

  bridgeRestartCount = 0;
  console.log(`[electron] Store Bridge başlatıldı pid=${child.pid} api=${env.API_BASE}`);
}

function scheduleBridgeRestart(port, restartMs, apiBaseUrl = null) {
  if (bridgeStopped) return;

  bridgeRestartCount += 1;
  if (bridgeRestartCount > BRIDGE_MAX_RESTARTS) {
    console.error(
      `[electron] Store Bridge ${BRIDGE_MAX_RESTARTS} kez art arda yeniden başlatıldı ve başarısız oldu.` +
      ' Otomatik yeniden başlatma durduruldu.',
    );
    return;
  }

  if (bridgeRestartTimer) clearTimeout(bridgeRestartTimer);
  console.log(
    `[electron] Store Bridge ${restartMs / 1000} s sonra yeniden başlatılacak... (deneme ${bridgeRestartCount}/${BRIDGE_MAX_RESTARTS})`,
  );
  bridgeRestartTimer = setTimeout(() => {
    bridgeRestartTimer = null;
    startStoreBridge(port, apiBaseUrl);
  }, restartMs);
  bridgeRestartTimer.unref?.();
}

function stopBridge() {
  bridgeStopped = true;
  bridgeRestartCount = 0;
  if (bridgeRestartTimer) { clearTimeout(bridgeRestartTimer); bridgeRestartTimer = null; }
  if (bridgeProcess && !bridgeProcess.killed) {
    killProcess(bridgeProcess);
    forceKillAfterTimeout(bridgeProcess);
  }
}

module.exports = { startStoreBridge, stopBridge, getBridgeProcess };
