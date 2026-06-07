export const stockMixin = {
  getStockItems() { return this.get('/stock'); },
  createStockItem(body) { return this.post('/stock', body); },
  updateStockItem(id, body) { return this.patch(`/stock/${id}`, body); },
  deleteStockItem(id) { return this.delete(`/stock/${id}`); },
  getStockMovements(itemId) { return this.get(`/stock/${itemId}/movements`); },
  createStockMovement(body) { return this.post('/stock/movements', body); },
};
