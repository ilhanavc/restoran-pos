import { createServer } from 'http';
import express from 'express';
import path from 'path';
import fs from 'fs';
import cors from 'cors';

import compression from 'compression';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import pinoHttp from 'pino-http';
import { randomUUID } from 'crypto';
import config from './config/index.js';
import { buildCorsOriginCallback } from './utils/corsOrigin.js';
import { logger } from './utils/logger.js';
import { initSentry, Sentry, isSentryEnabled } from './utils/sentry.js';
import { runMigrations } from './migrations/run.js';
import { initSocket } from './socket.js';

// Sentry init'i diğer middleware'lerden ÖNCE çağrılmalı ki
// Sentry.setupExpressErrorHandler(app) doğru çalışsın.
initSentry();

// Routes
import authRoutes from './routes/auth.js';
import tablesRoutes from './routes/tables.js';
import categoriesRoutes from './routes/categories.js';
import productsRoutes from './routes/products.js';
import ordersRoutes from './routes/orders.js';
import paymentsRoutes from './routes/payments.js';
import refundsRoutes from './routes/refunds.js';
import customersRoutes from './routes/customers.js';
import calleridRoutes from './routes/callerid.js';
import reportsRoutes from './routes/reports.js';
import periodCloseRoutes from './routes/periodClose.js';
import printerRoutes from './routes/printer.js';
import adminRoutes from './routes/admin.js';
import bridgeRoutes from './routes/bridge.js';
import reservationsRoutes from './routes/reservations.js';
import stockRoutes from './routes/stock.js';
import waiterCallRoutes from './routes/waiterCall.js';
import attributesRoutes from './routes/attributes.js';
import mobileRoutes from './routes/mobile.js';
import dashboardRoutes from './routes/dashboard.js';
import { requestIdMiddleware } from './middleware/requestId.js';

const app = express();

// Reverse proxy arkasındaysa (Nginx, Cloudflare) gerçek client IP'yi X-Forwarded-For
// başlığından çözmek için; express-rate-limit ve access log güvenilirliği buna bağlı.
// TRUST_PROXY_HOPS env'i ile ayarlanır (varsayılan 0 = doğrudan erişim).
app.set('trust proxy', config.trustProxyHops);

// CORS origin callback: prod'da yalnızca `config.corsOrigins` whitelist'i;
// dev'de ek olarak localhost / 127.0.0.1 / LAN (192.168.x, 10.x) otomatik izin verir.
// Bilinmeyen origin → `CORS: origin not allowed` (403). Detay: utils/corsOrigin.js
// NOT: cors() rate-limit'ten ÖNCE çağrılmalı — aksi halde 429 yanıtlarında
// Access-Control-Allow-Origin header'ı olmaz ve tarayıcı "No CORS header" der.
app.use(cors({
  origin: buildCorsOriginCallback({
    origins: config.corsOrigins,
    isProduction: config.nodeEnv === 'production',
  }),
  credentials: true,
}));

// Global rate-limit — /api/health hariç tüm endpoint'lere uygulanır.
// Monitoring probe'larının ve per-route limiter'ların etkisiz kalmaması için
// health endpoint skip edilir; gerçek IP için trust proxy ayarının doğru
// yapıldığından emin olun (TRUST_PROXY_HOPS).
const globalLimiter = rateLimit({
  windowMs: config.globalRateLimit.windowMs,
  max: config.globalRateLimit.max,
  standardHeaders: true,
  legacyHeaders: false,
  skip: (req) => req.path === '/api/health',
  message: { error: 'Çok fazla istek gönderildi, lütfen daha sonra tekrar deneyin.' },
});
app.use(globalLimiter);

// Middleware
app.use(compression());
app.use(helmet({ contentSecurityPolicy: false }));
app.use(express.json({ limit: '10mb' }));

// Her request'e izlenebilir kimlik ata (X-Request-Id header)
app.use(requestIdMiddleware);

// Her request'in Sentry isolation scope'una requestId tag'i ekle (log correlation).
if (isSentryEnabled()) {
  app.use((req, _res, next) => {
    Sentry.getCurrentScope().setTag('requestId', req.requestId || null);
    next();
  });
}

// Structured access log — pino-http, NDJSON (electron-main.log uyumlu).
// D-3 şeması korunur: her satır {ts, level, method, path, status, ms, requestId}.
// /api/health probe gürültüsü susturulur.
app.use(pinoHttp({
  logger,
  genReqId: (req) => req.requestId || randomUUID(),
  customLogLevel: (req, res, err) => {
    if (err || res.statusCode >= 500) return 'error';
    if (res.statusCode >= 400) return 'warn';
    return 'info';
  },
  customSuccessMessage: () => 'access',
  customErrorMessage: () => 'access',
  autoLogging: {
    ignore: (req) => req.url === '/api/health',
  },
  // D-3 şeması: mevcut alan adlarını koru (method/path/status/ms/requestId)
  customProps: (req, res) => ({
    method: req.method,
    path: req.url?.split('?')[0],
    status: res.statusCode,
    requestId: req.requestId || req.id || null,
  }),
  customAttributeKeys: {
    responseTime: 'ms',
  },
  // Varsayılan req/res/responseTime alanlarını bastır (customProps zaten yazıyor)
  serializers: {
    req: () => undefined,
    res: () => undefined,
  },
}));

