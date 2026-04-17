import { useState, useEffect } from 'react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDateTime } from '../../constants/index.js';
import { Users, Search, Phone, X, FileUp, Download } from 'lucide-react';

export default function CustomersScreen() {
  const [customers, setCustomers] = useState([]);
  const [customerTotal, setCustomerTotal] = useState(0);
  const [customerPage, setCustomerPage] = useState(1);
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [loading, setLoading] = useState(true);
  const [importOpen, setImportOpen] = useState(false);
  const [importRows, setImportRows] = useState([]);
  const [importFileName, setImportFileName] = useState('');
  const [importLoading, setImportLoading] = useState(false);
  const [exportLoading, setExportLoading] = useState(false);
  const [exportOpen, setExportOpen] = useState(false);
  const [importPreview, setImportPreview] = useState(null);
  const [_importPage, setImportPage] = useState(1);
  const [importPageSize, setImportPageSize] = useState(250);
  const [customerStats, setCustomerStats] = useState(null);
  const [statsLoading, setStatsLoading] = useState(false);
  const toast = useToast();

  useEffect(() => { loadCustomers(); }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount-only; loadCustomers is not memoized

  const loadCustomers = async (params = {}, append = false) => {
    try {
      const data = await api.getCustomers(params);
      const list = data.customers ?? data; // geriye dönük uyumluluk
      if (append) {
        setCustomers(prev => [...prev, ...list]);
      } else {
        setCustomers(list);
        setCustomerPage(data.page ?? 1);
      }
      setCustomerTotal(data.total ?? list.length);
      setHasMore(data.has_more ?? false);
    } catch {
      toast.error('Müşteriler yüklenemedi');
    } finally {
      setLoading(false);
      setLoadingMore(false);
    }
  };

  const handleLoadMore = () => {
    const nextPage = customerPage + 1;
    setCustomerPage(nextPage);
    setLoadingMore(true);
    loadCustomers({ page: nextPage }, true);
  };

  const handleSearch = (q) => {
    setSearchQuery(q);
    setCustomerPage(1);
    setHasMore(false);
    if (q.length >= 2) {
      const isPhone = /\d/.test(q);
      loadCustomers(isPhone ? { phone: q } : { search: q });
    } else if (q === '') {
      loadCustomers();
    }
  };

  const viewCustomer = async (id) => {
    try {
      const detail = await api.getCustomer(id);
      setSelectedCustomer(detail);
      setCustomerStats(null);
      // Load stats in background
      setStatsLoading(true);
      api.getCustomerStats(id)
        .then(stats => setCustomerStats(stats))
        .catch(() => {})
        .finally(() => setStatsLoading(false));
    } catch {
      toast.error('Müşteri bilgisi yüklenemedi');
    }
  };

  const handleFilePick = async (file) => {
    if (!file) return;
    setImportLoading(true);
    setImportPreview(null);
    setImportPage(1);
    try {
      const XLSX = await import('xlsx');
      const buf = await file.arrayBuffer();
      const wb = XLSX.read(buf, { type: 'array' });
      const firstSheet = wb.Sheets[wb.SheetNames[0]];
      const rows = XLSX.utils.sheet_to_json(firstSheet, { defval: '' });
      if (!rows.length) {
        toast.error('Dosyada aktarılacak satır bulunamadı');
        setImportRows([]);
        return;
      }
      setImportRows(rows);
      setImportFileName(file.name);
      toast.success(`${rows.length} satır yüklendi`);
    } catch {
      toast.error('Dosya okunamadı (xlsx/csv)');
      setImportRows([]);
      setImportFileName('');
    } finally {
      setImportLoading(false);
    }
  };

  const handlePreviewImport = async () => {
    if (!importRows.length) {
      toast.error('Önce bir dosya seçin');
      return;
    }
    setImportLoading(true);
    try {
      const preview = await api.previewCustomerImport({
        rows: importRows,
        page: 1,
        page_size: importPageSize,
      });
      setImportPreview(preview);
      setImportPage(preview.page || 1);
      toast.success('Önizleme hazır');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setImportLoading(false);
    }
  };

  const loadPreviewPage = async (nextPage, nextPageSize = importPageSize) => {
    if (!importPreview?.preview_token) return;
    setImportLoading(true);
    try {
      const preview = await api.previewCustomerImport({
        preview_token: importPreview.preview_token,
        page: nextPage,
        page_size: nextPageSize,
      });
      setImportPreview((prev) => ({ ...prev, ...preview }));
      setImportPage(preview.page || nextPage);
      setImportPageSize(preview.page_size || nextPageSize);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setImportLoading(false);
    }
  };

  const handleCommitImport = async () => {
    if (!importPreview?.preview_token) {
      toast.error('Önce önizleme alın');
      return;
    }
    setImportLoading(true);
    try {
      const result = await api.commitCustomerImport(importPreview.preview_token);
      toast.success(`Aktarım tamamlandı: +${result.inserted} yeni, ${result.updated} güncellendi`);
      setImportOpen(false);
      setImportRows([]);
      setImportFileName('');
      setImportPreview(null);
      setImportPage(1);
      loadCustomers();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setImportLoading(false);
    }
  };

  const exportFileNameBase = () => {
    const now = new Date();
    const p2 = (n) => String(n).padStart(2, '0');
    return `Müşteriler_${now.getFullYear()}${p2(now.getMonth() + 1)}${p2(now.getDate())}_${p2(now.getHours())}${p2(now.getMinutes())}`;
  };

  const downloadBlob = (blob, filename) => {
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };

  const toCsv = (rows) => {
    if (!rows?.length) return '';
    const headers = Object.keys(rows[0]);
    const esc = (v) => {
      const s = v == null ? '' : String(v);
      const e = s.replace(/"/g, '""');
      return /[",\n;]/.test(e) ? `"${e}"` : e;
    };
    const lines = [headers.join(',')];
    for (const row of rows) {
      lines.push(headers.map((h) => esc(row[h])).join(','));
    }
    return lines.join('\n');
  };

  const handleExport = async (format) => {
    setExportLoading(true);
    try {
      const rows = await api.getCustomersExport();
      if (!Array.isArray(rows) || rows.length === 0) {
        toast.error('Dışa aktarılacak müşteri bulunamadı');
        return;
      }
      const base = exportFileNameBase();
      if (format === 'xlsx') {
        const XLSX = await import('xlsx');
        const ws = XLSX.utils.json_to_sheet(rows);
        const wb = XLSX.utils.book_new();
        XLSX.utils.book_append_sheet(wb, ws, 'data');
        const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
        downloadBlob(
          new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
          `${base}.xlsx`,
        );
      } else {
        const csv = toCsv(rows);
        downloadBlob(new Blob([`\uFEFF${csv}`], { type: 'text/csv;charset=utf-8;' }), `${base}.csv`);
      }
      setExportOpen(false);
      toast.success(`Dışa aktarıldı (${rows.length} müşteri)`);
    } catch (err) {
      toast.error(err.message || 'Dışa aktarma başarısız');
    } finally {
      setExportLoading(false);
    }
  };

  return (
    <div className="page-container page-container--flush" style={{ display: 'flex', height: '100%' }}>
      {/* List */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div className="page-top-safe" style={{ borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div className="page-header" style={{ marginBottom: 10 }}>
            <div className="page-header-main page-title-line">
              <h1 className="page-title" style={{ fontSize: 20 }}>
                <Users size={20} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />
                Müşteriler
              </h1>
            </div>
            <div className="page-header-actions">
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setExportOpen(true)}>
                <Download size={14} />
                Dışa Aktar
              </button>
              <button type="button" className="btn btn-ghost btn-sm" onClick={() => setImportOpen(true)}>
                <FileUp size={14} />
                Excel'den İçe Aktar
              </button>
            </div>
          </div>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input className="input" placeholder="Ad veya telefon ile ara..."
              value={searchQuery} onChange={e => handleSearch(e.target.value)}
              style={{ paddingLeft: 34 }} />
          </div>
        </div>

        <div className="page-scroll-safe" style={{ flex: 1, overflow: 'auto' }}>
          {customers.map(cust => (
            <div key={cust.id} className="card card-padded" style={{ marginBottom: 8, cursor: 'pointer' }}
              onClick={() => viewCustomer(cust.id)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 'var(--radius-sm)',
                  background: 'var(--accent-muted)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, fontWeight: 800, color: 'var(--accent)', flexShrink: 0,
                }}>
                  {cust.full_name?.charAt(0)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{cust.full_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {cust.phones?.map(p => p.phone).join(' • ')}
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-muted)' }}>
                  {cust.total_orders || 0} sipariş
                </div>
              </div>
            </div>
          ))}
          {customers.length === 0 && !loading && (
            <div className="empty-state">
              <Users size={32} className="empty-state-icon" />
              <div className="empty-state-text">Müşteri bulunamadı</div>
            </div>
          )}
          {hasMore && (
            <div style={{ textAlign: 'center', padding: '12px 0' }}>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={handleLoadMore}
                disabled={loadingMore}
              >
                {loadingMore ? 'Yükleniyor...' : `Daha fazla göster (${customers.length} / ${customerTotal})`}
              </button>
            </div>
          )}
        </div>
      </div>

      {/* Detail */}
      {selectedCustomer && (
        <div style={{ width: 380, borderLeft: '1px solid var(--border)', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 15, fontWeight: 700 }}>Müşteri Detayı</h2>
            <button className="btn btn-ghost btn-icon" onClick={() => setSelectedCustomer(null)}><X size={16} /></button>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{
                width: 56, height: 56, borderRadius: 'var(--radius-md)',
                background: 'var(--accent-muted)', display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center',
                fontSize: 22, fontWeight: 800, color: 'var(--accent)', marginBottom: 8,
              }}>
                {selectedCustomer.full_name?.charAt(0)}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{selectedCustomer.full_name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selectedCustomer.total_orders || 0} sipariş</div>
            </div>

            {/* Phones */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Telefon</div>
              {selectedCustomer.phones?.map(p => (
                <div key={p.id} style={{ fontSize: 13, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Phone size={12} color="var(--text-muted)" /> {p.phone}
                </div>
              ))}
            </div>

            {/* Addresses */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Adresler</div>
              {selectedCustomer.addresses?.map(addr => (
                <div key={addr.id} style={{ fontSize: 12, marginBottom: 6, padding: '8px 10px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--text-muted)' }}>{addr.title}</div>
                  <div>{addr.address}</div>
                </div>
              ))}
            </div>

            {/* Note */}
            {selectedCustomer.note && (
              <div style={{ fontSize: 12, padding: '8px 10px', background: 'var(--warning-muted)', borderRadius: 'var(--radius-sm)', marginBottom: 16 }}>
                📝 {selectedCustomer.note}
              </div>
            )}

            {/* 360 İstatistikler */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>360° Profil</div>
              {statsLoading ? (
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Yükleniyor…</div>
              ) : customerStats ? (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                    <div style={{ background: 'var(--bg-tertiary)', borderRadius: 8, padding: '8px 10px' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Toplam harcama</div>
                      <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)' }}>{formatCurrency(customerStats.total_spend)}</div>
                    </div>
                    <div style={{ background: 'var(--bg-tertiary)', borderRadius: 8, padding: '8px 10px' }}>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 2 }}>Sipariş sayısı</div>
                      <div style={{ fontSize: 14, fontWeight: 700 }}>{customerStats.order_count}</div>
                    </div>
                  </div>
                  {customerStats.last_visit && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      Son ziyaret: <strong>{formatDateTime(customerStats.last_visit)}</strong>
                    </div>
                  )}
                  {customerStats.favorite_products?.length > 0 && (
                    <div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', marginBottom: 4 }}>Favori ürünler</div>
                      {customerStats.favorite_products.map((fp, i) => (
                        <div key={i} style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, padding: '3px 0', borderBottom: '1px solid var(--border)' }}>
                          <span>{fp.product_name}</span>
                          <span style={{ color: 'var(--text-muted)' }}>{fp.total_qty}x</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              ) : null}
            </div>

            {/* Recent Orders */}
            {selectedCustomer.recentOrders?.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Son Siparişler</div>
                {selectedCustomer.recentOrders.map(order => (
                  <div key={order.id} style={{
                    padding: '8px 10px', background: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-sm)', marginBottom: 6, fontSize: 12,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 600 }}>#{order.order_no}</span>
                      <span style={{ fontWeight: 700 }}>{formatCurrency(order.grand_total)}</span>
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 2 }}>
                      {order.items_summary?.substring(0, 50)}
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>{formatDateTime(order.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}

      {importOpen && (
        <div className="modal-overlay" onClick={() => !importLoading && setImportOpen(false)}>
          <div className="modal modal-md" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Müşteri İçe Aktar (Excel)</h2>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => !importLoading && setImportOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
                <input
                  type="file"
                  accept=".xlsx,.xls,.csv"
                  onChange={(e) => handleFilePick(e.target.files?.[0])}
                  disabled={importLoading}
                />
                {importFileName && (
                  <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                    Dosya: <strong>{importFileName}</strong> ({importRows.length} satır)
                  </div>
                )}
                {!importPreview && (
                  <button type="button" className="btn btn-primary" onClick={handlePreviewImport} disabled={importLoading || !importRows.length}>
                    {importLoading ? 'Hazırlanıyor...' : 'Önizleme Oluştur'}
                  </button>
                )}
                {importPreview && (
                  <div className="card card-padded" style={{ fontSize: 13 }}>
                    <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 6 }}>
                      <div>Eklenecek: <strong>{importPreview.insert_count}</strong></div>
                      <div>Güncellenecek: <strong>{importPreview.update_count}</strong></div>
                      <div>Atlanacak: <strong>{importPreview.skip_count}</strong></div>
                      <div>Hata: <strong>{importPreview.error_count}</strong></div>
                    </div>
                    <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                      Gösterilen: {importPreview.rows?.length || 0} · Toplam: {importPreview.total_rows} · Sayfa {importPreview.page}/{importPreview.total_pages}
                    </div>
                    <div style={{ marginTop: 10, display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={importLoading || (importPreview.page || 1) <= 1}
                        onClick={() => loadPreviewPage((importPreview.page || 1) - 1)}
                      >
                        Önceki
                      </button>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        disabled={importLoading || (importPreview.page || 1) >= (importPreview.total_pages || 1)}
                        onClick={() => loadPreviewPage((importPreview.page || 1) + 1)}
                      >
                        Sonraki
                      </button>
                      <select
                        className="input"
                        style={{ width: 120, minHeight: 32, padding: '4px 8px' }}
                        value={importPageSize}
                        onChange={(e) => {
                          const size = parseInt(e.target.value, 10) || 250;
                          setImportPageSize(size);
                          if (importPreview?.preview_token) loadPreviewPage(1, size);
                        }}
                        disabled={importLoading}
                      >
                        <option value={250}>250 / sayfa</option>
                        <option value={500}>500 / sayfa</option>
                      </select>
                    </div>
                    <div style={{ marginTop: 10, maxHeight: 180, overflow: 'auto', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)' }}>
                      {(importPreview.rows || []).map((r) => (
                        <div key={r.row_number} style={{ padding: '6px 8px', borderBottom: '1px solid var(--border)', fontSize: 12, display: 'flex', gap: 8, alignItems: 'center' }}>
                          <span style={{ width: 52, color: 'var(--text-muted)' }}>Satır {r.row_number}</span>
                          <span className={`badge ${r.action === 'insert' ? 'badge-success' : r.action === 'update' ? 'badge-info' : 'badge-warning'}`}>
                            {r.action}
                          </span>
                          {r.normalized?.full_name && <span style={{ flex: 1, minWidth: 0 }} className="truncate">{r.normalized.full_name}</span>}
                          {Array.isArray(r.issues) && r.issues.length > 0 && (
                            <span style={{ color: 'var(--warning)', fontSize: 11 }}>
                              {r.issues[0].message}
                            </span>
                          )}
                        </div>
                      ))}
                    </div>
                  </div>
                )}
              </div>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setImportOpen(false)} disabled={importLoading}>Kapat</button>
              {importPreview && (
                <button type="button" className="btn btn-success" onClick={handleCommitImport} disabled={importLoading}>
                  {importLoading ? 'Aktarılıyor...' : 'İçe Aktar'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      {exportOpen && (
        <div className="modal-overlay" onClick={() => !exportLoading && setExportOpen(false)}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Müşteri Dışa Aktar</h2>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => !exportLoading && setExportOpen(false)}>
                <X size={16} />
              </button>
            </div>
            <div className="modal-body" style={{ display: 'flex', gap: 8, flexDirection: 'column' }}>
              <button type="button" className="btn btn-primary" onClick={() => handleExport('xlsx')} disabled={exportLoading}>
                {exportLoading ? 'Hazırlanıyor...' : 'Excel (.xlsx) indir'}
              </button>
              <button type="button" className="btn btn-ghost" onClick={() => handleExport('csv')} disabled={exportLoading}>
                {exportLoading ? 'Hazırlanıyor...' : 'CSV indir'}
              </button>
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setExportOpen(false)} disabled={exportLoading}>Kapat</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
