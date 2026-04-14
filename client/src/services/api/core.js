// Her zaman göreli /api — Vite dev/preview proxy'si 3001'e yönlendirir.
// Doğrudan localhost:3001 kullanmak HTML/502 yanıtlarına ve "geçersiz yanıt" hatasına yol açabiliyordu.
export const API_BASE = '/api';
const DEFAULT_REQUEST_TIMEOUT_MS = 15000;

export class ApiHttpClient {
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
    if (this.token) headers.Authorization = `Bearer ${this.token}`;
    const controller = new AbortController();
    const timeoutMs = Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : DEFAULT_REQUEST_TIMEOUT_MS;
    const timeoutId = window.setTimeout(() => controller.abort('timeout'), timeoutMs);

    let res;
    try {
      res = await fetch(`${API_BASE}${path}`, {
        ...options,
        headers: { ...headers, ...options.headers },
        signal: options.signal || controller.signal,
      });
    } catch (err) {
      if (err?.name === 'AbortError') {
        throw new Error('İstek zaman aşımına uğradı. Lütfen tekrar deneyin.');
      }
      throw new Error('Sunucuya bağlanılamadı. Backend çalışıyor mu?');
    } finally {
      window.clearTimeout(timeoutId);
    }

    // Login dışındaki 401'lerde oturumu sıfırla.
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
      throw new Error(`Sunucudan JSON yanıt alınamadı (HTTP ${res.status}).${backendHint}`);
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
}
