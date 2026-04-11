/**
 * print_jobs.payload JSON → ESC/POS byte buffer.
 * 80 mm termal: sabit satır genişliği, hizalı metin; init + kesim korunur.
 */

import iconv from 'iconv-lite';

/** @type {number} 80 mm termal için tipik karakter genişliği (12 cpi civarı) */
const DEFAULT_LINE_WIDTH = 42;
const MIN_LINE_WIDTH = 32;
const MAX_LINE_WIDTH = 64;
const DEFAULT_STORE_TIMEZONE = 'Europe/Istanbul';
const DEFAULT_CHAR_FALLBACK = 'transliterate';
const DEFAULT_ENCODING_MODE = 'win1254';

/**
 * PC857 ESC t kod sayfası: 12 = IBM Turkish.
 * Epson TM serisi ve çoğu termal yazıcı bu değeri destekler.
 * pos-config.json bridge.printEscT veya BRIDGE_PRINT_ESC_T env ile override edilebilir.
 */
const PC857_ESC_T = 12; // PC857 (IBM Turkish)

/**
 * Windows-1254 (Turkish) code page number for ESC t.
 * JP80H-UE firmware reports CP437 by default but uses ESC t 32 for its
 * Turkish-compatible Windows table.
 */
const WIN1254_ESC_T = 32; // Windows-1254 Turkish on JP80H-UE

/**
 * Unicode metni Windows-1254 byte dizisine çevirir (iconv-lite kullanır).
 * JP80H-UE gibi Çin yapımı yazıcılarda PC857 (ESC t 12) yetersiz kalınca
 * Windows-1254 kullanımı için.
 *
 * ₺ → "TL" (PC857 ile aynı fallback; Windows-1254'te ₺ = 0x9C ama
 *           eski firmware'ler bunu göstermeyebilir).
 */
export function encodeWin1254(text) {
  if (text == null || text === '') return Buffer.from([]);
  const src = normalizePrintableText(String(text));
  // ₺ karakterini önce "TL"ye dönüştür (firmware uyumluluğu için)
  const replaced = src.replace(/₺/g, 'TL');
  return iconv.encode(replaced, 'win1254');
}

const TRANSLITERATE_MAP = new Map([
  ['Ç', 'C'], ['ç', 'c'],
  ['Ğ', 'G'], ['ğ', 'g'],
  ['İ', 'I'], ['ı', 'i'],
  ['Ö', 'O'], ['ö', 'o'],
  ['Ş', 'S'], ['ş', 's'],
  ['Ü', 'U'], ['ü', 'u'],
  ['Â', 'A'], ['â', 'a'],
  ['Ê', 'E'], ['ê', 'e'],
  ['Î', 'I'], ['î', 'i'],
  ['Ô', 'O'], ['ô', 'o'],
  ['Û', 'U'], ['û', 'u'],
]);

/**
 * PC857 (IBM Code Page 857 — Turkish) manuel byte tablosu.
 * ESC t 12 ile seçilir. iconv-lite bağımlılığı yok.
 *
 * Kaynak: https://en.wikipedia.org/wiki/Code_page_857
 * 0x00–0x7F arası ASCII ile aynı; 0x80–0xAF özel karakterler.
 */
