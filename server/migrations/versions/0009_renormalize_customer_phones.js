import { normalizePhoneDigits } from '../../utils/phoneNormalize.js';

export const version = '0009_renormalize_customer_phones';
export const name = 'Re-normalize customer_phones to new canonical 0XXXXXXXXXX storage format';

export function up(database) {
  const rows = database.prepare(
    `SELECT id, phone, normalized_phone FROM customer_phones`,
  ).all();
  const update = database.prepare(
    `UPDATE customer_phones SET phone = ?, normalized_phone = ? WHERE id = ?`,
  );
  const txn = database.transaction(() => {
    for (const r of rows) {
      const canonical = normalizePhoneDigits(r.phone || r.normalized_phone || '');
      if (!canonical) continue;
      if (canonical === r.phone && canonical === r.normalized_phone) continue;
      update.run(canonical, canonical, r.id);
    }
  });
  txn();
}
