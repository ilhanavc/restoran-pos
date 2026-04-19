import { authenticate, businessScope } from './auth.js';

/**
 * Middleware: X-Client-Type: mobile header zorunlu + JWT authenticate + businessScope.
 * Mobil olmayan istemciler 400 alır.
 */
export function requireMobile(req, res, next) {
  if (req.headers['x-client-type'] !== 'mobile') {
    return res.status(400).json({ error: 'Bu endpoint yalnızca mobil istemcilere açıktır' });
  }
  authenticate(req, res, () => businessScope(req, res, next));
}
