/**
 * CID 812 ve benzeri cihazlar için yer tutucu.
 * Gelecekte: seri/USB/SDK ile numara okunur → POST ${API_BASE}/callerid/incoming
 * (Authorization: Bearer kullanıcı JWT veya ayrı cihaz token’ı — henüz tanımlı değil).
 */
export class Cid812Provider {
  constructor(_options = {}) {
    this._started = false;
  }

  /** İleride: port dinleme / SDK callback */
  start() {
    this._started = true;
    console.log('[Cid812Provider] placeholder — gerçek entegrasyon yok');
  }

  stop() {
    this._started = false;
  }

  get started() {
    return this._started;
  }
}