// Rate limiting
// Auth endpoint'leri: 15 dakikada 50 deneme (brute-force koruması)
const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 50,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Çok fazla istek. Lütfen 15 dakika sonra tekrar deneyin.' },
});

// Admin ekranlari: kullanici kaynakli ayar/rapor istekleri icin orta seviye koruma.
const adminLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 240,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'İstek limiti aşıldı. Lütfen bir dakika sonra tekrar deneyin.' },
});

// StoreBridge arka planda surekli print-job/discovery poll eder. Admin ile ayni kovayi
// paylasirsa yazici ayar ekrani 429 alip listeyi gecici bos gosterebilir.
const bridgeLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 600,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'StoreBridge istek limiti aşıldı. Lütfen biraz sonra tekrar deneyin.' },
});

// Yazıcı test endpoint'i: 1 dakikada 10 istek (kağıt tüketimini önle)
const printerLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Yazıcı test limiti aşıldı. Lütfen bir dakika bekleyin.' },
});

// Garson çağırma public endpoint: 1 dakikada 10 istek/IP (QR kötüye kullanımını önle)
const waiterCallLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: 'Çok sık çağrı yapıldı. Lütfen bir dakika bekleyin.',
});

// Ürün görselleri — kimlik doğrulama gerektirmez (img src ile erişilir)
const uploadsDir = path.join(config.userDataPath, 'uploads');
fs.mkdirSync(uploadsDir, { recursive: true });
app.use('/uploads', express.static(uploadsDir));

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// API Routes
app.use('/api/auth', authLimiter, authRoutes);
app.use('/api/tables', tablesRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/refunds', refundsRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/callerid', calleridRoutes);
app.use('/api/caller-id', calleridRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/period-close', periodCloseRoutes);
app.use('/api/print', printerLimiter, printerRoutes);
app.use('/api/admin', adminLimiter, adminRoutes);
app.use('/api/bridge', bridgeLimiter, bridgeRoutes);
app.use('/api/reservations', reservationsRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/waiter-call', waiterCallLimiter, waiterCallRoutes);
app.use('/api/attributes', attributesRoutes);
app.use('/api/mobile', mobileRoutes);
app.use('/api/dashboard', dashboardRoutes);

// Bilinmeyen /api yolları için JSON 404 (HTML dönmesin)
app.use('/api', (req, res) => {
  if (config.nodeEnv !== 'production') {
    logger.warn({ method: req.method, path: req.originalUrl }, 'api 404');
  }
  res.status(404).json({
    error: 'İstek bulunamadı',
    path: req.originalUrl,
    method: req.method,
  });
});

// Production: Vite build statik dosyalar + React Router için SPA fallback
if (config.nodeEnv === 'production') {
  const indexHtml = path.join(config.clientDist, 'index.html');
  if (fs.existsSync(indexHtml)) {
    app.use(
      express.static(config.clientDist, {
        index: false,
      }),
    );
    app.get('*', (req, res, next) => {
      if (req.path.startsWith('/api')) {
        return next();
      }
      res.sendFile(indexHtml, (err) => {
        if (err) next(err);
      });
    });
  } else {
    logger.warn(
      { clientDist: config.clientDist },
      `[prod] React build bulunamadı (${config.clientDist}). Önce proje kökünde "npm run build" çalıştırın.`,
    );
  }
}

// Sentry error handler — 500 catch-all'dan ÖNCE olmalı (olay yakalar, sonra next'e geçer).
// DSN yoksa setupExpressErrorHandler yine güvenli (internal no-op).
if (isSentryEnabled()) {
  Sentry.setupExpressErrorHandler(app);
}

// Error handler (en sonda)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const requestId = req.requestId || null;
  const sentryEventId = res.sentry || null;
  logger.error({ err, requestId, sentryEventId }, 'Unhandled error');
  res.status(500).json({
    error: 'Beklenmeyen bir hata oluştu',
    ...(requestId ? { requestId } : {}),
    ...(sentryEventId ? { sentryEventId } : {}),
  });
});

// Start
runMigrations();

const httpServer = createServer(app);
initSocket(httpServer);

httpServer.listen(config.port, config.host, () => {
  logger.info(
    { host: config.host, port: config.port, env: config.nodeEnv },
    `Restoran POS Server ${config.host}:${config.port} (${config.nodeEnv})`,
  );
});

export default app;
