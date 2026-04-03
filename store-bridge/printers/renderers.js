/**
 * print_jobs.payload JSON → ESC/POS byte buffer.
 * 80 mm termal: sabit satır genişliği, hizalı metin; init + kesim korunur.
 */

import iconv from 'iconv-lite';

/** @type {number} 80 mm termal için tipik karakter genişliği (12 cpi civarı) */
const DEFAULT_LINE_WIDTH = 42;
const MIN_LINE_WIDTH = 32;
const MAX_LINE_WIDTH = 64;
const DEFAULT_ESC_T = 28; // WPC1254 (Turkish) - Epson compatible table index

/**
 * CP1254 yedek eşlemesi (iconv başarısız olursa).
 */
const CP1254_TR_MAP = new Map([
  ['Ğ', 0xd0],
  ['ğ', 0xf0],
  ['İ', 0xdd],
  ['ı', 0xfd],
  ['Ş', 0xde],
  ['ş', 0xfe],
]);

function concat(buffers) {
  return Buffer.concat(buffers.filter(Boolean));
}

function escInit() {
  return Buffer.from([0x1b, 0x40]);
}

function escSelectCodePage(n) {
  return Buffer.from([0x1b, 0x74, n & 0xff]);
}

function resolveEscT() {
  const raw = Number(process.env.BRIDGE_PRINT_ESC_T);
  if (Number.isFinite(raw)) {
    return Math.max(0, Math.min(255, Math.trunc(raw)));
  }
  return DEFAULT_ESC_T;
}

function resolveEncoding() {
  const enc = String(process.env.BRIDGE_PRINT_ENCODING || 'cp1254').trim().toLowerCase();
  if (enc === 'utf8' || enc === 'utf-8') return 'utf8';
  return 'cp1254';
}

function encodeCp1254Fallback(text) {
  const src = String(text ?? '');
  const bytes = [];
  for (const ch of src) {
    if (CP1254_TR_MAP.has(ch)) {
      bytes.push(CP1254_TR_MAP.get(ch));
      continue;
    }
    const cp = ch.codePointAt(0);
    if (cp == null) continue;
    if (cp <= 0x7f) {
      bytes.push(cp);
      continue;
    }
    if (cp >= 0xa0 && cp <= 0xff) {
      bytes.push(cp);
      continue;
    }
    bytes.push(0x3f);
  }
  return Buffer.from(bytes);
}

/** Tam Windows-1254 kodlaması (ÇÖÜçöü ve Türkçe özel harfler için iconv). */
function encodeCp1254(text) {
  try {
    return iconv.encode(String(text ?? ''), 'windows-1254');
  } catch {
    return encodeCp1254Fallback(text);
  }
}

function textLine(s) {
  const line = s == null ? '' : String(s);
  const enc = resolveEncoding();
  if (enc === 'utf8') {
    return Buffer.from(`${line}\n`, 'utf8');
  }
  return Buffer.concat([encodeCp1254(line), Buffer.from([0x0a])]);
}

/**
 * GS ! n — çift genişlik / yükseklik (yazıcıya göre test edin).
 * BRIDGE_PRINT_HEADER_SIZE: normal | tall | wide | large | xl
 * BRIDGE_PRINT_BODY_SIZE: normal | tall | wide | large
 */
function gsCharacterSize(mode) {
  const key = String(mode || 'large').toLowerCase();
  const map = { normal: 0x00, tall: 0x01, wide: 0x10, large: 0x11, xl: 0x11 };
  const n = map[key] ?? 0x11;
  return Buffer.from([0x1d, 0x21, n & 0xff]);
}

function resolveHeaderCharacterSize() {
  return gsCharacterSize(process.env.BRIDGE_PRINT_HEADER_SIZE || 'large');
}

function resolveBodyCharacterSize() {
  return gsCharacterSize(process.env.BRIDGE_PRINT_BODY_SIZE || 'normal');
}

