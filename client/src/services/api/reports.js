export const reportsMixin = {
  getDailyReport(date) { return this.get(`/reports/daily${date ? '?date=' + date : ''}`); },
  getClosedOrders(params = {}) { return this.get(`/reports/closed-orders${this.buildQuery(params)}`); },
  exportClosedOrders(params = {}) { return this.get(`/reports/closed-orders/export${this.buildQuery(params)}`); },
  getRangeReport(from, to) { return this.get(`/reports/range?from=${from}&to=${to}`); },
  getHourlyReport(date) { return this.get(`/reports/hourly${date ? '?date=' + date : ''}`); },
  getAnalyticsReport(params = {}) { return this.get(`/reports/analytics${this.buildQuery(params)}`); },
  getPeriodCloseStatus(date) { return this.get(`/period-close/status${this.buildQuery(date ? { date } : {})}`); },
  getPeriodXReport(date) { return this.get(`/period-close/x-report${this.buildQuery(date ? { date } : {})}`); },
  closePeriodZ(payload) { return this.post('/period-close/z-close', payload); },
};
