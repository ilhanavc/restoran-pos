import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Pencil, Printer, Route, TestTube2, Trash2, UserMinus } from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import SettingsDetailHeader from './SettingsDetailHeader.jsx';
import PrinterDeleteModal from './PrinterDeleteModal.jsx';
import { connectionSummary, listTypeLabel } from './printerDefaults.js';

function statusLabel(p) {
  if (!p.is_active) return { text: 'Pasif', tone: 'warning' };
  const online = p.ip_address && String(p.ip_address).trim().length > 0;
  return online
    ? { text: 'Çevrimiçi', tone: 'success' }
    : { text: 'Yapılandırılmadı', tone: 'muted' };
}

export default function PrinterListPage() {
  const navigate = useNavigate();
  const { success, error } = useToast();
  const [printers, setPrinters] = useState([]);
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getPrinterSettings();
      setPrinters(data.printers || []);
    } catch (e) {
      error(e.message || 'Yazıcı listesi yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [error]);

  useEffect(() => {
    load();
  }, [load]);

  const handleBack = () => navigate('/settings');

  const testOne = async (printerId) => {
    setTestingId(printerId);
    try {
      const res = await api.postPrinterTest({ printer_id: printerId });
      success(res.message || 'Test tamamlandı');
    } catch (e) {
      error(e.message || 'Test başarısız');
    } finally {
      setTestingId(null);
    }
  };

  const deactivate = async (p) => {
    if (!window.confirm(`"${p.name}" pasifleştirilsin mi? Liste dışında kalır; sonra tekrar açılabilir.`)) return;
    try {
      await api.patchAdminPrinter(p.id, { is_active: false });
      success('Yazıcı pasifleştirildi');
      await load();
    } catch (e) {
      error(e.message || 'İşlem başarısız');
    }
  };

  return (
    <div className="page-container">
      <SettingsDetailHeader title="Yazıcı Ayarları" onBack={handleBack} />

      <p style={{ margin: '0 0 18px', color: 'var(--text-secondary)', fontSize: 14, maxWidth: 720 }}>
        Yazıcıları tanımlayın, rollerini ve çıktı seçeneklerini düzenleyin. Test çıktısı her yazıcının detay sayfasından, ilgili kayıt için çalıştırılır.
      </p>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 1fr) minmax(260px, 300px)',
          gap: 20,
          alignItems: 'start',
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14, alignItems: 'center' }}>
            <Link to="routing" className="btn btn-ghost btn-sm" title="Kategori bazlı yazıcı eşlemesi">
              <Route size={16} style={{ marginRight: 6, verticalAlign: 'middle' }} />
              Kategori → Yazıcı Yönlendirme
            </Link>
            <Link to="new" className="btn btn-primary btn-sm">
              Yeni Yazıcı Ekle
            </Link>
          </div>

          <div className="card" style={{ overflow: 'hidden' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(120px,1fr) minmax(100px,1.2fr) minmax(100px,1fr) 100px 240px',
                gap: 10,
                padding: '12px 16px',
                borderBottom: '1px solid var(--border)',
                fontSize: 11,
                fontWeight: 700,
                color: 'var(--text-muted)',
                textTransform: 'uppercase',
                letterSpacing: '0.04em',
              }}
            >
              <span>Yazıcı Adı</span>
              <span>Tür</span>
              <span>Bağlantı</span>
              <span>Durum</span>
              <span style={{ textAlign: 'right' }}>İşlemler</span>
            </div>
            {loading ? (
              <div style={{ padding: 24, color: 'var(--text-muted)' }}>Yükleniyor…</div>
            ) : printers.length === 0 ? (
              <div style={{ padding: 24, color: 'var(--text-muted)' }}>Henüz yazıcı yok. Yeni yazıcı ekleyin.</div>
            ) : (
              printers.map((p) => {
                const st = statusLabel(p);
                return (
                  <div
                    key={p.id}
                    role="button"
                    tabIndex={0}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') navigate(`/settings/printers/${p.id}`);
                    }}
                    onClick={() => navigate(`/settings/printers/${p.id}`)}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'minmax(120px,1fr) minmax(100px,1.2fr) minmax(100px,1fr) 100px 240px',
                      gap: 10,
                      padding: '14px 16px',
                      borderBottom: '1px solid var(--border)',
                      fontSize: 14,
                      alignItems: 'center',
                      cursor: 'pointer',
                    }}
                  >
                    <span style={{ fontWeight: 600 }}>{p.name}</span>
                    <span style={{ color: 'var(--text-secondary)', fontSize: 13 }} title={listTypeLabel(p.type)}>
                      #{listTypeLabel(p.type)}
                    </span>
                    <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{connectionSummary(p)}</span>
                    <span>
                      <span
                        className={`badge ${
                          st.tone === 'success'
                            ? 'badge-success'
                            : st.tone === 'warning'
                              ? 'badge-warning'
                              : 'badge-info'
                        }`}
                      >
                        {st.text}
                      </span>
                    </span>
                    <div
                      style={{ display: 'flex', gap: 6, justifyContent: 'flex-end', flexWrap: 'wrap' }}
                      onClick={(e) => e.stopPropagation()}
                    >
                      <Link to={`./${p.id}`} className="btn btn-ghost btn-sm" title="Düzenle" onClick={(e) => e.stopPropagation()}>
                        <Pencil size={16} />
                      </Link>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        title="Test çıktısı"
                        disabled={testingId === p.id}
                        onClick={() => testOne(p.id)}
                      >
                        <TestTube2 size={16} />
                      </button>
                      {p.is_active ? (
                        <button type="button" className="btn btn-ghost btn-sm" title="Pasif yap" onClick={() => deactivate(p)}>
                          <UserMinus size={16} />
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        title="Sil"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget({ id: p.id, name: p.name });
                        }}
                      >
                        <Trash2 size={16} />
                      </button>
                    </div>
                  </div>
                );
              })
            )}
          </div>
        </div>

        <aside className="card card-padded" style={{ position: 'sticky', top: 16 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <div
              style={{
                width: 40,
                height: 40,
                borderRadius: 8,
                background: 'var(--accent-muted, rgba(239, 68, 68, 0.2))',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
              }}
            >
              <Printer size={22} color="var(--accent, #f97316)" />
            </div>
            <div>
              <div style={{ fontWeight: 700, fontSize: 15 }}>Kurulum ipuçları</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Hızlı başlangıç</div>
            </div>
          </div>
          <ul style={{ margin: 0, paddingLeft: 18, color: 'var(--text-secondary)', fontSize: 13, lineHeight: 1.6 }}>
            <li>Yazıcıyı önce tanımlayın; ardından rollerini ve (mutfak tipinde) mutfak gruplarını seçin.</li>
            <li>Ağ yazıcılarında IP ve port (genelde 9100) doğru olmalıdır.</li>
            <li>Test çıktısı için satırdaki deney tüpüne veya yazıcı detayındaki «Test çıktısı» düğmesine gidin.</li>
          </ul>
          <div
            style={{
              marginTop: 16,
              padding: 12,
              borderRadius: 8,
              border: '1px dashed var(--border)',
              fontSize: 12,
              color: 'var(--text-muted)',
            }}
          >
            <strong style={{ color: 'var(--text-secondary)' }}>StoreBridge (yakında)</strong>
            <br />
            Bulut köprü uygulaması bağlandığında bu alanda bağlantı durumu gösterilecektir. Şimdilik yalnızca yerel ayarlar
            kullanılır.
          </div>
        </aside>
      </div>

      <PrinterDeleteModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        printerId={deleteTarget?.id}
        printerName={deleteTarget?.name}
        onAfterDeactivate={load}
        onAfterDelete={load}
      />
    </div>
  );
}
