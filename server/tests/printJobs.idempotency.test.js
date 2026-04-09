import { describe, it, expect, beforeEach } from 'vitest';
import Database from 'better-sqlite3';

/**
 * print_jobs idempotency testleri.
 * INSERT OR IGNORE + idempotency_key mekanizmasını doğrular.
 * Gerçek DB yerine in-memory SQLite kullanır.
 */

function makeDb() {
  const db = new Database(':memory:');
  db.exec(`
    CREATE TABLE print_jobs (
      id TEXT PRIMARY KEY,
      business_id TEXT NOT NULL,
      order_id TEXT,
      printer_id TEXT,
      job_type TEXT NOT NULL,
      payload TEXT,
      status TEXT NOT NULL DEFAULT 'pending',
      error_message TEXT,
      idempotency_key TEXT UNIQUE,
      created_at TEXT,
      printed_at TEXT
    )
  `);
  return db;
}

function insertJob(db, { id, businessId, orderId, jobType, idempotencyKey, status = 'pending' }) {
  const info = db
    .prepare(
      `INSERT OR IGNORE INTO print_jobs
         (id, business_id, order_id, job_type, payload, status, idempotency_key, created_at, printed_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, datetime('now'), NULL)`
    )
    .run(id, businessId, orderId ?? null, jobType, '{}', status, idempotencyKey);
  return { inserted: info.changes > 0, duplicate: info.changes === 0 };
}

// ── Temel idempotency ────────────────────────────────────────────────────────

describe('print_jobs idempotency', () => {
  let db;
  beforeEach(() => { db = makeDb(); });

  it('İlk ekleme başarılı — inserted: true', () => {
    const result = insertJob(db, {
      id: 'job1',
      businessId: 'biz1',
      orderId: 'ord1',
      jobType: 'receipt',
      idempotencyKey: 'receipt|biz1|ord1',
    });
    expect(result.inserted).toBe(true);
    expect(result.duplicate).toBe(false);
  });

  it('Aynı idempotency_key ile ikinci ekleme — duplicate: true, kayıt değişmez', () => {
    const key = 'receipt|biz1|ord1';
    insertJob(db, { id: 'job1', businessId: 'biz1', orderId: 'ord1', jobType: 'receipt', idempotencyKey: key });
    const result = insertJob(db, { id: 'job2', businessId: 'biz1', orderId: 'ord1', jobType: 'receipt', idempotencyKey: key });

    expect(result.inserted).toBe(false);
    expect(result.duplicate).toBe(true);

    // DB'de yalnızca ilk kayıt var
    const rows = db.prepare('SELECT * FROM print_jobs WHERE idempotency_key = ?').all(key);
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('job1');
  });

  it('Farklı idempotency_key → iki ayrı kayıt eklenir', () => {
    insertJob(db, { id: 'j1', businessId: 'biz1', orderId: 'ord1', jobType: 'receipt', idempotencyKey: 'receipt|biz1|ord1' });
    insertJob(db, { id: 'j2', businessId: 'biz1', orderId: 'ord1', jobType: 'kitchen', idempotencyKey: 'kitchen|biz1|ord1|abc' });

    const count = db.prepare('SELECT COUNT(*) as c FROM print_jobs').get().c;
    expect(count).toBe(2);
  });

  it('Farklı business aynı sipariş no — çakışma olmaz', () => {
    const r1 = insertJob(db, { id: 'j1', businessId: 'biz1', orderId: 'ord1', jobType: 'receipt', idempotencyKey: 'receipt|biz1|ord1' });
    const r2 = insertJob(db, { id: 'j2', businessId: 'biz2', orderId: 'ord1', jobType: 'receipt', idempotencyKey: 'receipt|biz2|ord1' });

    expect(r1.inserted).toBe(true);
    expect(r2.inserted).toBe(true);
  });

  it('N kez çağrı → hepsi duplicate, DB\'de tek kayıt', () => {
    const key = 'takeaway_label|biz1|ord99';
    insertJob(db, { id: 'original', businessId: 'biz1', orderId: 'ord99', jobType: 'takeaway_label', idempotencyKey: key });

    for (let i = 0; i < 5; i++) {
      const r = insertJob(db, { id: `dup-${i}`, businessId: 'biz1', orderId: 'ord99', jobType: 'takeaway_label', idempotencyKey: key });
      expect(r.duplicate).toBe(true);
    }

    const count = db.prepare('SELECT COUNT(*) as c FROM print_jobs').get().c;
    expect(count).toBe(1);
  });
});

// ── Durum sorgulama ──────────────────────────────────────────────────────────

describe('print_jobs durum sorgusu', () => {
  let db;
  beforeEach(() => {
    db = makeDb();
    // 3 iş: 1 pending, 1 printed, 1 failed
    insertJob(db, { id: 'p1', businessId: 'biz1', orderId: 'o1', jobType: 'receipt', idempotencyKey: 'k1', status: 'pending' });
    insertJob(db, { id: 'p2', businessId: 'biz1', orderId: 'o2', jobType: 'kitchen', idempotencyKey: 'k2', status: 'printed' });
    insertJob(db, { id: 'p3', businessId: 'biz1', orderId: 'o3', jobType: 'receipt', idempotencyKey: 'k3', status: 'failed' });
  });

  it('Pending işler doğru sayıda sorgulanır', () => {
    const rows = db.prepare(`SELECT * FROM print_jobs WHERE status = 'pending' AND business_id = ?`).all('biz1');
    expect(rows.length).toBe(1);
    expect(rows[0].id).toBe('p1');
  });

  it('Status güncelleme çalışır', () => {
    db.prepare(`UPDATE print_jobs SET status = 'printed', printed_at = datetime('now') WHERE id = ?`).run('p1');
    const row = db.prepare('SELECT status FROM print_jobs WHERE id = ?').get('p1');
    expect(row.status).toBe('printed');
  });
});
