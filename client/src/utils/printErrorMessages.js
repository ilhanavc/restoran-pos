/**
 * printErrorMessages.js
 * Teknik print/bridge hata kodlarını operatör düzeyinde Türkçe aksiyon mesajlarına
 * çevirir. Mesajlar "ne yapmalıyım?" sorusuna cevap verecek şekilde yazılmıştır.
 */

/** @type {Record<string, { label: string; action: string }>} */
const PRINT_ERROR_MESSAGES = {
  // StoreBridge / bağlantı
  bridge_unreachable: {
    label: 'StoreBridge bağlanamıyor',
    action: 'Store Bridge servisinin çalıştığını doğrulayın (başlat-all.bat). Sonra "Tekrar Dene" butonuna basın.',
  },
  auth_error: {
    label: 'Bridge kimlik doğrulama hatası',
    action: 'Ayarlar › İşletme bilgileri altındaki Bridge Token ve Business ID değerlerini kontrol edin.',
  },
  api_error: {
    label: 'Bridge API hatası',
    action: 'StoreBridge servisini yeniden başlatın. Sorun devam ederse Electron logunu inceleyin.',
  },
  api_timeout: {
    label: 'Bridge API yanıt vermedi',
    action: 'StoreBridge servisini yeniden başlatın. Ağ ve güvenlik duvarı ayarlarını kontrol edin.',
  },

  // Yazıcı yapılandırma
  printer_missing: {
    label: 'Yazıcı bulunamadı',
    action: 'Ayarlar › Yazıcı Ayarları içinde yazıcının tanımlı ve aktif olduğunu kontrol edin.',
  },
  printer_inactive: {
    label: 'Yazıcı pasif',
    action: 'Ayarlar › Yazıcı Ayarları içinde yazıcıyı aktif hale getirin.',
  },
  printer_config_missing: {
    label: 'Yazıcı ayarı eksik',
    action: 'Ayarlar › Yazıcı Ayarları içinde yazıcının IP adresini veya adını eksiksiz doldurun.',
  },
  unsupported_connection: {
    label: 'Desteklenmeyen bağlantı türü',
    action: 'Ayarlar › Yazıcı Ayarları içinde bağlantı türünü ağ (TCP/IP) veya USB olarak seçin.',
  },
  printer_role_mismatch: {
    label: 'Yanlış yazıcı rolü',
    action: 'Seçilen yazıcı bu iş için uygun değil. Yazıcı Yönlendirme ayarlarını kontrol edin.',
  },

  // Ağ / USB iletişim
  network_timeout: {
    label: 'Yazıcıya ağ bağlantısı zaman aşımına uğradı',
    action: 'Yazıcının açık ve ağa bağlı olduğunu doğrulayın. IP adresini ping ile test edin.',
  },
  usb_print_failed: {
    label: 'USB yazdırma başarısız',
    action: 'USB kablosunun bağlı ve yazıcının açık olduğunu kontrol edin. Windows Aygıt Yöneticisi\'nde yazıcı sürücüsünü doğrulayın.',
  },

  // Render / içerik
  render_failed: {
    label: 'Fiş oluşturulamadı',
    action: 'Sipariş verisini kontrol edin. Sorun tekrarlanırsa destek paketi indirip teknik destek alın.',
  },

  // Lease / claim
  lease_expired: {
    label: 'İş süresi doldu (takılı iş)',
    action: '"Tekrar Dene" butonuna basın. StoreBridge servisini yeniden başlatmak da gerekebilir.',
  },
  claim_mismatch: {
    label: 'İş başka bridge tarafından alındı',
    action: 'Birden fazla StoreBridge çalışıyorsa yalnızca birini aktif bırakın.',
  },

  // Genel
  unknown_error: {
    label: 'Bilinmeyen yazdırma hatası',
    action: 'Destek Paketi indirip teknik destek alın. StoreBridge loglarını kontrol edin.',
  },
};

/**
 * Hata koduna karşılık gelen Türkçe etiket ve aksiyon metnini döner.
 * Tanımsız kod için fallback döner.
 * @param {string | null | undefined} errorCode
 * @returns {{ label: string; action: string }}
 */
export function getPrintErrorMessage(errorCode) {
  if (errorCode && PRINT_ERROR_MESSAGES[errorCode]) {
    return PRINT_ERROR_MESSAGES[errorCode];
  }
  return {
    label: errorCode ? `Hata: ${errorCode}` : 'Yazdırma tamamlanamadı',
    action: 'StoreBridge Durumu sayfasını kontrol edin veya Destek Paketi indirin.',
  };
}

/**
 * Hata kodu için kısa operatör etiketi döner.
 * @param {string | null | undefined} errorCode
 * @returns {string}
 */
export function getPrintErrorLabel(errorCode) {
  return getPrintErrorMessage(errorCode).label;
}

/**
 * Hata kodu için aksiyon talimatı döner.
 * @param {string | null | undefined} errorCode
 * @returns {string}
 */
export function getPrintErrorAction(errorCode) {
  return getPrintErrorMessage(errorCode).action;
}
