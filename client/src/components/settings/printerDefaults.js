/** Sunucu ile uyumlu print_options iskeleti (istemci). */

export const FONT_FAMILY_OPTIONS = [
  { value: 'Courier New', label: 'Courier New' },
  { value: 'ui-monospace, monospace', label: 'Sistem monospace' },
];

function defaultLayoutReceipt() {
  return {
    fontFamily: 'Courier New',
    fontSizeHeader: 18,
    fontSizeSubheader: 13,
    fontSizeItems: 13,
    fontSizeTotal: 16,
    fontSizeFooter: 12,
    marginLeft: 8,
    marginRight: 8,
    footerLine1: 'Afiyet olsun',
    footerLine2: '',
  };
}

function defaultLayoutKitchen() {
  return {
    fontFamily: 'Courier New',
    fontSizeTitle: 15,
    fontSizeItems: 14,
    marginLeft: 6,
    marginRight: 6,
    footerLine1: '',
    footerLine2: '',
  };
}

function defaultOutputReceipt() {
  return {
    showPrices: true,
    showOrderTotal: true,
    showOrderNumber: true,
    showVat: false,
    footerNote: '',
  };
}

function defaultOutputKitchen() {
  return {
    showPrices: false,
    showOrderTotal: false,
    showOrderNumber: true,
    showVat: false,
    footerNote: '',
  };
}

function defaultOutputBar() {
  return {
    showPrices: false,
    showOrderTotal: false,
    showOrderNumber: true,
    showVat: false,
    footerNote: '',
  };
}

/** @param {'receipt' | 'kitchen' | 'bar'} type */
export function defaultLayoutForType(type) {
  if (type === 'kitchen') return defaultLayoutKitchen();
  if (type === 'bar') return { ...defaultLayoutKitchen(), fontSizeTitle: 14, fontSizeItems: 13 };
  return defaultLayoutReceipt();
}

function defaultCopies() {
  return {
    dine_in: 1,
    takeaway: 1,
    delivery: 1,
    after_payment: 1,
  };
}

export function defaultTemplateForType(type) {
  if (type === 'kitchen' || type === 'bar') {
    return [
      '{{center:MUTFAK}}',
      '{{center:{order_type} | {table}}}',
      'No: {order_no}   {date}',
      '{{line}}',
      'URUN                            ADET',
      '{{line}}',
      '{{items}}',
      '{{line}}',
      '{{center:- {short_no} -}}',
      '{footer1}',
    ].join('\n');
  }
  return [
    '{{center:{business_name}}}',
    '{{center:{business_address}}}',
    '{{center:{business_phone}}}',
    '{{line}}',
    '{{center:{order_type}}}',
    'No: {order_no}   {date}',
    '{table}',
    '{{line}}',
    'URUN              MIKTAR       TUTAR',
    '{{line}}',
    '{{items}}',
    '{{line}}',
    'Ara toplam: {subtotal}',
    'TOPLAM: {total}',
    '{{payments}}',
    '{{line}}',
    '{{center:{footer1}}}',
    '{{center:{footer2}}}',
  ].join('\n');
}

/** @param {'receipt' | 'kitchen' | 'bar'} type */
export function createEmptyPrintOptions(type) {
  const pk = type === 'receipt' ? 'receipt' : type === 'kitchen' ? 'kitchen' : 'bar';
  const output =
    type === 'receipt' ? defaultOutputReceipt() : type === 'kitchen' ? defaultOutputKitchen() : defaultOutputBar();
  return {
    device: {
      physicalName: null,
      source: 'manual',
    },
    layout: defaultLayoutForType(type),
    copies: defaultCopies(),
    printOnSave: false,
    printOnIntegrationApprove: false,
    skipPhoenixCmd: true,
    encodingMode: 'win1254',
    roles: {
      receipt: pk === 'receipt',
      kitchen: pk === 'kitchen',
      bar: pk === 'bar',
      courier: false,
      server: false,
    },
    kitchenGroups: {
      FIRIN: false,
      IZGARA: false,
      ICECEKLER: false,
    },
    output,
    template: {
      enabled: false,
      body: defaultTemplateForType(type),
    },
  };
}