/** @param {string | { text?: string, bold?: boolean, large?: boolean, underline?: boolean, bodyEmphasis?: boolean }} line */
function emitLine(line) {
  if (line == null) return textLine('');
  if (typeof line === 'string') {
    if (process.env.BRIDGE_PRINT_BODY_BOLD === '1') {
      return emitLine({ text: line, bold: true });
    }
    return textLine(line);
  }
  const t = line.text ?? '';
  const bold = !!line.bold || (process.env.BRIDGE_PRINT_BODY_BOLD === '1' && !line.large && !line.bodyEmphasis);
  const large = !!line.large;
  const bodyEmphasis = !!line.bodyEmphasis;
  const underline = !!line.underline;
  const chunks = [];
  if (large) chunks.push(resolveHeaderCharacterSize());
  else if (bodyEmphasis) chunks.push(resolveBodyCharacterSize());
  if (underline) chunks.push(Buffer.from([0x1b, 0x2d, 0x01]));
  if (bold) chunks.push(Buffer.from([0x1b, 0x45, 0x01]));
  const enc = resolveEncoding();
  if (enc === 'utf8') {
    chunks.push(Buffer.from(t, 'utf8'));
  } else {
    chunks.push(encodeCp1254(t));
  }
  chunks.push(Buffer.from([0x0a]));
  if (bold) chunks.push(Buffer.from([0x1b, 0x45, 0x00]));
  if (underline) chunks.push(Buffer.from([0x1b, 0x2d, 0x00]));
  if (large) chunks.push(Buffer.from([0x1d, 0x21, 0x00]));
  else if (bodyEmphasis) chunks.push(Buffer.from([0x1d, 0x21, 0x00]));
  return concat(chunks);
}

function flushStyledLines(parts, lines) {
  for (const ln of lines) {
    parts.push(emitLine(ln));
  }
}

function feedAndCut() {
  return Buffer.from([0x1d, 0x56, 0x00]);
}

function resolveLineWidth(p) {
  const fromPayload = Number(p?.line_width);
  if (Number.isFinite(fromPayload)) {
    return Math.min(MAX_LINE_WIDTH, Math.max(MIN_LINE_WIDTH, Math.trunc(fromPayload)));
  }
  const fromEnv = Number(process.env.BRIDGE_PRINT_LINE_WIDTH);
  if (Number.isFinite(fromEnv)) {
    return Math.min(MAX_LINE_WIDTH, Math.max(MIN_LINE_WIDTH, Math.trunc(fromEnv)));
  }
  return DEFAULT_LINE_WIDTH;
}

function separator(width = DEFAULT_LINE_WIDTH, ch = '-') {
  const c = String(ch || '-').slice(0, 1);
  return c.repeat(Math.max(8, width));
}

function strongSeparator(width = DEFAULT_LINE_WIDTH) {
  return separator(width, '=');
}

function separatorSpaced(width = DEFAULT_LINE_WIDTH, ch = '-') {
  return ` ${separator(width - 2, ch)} `;
}

function separatorStrongSpaced(width = DEFAULT_LINE_WIDTH) {
  return ` ${strongSeparator(width - 2)} `;
}

/** @param {string} s */
function centerLine(s, width = DEFAULT_LINE_WIDTH) {
  const t = String(s ?? '').trim();
  if (!t) return '';
  if (t.length >= width) return t.slice(0, width);
  const pad = width - t.length;
  const left = Math.floor(pad / 2);
  return ' '.repeat(left) + t + ' '.repeat(pad - left);
}

/**
 * @param {string} left
 * @param {string} right
 * @param {number} width
 */
function alignLeftRight(left, right, width = DEFAULT_LINE_WIDTH) {
  const L = String(left ?? '').trimEnd();
  const R = String(right ?? '').trim();
  if (!R) return L.slice(0, width);
  const room = width - R.length;
  if (room < 1) return R.slice(0, width);
  if (L.length <= room) {
    return L + ' '.repeat(room - L.length) + R;
  }
  return L.slice(0, Math.max(0, room - 1)) + '…' + R;
}

/**
 * Kelime kırılımlı satırlar; çok uzun kelimeleri böler.
 * @param {string} text
 * @param {number} maxWidth
 * @returns {string[]}
 */
function wrapText(text, maxWidth) {
  const s = String(text ?? '').trim();
  if (!s) return [];
  const words = s.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (test.length <= maxWidth) {
      cur = test;
      continue;
    }
    if (cur) lines.push(cur);
    if (w.length <= maxWidth) {
      cur = w;
    } else {
      for (let i = 0; i < w.length; i += maxWidth) {
        lines.push(w.slice(i, i + maxWidth));
      }
      cur = '';
    }
  }
  if (cur) lines.push(cur);
  return lines.length ? lines : [''];
}

