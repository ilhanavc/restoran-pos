/**
 * Bölge içindeki masalar arasında sıraya göre "Masa 1", "Masa 2" etiketi.
 */
export function masaLabelInArea(table, areaTables) {
  if (!table) return 'Masa';
  if (!areaTables?.length) return table.name ? String(table.name) : 'Masa';
  const sorted = [...areaTables].sort((a, b) => {
    const so = (a.sort_order ?? 0) - (b.sort_order ?? 0);
    if (so !== 0) return so;
    return String(a.name || '').localeCompare(String(b.name || ''), 'tr');
  });
  const idx = sorted.findIndex((t) => t.id === table.id);
  if (idx < 0) return table.name ? String(table.name) : 'Masa';
  return `Masa ${idx + 1}`;
}
