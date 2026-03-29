/** Sunucudan gelen ekran ayarlarını DOM'a uygular (yoğunluk, tema, lang). */
export function applyDisplaySettings(display) {
  if (!display || typeof document === 'undefined') return;
  const root = document.documentElement;
  root.dataset.theme = display.theme || 'dark';
  root.dataset.density = display.density || 'comfortable';
  root.lang = display.language === 'en' ? 'en' : 'tr';
}
