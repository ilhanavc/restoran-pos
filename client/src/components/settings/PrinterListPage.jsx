import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { EllipsisVertical, Pencil, RefreshCw, TestTube2, Trash2, UserMinus, UserCheck } from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import useConfirmDialog from '../common/useConfirmDialog.js';
import SettingsDetailHeader from './SettingsDetailHeader.jsx';
import PrinterDeleteModal from './PrinterDeleteModal.jsx';
import { connectionSummary } from './printerDefaults.js';

function roleMeta(type) {
  const t = String(type || '').toLowerCase();
  if (t === 'kitchen') return { key: 'kitchen', label: 'Mutfak yazıcısı', tone: 'warning' };
  if (t === 'receipt') return { key: 'receipt', label: 'Müşteri fişi yazıcısı', tone: 'success' };
  if (t === 'bar') return { key: 'legacy', label: 'İçecek istasyonu (legacy)', tone: 'info' };
  return { key: 'legacy', label: 'Diğer yazıcı (legacy)', tone: 'info' };
}

function statusMeta(printer, discoveredSet, bridgeStatus) {
  if (!printer.is_active) {
    return {
      text: 'Pasif',
      tone: 'warning',
      detail: 'Yazıcı pasif durumda, otomatik olarak kullanılmaz.',
    };
  }

  const physicalName = String(printer?.print_options?.device?.physicalName || '').trim();
  if (!physicalName) {
    return {
      text: 'Eksik kurulum',
      tone: 'info',
      detail: 'Fiziksel cihaz seçimi tamamlanmamış.',
    };
  }

  if (printer.connection_type === 'network' && !String(printer.ip_address || '').trim()) {
    return {
      text: 'Eksik kurulum',
      tone: 'info',
      detail: 'Ağ yazıcısı için IP adresi gerekli.',
    };
  }

  if (bridgeStatus === 'down') {
    return {
      text: 'Bağlı değil / sorunlu',
      tone: 'danger',
      detail: 'Bridge bağlantısı kurulamadı, cihaz durumu doğrulanamadı.',
    };
  }

  if (discoveredSet.size > 0 && !discoveredSet.has(physicalName.toLowerCase())) {
    return {
      text: 'Bağlı değil / sorunlu',
      tone: 'danger',
      detail: 'Seçili fiziksel cihaz son taramada bulunamadı.',
    };
  }

  return {
    text: 'Hazır',
    tone: 'success',
    detail: 'Yazıcı aktif ve temel kurulum tamamlanmış.',
  };
}

function toneClassName(tone) {
  if (tone === 'success') return 'badge badge-success';
  if (tone === 'warning') return 'badge badge-warning';
  if (tone === 'danger') return 'badge badge-danger';
  return 'badge badge-info';
}

