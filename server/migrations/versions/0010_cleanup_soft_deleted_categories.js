export const version = '0010_cleanup_soft_deleted_categories';
export const name = 'Hard-delete previously soft-deleted (is_active=0) categories and their products';

export function up(database) {
  const txn = database.transaction(() => {
    // Soft-delete ile pasife alınmış kategorilere ait ürün ID'lerini topla
    const productIds = database.prepare(
      `SELECT id FROM products WHERE category_id IN (
         SELECT id FROM categories WHERE is_active = 0
       )`,
    ).all().map((p) => p.id);

    if (productIds.length > 0) {
      const ph = productIds.map(() => '?').join(',');
      database.prepare(`DELETE FROM product_modifiers WHERE product_id IN (${ph})`).run(...productIds);
      database.prepare(`DELETE FROM product_combos WHERE parent_product_id IN (${ph}) OR child_product_id IN (${ph})`).run(...productIds, ...productIds);
    }

    // Yazıcı yönlendirmesindeki pasif kategori referanslarını temizle
    database.prepare(`UPDATE printer_routing SET category_id = NULL WHERE category_id IN (
      SELECT id FROM categories WHERE is_active = 0
    )`).run();

    // Pasif ürünleri sil (product_portions, product_attribute_groups CASCADE ile silinir)
    database.prepare(`DELETE FROM products WHERE category_id IN (
      SELECT id FROM categories WHERE is_active = 0
    )`).run();

    // Pasif kategorileri sil (category_attribute_groups CASCADE ile silinir)
    database.prepare(`DELETE FROM categories WHERE is_active = 0`).run();
  });
  txn();
}