function deepMergeDevice(base, patch) {
  return { ...base, ...(patch || {}) };
}

function deepMergeLayout(base, patch) {
  return { ...base, ...(patch || {}) };
}

function deepMergeCopies(base, patch) {
  return { ...base, ...(patch || {}) };
}

/**
 * API'den gelen print_options ile tip için tam şekil + eksik alanları doldur.
 * @param {object} po
 * @param {'receipt' | 'kitchen' | 'bar'} type
 */
export function normalizePrintOptions(po, type) {
  const e = createEmptyPrintOptions(type);
  const parsed = po && typeof po === 'object' ? po : {};
  const layoutFromLegacy = {};
  if (!parsed.layout?.footerLine1 && parsed.output?.footerNote) {
    layoutFromLegacy.footerLine1 = parsed.output.footerNote;
  }
  const out = {
    device: deepMergeDevice(e.device, parsed.device),
    layout: deepMergeLayout(e.layout, { ...layoutFromLegacy, ...(parsed.layout || {}) }),
    copies: deepMergeCopies(e.copies, parsed.copies),
    printOnSave: typeof parsed.printOnSave === 'boolean' ? parsed.printOnSave : e.printOnSave,
    printOnIntegrationApprove:
      typeof parsed.printOnIntegrationApprove === 'boolean'
        ? parsed.printOnIntegrationApprove
        : e.printOnIntegrationApprove,
    skipPhoenixCmd:
      typeof parsed.skipPhoenixCmd === 'boolean' ? parsed.skipPhoenixCmd : e.skipPhoenixCmd,
    encodingMode: parsed.encodingMode === 'pc857' ? 'pc857' : e.encodingMode,
    roles: { ...e.roles, ...(parsed.roles || {}) },
    kitchenGroups: { ...e.kitchenGroups, ...(parsed.kitchenGroups || {}) },
    output: { ...e.output, ...(parsed.output || {}) },
    template: {
      ...e.template,
      ...(parsed.template && typeof parsed.template === 'object' ? parsed.template : {}),
      enabled: false,
    },
  };
  const pk = type === 'receipt' ? 'receipt' : type === 'kitchen' ? 'kitchen' : 'bar';
  out.roles[pk] = true;
  return out;
}

/** Bu tip için önerilen varsayılanlarla tam print_options (UI «Varsayılanlara dön»). */
export function resetPrintOptionsForType(type) {
  return normalizePrintOptions({}, type);
}

export const primaryTypeLabel = (t) =>
  ({ receipt: 'Adisyon', kitchen: 'Mutfak', bar: 'Bar' }[t] || t);

/** Liste sütunu */
export const listTypeLabel = (t) => {
  if (t === 'bar') return 'Bar (legacy)';
  return primaryTypeLabel(t);
};

export const ROLE_LABELS = {
  receipt: 'Adisyon',
  kitchen: 'Mutfak',
  bar: 'Bar',
  courier: 'Kurye',
  server: 'Abiye',
};

export function formatRoleTags(type, printOptions) {
  const roles = printOptions?.roles || {};
  const primaryKey = type === 'receipt' ? 'receipt' : type === 'kitchen' ? 'kitchen' : 'bar';
  const primary = primaryTypeLabel(type);
  const extras = [];
  for (const [k, v] of Object.entries(roles)) {
    if (!v) continue;
    if (k === primaryKey) continue;
    if (ROLE_LABELS[k]) extras.push(ROLE_LABELS[k]);
  }
  if (!extras.length) return primary;
  return `${primary} · ${extras.join(', ')}`;
}

export function connectionSummary(p) {
  const conn = p.connection_type || 'network';
  const phys = p.print_options?.device?.physicalName;
  const tail = phys ? ` · ${phys}` : '';
  if (p.ip_address) return `${conn} · ${p.ip_address}:${p.port ?? 9100}${tail}`;
  return `${conn}${tail}`;
}
