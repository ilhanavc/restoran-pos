import { describe, it, expect } from 'vitest';
import Database from 'better-sqlite3';
import { toCents, fromCents } from '../utils/money.js';
import * as addCentsColumns from '../migrations/versions/0002_add_cents_columns.js';

describe('money utils', () => {
  it('toCents TL değerlerini kuruşa çevirir', () => {
    expect(toCents(49.90)).toBe(4990);
    expect(toCents(0.1 + 0.2)).toBe(30);
    expect(toCents(0)).toBe(0);
  });

  it('fromCents kuruş değerlerini TL değerine çevirir', () => {
    expect(fromCents(4990)).toBe(49.90);
  });
});

describe('0002_add_cents_columns migration', () => {
  it('legacy para kolonlarını backfill eder ve tekrar çalıştırılabilir', () => {
    const db = new Database(':memory:');
    db.exec(`
      CREATE TABLE orders (
        id TEXT PRIMARY KEY,
        subtotal REAL DEFAULT 0,
        discount_amount REAL DEFAULT 0,
        grand_total REAL DEFAULT 0
      );
      CREATE TABLE order_items (
        id TEXT PRIMARY KEY,
        unit_price REAL NOT NULL,
        quantity INTEGER DEFAULT 1,
        discount_amount REAL DEFAULT 0
      );
      CREATE TABLE payments (
        id TEXT PRIMARY KEY,
        amount REAL NOT NULL,
        change_amount REAL DEFAULT 0,
        tip_amount REAL DEFAULT 0
      );
      CREATE TABLE refunds (
        id TEXT PRIMARY KEY,
        amount REAL NOT NULL
      );
      CREATE TABLE products (
        id TEXT PRIMARY KEY,
        price REAL NOT NULL
      );
      CREATE TABLE product_portions (
        id TEXT PRIMARY KEY,
        price REAL NOT NULL
      );

      INSERT INTO orders (id, subtotal, discount_amount, grand_total)
      VALUES ('o1', 49.90, 5.10, 44.80);
      INSERT INTO order_items (id, unit_price, quantity, discount_amount)
      VALUES ('oi1', 12.25, 2, 0.50);
      INSERT INTO payments (id, amount, change_amount, tip_amount)
      VALUES ('p1', 44.80, 5.20, 3.00);
      INSERT INTO refunds (id, amount) VALUES ('r1', 10.50);
      INSERT INTO products (id, price) VALUES ('prod1', 49.90);
      INSERT INTO product_portions (id, price) VALUES ('pp1', 24.95);
    `);

    expect(() => addCentsColumns.up(db)).not.toThrow();
    expect(() => addCentsColumns.up(db)).not.toThrow();

    expect(db.prepare('SELECT subtotal_cents, discount_cents, grand_total_cents FROM orders WHERE id = ?').get('o1'))
      .toEqual({ subtotal_cents: 4990, discount_cents: 510, grand_total_cents: 4480 });
    expect(db.prepare('SELECT unit_price_cents, subtotal_cents FROM order_items WHERE id = ?').get('oi1'))
      .toEqual({ unit_price_cents: 1225, subtotal_cents: 2400 });
    expect(db.prepare('SELECT amount_cents, change_cents, tip_cents FROM payments WHERE id = ?').get('p1'))
      .toEqual({ amount_cents: 4480, change_cents: 520, tip_cents: 300 });
    expect(db.prepare('SELECT amount_cents FROM refunds WHERE id = ?').get('r1'))
      .toEqual({ amount_cents: 1050 });
    expect(db.prepare('SELECT price_cents FROM products WHERE id = ?').get('prod1'))
      .toEqual({ price_cents: 4990 });
    expect(db.prepare('SELECT price_cents FROM product_portions WHERE id = ?').get('pp1'))
      .toEqual({ price_cents: 2495 });

    db.close();
  });
});
