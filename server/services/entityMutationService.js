import db from '../config/database.js';
import { genId } from '../utils/helpers.js';

function toJson(value) {
  if (value == null) return null;
  return JSON.stringify(value);
}

export function recordEntityMutation({
  businessId,
  entityTable,
  entityId,
  action,
  before = null,
  after = null,
  actorUserId = null,
  reason = null,
  requestId = null,
  source = 'api',
}) {
  db.prepare(`
    INSERT INTO entity_mutations (
      id, business_id, entity_table, entity_id, action,
      before_json, after_json, actor_user_id, reason, request_id, source
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
  `).run(
    genId(),
    businessId,
    entityTable,
    entityId,
    action,
    toJson(before),
    toJson(after),
    actorUserId,
    reason,
    requestId,
    source,
  );
}
