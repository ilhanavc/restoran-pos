import { API_BASE } from './core.js';

export const productsMixin = {
  getCategories(params = {}) { return this.get(`/categories${this.buildQuery(params)}`); },
  postCategory(body) { return this.post('/categories', body); },
  patchCategory(id, body) { return this.patch(`/categories/${id}`, body); },
  deleteCategory(id) { return this.delete(`/categories/${id}`); },

  getProducts(params = {}) { return this.get(`/products${this.buildQuery(params)}`); },
  getProduct(id) { return this.get(`/products/${id}`); },
  postProduct(body) { return this.post('/products', body); },
  patchProduct(id, body) { return this.patch(`/products/${id}`, body); },
  deleteProduct(id) { return this.delete(`/products/${id}`); },
  getModifiers(productId) { return this.get(`/products/${productId}/modifiers`); },

  async uploadProductImage(productId, file) {
    const fd = new FormData();
    fd.append('image', file);
    const headers = {};
    if (this.token) headers['Authorization'] = `Bearer ${this.token}`;
    const controller = new AbortController();
    const timeoutId = window.setTimeout(() => controller.abort('timeout'), 20000);
    try {
      const res = await fetch(`${API_BASE}/products/${productId}/image`, {
        method: 'POST', headers, body: fd, signal: controller.signal,
      });
      if (res.status === 401) { this.setToken(null); window.location.reload(); throw new Error('Oturum süresi doldu'); }
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error || 'Görsel yükleme başarısız');
      return data;
    } catch (err) {
      if (err?.name === 'AbortError') throw new Error('Görsel yükleme zaman aşımına uğradı. Lütfen tekrar deneyin.');
      throw err;
    } finally {
      window.clearTimeout(timeoutId);
    }
  },
  deleteProductImage(id) { return this.delete(`/products/${id}/image`); },
  getProductCombos(id) { return this.get(`/products/${id}/combos`); },
  addProductCombo(id, body) { return this.post(`/products/${id}/combos`, body); },
  removeProductCombo(id, comboId) { return this.delete(`/products/${id}/combos/${comboId}`); },
};
