/**
 * Ortam değişkenleri (ör. PowerShell):
 *   $env:BRIDGE_TOKEN="..."; $env:BRIDGE_BUSINESS_ID="..."; $env:API_BASE="http://127.0.0.1:3001/api"
 *   $env:DISABLE_PRINT_JOB_MOCK="true"   # sunucu tarafında mock kapat
 * store-bridge için:
 *   POLL_INTERVAL_MS, BRIDGE_DRY_RUN=1 (yazıcıya göndermeden printed işaretle)
 *
 * CID812 (opsiyonel, HID tabanlı):
 *   CID812_ENABLED=0|1
 *   CID812_HID_VID=C0F4 (veya "C0F4,1A86" gibi CSV)
 *   CID812_HID_PID=01F5 (veya CSV)
 *   CID812_HID_SERIAL=4C27A9624
 *   CID812_ENABLE_PARSE=0|1 (ilk sürümde varsayılan 0)
 *   CID812_PHONE_REGEX=... (varsa parse denenecek; tipik olarak tek capture grubu = numara)
 *   CID812_DEBOUNCE_MS=3500
 *   CID812_LOG_HEX=0|1
 *
 * Not: serialport ile ilgili env’ler geriye dönük uyumluluk için okunur ama HID provider kullanılacaktır.
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
  const cid812HidVid = req('CID812_HID_VID', 'C0F4');
  const cid812HidPid = req('CID812_HID_PID', '01F5');
  const cid812HidSerial = req('CID812_HID_SERIAL', '4C27A9624');

  const cid812EnableParse = req('CID812_ENABLE_PARSE') === '1' || req('CID812_ENABLE_PARSE') === 'true';
  const cid812DebounceMs = Math.max(500, parseInt(req('CID812_DEBOUNCE_MS', '3500'), 10) || 3500);
  const cid812PhoneRegex = req('CID812_PHONE_REGEX', '');
  const cid812LogHex = req('CID812_LOG_HEX') === '1' || req('CID812_LOG_HEX') === 'true';

  // Legacy/compat (şimdilik HID provider kullanacak)
  const cid812Port = req('CID812_PORT', '');
  const cid812BaudRate = Math.max(300, parseInt(req('CID812_BAUDRATE', '9600'), 10) || 9600);
  const cid812DataBits = Math.min(8, Math.max(5, parseInt(req('CID812_DATABITS', '8'), 10) || 8));
  const cid812StopBits = req('CID812_STOPBITS', '1') === '2' ? 2 : 1;
  const cid812Parity = (req('CID812_PARITY', 'none') || 'none').toLowerCase();

  return {
    apiBase,
    token,
    businessId,
    pollIntervalMs,
    dryRun,
    claimId,
    socketTimeoutMs,
    cid812Enabled,
    cid812HidVid,
    cid812HidPid,
    cid812HidSerial,
    cid812EnableParse,
    cid812DebounceMs,
    cid812PhoneRegex,
    cid812LogHex,

    // Legacy/compat
    cid812Port,
    cid812BaudRate,
    cid812DataBits,
    cid812StopBits,
    cid812Parity,
  };
}
