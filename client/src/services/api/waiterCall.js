export const waiterCallMixin = {
  getWaiterCallSetup() { return this.get('/waiter-call/setup'); },
  getWaiterCallPending() { return this.get('/waiter-call/pending'); },
  resolveWaiterCall(id) { return this.patch(`/waiter-call/${id}/resolve`, {}); },
};
