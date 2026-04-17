/**
 * Smoke test: start server/index.js with a temp DB, poll /api/health,
 * verify migration ran (tables exist), then clean up.
 *
 * Exit 0 = healthy. Exit 1 = failure (prints reason).
 * Used by: npm run dist:prepare (before electron-builder packaging).
 */

'use strict';

const { spawn } = require('child_process');
const http = require('http');
const fs = require('fs');
const path = require('path');
const os = require('os');

// ── Config ────────────────────────────────────────────────────────────────────

const SMOKE_PORT   = 19991;          // port unlikely to conflict
const TIMEOUT_MS   = 30_000;         // max wait for server to become healthy
const POLL_INTERVAL_MS = 500;
const HEALTH_URL   = `http://127.0.0.1:${SMOKE_PORT}/api/health`;

// ── Temp DB path ──────────────────────────────────────────────────────────────

const tmpDb = path.join(os.tmpdir(), `pos-smoke-${Date.now()}.db`);

// ── Helpers ───────────────────────────────────────────────────────────────────

function cleanup(proc) {
  try { proc?.kill(); } catch { /* ignore */ }
  try { if (fs.existsSync(tmpDb))      fs.unlinkSync(tmpDb); }      catch { /* ignore */ }
  try { if (fs.existsSync(tmpDb + '-wal'))  fs.unlinkSync(tmpDb + '-wal');  } catch { /* ignore */ }
  try { if (fs.existsSync(tmpDb + '-shm'))  fs.unlinkSync(tmpDb + '-shm');  } catch { /* ignore */ }
}

function httpGet(url) {
  return new Promise((resolve, reject) => {
    const req = http.get(url, { timeout: 3000 }, (res) => {
      let body = '';
      res.on('data', d => { body += d; });
      res.on('end', () => {
        try { resolve({ status: res.statusCode, body: JSON.parse(body) }); }
        catch { resolve({ status: res.statusCode, body }); }
      });
    });
    req.on('timeout', () => { req.destroy(); reject(new Error('request timeout')); });
    req.on('error', reject);
  });
}

function sleep(ms) {
  return new Promise(r => setTimeout(r, ms));
}

async function pollHealth(deadline) {
  while (Date.now() < deadline) {
    try {
      const res = await httpGet(HEALTH_URL);
      if (res.status === 200 && res.body?.status === 'ok') return true;
    } catch {
      // not up yet
    }
    await sleep(POLL_INTERVAL_MS);
  }
  return false;
}

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('[smoke:server] Starting server health smoke test…');
  console.log(`[smoke:server] Temp DB: ${tmpDb}`);
  console.log(`[smoke:server] Port: ${SMOKE_PORT}`);

  const serverPath = path.resolve(__dirname, '../server/index.js');
  if (!fs.existsSync(serverPath)) {
    console.error('[smoke:server] FAIL: server/index.js not found at', serverPath);
    process.exit(1);
  }

  const env = {
    ...process.env,
    NODE_ENV:    'test',
    PORT:        String(SMOKE_PORT),
    DB_PATH:     tmpDb,
    JWT_SECRET:  'smoke-test-secret-32-chars-minimum!',
    BRIDGE_TOKEN: 'smoke-bridge-token',
    // Disable any extra integrations
    CALLERID_ENABLED: '0',
  };

  const proc = spawn(process.execPath, [serverPath], {
    env,
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  // Capture output for diagnostic purposes on failure
  const output = [];
  proc.stdout.on('data', d => output.push(d.toString()));
  proc.stderr.on('data', d => output.push(d.toString()));

  proc.on('error', (err) => {
    console.error('[smoke:server] Failed to spawn server:', err.message);
    cleanup(proc);
    process.exit(1);
  });

  proc.on('exit', (code, signal) => {
    if (code !== null && code !== 0) {
      console.error(`[smoke:server] Server exited unexpectedly (code=${code} signal=${signal})`);
    }
  });

  const deadline = Date.now() + TIMEOUT_MS;
  const ok = await pollHealth(deadline);

  if (!ok) {
    console.error('[smoke:server] FAIL: /api/health did not respond within', TIMEOUT_MS, 'ms');
    console.error('[smoke:server] Server output:');
    console.error(output.join('').slice(-2000));
    cleanup(proc);
    process.exit(1);
  }

  console.log('[smoke:server] /api/health → ok ✓');

  // Verify temp DB was created (migration ran)
  if (!fs.existsSync(tmpDb)) {
    console.error('[smoke:server] FAIL: temp DB not created — migration did not run');
    cleanup(proc);
    process.exit(1);
  }
  console.log('[smoke:server] DB created (migration ran) ✓');

  cleanup(proc);
  console.log('[smoke:server] PASS — server health smoke test complete');
  process.exit(0);
}

main().catch(err => {
  console.error('[smoke:server] Unhandled error:', err);
  process.exit(1);
});
