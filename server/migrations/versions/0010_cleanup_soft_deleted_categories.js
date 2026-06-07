export const version = '0010_cleanup_soft_deleted_categories';
export const name = 'Hard-delete soft-deleted (is_active=0) categories whose products have no order history';

// Güvenli temizleme: `order_items.product_id` FK'si CASCADE değil, bu yüzden
// sipariş geçmişi olan ürünler silinemez. Böyle ürünlere sahip pasif kategoriler
// `is_active=0` olarak kalır (tarihsel referans korunur); geri kalan "gerçekten
// orphan" pasif kategoriler + ürünleri hard-delete edilir.
export function up(database) {
  const txn = database.transaction(() => {
    // Silinebilir pasif kategori ID'leri: hiçbir ürünü order_items'da referanslı olmayanlar
    const deletableCategoryIds = database.prepare(
      `SELECT id FROM categories
         WHERE is_active = 0
           AND id NOT IN (
             SELECT DISTINCT p.category_id
               FROM products p
               JOIN order_items oi ON oi.product_id = p.id
              WHERE p.category_id IS NOT NULL
           )`,
    ).all().map((c) => c.id);

    if (deletableCategoryIds.length === 0) {
      return;
    }

    const catPh = deletableCategoryIds.map(() => '?').join(',');

    // Silinecek kategorilerin ürün ID'lerini topla
    const productIds = database
      .prepare(`SELECT id FROM products WHERE category_id IN (${catPh})`)
      .all(...deletableCategoryIds)
      .map((p) => p.id);

    if (productIds.length > 0) {
      const ph = productIds.map(() => '?').join(',');
      database.prepare(`DELETE FROM product_modifiers WHERE product_id IN (${ph})`).run(...productIds);
      database.prepare(`DELETE FROM product_combos WHERE parent_product_id IN (${ph}) OR child_product_id IN (${ph})`).run(...productIds, ...productIds);
    }

    // Yazıcı yönlendirmesindeki hedef kategori referanslarını temizle
    database
      .prepare(`UPDATE printer_routing SET category_id = NULL WHERE category_id IN (${catPh})`)
      .run(...deletableCategoryIds);

    // Ürünleri sil (product_portions, product_attribute_groups CASCADE ile silinir)
    database
      .prepare(`DELETE FROM products WHERE category_id IN (${catPh})`)
      .run(...deletableCategoryIds);

    // Kategorileri sil (category_attribute_groups CASCADE ile silinir)
    database
      .prepare(`DELETE FROM categories WHERE id IN (${catPh})`)
      .run(...deletableCategoryIds);
  });
  txn();
}
