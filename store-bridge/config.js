/**
 * Ortam değişkenleri (ör. PowerShell):
 *   $env:BRIDGE_TOKEN="..."; $env:BRIDGE_BUSINESS_ID="..."; $env:API_BASE="http://127.0.0.1:3001/api"
 *
 * store-bridge:
 *   POLL_INTERVAL_MS, BRIDGE_DRY_RUN=1 (yazıcıya göndermeden printed işaretle)
 *
 * CID812:
 *   CID812_ENABLED=0|1
 *   CID812_MODE=hid|clipboard (varsayılan: hid)
 *     - hid: USB HID cihazdan doğrudan okuma (üretim modu)
 *     - hid-experimental: hid ile aynı davranış (geriye dönük uyumluluk)
 *     - clipboard: cihaz okuma dış araç/script ile yapılır; bridge sadece print poller gibi çalışır
 *
 * HID modu için ek env'ler:
 *   CID812_HID_VID=C0F4 (veya "C0F4,1A86" gibi CSV)
 *   CID812_HID_PID=01F5 (veya CSV)
 *   CID812_HID_SERIAL=4C27A9624
 *   CID812_RECONNECT_INTERVAL_MS=5000  — bağlantı kopukluğunda yeniden bağlanma aralığı
 *   CID812_ENABLE_PARSE=0|1 (varsayılan 0)
 *   CID812_PHONE_REGEX=... (varsa parse denenecek; tipik olarak tek capture grubu = numara)
 *   CID812_DEBOUNCE_MS=3500
 *   CID812_LOG_HEX=0|1
 *   CID812_TRACE_MODE=0|1
 *   CID812_TRACE_OFFSETS=18-21,29-31,51-53,63
 *   CID812_TRACE_SAMPLE_WINDOW=10
 *   CID812_TRANSITION_MODE=0|1
 *   CID812_TRANSITION_WINDOW=10
 *   CID812_TRANSITION_MIN_GAP_MS=1500
 *   CID812_TRANSITION_TOPN=12
 *   CID812_TRANSITION_VERBOSE_TABLE=0|1
 *   CID812_CANDIDATE_MODE=0|1
 *   CID812_CANDIDATE_SUMMARY_EVERY=5
 *   CID812_CANDIDATE_TOPN=8
 */

function req(name, fallback = '') {
  const v = process.env[name];
  return v != null && String(v).trim() !== '' ? String(v).trim() : fallback;
}

function parseEscT(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(255, Math.trunc(n)));
}

