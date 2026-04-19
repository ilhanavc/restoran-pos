export const FIELD_LABELS = {
  id: 'ID',
  created_at: 'Oluşturulma',
  updated_at: 'Güncellenme',
  closed_at: 'Kapanış',
  paid_at: 'Ödeme zamanı',
  deleted_at: 'Silinme',
  expires_at: 'Son geçerlilik',
  last_seen_at: 'Son aktivite',
  is_active: 'Aktif',
  business_id: 'İşletme',

  // Orders
  order_number: 'Sipariş No',
  order_type: 'Sipariş Tipi',
  status: 'Durum',
  payment_status: 'Ödeme Durumu',
  table_id: 'Masa',
  customer_id: 'Müşteri',
  user_id: 'Kullanıcı',
  notes: 'Not',
  subtotal: 'Ara Toplam',
  discount: 'İndirim',
  discount_amount: 'İndirim Tutarı',
  service_charge_rate: 'Servis Oranı',
  service_charge_amount: 'Servis Ücreti',
  grand_total: 'Toplam',
  pricing_policy_version: 'Menü Versiyonu',

  // Order items
  product_id: 'Ürün',
  quantity: 'Adet',
  unit_price: 'Birim Fiyat',
  total: 'Toplam',
  vat_rate: 'KDV Oranı',
  vat_rate_snapshot: 'KDV Oranı (snapshot)',
  modifiers: 'Seçenekler',
  item_note: 'Ürün Notu',
  portion_id: 'Porsiyon',

  // Payment
  amount: 'Tutar',
  payment_type: 'Ödeme Tipi',
  tip_amount: 'Bahşiş',
  change_amount: 'Para Üstü',
  received_amount: 'Alınan Tutar',

  // Refund
  refund_reason: 'İade Nedeni',
  refund_amount: 'İade Tutarı',
  refunded_by: 'İade Eden',

  // Product
  name: 'Ad',
  price: 'Fiyat',
  category_id: 'Kategori',
  description: 'Açıklama',
  sku: 'Stok Kodu',
  image_url: 'Görsel',
  display_order: 'Sıra',

  // Customer
  phone: 'Telefon',
  phone_e164: 'Telefon',
  email: 'E-posta',
  address: 'Adres',
  first_name: 'Ad',
  last_name: 'Soyad',
  full_name: 'Ad Soyad',

  // User
  role: 'Rol',
  password_hash: 'Parola',

  // Printer
  printer_type: 'Yazıcı Tipi',
  connection_type: 'Bağlantı',
  ip_address: 'IP Adresi',
  port: 'Port',

  // Stock
  stock_item_id: 'Stok Kalemi',
  movement_type: 'Hareket Tipi',
  movement_qty: 'Miktar',
  low_stock_threshold: 'Düşük Stok Eşiği',
  unit: 'Birim',
  current_stock: 'Mevcut Stok',
};

export const ENUM_LABELS = {
  status: {
    pending: 'Beklemede',
    preparing: 'Hazırlanıyor',
    ready: 'Hazır',
    served: 'Servis Edildi',
    paid: 'Ödendi',
    closed: 'Kapalı',
    cancelled: 'İptal',
    delivered: 'Teslim Edildi',
    on_the_way: 'Yolda',
  },
  payment_status: {
    unpaid: 'Ödenmedi',
    partial: 'Kısmi Ödendi',
    paid: 'Ödendi',
    refunded: 'İade Edildi',
  },
  payment_type: {
    cash: 'Nakit',
    card: 'Kart',
    mixed: 'Karışık',
    online: 'Online',
  },
  order_type: {
    dine_in: 'Masa',
    takeaway: 'Paket',
    delivery: 'Servis',
  },
  role: {
    admin: 'Yönetici',
    cashier: 'Kasiyer',
    waiter: 'Garson',
    kitchen: 'Mutfak',
  },
  printer_type: {
    receipt: 'Kasa Fişi',
    kitchen: 'Mutfak',
    label: 'Etiket',
  },
  connection_type: {
    network: 'Ağ',
    usb: 'USB',
    bluetooth: 'Bluetooth',
    serial: 'Seri',
  },
  movement_type: {
    in: 'Giriş',
    out: 'Çıkış',
    adjustment: 'Düzeltme',
    waste: 'Fire',
  },
};

