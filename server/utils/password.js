/**
 * Şifre politikası — yalnızca YENİ şifre oluşturulurken veya değiştirilirken çağrılır.
 * Login sırasında çağrılmaz (mevcut DB'deki weak hash'ler için geriye dönük uyumluluk).
 *
 * Kurallar (FAZ 0 — Görev 0.5):
 *   - En az 8 karakter
 *   - En az bir büyük harf
 *   - En az bir rakam
 *
 * @param {unknown} pw
 * @returns {string | null}  Hata mesajı (Türkçe) veya null (geçerli).
 */
export function validatePassword(pw) {
  if (pw === undefined || pw === null) return 'Şifre gerekli';
  if (typeof pw !== 'string') return 'Şifre metin olmalı';
  if (pw.length < 8) return 'Şifre en az 8 karakter olmalı';
  if (pw.length > 128) return 'Şifre en fazla 128 karakter olabilir';
  if (!/[A-Z]/.test(pw)) return 'Şifre en az bir büyük harf içermeli';
  if (!/[0-9]/.test(pw)) return 'Şifre en az bir rakam içermeli';
  return null;
}

/**
 * `validatePassword` doğru/yanlış sonucunu boolean olarak ister.
 * @param {unknown} pw
 * @returns {boolean}
 */
export function isValidPassword(pw) {
  return validatePassword(pw) === null;
}
