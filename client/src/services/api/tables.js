export const tablesMixin = {
  getTables() { return this.get('/tables'); },
  updateTableStatus(id, data) { return this.patch(`/tables/${id}/status`, data); },
  transferTable(id, targetTableId) { return this.post(`/tables/${id}/transfer`, { targetTableId }); },
};
