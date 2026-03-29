/**
 * Ortam değişkenleri (ör. PowerShell):
 *   $env:BRIDGE_TOKEN="..."; $env:BRIDGE_BUSINESS_ID="..."; $env:API_BASE="http://127.0.0.1:3001/api"
 *   $env:DISABLE_PRINT_JOB_MOCK="true"   # sunucu tarafında mock kapat
 * store-bridge için:
 *   POLL_INTERVAL_MS, BRIDGE_DRY_RUN=1 (yazıcıya göndermeden printed işaretle)
 * CID812 (opsiyonel):
 *   CID812_ENABLED=0|1, CID812_PORT=COM3, CID812_BAUDRATE=9600
 *   CID812_DATABITS=8, CID812_STOPBITS=1, CID812_PARITY=none|even|odd
 *   CID812_DEBOUNCE_MS=3500
 *   CID812_PHONE_REGEX=... (üretici formatı biliniyorsa tek capture grubu = numara; yoksa boş bırak, sadece ham log)
 *   CID812_LOG_HEX=0|1
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

  const cid812Enabled = req('CID812_ENABLED') === '1' || req('CID812_ENABLED') === 'true';
  const cid812Port = req('CID812_PORT', '');
  const cid812BaudRate = Math.max(300, parseInt(req('CID812_BAUDRATE', '9600'), 10) || 9600);
  const cid812DataBits = Math.min(8, Math.max(5, parseInt(req('CID812_DATABITS', '8'), 10) || 8));
  const cid812StopBits = req('CID812_STOPBITS', '1') === '2' ? 2 : 1;
  const cid812Parity = (req('CID812_PARITY', 'none') || 'none').toLowerCase();
  const cid812DebounceMs = Math.max(500, parseInt(req('CID812_DEBOUNCE_MS', '3500'), 10) || 3500);
  const cid812PhoneRegex = req('CID812_PHONE_REGEX', '');
  const cid812LogHex = req('CID812_LOG_HEX') === '1' || req('CID812_LOG_HEX') === 'true';

  return {
    apiBase,
    token,
    businessId,
    pollIntervalMs,
    dryRun,
    claimId,
    socketTimeoutMs,
    cid812Enabled,
    cid812Port,
    cid812BaudRate,
    cid812DataBits,
    cid812StopBits,
    cid812Parity,
    cid812DebounceMs,
    cid812PhoneRegex,
    cid812LogHex,
  };
}
