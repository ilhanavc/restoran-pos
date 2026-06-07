/**
 * Müşteri telefon numaraları için kanonik saklama formatı.
 *
 * Cep telefonu tespit edilirse → "0XXXXXXXXXX" (11 hane, sıfır önekli).
 *   Kabul edilen girdiler: +90 5xx..., 90 5xx..., 0 5xx..., 5xx... (10 hane).
 *
 * Sabit hat / kısa numara / tanımsız format → rakamlar aynen saklanır (reddedilmez).
 *   Örn. "5287717" (7 hane sabit hat) olduğu gibi döner.
 *
 * Boş / rakam içermeyen girdi → "".
 *
 * @param {string|null|undefined} input
 * @returns {string}
 */
export function normalizePhoneDigits(input) {
  if (input == null || input === '') return '';
  const d = String(input).replace(/\D/g, '');
  if (d.length === 0) return '';

  // +90 5xx... veya 90 5xx... (12 haneli Türkiye cep)
  if (d.length === 12 && d.startsWith('905')) {
    return '0' + d.slice(2);
  }
  // Fazla haneli 90... (örn. 13 haneli hatalı kopya)
  if (d.length > 12 && d.startsWith('90')) {
    const stripped = d.slice(2, 12);
    if (stripped.startsWith('5') && stripped.length === 10) return '0' + stripped;
  }
  // 0 5xx... (11 haneli yerli cep formatı)
  if (d.length === 11 && d.startsWith('05')) {
    return d;
  }
  // 5xx... (10 haneli, önek yok)
  if (d.length === 10 && d.startsWith('5')) {
    return '0' + d;
  }

  // Sabit hat / kısa / yabancı → rakamlar aynen saklanır
  return d;
}

/**
 * Türkiye cep numarası mı? (dedup / arama yardımcıları için)
 * @param {string|null|undefined} input
 */
export function isTurkishMobile(input) {
  const normalized = normalizePhoneDigits(input);
  return /^05\d{9}$/.test(normalized);
}
