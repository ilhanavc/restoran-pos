import { randomUUID } from 'crypto';

/**
 * Her isteğe izlenebilir bir X-Request-Id atar.
 *
 * - İstemci geçerli UUID biçiminde bir X-Request-Id gönderirse onu kullanır
 *   (bu sayede uçtan-uca trace mümkün olur).
 * - Geçersiz veya eksik ise sunucu yeni bir UUID üretir (header injection önlenir).
 * - req.requestId hem route'larda hem entity_mutations audit kaydında kullanılır.
 */

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export function requestIdMiddleware(req, res, next) {
  const incoming = req.headers['x-request-id'];
  const id = (incoming && UUID_RE.test(incoming)) ? incoming : randomUUID();
  req.requestId = id;
  res.setHeader('x-request-id', id);
  next();
}
