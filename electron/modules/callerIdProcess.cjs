const { app } = require('electron');
const { spawn } = require('child_process');
const path = require('path');
const fs = require('fs');

const { getToolsRoot, getPosConfig } = require('./config.cjs');
const { killProcess, forceKillAfterTimeout } = require('./processUtils.cjs');

/** @type {import('child_process').ChildProcessWithoutNullStreams | null} */
let callerIdHelperProcess = null;
/** @type {NodeJS.Timeout | null} */
let callerIdHelperRestartTimer = null;
let callerIdHelperStopped = false;

function startCallerIdHelper(port, apiBaseUrl = null) {
  if (callerIdHelperStopped) return;

  const posConfig = getPosConfig();
  const toolsRoot = getToolsRoot();
  const helperDir = path.join(toolsRoot, 'callerid-sdk-helper');

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
  const apiBase = apiBaseUrl
    ? `${String(apiBaseUrl).replace(/\/$/, '')}/api`
    : `http://127.0.0.1:${port}/api`;

  let cmd, args, spawnCwd;
  if (isPackaged) {
    const dllPath = path.join(process.resourcesPath, 'tools', 'callerid-sdk-helper', 'cidshow_x64', 'cid.dll');
    cmd = exePath;
    args = [
      '--bridge-token', token,
      '--post-enabled', 'true',
      '--api-base', apiBase,
      '--dll-path', dllPath,
    ];
    spawnCwd = helperDir;
  } else {
    cmd = 'dotnet';
    args = [
      'run', '--project', csprojPath, '--',
      '--bridge-token', token,
      '--post-enabled', 'true',
      '--api-base', apiBase,
    ];
    spawnCwd = helperDir;
  }

  console.log('[electron] CallerIdSdkHelper başlatılıyor...');
  if (isPackaged) console.log('[electron] CallerIdSdkHelper exe:', exePath);

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
    scheduleCallerIdHelperRestart(port, restartMs, apiBaseUrl);
  });

  child.on('exit', (code) => {
    callerIdHelperProcess = null;
    console.log(`[electron] CallerIdSdkHelper kapandı (kod: ${code ?? 'null'})`);
    if (!callerIdHelperStopped) scheduleCallerIdHelperRestart(port, restartMs, apiBaseUrl);
  });

  console.log(`[electron] CallerIdSdkHelper başlatıldı pid=${child.pid}`);
}

function scheduleCallerIdHelperRestart(port, restartMs, apiBaseUrl = null) {
  if (callerIdHelperStopped) return;
  if (callerIdHelperRestartTimer) clearTimeout(callerIdHelperRestartTimer);
  console.log(`[electron] CallerIdSdkHelper ${restartMs / 1000} s sonra yeniden başlatılacak...`);
  callerIdHelperRestartTimer = setTimeout(() => {
    callerIdHelperRestartTimer = null;
    startCallerIdHelper(port, apiBaseUrl);
  }, restartMs);
  callerIdHelperRestartTimer.unref?.();
}

function stopCallerIdHelper() {
  callerIdHelperStopped = true;
  if (callerIdHelperRestartTimer) { clearTimeout(callerIdHelperRestartTimer); callerIdHelperRestartTimer = null; }
  if (callerIdHelperProcess && !callerIdHelperProcess.killed) {
    killProcess(callerIdHelperProcess);
    forceKillAfterTimeout(callerIdHelperProcess);
  }
}

module.exports = { startCallerIdHelper, stopCallerIdHelper };