const MONEY_FIELDS = new Set([
  'price', 'grand_total', 'subtotal', 'total', 'amount', 'discount',
  'discount_amount', 'tip_amount', 'unit_price', 'service_charge_amount',
  'refund_amount', 'change_amount', 'received_amount',
]);

const DATE_FIELDS = new Set([
  'created_at', 'updated_at', 'closed_at', 'paid_at', 'deleted_at',
  'expires_at', 'last_seen_at', 'start_time', 'end_time',
]);

const BOOL_FIELDS = new Set(['is_active', 'is_default', 'completed', 'arrived', 'no_show']);

const HIDDEN_FIELDS = new Set(['business_id', 'password_hash']);

export function isHiddenField(key) {
  return HIDDEN_FIELDS.has(key);
}

export function labelForField(key) {
  return FIELD_LABELS[key] || key;
}

function formatMoney(n) {
  if (n === null || n === undefined || n === '') return '—';
  const num = Number(n);
  if (!Number.isFinite(num)) return String(n);
  return num.toLocaleString('tr-TR', { minimumFractionDigits: 2, maximumFractionDigits: 2 }) + ' ₺';
}

function formatDate(v) {
  if (!v) return '—';
  try {
    return new Date(v).toLocaleString('tr-TR', {
      day: '2-digit', month: '2-digit', year: 'numeric',
      hour: '2-digit', minute: '2-digit',
    });
  } catch {
    return String(v);
  }
}

export function formatValue(key, value) {
  if (value === null || value === undefined || value === '') return '—';
  if (ENUM_LABELS[key] && ENUM_LABELS[key][value] !== undefined) return ENUM_LABELS[key][value];
  if (MONEY_FIELDS.has(key)) return formatMoney(value);
  if (DATE_FIELDS.has(key)) return formatDate(value);
  if (BOOL_FIELDS.has(key) || typeof value === 'boolean') {
    const b = typeof value === 'boolean' ? value : value === 1 || value === '1' || value === 'true';
    return b ? 'Evet' : 'Hayır';
  }
  if (key === 'modifiers' && Array.isArray(value)) {
    return value.length === 0 ? '—' : value.map((m) => m.name || m.value || JSON.stringify(m)).join(', ');
  }
  if (typeof value === 'object') return JSON.stringify(value);
  const str = String(value);
  return str.length > 100 ? str.slice(0, 100) + '…' : str;
}

const ACTION_VERBS = {
  create: 'oluşturdu',
  update: 'güncelledi',
  delete: 'sildi',
  deactivate: 'pasifleştirdi',
  status_change: 'durumunu değiştirdi',
  cancel: 'iptal etti',
};

const ENTITY_NAMES = {
  products: { subject: 'ürün', prefix: 'Ürün' },
  stock_items: { subject: 'stok kalemi', prefix: 'Stok' },
  stock_movements: { subject: 'stok hareketi', prefix: 'Stok hareketi' },
  customers: { subject: 'müşteri', prefix: 'Müşteri' },
  businesses: { subject: 'işletme bilgisi', prefix: 'İşletme' },
  printers: { subject: 'yazıcı', prefix: 'Yazıcı' },
  printer_routing: { subject: 'yazıcı yönlendirme', prefix: 'Yazıcı yönlendirme' },
  users: { subject: 'kullanıcı', prefix: 'Kullanıcı' },
  orders: { subject: 'sipariş', prefix: 'Sipariş' },
  payments: { subject: 'ödeme', prefix: 'Ödeme' },
  refunds: { subject: 'iade', prefix: 'İade' },
};

