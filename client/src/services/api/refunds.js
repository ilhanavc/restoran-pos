export const refundsMixin = {
  getRefundablePayments(orderId) { return this.get(`/refunds/orders/${orderId}/payments`); },
  createRefund(data) { return this.post('/refunds', data); },
  refundOrderFull(orderId, data = {}) { return this.post(`/refunds/orders/${orderId}/full`, data); },
};
