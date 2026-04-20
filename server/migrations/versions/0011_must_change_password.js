export const version = '0011_must_change_password';
export const name = 'Add must_change_password flag to users for forced password reset on first login';

export function up(database) {
  const cols = database.prepare('PRAGMA table_info(users)').all();
  const has = cols.some((c) => c.name === 'must_change_password');
  if (!has) {
    database.exec(`ALTER TABLE users ADD COLUMN must_change_password INTEGER DEFAULT 0`);
  }
}
