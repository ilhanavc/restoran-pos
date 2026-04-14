export function getActiveOrderItems(order) {
  return (order?.items || []).filter((item) => item.status !== 'cancelled');
}

export function hasUnsavedOrderChanges(cartItems) {
  return (cartItems || []).length > 0;
}

export function getOrderTotalsForDisplay(order, cartItems) {
  const cartSubtotal = (cartItems || []).reduce((sum, item) => sum + Number(item.unit_price || 0) * Number(item.quantity || 0), 0);
  const savedTotal = Number(order?.grand_total) || 0;
  const savedSubtotal = Number(order?.subtotal) || 0;
  return {
    cartSubtotal,
    savedTotal,
    displayTotal: savedTotal + cartSubtotal,
    araTotal: savedSubtotal + cartSubtotal,
  };
}

export function isOrderClosedOrCancelled(order) {
  return ['closed', 'cancelled'].includes(order?.status);
}

export function canOpenOrderPayment(order, cartItems) {
  return Boolean(
    order
    && !hasUnsavedOrderChanges(cartItems)
    && order.status !== 'closed'
    && getActiveOrderItems(order).length > 0,
  );
}

export function canEditOrderItem(item, order) {
  return Boolean(item && item.status === 'new' && !item.is_comped && order?.status !== 'closed');
}

export function canVoidOrderItem(item, order, hasPrivilegedRole = false) {
  if (!item || !order || order.status === 'closed' || item.is_comped) return false;
  if (item.status === 'new') return true;
  return Boolean(hasPrivilegedRole);
}

export function canSaveOrderDraft({ cartItems, orderType, selectedCustomer }) {
  if (!hasUnsavedOrderChanges(cartItems)) {
    return { ok: false, reason: 'empty' };
  }
  if (orderType === 'takeaway' && !selectedCustomer?.id) {
    return { ok: false, reason: 'customer-required' };
  }
  return { ok: true, reason: null };
}
