#!/usr/bin/env node
/**
 * CID812 Ham Veri İzleyici
 *
 * Kullanım:
 *   node scripts/cid812-raw-monitor.js
 *   node scripts/cid812-raw-monitor.js --vid C0F4 --pid 01F5
 *   node scripts/cid812-raw-monitor.js --vid C0F4 --pid 01F5 --serial 4C27A9624
 *   node scripts/cid812-raw-monitor.js --trace 18-21,29-31   (belirli byte aralıklarını izle)
 *   node scripts/cid812-raw-monitor.js --ascii               (ASCII çıktısı ekle)
 *
 * Ctrl+C ile çıkılır.
 *
 * Not: node-hid store-bridge bağımlılığıdır.
 *   cd store-bridge && npm install   (henüz yapmadıysanız)
 */
'use strict';

const path = require('path');

// node-hid'i bul
let HID;
const candidates = [
  'node-hid',
  path.join(__dirname, '..', 'store-bridge', 'node_modules', 'node-hid'),
];
for (const c of candidates) {
  try {
    HID = require(c);
    break;
  } catch {
    /* dene */
  }
}
if (!HID) {
  console.error('[hata] node-hid bulunamadı. Önce: cd store-bridge && npm install');
  process.exit(1);
}

// ---------------------------------------------------------------------------
// Argüman ayrıştırma
// ---------------------------------------------------------------------------
const args = process.argv.slice(2);
const getArg = (flag) => {
  const i = args.indexOf(flag);
  return i !== -1 ? (args[i + 1] || '') : null;
};

function hexToInt(s) {
  if (!s) return null;
  const n = parseInt(String(s).replace(/^0x/i, ''), 16);
  return Number.isFinite(n) ? n : null;
}

const vidFilter = hexToInt(getArg('--vid'));
const pidFilter = hexToInt(getArg('--pid'));
const serialFilter = (getArg('--serial') || '').trim().toUpperCase();
const showAscii = args.includes('--ascii');
const traceRaw = getArg('--trace') || '';

// Trace aralıklarını ayrıştır: "18-21,29-31" → [[18,21],[29,31]]
function parseRanges(src) {
  return String(src || '').split(',').map((t) => t.trim()).filter(Boolean).map((t) => {
    const m = t.match(/^(\d+)(?:-(\d+))?$/);
    if (!m) return null;
    const a = Number(m[1]);
    const b = m[2] != null ? Number(m[2]) : a;
    return [Math.min(a, b), Math.max(a, b)];
  }).filter(Boolean);
}
const traceRanges = parseRanges(traceRaw);

// ---------------------------------------------------------------------------
// Cihaz seç
// ---------------------------------------------------------------------------
let devices;
try {
  devices = HID.devices();
} catch (e) {
  console.error('[hata] HID.devices() başarısız:', e.message || e);
  process.exit(1);
}

const DEFAULT_VID = 0xc0f4;
const DEFAULT_PID = 0x01f5;

const effectiveVid = vidFilter !== null ? vidFilter : DEFAULT_VID;
const effectivePid = pidFilter !== null ? pidFilter : DEFAULT_PID;

const matches = (devices || []).filter((d) => {
  if (d.vendorId !== effectiveVid) return false;
  if (d.productId !== effectivePid) return false;
  if (serialFilter && String(d.serialNumber || '').trim().toUpperCase() !== serialFilter) return false;
  return true;
});

if (!matches.length) {
  const vidHex = `0x${effectiveVid.toString(16).toUpperCase().padStart(4, '0')}`;
  const pidHex = `0x${effectivePid.toString(16).toUpperCase().padStart(4, '0')}`;
  console.error(`[hata] Cihaz bulunamadı: VID=${vidHex} PID=${pidHex}${serialFilter ? ` serial=${serialFilter}` : ''}`);
  console.error('Tüm HID cihazları görmek için: node scripts/scan-hid-devices.js --all');
  process.exit(1);
}

const selected = matches[0];
const vidHex = `0x${selected.vendorId.toString(16).toUpperCase().padStart(4, '0')}`;
const pidHex = `0x${selected.productId.toString(16).toUpperCase().padStart(4, '0')}`;

console.log(`[cid812-monitor] Cihaz: ${selected.product || '?'} | VID=${vidHex} PID=${pidHex} serial=${selected.serialNumber || '-'}`);
console.log(`[cid812-monitor] Path: ${selected.path || '?'}`);
if (traceRanges.length) {
  console.log(`[cid812-monitor] Trace aralıkları: ${traceRanges.map(([a, b]) => `${a}-${b}`).join(', ')}`);
}
console.log('[cid812-monitor] İzleniyor... (Ctrl+C ile çık)\n');

// ---------------------------------------------------------------------------
// HID aç ve izle
// ---------------------------------------------------------------------------
let device;
try {
  device = selected.path ? new HID.HID(selected.path) : new HID.HID(selected.vendorId, selected.productId);
} catch (e) {
  console.error('[hata] Cihaz açılamadı:', e.message || e);
  process.exit(1);
}

let frameCount = 0;
let lastHex = null;

function bytesToAscii(buf) {
  return Buffer.from(buf).toString('ascii').replace(/[^\x20-\x7E]/g, '.');
}

device.on('data', (data) => {
  frameCount += 1;
  const buf = Buffer.from(data || []);
  const ts = new Date().toISOString();
  const hex = buf.toString('hex');
  const changed = hex !== lastHex;
  lastHex = hex;

  // Temel satır
  const hexDisplay = hex.length > 128 ? `${hex.slice(0, 128)}…` : hex;
  console.log(`[${ts}] #${frameCount} len=${buf.length} chg=${changed ? 'Y' : 'N'} | ${hexDisplay}`);

  if (showAscii) {
    console.log(`  ascii: ${bytesToAscii(buf)}`);
  }

  // Trace aralıkları
  if (traceRanges.length) {
    const parts = [];
    for (const [s, e] of traceRanges) {
      const slice = Array.from(buf.subarray(s, Math.min(e + 1, buf.length)));
      if (!slice.length) continue;
      const h = slice.map((v) => v.toString(16).padStart(2, '0')).join(' ');
      const d = slice.join(' ');
      const a = bytesToAscii(Buffer.from(slice));
      parts.push(`  [${s}-${e}] hex=[${h}] dec=[${d}] ascii=[${a}]`);
    }
    if (parts.length) console.log(parts.join('\n'));
  }
});

device.on('error', (err) => {
  console.error('[cid812-monitor] Cihaz hatası:', err.message || err);
  process.exit(1);
});

device.on('close', () => {
  console.log('[cid812-monitor] Cihaz kapandı.');
  process.exit(0);
});

// Temiz çıkış
process.on('SIGINT', () => {
  console.log(`\n[cid812-monitor] Durduruluyor... Toplam kare: ${frameCount}`);
  try { device.close(); } catch { /* ignore */ }
  process.exit(0);
});
