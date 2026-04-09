#!/usr/bin/env node
import { loadConfig } from './config.js';
import { createApiClient } from './apiClient.js';
import { startJobPoller } from './jobs/poller.js';
import { Cid812Provider } from './callerid/Cid812Provider.js';
import { discoverWindowsPrinters } from './printers/windowsDiscovery.js';

function startDiscoveryLoop({ api, log }) {
  let closed = false;
  let lastRequestId = null;

  async function scanAndPublish(requestId = null) {
    try {
      const printers = await discoverWindowsPrinters();
      await api.postDiscoveredPrinters({
        printers,
        requestId,
        scanState: printers.length ? 'success' : 'empty',
      });
      log.info?.(`[store-bridge] discovery updated printers=${printers.length}`);
    } catch (err) {
      log.error?.('[store-bridge] discovery failed', err?.message || err);
      try {
        await api.postDiscoveredPrinters({
          printers: [],
          requestId,
          scanState: 'bridge_unreachable',
          lastErrorCode: 'powershell_scan_failed',
        });
      } catch (reportErr) {
        log.error?.('[store-bridge] discovery error report failed', reportErr?.message || reportErr);
      }
    }
  }

  async function tick() {
    if (closed) return;
    try {
      const task = await api.getDiscoveryRefreshRequest();
      const reqState = task?.request;
      if (reqState?.status === 'requested' && reqState?.requestId && reqState.requestId !== lastRequestId) {
        lastRequestId = reqState.requestId;
        await scanAndPublish(reqState.requestId);
        return;
      }
    } catch (err) {
      log.error?.('[store-bridge] discovery request poll failed', err?.message || err);
    }
  }

  scanAndPublish().catch(() => {});
  const timer = setInterval(() => {
    tick().catch(() => {});
  }, 2000);

  return () => {
    closed = true;
    clearInterval(timer);
  };
}

async function main() {
  const cfg = loadConfig();
  // Renderer tarafında tek mağaza saat dilimini deterministik kullan.
  process.env.BRIDGE_STORE_TIMEZONE = cfg.storeTimezone;
  if (cfg.printEscT != null) process.env.BRIDGE_PRINT_ESC_T = String(cfg.printEscT);
  process.env.BRIDGE_PRINT_CHAR_FALLBACK = String(cfg.printCharFallback || 'transliterate');
  process.env.BRIDGE_PRINT_FORCE_TR_ASCII = String(cfg.printForceTrAscii || '0');
  const api = createApiClient(cfg);

  const health = await api.health();
  console.log('[store-bridge] health:', health);

  const cid = new Cid812Provider({ api, cfg, log: console });
  cid.start();

  const stopPoller = startJobPoller({ api, cfg, log: console });
  const stopDiscoveryLoop = startDiscoveryLoop({ api, log: console });

  const shutdown = () => {
    console.log('[store-bridge] kapanıyor...');
    cid.stop();
    stopPoller();
    stopDiscoveryLoop();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(
    `[store-bridge] çalışıyor poll=${cfg.pollIntervalMs}ms dryRun=${cfg.dryRun} api=${cfg.apiBase} esc_t=${process.env.BRIDGE_PRINT_ESC_T || 'default(12)'} fallback=${process.env.BRIDGE_PRINT_CHAR_FALLBACK} forceTrAscii=${process.env.BRIDGE_PRINT_FORCE_TR_ASCII} cid812=${cfg.cid812Enabled ? `on mode=${cfg.cid812Mode}` : 'off'}`,
  );
}

main().catch((e) => {
  console.error('[store-bridge]', e);
  process.exit(1);
});
