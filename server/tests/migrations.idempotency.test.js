import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { migrations } from '../migrations/run.js';

/**
 * Migration idempotency testleri.
 * Tüm migration SQL'lerinin IF NOT EXISTS kullandığını ve
 * hem fresh hem mevcut DB üzerinde güvenle çalıştığını doğrular.
 */

/** migrations dizisini in-memory DB üzerinde çalıştırır */
function applyMigrations(db) {
  const migrate = db.transaction(() => {
    for (const sql of migrations) {
      db.exec(sql);
    }
  });
  migrate();
}

// ── Temel tablolar oluştu mu? ─────────────────────────────────────────────────

describe('Migrations — fresh DB', () => {
  it('migrations dizisi boş değil', () => {
    expect(migrations.length).toBeGreaterThan(0);
  });

  it('Fresh DB üzerinde hatasız çalışır', () => {
    const db = new Database(':memory:');
    expect(() => applyMigrations(db)).not.toThrow();
    db.close();
  });

  it('Kritik tablolar oluşturuldu', () => {
    const db = new Database(':memory:');
    applyMigrations(db);

    const tables = db
      .prepare(`SELECT name FROM sqlite_master WHERE type='table' ORDER BY name`)
      .all()
      .map(r => r.name);

    const required = [
      'businesses', 'users', 'roles', 'dining_areas', 'tables',
      'categories', 'products', 'orders', 'order_items',
      'payments', 'printers', 'print_jobs', 'customers', 'audit_logs',
    ];

    for (const t of required) {
      expect(tables, `"${t}" tablosu eksik`).toContain(t);
    }
    db.close();
  });

  it('print_jobs tablosu idempotency_key UNIQUE constraint içeriyor', () => {
    const db = new Database(':memory:');
    applyMigrations(db);

    const info = db.prepare(`PRAGMA index_list(print_jobs)`).all();
    const hasUnique = info.some(idx => idx.unique === 1);
    expect(hasUnique).toBe(true);
    db.close();
  });

  it('print_jobs lease ve teşhis kolonlarını içeriyor', () => {
    const db = new Database(':memory:');
    applyMigrations(db);

    const cols = db.prepare(`PRAGMA table_info(print_jobs)`).all().map(c => c.name);
    expect(cols).toContain('claimed_until');
    expect(cols).toContain('attempt_count');
    expect(cols).toContain('last_attempt_at');
    expect(cols).toContain('last_error_code');
    db.close();
  });

  it('orders tablosu order_type kolonu içeriyor', () => {
    const db = new Database(':memory:');
    applyMigrations(db);

    const cols = db.prepare(`PRAGMA table_info(orders)`).all().map(c => c.name);
    expect(cols).toContain('order_type');
    db.close();
  });
});

// ── İdempotency — aynı DB üzerinde iki kez çalıştırma ────────────────────────

describe('Migrations — idempotency (iki kez çalıştırma)', () => {
  it('Mevcut DB üzerinde tekrar çalıştırma hata vermez', () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    // İkinci çalıştırma — IF NOT EXISTS olduğu için hata vermemeli
    expect(() => applyMigrations(db)).not.toThrow();
    db.close();
  });

  it('İki kez çalıştırma sonrası tablo sayısı değişmez', () => {
    const db = new Database(':memory:');
    applyMigrations(db);
    const countAfterFirst = db
      .prepare(`SELECT COUNT(*) as c FROM sqlite_master WHERE type='table'`)
      .get().c;

    applyMigrations(db);
    const countAfterSecond = db
      .prepare(`SELECT COUNT(*) as c FROM sqlite_master WHERE type='table'`)
      .get().c;

    expect(countAfterFirst).toBe(countAfterSecond);
    db.close();
  });

  it('Mevcut veri iki kez çalıştırmada silinmez', () => {
    const db = new Database(':memory:');
    applyMigrations(db);

    // Bir kayıt ekle
    db.prepare(`
      INSERT INTO businesses (id, name, is_active)
      VALUES ('biz1', 'Test Restoran', 1)
    `).run();

    // Tekrar migrate et
    applyMigrations(db);

    const row = db.prepare(`SELECT * FROM businesses WHERE id = 'biz1'`).get();
    expect(row).not.toBeNull();
    expect(row.name).toBe('Test Restoran');
    db.close();
  });
});
