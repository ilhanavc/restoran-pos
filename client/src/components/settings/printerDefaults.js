/** Sunucu ile uyumlu varsayılan print_options iskeleti (istemci tarafı). */

export function createEmptyPrintOptions() {
  return {
    roles: {
      receipt: false,
      kitchen: false,
      bar: false,
      courier: false,
      server: false,
    },
    kitchenGroups: {
      FIRIN: false,
      IZGARA: false,
      ICECEKLER: false,
    },
    output: {
      showPrices: false,
      showOrderTotal: false,
      showOrderNumber: true,
      showVat: false,
      footerNote: '',
    },
  };
}

export function normalizePrintOptions(po, type) {
  const e = createEmptyPrintOptions();
  const out = {
    roles: { ...e.roles, ...(po?.roles || {}) },
    kitchenGroups: { ...e.kitchenGroups, ...(po?.kitchenGroups || {}) },
    output: { ...e.output, ...(po?.output || {}) },
  };
  const pk = type === 'receipt' ? 'receipt' : type === 'kitchen' ? 'kitchen' : 'bar';
  out.roles[pk] = true;
  return out;
}

export const primaryTypeLabel = (t) =>
  ({ receipt: 'Adisyon', kitchen: 'Mutfak', bar: 'Bar' }[t] || t);

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
  if (p.ip_address) return `${conn} · ${p.ip_address}:${p.port ?? 9100}`;
  return conn;
}
