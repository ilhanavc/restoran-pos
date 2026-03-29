import db from './config/database.js';
import bcryptjs from 'bcryptjs';
import jwt from 'jsonwebtoken';
import config from './config/index.js';
import { auditLog } from './utils/helpers.js';

try {
    const email = "admin@demo.com";
    const password = "123456";

    const user = db.prepare(`
      SELECT u.*, r.slug as role_slug, r.name as role_name, r.permissions,
             b.name as business_name
      FROM users u 
      JOIN roles r ON u.role_id = r.id
      JOIN businesses b ON u.business_id = b.id
      WHERE u.email = ? AND u.is_active = 1
    `).get(email.toLowerCase().trim());

    if (!user) {
      console.log("User not found");
    } else if (!bcryptjs.compareSync(password, user.password_hash)) {
      console.log("Wrong password");
    } else {
      console.log("Password matched, user:", user.email);
    }

    const token = jwt.sign({ userId: user.id, businessId: user.business_id }, config.jwt.secret, {
      expiresIn: config.jwt.expiresIn,
    });
    console.log("Token generated");

    db.prepare('UPDATE users SET last_login_at = datetime("now") WHERE id = ?').run(user.id);
    console.log("last_login_at updated");

    auditLog(user.business_id, user.id, 'login', 'user', user.id);
    console.log("Audit log written");

    console.log("ALL SUCCESSFUL");
} catch(e) {
    console.error("EXCEPTION:", e.message);
    console.error(e.stack);
}
