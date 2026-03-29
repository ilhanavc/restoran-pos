import { Router } from 'express';
import db from '../config/database.js';
import { authenticate, businessScope } from '../middleware/auth.js';
import { genId, normalizePhone } from '../utils/helpers.js';
import { normalizePhoneDigits } from '../utils/phoneNormalize.js';

const router = Router();
router.use(authenticate, businessScope);

// GET /api/customers
router.get('/', (req, res) => {
  try {
    const { search, phone } = req.query;
    let customers = [];
    
    if (phone) {
      const normalized = normalizePhoneDigits(phone);
      const phoneResults = normalized
        ? db.prepare(`
        SELECT c.* FROM customers c
        JOIN customer_phones cp ON c.id = cp.customer_id
        WHERE c.business_id = ? AND (
          cp.normalized_phone = ?
          OR cp.phone LIKE ?
          OR cp.phone LIKE ?
        )
        ORDER BY c.full_name
      `).all(req.businessId, normalized, `%${phone}%`, `%${normalized}%`)
        : db.prepare(`
        SELECT c.* FROM customers c
        JOIN customer_phones cp ON c.id = cp.customer_id
        WHERE c.business_id = ? AND cp.phone LIKE ?
        ORDER BY c.full_name
      `).all(req.businessId, `%${phone}%`);

      // Deduplicate
      const seen = new Set();
      for (const r of phoneResults) {
        if (seen.has(r.id)) continue;
        seen.add(r.id);
        customers.push(r);
      }
    } else {
      let sql = 'SELECT * FROM customers WHERE business_id = ?';
      const params = [req.businessId];
      if (search) { sql += ' AND full_name LIKE ?'; params.push(`%${search}%`); }
      sql += ' ORDER BY full_name LIMIT 50';
      customers = db.prepare(sql).all(...params);
    }

    // Fix N+1 queries by fetching all relations at once
    const customerIds = customers.map(c => c.id);
    if (customerIds.length > 0) {
      const placeholders = customerIds.map(() => '?').join(',');
      const allPhones = db.prepare(`SELECT * FROM customer_phones WHERE customer_id IN (${placeholders})`).all(...customerIds);
      const allAddresses = db.prepare(`SELECT * FROM customer_addresses WHERE customer_id IN (${placeholders})`).all(...customerIds);
      
      const phoneMap = {};
      const addressMap = {};
      for (const p of allPhones) {
        if (!phoneMap[p.customer_id]) phoneMap[p.customer_id] = [];
        phoneMap[p.customer_id].push(p);
      }
      for (const a of allAddresses) {
        if (!addressMap[a.customer_id]) addressMap[a.customer_id] = [];
        addressMap[a.customer_id].push(a);
      }
      
      for (const c of customers) {
        c.phones = phoneMap[c.id] || [];
        c.addresses = addressMap[c.id] || [];
      }
    }

    res.json(customers);
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// GET /api/customers/:id
router.get('/:id', (req, res) => {
  try {
    const customer = db.prepare('SELECT * FROM customers WHERE id = ? AND business_id = ?').get(req.params.id, req.businessId);
    if (!customer) return res.status(404).json({ error: 'Müşteri bulunamadı' });
    
    customer.phones = db.prepare('SELECT * FROM customer_phones WHERE customer_id = ?').all(customer.id);
    customer.addresses = db.prepare('SELECT * FROM customer_addresses WHERE customer_id = ?').all(customer.id);
    customer.recentOrders = db.prepare(`
      SELECT o.*, GROUP_CONCAT(oi.product_name || ' x' || oi.quantity, ', ') as items_summary
      FROM orders o 
      LEFT JOIN order_items oi ON o.id = oi.order_id
      WHERE o.customer_id = ? AND o.business_id = ?
      GROUP BY o.id
      ORDER BY o.created_at DESC LIMIT 10
    `).all(customer.id, req.businessId);
    
    res.json(customer);
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/customers
router.post('/', (req, res) => {
  try {
    const { full_name, phone, address, address_title, address_note, note } = req.body;
    if (!full_name) return res.status(400).json({ error: 'Müşteri adı gerekli' });

    const customerId = genId();
    const txn = db.transaction(() => {
      db.prepare('INSERT INTO customers (id, business_id, full_name, note) VALUES (?, ?, ?, ?)')
        .run(customerId, req.businessId, full_name, note || null);

      if (phone) {
        const digits = normalizePhoneDigits(phone);
        const stored = digits || normalizePhone(phone);
        db.prepare(
          'INSERT INTO customer_phones (id, customer_id, phone, is_primary, normalized_phone) VALUES (?, ?, ?, 1, ?)',
        ).run(genId(), customerId, stored, digits || stored);
      }
      if (address) {
        db.prepare('INSERT INTO customer_addresses (id, customer_id, title, address, address_note, is_default) VALUES (?, ?, ?, ?, ?, 1)')
          .run(genId(), customerId, address_title || 'Ev', address, address_note || null);
      }
    });
    txn();

    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(customerId);
    customer.phones = db.prepare('SELECT * FROM customer_phones WHERE customer_id = ?').all(customerId);
    customer.addresses = db.prepare('SELECT * FROM customer_addresses WHERE customer_id = ?').all(customerId);
    res.status(201).json(customer);
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// PATCH /api/customers/:id
router.patch('/:id', (req, res) => {
  try {
    const { full_name, note } = req.body;
    db.prepare("UPDATE customers SET full_name = COALESCE(?, full_name), note = COALESCE(?, note), updated_at = datetime('now') WHERE id = ? AND business_id = ?")
      .run(full_name, note, req.params.id, req.businessId);
    
    const customer = db.prepare('SELECT * FROM customers WHERE id = ?').get(req.params.id);
    customer.phones = db.prepare('SELECT * FROM customer_phones WHERE customer_id = ?').all(customer.id);
    customer.addresses = db.prepare('SELECT * FROM customer_addresses WHERE customer_id = ?').all(customer.id);
    res.json(customer);
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/customers/:id/phones
router.post('/:id/phones', (req, res) => {
  try {
    const { phone } = req.body;
    const digits = normalizePhoneDigits(phone);
    const stored = digits || normalizePhone(phone);
    db.prepare(
      'INSERT INTO customer_phones (id, customer_id, phone, normalized_phone) VALUES (?, ?, ?, ?)',
    ).run(genId(), req.params.id, stored, digits || stored);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/customers/:id/addresses
router.post('/:id/addresses', (req, res) => {
  try {
    const { title, address, address_note } = req.body;
    db.prepare('INSERT INTO customer_addresses (id, customer_id, title, address, address_note) VALUES (?, ?, ?, ?, ?)')
      .run(genId(), req.params.id, title || 'Diğer', address, address_note || null);
    res.json({ success: true });
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

export default router;