const PC857_MAP = new Map([
  ['Ç', 0x80], ['ü', 0x81], ['é', 0x82], ['â', 0x83],
  ['ä', 0x84], ['à', 0x85], ['å', 0x86], ['ç', 0x87],
  ['ê', 0x88], ['ë', 0x89], ['è', 0x8a], ['ï', 0x8b],
  ['î', 0x8c], ['ı', 0x8d], ['Ä', 0x8e], ['Å', 0x8f],
  ['É', 0x90], ['æ', 0x91], ['Æ', 0x92], ['ô', 0x93],
  ['ö', 0x94], ['ò', 0x95], ['û', 0x96], ['ù', 0x97],
  ['İ', 0x98], ['Ö', 0x99], ['Ü', 0x9a], ['ø', 0x9b],
  ['£', 0x9c], ['Ø', 0x9d], ['×', 0x9e],
  ['á', 0xa0], ['í', 0xa1], ['ó', 0xa2], ['ú', 0xa3],
  ['ñ', 0xa4], ['Ñ', 0xa5], ['Ğ', 0xa6], ['ğ', 0xa7],
  ['¿', 0xa8], ['®', 0xa9], ['¬', 0xaa], ['½', 0xab],
  ['¼', 0xac], ['¡', 0xad], ['«', 0xae], ['»', 0xaf],
  // 0xB0–0xBF: Kutu çizgileri (box drawing) ve blok karakterleri
  ['░', 0xb0], ['▒', 0xb1], ['▓', 0xb2], ['│', 0xb3],
  ['┤', 0xb4], ['Á', 0xb5], ['Â', 0xb6], ['À', 0xb7],
  ['©', 0xb8], ['╣', 0xb9], ['║', 0xba], ['╗', 0xbb],
  ['╝', 0xbc], ['¢', 0xbd], ['¥', 0xbe], ['┐', 0xbf],
  // 0xC0–0xCF
  ['└', 0xc0], ['┴', 0xc1], ['┬', 0xc2], ['├', 0xc3],
  ['─', 0xc4], ['┼', 0xc5], ['ã', 0xc6], ['Ã', 0xc7],
  ['╚', 0xc8], ['╔', 0xc9], ['╩', 0xca], ['╦', 0xcb],
  ['╠', 0xcc], ['═', 0xcd], ['╬', 0xce], ['¤', 0xcf],
  // 0xD0–0xDF
  ['º', 0xd0], ['ª', 0xd1], ['Ê', 0xd2], ['Ë', 0xd3],
  ['È', 0xd4], ['€', 0xd5], ['Í', 0xd6], ['Î', 0xd7],
  ['Ï', 0xd8], ['┘', 0xd9], ['┌', 0xda], ['█', 0xdb],
  ['▄', 0xdc], ['¦', 0xdd], ['Ì', 0xde], ['▀', 0xdf],
  // 0xE0–0xEF
  ['Ş', 0xe0], ['ß', 0xe1], ['Ô', 0xe2], ['Ò', 0xe3],
  ['õ', 0xe4], ['Õ', 0xe5], ['µ', 0xe6], ['ş', 0xe7],
  ['Ú', 0xe8], ['Û', 0xe9], ['Ù', 0xea], ['ý', 0xeb],
  ['Ý', 0xec], ['¯', 0xed], ['´', 0xee], ['\u00ad', 0xef], // soft hyphen
  // 0xF0–0xFF
  ['≡', 0xf0], ['±', 0xf1], ['≥', 0xf2], ['≤', 0xf3],
  ['¶', 0xf4], ['§', 0xf5], ['÷', 0xf6], ['≈', 0xf7],
  ['°', 0xf8], ['∙', 0xf9], ['·', 0xfa], ['√', 0xfb],
  ['ⁿ', 0xfc], ['²', 0xfd], ['■', 0xfe],
  // ₺ sembolü PC857'de yok — "TL" olarak göster (caller tarafından değiştirilir)
]);

/**
 * Unicode metni PC857 byte dizisine çevirir (iconv-lite kullanmaz).
 * - ASCII (0x00–0x7F): doğrudan geçer
 * - PC857_MAP'te bulunan karakterler: tablodaki byte değeri kullanılır
 * - ₺ → "TL" (iki byte)
 * - Bilinmeyen karakterler → 0x3F ('?')
 */
export function encodePC857(text) {
  const src = normalizePrintableText(String(text ?? ''));
  const forceAsciiTr = shouldForceTrAscii();
  const bytes = [];
  for (const ch of src) {
    if (forceAsciiTr && TRANSLITERATE_MAP.has(ch)) {
      const ascii = TRANSLITERATE_MAP.get(ch);
      for (const c of ascii) bytes.push(c.codePointAt(0));
      continue;
    }
    // ASCII aralığı — doğrudan geç
    const cp = ch.codePointAt(0);
    if (cp == null) continue;
    if (cp <= 0x7f) {
      bytes.push(cp);
      continue;
    }
    // PC857 özel karakter tablosu
    if (PC857_MAP.has(ch)) {
      bytes.push(PC857_MAP.get(ch));
      continue;
    }
    // ₺ → TL
    if (ch === '₺') {
      bytes.push(0x54, 0x4c); // 'T', 'L'
      continue;
    }
    const fallback = transliterateUnknown(ch);
    if (fallback) {
      for (const c of fallback) {
        const ccp = c.codePointAt(0);
        if (ccp != null && ccp <= 0x7f) bytes.push(ccp);
      }
      continue;
    }
    // Bilinmeyen → '?'
    bytes.push(0x3f);
  }
  return Buffer.from(bytes);
}

function shouldForceTrAscii() {
  const raw = String(process.env.BRIDGE_PRINT_FORCE_TR_ASCII || '').trim().toLowerCase();
  return raw === '1' || raw === 'true' || raw === 'yes';
}

function resolveCharFallbackMode() {
  const raw = String(process.env.BRIDGE_PRINT_CHAR_FALLBACK || DEFAULT_CHAR_FALLBACK).trim().toLowerCase();
  if (raw === 'strict') return 'strict';
  if (raw === 'question') return 'question';
  return 'transliterate';
}

