import { Router } from 'express';
import { z } from 'zod';
import bcryptjs from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import db from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { auditLog } from '../utils/helpers.js';
import { validate } from '../middleware/validate.js';

const router = Router();

function getDisplaySettings(businessId) {
  const row = db.prepare(`SELECT value FROM settings WHERE business_id = ? AND key = 'app.display'`).get(businessId);
  const defaults = { theme: 'dark', language: 'tr', density: 'comfortable' };
  if (!row?.value) return defaults;
  try {
    return { ...defaults, ...JSON.parse(row.value) };
  } catch {
    return defaults;
  }
}

const loginSchema = {
  body: z.object({
    email: z.string().email('Geçerli bir e-posta adresi girin').max(254),
    password: z.string().min(1, 'Şifre gerekli').max(128),
    business_id: z.string().trim().min(1).optional(),
  }),
};

// POST /api/auth/login
router.post('/login', validate(loginSchema), (req, res) => {
  try {
    const { email, password, business_id } = req.body;
    if (!email || !password) {
      return res.status(400).json({ error: 'E-posta ve şifre gerekli' });
    }

    const rows = db.prepare(`
      SELECT u.*, r.slug as role_slug, r.name as role_name, r.permissions,
             b.name as business_name
      FROM users u 
      JOIN roles r ON u.role_id = r.id
      JOIN businesses b ON u.business_id = b.id
      WHERE u.email = ? AND u.is_active = 1
    `).all(email.toLowerCase().trim());

    if (!rows.length) {
      // Başarısız giriş — hangi e-posta denendi, logluyoruz (şifre asla loglanmaz)
      console.warn('[auth] Başarısız giriş denemesi — kullanıcı bulunamadı:', email.toLowerCase().trim());
      return res.status(401).json({ error: 'Geçersiz e-posta veya şifre' });
    }

    let user;
    if (rows.length > 1) {
      if (!business_id) {
        return res.status(400).json({
          error: 'Bu e-posta birden fazla işletmede kayıtlı. Lütfen işletme seçin.',
          requireBusinessId: true,
          businesses: rows.map((r) => ({ id: r.business_id, name: r.business_name })),
        });
      }
      user = rows.find((r) => r.business_id === business_id);
      if (!user) {
        return res.status(401).json({ error: 'Geçersiz işletme seçimi veya şifre' });
      }
    } else {
      user = rows[0];
    }

    if (!bcryptjs.compareSync(password, user.password_hash)) {
      // Başarısız giriş — yanlış şifre, kullanıcı kaydı mevcuttu
      console.warn('[auth] Başarısız giriş denemesi — yanlış şifre, kullanıcı:', user.id, 'işletme:', user.business_id);
      try {
        auditLog(user.business_id, null, 'login_failed', 'user', user.id);
      } catch (_e) { /* audit tablosu yazılamazsa girişi engelleme */ }
      return res.status(401).json({ error: 'Geçersiz e-posta veya şifre' });
    }

    const token = jwt.sign({ userId: user.id, businessId: user.business_id }, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn,
    });

    db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(user.id);
    auditLog(user.business_id, user.id, 'login', 'user', user.id);

    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        fullName: user.full_name,
        role: user.role_slug,
        roleName: user.role_name,
        permissions: JSON.parse(user.permissions || '{}'),
        businessId: user.business_id,
        businessName: user.business_name,
        branchId: user.branch_id,
      },
      display: getDisplaySettings(user.business_id),
    });
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/auth/me
router.get('/me', authenticate, (req, res) => {
  const biz = db.prepare('SELECT name FROM businesses WHERE id = ?').get(req.user.business_id);
  res.json({
    user: {
      id: req.user.id,
      email: req.user.email,
      fullName: req.user.full_name,
      role: req.user.role_slug,
      roleName: req.user.role_name,
      permissions: req.user.permissions,
      businessId: req.user.business_id,
      businessName: biz?.name,
      branchId: req.user.branch_id,
    },
    display: getDisplaySettings(req.user.business_id),
  });
});

export default router;
