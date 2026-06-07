/**
 * Admin şifre sıfırlama scripti
 * Kullanım: node scripts/reset-password.cjs <db-yolu> <email> <yeni-şifre>
 */
const Database = require('../server/node_modules/better-sqlite3');
const bcrypt = require('../server/node_modules/bcryptjs');

const [,, dbPath, email, newPassword] = process.argv;

if (!dbPath || !email || !newPassword) {
  console.error('Kullanım: node scripts/reset-password.cjs <db-yolu> <email> <yeni-şifre>');
  process.exit(1);
}

(async () => {
  const db = new Database(dbPath);
  const user = db.prepare('SELECT id, email, name, role FROM users WHERE email = ?').get(email);

  if (!user) {
    console.error('Kullanıcı bulunamadı:', email);
    const all = db.prepare('SELECT email, role FROM users').all();
    console.log('Mevcut kullanıcılar:', all);
    db.close();
    process.exit(1);
  }

  console.log('Kullanıcı bulundu:', user.email, '/', user.role);

  const hash = await bcrypt.hash(newPassword, 10);
  db.prepare(`UPDATE users SET password_hash = ?, must_change_password = 0, updated_at = datetime('now') WHERE email = ?`)
    .run(hash, email);

  console.log('✅ Şifre başarıyla sıfırlandı!');
  console.log('   E-posta:', email);
  console.log('   Yeni şifre:', newPassword);
  db.close();
})();