function transliterateUnknown(ch) {
  const mode = resolveCharFallbackMode();
  if (mode === 'strict' || mode === 'question') return '';
  if (TRANSLITERATE_MAP.has(ch)) return TRANSLITERATE_MAP.get(ch);
  const decomp = String(ch || '').normalize('NFKD').replace(/[\u0300-\u036f]/g, '');
  const ascii = decomp.replace(/[^\x20-\x7E]/g, '');
  return ascii || '';
}

function normalizePrintableText(input) {
  return String(input ?? '')
    .replaceAll('…', '...')
    .replaceAll('’', "'")
    .replaceAll('‘', "'")
    .replaceAll('“', '"')
    .replaceAll('”', '"')
    .replaceAll('–', '-')
    .replaceAll('—', '-')
    .replaceAll('•', '*')
    .replaceAll('\u00a0', ' ');
}

function charDisplayWidth(ch) {
  // TL simgesi byte seviyesinde "TL" olarak yazılır.
  return ch === '₺' ? 2 : 1;
}

function displayWidth(text) {
  const src = normalizePrintableText(String(text ?? ''));
  let w = 0;
  for (const ch of src) w += charDisplayWidth(ch);
  return w;
}

function sliceByDisplayWidth(text, maxWidth) {
  const src = normalizePrintableText(String(text ?? ''));
  const lim = Math.max(0, Number(maxWidth) || 0);
  if (lim <= 0) return '';
  let out = '';
  let w = 0;
  for (const ch of src) {
    const cw = charDisplayWidth(ch);
    if (w + cw > lim) break;
    out += ch;
    w += cw;
  }
  return out;
}

function padEndDisplayWidth(text, width) {
  const t = sliceByDisplayWidth(text, width);
  const pad = Math.max(0, width - displayWidth(t));
  return t + ' '.repeat(pad);
}

function padStartDisplayWidth(text, width) {
  const t = sliceByDisplayWidth(text, width);
  const pad = Math.max(0, width - displayWidth(t));
  return ' '.repeat(pad) + t;
}

function concat(buffers) {
  return Buffer.concat(buffers.filter(Boolean));
}

function escInit() {
  return Buffer.from([0x1b, 0x40]);
}

function escSelectCodePage(n, { skipPhoenixCmd = false } = {}) {
  const code = n & 0xff;
  // ESC t n — Epson standard code page select
  const bytes = [0x1b, 0x74, code];
  // FS } & n — Phoenix/clone variant; skip for Chinese-mode printers (JP80H-UE etc.)
  // where 0x1C (FS) byte may trigger Chinese character mode and override ESC t.
  if (!skipPhoenixCmd) bytes.push(0x1c, 0x7d, 0x26, code);
  return Buffer.from(bytes);
}

function parseEscT(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(255, Math.trunc(n)));
}

function resolveEscT({ printerOptions = {}, payload = {} } = {}) {
  const optEscT = parseEscT(printerOptions?.escT ?? printerOptions?.esc_t);
  if (optEscT != null) return optEscT;
  const envEscT = parseEscT(process.env.BRIDGE_PRINT_ESC_T);
  if (envEscT != null) return envEscT;
  const payloadEscT = parseEscT(payload?.esc_t);
  if (payloadEscT != null) return payloadEscT;
  return PC857_ESC_T;
}

function resolveWin1254EscT({ printerOptions = {}, payload = {} } = {}) {
  const optEscT = parseEscT(printerOptions?.escT ?? printerOptions?.esc_t);
  // ESC t 0 is PC437/US. It cannot display Windows-1254 Turkish bytes correctly,
  // so treat it as an accidental stale override in win1254 mode.
  if (optEscT === 0) return WIN1254_ESC_T;
  if (optEscT != null) return optEscT;
  const envEscT = parseEscT(process.env.BRIDGE_PRINT_ESC_T);
  if (envEscT === 0) return WIN1254_ESC_T;
  if (envEscT != null) return envEscT;
  const payloadEscT = parseEscT(payload?.esc_t);
  if (payloadEscT === 0) return WIN1254_ESC_T;
  if (payloadEscT != null) return payloadEscT;
  return WIN1254_ESC_T;
}

function resolveEncodingMode(printerOptions = {}) {
  const raw = String(
    printerOptions?.encodingMode ||
      printerOptions?.encoding_mode ||
      process.env.BRIDGE_PRINT_ENCODING_MODE ||
      DEFAULT_ENCODING_MODE,
  )
    .trim()
    .toLowerCase();
  return raw === 'pc857' ? 'pc857' : 'win1254';
}

/**
 * Aktif render sırasında kullanılacak metin encoder'ı.
 * payloadToEscPosBuffer başında ayarlanır; Node.js single-thread olduğu için güvenli.
 * @type {(text: string) => Buffer}
 */
let _activeEncoder = encodePC857;

function textLine(s) {
  const line = s == null ? '' : String(s);
  return Buffer.concat([_activeEncoder(line), Buffer.from([0x0a])]);
}

