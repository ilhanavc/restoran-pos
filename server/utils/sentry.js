import * as Sentry from '@sentry/node';
import { nodeProfilingIntegration } from '@sentry/profiling-node';
import config from '../config/index.js';
import { logger } from './logger.js';

let initialized = false;

// Hassas alan adları — request body / extra / contexts üzerinde beforeSend hook'u
// ile bu alanlar '***' olarak kazınır. Pino redact ile simetrik.
const SENSITIVE_KEYS = new Set([
  'password',
  'oldpassword',
  'newpassword',
  'token',
  'refreshtoken',
  'accesstoken',
  'jwtsecret',
  'bridgetoken',
  'authorization',
  'cookie',
  'x-bridge-token',
]);

function redactObject(value, depth = 0) {
  if (depth > 6 || value === null || value === undefined) return value;
  if (Array.isArray(value)) return value.map((v) => redactObject(v, depth + 1));
  if (typeof value !== 'object') return value;
  const out = {};
  for (const key of Object.keys(value)) {
    if (SENSITIVE_KEYS.has(key.toLowerCase())) {
      out[key] = '***';
    } else {
      out[key] = redactObject(value[key], depth + 1);
    }
  }
  return out;
}

// 4xx user-fault errorlar Sentry'ye gönderilmez (gürültü azaltma).
// Rate-limit, validation, auth fail — bunlar "beklenen" hatalardır.
const IGNORED_ERROR_MESSAGES = [
  'CORS: origin not allowed',
  'Çok fazla istek',
  'validation',
  'ValidationError',
];

export function beforeSendRedact(event) {
  if (!event) return event;

  if (event.request) {
    if (event.request.headers) {
      event.request.headers = redactObject(event.request.headers);
    }
    if (event.request.data) {
      event.request.data = redactObject(event.request.data);
    }
    if (event.request.cookies) {
      event.request.cookies = redactObject(event.request.cookies);
    }
  }

  if (event.extra) {
    event.extra = redactObject(event.extra);
  }
  if (event.contexts) {
    event.contexts = redactObject(event.contexts);
  }
  if (event.user && event.user.password) {
    event.user = redactObject(event.user);
  }

  return event;
}

export function initSentry() {
  if (initialized) return;
  if (!config.sentry.dsn) {
    logger.info('Sentry disabled (no DSN)');
    return;
  }

  Sentry.init({
    dsn: config.sentry.dsn,
    environment: config.sentry.environment,
    release: config.sentry.release || undefined,
    tracesSampleRate: config.sentry.tracesSampleRate,
    profilesSampleRate: config.sentry.profilesSampleRate,
    sendDefaultPii: false,
    integrations: [
      nodeProfilingIntegration(),
    ],
    ignoreErrors: IGNORED_ERROR_MESSAGES,
    beforeSend: beforeSendRedact,
  });

  initialized = true;
  logger.info(
    { environment: config.sentry.environment, release: config.sentry.release || null },
    'Sentry initialized',
  );
}

export function isSentryEnabled() {
  return initialized;
}

export { Sentry };
