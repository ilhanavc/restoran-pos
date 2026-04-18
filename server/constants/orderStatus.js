/**
 * orders.status alanı — migrations/run.js CHECK ile uyumlu kapalı statüler.
 * Buna düşmeyen siparişler masa bağlamında "açık" kabul edilir (sync-tables vb.).
 */
export const ORDER_STATUSES_CLOSED = Object.freeze(['closed', 'cancelled']);

/** Tüm geçerli sipariş durumları — Zod enum ve runtime kontrol için tek kaynak. */
export const ORDER_STATUSES_ALL = Object.freeze([
  'new', 'saved', 'in_kitchen', 'preparing', 'ready', 'served', 'cancelled', 'closed',
]);

/** Tüm geçerli sipariş kalemi durumları — Zod enum ve runtime kontrol için tek kaynak. */
export const ORDER_ITEM_STATUSES_ALL = Object.freeze([
  'new', 'sent', 'preparing', 'ready', 'served', 'cancelled', 'comped',
]);

export function orderStatusIsOpen(status) {
  if (status == null || status === '') return true;
  return !ORDER_STATUSES_CLOSED.includes(String(status));
}