function encodedTextLine(encoder, s) {
  return Buffer.concat([encoder(s == null ? '' : String(s)), Buffer.from([0x0a])]);
}

function asciiTextLine(s) {
  return encodedTextLine(encodePC857, s);
}

function appendEncodingDiagnostic(parts, width) {
  const sample = 'ÇĞİÖŞÜ çğıöşü';
  const sampleWords = 'Çorba Göbek İmam Öküz Şeker Ücret';
  const candidates = [
    { code: 'A', label: 'WIN1254 ESCt33', escT: 33, encoder: encodeWin1254 },
    { code: 'B', label: 'WIN1254 ESCt28', escT: 28, encoder: encodeWin1254 },
    { code: 'C', label: 'WIN1254 ESCt32', escT: 32, encoder: encodeWin1254 },
    { code: 'D', label: 'WIN1254 ESCt17', escT: 17, encoder: encodeWin1254 },
    { code: 'E', label: 'WIN1254 ESCt16', escT: 16, encoder: encodeWin1254 },
    { code: 'F', label: 'PC857 ESCt12', escT: 12, encoder: encodePC857 },
    { code: 'G', label: 'PC857 ESCt13', escT: 13, encoder: encodePC857 },
  ];

  parts.push(asciiTextLine(separator(width)));
  parts.push(asciiTextLine('KOD SAYFASI TARAMA'));
  parts.push(asciiTextLine('Duzgun olan satirin harfini not alin.'));
  parts.push(asciiTextLine(separator(width)));
  for (const c of candidates) {
    parts.push(escSelectCodePage(c.escT, { skipPhoenixCmd: true }));
    parts.push(asciiTextLine(`[${c.code}] ${c.label}`));
    parts.push(encodedTextLine(c.encoder, sample));
    parts.push(encodedTextLine(c.encoder, sampleWords));
    parts.push(asciiTextLine(''));
  }
  parts.push(asciiTextLine('[H] ASCII acil durum'));
  parts.push(asciiTextLine('CGIOSU cgiosu'));
  parts.push(asciiTextLine('Corba Gobek Imam Okuz Seker Ucret'));
  parts.push(asciiTextLine(separator(width)));
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
  chunks.push(_activeEncoder(t));
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
  const t = normalizePrintableText(String(s ?? '').trim());
  if (!t) return '';
  const tw = displayWidth(t);
  if (tw >= width) return sliceByDisplayWidth(t, width);
  const pad = width - tw;
  const left = Math.floor(pad / 2);
  return ' '.repeat(left) + t + ' '.repeat(pad - left);
}

/**
 * Uzun metinleri width'e göre sarar; her satırı ortalar.
 * @returns {string[]}
 */
function centerLines(s, width = DEFAULT_LINE_WIDTH) {
  const lines = wrapText(String(s ?? ''), width);
  return lines.map((l) => centerLine(l, width));
}

/**
 * @param {string} left
 * @param {string} right
 * @param {number} width
 */
function alignLeftRight(left, right, width = DEFAULT_LINE_WIDTH) {
  const L = normalizePrintableText(String(left ?? '').trimEnd());
  const R = normalizePrintableText(String(right ?? '').trim());
  if (!R) return sliceByDisplayWidth(L, width);
  const rightW = displayWidth(R);
  const room = width - rightW;
  if (room < 1) return sliceByDisplayWidth(R, width);
  const leftW = displayWidth(L);
  if (leftW <= room) {
    return L + ' '.repeat(room - leftW) + R;
  }
  const cut = Math.max(0, room - 3);
  return `${sliceByDisplayWidth(L, cut)}...${R}`;
}

/**
 * Kelime kırılımlı satırlar; çok uzun kelimeleri böler.
 * @param {string} text
 * @param {number} maxWidth
 * @returns {string[]}
 */
