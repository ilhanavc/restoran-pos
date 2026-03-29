import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import config from './config/index.js';
import { runMigrations } from './migrations/run.js';

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

const app = express();

// Middleware
app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({
  origin: ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:3001'],
  credentials: true,
}));
app.use(express.json({ limit: '10mb' }));

// Health check
app.get('/api/health', (req, res) => res.json({ status: 'ok', time: new Date().toISOString() }));

// API Routes
app.use('/api/auth', authRoutes);
app.use('/api/tables', tablesRoutes);
app.use('/api/categories', categoriesRoutes);
app.use('/api/products', productsRoutes);
app.use('/api/orders', ordersRoutes);
app.use('/api/payments', paymentsRoutes);
app.use('/api/customers', customersRoutes);
app.use('/api/callerid', calleridRoutes);
app.use('/api/caller-id', calleridRoutes);
app.use('/api/reports', reportsRoutes);
app.use('/api/print', printerRoutes);
app.use('/api/admin', adminRoutes);
app.use('/api/bridge', bridgeRoutes);

// Bilinmeyen /api yolları için JSON 404 (HTML dönmesin)
app.use('/api', (req, res) => {
  res.status(404).json({ error: 'İstek bulunamadı', path: req.originalUrl });
});

// Error handler
app.use((err, req, res, next) => {
  console.error('Unhandled error:', err);
  res.status(500).json({ error: 'Beklenmeyen bir hata oluştu' });
});

// Start
runMigrations();

app.listen(config.port, () => {
  console.log(`
  ╔══════════════════════════════════════╗
  ║   🍽️  Restoran POS Server           ║
  ║   Port: ${config.port}                        ║
  ║   Env:  ${config.nodeEnv}               ║
  ╚══════════════════════════════════════╝
  `);
});

export default app;
