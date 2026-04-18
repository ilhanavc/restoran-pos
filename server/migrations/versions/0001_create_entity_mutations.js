export const version = '0001_create_entity_mutations';
export const name = 'Create entity mutations audit trail';

export function up(database) {
  database.exec(`
    CREATE TABLE IF NOT EXISTS entity_mutations (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL REFERENCES businesses(id),
      entity_table TEXT NOT NULL,
      entity_id TEXT NOT NULL,
      action TEXT NOT NULL CHECK(action IN ('create','update','delete','void','refund','status_change')),
      before_json TEXT,
      after_json TEXT,
      actor_user_id TEXT REFERENCES users(id),
      reason TEXT,
      request_id TEXT,
      source TEXT NOT NULL DEFAULT 'api',
      created_at TEXT NOT NULL DEFAULT (datetime('now'))
    )
  `);

  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_entity_mutations_business_created
    ON entity_mutations(business_id, created_at DESC)
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_entity_mutations_entity
    ON entity_mutations(entity_table, entity_id, created_at DESC)
  `);
  database.exec(`
    CREATE INDEX IF NOT EXISTS idx_entity_mutations_actor_created
    ON entity_mutations(actor_user_id, created_at DESC)
  `);
}
