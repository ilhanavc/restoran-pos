import { createServer } from 'http';
import express from 'express';
import path from 'path';
import fs from 'fs';
import cors from 'cors';

import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import config from './config/index.js';
import { runMigrations } from './migrations/run.js';
import { initSocket } from './socket.js';

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

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
const allowedOrigins = (process.env.CORS_ORIGINS || 'http://localhost:5173,http://127.0.0.1:5173')
  .split(',')
  .map((o) => o.trim())
  .filter(Boolean);

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Her request'e izlenebilir kimlik ata (X-Request-Id header)
app.use(requestIdMiddleware);

// Structured access log — JSON-line, electron-main.log'a akar (health check hariç)
app.use((req, res, next) => {
  const start = Date.now();
  res.on('finish', () => {
    if (req.path === '/api/health') return;
    console.log('[access]', JSON.stringify({
      ts: new Date().toISOString(),
      method: req.method,
      path: req.path,
      status: res.statusCode,
      ms: Date.now() - start,
      requestId: req.requestId || null,
    }));
  });
  next();
});

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
    console.warn('[api 404]', req.method, req.originalUrl);
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
    console.warn(
      `[prod] React build bulunamadı (${config.clientDist}). Önce proje kökünde "npm run build" çalıştırın.`,
    );
  }
}

// Error handler (en sonda)
// eslint-disable-next-line no-unused-vars
app.use((err, req, res, next) => {
  const requestId = req.requestId || null;
  console.error('Unhandled error:', err, requestId ? { requestId } : undefined);
  res.status(500).json({
    error: 'Beklenmeyen bir hata oluştu',
    ...(requestId ? { requestId } : {}),
  });
});

// Start
runMigrations();

const httpServer = createServer(app);
initSocket(httpServer);

httpServer.listen(config.port, config.host, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   🍽️  Restoran POS Server           ║
  ║   Host: ${config.host}                 ║
  ║   Port: ${config.port}                        ║
  ║   Env:  ${config.nodeEnv}               ║
  ╚══════════════════════════════════════╝
  `);
});

export default app;