export function loadConfig() {
  const apiBase = req('API_BASE', 'http://127.0.0.1:3001/api').replace(/\/$/, '');
  const token = req('BRIDGE_TOKEN');
  const businessId = req('BRIDGE_BUSINESS_ID');
  const pollIntervalMs = Math.max(500, parseInt(req('POLL_INTERVAL_MS', '2000'), 10) || 2000);
  const dryRun = req('BRIDGE_DRY_RUN') === '1' || req('BRIDGE_DRY_RUN') === 'true';
  const claimId = req('BRIDGE_CLAIM_ID', 'store-bridge');
  const socketTimeoutMs = Math.max(1000, parseInt(req('PRINT_SOCKET_TIMEOUT_MS', '8000'), 10) || 8000);
  const storeTimezone = req('STORE_TIMEZONE', req('BRIDGE_STORE_TIMEZONE', 'Europe/Istanbul'));
  const printEscT = parseEscT(req('BRIDGE_PRINT_ESC_T', ''));
  const printCharFallback = req('BRIDGE_PRINT_CHAR_FALLBACK', 'transliterate').toLowerCase();
  const printForceTrAscii = req('BRIDGE_PRINT_FORCE_TR_ASCII', '0');

  if (!token) {
    throw new Error('BRIDGE_TOKEN gerekli');
  }
  if (!businessId) {
    throw new Error('BRIDGE_BUSINESS_ID gerekli (POS veritabanındaki businesses.id ile aynı olmalı)');
  }

  const cid812Enabled = req('CID812_ENABLED') === '1' || req('CID812_ENABLED') === 'true';
  // Varsayılan mod: hid (USB HID cihazdan doğrudan okuma)
  const cid812Mode = req('CID812_MODE', 'hid').toLowerCase();
  const cid812HidVid = req('CID812_HID_VID', 'C0F4');
  const cid812HidPid = req('CID812_HID_PID', '01F5');
  const cid812HidSerial = req('CID812_HID_SERIAL', '');
  const cid812ReconnectIntervalMs = Math.max(
    1000,
    parseInt(req('CID812_RECONNECT_INTERVAL_MS', '5000'), 10) || 5000,
  );

  const cid812EnableParse = req('CID812_ENABLE_PARSE') === '1' || req('CID812_ENABLE_PARSE') === 'true';
  const cid812DebounceMs = Math.max(500, parseInt(req('CID812_DEBOUNCE_MS', '3500'), 10) || 3500);
  const cid812PhoneRegex = req('CID812_PHONE_REGEX', '');
  const cid812LogHex = req('CID812_LOG_HEX') === '1' || req('CID812_LOG_HEX') === 'true';
  const cid812TraceMode = req('CID812_TRACE_MODE') === '1' || req('CID812_TRACE_MODE') === 'true';
  const cid812TraceOffsets = req('CID812_TRACE_OFFSETS', '18-21,29-31,51-53,63');
  const cid812TraceSampleWindow = Math.max(
    1,
    parseInt(req('CID812_TRACE_SAMPLE_WINDOW', '10'), 10) || 10,
  );
  const cid812TransitionMode = req('CID812_TRANSITION_MODE') === '1' || req('CID812_TRANSITION_MODE') === 'true';
  const cid812TransitionWindow = Math.max(
    2,
    parseInt(req('CID812_TRANSITION_WINDOW', '10'), 10) || 10,
  );
  const cid812TransitionMinGapMs = Math.max(
    0,
    parseInt(req('CID812_TRANSITION_MIN_GAP_MS', '1500'), 10) || 1500,
  );
  const cid812TransitionTopN = Math.max(
    1,
    parseInt(req('CID812_TRANSITION_TOPN', '12'), 10) || 12,
  );
  const cid812TransitionVerboseTable =
    req('CID812_TRANSITION_VERBOSE_TABLE') === '1' || req('CID812_TRANSITION_VERBOSE_TABLE') === 'true';
  const cid812CandidateMode = req('CID812_CANDIDATE_MODE') === '1' || req('CID812_CANDIDATE_MODE') === 'true';
  const cid812CandidateSummaryEvery = Math.max(
    1,
    parseInt(req('CID812_CANDIDATE_SUMMARY_EVERY', '5'), 10) || 5,
  );
  const cid812CandidateTopN = Math.max(
    1,
    parseInt(req('CID812_CANDIDATE_TOPN', '8'), 10) || 8,
  );

  // Legacy/compat
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
    storeTimezone,
    printEscT,
    printCharFallback,
    printForceTrAscii,
    cid812Enabled,
    cid812Mode,
    cid812HidVid,
    cid812HidPid,
    cid812HidSerial,
    cid812ReconnectIntervalMs,
    cid812EnableParse,
    cid812DebounceMs,
    cid812PhoneRegex,
    cid812LogHex,
    cid812TraceMode,
    cid812TraceOffsets,
    cid812TraceSampleWindow,
    cid812TransitionMode,
    cid812TransitionWindow,
    cid812TransitionMinGapMs,
    cid812TransitionTopN,
    cid812TransitionVerboseTable,
    cid812CandidateMode,
    cid812CandidateSummaryEvery,
    cid812CandidateTopN,

    // Legacy/compat
    cid812Port,
    cid812BaudRate,
    cid812DataBits,
    cid812StopBits,
    cid812Parity,
  };
}
