/**
 * print_jobs.payload JSON → ESC/POS byte buffer (UTF-8).
 * 80 mm termal: sabit satır genişliği, hizalı metin; init + kesim korunur.
 */

/** @type {number} 80 mm termal için tipik karakter genişliği (12 cpi civarı) */
const LINE_WIDTH = 42;

function concat(buffers) {
  return Buffer.concat(buffers.filter(Boolean));
}

function escInit() {
  return Buffer.from([0x1b, 0x40]);
}

function textLine(s) {
  const line = s == null ? '' : String(s);
  return Buffer.from(`${line}\n`, 'utf8');
}

function feedAndCut() {
  return Buffer.from([0x1d, 0x56, 0x00]);
}

function separator(width = LINE_WIDTH) {
  return '-'.repeat(Math.max(8, width));
}

/** @param {string} s */
function centerLine(s, width = LINE_WIDTH) {
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
function alignLeftRight(left, right, width = LINE_WIDTH) {
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
function linesProductQty(productName, qtyLabel, width = LINE_WIDTH) {
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

const PAY_LABELS = {
  cash: 'Nakit',
  card: 'Kredi kartı',
  mixed: 'Karışık',
  other: 'Diğer',
};

function paymentLabel(type) {
  return PAY_LABELS[String(type || '').toLowerCase()] || type || '-';
}

function buildKitchenLines(p) {
  const w = LINE_WIDTH;
  const out = [];
  const sep = separator(w);

  if (p.error) {
    out.push(sep, centerLine('MUTFAK', w), sep, `Hata: ${p.error}`, '');
    const lines = Array.isArray(p.lines) ? p.lines : [];
    for (const ln of lines) {
      const name = ln.product_name || '';
      const qty = formatQty(ln.quantity);
      for (const row of linesProductQty(name, qty, w)) {
        out.push(row);
      }
    }
    return out;
  }

  const title = orderTypeTitle(p.order_type);
  const station = stationLabel(p.station);

  out.push(sep);
  out.push(centerLine(title, w));
  out.push(centerLine(station, w));
  out.push(sep);
  out.push(alignLeftRight(fmtDateTime(p.created_at), `No: ${p.order_no ?? ''}`, w));
  out.push(tableOrPackageLine(p));
  if (p.user_name) out.push(`Personel: ${p.user_name}`);
  out.push(sep);

  const lines = Array.isArray(p.lines) ? p.lines : [];
  for (const ln of lines) {
    const name = ln.product_name || '';
    const qty = formatQty(ln.quantity);
    for (const row of linesProductQty(name, qty, w)) {
      out.push(row);
    }
    if (ln.note) {
      const noteLines = wrapText(`  Not: ${ln.note}`, w - 2);
      for (const nl of noteLines) {
        out.push(`  ${nl}`);
      }
    }
  }

  out.push(sep);
  out.push(centerLine(`Sipariş ${p.order_no ?? ''}`, w));
  if (p.printer_name) out.push(centerLine(String(p.printer_name), w));
  return out;
}

function buildReceiptLines(p) {
  const w = LINE_WIDTH;
  const out = [];
  const sep = separator(w);

  const title = orderTypeTitle(p.order_type);
  out.push(sep);
  out.push(centerLine(title, w));
  out.push(sep);
  out.push(alignLeftRight(fmtDateTime(p.created_at), `No: ${p.order_no ?? ''}`, w));
  out.push(tableOrPackageLine(p));
  if (p.user_name) out.push(`Personel: ${p.user_name}`);
  out.push(sep);

  if (p.customer_name) out.push(`Müşteri: ${p.customer_name}`);
  if (p.customer_phone) out.push(`Tel: ${p.customer_phone}`);
  const pays = Array.isArray(p.payments) ? p.payments : [];
  if (pays.length) {
    const summary = pays.map((x) => paymentLabel(x.payment_type)).join(' + ');
    out.push(`Ödeme: ${summary}`);
  }
  out.push(sep);

  const items = Array.isArray(p.items) ? p.items : [];
  for (const it of items) {
    const name = it.product_name || '';
    const qty = formatQty(it.quantity);
    for (const row of linesProductQty(name, qty, w)) {
      out.push(row);
    }
  }

  out.push(sep);
  if (p.subtotal != null) out.push(alignLeftRight('Ara toplam', fmtMoney(p.subtotal), w));
  const disc = Number(p.discount_amount);
  if (disc > 0) out.push(alignLeftRight('İndirim', `-${fmtMoney(disc)}`, w));
  if (p.grand_total != null) out.push(alignLeftRight('TOPLAM', fmtMoney(p.grand_total), w));

  if (pays.length) {
    out.push(sep);
    for (const pay of pays) {
      const lbl = paymentLabel(pay.payment_type);
      const amt = fmtMoney(pay.amount);
      out.push(alignLeftRight(lbl, amt, w));
      if (Number(pay.change_amount) > 0) {
        out.push(alignLeftRight('Para üstü', fmtMoney(pay.change_amount), w));
      }
    }
  }

  out.push(sep);
  out.push(centerLine(`Teşekkürler · ${p.order_no ?? ''}`, w));
  if (p.printer_name) out.push(centerLine(String(p.printer_name), w));
  return out;
}

/**
 * @param {{ job_type: string, payload: object }} job
 */
export function payloadToEscPosBuffer(job) {
  const p = job.payload || {};
  const parts = [escInit()];

  if (p.kind === 'kitchen') {
    for (const line of buildKitchenLines(p)) {
      parts.push(textLine(line));
    }
  } else if (p.kind === 'receipt') {
    for (const line of buildReceiptLines(p)) {
      parts.push(textLine(line));
    }
  } else {
    parts.push(textLine(separator(LINE_WIDTH)));
    parts.push(textLine(`İş: ${job.job_type || '?'}`));
    parts.push(textLine(String(JSON.stringify(p)).slice(0, LINE_WIDTH * 2)));
  }

  parts.push(textLine(''), feedAndCut());
  return concat(parts);
}
