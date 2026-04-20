import * as Sentry from '@sentry/react';

let initialized = false;

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

const IGNORED_ERROR_MESSAGES = [
  'ResizeObserver loop limit exceeded',
  'ResizeObserver loop completed with undelivered notifications',
  'Non-Error promise rejection captured',
  'Network Error',
  'Failed to fetch',
];

export function beforeSendRedact(event) {
  if (!event) return event;

  if (event.request) {
    if (event.request.headers) event.request.headers = redactObject(event.request.headers);
    if (event.request.data) event.request.data = redactObject(event.request.data);
    if (event.request.cookies) event.request.cookies = redactObject(event.request.cookies);
    if (event.request.query_string) {
      // Auth token querystring'de olabilir — ?token=... tamamen kazı
      event.request.query_string = event.request.query_string.replace(
        /([?&](?:token|password|refresh_token|access_token|authorization)=)[^&]*/gi,
        '$1***',
      );
    }
  }

  if (event.extra) event.extra = redactObject(event.extra);
  if (event.contexts) event.contexts = redactObject(event.contexts);

  // Breadcrumb body'lerini de tara (HTTP isteklerinde token'lar breadcrumb'a sızabilir)
  if (event.breadcrumbs) {
    event.breadcrumbs = event.breadcrumbs.map((bc) => ({
      ...bc,
      data: bc.data ? redactObject(bc.data) : bc.data,
    }));
  }

  return event;
}

function resolveDsn() {
  if (import.meta.env.VITE_SENTRY_DSN) return import.meta.env.VITE_SENTRY_DSN;
  // Electron preload'dan gelen fallback (pos-config.json veya process.env.SENTRY_DSN)
  if (typeof window !== 'undefined' && window.electronAPI?.sentryDsn) {
    return window.electronAPI.sentryDsn;
  }
  return '';
}

export function initSentry() {
  if (initialized) return;
  const dsn = resolveDsn();
  if (!dsn) {
    console.info('[Sentry] disabled (no DSN)');
    return;
  }

  const environment = import.meta.env.VITE_SENTRY_ENVIRONMENT
    || (import.meta.env.DEV ? 'development' : 'production');

  const release = import.meta.env.VITE_SENTRY_RELEASE || undefined;

  const tracesSampleRate = Number.parseFloat(
    import.meta.env.VITE_SENTRY_TRACES_SAMPLE_RATE ?? '0.1',
  );
  const replaysSessionSampleRate = Number.parseFloat(
    import.meta.env.VITE_SENTRY_REPLAYS_SESSION_SAMPLE_RATE ?? '0.1',
  );
  const replaysOnErrorSampleRate = Number.parseFloat(
    import.meta.env.VITE_SENTRY_REPLAYS_ON_ERROR_SAMPLE_RATE ?? '1.0',
  );

  try {
    Sentry.init({
      dsn,
      environment,
      release,
      sendDefaultPii: false,
      tracesSampleRate,
      replaysSessionSampleRate,
      replaysOnErrorSampleRate,
      ignoreErrors: IGNORED_ERROR_MESSAGES,
      integrations: [
        Sentry.browserTracingIntegration(),
        Sentry.replayIntegration({
          maskAllText: true,      // tüm metinleri maskele (müşteri adı/telefon vs.)
          maskAllInputs: true,    // tüm input değerlerini maskele
          blockAllMedia: true,    // ürün görselleri vs. yollanmasın
        }),
      ],
      beforeSend: beforeSendRedact,
      beforeBreadcrumb(breadcrumb) {
        // console log breadcrumb'larında sensitive data olabilir — bypass et
        if (breadcrumb.category === 'console' && breadcrumb.level === 'debug') return null;
        return breadcrumb;
      },
    });
    initialized = true;
    console.info(`[Sentry] initialized (env=${environment})`);
  } catch (err) {
    // Sentry init hiçbir koşulda renderer'ı kırmasın
    console.error('[Sentry] init failed', err);
  }
}

export function isSentryEnabled() {
  return initialized;
}

export function setSentryUser(user) {
  if (!initialized) return;
  if (!user) {
    Sentry.setUser(null);
    return;
  }
  Sentry.setUser({
    id: user.id ? String(user.id) : undefined,
    email: user.email,
    username: user.name,
    role: user.role,
  });
}

export { Sentry };
