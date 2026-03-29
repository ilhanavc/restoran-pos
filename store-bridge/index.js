#!/usr/bin/env node
import { loadConfig } from './config.js';
import { createApiClient } from './apiClient.js';
import { startJobPoller } from './jobs/poller.js';
import { Cid812Provider } from './callerid/Cid812Provider.js';

async function main() {
  const cfg = loadConfig();
  const api = createApiClient(cfg);

  const health = await api.health();
  console.log('[store-bridge] health:', health);

  const cid = new Cid812Provider({ apiBase: cfg.apiBase });
  cid.start();

  const stopPoller = startJobPoller({ api, cfg, log: console });

  const shutdown = () => {
    console.log('[store-bridge] kapanıyor...');
    cid.stop();
    stopPoller();
    process.exit(0);
  };
  process.on('SIGINT', shutdown);
  process.on('SIGTERM', shutdown);

  console.log(
    `[store-bridge] çalışıyor poll=${cfg.pollIntervalMs}ms dryRun=${cfg.dryRun} api=${cfg.apiBase}`,
  );
}

main().catch((e) => {
  console.error('[store-bridge]', e);
  process.exit(1);
});