function wrapText(text, maxWidth) {
  const s = normalizePrintableText(String(text ?? '').trim());
  if (!s) return [];
  const words = s.split(/\s+/).filter(Boolean);
  const lines = [];
  let cur = '';
  for (const w of words) {
    const test = cur ? `${cur} ${w}` : w;
    if (displayWidth(test) <= maxWidth) {
      cur = test;
      continue;
    }
    if (cur) lines.push(cur);
    if (displayWidth(w) <= maxWidth) {
      cur = w;
    } else {
      let rest = w;
      while (displayWidth(rest) > maxWidth) {
        const head = sliceByDisplayWidth(rest, maxWidth);
        lines.push(head);
        rest = rest.slice(head.length);
      }
      cur = rest;
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
  const right = normalizePrintableText(String(qtyLabel ?? '').trim()) || '';
  const name = normalizePrintableText(String(productName ?? '').trim()) || '-';
  if (!right) return wrapText(name, width);

  const spaceForName = width - displayWidth(right);
  if (spaceForName < 6) {
    return [...wrapText(name, width), padStartDisplayWidth(right, width)];
  }
  if (displayWidth(name) <= spaceForName) {
    return [alignLeftRight(name, right, width)];
  }

  const wrapped = wrapText(name, width);
  const last = wrapped[wrapped.length - 1];
  const merged = `${last} ${right}`.trimEnd();
  if (displayWidth(merged) <= width) {
    wrapped[wrapped.length - 1] = alignLeftRight(last, right, width);
    return wrapped;
  }
  return [...wrapped, padStartDisplayWidth(right, width)];
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

function resolveStoreTimeZone() {
  return String(process.env.BRIDGE_STORE_TIMEZONE || process.env.STORE_TIMEZONE || DEFAULT_STORE_TIMEZONE).trim();
}

function parseUtcLikeTimestamp(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return new Date();
  // SQLite datetime('now') -> "YYYY-MM-DD HH:mm:ss" (UTC)
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}$/.test(raw)) {
    return new Date(raw.replace(' ', 'T') + 'Z');
  }
  // ISO ama timezone suffix yoksa UTC kabul et.
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d+)?$/.test(raw)) {
    return new Date(raw + 'Z');
  }
  return new Date(raw);
}

function formatDateWithStoreTimezone(date, opts) {
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: resolveStoreTimeZone(),
    ...opts,
  }).format(date);
}

function fmtDateTime(iso) {
  const raw = String(iso ?? '').trim();
  const d = parseUtcLikeTimestamp(raw);
  if (Number.isNaN(d.getTime())) return raw || '-';
  return formatDateWithStoreTimezone(d, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  });
}

function fmtDateTimeCompact(iso) {
  const raw = String(iso ?? '').trim();
  const d = parseUtcLikeTimestamp(raw);
  if (Number.isNaN(d.getTime())) return fmtDateTime(iso);
  return formatDateWithStoreTimezone(d, {
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  }).replace(',', '');
}

function fmtWeekdayTime(iso) {
  const raw = String(iso ?? '').trim();
  const d = parseUtcLikeTimestamp(raw);
  if (Number.isNaN(d.getTime())) return '';
  return formatDateWithStoreTimezone(d, {
    weekday: 'long',
    hour: '2-digit',
    minute: '2-digit',
    hour12: false,
  }).replace(',', '');
}

