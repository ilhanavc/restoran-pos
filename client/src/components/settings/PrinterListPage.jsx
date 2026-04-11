import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Pencil, Printer, TestTube2, Trash2, UserMinus } from 'lucide-react';
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

function mappingStatusLabel(p) {
  const physical = p?.print_options?.device?.physicalName;
  if (physical && String(physical).trim()) return { text: 'Eşleşti', tone: 'success' };
  return { text: 'Eşleşmedi', tone: 'muted' };
}

export default function PrinterListPage() {
  const navigate = useNavigate();
  const { success, error } = useToast();
  const [printers, setPrinters] = useState([]);
  const [printerConfig, setPrinterConfig] = useState({});
  const [loading, setLoading] = useState(true);
  const [testingId, setTestingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [savingAdjRule, setSavingAdjRule] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getPrinterSettings();
      setPrinters(data.printers || []);
      setPrinterConfig(data.config || {});
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
      success(res.message || 'Test çıktısı kuyruğa alındı');
    } catch (e) {
      error(e.message || 'Test başarısız');
    } finally {
      setTestingId(null);
    }
  };

  const toggleKitchenAdjNew = async () => {
    setSavingAdjRule(true);
    try {
      await api.patchPrinterSettings({
        kitchenAdjustmentIncludeNew: !printerConfig.kitchenAdjustmentIncludeNew,
      });
      success('Yazıcı ayarı güncellendi');
      await load();
    } catch (e) {
      error(e.message || 'Kayıt başarısız');
    } finally {
      setSavingAdjRule(false);
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

      <p style={{ margin: '0 0 18px', color: 'var(--text-secondary)', fontSize: 14, maxWidth: 760, lineHeight: 1.55 }}>
        Yazıcı envanterini yönetin, durumunu izleyin ve satır bazlı aksiyonlarla operasyonu yönetin. Test yazdırma ilgili
        yazıcı kaydı üzerinden çalıştırılır.
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
            <Link to="new" className="btn btn-primary btn-sm">
              Yeni Yazıcı Ekle
            </Link>
          </div>

          <div className="card" style={{ overflow: 'hidden' }}>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(120px,1fr) minmax(110px,1.1fr) minmax(150px,1.15fr) 110px 300px',
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
                      gridTemplateColumns: 'minmax(120px,1fr) minmax(110px,1.1fr) minmax(150px,1.15fr) 110px 300px',
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
                    <div style={{ color: 'var(--text-muted)', fontSize: 13, display: 'flex', flexDirection: 'column', gap: 4 }}>
                      <span>{connectionSummary(p)}</span>
                      <span style={{ fontSize: 12 }}>
                        Fiziksel: <strong style={{ color: 'var(--text-secondary)' }}>{mappingStatusLabel(p).text}</strong>
                      </span>
                    </div>
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
                      <Link
                        to={`./${p.id}`}
                        className="btn btn-primary btn-sm"
                        title="Düzenle"
                        onClick={(e) => e.stopPropagation()}
                        style={{ minWidth: 92 }}
                      >
                        <Pencil size={15} style={{ marginRight: 4 }} />
                        Düzenle
                      </Link>
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        title="Test çıktısı"
                        disabled={testingId === p.id}
                        onClick={() => testOne(p.id)}
                      >
                        <TestTube2 size={15} style={{ marginRight: 4 }} />
                        Test
                      </button>
                      {p.is_active ? (
                        <button type="button" className="btn btn-ghost btn-sm" title="Pasif yap" onClick={() => deactivate(p)}>
                          <UserMinus size={15} style={{ marginRight: 4 }} />
                          Pasif
                        </button>
                      ) : null}
                      <button
                        type="button"
                        className="btn btn-ghost btn-sm"
                        title="Sil"
                        onClick={(e) => {
                          e.stopPropagation();
                          setDeleteTarget({ id: p.id, name: p.name, isActive: p.is_active !== false });
                        }}
                      >
                        <Trash2 size={15} style={{ marginRight: 4 }} />
                        Sil
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
              <div style={{ fontWeight: 700, fontSize: 15 }}>Keşfet</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Kurulum ve sonraki adımlar</div>
            </div>
          </div>
          <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
            <strong style={{ color: 'var(--text-primary)' }}>1) Kurulum</strong>
            <div>Önce yazıcıyı ekleyin, sonra tipine göre ayarlarını tamamlayın.</div>
            <strong style={{ color: 'var(--text-primary)', display: 'block', marginTop: 10 }}>2) Doğrulama</strong>
            <div>IP/Port ve fiziksel eşleştirme adını kontrol edin, satırdan Test çalıştırın.</div>
            <strong style={{ color: 'var(--text-primary)', display: 'block', marginTop: 10 }}>3) Operasyon</strong>
            <div>Adisyon ve mutfak yazıcılarını ayrı rollerle yönetin.</div>
          </div>
          <div style={{ marginTop: 16, paddingTop: 16, borderTop: '1px solid var(--border)' }}>
            <div style={{ fontWeight: 700, fontSize: 13, marginBottom: 8 }}>Mutfak iptal / azaltma</div>
            <label
              style={{
                display: 'flex',
                alignItems: 'flex-start',
                gap: 10,
                fontSize: 13,
                color: 'var(--text-secondary)',
                lineHeight: 1.5,
                cursor: savingAdjRule ? 'wait' : 'pointer',
              }}
            >
              <input
                type="checkbox"
                checked={!!printerConfig.kitchenAdjustmentIncludeNew}
                disabled={savingAdjRule || loading}
                onChange={toggleKitchenAdjNew}
                style={{ marginTop: 3 }}
              />
              <span>
                Mutfağa henüz gönderilmemiş satırlarda da iptal/azaltma fişi basılsın (varsayılan: yalnız mutfağa giden
                satırlar).
              </span>
            </label>
          </div>

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
            Bulut köprü bağlandığında bu kartta cihaz keşfi ve bağlantı durumu görünecek. Bu aşamada bilinçli olarak manuel
            eşleştirme kullanılır.
          </div>
        </aside>
      </div>

      <PrinterDeleteModal
        open={!!deleteTarget}
        onClose={() => setDeleteTarget(null)}
        printerId={deleteTarget?.id}
        printerName={deleteTarget?.name}
        printerIsActive={deleteTarget?.isActive !== false}
        onAfterDeactivate={load}
        onAfterDelete={load}
      />
    </div>
  );
}
