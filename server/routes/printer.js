import { Router } from 'express';
import db from '../config/database.js';
import { authenticate, businessScope } from '../middleware/auth.js';
import { genId, auditLog } from '../utils/helpers.js';

const router = Router();
router.use(authenticate, businessScope);

// Legacy / mock: aktif POS akışı artık print_jobs → StoreBridge ile yazdırır.
// Bu rotalar manuel HTTP testi, debug veya önizleme için korunur; sipariş/ödeme UI bunları çağırmaz.

// POST /api/print/receipt
router.post('/receipt', (req, res) => {
  try {
    const { order_id } = req.body;
    const order = db.prepare(`
      SELECT o.*, t.name as table_name, c.full_name as customer_name, u.full_name as user_name,
             b.name as business_name, b.phone as business_phone, b.address as business_address,
             b.receipt_header, b.receipt_footer, b.tax_id
      FROM orders o
      LEFT JOIN tables t ON o.table_id = t.id
      LEFT JOIN customers c ON o.customer_id = c.id
      LEFT JOIN users u ON o.user_id = u.id
      JOIN businesses b ON o.business_id = b.id
      WHERE o.id = ? AND o.business_id = ?
    `).get(order_id, req.businessId);

    if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });

    order.items = db.prepare(`SELECT * FROM order_items WHERE order_id = ? AND status != 'cancelled'`).all(order_id);
    order.payments = db.prepare('SELECT * FROM payments WHERE order_id = ?').all(order_id);

    // Build receipt data (mock print)
    const receiptData = buildReceiptData(order);
    
    auditLog(req.businessId, req.user.id, 'print_receipt', 'order', order_id);
    
    // In production, this would send to ESC/POS printer
    console.log('🖨️  [MOCK] Fiş yazdırılıyor:', order_id);
    
    res.json({ success: true, receiptData, message: 'Fiş yazdırma komutu gönderildi (mock)' });
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

// POST /api/print/kitchen
router.post('/kitchen', (req, res) => {
  try {
    const { order_id } = req.body;
    const order = db.prepare(`
      SELECT o.*, t.name as table_name FROM orders o
      LEFT JOIN tables t ON o.table_id = t.id
      WHERE o.id = ? AND o.business_id = ?
    `).get(order_id, req.businessId);

    if (!order) return res.status(404).json({ error: 'Sipariş bulunamadı' });

    const items = db.prepare(`
      SELECT oi.*, p.printer_target, c.printer_target as category_printer_target
      FROM order_items oi
      JOIN products p ON oi.product_id = p.id
      JOIN categories c ON p.category_id = c.id
      WHERE oi.order_id = ? AND oi.status = 'new'
    `).all(order_id);

    // Group by printer target
    const kitchenItems = items.filter(i => (i.printer_target || i.category_printer_target) !== 'bar');
    const barItems = items.filter(i => (i.printer_target || i.category_printer_target) === 'bar');

    auditLog(req.businessId, req.user.id, 'print_kitchen', 'order', order_id);

    console.log('🖨️  [MOCK] Muıtfak fişi:', kitchenItems.length, 'ürün');
    if (barItems.length) console.log('🖨️  [MOCK] Bar fişi:', barItems.length, 'ürün');

    res.json({ 
      success: true, 
      kitchenItems: kitchenItems.length,
      barItems: barItems.length,
      message: 'Muıtfak fişi gönderildi (mock)' 
    });
  } catch (err) {
    res.status(500).json({ error: 'Sunucu hatası' });
  }
});

function buildReceiptData(order) {
  const lines = [];
  lines.push({ type: 'header', text: order.receipt_header || order.business_name });
  lines.push({ type: 'text', text: order.business_address || '' });
  lines.push({ type: 'text', text: order.business_phone || '' });
  if (order.tax_id) lines.push({ type: 'text', text: `VKN: ${order.tax_id}` });
  lines.push({ type: 'separator' });
  lines.push({ type: 'text', text: `Tarih: ${new Date(order.created_at).toLocaleString('tr-TR')}` });
  lines.push({ type: 'text', text: `Sipariş No: ${order.order_no}` });
  if (order.table_name) lines.push({ type: 'text', text: `Masa: ${order.table_name}` });
  if (order.customer_name) lines.push({ type: 'text', text: `Müşteri: ${order.customer_name}` });
  lines.push({ type: 'text', text: `Garson: ${order.user_name || '-'}` });
  lines.push({ type: 'separator' });
  
  for (const item of order.items) {
    let modifiers = [];
    try {
      const parsed = JSON.parse(item.modifiers || '[]');
      modifiers = Array.isArray(parsed) ? parsed : [];
    } catch {
      modifiers = [];
    }
    const modStr = modifiers.length ? ` (${modifiers.map(m => m.name || '').filter(Boolean).join(', ')})` : '';
    lines.push({ 
      type: 'item', 
      name: `${item.product_name}${modStr}`, 
      qty: item.quantity, 
      price: item.unit_price * item.quantity,
      comped: item.is_comped
    });
  }
  
  lines.push({ type: 'separator' });
  lines.push({ type: 'total', label: 'Ara toplam', amount: order.subtotal });
  if (order.discount_amount > 0) lines.push({ type: 'total', label: 'İndirim', amount: -order.discount_amount });
  lines.push({ type: 'grand_total', label: 'TOPLAM', amount: order.grand_total });
  
  if (order.payments?.length) {
    lines.push({ type: 'separator' });
    for (const p of order.payments) {
      const typeLabel = { cash: 'Nakit', card: 'Kart', mixed: 'Karışık', other: 'Diğer' }[p.payment_type] || p.payment_type;
      lines.push({ type: 'payment', label: typeLabel, amount: p.amount });
      if (p.change_amount > 0) lines.push({ type: 'payment', label: 'Para Üstü', amount: p.change_amount });
    }
  }
  
  lines.push({ type: 'separator' });
  lines.push({ type: 'footer', text: order.receipt_footer || 'Teşekkürler!' });
  
  return lines;
}

export default router;