export default function PrinterListPage() {
  const navigate = useNavigate();
  const { success, error } = useToast();
  const [printers, setPrinters] = useState([]);
  const [printerConfig, setPrinterConfig] = useState({});
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [testingId, setTestingId] = useState(null);
  const [deleteTarget, setDeleteTarget] = useState(null);
  const [savingAdjRule, setSavingAdjRule] = useState(false);
  const [routeCounts, setRouteCounts] = useState({});
  const [bridgeStatus, setBridgeStatus] = useState(null);
  const [discoveredPrinters, setDiscoveredPrinters] = useState([]);
  const { confirmDialog, requestConfirm, cancelConfirm, acceptConfirm } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [settingsData, routingData, discoveredData, bridgeState] = await Promise.all([
        api.getPrinterSettings(),
        api.getAdminPrinterRouting().catch(() => ({ assignments: [] })),
        api.getDiscoveredPrinters().catch(() => ({ printers: [] })),
        api.getBridgeStatus().catch(() => null),
      ]);

      setPrinters(settingsData.printers || []);
      setPrinterConfig(settingsData.config || {});
      setBridgeStatus(bridgeState);
      setDiscoveredPrinters(Array.isArray(discoveredData.printers) ? discoveredData.printers : []);

      const counts = {};
      for (const assignment of routingData.assignments || []) {
        if (!assignment?.printer_id) continue;
        counts[assignment.printer_id] = (counts[assignment.printer_id] || 0) + 1;
      }
      setRouteCounts(counts);
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

  const refreshDiscovered = async () => {
    setRefreshing(true);
    try {
      await api.refreshDiscoveredPrinters();
      await load();
      success('Yazıcı taraması yenilendi');
    } catch (e) {
      error(e.message || 'Yazıcı taraması yenilenemedi');
    } finally {
      setRefreshing(false);
    }
  };

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

  const activate = async (p) => {
    try {
      await api.patchAdminPrinter(p.id, { is_active: true });
      success('Yazıcı aktifleştirildi');
      await load();
    } catch (e) {
      error(e.message || 'Yazıcı aktifleştirilemedi');
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
    requestConfirm({
      title: 'Yazıcı pasifleştirilsin mi?',
      body: `"${p.name}" aktif yazıcı listesinden çıkarılacak. Daha sonra tekrar aktifleştirilebilir.`,
      confirmLabel: 'Pasifleştir',
      tone: 'danger',
      onConfirm: async () => {
        try {
          await api.patchAdminPrinter(p.id, { is_active: false });
          success('Yazıcı pasifleştirildi');
          await load();
        } catch (e) {
          error(e.message || 'İşlem başarısız');
        }
      },
    });
  };

  const discoveredNameSet = useMemo(
    () =>
      new Set(
        (discoveredPrinters || [])
          .map((p) => String(p?.name || '').trim().toLowerCase())
          .filter(Boolean),
      ),
    [discoveredPrinters],
  );

  const summary = useMemo(() => {
    let active = 0;
    let kitchen = 0;
    let receipt = 0;
    let problem = 0;

    for (const printer of printers) {
      if (printer.is_active) active += 1;
      const role = roleMeta(printer.type);
      if (role.key === 'kitchen') kitchen += 1;
      if (role.key === 'receipt') receipt += 1;
      const st = statusMeta(printer, discoveredNameSet, bridgeStatus);
      if (st.text !== 'Hazır') problem += 1;
    }

    return {
      total: printers.length,
      active,
      kitchen,
      receipt,
      problem,
    };
  }, [printers, discoveredNameSet, bridgeStatus]);

  return (
    <div className="page-container">
      <SettingsDetailHeader title="Yazıcılar" onBack={handleBack} />

      <p style={{ margin: '0 0 18px', color: 'var(--text-secondary)', fontSize: 14, maxWidth: 760, lineHeight: 1.55 }}>
        Mutfak ve müşteri fişi yazıcılarınızı tek ekrandan yönetin. Burada temel durumu görür, test eder ve hızlıca
        düzenleme yaparsınız.
      </p>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(140px, 1fr))', gap: 10, marginBottom: 14 }}>
        <div className="card card-padded">
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Toplam yazıcı</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{summary.total}</div>
        </div>
        <div className="card card-padded">
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Aktif yazıcı</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{summary.active}</div>
        </div>
        <div className="card card-padded">
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Mutfak yazıcısı</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{summary.kitchen}</div>
        </div>
        <div className="card card-padded">
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Müşteri fişi yazıcısı</div>
          <div style={{ fontSize: 24, fontWeight: 700 }}>{summary.receipt}</div>
        </div>
        <div className="card card-padded">
          <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>Sorunlu / eksik</div>
          <div style={{ fontSize: 24, fontWeight: 700, color: summary.problem > 0 ? 'var(--danger)' : 'var(--success)' }}>
            {summary.problem}
          </div>
        </div>
      </div>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14, alignItems: 'center' }}>
        <Link to="new" className="btn btn-primary btn-sm">
          Yeni Yazıcı Ekle
        </Link>
        <button type="button" className="btn btn-ghost btn-sm" onClick={refreshDiscovered} disabled={refreshing || loading}>
          <RefreshCw size={15} style={{ marginRight: 4 }} />
          {refreshing ? 'Taranıyor…' : 'Yazıcıları Tara / Yenile'}
        </button>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        {loading ? (
          <div style={{ padding: 24, color: 'var(--text-muted)' }}>Yükleniyor…</div>
        ) : printers.length === 0 ? (
          <div style={{ padding: 24, color: 'var(--text-muted)' }}>Henüz yazıcı yok. Yeni yazıcı ekleyin.</div>
        ) : (
          printers.map((p, idx) => {
            const role = roleMeta(p.type);
            const physicalName = String(p?.print_options?.device?.physicalName || '').trim() || 'Seçilmemiş';
            const st = statusMeta(p, discoveredNameSet, bridgeStatus);
            const routeCount = routeCounts[p.id] || 0;

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
                  padding: 14,
                  borderBottom: idx < printers.length - 1 ? '1px solid var(--border)' : 'none',
                  cursor: 'pointer',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between', gap: 12 }}>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <span style={{ fontWeight: 700, fontSize: 15 }}>{p.name}</span>
                      <span className={toneClassName(role.tone)}>{role.label}</span>
                      <span className={toneClassName(st.tone)}>{st.text}</span>
                    </div>
                    <div style={{ marginTop: 8, color: 'var(--text-secondary)', fontSize: 13, display: 'grid', gap: 4 }}>
                      <div>
                        <strong>Fiziksel cihaz:</strong> {physicalName}
                      </div>
                      <div>
                        <strong>Bağlantı:</strong> {connectionSummary(p)}
                      </div>
                      <div>
                        <strong>Kısa bilgi:</strong>{' '}
                        {role.key === 'kitchen'
                          ? `${routeCount} kategori atanmış`
                          : role.key === 'receipt'
                            ? 'Müşteri fişi yazdırır'
                            : 'Legacy yazıcı tipi; mevcut davranış korunur'}
                      </div>
                      <div style={{ color: 'var(--text-muted)' }}>{st.detail}</div>
                    </div>
                  </div>

                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }} onClick={(e) => e.stopPropagation()}>
                    <Link to={`./${p.id}`} className="btn btn-primary btn-sm" title="Düzenle" onClick={(e) => e.stopPropagation()}>
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
                    <details>
                      <summary className="btn btn-ghost btn-sm" style={{ listStyle: 'none' }}>
                        <EllipsisVertical size={16} />
                      </summary>
                      <div
                        className="card"
                        style={{
                          marginTop: 6,
                          padding: 8,
                          minWidth: 210,
                          display: 'grid',
                          gap: 6,
                          position: 'absolute',
                          right: 24,
                          zIndex: 5,
                        }}
                      >
                        {p.is_active ? (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => deactivate(p)}>
                            <UserMinus size={15} style={{ marginRight: 4 }} />
                            Pasifleştir
                          </button>
                        ) : (
                          <button type="button" className="btn btn-ghost btn-sm" onClick={() => activate(p)}>
                            <UserCheck size={15} style={{ marginRight: 4 }} />
                            Aktifleştir
                          </button>
                        )}
                        <button
                          type="button"
                          className="btn btn-ghost btn-sm"
                          onClick={() => {
                            setDeleteTarget({ id: p.id, name: p.name, isActive: p.is_active !== false });
                          }}
                        >
                          <Trash2 size={15} style={{ marginRight: 4 }} />
                          Sil
                        </button>
                      </div>
                    </details>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>

      <div className="card card-padded" style={{ marginTop: 14 }}>
        <details>
          <summary style={{ cursor: 'pointer', fontWeight: 700, fontSize: 13 }}>Gelişmiş operasyon ayarı</summary>
          <div style={{ marginTop: 10 }}>
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
                Mutfakta henüz gönderilmemiş satırlarda da iptal/azaltma fişi basılsın (varsayılan: yalnız mutfağa giden
                satırlar).
              </span>
            </label>
          </div>
        </details>
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
      <ConfirmDialog
        open={!!confirmDialog}
        title={confirmDialog?.title}
        body={confirmDialog?.body}
        confirmLabel={confirmDialog?.confirmLabel}
        tone={confirmDialog?.tone}
        onCancel={cancelConfirm}
        onConfirm={acceptConfirm}
      />
    </div>
  );
}
