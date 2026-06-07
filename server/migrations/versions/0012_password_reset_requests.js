export const version = '0012_password_reset_requests';
export const name = 'Add password_reset_requests table for login recovery requests';

export function up(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS password_reset_requests (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      email TEXT NOT NULL,
      status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','completed','cancelled')),
      requested_at TEXT NOT NULL DEFAULT (datetime('now')),
      resolved_at TEXT,
      channel TEXT NOT NULL DEFAULT 'login_screen',
      created_at TEXT NOT NULL DEFAULT (datetime('now')),
      updated_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_password_reset_requests_user_status
    ON password_reset_requests(user_id, status, requested_at DESC)
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_password_reset_requests_business_status
    ON password_reset_requests(business_id, status, requested_at DESC)
  `);
}
