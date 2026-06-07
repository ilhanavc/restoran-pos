import config from '../config/index.js';

const DEFAULT_STORE_TIMEZONE = 'Europe/Istanbul';

function pad2(value) {
  return String(value).padStart(2, '0');
}

function getFormatter(timeZone = config.storeTimezone || DEFAULT_STORE_TIMEZONE) {
  return new Intl.DateTimeFormat('en-GB', {
    timeZone,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hourCycle: 'h23',
  });
}

function extractParts(date, timeZone = config.storeTimezone || DEFAULT_STORE_TIMEZONE) {
  const parts = getFormatter(timeZone)
    .formatToParts(date)
    .filter((part) => part.type !== 'literal');
  const map = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return {
    year: map.year,
    month: map.month,
    day: map.day,
    hour: map.hour,
    minute: map.minute,
    second: map.second,
  };
}

function parseDateParts(dateStr) {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr || '').trim());
  if (!match) return null;
  return {
    year: Number(match[1]),
    month: Number(match[2]),
    day: Number(match[3]),
  };
}

function parseTimeParts(timeStr = '00:00:00') {
  const normalized = String(timeStr || '00:00:00').trim();
  const match = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(normalized);
  if (!match) return null;
  return {
    hour: Number(match[1]),
    minute: Number(match[2]),
    second: Number(match[3] || '0'),
  };
}

export function addDaysToDateString(dateStr, days) {
  const parts = parseDateParts(dateStr);
  if (!parts) throw new Error('Geçersiz tarih');
  const date = new Date(Date.UTC(parts.year, parts.month - 1, parts.day));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return [
    date.getUTCFullYear(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate()),
  ].join('-');
}

export function parseDbTimestampToDate(value) {
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

export function getStoreDate(date = new Date(), timeZone = config.storeTimezone || DEFAULT_STORE_TIMEZONE) {
  const parts = extractParts(date, timeZone);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

export function getStoreTime(date = new Date(), timeZone = config.storeTimezone || DEFAULT_STORE_TIMEZONE) {
  const parts = extractParts(date, timeZone);
  return `${parts.hour}:${parts.minute}:${parts.second}`;
}

export function getStoreDateTime(date = new Date(), timeZone = config.storeTimezone || DEFAULT_STORE_TIMEZONE) {
  return `${getStoreDate(date, timeZone)} ${getStoreTime(date, timeZone)}`;
}

export function dateTimeStampInIstanbul(date = new Date()) {
  const parts = extractParts(date, DEFAULT_STORE_TIMEZONE);
  return `${parts.year}-${parts.month}-${parts.day}-${parts.hour}-${parts.minute}-${parts.second}`;
}

export function getStoreDateFromDbTimestamp(value, timeZone = config.storeTimezone || DEFAULT_STORE_TIMEZONE) {
  const parsed = parseDbTimestampToDate(value);
  if (!parsed) return null;
  return getStoreDate(parsed, timeZone);
}

export function getStoreHourFromDbTimestamp(value, timeZone = config.storeTimezone || DEFAULT_STORE_TIMEZONE) {
  const parsed = parseDbTimestampToDate(value);
  if (!parsed) return null;
  return extractParts(parsed, timeZone).hour;
}

export function registerSqliteTimeFunctions(db, timeZone = config.storeTimezone || DEFAULT_STORE_TIMEZONE) {
  db.function('store_date', (value) => getStoreDateFromDbTimestamp(value, timeZone) || null);
  db.function('store_hour', (value) => getStoreHourFromDbTimestamp(value, timeZone) || null);
}

export function getTimeZoneOffsetMinutes(date, timeZone = config.storeTimezone || DEFAULT_STORE_TIMEZONE) {
  const parts = extractParts(date, timeZone);
  const utcFromLocalParts = Date.UTC(
    Number(parts.year),
    Number(parts.month) - 1,
    Number(parts.day),
    Number(parts.hour),
    Number(parts.minute),
    Number(parts.second),
  );
  return Math.round((utcFromLocalParts - date.getTime()) / 60000);
}

export function zonedDateTimeToUtc(dateStr, timeStr = '00:00:00', timeZone = config.storeTimezone || DEFAULT_STORE_TIMEZONE) {
  const dateParts = parseDateParts(dateStr);
  const timeParts = parseTimeParts(timeStr);
  if (!dateParts || !timeParts) throw new Error('Geçersiz tarih veya saat');

  const localEpochMs = Date.UTC(
    dateParts.year,
    dateParts.month - 1,
    dateParts.day,
    timeParts.hour,
    timeParts.minute,
    timeParts.second,
  );

  let offset = getTimeZoneOffsetMinutes(new Date(localEpochMs), timeZone);
  let utcMs = localEpochMs - offset * 60 * 1000;

  const correctedOffset = getTimeZoneOffsetMinutes(new Date(utcMs), timeZone);
  if (correctedOffset !== offset) {
    offset = correctedOffset;
    utcMs = localEpochMs - offset * 60 * 1000;
  }

  return new Date(utcMs);
}

export function toSqliteUtcTimestamp(date) {
  return date.toISOString().slice(0, 19).replace('T', ' ');
}

export function dayBoundsInStoreTime(dateStr, timeZone = config.storeTimezone || DEFAULT_STORE_TIMEZONE) {
  const start = zonedDateTimeToUtc(dateStr, '00:00:00', timeZone);
  const end = zonedDateTimeToUtc(addDaysToDateString(dateStr, 1), '00:00:00', timeZone);
  return [toSqliteUtcTimestamp(start), toSqliteUtcTimestamp(end)];
}

export function rangeBoundsInStoreTime(fromDate, toDate, timeZone = config.storeTimezone || DEFAULT_STORE_TIMEZONE) {
  const start = zonedDateTimeToUtc(fromDate, '00:00:00', timeZone);
  const end = zonedDateTimeToUtc(addDaysToDateString(toDate, 1), '00:00:00', timeZone);
  return [toSqliteUtcTimestamp(start), toSqliteUtcTimestamp(end)];
}
