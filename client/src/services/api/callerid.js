export const calleridMixin = {
  simulateIncomingCall(phone) { return this.post('/caller-id/simulate', { phone }); },
  postCallerIdIncoming(body) { return this.post('/caller-id/incoming', body); },
  getCallHistory() { return this.get('/caller-id/history'); },
  getCallerIdRecent(limit = 40) {
    const q = limit ? `?limit=${limit}` : '';
    return this.get(`/caller-id/recent${q}`);
  },
  patchCallLogStatus(id, status) {
    return this.patch(`/caller-id/logs/${id}/status`, { status });
  },
};
