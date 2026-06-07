import iconv from 'iconv-lite';

const DEFAULT_CHAR_FALLBACK = 'transliterate';
const DEFAULT_ENCODING_MODE = 'win1254';

/**
 * PC857 ESC t code page: 12 = IBM Turkish.
 * Epson TM series and many thermal printers support this value.
 */
const PC857_ESC_T = 12;

/**
 * Windows-1254 (Turkish) code page number for ESC t.
 * JP80H-UE firmware reports CP437 by default but uses ESC t 32 for its
 * Turkish-compatible Windows table.
 */
const WIN1254_ESC_T = 32;

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
  ['░', 0xb0], ['▒', 0xb1], ['▓', 0xb2], ['│', 0xb3],
  ['┤', 0xb4], ['Á', 0xb5], ['Â', 0xb6], ['À', 0xb7],
  ['©', 0xb8], ['╣', 0xb9], ['║', 0xba], ['╗', 0xbb],
  ['╝', 0xbc], ['¢', 0xbd], ['¥', 0xbe], ['┐', 0xbf],
  ['└', 0xc0], ['┴', 0xc1], ['┬', 0xc2], ['├', 0xc3],
  ['─', 0xc4], ['┼', 0xc5], ['ã', 0xc6], ['Ã', 0xc7],
  ['╚', 0xc8], ['╔', 0xc9], ['╩', 0xca], ['╦', 0xcb],
  ['╠', 0xcc], ['═', 0xcd], ['╬', 0xce], ['¤', 0xcf],
  ['º', 0xd0], ['ª', 0xd1], ['Ê', 0xd2], ['Ë', 0xd3],
  ['È', 0xd4], ['€', 0xd5], ['Í', 0xd6], ['Î', 0xd7],
  ['Ï', 0xd8], ['┘', 0xd9], ['┌', 0xda], ['█', 0xdb],
  ['▄', 0xdc], ['¦', 0xdd], ['Ì', 0xde], ['▀', 0xdf],
  ['Ş', 0xe0], ['ß', 0xe1], ['Ô', 0xe2], ['Ò', 0xe3],
  ['õ', 0xe4], ['Õ', 0xe5], ['µ', 0xe6], ['ş', 0xe7],
  ['Ú', 0xe8], ['Û', 0xe9], ['Ù', 0xea], ['ý', 0xeb],
  ['Ý', 0xec], ['¯', 0xed], ['´', 0xee], ['\u00ad', 0xef],
  ['≡', 0xf0], ['±', 0xf1], ['≥', 0xf2], ['≤', 0xf3],
  ['¶', 0xf4], ['§', 0xf5], ['÷', 0xf6], ['≈', 0xf7],
  ['°', 0xf8], ['∙', 0xf9], ['·', 0xfa], ['√', 0xfb],
  ['ⁿ', 0xfc], ['²', 0xfd], ['■', 0xfe],
]);

export function normalizePrintableText(input) {
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

export function encodeWin1254(text) {
  if (text == null || text === '') return Buffer.from([]);
  const src = normalizePrintableText(String(text));
  return iconv.encode(src.replace(/₺/g, 'TL'), 'win1254');
}

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

    const cp = ch.codePointAt(0);
    if (cp == null) continue;
    if (cp <= 0x7f) {
      bytes.push(cp);
      continue;
    }

    if (PC857_MAP.has(ch)) {
      bytes.push(PC857_MAP.get(ch));
      continue;
    }

    if (ch === '₺') {
      bytes.push(0x54, 0x4c);
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

function parseEscT(raw) {
  const n = Number(raw);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(255, Math.trunc(n)));
}

export function resolveEscT({ printerOptions = {}, payload = {} } = {}) {
  const optEscT = parseEscT(printerOptions?.escT ?? printerOptions?.esc_t);
  if (optEscT != null) return optEscT;
  const envEscT = parseEscT(process.env.BRIDGE_PRINT_ESC_T);
  if (envEscT != null) return envEscT;
  const payloadEscT = parseEscT(payload?.esc_t);
  if (payloadEscT != null) return payloadEscT;
  return PC857_ESC_T;
}

export function resolveWin1254EscT({ printerOptions = {}, payload = {} } = {}) {
  const optEscT = parseEscT(printerOptions?.escT ?? printerOptions?.esc_t);
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

export function resolveEncodingMode(printerOptions = {}) {
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
