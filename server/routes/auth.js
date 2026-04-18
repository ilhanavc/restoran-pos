import { Router } from 'express';
import { z } from 'zod';
import bcryptjs from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from '../config/index.js';
import db from '../config/database.js';
import { authenticate } from '../middleware/auth.js';
import { auditLog, genId } from '../utils/helpers.js';
import { generateRefreshToken, hashToken } from '../utils/tokenUtils.js';
import { validate } from '../middleware/validate.js';

const router = Router();
const MOBILE_ACCESS_TOKEN_EXPIRES_IN = '15m';
const MOBILE_ACCESS_TOKEN_EXPIRES_SECONDS = 15 * 60;
const DESKTOP_ACCESS_TOKEN_EXPIRES_IN = '8h';

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
    device_id: z.string().trim().max(128).optional(),
    deviceId: z.string().trim().max(128).optional(),
  }),
};

const refreshSchema = {
  body: z.object({
    refreshToken: z.string().trim().min(1),
  }),
};

const logoutSchema = {
  body: z.object({
    refreshToken: z.string().trim().min(1).optional(),
  }).optional().default({}),
};

function signAccessToken(user, expiresIn) {
  return jwt.sign(
    { userId: user.id, role: user.role_slug, businessId: user.business_id },
    config.jwt.secret,
    { expiresIn },
  );
}

function getMobileDeviceId(req) {
  return req.body.device_id || req.body.deviceId || req.headers['x-device-id'] || null;
}

function createRefreshTokenRecord({ userId, clientType = 'mobile', deviceId = null }) {
  const refreshToken = generateRefreshToken();
  db.prepare(`
    INSERT INTO refresh_tokens (id, user_id, token_hash, device_id, client_type, expires_at)
    VALUES (?, ?, ?, ?, ?, datetime('now', '+30 days'))
  `).run(genId(), userId, hashToken(refreshToken), deviceId, clientType);
  return refreshToken;
}

// POST /api/auth/login
router.post('/login', validate(loginSchema), (req, res) => {
  try {
    const { email, password, business_id } = req.body;
    const clientType = req.headers['x-client-type'] === 'mobile' ? 'mobile' : 'desktop';
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

    const token = signAccessToken(
      user,
      clientType === 'mobile' ? MOBILE_ACCESS_TOKEN_EXPIRES_IN : DESKTOP_ACCESS_TOKEN_EXPIRES_IN,
    );

    db.prepare(`UPDATE users SET last_login_at = datetime('now') WHERE id = ?`).run(user.id);
    auditLog(user.business_id, user.id, 'login', 'user', user.id);

    const response = {
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
    };

    if (clientType === 'mobile') {
      response.refreshToken = createRefreshTokenRecord({
        userId: user.id,
        clientType,
        deviceId: getMobileDeviceId(req),
      });
      response.expiresIn = MOBILE_ACCESS_TOKEN_EXPIRES_SECONDS;
    }

    res.json(response);
  } catch (err) {
    console.error('Login error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/auth/refresh
router.post('/refresh', validate(refreshSchema), (req, res) => {
  try {
    const tokenHash = hashToken(req.body.refreshToken);
    const existing = db.prepare(`
      SELECT id, user_id, device_id, client_type, expires_at
      FROM refresh_tokens
      WHERE token_hash = ?
    `).get(tokenHash);

    if (!existing) {
      return res.status(401).json({ error: 'Geçersiz refresh token' });
    }

    const expired = db
      .prepare(`SELECT datetime(?) <= datetime('now') AS expired`)
      .get(existing.expires_at).expired;
    if (expired) {
      db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(existing.id);
      return res.status(401).json({ error: 'Refresh token süresi doldu' });
    }

    const user = db.prepare(`
      SELECT u.id, u.business_id, u.branch_id, u.email, u.full_name, u.is_active,
             r.slug as role_slug, r.name as role_name, r.permissions
      FROM users u JOIN roles r ON u.role_id = r.id
      WHERE u.id = ?
    `).get(existing.user_id);

    if (!user || !user.is_active) {
      db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(existing.id);
      return res.status(401).json({ error: 'Geçersiz oturum' });
    }

    const nextRefreshToken = generateRefreshToken();
    const rotate = db.transaction(() => {
      db.prepare('DELETE FROM refresh_tokens WHERE id = ?').run(existing.id);
      db.prepare(`
        INSERT INTO refresh_tokens (id, user_id, token_hash, device_id, client_type, expires_at)
        VALUES (?, ?, ?, ?, ?, datetime('now', '+30 days'))
      `).run(
        genId(),
        user.id,
        hashToken(nextRefreshToken),
        existing.device_id,
        existing.client_type || 'mobile',
      );
    });
    rotate();

    res.json({
      token: signAccessToken(user, MOBILE_ACCESS_TOKEN_EXPIRES_IN),
      refreshToken: nextRefreshToken,
      expiresIn: MOBILE_ACCESS_TOKEN_EXPIRES_SECONDS,
    });
  } catch (err) {
    console.error('Refresh error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/auth/logout
router.post('/logout', authenticate, validate(logoutSchema), (req, res) => {
  try {
    if (req.body.refreshToken) {
      db.prepare('DELETE FROM refresh_tokens WHERE token_hash = ?').run(hashToken(req.body.refreshToken));
    }
    res.json({ success: true });
  } catch (err) {
    console.error('Logout error:', err);
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/auth/logout-all
router.post('/logout-all', authenticate, (req, res) => {
  try {
    const info = db.prepare('DELETE FROM refresh_tokens WHERE user_id = ?').run(req.user.id);
    res.json({ success: true, revoked: info.changes || 0 });
  } catch (err) {
    console.error('Logout all error:', err);
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
