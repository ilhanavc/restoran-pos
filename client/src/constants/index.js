import { formatDateInIstanbul, formatDateTimeInIstanbul, formatTimeInIstanbul } from '../utils/time.js';

/** Sipariş satırı (order_items) durum rozetleri — sipariş alma ekranı */
export const ORDER_ITEM_LINE_STATUS = {
  new: { label: 'Yeni', short: 'YENİ', bg: 'var(--info-muted)', color: 'var(--info)' },
  sent: { label: 'Mutfakta', short: 'MUTFAK', bg: 'var(--warning-muted)', color: 'var(--warning)' },
  preparing: { label: 'Hazırlanıyor', short: 'HAZIRLANIYOR', bg: 'var(--warning-muted)', color: 'var(--warning)' },
  ready: { label: 'Hazır', short: 'HAZIR', bg: 'var(--success-muted)', color: 'var(--success)' },
  served: { label: 'Servis', short: 'SERVİS', bg: 'var(--surface-3)', color: 'var(--text-secondary)' },
  comped: { label: 'İkram', short: 'İKRAM', bg: 'var(--danger-muted)', color: 'var(--danger)' },
};

export const ORDER_STATUS = {
  new: { label: 'Yeni', color: 'info' },
  saved: { label: 'Kaydedildi', color: 'info' },
  in_kitchen: { label: 'Mutfakta', color: 'warning' },
  preparing: { label: 'Hazırlanıyor', color: 'orange' },
  ready: { label: 'Hazır', color: 'success' },
  served: { label: 'Servis Edildi', color: 'success' },
  cancelled: { label: 'İptal', color: 'danger' },
  closed: { label: 'Kapalı', color: 'accent' },
};

export const TABLE_STATUS = {
  empty: { label: 'Boş', color: 'var(--success)', bg: 'var(--success-muted)' },
  occupied: { label: 'Dolu', color: 'var(--warning)', bg: 'var(--warning-muted)' },
  reserved: { label: 'Rezerve', color: 'var(--purple)', bg: 'var(--purple-muted)' },
};

export const TAKEAWAY_STATUS = {
  new: { label: 'Yeni', color: 'info' },
  preparing: { label: 'Hazırlanıyor', color: 'warning' },
  ready: { label: 'Hazır', color: 'success' },
  on_delivery: { label: 'Kuryede', color: 'orange' },
  delivered: { label: 'Teslim Edildi', color: 'accent' },
  cancelled: { label: 'İptal', color: 'danger' },
};

export const PAYMENT_TYPES = {
  cash: { label: 'Nakit', icon: '💵' },
  card: { label: 'Kredi Kartı', icon: '💳' },
};

export const ROLES = {
  admin: 'Yönetici',
  cashier: 'Kasiyer',
  waiter: 'Garson',
  kitchen: 'Mutfak',
};

export function formatCurrency(amount) {
  return new Intl.NumberFormat('tr-TR', {
    style: 'currency',
    currency: 'TRY',
    minimumFractionDigits: 2,
  }).format(amount || 0);
}

export function formatTime(dateStr) {
  if (!dateStr) return '';
  const ms = parseDbTimestampMs(dateStr);
  if (!Number.isFinite(ms)) return '';
  return formatTimeInIstanbul(new Date(ms));
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const ms = parseDbTimestampMs(dateStr);
  if (!Number.isFinite(ms)) return '';
  return formatDateInIstanbul(new Date(ms));
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '';
  const ms = parseDbTimestampMs(dateStr);
  if (!Number.isFinite(ms)) return '';
  return formatDateTimeInIstanbul(new Date(ms));
}

/** Sunucu (SQLite datetime('now')) UTC string'leri; tarayıcı "YYYY-MM-DD HH:MM:SS"i yerel sanıp ~3 saat sapma yapmasın diye ms. */
export function parseDbTimestampMs(dateStr) {
  if (!dateStr) return NaN;
  const s = String(dateStr).trim();
  if (!s) return NaN;
  if (/[zZ]|[+-]\d{2}:?\d{2}$/.test(s)) return new Date(s).getTime();
  if (/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}:\d{2}/.test(s)) {
    return Date.parse(s.replace(' ', 'T') + 'Z');
  }
  return new Date(s).getTime();
}

export function timeAgo(dateStr, now = Date.now()) {
  const ms = parseDbTimestampMs(dateStr);
  if (!Number.isFinite(ms)) return '';
  const diff = now - ms;
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'Az önce';
  if (mins < 60) return `${mins} dk`;
  const hours = Math.floor(mins / 60);
  const remMin = mins % 60;
  if (hours < 24) {
    return remMin > 0 ? `${hours} sa ${remMin} dk` : `${hours} sa`;
  }
  return `${Math.floor(hours / 24)} gün`;
}
