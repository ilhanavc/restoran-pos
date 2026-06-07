export const customersMixin = {
  getCustomers(params = {}) { return this.get(`/customers${this.buildQuery(params)}`); },
  getCustomersExport() { return this.get('/customers/export'); },
  getCustomer(id) { return this.get(`/customers/${id}`); },
  getCustomerStats(id) { return this.get(`/customers/${id}/stats`); },
  createCustomer(data) { return this.post('/customers', data); },
  updateCustomer(id, data) { return this.patch(`/customers/${id}`, data); },
  addCustomerPhone(id, phone) { return this.post(`/customers/${id}/phones`, { phone }); },
  deleteCustomerPhone(id, phoneId) { return this.delete(`/customers/${id}/phones/${phoneId}`); },
  addCustomerAddress(id, data) { return this.post(`/customers/${id}/addresses`, data); },
  updateCustomerAddress(id, addressId, data) { return this.patch(`/customers/${id}/addresses/${addressId}`, data); },
  deleteCustomerAddress(id, addressId) { return this.delete(`/customers/${id}/addresses/${addressId}`); },
  previewCustomerImport({ rows, preview_token, page = 1, page_size = 250 }) {
    return this.post('/customers/import/preview', { rows, preview_token, page, page_size });
  },
  commitCustomerImport(previewToken) {
    return this.post('/customers/import/commit', { preview_token: previewToken });
  },
};
