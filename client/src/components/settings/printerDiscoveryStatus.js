function normalizeScanState(scanState, lastErrorCode) {
  const state = String(scanState || '').trim();
  if (state === 'bridge_unconfigured') return state;
  if (state === 'bridge_unreachable' && String(lastErrorCode || '') === 'bridge_not_configured') {
    return 'bridge_unconfigured';
  }
  return state || 'never_scanned';
}

export function getDiscoveryUiMeta({
  scanState,
  lastErrorCode,
  printers = [],
  hasSelectedPhysical = false,
} = {}) {
  const normalized = normalizeScanState(scanState, lastErrorCode);
  const printerCount = Array.isArray(printers) ? printers.length : 0;
  const keepProfileDetail = hasSelectedPhysical
    ? 'Kayıtlı yazıcı profili korunur, canlı tarama yeniden denendiğinde doğrulama güncellenir.'
    : '';

  if (normalized === 'bridge_unconfigured') {
    return {
      state: normalized,
      tone: 'warning',
      text: 'StoreBridge aktif değil ya da yapılandırılmamış.',
      detail: keepProfileDetail,
    };
  }

  if (normalized === 'bridge_unreachable' || normalized === 'auth_error') {
    return {
      state: normalized,
      tone: 'danger',
      text: 'Bu bilgisayarda yazıcı tarama servisine ulaşılamadı.',
      detail: keepProfileDetail,
    };
  }

  if (normalized === 'empty') {
    return {
      state: normalized,
      tone: 'info',
      text: 'Bağlı yazıcı bulunamadı.',
      detail: keepProfileDetail,
    };
  }

  if (normalized === 'scanning') {
    return {
      state: normalized,
      tone: 'info',
      text: 'Windows yazıcıları taranıyor…',
      detail: '',
    };
  }

  if (normalized === 'success' && printerCount > 0) {
    return {
      state: normalized,
      tone: 'success',
      text: 'Yazıcı taraması tamamlandı.',
      detail: '',
    };
  }

  return {
    state: 'never_scanned',
    tone: 'info',
    text: 'Henüz yazıcı taraması yapılmadı.',
    detail: keepProfileDetail,
  };
}

export function toneColor(tone) {
  if (tone === 'success') return 'var(--success, #16a34a)';
  if (tone === 'warning') return 'var(--warning, #d97706)';
  if (tone === 'danger') return 'var(--danger, #dc2626)';
  return 'var(--text-muted)';
}