/**
 * Ürün adı + sağda adet (ör. 3 Ad).
 * @param {string} productName
 * @param {string} qtyLabel
 * @param {number} width
 * @returns {string[]}
 */
function linesProductQty(productName, qtyLabel, width = DEFAULT_LINE_WIDTH) {
  const right = String(qtyLabel ?? '').trim() || '';
  const name = String(productName ?? '').trim() || '-';
  if (!right) return wrapText(name, width);

  const spaceForName = width - right.length;
  if (spaceForName < 6) {
    return [...wrapText(name, width), right.padStart(width)];
  }
  if (name.length <= spaceForName) {
    return [alignLeftRight(name, right, width)];
  }

  const wrapped = wrapText(name, width);
  const last = wrapped[wrapped.length - 1];
  const merged = `${last} ${right}`.trimEnd();
  if (merged.length <= width) {
    wrapped[wrapped.length - 1] = alignLeftRight(last, right, width);
    return wrapped;
  }
  return [...wrapped, right.padStart(width)];
}

function formatQty(q) {
  const n = Number(q);
  if (Number.isNaN(n)) return String(q ?? '');
  if (Number.isInteger(n) && n === q) return `${n} Ad`;
  return `${n} Ad`;
}

/** @param {number|string} q @param {string|null|undefined} portionLabel */
function formatQtyLabel(q, portionLabel) {
  const n = Number(q);
  const pl = portionLabel && String(portionLabel).trim();
  if (pl) {
    if (Number.isNaN(n)) return `${String(q)} ${pl}`;
    if (Number.isInteger(n) && n === q) return `${n} ${pl}`;
    return `${n} ${pl}`;
  }
  return formatQty(q);
}

