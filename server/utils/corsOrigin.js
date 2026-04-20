/**
 * CORS origin doğrulama — Express (cors paketi) ve Socket.io için ortak mantık.
 *
 * Production:
 *   - Yalnızca `config.corsOrigins` içindeki explicit origin'ler kabul edilir.
 *   - Boş whitelist → tüm cross-origin istekler reddedilir (yalnızca same-origin geçer).
 *
 * Development:
 *   - Whitelist + localhost / 127.0.0.1 / 192.168.x.x / 10.x.x.x (herhangi port) regex'leri.
 *
 * Hem prod hem dev'de "no origin" (mobile app, curl, same-origin) istekleri geçer —
 * çünkü Origin header'ı yalnızca tarayıcılar cross-origin isteklerde ekler.
 */

const DEV_ORIGIN_PATTERNS = [
  /^http:\/\/localhost(:\d+)?$/,
  /^http:\/\/127\.0\.0\.1(:\d+)?$/,
  /^http:\/\/192\.168\.\d{1,3}\.\d{1,3}(:\d+)?$/,
  /^http:\/\/10\.\d{1,3}\.\d{1,3}\.\d{1,3}(:\d+)?$/,
];

/**
 * Verilen origin listesi + mod için bir isAllowed(origin) fonksiyonu döndürür.
 * @param {{ origins: string[], isProduction: boolean }} opts
 * @returns {(origin: string | undefined | null) => boolean}
 */
export function buildCorsOriginChecker({ origins, isProduction }) {
  const whitelist = new Set(origins || []);
  return function isAllowed(origin) {
    if (!origin) return true; // mobile app, curl, same-origin
    if (whitelist.has(origin)) return true;
    if (!isProduction) {
      return DEV_ORIGIN_PATTERNS.some((re) => re.test(origin));
    }
    return false;
  };
}

/**
 * Express `cors` paketine verilecek origin callback fabrikası.
 * Reddedilen origin için `CORS: origin not allowed` hatası fırlatır (403).
 */
export function buildCorsOriginCallback(opts) {
  const isAllowed = buildCorsOriginChecker(opts);
  return function originCallback(origin, cb) {
    if (isAllowed(origin)) return cb(null, true);
    return cb(new Error('CORS: origin not allowed'), false);
  };
}
