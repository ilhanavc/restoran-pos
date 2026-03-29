/**
 * Ortam değişkenleri (ör. PowerShell):
 *   $env:BRIDGE_TOKEN="..."; $env:BRIDGE_BUSINESS_ID="..."; $env:API_BASE="http://127.0.0.1:3001/api"
 *   $env:DISABLE_PRINT_JOB_MOCK="true"   # sunucu tarafında mock kapat
 * store-bridge için:
 *   POLL_INTERVAL_MS, BRIDGE_DRY_RUN=1 (yazıcıya göndermeden printed işaretle)
 */

function req(name, fallback = '') {
  const v = process.env[name];
  return v != null && String(v).trim() !== '' ? String(v).trim() : fallback;
}

export function loadConfig() {
  const apiBase = req('API_BASE', 'http://127.0.0.1:3001/api').replace(/\/$/, '');
  const token = req('BRIDGE_TOKEN');
  const businessId = req('BRIDGE_BUSINESS_ID');
  const pollIntervalMs = Math.max(500, parseInt(req('POLL_INTERVAL_MS', '2000'), 10) || 2000);
  const dryRun = req('BRIDGE_DRY_RUN') === '1' || req('BRIDGE_DRY_RUN') === 'true';
  const claimId = req('BRIDGE_CLAIM_ID', 'store-bridge');
  const socketTimeoutMs = Math.max(1000, parseInt(req('PRINT_SOCKET_TIMEOUT_MS', '8000'), 10) || 8000);

  if (!token) {
    throw new Error('BRIDGE_TOKEN gerekli');
  }
  if (!businessId) {
    throw new Error('BRIDGE_BUSINESS_ID gerekli (POS veritabanındaki businesses.id ile aynı olmalı)');
  }

  return {
    apiBase,
    token,
    businessId,
    pollIntervalMs,
    dryRun,
    claimId,
    socketTimeoutMs,
  };
}
