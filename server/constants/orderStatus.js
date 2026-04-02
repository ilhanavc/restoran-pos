/**
 * orders.status alanı — migrations/run.js CHECK ile uyumlu kapalı statüler.
 * Buna düşmeyen siparişler masa bağlamında "açık" kabul edilir (sync-tables vb.).
 */
export const ORDER_STATUSES_CLOSED = Object.freeze(['closed', 'cancelled']);

export function orderStatusIsOpen(status) {
  if (status == null || status === '') return true;
  return !ORDER_STATUSES_CLOSED.includes(String(status));
}
