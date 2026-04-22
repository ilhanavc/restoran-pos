const STORE_TIME_ZONE = 'Europe/Istanbul';

function pad2(value) {
  return String(value).padStart(2, '0');
}

function formatParts(date, timeZone = STORE_TIME_ZONE) {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone,
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

function getOffsetMinutes(date, timeZone = STORE_TIME_ZONE) {
  const parts = formatParts(date, timeZone);
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

function zonedDateTimeToUtc(dateStr, timeStr = '00:00:00', timeZone = STORE_TIME_ZONE) {
  const [, year, month, day] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr));
  const [, hour, minute, second = '00'] = /^(\d{2}):(\d{2})(?::(\d{2}))?$/.exec(String(timeStr));
  const localEpochMs = Date.UTC(
    Number(year),
    Number(month) - 1,
    Number(day),
    Number(hour),
    Number(minute),
    Number(second),
  );
  let offset = getOffsetMinutes(new Date(localEpochMs), timeZone);
  let utcMs = localEpochMs - offset * 60 * 1000;
  const correctedOffset = getOffsetMinutes(new Date(utcMs), timeZone);
  if (correctedOffset !== offset) {
    utcMs = localEpochMs - correctedOffset * 60 * 1000;
  }
  return new Date(utcMs);
}

function addDaysToDateString(dateStr, days) {
  const [, year, month, day] = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(dateStr));
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));
  date.setUTCDate(date.getUTCDate() + Number(days || 0));
  return [
    date.getUTCFullYear(),
    pad2(date.getUTCMonth() + 1),
    pad2(date.getUTCDate()),
  ].join('-');
}

function todayInIstanbul(date = new Date()) {
  const parts = formatParts(date, STORE_TIME_ZONE);
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function dateTimeStampInIstanbul(date = new Date()) {
  const parts = formatParts(date, STORE_TIME_ZONE);
  return `${parts.year}-${parts.month}-${parts.day}-${parts.hour}-${parts.minute}-${parts.second}`;
}

function msUntilNextHourInIstanbul(targetHour) {
  const now = new Date();
  const today = todayInIstanbul(now);
  const nextDate = Number(formatParts(now, STORE_TIME_ZONE).hour) >= targetHour
    ? addDaysToDateString(today, 1)
    : today;
  const next = zonedDateTimeToUtc(nextDate, `${pad2(targetHour)}:00:00`);
  return Math.max(0, next.getTime() - now.getTime());
}

module.exports = {
  STORE_TIME_ZONE,
  todayInIstanbul,
  dateTimeStampInIstanbul,
  msUntilNextHourInIstanbul,
};
