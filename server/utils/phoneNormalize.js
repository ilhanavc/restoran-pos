/**
 * Türkiye cep telefonları için kanonik format: yalnızca rakam, 12 hane, 90 ile başlar.
 * Örnek: 905321112233
 */

/**
 * @param {string|null|undefined} input
 * @returns {string} Kanonik numara veya eşleşme yoksa boş string
 */
export function normalizePhoneDigits(input) {
  if (input == null || input === '') return '';
  const d = String(input).replace(/\D/g, '');
  if (d.length === 0) return '';

  // 12+ hane ve 90 ile başlıyorsa ilk 12 haneyi al
  if (d.length >= 12 && d.startsWith('90')) {
    return d.slice(0, 12);
  }

  // 11 hane, 0 ile başlayan (örn. 05321112233)
  if (d.length === 11 && d.startsWith('0')) {
    return '90' + d.slice(1);
  }

  // 10 hane, 5 ile başlayan (örn. 5321112233)
  if (d.length === 10 && d.startsWith('5')) {
    return '90' + d;
  }

  // 13 hane 905... gibi fazla rakam
  if (d.length === 13 && d.startsWith('90')) {
    return d.slice(0, 12);
  }

  // Diğer: mümkünse 90 önekli 12 haneye çevir
  if (d.startsWith('90') && d.length === 12) {
    return d;
  }

  return d;
}
