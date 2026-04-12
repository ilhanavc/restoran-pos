/** Sipariş satırı (order_items) durum rozetleri — sipariş alma ekranı */
export const ORDER_ITEM_LINE_STATUS = {
  new: { label: 'Yeni', short: 'YENİ', bg: 'rgba(59,130,246,.2)', color: '#93c5fd' },
  sent: { label: 'Mutfakta', short: 'MUTFAK', bg: 'rgba(245,158,11,.2)', color: '#fbbf24' },
  preparing: { label: 'Hazırlanıyor', short: 'HAZIRLANIYOR', bg: 'rgba(245,158,11,.25)', color: '#f59e0b' },
  ready: { label: 'Hazır', short: 'HAZIR', bg: 'rgba(34,197,94,.25)', color: '#4ade80' },
  served: { label: 'Servis', short: 'SERVİS', bg: 'rgba(148,163,184,.2)', color: '#94a3b8' },
  comped: { label: 'İkram', short: 'İKRAM', bg: 'rgba(239,68,68,.15)', color: '#f87171' },
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
  mixed: { label: 'Karışık', icon: '🔀' },
  other: { label: 'Diğer', icon: '📋' },
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
  return new Date(ms).toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' });
}

export function formatDate(dateStr) {
  if (!dateStr) return '';
  const ms = parseDbTimestampMs(dateStr);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleDateString('tr-TR');
}

export function formatDateTime(dateStr) {
  if (!dateStr) return '';
  const ms = parseDbTimestampMs(dateStr);
  if (!Number.isFinite(ms)) return '';
  return new Date(ms).toLocaleString('tr-TR');
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
