export const STORE_TIME_ZONE = 'Europe/Istanbul';

function pad2(value) {
  return String(value).padStart(2, '0');
}

export function parseDateLike(value) {
  if (!value) return null;
  if (value instanceof Date) return Number.isNaN(value.getTime()) ? null : value;
  const text = String(value).trim();
  if (!text) return null;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(text)) {
    const parsed = new Date(text);
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(text)) {
    const parsed = new Date(text.replace(' ', 'T') + 'Z');
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(text)) {
    const parsed = new Date(text + 'Z');
    return Number.isNaN(parsed.getTime()) ? null : parsed;
  }
  const parsed = new Date(text);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function formatParts(date) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: STORE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  })
    .formatToParts(date)
    .filter((part) => part.type !== 'literal');
  return Object.fromEntries(parts.map((part) => [part.type, part.value]));
}

export function todayInIstanbul(date = new Date()) {
  const parts = formatParts(date);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function addDaysToDateString(dateStr, days) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!match) throw new Error('Geçersiz tarih');
  const date = new Date(Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3])));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return [
    date.getUTCFullYear(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate()),
  ].join('-');
}

export function formatDateInIstanbul(value, options = {}) {
  const parsed = parseDateLike(value);
  if (!parsed) return '';
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: STORE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    ...options,
  }).format(parsed);
}

export function formatTimeInIstanbul(value, options = {}) {
  const parsed = parseDateLike(value);
  if (!parsed) return '';
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: STORE_TIME_ZONE,
    hour: '2-digit',
    minute: '2-digit',
    ...options,
  }).format(parsed);
}

export function formatDateTimeInIstanbul(value, options = {}) {
  const parsed = parseDateLike(value);
  if (!parsed) return '';
  return new Intl.DateTimeFormat('tr-TR', {
    timeZone: STORE_TIME_ZONE,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    ...options,
  }).format(parsed);
}
