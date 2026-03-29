/**
 * CID 812 veya benzeri donanım için gelecekteki entegrasyon noktası.
 * Gerçek SDK / seri port bağlantısı yok — sadece arayüz.
 */
export class Cid812Provider {
  /** @type {((payload: { rawPhone: string; raw?: string }) => void) | null} */
  #callback = null;

  // eslint-disable-next-line class-methods-use-this
  start() {
    // TODO: Üretici SDK / COM port / USB dinleyicisi burada başlatılacak.
    // Şimdilik no-op.
  }

  // eslint-disable-next-line class-methods-use-this
  stop() {
    // TODO: Donanım bağlantısını kapat.
  }

  /**
   * @param {(payload: { rawPhone: string; raw?: string }) => void} cb
   */
  onIncomingCall(cb) {
    this.#callback = cb;
  }
}