/** Örn. 21 Mart 2026 */
function fmtDateTurkishLong(iso) {
  const raw = String(iso ?? '').trim();
  const d = parseUtcLikeTimestamp(raw);
  if (Number.isNaN(d.getTime())) return '';
  return formatDateWithStoreTimezone(d, {
    day: 'numeric',
    month: 'long',
    year: 'numeric',
  });
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

function templateVars(p, w) {
  const pays = Array.isArray(p.payments) ? p.payments : [];
  const totalPaid = pays.reduce((s, x) => s + (Number(x.amount) || 0), 0);
  const sm = salonMasaLine(p);
  return {
    business_name: p.business_name || p.printer_name || '',
    business_address: p.business_address || '',
    business_phone: p.business_phone || '',
    order_type: orderTypeTitle(p.order_type),
    order_no: String(p.order_no ?? ''),
    short_no: shortTicketNo(p.order_no),
    date: fmtDateTimeCompact(p.created_at),
    table: sm || '',
    customer_name: p.customer_name || '',
    customer_phone: p.customer_phone || '',
    subtotal: p.subtotal != null ? fmtMoney(p.subtotal) : '',
    total: p.grand_total != null ? fmtMoney(p.grand_total) : '',
    vat: p.vat_total != null ? fmtMoney(p.vat_total) : '',
    paid: totalPaid ? fmtMoney(totalPaid) : '',
    footer1: p.receipt_footer || 'Afiyet Olsun',
    footer2: 'Bizi tercih ettiğiniz için teşekkür ederiz',
    line: separatorSpaced(w),
  };
}

function templateItemsBlock(p, w) {
  const items = Array.isArray(p.items) ? p.items : Array.isArray(p.lines) ? p.lines : [];
  const isKitchen = p.kind === 'kitchen' || p.kind === 'kitchen_adjustment';
  const rows = [];
  for (const it of items) {
    const name = it.product_name || '';
    const qty = formatQtyLabel(it.quantity, it.portion_label);
    if (isKitchen) {
      rows.push(...linesProductQty(name, qty, w));
    } else {
      const { total } = itemUnitAndTotal(it);
      rows.push(...linesReceiptThreeCols(name, qty, total != null ? fmtMoney(total) : '-', w));
    }
    if (it.note) {
      rows.push(...wrapText(`  [ ${it.note} ]`, Math.max(8, w - 2)));
    }
  }
  return rows.join('\n');
}

function templatePaymentsBlock(p, w) {
  const pays = Array.isArray(p.payments) ? p.payments : [];
  if (!pays.length) return '';
  const rows = [];
  for (const pay of pays) {
    rows.push(alignLeftRight(paymentLabel(pay.payment_type), fmtMoney(pay.amount), w));
    if (Number(pay.change_amount) > 0) rows.push(alignLeftRight('Para üstü', fmtMoney(pay.change_amount), w));
  }
  return rows.join('\n');
}

function buildTemplateLines(p) {
  const template = p?._template;
  if (!template?.enabled || !String(template.body || '').trim()) return null;
  const w = resolveLineWidth(p);
  const vars = templateVars(p, w);
  const raw = String(template.body || '')
    .replaceAll('{{items}}', templateItemsBlock(p, w))
    .replaceAll('{{payments}}', templatePaymentsBlock(p, w))
    .replaceAll('{{line}}', vars.line)
    .replace(/\{([a-zA-Z0-9_]+)\}/g, (_, key) => vars[key] ?? '');
  const out = [];
  for (const line of raw.split(/\r?\n/)) {
    const centerMatch = line.match(/^\{\{center:(.*)\}\}$/);
    if (centerMatch) {
      out.push(centerLine(centerMatch[1], w));
      continue;
    }
    const text = line;
    if (!text.trim()) {
      out.push('');
      continue;
    }
    out.push(...wrapText(text, w));
  }
  return out;
}

function trimFixed(s, max) {
  const t = normalizePrintableText(String(s ?? ''));
  if (displayWidth(t) <= max) return t;
  return `${sliceByDisplayWidth(t, Math.max(0, max - 3))}...`;
}

/** Kasa fişi: üç sütun (ürün | porsiyon-adet | tutar) — tek satır (başlık için) */
function lineReceiptThreeCols(productName, midCol, price, width) {
  const c3 = 11;
  const c1 = Math.max(12, Math.floor((width - c3) * 0.55));
  const c2 = width - c1 - c3;
  const left = padEndDisplayWidth(trimFixed(productName, c1), c1);
  const mid = padEndDisplayWidth(trimFixed(midCol, c2), c2);
  const right = padStartDisplayWidth(trimFixed(price, c3), c3);
  return sliceByDisplayWidth(left + mid + right, width);
}

/**
 * Kasa fişi ürün satırı — kelime kırılımlı çok satır desteği.
 * Uzun ürün adlarını c1 genişliğinde sarar; adet/tutar ilk satırda gösterilir.
 * @returns {string[]}
 */
function linesReceiptThreeCols(productName, midCol, price, width) {
  const c3 = 11;
  const c1 = Math.max(12, Math.floor((width - c3) * 0.55));
  const c2 = width - c1 - c3;
  const name = normalizePrintableText(String(productName ?? '').trim());
  const midStr = padEndDisplayWidth(trimFixed(String(midCol ?? ''), c2), c2);
  const rightStr = padStartDisplayWidth(trimFixed(String(price ?? ''), c3), c3);

  if (displayWidth(name) <= c1) {
    return [padEndDisplayWidth(name, c1) + midStr + rightStr];
  }

  // Ad c1'den uzun: kelime sarmalama uygula, fiyat/adet ilk satırda
  const nameLines = wrapText(name, c1);
  const firstLine = padEndDisplayWidth(nameLines[0], c1) + midStr + rightStr;
  const rest = nameLines.slice(1); // devam satırları (sadece ad)
  return [firstLine, ...rest];
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
  const templated = buildTemplateLines(p);
  if (templated) return templated;
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
  const templated = buildTemplateLines(p);
  if (templated) return templated;
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
  if (p.business_address) {
    for (const line of centerLines(String(p.business_address), w)) {
      out.push(line);
    }
  }
  if (p.business_phone) {
    out.push(centerLine(String(p.business_phone), w));
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
    const itemLines = linesReceiptThreeCols(name, mid, priceStr, w);
    itemLines.forEach((ln, i) => {
      out.push({ text: ln, bold: true, bodyEmphasis: i === 0 });
    });
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

function buildTakeawayLabelLines(p) {
  const w = resolveLineWidth(p);
  const out = [];
  const sep = separatorSpaced(w);
  const sepStrong = separatorStrongSpaced(w);

  out.push(sep);
  if (p.business_name) {
    out.push({ text: centerLine(String(p.business_name), w), bold: true });
  }
  out.push({ text: centerLine('PAKET ETİKETİ', w), bold: true, large: true });
  out.push(sep);

  out.push(alignLeftRight(fmtDateTimeCompact(p.created_at), String(p.order_no ?? ''), w));
  if (p.user_name) out.push(alignLeftRight('Hazırlayan:', String(p.user_name), w));

  out.push(sep);
  if (p.customer_name) {
    out.push({ text: alignLeftRight('Müşteri:', String(p.customer_name), w), bold: true });
  }
  if (p.customer_phone) {
    out.push(alignLeftRight('Telefon:', String(p.customer_phone), w));
  }
  if (p.delivery_address && String(p.delivery_address).trim()) {
    for (const line of wrapText(`Adres: ${String(p.delivery_address).trim()}`, w)) {
      out.push(line);
    }
  }
  if (p.delivery_note && String(p.delivery_note).trim()) {
    for (const line of wrapText(`Teslimat Notu: ${String(p.delivery_note).trim()}`, w)) {
      out.push(line);
    }
  }
  if (p.courier_note && String(p.courier_note).trim()) {
    for (const line of wrapText(`Kurye Notu: ${String(p.courier_note).trim()}`, w)) {
      out.push(line);
    }
  }
  if (p.note && String(p.note).trim()) {
    for (const line of wrapText(`Not: ${String(p.note).trim()}`, w)) {
      out.push(line);
    }
  }

  out.push(sep);
  out.push({ text: alignLeftRight('ÜRÜN', 'ADET', w), bold: true });
  out.push(sep);

  const items = Array.isArray(p.items) ? p.items : [];
  items.forEach((it, idx) => {
    const name = it.product_name || '';
    const qty = formatQtyLabel(it.quantity, it.portion_label);
    for (const row of linesProductQty(name, qty, w)) {
      out.push({ text: row, bold: true, bodyEmphasis: true });
    }
    if (it.note) {
      for (const nl of wrapText(`[ ${it.note} ]`, w - 4)) {
        out.push(`  ${nl}`);
      }
    }
    if (idx < items.length - 1) out.push(itemSeparatorDotted(w));
  });

  out.push(sepStrong);
  const st = shortTicketNo(p.order_no);
  out.push({ text: centerLine(st ? `- ${st} -` : String(p.order_no ?? ''), w), bold: true, large: true });
  if (p.printer_name) out.push(centerLine(String(p.printer_name), w));

  return out;
}

function buildTestLines(p) {
  const w = resolveLineWidth(p);
  const out = [];
  const sep = separatorSpaced(w);
  out.push(sep);
  out.push({ text: centerLine('YAZICI TESTI', w), bold: true });
  out.push(sep);
  out.push(alignLeftRight(fmtDateTime(p.created_at), `No: ${p.order_no || '-'}`, w));
  out.push(alignLeftRight('Bağlantı:', String(p.connection_type || 'network'), w));
  out.push(alignLeftRight('Adres:', String(p.address || '-'), w));
  out.push(sep);
  // Türkçe karakter encoding testi
  out.push({ text: centerLine('Türkçe Karakter Testi', w), bold: true });
  out.push(centerLine('ÇĞİÖŞÜ çğıöşü', w));
  out.push(centerLine('Çorba Göbek İmam Öküz Şeker Ücret', w));
  const encodingLabel = p?.encoding_mode === 'win1254' ? 'Windows-1254' : 'PC857';
  out.push(centerLine(`ESC t: ${p?.esc_t ?? resolveEscT({ payload: p })} | ${encodingLabel}`, w));
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
 * @param {{ escT?: number, skipInit?: boolean, skipPhoenixCmd?: boolean, encodingMode?: string }} [printerOptions]
 */
export function payloadToEscPosBuffer(job, printerOptions = {}) {
  const p = job.payload || {};
  const width = resolveLineWidth(p);
  const skipInit = !!printerOptions.skipInit;

  // Encoding mode: "win1254" uses iconv-lite Windows-1254 + ESC t 33.
  // "pc857" uses the manual PC857_MAP + ESC t 12 (or overridden escT).
  const encodingMode = resolveEncodingMode(printerOptions);
  const useWin1254 = encodingMode === 'win1254';
  const skipPhoenixCmd =
    printerOptions.skipPhoenixCmd != null ? !!printerOptions.skipPhoenixCmd : useWin1254;

  // Set render-scoped encoder (Node.js single-threaded: safe for sync render)
  _activeEncoder = useWin1254 ? encodeWin1254 : encodePC857;

  // ESC t: Win1254 defaults to 33, PC857 defaults to 12; explicit printer/env overrides still work.
  const escT = useWin1254
    ? resolveWin1254EscT({ printerOptions, payload: p })
    : resolveEscT({ printerOptions, payload: p });

  const renderPayload = {
    ...p,
    esc_t: escT,
    encoding_mode: encodingMode,
    _template: printerOptions?.template,
  };
  const parts = [];
  if (!skipInit) parts.push(escInit());
  parts.push(escSelectCodePage(escT, { skipPhoenixCmd }));

  if (renderPayload.kind === 'kitchen') {
    flushStyledLines(parts, buildKitchenLines(renderPayload));
  } else if (renderPayload.kind === 'kitchen_adjustment') {
    flushStyledLines(parts, buildKitchenAdjustmentLines(renderPayload));
  } else if (renderPayload.kind === 'receipt') {
    flushStyledLines(parts, buildReceiptLines(renderPayload));
  } else if (renderPayload.kind === 'takeaway_label') {
    flushStyledLines(parts, buildTakeawayLabelLines(renderPayload));
  } else if (renderPayload.kind === 'test') {
    flushStyledLines(parts, buildTestLines(renderPayload));
    if (renderPayload.encoding_diagnostic !== false) {
      appendEncodingDiagnostic(parts, width);
    }
  } else {
    parts.push(textLine(separator(width)));
    parts.push(textLine(`İş: ${job.job_type || '?'}`));
    parts.push(textLine(String(JSON.stringify(renderPayload)).slice(0, width * 2)));
  }

  if (process.env.BRIDGE_PRINT_DEBUG_TURKISH === '1') {
    parts.push(textLine(separator(width)));
    parts.push(textLine('TR test: ÇĞİÖŞÜ çğıöşü İı'));
  }

  parts.push(textLine(''), feedAndCut());
  // Reset encoder to default after render
  _activeEncoder = encodePC857;
  return concat(parts);
}

// ── Admin UI: plain-text preview (same line builders as real print, no ESC) ──

function flattenLineEntries(rows) {
  const out = [];
  for (const row of rows) {
    if (typeof row === 'string') out.push(row);
    else if (row && typeof row === 'object' && typeof row.text === 'string') out.push(row.text);
    else if (row != null) out.push(String(row));
  }
  return out;
}

function demoKitchenPreviewPayload(lineWidth, station) {
  return {
    kind: 'kitchen',
    order_id: 'demo-order',
    order_no: '136',
    order_type: 'dine_in',
    table_name: '12',
    dining_area_name: 'Bahçe',
    created_at: new Date().toISOString(),
    user_name: 'Demo Garson',
    business_name: 'Demo Restoran',
    station: station || 'KITCHEN',
    printer_name: 'Önizleme',
    line_width: lineWidth,
    lines: [
      { product_name: 'Hellim Peynirli Salata', quantity: 1, note: 'az tuzlu', portion_label: 'Ad' },
      { product_name: 'Mevsim Salata', quantity: 2, note: null, portion_label: 'Ad' },
    ],
    payment_summary: null,
  };
}

function demoReceiptPreviewPayload(lineWidth) {
  return {
    kind: 'receipt',
    order_no: '222705187',
    order_type: 'dine_in',
    created_at: new Date().toISOString(),
    user_name: 'Demo Garson',
    business_name: 'Demo Restoran',
    business_address: 'Bahçe Mah. No: 1',
    business_phone: '0212 000 00 00',
    table_name: '12',
    dining_area_name: 'Bahçe',
    customer_name: null,
    customer_phone: null,
    delivery_address: null,
    receipt_header: null,
    receipt_footer: 'Afiyet olsun',
    subtotal: 325,
    discount_amount: 0,
    grand_total: 325,
    vat_total: 29.55,
    line_width: lineWidth,
    items: [
      {
        product_name: 'Hellim Peynirli Salata',
        quantity: 1,
        portion_label: 'Tam',
        unit_price: 120,
        modifiers: '[]',
      },
      {
        product_name: 'Mevsim Salata',
        quantity: 2,
        portion_label: 'Ad',
        unit_price: 42.5,
        modifiers: '[]',
      },
    ],
    payments: [{ payment_type: 'card', amount: 325, change_amount: 0 }],
    printer_name: 'Önizleme',
  };
}

/**
 * Yazıcı ayarları ekranı: gerçek buildKitchenLines / buildReceiptLines çıktısının düz metin satırları.
 * @param {'kitchen'|'receipt'|'bar'} kind
 * @param {number|string|null|undefined} lineWidth
 * @param {object} [printOptions] Kayıtlı print_options ile aynı şekil (template, layout, …)
 * @returns {string[]}
 */
export function getPrinterPreviewPlainLines(kind, lineWidth, printOptions = {}) {
  const lwRaw = lineWidth != null && lineWidth !== '' ? Number(lineWidth) : NaN;
  const line_width = Number.isFinite(lwRaw) ? lwRaw : undefined;

  const k = String(kind || 'kitchen').toLowerCase();
  const base =
    k === 'receipt'
      ? demoReceiptPreviewPayload(line_width)
      : demoKitchenPreviewPayload(line_width, k === 'bar' ? 'BAR' : 'KITCHEN');

  const renderPayload = {
    ...base,
    line_width,
    _template: printOptions?.template,
  };

  let rows;
  if (k === 'receipt') {
    rows = buildReceiptLines(renderPayload);
  } else {
    rows = buildKitchenLines(renderPayload);
  }
  return flattenLineEntries(rows);
}