function fmtMoney(n) {
  if (n == null || Number.isNaN(Number(n))) return '-';
  return new Intl.NumberFormat('tr-TR', {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(n));
}

function fmtDateTime(iso) {
  if (!iso) {
    return new Date().toLocaleString('tr-TR');
  }
  try {
    const raw = String(iso).trim();
    const d = new Date(raw.includes('T') ? raw : raw.replace(' ', 'T'));
    if (Number.isNaN(d.getTime())) return raw;
    return d.toLocaleString('tr-TR');
  } catch {
    return String(iso);
  }
}

function fmtDateTimeCompact(iso) {
  try {
    const raw = String(iso || '').trim();
    const d = raw ? new Date(raw.includes('T') ? raw : raw.replace(' ', 'T')) : new Date();
    if (Number.isNaN(d.getTime())) return fmtDateTime(iso);
    const pad = (n) => String(n).padStart(2, '0');
    return `${pad(d.getDate())}.${pad(d.getMonth() + 1)}.${d.getFullYear()} ${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  } catch {
    return fmtDateTime(iso);
  }
}

function fmtWeekdayTime(iso) {
  try {
    const raw = String(iso || '').trim();
    const d = raw ? new Date(raw.includes('T') ? raw : raw.replace(' ', 'T')) : new Date();
    if (Number.isNaN(d.getTime())) return '';
    const days = ['Pazar', 'Pazartesi', 'Salı', 'Çarşamba', 'Perşembe', 'Cuma', 'Cumartesi'];
    const pad = (n) => String(n).padStart(2, '0');
    return `${days[d.getDay()]} ${pad(d.getHours())}:${pad(d.getMinutes())}`;
  } catch {
    return '';
  }
}

/** Örn. 21 Mart 2026 */
function fmtDateTurkishLong(iso) {
  try {
    const raw = String(iso || '').trim();
    const d = raw ? new Date(raw.includes('T') ? raw : raw.replace(' ', 'T')) : new Date();
    if (Number.isNaN(d.getTime())) return '';
    return new Intl.DateTimeFormat('tr-TR', {
      day: 'numeric',
      month: 'long',
      year: 'numeric',
    }).format(d);
  } catch {
    return '';
  }
}

function orderTypeTitle(orderType) {
  const t = String(orderType || '').toLowerCase();
  if (t === 'takeaway') return 'PAKET SİPARİŞİ';
  if (t === 'dine_in') return 'MASA SİPARİŞİ';
  return 'SİPARİŞ';
}

function stationLabel(station) {
  const s = String(station || '').toUpperCase();
  const map = {
    KITCHEN: 'MUTFAK',
    FIRIN: 'FIRIN',
    IZGARA: 'IZGARA',
    BAR: 'BAR',
    ICECEKLER: 'İÇECEKLER',
  };
  return map[s] || s || 'MUTFAK';
}

function tableOrPackageLine(p) {
  const ot = String(p.order_type || '').toLowerCase();
  if (ot === 'takeaway') return 'Paket / Gel-Al';
  if (p.table_name) return `Masa: ${p.table_name}`;
  return 'Masa: -';
}

/** Salon bölgesi + masa; örnek fiş: "Salon | Masa 1" */
function salonMasaLine(p) {
  const ot = String(p.order_type || '').toLowerCase();
  if (ot !== 'dine_in' || !p.table_name) return null;
  const masa = String(p.table_name).trim();
  const salon = p.dining_area_name && String(p.dining_area_name).trim();
  if (salon) return `${salon} | Masa ${masa}`;
  return `Masa ${masa}`;
}

/** Alt kısımda kısa sıra no (örn. - 103 -) */
function shortTicketNo(orderNo) {
  const raw = String(orderNo ?? '').trim();
  if (!raw) return '';
  const digits = raw.replace(/\D/g, '');
  if (digits.length >= 3) return digits.slice(-3);
  if (raw.length <= 3) return raw;
  return raw.slice(-3);
}

function trimFixed(s, max) {
  const t = String(s ?? '');
  if (t.length <= max) return t;
  return t.slice(0, Math.max(0, max - 1)) + '…';
}

/** Kasa fişi: üç sütun (ürün | porsiyon-adet | tutar) */
function lineReceiptThreeCols(productName, midCol, price, width) {
  const c3 = 11;
  const c1 = Math.max(12, Math.floor((width - c3) * 0.55));
  const c2 = width - c1 - c3;
  const left = trimFixed(productName, c1).padEnd(c1);
  const mid = trimFixed(midCol, c2).padEnd(c2);
  const right = trimFixed(price, c3).padStart(c3);
  return (left + mid + right).slice(0, width);
}

function itemSeparatorDotted(width) {
  const inner = Math.max(4, width - 2);
  return ` ${'.'.repeat(inner)} `;
}

function kitchenItemRowStyle(text) {
  if (process.env.BRIDGE_PRINT_KITCHEN_ITEM_PLAIN === '1') {
    return text;
  }
  return { text, bold: true, bodyEmphasis: true };
}

function pushKitchenTopHeader(out, p, w) {
  out.push(alignLeftRight(fmtDateTimeCompact(p.created_at), String(p.order_no ?? ''), w));
  out.push('Adisyon No:');
  if (p.user_name) out.push(String(p.user_name).trim());
  const sm = salonMasaLine(p);
  if (sm) out.push({ text: alignLeftRight('', sm, w), bold: true });
}

function pushTakeawayKitchenMeta(out, p, w, ps) {
  out.push(alignLeftRight('Sipariş Kanalı:', 'Paket Sipariş', w));
  if (p.customer_name) out.push(alignLeftRight('Müşteri:', String(p.customer_name), w));
  if (p.customer_phone) out.push(alignLeftRight('Telefon:', String(p.customer_phone), w));
  if (p.delivery_address && String(p.delivery_address).trim()) {
    for (const line of wrapText(`Adres: ${String(p.delivery_address).trim()}`, w)) {
      out.push(line);
    }
  }
  if (ps && ps.grand_total != null) {
    out.push(alignLeftRight('Tutar:', `${fmtMoney(ps.grand_total)} ₺`, w));
  }
  if (ps && ps.has_payments) {
    out.push({ text: alignLeftRight('Tahsilat:', `${fmtMoney(ps.paid_total)} ₺`, w), bold: true });
    if (Number(ps.balance) > 0) out.push(alignLeftRight('Kalan:', `${fmtMoney(ps.balance)} ₺`, w));
  }
}

const PAY_LABELS = {
  cash: 'Nakit',
  card: 'Kredi kartı',
  mixed: 'Karışık',
  other: 'Diğer',
};

function paymentLabel(type) {
  return PAY_LABELS[String(type || '').toLowerCase()] || type || '-';
}

function parseModifiers(raw) {
  if (!raw) return [];
  try {
    const parsed = typeof raw === 'string' ? JSON.parse(raw) : raw;
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function itemUnitAndTotal(item) {
  const qty = Number(item?.quantity) || 0;
  const unit = Number(item?.unit_price);
  if (!Number.isFinite(unit)) return { unit: null, total: null };
  return { unit, total: unit * qty };
}

function buildKitchenLines(p) {
  const w = resolveLineWidth(p);
  /** @type {(string|{text?:string,bold?:boolean,large?:boolean,bodyEmphasis?:boolean,underline?:boolean})[]} */
  const out = [];
  const sep = separatorSpaced(w);

  if (p.error) {
    out.push(sep, { text: centerLine('MUTFAK', w), bold: true }, sep, `Hata: ${p.error}`, '');
    const lines = Array.isArray(p.lines) ? p.lines : [];
    for (const ln of lines) {
      const name = ln.product_name || '';
      const qty = formatQtyLabel(ln.quantity, ln.portion_label);
      for (const row of linesProductQty(name, qty, w)) {
        out.push(kitchenItemRowStyle(row));
      }
    }
    return out;
  }

  const title = orderTypeTitle(p.order_type);
  const station = stationLabel(p.station);
  const ot = String(p.order_type || '').toLowerCase();
  const ps = p.payment_summary;

  out.push(sep);
  pushKitchenTopHeader(out, p, w);
  out.push(sep);
  if (p.business_name) {
    out.push({ text: centerLine(String(p.business_name), w), bold: true });
  }
  out.push({ text: centerLine(title, w), bold: true, large: true });
  out.push({ text: centerLine(`[${station}]`, w), bold: true });
  out.push(sep);
  if (ot === 'takeaway') {
    pushTakeawayKitchenMeta(out, p, w, ps);
  }
  out.push(sep);
  out.push({ text: alignLeftRight('ÜRÜN', 'ADET', w), bold: true });
  out.push(sep);

  const lines = Array.isArray(p.lines) ? p.lines : [];
  lines.forEach((ln, idx) => {
    const name = ln.product_name || '';
    const qty = formatQtyLabel(ln.quantity, ln.portion_label);
    for (const row of linesProductQty(name, qty, w)) {
      out.push(kitchenItemRowStyle(row));
    }
    if (ln.note) {
      for (const nl of wrapText(`[ ${ln.note} ]`, w - 4)) {
        out.push(`  ${nl}`);
      }
    }
    if (idx < lines.length - 1) {
      out.push(itemSeparatorDotted(w));
    }
  });

  out.push(sep);
  const st = shortTicketNo(p.order_no);
  out.push({ text: centerLine(st ? `- ${st} -` : '—', w), bold: true, large: true });
  if (p.printer_name) out.push({ text: centerLine(String(p.printer_name), w), bold: false });
  return out;
}

function buildKitchenAdjustmentLines(p) {
  const w = resolveLineWidth(p);
  /** @type {(string|{text?:string,bold?:boolean,large?:boolean,bodyEmphasis?:boolean,underline?:boolean})[]} */
  const out = [];
  const sep = separatorSpaced(w);

  if (p.error) {
    out.push(sep, { text: centerLine('MUTFAK', w), bold: true }, sep, `Hata: ${p.error}`);
    return out;
  }

  const adjLabel = p.adjustment_type === 'reduce' ? 'AZALTMA' : 'İPTAL';
  const title = orderTypeTitle(p.order_type);
  const station = stationLabel(p.station);
  const line = p.line || {};
  const ot = String(p.order_type || '').toLowerCase();
  const ps = p.payment_summary;

  out.push(sep);
  pushKitchenTopHeader(out, p, w);
  out.push(sep);
  if (p.business_name) {
    out.push({ text: centerLine(String(p.business_name), w), bold: true });
  }
  out.push({ text: centerLine(adjLabel, w), bold: true, large: true });
  out.push({ text: centerLine(title, w), bold: true });
  out.push({ text: centerLine(`[${station}]`, w), bold: true });
  out.push(sep);
  if (ot === 'takeaway') {
    pushTakeawayKitchenMeta(out, p, w, ps);
    out.push(sep);
  }

  const name = line.product_name || '';
  const qtyStr =
    p.adjustment_type === 'reduce' && line.delta_quantity != null
      ? formatQtyLabel(line.delta_quantity, line.portion_label)
      : formatQtyLabel(line.quantity, line.portion_label);
  out.push({ text: alignLeftRight('ÜRÜN', 'ADET', w), bold: true });
  out.push(sep);
  for (const row of linesProductQty(name, qtyStr, w)) {
    out.push(kitchenItemRowStyle(row));
  }
  if (p.adjustment_type === 'reduce' && line.previous_quantity != null && line.new_quantity != null) {
    out.push(alignLeftRight('Önceki adet', String(line.previous_quantity), w));
    out.push(alignLeftRight('Yeni adet', String(line.new_quantity), w));
  }
  if (line.note) {
    for (const nl of wrapText(`[ ${line.note} ]`, w)) {
      out.push(nl);
    }
  }
  out.push(sep);
  const st = shortTicketNo(p.order_no);
  out.push({ text: centerLine(st ? `- ${st} -` : '—', w), bold: true, large: true });
  if (p.printer_name) out.push(centerLine(String(p.printer_name), w));
  return out;
}

function buildReceiptLines(p) {
  const w = resolveLineWidth(p);
  /** @type {(string|{text?:string,bold?:boolean,large?:boolean,bodyEmphasis?:boolean,underline?:boolean})[]} */
  const out = [];
  const sep = separatorSpaced(w);
  const pays = Array.isArray(p.payments) ? p.payments : [];
  const primaryPay = pays.length ? pays[pays.length - 1] : null;
  const totalPaid = pays.reduce((s, x) => s + (Number(x.amount) || 0), 0);

  out.push(sep);
  if (p.business_name) {
    out.push({ text: centerLine(String(p.business_name), w), bold: true, large: true });
  }
  if (p.receipt_header) {
    for (const line of wrapText(String(p.receipt_header), w)) {
      out.push({ text: line, bold: true });
    }
  }

  const title = orderTypeTitle(p.order_type);
  out.push({ text: centerLine(title, w), bold: true, large: true });
  out.push(sep);
  out.push(alignLeftRight(fmtDateTimeCompact(p.created_at), String(p.order_no ?? ''), w));
  out.push('Adisyon No:');
  if (p.user_name) out.push(String(p.user_name).trim());
  const sm = salonMasaLine(p);
  if (sm) out.push({ text: alignLeftRight('', sm, w), bold: true });
  out.push(sep);

  const ot = String(p.order_type || '').toLowerCase();
  out.push(alignLeftRight('Sipariş Kanalı:', ot === 'takeaway' ? 'Paket Sipariş' : 'Salon / Masa', w));
  if (p.customer_name) out.push(alignLeftRight('Müşteri:', String(p.customer_name), w));
  if (p.customer_phone) out.push(alignLeftRight('Telefon:', String(p.customer_phone), w));
  if (ot === 'takeaway' && p.delivery_address && String(p.delivery_address).trim()) {
    for (const line of wrapText(`Adres: ${String(p.delivery_address).trim()}`, w)) {
      out.push(line);
    }
  }
  if (primaryPay) {
    out.push({ text: alignLeftRight('Ödeme Türü:', paymentLabel(primaryPay.payment_type), w), bold: true });
  }
  out.push(sep);
  out.push({ text: lineReceiptThreeCols('ÜRÜN', 'MİKTAR', 'TUTAR', w), bold: true });
  out.push(sep);

  const items = Array.isArray(p.items) ? p.items : [];
  items.forEach((it, idx) => {
    const name = it.product_name || '';
    const qn = Number(it.quantity) || 0;
    const mid = formatQtyLabel(qn, it.portion_label);
    const { total } = itemUnitAndTotal(it);
    const priceStr = total != null ? `${fmtMoney(total)} ₺` : '-';
    out.push({ text: lineReceiptThreeCols(name, mid, priceStr, w), bold: true, bodyEmphasis: true });
    const mods = parseModifiers(it.modifiers);
    for (const m of mods) {
      const modName = String(m?.name || '').trim();
      if (!modName) continue;
      const delta = Number(m?.price_delta);
      const modPrice = Number.isFinite(delta) && delta !== 0 ? ` (+${fmtMoney(delta)})` : '';
      for (const line of wrapText(`  [ ${modName}${modPrice} ]`, w - 2)) {
        out.push(line);
      }
    }
    if (it.note) {
      for (const line of wrapText(`  [ ${it.note} ]`, w - 2)) {
        out.push(line);
      }
    }
    if (idx < items.length - 1) {
      out.push(itemSeparatorDotted(w));
    }
  });

  out.push(sep);
  if (p.subtotal != null) out.push(alignLeftRight('Ara toplam', fmtMoney(p.subtotal), w));
  const disc = Number(p.discount_amount);
  if (disc > 0) out.push(alignLeftRight('İndirim', `-${fmtMoney(disc)}`, w));
  if (p.grand_total != null) {
    out.push(separatorStrongSpaced(w));
    out.push({ text: alignLeftRight('Tutar', `${fmtMoney(p.grand_total)} ₺`, w), bold: true, large: true });
    out.push(separatorStrongSpaced(w));
  }

  if (pays.length) {
    const payTitle = centerLine('Ödemeler', w);
    out.push(separatorSpaced(w));
    out.push({ text: payTitle, bold: true });
    out.push(separatorSpaced(w));
    for (const pay of pays) {
      const lbl = paymentLabel(pay.payment_type);
      const amt = fmtMoney(pay.amount);
      out.push(alignLeftRight(lbl, amt, w));
      if (Number(pay.change_amount) > 0) {
        out.push(alignLeftRight('Para üstü', fmtMoney(pay.change_amount), w));
      }
    }
    out.push(alignLeftRight('Tahsil edilen', fmtMoney(totalPaid), w));
    const rem = Number(p.grand_total) - totalPaid;
    if (Number.isFinite(rem)) {
      out.push(alignLeftRight('Kalan', fmtMoney(Math.max(0, rem)), w));
    }
  }

  out.push(sep);
  out.push({ text: centerLine(p.receipt_footer || 'Afiyet Olsun', w), bold: true, large: true });
  out.push({ text: centerLine('BİZİ TERCİH ETTİĞİNİZ İÇİN TEŞEKKÜR EDERİZ!', w), bold: true });
  out.push(sep);
  const st = shortTicketNo(p.order_no);
  out.push(centerLine(st ? `— · ${st} · —` : `— · ${p.order_no ?? ''} · —`, w));
  if (p.printer_name) out.push(centerLine(String(p.printer_name), w));
  return out;
}

function buildTestLines(p) {
  const w = resolveLineWidth(p);
  const out = [];
  const sep = separatorSpaced(w);
  out.push(sep);
  out.push(centerLine('YAZICI TESTI', w));
  out.push(sep);
  out.push(alignLeftRight(fmtDateTime(p.created_at), `No: ${p.order_no || '-'}`, w));
  out.push(sep);
  const lines = Array.isArray(p.lines) ? p.lines : [];
  for (const line of lines) {
    for (const wrapped of wrapText(String(line || ''), w)) {
      out.push(wrapped);
    }
  }
  out.push(sep);
  if (p.printer_name) out.push(centerLine(String(p.printer_name), w));
  return out;
}

/**
 * @param {{ job_type: string, payload: object }} job
 */
export function payloadToEscPosBuffer(job) {
  const p = job.payload || {};
  const width = resolveLineWidth(p);
  const parts = [escInit(), escSelectCodePage(resolveEscT())];

  if (p.kind === 'kitchen') {
    flushStyledLines(parts, buildKitchenLines(p));
  } else if (p.kind === 'kitchen_adjustment') {
    flushStyledLines(parts, buildKitchenAdjustmentLines(p));
  } else if (p.kind === 'receipt') {
    flushStyledLines(parts, buildReceiptLines(p));
  } else if (p.kind === 'test') {
    flushStyledLines(parts, buildTestLines(p));
  } else {
    parts.push(textLine(separator(width)));
    parts.push(textLine(`İş: ${job.job_type || '?'}`));
    parts.push(textLine(String(JSON.stringify(p)).slice(0, width * 2)));
  }

  if (process.env.BRIDGE_PRINT_DEBUG_TURKISH === '1') {
    parts.push(textLine(separator(width)));
    parts.push(textLine('TR test: ÇĞİÖŞÜ çğıöşü İı'));
  }

  parts.push(textLine(''), feedAndCut());
  return concat(parts);
}
