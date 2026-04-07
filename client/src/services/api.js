// Her zaman göreli /api — Vite dev/preview proxy'si 3001'e yönlendirir.
// Doğrudan localhost:3001 kullanmak HTML/502 yanıtlarına ve "geçersiz yanıt" hatasına yol açabiliyordu.
const API_BASE = '/api';

class ApiService {
  constructor() {
    this.token = localStorage.getItem('pos_token') || null;
  }

  setToken(token) {
    this.token = token;
    if (token) localStorage.setItem('pos_token', token);
    else localStorage.removeItem('pos_token');
  }

  async request(path, options = {}, isLogin = false) {
    const headers = { 'Content-Type': 'application/json' };
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;

    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: { ...headers, ...options.headers },
      });
    } catch (err) {
      throw new Error('Sunucuya bağlanılamadı. Backend çalışıyor mu?');
    }

    // Login dışındaki 401'lerde oturumu sıfırla
    if (res.status === 401 && !isLogin) {
      this.setToken(null);
      window.location.reload();
      throw new Error('Oturum süresi doldu');
    }

    const contentType = res.headers.get('content-type') || '';
    if (!contentType.includes('application/json')) {
      await res.text().catch(() => '');
      const backendHint =
        res.status === 502 || res.status === 503 || res.status === 504
          ? ' API sunucusu çalışmıyor olabilir — geliştirme için `npm run dev`, production için `npm run start:prod` (önce `npm run build`).'
          : '';
      throw new Error(
        `Sunucudan JSON yanıt alınamadı (HTTP ${res.status}).${backendHint}`,
      );
    }

    const data = await res.json();
    if (!res.ok) {
      const err = new Error(data.error || 'Bir hata oluştu');
      if (data.requireBusinessId) err.requireBusinessId = data.requireBusinessId;
      if (data.businesses) err.businesses = data.businesses;
      if (Array.isArray(data.blockers)) err.blockers = data.blockers;
      if (data.usage) err.usage = data.usage;
      throw err;
    }
    return data;
  }

  buildQuery(params) {
    const cleanParams = {};
    for (const [key, value] of Object.entries(params)) {
      if (value !== null && value !== undefined && value !== '') {
        cleanParams[key] = value;
      }
    }
    const qs = new URLSearchParams(cleanParams).toString();
    return qs ? `?${qs}` : '';
  }

  get(path) { return this.request(path); }
  post(path, body, isLogin = false) { return this.request(path, { method: 'POST', body: JSON.stringify(body) }, isLogin); }
  patch(path, body) { return this.request(path, { method: 'PATCH', body: JSON.stringify(body) }); }
  delete(path) { return this.request(path, { method: 'DELETE' }); }

  // Auth
  login(email, password, businessId) {
    const body = { email, password };
    if (businessId) body.business_id = businessId;
    return this.post('/auth/login', body, true);
  }
  me() { return this.get('/auth/me'); }

  // Tables
  getTables() { return this.get('/tables'); }
  updateTableStatus(id, data) { return this.patch(`/tables/${id}/status`, data); }
  transferTable(id, targetTableId) { return this.post(`/tables/${id}/transfer`, { targetTableId }); }

  // Products & Categories
  getCategories(params = {}) { return this.get(`/categories${this.buildQuery(params)}`); }
  postCategory(body) { return this.post('/categories', body); }
  patchCategory(id, body) { return this.patch(`/categories/${id}`, body); }
  deleteCategory(id) { return this.delete(`/categories/${id}`); }

  getProducts(params = {}) { return this.get(`/products${this.buildQuery(params)}`); }
  getProduct(id) { return this.get(`/products/${id}`); }
  postProduct(body) { return this.post('/products', body); }
  patchProduct(id, body) { return this.patch(`/products/${id}`, body); }
  deleteProduct(id) { return this.delete(`/products/${id}`); }
  getModifiers(productId) { return this.get(`/products/${productId}/modifiers`); }

  // Orders
  getOrders(params = {}) { return this.get(`/orders${this.buildQuery(params)}`); }
  getOrder(id) { return this.get(`/orders/${id}`); }
  getActiveOrders() { return this.get('/orders/active'); }
  createOrder(data) { return this.post('/orders', data); }
  addOrderItems(orderId, items) { return this.post(`/orders/${orderId}/items`, { items }); }
  updateOrderStatus(id, status) { return this.patch(`/orders/${id}/status`, { status }); }
  /** Açık salon siparişinde müşteri ata veya kaldır (customer_id: string | null) */
  patchOrderCustomer(orderId, customerId) {
    return this.patch(`/orders/${orderId}/customer`, { customer_id: customerId });
  }
  updateOrderItem(orderId, itemId, data) { return this.patch(`/orders/${orderId}/items/${itemId}`, data); }
  applyDiscount(orderId, data) { return this.patch(`/orders/${orderId}/discount`, data); }
  getTakeawayOpenOrders() { return this.get('/orders/takeaway/open'); }
  patchTakeawayDelivery(orderId, action) { return this.patch(`/orders/${orderId}/takeaway/delivery`, { action }); }

  // Payments
  createPayment(data) { return this.post('/payments', data); }
  getPaymentSummary(params = {}) { return this.get(`/payments/summary${this.buildQuery(params)}`); }

  // Customers
  getCustomers(params = {}) { return this.get(`/customers${this.buildQuery(params)}`); }
  getCustomersExport() { return this.get('/customers/export'); }
  getCustomer(id) { return this.get(`/customers/${id}`); }
  createCustomer(data) { return this.post('/customers', data); }
  updateCustomer(id, data) { return this.patch(`/customers/${id}`, data); }
  previewCustomerImport({ rows, preview_token, page = 1, page_size = 250 }) {
    return this.post('/customers/import/preview', { rows, preview_token, page, page_size });
  }
  commitCustomerImport(previewToken) { return this.post('/customers/import/commit', { preview_token: previewToken }); }

  // Caller ID (/api/callerid ve /api/caller-id aynı sunucu rotaları)
  simulateIncomingCall(phone) { return this.post('/caller-id/simulate', { phone }); }
  postCallerIdIncoming(body) { return this.post('/caller-id/incoming', body); }
  getCallHistory() { return this.get('/caller-id/history'); }
  getCallerIdRecent(limit = 40) {
    const q = limit ? `?limit=${limit}` : '';
    return this.get(`/caller-id/recent${q}`);
  }
  patchCallLogStatus(id, status) {
    return this.patch(`/caller-id/logs/${id}/status`, { status });
  }

  // Reports
  getDailyReport(date) { return this.get(`/reports/daily${date ? '?date=' + date : ''}`); }
  getClosedOrders(date) { return this.get(`/reports/closed-orders${date ? '?date=' + encodeURIComponent(date) : ''}`); }
  getRangeReport(from, to) { return this.get(`/reports/range?from=${from}&to=${to}`); }
  getHourlyReport(date) { return this.get(`/reports/hourly${date ? '?date=' + date : ''}`); }

  // Reservations
  getReservations(params = {}) {
    const q = new URLSearchParams(Object.entries(params).filter(([, v]) => v != null)).toString();
    return this.get(`/reservations${q ? '?' + q : ''}`);
  }
  createReservation(body) { return this.post('/reservations', body); }
  updateReservation(id, body) { return this.patch(`/reservations/${id}`, body); }
  deleteReservation(id) { return this.delete(`/reservations/${id}`); }

  // Stock
  getStockItems() { return this.get('/stock'); }
  createStockItem(body) { return this.post('/stock', body); }
  updateStockItem(id, body) { return this.patch(`/stock/${id}`, body); }
  deleteStockItem(id) { return this.delete(`/stock/${id}`); }
  getStockMovements(itemId) { return this.get(`/stock/${itemId}/movements`); }
  createStockMovement(body) { return this.post('/stock/movements', body); }

  // Print — legacy mock HTTP uçları; aktif POS akışı print_jobs + StoreBridge. Manuel test/debug için.
  /** @deprecated POS ekranları kullanmıyor; /api/print/receipt */
  printReceipt(orderId) { return this.post('/print/receipt', { order_id: orderId }); }
  /** @deprecated POS ekranları kullanmıyor; /api/print/kitchen */
  printKitchen(orderId) { return this.post('/print/kitchen', { order_id: orderId }); }

  // Admin / Ayarlar (admin rolü gerekir)
  getAdminBusiness() { return this.get('/admin/business'); }
  patchAdminBusiness(body) { return this.patch('/admin/business', body); }
  getDisplaySettings() { return this.get('/admin/display-settings'); }
  patchDisplaySettings(body) { return this.patch('/admin/display-settings', body); }
  getPrinterSettings() { return this.get('/admin/printer-settings'); }
  patchPrinterSettings(body) { return this.patch('/admin/printer-settings', body); }
  getDiscoveredPrinters() { return this.get('/admin/printers/discovered'); }
  refreshDiscoveredPrinters() { return this.post('/admin/printers/discovered/refresh', {}); }
  /** Bridge erişilebilirlik kontrolü. scanState: 'ok' | 'bridge_unreachable' | 'bridge_unconfigured' | ... */
  async getBridgeStatus() {
    try {
      const data = await this.get('/admin/printers/discovered');
      const s = data.scanState || '';
      if (s === 'bridge_unreachable' || s === 'auth_error') return 'down';
      if (s === 'bridge_unconfigured') return 'unconfigured';
      return 'ok';
    } catch {
      return 'down';
    }
  }
  getAdminPrinter(id) { return this.get(`/admin/printers/${encodeURIComponent(id)}`); }
  getAdminPrinterDeleteEligibility(id) {
    return this.get(`/admin/printers/${encodeURIComponent(id)}/delete-eligibility`);
  }
  deleteAdminPrinter(id) {
    return this.delete(`/admin/printers/${encodeURIComponent(id)}`);
  }
  postAdminPrinter(body) { return this.post('/admin/printers', body); }
  patchAdminPrinter(id, body) { return this.patch(`/admin/printers/${encodeURIComponent(id)}`, body); }
  postPrinterTest(body) { return this.post('/admin/printers/test', body); }
  getAdminPrintJobs(params = {}) { return this.get(`/admin/print-jobs${this.buildQuery(params)}`); }
  getAdminPrinterRouting() { return this.get('/admin/printer-routing'); }
  patchAdminPrinterRouting(body) { return this.patch('/admin/printer-routing', body); }
  getAdminRoles() { return this.get('/admin/roles'); }
  getAdminUsers() { return this.get('/admin/users'); }
  postAdminUser(body) { return this.post('/admin/users', body); }
  patchAdminUser(id, body) { return this.patch(`/admin/users/${id}`, body); }
  deleteAdminUser(id) { return this.delete(`/admin/users/${id}`); }

  getAdminDiningAreas() { return this.get('/admin/dining-areas'); }
  postAdminDiningArea(body) { return this.post('/admin/dining-areas', body); }
  patchAdminDiningArea(id, body) { return this.patch(`/admin/dining-areas/${id}`, body); }
  deleteAdminDiningArea(id) { return this.delete(`/admin/dining-areas/${id}`); }
  syncDiningAreaTables(areaId, targetTableCount) {
    return this.post(`/admin/dining-areas/${areaId}/sync-tables`, { target_table_count: targetTableCount });
  }
}

export const api = new ApiService();
export default api;
