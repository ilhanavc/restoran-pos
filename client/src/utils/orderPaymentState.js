const PAYMENT_TOLERANCE = 0.02;

export function roundMoney(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export function getPaidTotal(order) {
  if (Array.isArray(order?.payments)) {
    return roundMoney(order.payments.reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0));
  }
  return roundMoney(order?.paid_total ?? order?.order_paid_total ?? 0);
}

export function getOrderTotal(order) {
  return roundMoney(order?.grand_total ?? order?.total ?? order?.order_total ?? 0);
}

export function getTotalDue(order) {
  return roundMoney(Math.max(0, getOrderTotal(order) - getPaidTotal(order)));
}

export function isOrderFullyPaid(order) {
  const total = getOrderTotal(order);
  return total > 0 && getPaidTotal(order) + PAYMENT_TOLERANCE >= total;
}

export function canCloseOrder(order) {
  if (['closed', 'cancelled'].includes(order?.status)) return false;
  return Boolean(order?.id || order?.current_order_id) && isOrderFullyPaid(order);
}

export function getPaymentStateLabel(order) {
  const total = getOrderTotal(order);
  const paid = getPaidTotal(order);
  if (total <= 0) return { key: 'empty', label: 'Tutar yok', color: 'var(--text-muted)', bg: 'var(--bg-tertiary)' };
  if (paid + PAYMENT_TOLERANCE >= total) return { key: 'paid', label: 'Ödendi', color: 'var(--success)', bg: 'var(--success-muted)' };
  if (paid > 0) return { key: 'partial', label: 'Kısmi ödendi', color: 'var(--warning)', bg: 'var(--warning-muted)' };
  return { key: 'unpaid', label: 'Ödenmedi', color: 'var(--danger)', bg: 'var(--danger-muted)' };
}

export function getPaymentSummary(order) {
  const total = getOrderTotal(order);
  const paid = getPaidTotal(order);
  const due = getTotalDue(order);
  return {
    total,
    paid,
    due,
    fullyPaid: isOrderFullyPaid(order),
    canClose: canCloseOrder(order),
    label: getPaymentStateLabel(order),
  };
}

export { PAYMENT_TOLERANCE };
