import dotenv from 'dotenv';
dotenv.config();

const nodeEnv = process.env.NODE_ENV || 'development';
const jwtSecret = process.env.JWT_SECRET || 'fallback-secret-change-me';

if (nodeEnv === 'production' && (!process.env.JWT_SECRET || jwtSecret === 'fallback-secret-change-me')) {
  throw new Error('Üretim ortamında JWT_SECRET ortam değişkeni zorunludur ve varsayılan gizli anahtar kullanılamaz.');
}

export default {
  port: parseInt(process.env.PORT || '3001'),
  nodeEnv,
  jwt: {
    secret: jwtSecret,
    expiresIn: process.env.JWT_EXPIRES_IN || '24h',
  },
  db: {
    path: process.env.DB_PATH || './data/pos.db',
  },
  defaultBusinessName: process.env.DEFAULT_BUSINESS_NAME || 'Demo Restoran',

  /** Yerel StoreBridge: X-Bridge-Token ile eşleşmeli; BRIDGE_BUSINESS_ID hedef işletme. */
  bridge: {
    token: process.env.BRIDGE_TOKEN || '',
    businessId: process.env.BRIDGE_BUSINESS_ID || '',
  },

  /** true ise processPendingJobsSync sunucu içi mock yazdırmayı yapmaz (StoreBridge kullanılır). */
  disablePrintJobMock:
    process.env.DISABLE_PRINT_JOB_MOCK === '1' || process.env.DISABLE_PRINT_JOB_MOCK === 'true',
};
