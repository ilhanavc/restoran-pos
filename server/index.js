import { createServer } from 'http';
import express from 'express';
import path from 'path';
import fs from 'fs';
import { fileURLToPath } from 'url';
import cors from 'cors';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
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
import customersRoutes from './routes/customers.js';
import calleridRoutes from './routes/callerid.js';
import reportsRoutes from './routes/reports.js';
import printerRoutes from './routes/printer.js';
import adminRoutes from './routes/admin.js';
import bridgeRoutes from './routes/bridge.js';
import reservationsRoutes from './routes/reservations.js';
import stockRoutes from './routes/stock.js';
import waiterCallRoutes from './routes/waiterCall.js';

const app = express();

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
// CORS_ORIGINS: virgülle ayrılmış ek origin'ler (LAN tablet/cihaz erişimi için)
// Örnek: CORS_ORIGINS=http://192.168.1.50:3001,http://192.168.1.51:3001
const extraOrigins = process.env.CORS_ORIGINS
  ? process.env.CORS_ORIGINS.split(',').map((o) => o.trim()).filter(Boolean)
  : [];

app.use(cors({
  origin: [
    'http://localhost:5173',
    'http://127.0.0.1:5173',
    'http://localhost:3001',
    'http://127.0.0.1:3001',
    ...extraOrigins,
  ],
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

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
const uploadsDir = process.env.USER_DATA_PATH
  ? path.join(process.env.USER_DATA_PATH, 'uploads')
  : path.join(__dirname, 'uploads');
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
app.use('/api/customers', customersRoutes);
app.use('/api/callerid', calleridRoutes);
app.use('/api/caller-id', calleridRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/print', printerLimiter, printerRoutes);
app.use('/api/admin', adminLimiter, adminRoutes);
app.use('/api/bridge', bridgeLimiter, bridgeRoutes);
app.use('/api/reservations', reservationsRoutes);
app.use('/api/stock', stockRoutes);
app.use('/api/waiter-call', waiterCallLimiter, waiterCallRoutes);

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
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Beklenmeyen bir hata oluştu' });
});

// Start
runMigrations();

const httpServer = createServer(app);
initSocket(httpServer);

httpServer.listen(config.port, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   🍽️  Restoran POS Server           ║
  ║   Port: ${config.port}                        ║
  ║   Env:  ${config.nodeEnv}               ║
  ╚══════════════════════════════════════╝
  `);
});

export default app;
