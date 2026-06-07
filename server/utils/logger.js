import pino from 'pino';
import config from '../config/index.js';

// Log level: test ortamında sessiz, aksi halde LOG_LEVEL env veya 'info'
const level = config.nodeEnv === 'test'
  ? 'silent'
  : (process.env.LOG_LEVEL || 'info');

// Dev ortamında okunabilir (pino-pretty); prod/electron'da NDJSON
const isDev = config.nodeEnv !== 'production' && config.nodeEnv !== 'test';

const transport = isDev
  ? {
      target: 'pino-pretty',
      options: {
        colorize: true,
        translateTime: 'SYS:HH:MM:ss.l',
        ignore: 'pid,hostname',
        singleLine: false,
      },
    }
  : undefined;

// D-3 NDJSON şemasını koru: {ts, level, msg, ...} — her satır geçerli JSON.
// `time` yerine `ts` ISO string; level sayısal yerine label ('info', 'error', ...).
export const logger = pino({
  level,
  transport,
  timestamp: () => `,"ts":"${new Date().toISOString()}"`,
  formatters: {
    level: (label) => ({ level: label }),
    bindings: () => ({}),
  },
  redact: {
    paths: [
      'req.headers.authorization',
      'req.headers["x-bridge-token"]',
      'req.headers.cookie',
      '*.password',
      '*.token',
      '*.jwtSecret',
      '*.bridgeToken',
      '*.refreshToken',
    ],
    censor: '***',
  },
});

export default logger;
