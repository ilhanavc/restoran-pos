export const adminMixin = {
  // Print (legacy debug endpoints)
  /** @deprecated POS ekranları kullanmıyor; /api/print/receipt */
  printReceipt(orderId, options = {}) {
    return this.post('/print/receipt', { order_id: orderId, ...(options?.printer_id ? { printer_id: options.printer_id } : {}) });
  },
  /** @deprecated POS ekranları kullanmıyor; /api/print/kitchen */
  printKitchen(orderId) { return this.post('/print/kitchen', { order_id: orderId }); },

  // Admin / Ayarlar
  getAdminBusiness() { return this.get('/admin/business'); },
  patchAdminBusiness(body) { return this.patch('/admin/business', body); },
  getDesktopReadiness() { return this.get('/admin/desktop-readiness'); },
  completeDesktopReadiness() { return this.post('/admin/desktop-readiness/complete', {}); },
  getAdminStoreBridgeHealth() { return this.get('/admin/storebridge/health'); },
  getAdminStoreBridgeLogs(params = {}) { return this.get(`/admin/storebridge/logs${this.buildQuery(params)}`); },
  getSupportBundle() { return this.get('/admin/support-bundle'); },
  getMaintenanceStatus() { return this.get('/admin/maintenance'); },
  getOpenOrderCount() { return this.get('/admin/maintenance/open-orders'); },
  createManualBackup() { return this.post('/admin/maintenance/backups', {}); },
  requestRestore(backupId) { return this.post('/admin/maintenance/restore-request', { backup_id: backupId }); },
  cancelRestoreRequest() { return this.delete('/admin/maintenance/restore-request'); },
  getDisplaySettings() { return this.get('/admin/display-settings'); },
  patchDisplaySettings(body) { return this.patch('/admin/display-settings', body); },
  getPrinterSettings() { return this.get('/admin/printer-settings'); },
  patchPrinterSettings(body) { return this.patch('/admin/printer-settings', body); },
  getDiscoveredPrinters() { return this.get('/admin/printers/discovered'); },
  refreshDiscoveredPrinters() { return this.post('/admin/printers/discovered/refresh', {}); },
  async getBridgeStatus() {
    try {
      const data = await this.getAdminStoreBridgeHealth();
      if (data?.status === 'unconfigured') return 'unconfigured';
      if (data?.status === 'down') return 'down';
      if (data?.status === 'degraded') return 'degraded';
      return 'ok';
    } catch (err) {
      if (err?.status === 401 || err?.status === 403) return null;
      return 'down';
    }
  },
  getAdminPrinter(id) { return this.get(`/admin/printers/${encodeURIComponent(id)}`); },
  getAdminPrinterDeleteEligibility(id) {
    return this.get(`/admin/printers/${encodeURIComponent(id)}/delete-eligibility`);
  },
  deleteAdminPrinter(id) { return this.delete(`/admin/printers/${encodeURIComponent(id)}`); },
  postAdminPrinter(body) { return this.post('/admin/printers', body); },
  patchAdminPrinter(id, body) { return this.patch(`/admin/printers/${encodeURIComponent(id)}`, body); },
  postPrinterTest(body) { return this.post('/admin/printers/test', body); },
  postAdminPrinterPreview(body) { return this.post('/admin/printers/preview', body); },
  getAdminPrintJobs(params = {}) { return this.get(`/admin/print-jobs${this.buildQuery(params)}`); },
  getAdminPrinterRouting() { return this.get('/admin/printer-routing'); },
  patchAdminPrinterRouting(body) { return this.patch('/admin/printer-routing', body); },
  getAdminRoles() { return this.get('/admin/roles'); },
  getAdminUsers() { return this.get('/admin/users'); },
  postAdminUser(body) { return this.post('/admin/users', body); },
  patchAdminUser(id, body) { return this.patch(`/admin/users/${id}`, body); },
  deleteAdminUser(id) { return this.delete(`/admin/users/${id}`); },
  getAdminDiningAreas() { return this.get('/admin/dining-areas'); },
  postAdminDiningArea(body) { return this.post('/admin/dining-areas', body); },
  patchAdminDiningArea(id, body) { return this.patch(`/admin/dining-areas/${id}`, body); },
  deleteAdminDiningArea(id) { return this.delete(`/admin/dining-areas/${id}`); },
  syncDiningAreaTables(areaId, targetTableCount) {
    return this.post(`/admin/dining-areas/${areaId}/sync-tables`, { target_table_count: targetTableCount });
  },

  // Özellik Grupları (Attributes)
  getAttributeGroups() { return this.get('/attributes/groups'); },
  createAttributeGroup(body) { return this.post('/attributes/groups', body); },
  updateAttributeGroup(id, body) { return this.patch(`/attributes/groups/${id}`, body); },
  deleteAttributeGroup(id) { return this.delete(`/attributes/groups/${id}`); },
  getAttributeOptions(groupId) { return this.get(`/attributes/groups/${groupId}/options`); },
  createAttributeOption(groupId, body) { return this.post(`/attributes/groups/${groupId}/options`, body); },
  updateAttributeOption(optionId, body) { return this.patch(`/attributes/options/${optionId}`, body); },
  deleteAttributeOption(optionId) { return this.delete(`/attributes/options/${optionId}`); },
  getEffectiveAttributes(productId) { return this.get(`/attributes/effective/${productId}`); },
  getCategoryAttributeGroups(categoryId) { return this.get(`/attributes/category/${categoryId}`); },
  assignAttributeToCategory(categoryId, groupId) {
    return this.post(`/attributes/category/${categoryId}/assign`, { group_id: groupId });
  },
  removeAttributeFromCategory(categoryId, groupId) {
    return this.delete(`/attributes/category/${categoryId}/${groupId}`);
  },
  getProductAttributeGroups(productId) { return this.get(`/attributes/product/${productId}`); },
  assignAttributeToProduct(productId, groupId) {
    return this.post(`/attributes/product/${productId}/assign`, { group_id: groupId });
  },
  removeAttributeFromProduct(productId, groupId) {
    return this.delete(`/attributes/product/${productId}/${groupId}`);
  },
  getEntityMutations({ limit = 50, offset = 0, entity_table, action, actor_user_id } = {}) {
    const params = new URLSearchParams({ limit, offset });
    if (entity_table) params.set('entity_table', entity_table);
    if (action) params.set('action', action);
    if (actor_user_id) params.set('actor_user_id', actor_user_id);
    return this.get(`/admin/entity-mutations?${params}`);
  },
};
