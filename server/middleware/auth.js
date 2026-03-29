import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import db from '../config/database.js';

export function authenticate(req, res, next) {
  const header = req.headers.authorization;
  if (!header || !header.startsWith('Bearer ')) {
    return res.status(401).json({ error: 'Yetkilendirme gerekli' });
  }

  try {
    const token = header.split(' ')[1];
    const decoded = jwt.verify(token, config.jwt.secret);
    
    const user = db.prepare(`
      SELECT u.id, u.business_id, u.branch_id, u.email, u.full_name, u.is_active,
             r.slug as role_slug, r.name as role_name, r.permissions
      FROM users u JOIN roles r ON u.role_id = r.id
      WHERE u.id = ?
    `).get(decoded.userId);

    if (!user || !user.is_active) {
      return res.status(401).json({ error: 'Geçersiz oturum' });
    }

    req.user = {
      ...user,
      permissions: JSON.parse(user.permissions || '{}'),
    };
    next();
  } catch (err) {
    return res.status(401).json({ error: 'Geçersiz token' });
  }
}

export function authorize(...allowedRoles) {
  return (req, res, next) => {
    if (!req.user) return res.status(401).json({ error: 'Yetkilendirme gerekli' });
    if (req.user.permissions.all) return next();
    if (allowedRoles.includes(req.user.role_slug)) return next();
    return res.status(403).json({ error: 'Bu işlem için yetkiniz yok' });
  };
}

export function businessScope(req, res, next) {
  // Ensure all queries are scoped to user's business
  req.businessId = req.user.business_id;
  req.branchId = req.user.branch_id;
  next();
}
