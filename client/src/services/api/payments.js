export const paymentsMixin = {
  createPayment(data) { return this.post('/payments', data); },
  getSplitPaymentState(orderId) { return this.get(`/payments/orders/${orderId}/split-state`); },
  createSplitPayment(data) { return this.post('/payments/split', data); },
  getPaymentSummary(params = {}) { return this.get(`/payments/summary${this.buildQuery(params)}`); },
};
