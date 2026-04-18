export const ordersMixin = {
  getOrders(params = {}) { return this.get(`/orders${this.buildQuery(params)}`); },
  getOrder(id) { return this.get(`/orders/${id}`); },
  getActiveOrders() { return this.get('/orders/active'); },
  createOrder(data) { return this.post('/orders', data); },
  addOrderItems(orderId, items) { return this.post(`/orders/${orderId}/items`, { items }); },
  updateOrderStatus(id, status) { return this.patch(`/orders/${id}/status`, { status }); },
  patchOrderCustomer(orderId, customerId) {
    return this.patch(`/orders/${orderId}/customer`, { customer_id: customerId });
  },
  updateOrderItem(orderId, itemId, data) { return this.patch(`/orders/${orderId}/items/${itemId}`, data); },
  getTakeawayOpenOrders() { return this.get('/orders/takeaway/open'); },
  patchTakeawayDelivery(orderId, action) {
    return this.patch(`/orders/${orderId}/takeaway/delivery`, { action });
  },
  printTakeawayLabel(orderId, options = {}) {
    const body = options?.printer_id ? { printer_id: options.printer_id } : {};
    return this.post(`/orders/${orderId}/takeaway/print-label`, body);
  },
  printOrderReceipt(orderId, options = {}) {
    const body = options?.printer_id ? { printer_id: options.printer_id } : {};
    return this.post(`/orders/${orderId}/print-receipt`, body);
  },
  getPrintHealth() { return this.get('/orders/print-health'); },
  retryPrintJob(jobId) { return this.post(`/orders/print-jobs/${encodeURIComponent(jobId)}/retry`, {}); },
};
