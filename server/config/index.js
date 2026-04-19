import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';

const configDir = path.dirname(fileURLToPath(import.meta.url));
/** `server/` — çalışma dizininden bağımsız */
const serverRoot = path.join(configDir, '..');

dotenv.config({ path: path.join(serverRoot, '.env') });

function resolveUserDataPath() {
  const raw = process.env.USER_DATA_PATH;
  if (!raw) {
    return path.join(serverRoot, 'data');
  }
  if (path.isAbsolute(raw)) {
    return raw;
  }
  return path.resolve(serverRoot, raw);
}

function resolveDbPath() {
  const raw = process.env.DB_PATH;
  if (!raw) {
    return path.join(resolveUserDataPath(), 'pos.db');
  }
  if (path.isAbsolute(raw)) {
    return raw;
  }
  return path.resolve(serverRoot, raw);
}

const nodeEnv = process.env.NODE_ENV || 'development';
const jwtSecret = process.env.JWT_SECRET || 'fallback-secret-change-me';

if (nodeEnv === 'production' && (!process.env.JWT_SECRET || jwtSecret === 'fallback-secret-change-me')) {
  throw new Error('Üretim ortamında JWT_SECRET ortam değişkeni zorunludur ve varsayılan gizli anahtar kullanılamaz.');
}

if (nodeEnv === 'production' && process.env.JWT_SECRET && process.env.JWT_SECRET.length < 32) {
  throw new Error('Üretim ortamında JWT_SECRET en az 32 karakter olmalıdır (zayıf anahtar reddedildi).');
}

/**
 * Express 'trust proxy' hop sayısı. 0 = doğrudan; 1 = tek reverse proxy (örn. Nginx);
 * 2 = zincirli proxy (örn. Cloudflare → Nginx). Rate-limit ve req.ip güvenilirliği buna
 * bağlı. Sayıya çevrilemeyen değerler 0'a düşer (güvenli default).
 */
const trustProxyHopsRaw = process.env.TRUST_PROXY_HOPS;
const trustProxyHopsParsed = Number.parseInt(trustProxyHopsRaw ?? '', 10);
const trustProxyHops = Number.isFinite(trustProxyHopsParsed) && trustProxyHopsParsed >= 0
  ? trustProxyHopsParsed
  : 0;

/** Vite client build (`npm run build` kökte veya client içinde) */
const clientDist = process.env.CLIENT_DIST_PATH
  ? path.resolve(process.env.CLIENT_DIST_PATH)
  : path.join(serverRoot, '..', 'client', 'dist');

export default {
  /** Sunucu kodunun kökü; migrations/seeds ile cwd uyumu için dışa açık */
  serverRoot,
  clientDist,
  port: parseInt(process.env.PORT || '3001'),
  host: process.env.HOST || '127.0.0.1',
  nodeEnv,
  trustProxyHops,
  get userDataPath() {
    return resolveUserDataPath();
  },
  jwt: {
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },
  db: {
    path: resolveDbPath(),
  },
  defaultBusinessName: process.env.DEFAULT_BUSINESS_NAME || 'Demo Restoran',

  /** Yerel StoreBridge: X-Bridge-Token ile eşleşmeli; BRIDGE_BUSINESS_ID hedef işletme. */
  bridge: {
    token: process.env.BRIDGE_TOKEN || '',
    businessId: process.env.BRIDGE_BUSINESS_ID || '',
  },
  storeTimezone: process.env.STORE_TIMEZONE || 'Europe/Istanbul',

  /** true ise processPendingJobsSync sunucu içi mock yazdırmayı yapmaz (StoreBridge kullanılır).
   *  Varsayılan: true (mock KAPALI, gerçek yazdırma AÇIK).
   *  Geliştirme ortamında mock açmak için DISABLE_PRINT_JOB_MOCK=false veya =0 set et. */
  disablePrintJobMock:
    process.env.DISABLE_PRINT_JOB_MOCK !== '0' && process.env.DISABLE_PRINT_JOB_MOCK !== 'false',
};
