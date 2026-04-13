const DISPLAY_SETTINGS_STORAGE_KEY = 'pos_display_settings';
const DEFAULT_DISPLAY_SETTINGS = { theme: 'dark', language: 'tr', density: 'comfortable' };

function sanitizeDisplaySettings(display) {
  const next = { ...DEFAULT_DISPLAY_SETTINGS, ...(display || {}) };
  next.theme = next.theme === 'light' ? 'light' : 'dark';
  next.language = next.language === 'en' ? 'en' : 'tr';
  next.density = next.density === 'compact' ? 'compact' : 'comfortable';
  return next;
}

export function loadStoredDisplaySettings() {
  if (typeof localStorage === 'undefined') return { ...DEFAULT_DISPLAY_SETTINGS };
  try {
    const raw = localStorage.getItem(DISPLAY_SETTINGS_STORAGE_KEY);
    if (!raw) return { ...DEFAULT_DISPLAY_SETTINGS };
    return sanitizeDisplaySettings(JSON.parse(raw));
  } catch {
    return { ...DEFAULT_DISPLAY_SETTINGS };
  }
}

export function persistDisplaySettings(display) {
  if (typeof localStorage === 'undefined') return;
  try {
    localStorage.setItem(DISPLAY_SETTINGS_STORAGE_KEY, JSON.stringify(sanitizeDisplaySettings(display)));
  } catch {
    // ignore storage errors; DOM application still proceeds
  }
}

/** Sunucudan gelen ekran ayarlarını DOM'a uygular (yoğunluk, tema, lang). */
export function applyDisplaySettings(display) {
  if (typeof document === 'undefined') return;
  const next = sanitizeDisplaySettings(display);
  const root = document.documentElement;
  root.dataset.theme = next.theme;
  root.dataset.density = next.density;
  root.lang = next.language;
  persistDisplaySettings(next);
}
