export const dashboardMixin = {
  getDashboardLive() { return this.get('/dashboard/live'); },
  getDashboardCompare() { return this.get('/dashboard/compare'); },
  getDashboardAlerts() { return this.get('/dashboard/alerts'); },
  getDashboardRecentOrders(limit = 10) { return this.get(`/dashboard/recent-orders?limit=${limit}`); },
};
