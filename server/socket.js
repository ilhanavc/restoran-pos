/**
 * Socket.io altyapısı — gerçek zamanlı güncelleme.
 * initSocket(httpServer) ile başlatılır, emitToRoom() route handler'lardan çağrılır.
 */
import { Server } from 'socket.io';
import jwt from 'jsonwebtoken';
import config from './config/index.js';
import db from './config/database.js';
import { buildCorsOriginCallback } from './utils/corsOrigin.js';

/** @type {import('socket.io').Server | null} */
let io = null;

/**
 * HTTP server'a socket.io bağlar ve JWT auth middleware kurar.
 * @param {import('http').Server} httpServer
 */
export function initSocket(httpServer) {
  // HTTP API ile aynı whitelist mantığı — prod'da explicit origin'ler, dev'de
  // localhost/127.0.0.1/LAN regex'leri. Detay: utils/corsOrigin.js
  const originCallback = buildCorsOriginCallback({
    origins: config.corsOrigins,
    isProduction: config.nodeEnv === 'production',
  });

  io = new Server(httpServer, {
    cors: {
      origin: originCallback,
      credentials: true,
    },
    transports: ['websocket', 'polling'],
  });

  // JWT auth — bağlantı kurulmadan önce token doğrula
  io.use((socket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.replace('Bearer ', '');

    if (!token) return next(new Error('AUTH_REQUIRED'));

    try {
      const decoded = jwt.verify(token, config.jwt.secret);
      const user = db
        .prepare(
          `SELECT u.id, u.business_id, u.full_name, r.slug AS role_slug
           FROM users u JOIN roles r ON u.role_id = r.id
           WHERE u.id = ? AND u.is_active = 1`
        )
        .get(decoded.userId);

      if (!user) return next(new Error('AUTH_INVALID'));

      socket.data.user = user;
      socket.data.businessId = String(user.business_id);
      next();
    } catch {
      next(new Error('AUTH_INVALID'));
    }
  });

  io.on('connection', (socket) => {
    const { businessId } = socket.data;
    socket.join(`business:${businessId}`);
  });

  return io;
}

/**
 * İşletme odasına event yayınlar.
 * Socket.io henüz başlatılmamışsa sessizce atlanır.
 *
 * @param {string|number} businessId
 * @param {string} event  — 'order:created', 'table:updated', vb.
 * @param {unknown} payload
 */
export function emitToRoom(businessId, event, payload) {
  if (!io) return;
  io.to(`business:${String(businessId)}`).emit(event, payload);
}
