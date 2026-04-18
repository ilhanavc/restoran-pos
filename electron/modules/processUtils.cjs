const { execFileSync } = require('child_process');

const KILL_FORCE_MS = 4000;

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
    try { child.kill('SIGKILL'); } catch { /* ignore */ }
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
      } catch { /* ignore */ }
    }
  }, KILL_FORCE_MS);
  t.unref();
}

module.exports = { killProcess, forceKillAfterTimeout };
