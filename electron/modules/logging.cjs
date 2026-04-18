const { app } = require('electron');
const path = require('path');
const fs = require('fs');

let logStream = null;
let bridgeLogStream = null;

function formatLogArg(arg) {
  if (arg instanceof Error) return `${arg.stack || arg.message}`;
  if (typeof arg === 'string') return arg;
  try { return JSON.stringify(arg); } catch { return String(arg); }
}

function writeCrashLog(type, err) {
  try {
    const logsDir = path.join(app.getPath('userData'), 'logs');
    fs.mkdirSync(logsDir, { recursive: true });
    const entry = JSON.stringify({
      ts: new Date().toISOString(), type,
      message: err?.message || String(err),
      stack: err?.stack || null,
      version: app.getVersion?.() || null,
      platform: process.platform,
      arch: process.arch,
    }) + '\n';
    fs.appendFileSync(path.join(logsDir, 'crashes.log'), entry);
  } catch { /* crash reporter must never crash */ }
}

function setupBridgeFileLogging(logsDir) {
  const maxSize = 5 * 1024 * 1024;
  const logPath = path.join(logsDir, 'store-bridge.log');
  try {
    if (fs.existsSync(logPath) && fs.statSync(logPath).size > maxSize) {
      const oldPath = path.join(logsDir, 'store-bridge.old.log');
      if (fs.existsSync(oldPath)) fs.unlinkSync(oldPath);
      fs.renameSync(logPath, oldPath);
    }
  } catch { /* rotation failure is non-fatal */ }
  bridgeLogStream = fs.createWriteStream(logPath, { flags: 'a' });
  console.log('[electron] bridge log file:', logPath);
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
    try { logStream?.write(line); } catch { /* logging must never crash the app */ }
  };

  console.log = (...args) => { write('info', args); original.log(...args); };
  console.warn = (...args) => { write('warn', args); original.warn(...args); };
  console.error = (...args) => { write('error', args); original.error(...args); };

  process.on('uncaughtException', (err) => {
    console.error('[electron] uncaughtException', err);
    writeCrashLog('uncaughtException', err);
  });
  process.on('unhandledRejection', (reason) => {
    console.error('[electron] unhandledRejection', reason);
    writeCrashLog('unhandledRejection', reason instanceof Error ? reason : new Error(String(reason)));
  });

  console.log('[electron] log file:', logPath);
  setupBridgeFileLogging(logsDir);
}

function writeBridgeLog(level, text) {
  if (!bridgeLogStream) return;
  try {
    const ts = new Date().toISOString();
    const lines = String(text).split(/\r?\n/).filter(Boolean);
    for (const line of lines) {
      bridgeLogStream.write(`[${ts}] [${level}] ${line}\n`);
    }
  } catch { /* logging must never crash the app */ }
}

function initSentry(dsn, version) {
  if (!dsn) return;
  try {
    const Sentry = require('@sentry/electron/main');
    Sentry.init({
      dsn,
      release: `restoran-pos@${version || 'unknown'}`,
      environment: process.env.NODE_ENV === 'development' ? 'development' : 'production',
      beforeSend(event) { delete event.user; return event; },
    });
    console.log('[sentry] remote crash reporter active');
  } catch (e) {
    console.warn('[sentry] init failed:', e?.message);
  }
}

function closeLogs() {
  if (bridgeLogStream) {
    try { bridgeLogStream.end(); } catch { /* ignore */ }
    bridgeLogStream = null;
  }
  if (logStream) {
    try { logStream.end(); } catch { /* ignore */ }
    logStream = null;
  }
}

module.exports = { setupFileLogging, writeBridgeLog, writeCrashLog, initSentry, closeLogs };
