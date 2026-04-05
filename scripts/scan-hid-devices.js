#!/usr/bin/env node
/**
 * CID812 VID/PID Tarayıcı
 *
 * Kullanım:
 *   node scripts/scan-hid-devices.js
 *   node scripts/scan-hid-devices.js --vid C0F4
 *   node scripts/scan-hid-devices.js --vid C0F4 --pid 01F5
 *   node scripts/scan-hid-devices.js --all          (tüm HID cihazları listele)
 *
 * Not: node-hid store-bridge bağımlılığıdır.
 *   cd store-bridge && npm install   (henüz yapmadıysanız)
 */
'use strict';

const path = require('path');

// node-hid'i bul: önce global / yerel, sonra store-bridge/node_modules
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
const showAll = args.includes('--all');
const filterVid = getArg('--vid');
const filterPid = getArg('--pid');

function hexToInt(s) {
  if (!s) return null;
  const n = parseInt(String(s).replace(/^0x/i, ''), 16);
  return Number.isFinite(n) ? n : null;
}

const vidFilter = hexToInt(filterVid);
const pidFilter = hexToInt(filterPid);

// Bilinen CID812 VID/PID çiftleri
const KNOWN = [
  { vid: 0xc0f4, pid: 0x01f5, label: 'CID812 (tipik)' },
  { vid: 0x1a86, pid: 0xe010, label: 'CH9328 / CID812 alternatif' },
];

function isKnownCid(vid, pid) {
  return KNOWN.some((k) => k.vid === vid && k.pid === pid);
}

function labelOf(vid, pid) {
  const k = KNOWN.find((k) => k.vid === vid && k.pid === pid);
  return k ? k.label : '';
}

// ---------------------------------------------------------------------------
// Ana tarama
// ---------------------------------------------------------------------------
let devices;
try {
  devices = HID.devices();
} catch (e) {
  console.error('[hata] HID.devices() başarısız:', e.message || e);
  process.exit(1);
}

if (!devices || devices.length === 0) {
  console.log('Hiç HID cihazı bulunamadı.');
  process.exit(0);
}

// Filtrele
let filtered = devices;
if (!showAll) {
  filtered = devices.filter((d) => {
    if (vidFilter !== null && d.vendorId !== vidFilter) return false;
    if (pidFilter !== null && d.productId !== pidFilter) return false;
    // Filtre yok ve --all yok ise: sadece bilinen CID812 cihazları + kullanıcı arayanlar
    if (vidFilter === null && pidFilter === null) return isKnownCid(d.vendorId, d.productId);
    return true;
  });
}

console.log(`\nToplam HID cihaz: ${devices.length}  |  Gösterilen: ${filtered.length}`);

if (filtered.length === 0) {
  if (!showAll) {
    console.log('\nBilinen CID812 VID/PID ile eşleşen cihaz bulunamadı.');
    console.log('Tüm cihazları görmek için: node scripts/scan-hid-devices.js --all');
  } else {
    console.log('\nHiç cihaz bulunamadı.');
  }
  process.exit(0);
}

console.log('');
const COL = { vid: 6, pid: 6, usage: 10, serial: 18, product: 32, mfr: 24 };

const header = [
  'VID'.padEnd(COL.vid),
  'PID'.padEnd(COL.pid),
  'Usage'.padEnd(COL.usage),
  'Serial'.padEnd(COL.serial),
  'Product'.padEnd(COL.product),
  'Manufacturer'.padEnd(COL.mfr),
  'Path',
].join('  ');
console.log(header);
console.log('-'.repeat(header.length));

for (const d of filtered) {
  const vidHex = `0x${d.vendorId.toString(16).toUpperCase().padStart(4, '0')}`;
  const pidHex = `0x${d.productId.toString(16).toUpperCase().padStart(4, '0')}`;
  const usagePair = `${(d.usagePage || 0).toString(16).toUpperCase()}/${(d.usage || 0).toString(16).toUpperCase()}`;
  const known = labelOf(d.vendorId, d.productId);
  const marker = known ? ' ★' : '';
  const row = [
    vidHex.padEnd(COL.vid),
    pidHex.padEnd(COL.pid),
    usagePair.padEnd(COL.usage),
    (d.serialNumber || '-').slice(0, 16).padEnd(COL.serial),
    (d.product || '-').slice(0, 30).padEnd(COL.product),
    (d.manufacturer || '-').slice(0, 22).padEnd(COL.mfr),
    (d.path || '-'),
  ].join('  ');
  console.log(row + marker);
  if (known) console.log(`  → ${known}`);
}

console.log('\n★ = Bilinen CID812 cihazı');
console.log('\npos-config.json için örnek:');
if (filtered.length) {
  const best = filtered.find((d) => isKnownCid(d.vendorId, d.productId)) || filtered[0];
  console.log(JSON.stringify({
    callerid: {
      enabled: true,
      mode: 'hid',
      hid: {
        vid: best.vendorId.toString(16).toUpperCase().padStart(4, '0'),
        pid: best.productId.toString(16).toUpperCase().padStart(4, '0'),
        serial: best.serialNumber || '',
      },
    },
  }, null, 2));
}
