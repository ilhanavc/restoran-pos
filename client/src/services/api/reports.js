export const reportsMixin = {
  getDailyReport(date) { return this.get(`/reports/daily${date ? '?date=' + date : ''}`); },
  getClosedOrders(params = {}) { return this.get(`/reports/closed-orders${this.buildQuery(params)}`); },
  exportClosedOrders(params = {}) { return this.get(`/reports/closed-orders/export${this.buildQuery(params)}`); },
  getRangeReport(from, to) { return this.get(`/reports/range?from=${from}&to=${to}`); },
  getHourlyReport(date) { return this.get(`/reports/hourly${date ? '?date=' + date : ''}`); },
  getAnalyticsReport(params = {}) { return this.get(`/reports/analytics${this.buildQuery(params)}`); },
};
