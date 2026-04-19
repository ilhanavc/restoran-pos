export const version = '0005_devices';
export const name = 'Add devices and device_pairing_tokens tables';

export function up(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS devices (
      id TEXT PRIMARY KEY,
      user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      device_name TEXT NOT NULL,
      platform TEXT NOT NULL DEFAULT 'unknown',
      last_seen_at TEXT,
      is_active INTEGER NOT NULL DEFAULT 1,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_devices_business_id ON devices(business_id)
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_devices_user_id ON devices(user_id)
  `);

  database.exec(`
    CREATE TABLE IF NOT EXISTS device_pairing_tokens (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id) ON DELETE CASCADE,
      token TEXT NOT NULL UNIQUE,
      expires_at TEXT NOT NULL,
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_device_pairing_tokens_token ON device_pairing_tokens(token)
  `);
}