export function entityLabel(row) {
  const { entity_table, entity_id, after_json, before_json } = row;
  const snap = after_json || before_json || {};
  const meta = ENTITY_NAMES[entity_table] || { subject: entity_table, prefix: entity_table };
  const short = entity_id ? entity_id.slice(0, 8) : '';

  switch (entity_table) {
    case 'orders': {
      const num = snap.order_number ? `#${snap.order_number}` : (short ? `#${short}` : '');
      const type = snap.order_type ? (ENUM_LABELS.order_type[snap.order_type] || snap.order_type) : '';
      const total = snap.grand_total !== undefined ? formatMoney(snap.grand_total) : '';
      const bits = [num, type, total].filter(Boolean);
      return `Sipariş ${bits.join(' · ')}`.trim();
    }
    case 'payments': {
      const amount = snap.amount !== undefined ? formatMoney(snap.amount) : '';
      const type = snap.payment_type ? (ENUM_LABELS.payment_type[snap.payment_type] || snap.payment_type) : '';
      return `Ödeme ${[amount, type].filter(Boolean).join(' · ')}`.trim();
    }
    case 'refunds': {
      const amount = snap.refund_amount !== undefined ? formatMoney(snap.refund_amount) : '';
      return `İade ${amount}`.trim();
    }
    case 'products':
      return snap.name ? `Ürün: ${snap.name}` : `Ürün #${short}`;
    case 'customers': {
      const name = [snap.first_name, snap.last_name].filter(Boolean).join(' ').trim()
        || snap.full_name
        || snap.phone_e164
        || snap.phone;
      return name ? `Müşteri: ${name}` : `Müşteri #${short}`;
    }
    case 'users':
      return snap.full_name ? `Kullanıcı: ${snap.full_name}` : (snap.email ? `Kullanıcı: ${snap.email}` : `Kullanıcı #${short}`);
    case 'printers':
      return snap.name ? `Yazıcı: ${snap.name}` : `Yazıcı #${short}`;
    case 'stock_items':
      return snap.name ? `Stok: ${snap.name}` : `Stok kalemi #${short}`;
    case 'stock_movements': {
      const type = snap.movement_type ? (ENUM_LABELS.movement_type[snap.movement_type] || snap.movement_type) : '';
      const qty = snap.movement_qty !== undefined ? `${snap.movement_qty} ${snap.unit || ''}`.trim() : '';
      return `Stok hareketi ${[type, qty].filter(Boolean).join(' · ')}`.trim();
    }
    case 'businesses':
      return snap.name ? `İşletme: ${snap.name}` : 'İşletme bilgisi';
    case 'printer_routing':
      return 'Yazıcı yönlendirme kuralı';
    default:
      return `${meta.prefix}${short ? ' #' + short : ''}`;
  }
}

export function activitySentence(row) {
  const actor = row.actor_name || 'Bilinmeyen kullanıcı';
  const entity = entityLabel(row);
  const verb = ACTION_VERBS[row.action] || row.action;
  const { action, before_json, after_json } = row;

  if (action === 'create') return `${actor}, yeni ${ENTITY_NAMES[row.entity_table]?.subject || row.entity_table} oluşturdu: ${entity}`;
  if (action === 'delete') return `${actor}, ${entity} kaydını sildi`;
  if (action === 'deactivate') return `${actor}, ${entity} kaydını pasifleştirdi`;
  if (action === 'cancel') return `${actor}, ${entity} kaydını iptal etti`;

  if (action === 'status_change' && before_json && after_json) {
    const ob = before_json.status;
    const na = after_json.status;
    const obLabel = ENUM_LABELS.status?.[ob] || ob;
    const naLabel = ENUM_LABELS.status?.[na] || na;
    return `${actor}, ${entity} durumunu "${obLabel}" → "${naLabel}" olarak değiştirdi`;
  }

  if (action === 'update') {
    // Try to generate readable diff summary
    if (before_json && after_json) {
      const changedKeys = [];
      const keys = new Set([...Object.keys(before_json), ...Object.keys(after_json)]);
      for (const k of keys) {
        if (isHiddenField(k)) continue;
        if (JSON.stringify(before_json[k]) !== JSON.stringify(after_json[k])) changedKeys.push(k);
      }
      if (changedKeys.length === 1) {
        const k = changedKeys[0];
        const ob = formatValue(k, before_json[k]);
        const na = formatValue(k, after_json[k]);
        return `${actor}, ${entity} kaydında "${labelForField(k)}" alanını "${ob}" → "${na}" olarak güncelledi`;
      }
      if (changedKeys.length > 1) {
        const names = changedKeys.slice(0, 3).map(labelForField).join(', ');
        const extra = changedKeys.length > 3 ? ` ve ${changedKeys.length - 3} alan daha` : '';
        return `${actor}, ${entity} kaydında ${names}${extra} güncelledi`;
      }
    }
    return `${actor}, ${entity} kaydını güncelledi`;
  }

  return `${actor}, ${entity} kaydını ${verb}`;
}

export function actionIcon(action) {
  switch (action) {
    case 'create': return '➕';
    case 'update': return '✏️';
    case 'delete': return '🗑️';
    case 'status_change': return '🔄';
    case 'cancel': return '❌';
    case 'deactivate': return '⏸️';
    default: return '•';
  }
}
