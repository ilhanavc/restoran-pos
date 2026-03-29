import config from '../config/index.js';

/**
 * X-Bridge-Token (veya Authorization: Bearer <token>) ile yerel köprü kimliği.
 * BRIDGE_TOKEN ve BRIDGE_BUSINESS_ID sunucu ortamında tanımlı olmalı.
 */
export function bridgeAuth(req, res, next) {
  const header = req.headers.authorization;
  const bearer = header && header.startsWith('Bearer ') ? header.slice(7).trim() : null;
  const token = req.headers['x-bridge-token'] || bearer || '';

  if (!config.bridge?.token) {
    return res.status(503).json({ error: 'Bridge API yapılandırılmadı (BRIDGE_TOKEN ortam değişkeni).' });
  }
  if (!config.bridge?.businessId) {
    return res.status(503).json({ error: 'Bridge API yapılandırılmadı (BRIDGE_BUSINESS_ID ortam değişkeni).' });
  }
  if (!token || token !== config.bridge.token) {
    return res.status(401).json({ error: 'Geçersiz bridge token' });
  }

  req.businessId = config.bridge.businessId;
  next();
}
