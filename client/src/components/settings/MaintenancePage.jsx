import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, DatabaseBackup, Download, FolderSync, RefreshCw, RotateCcw, ShieldAlert, Upload } from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import SettingsDetailHeader from './SettingsDetailHeader.jsx';
import { formatDateInIstanbul, formatDateTimeInIstanbul } from '../../utils/time.js';

function formatBytes(value) {
  const n = Number(value) || 0;
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

function backupKindLabel(kind) {
  if (kind === 'manual') return 'Manuel';
  if (kind === 'safety') return 'Restore öncesi';
  return 'Otomatik';
}

const HAS_SCHEDULER = !!window.electronAPI?.schedulerSave;

export default function MaintenancePage() {
  const navigate = useNavigate();
  const { success, error, warning } = useToast();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  // restoreStep: null | { backup, step: 1|2, openCount }
  const [restoreStep, setRestoreStep] = useState(null);
  // Görev Zamanlayıcı durumu
  const [scheduler, setScheduler] = useState(null);   // { destFolder, taskName, createdAt } | null
  const [schedulerWorking, setSchedulerWorking] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setStatus(await api.getMaintenanceStatus());
    } catch (e) {
      error(e.message || 'Bakım durumu alınamadı');
    } finally {
      setLoading(false);
    }
  }, [error]);

  // Görev Zamanlayıcı yapılandırmasını yükle
  const loadScheduler = useCallback(async () => {
    if (!HAS_SCHEDULER) return;
    try {
      const cfg = await window.electronAPI.schedulerConfig();
      setScheduler(cfg);
    } catch { /* ignore */ }
  }, []);

  useEffect(() => { load(); }, [load]);
  useEffect(() => { loadScheduler(); }, [loadScheduler]);

  // Disk alanı uyarısı dinleyicisi
  useEffect(() => {
    if (!window.electronAPI?.onBackupDiskWarning) return;
    return window.electronAPI.onBackupDiskWarning((info) => {
      warning(info.message || 'Disk alanı yetersiz, yedekleme başarısız olabilir');
    });
  }, [warning]);

  const backups = useMemo(() => status?.backups || [], [status]);
  const latest = status?.latest || null;
  const pendingRestore = status?.pendingRestore || null;

  // Son yedek 2 günden eskiyse uyarı göster
  const backupStale = useMemo(() => {
    if (!status) return false;
    if (!latest) return true;
    const ageMs = Date.now() - new Date(latest.modified_at).getTime();
    return ageMs > 2 * 24 * 60 * 60 * 1000;
  }, [status, latest]);

  const createBackup = async () => {
    setWorking(true);
    try {
      const data = await api.createManualBackup();
      success(data.message || 'Manuel yedek alındı');
      await load();
    } catch (e) {
      error(e.message || 'Yedek alınamadı');
    } finally {
      setWorking(false);
    }
  };

  // Dışarıdan .db dosyası seçip yedekler klasörüne ekle (Electron only)
  const pickExternalDb = async () => {
    if (!window.electronAPI?.pickExternalDb) return;
    setWorking(true);
    try {
      const fileName = await window.electronAPI.pickExternalDb();
      if (fileName) {
        success('Dış kaynaklı yedek eklendi: ' + fileName);
        await load();
      }
    } catch (e) {
      error(e.message || 'Dosya seçilemedi');
    } finally {
      setWorking(false);
    }
  };

  // Bir yedeği kullanıcının seçtiği konuma kopyala (Electron only)
  const exportBackup = async (backup) => {
    if (!window.electronAPI?.exportBackup) return;
    setWorking(true);
    try {
      const dest = await window.electronAPI.exportBackup(backup.id);
      if (dest) success('Yedek dışa aktarıldı: ' + dest);
    } catch (e) {
      error(e.message || 'Dışa aktarma başarısız');
    } finally {
      setWorking(false);
    }
  };

  // ── İki adımlı restore akışı ─────────────────────────────────────────────

  const requestRestore = async (backup) => {
    let openCount = 0;
    try {
      const data = await api.getOpenOrderCount();
      openCount = data.openOrderCount ?? 0;
    } catch {
      // Açık sipariş kontrolü başarısız olsa da restore akışı devam eder
    }
    setRestoreStep({ backup, step: 1, openCount });
  };

  const advanceRestoreStep = () => setRestoreStep((s) => s ? { ...s, step: 2 } : null);
  const cancelRestoreStep = () => setRestoreStep(null);

  const confirmRestore = async () => {
    const backup = restoreStep?.backup;
    setRestoreStep(null);
    setWorking(true);
    try {
      const data = await api.requestRestore(backup.id);
      success(data.message || 'Restore isteği kaydedildi');
      await load();
    } catch (e) {
      error(e.message || 'Restore isteği kaydedilemedi');
    } finally {
      setWorking(false);
    }
  };

  const cancelRestore = async () => {
    setWorking(true);
    try {
      const data = await api.cancelRestoreRequest();
      success(data.message || 'Restore isteği iptal edildi');
      await load();
    } catch (e) {
      error(e.message || 'Restore isteği iptal edilemedi');
    } finally {
      setWorking(false);
    }
  };

  const restartApp = () => {
    if (window.electronAPI?.restartApp) {
      window.electronAPI.restartApp();
      return;
    }
    error('Yeniden başlatma yalnızca masaüstü uygulamasında kullanılabilir');
  };

  // ── Görev Zamanlayıcı işlemleri ──────────────────────────────────────────

  const schedulerSetup = async () => {
    if (!window.electronAPI?.pickExternalFolder) return;
    setSchedulerWorking(true);
    try {
      const folder = await window.electronAPI.pickExternalFolder();
      if (!folder) return;
      await window.electronAPI.schedulerSave(folder);
      await loadScheduler();
      success('Görev Zamanlayıcı kuruldu. Her gece 03:00\'te ' + folder + ' klasörüne kopyalanacak.');
    } catch (e) {
      error(e.message || 'Görev oluşturulamadı');
    } finally {
      setSchedulerWorking(false);
    }
  };

  const schedulerRemove = async () => {
    setSchedulerWorking(true);
    try {
      await window.electronAPI.schedulerRemove();
      setScheduler(null);
      success('Otomatik harici kopyalama görevi kaldırıldı.');
    } catch (e) {
      error(e.message || 'Görev kaldırılamadı');
    } finally {
      setSchedulerWorking(false);
    }
  };

  const schedulerRunNow = async () => {
    setSchedulerWorking(true);
    try {
      const result = await window.electronAPI.schedulerRunNow();
      success(`Kopyalama tamamlandı: ${result.copied} dosya → ${result.destFolder}`);
    } catch (e) {
      error(e.message || 'Kopyalama başarısız');
    } finally {
      setSchedulerWorking(false);
    }
  };

  return (
    <div className="page-container">
      <SettingsDetailHeader title="Bakım ve Yedekleme" onBack={() => navigate('/settings')} />

      <div className="maintenance-hero">
        <div className="maintenance-hero-main">
          <div className="maintenance-hero-icon">
            <DatabaseBackup size={26} />
          </div>
          <div>
            <h1>Veriyi koru, geri dönüş yolunu hazır tut.</h1>
            <p>Yedekleri kontrol edin, servis öncesi manuel yedek alın ve gerekirse restore işlemini güvenli yeniden başlatmaya planlayın.</p>
          </div>
        </div>
        <div className="maintenance-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={load} disabled={loading || working}>
            <RefreshCw size={14} />
            Yenile
          </button>
          {window.electronAPI?.pickExternalDb ? (
            <button type="button" className="btn btn-ghost btn-sm" onClick={pickExternalDb} disabled={loading || working}>
              <Upload size={14} />
              Dosyadan Geri Yükle
            </button>
          ) : null}
          <button type="button" className="btn btn-primary btn-sm" onClick={createBackup} disabled={loading || working}>
            Manuel Yedek Al
          </button>
        </div>
      </div>

      {!loading && backupStale ? (
        <div className="maintenance-restore-alert" style={{ borderColor: 'var(--color-warning)', color: 'var(--color-warning)' }}>
          <AlertTriangle size={20} />
          <div>
            <strong>Güncel yedek yok</strong>
            <p>
              {latest
                ? `Son yedek ${formatDateInIstanbul(latest.modified_at)} tarihinde alındı. Otomatik yedekleme çalışmıyor olabilir.`
                : 'Hiç yedek bulunamadı. Servis öncesi manuel yedek alın.'}
            </p>
          </div>
          <button type="button" className="btn btn-warning btn-sm" onClick={createBackup} disabled={working}>
            Şimdi Yedekle
          </button>
        </div>
      ) : null}

      {pendingRestore ? (
        <div className="maintenance-restore-alert">
          <ShieldAlert size={20} />
          <div>
            <strong>Bekleyen restore var</strong>
            <p>{pendingRestore.backupFile} yedeği yeniden başlatmada uygulanacak.</p>
          </div>
          <button type="button" className="btn btn-warning btn-sm" onClick={restartApp} disabled={working}>
            Yeniden Başlat
          </button>
          <button type="button" className="btn btn-ghost btn-sm" onClick={cancelRestore} disabled={working}>
            İptal Et
          </button>
        </div>
      ) : null}

      <div className="maintenance-summary-grid">
        <div className="stat-card">
          <div className="stat-card-label">Yedek sayısı</div>
          <div className="stat-card-value">{backups.length}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Son yedek</div>
          <div className="maintenance-stat-text">{latest ? latest.name : 'Yok'}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Yedek klasörü</div>
          <div className="maintenance-stat-text">{status?.backupsDir || 'Hazır değil'}</div>
        </div>
      </div>

      <div className="maintenance-list">
        {loading ? (
          <div className="card card-padded" style={{ color: 'var(--text-muted)' }}>Yedekler yükleniyor...</div>
        ) : backups.length === 0 ? (
          <div className="card card-padded" style={{ color: 'var(--text-muted)' }}>
            Henüz yedek yok. Servis işleminden önce manuel yedek alın.
          </div>
        ) : (
          backups.map((backup) => (
            <div key={backup.id} className="maintenance-backup-row">
              <div className="maintenance-backup-main">
                <div className="maintenance-backup-title">{backup.name}</div>
                <div className="maintenance-backup-meta">
                  {backupKindLabel(backup.kind)} · {formatBytes(backup.size)} · {formatDateTimeInIstanbul(backup.modified_at)}
                  {backup.meta?.rowCounts ? (
                    <span style={{ marginLeft: 8, color: 'var(--text-muted)', fontSize: 12 }}>
                      · {backup.meta.rowCounts.orders ?? '?'} sipariş · {backup.meta.rowCounts.customers ?? '?'} müşteri
                    </span>
                  ) : null}
                </div>
              </div>
              {window.electronAPI?.exportBackup ? (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={() => exportBackup(backup)}
                  disabled={working}
                  title="Yedeği dışa aktar"
                >
                  <Download size={14} />
                  Dışa Aktar
                </button>
              ) : null}
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => requestRestore(backup)}
                disabled={working || !!pendingRestore}
              >
                <RotateCcw size={14} />
                Restore Planla
              </button>
            </div>
          ))
        )}
      </div>

      {/* ── Otomatik Harici Yedek Kopyalama (Görev Zamanlayıcı) ──────────── */}
      {HAS_SCHEDULER ? (
        <div className="card card-padded" style={{ marginTop: 24 }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
            <FolderSync size={20} style={{ flexShrink: 0, color: 'var(--text-secondary)' }} />
            <div>
              <strong style={{ fontSize: 15 }}>Otomatik Harici Yedek Kopyalama</strong>
              <p style={{ margin: '2px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
                Yedekler her gece 03:00&apos;te USB veya ağ sürücüsüne otomatik kopyalanır. Disk arızasına karşı güvence.
              </p>
            </div>
          </div>

          {scheduler ? (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <div style={{ fontSize: 13, color: 'var(--text-secondary)', padding: '8px 12px', background: 'var(--bg-subtle, rgba(0,0,0,.04))', borderRadius: 6 }}>
                <strong>Hedef klasör:</strong> {scheduler.destFolder}
                <br />
                <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>
                  Kurulum: {formatDateTimeInIstanbul(scheduler.createdAt)}
                </span>
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={schedulerRunNow}
                  disabled={schedulerWorking}
                >
                  Şimdi Kopyala
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={schedulerSetup}
                  disabled={schedulerWorking}
                >
                  Klasörü Değiştir
                </button>
                <button
                  type="button"
                  className="btn btn-ghost btn-sm"
                  onClick={schedulerRemove}
                  disabled={schedulerWorking}
                  style={{ color: 'var(--color-danger, #dc2626)' }}
                >
                  Görevi Kaldır
                </button>
              </div>
            </div>
          ) : (
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, flexWrap: 'wrap' }}>
              <p style={{ margin: 0, fontSize: 13, color: 'var(--text-muted)', flex: 1 }}>
                Henüz yapılandırılmadı. Bir hedef klasör seçerek kurabilirsiniz.
              </p>
              <button
                type="button"
                className="btn btn-primary btn-sm"
                onClick={schedulerSetup}
                disabled={schedulerWorking}
              >
                Hedef Klasör Seç ve Kur
              </button>
            </div>
          )}
        </div>
      ) : null}

      {/* ── İki adımlı restore modal ───────────────────────────────────────── */}
      {restoreStep ? (
        <div
          className="modal-overlay"
          onClick={cancelRestoreStep}
          role="dialog"
          aria-modal="true"
        >
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            {restoreStep.step === 1 ? (
              <>
                <div className="modal-header">
                  <h2 style={{ margin: 0, fontSize: 18 }}>Yedek Özeti</h2>
                  <p style={{ margin: '6px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>
                    <strong>{restoreStep.backup.name}</strong>
                  </p>
                  {restoreStep.backup.meta ? (
                    <ul style={{ margin: '10px 0 0', padding: '0 0 0 18px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.7 }}>
                      <li>Uygulama sürümü: v{restoreStep.backup.meta.appVersion}</li>
                      <li>Şema sürümü: {restoreStep.backup.meta.schemaVersion}</li>
                      <li>Oluşturulma: {formatDateTimeInIstanbul(restoreStep.backup.meta.createdAt)}</li>
                      <li>
                        Sipariş: {restoreStep.backup.meta.rowCounts?.orders ?? '?'} ·{' '}
                        Ödeme: {restoreStep.backup.meta.rowCounts?.payments ?? '?'} ·{' '}
                        Müşteri: {restoreStep.backup.meta.rowCounts?.customers ?? '?'}
                      </li>
                      <li>Bütünlük: {restoreStep.backup.meta.integrityCheck === 'ok' ? '✓ ok' : `⚠ ${restoreStep.backup.meta.integrityCheck}`}</li>
                      <li>Boyut: {formatBytes(restoreStep.backup.meta.dbSizeBytes)}</li>
                      {restoreStep.backup.meta.sha256 ? (
                        <li style={{ fontFamily: 'monospace', fontSize: 11, wordBreak: 'break-all' }}>
                          SHA-256: {restoreStep.backup.meta.sha256.slice(0, 16)}…
                        </li>
                      ) : null}
                    </ul>
                  ) : (
                    <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--text-muted)' }}>
                      Bu yedek için meta bilgisi mevcut değil.
                    </p>
                  )}
                  {restoreStep.openCount > 0 ? (
                    <p style={{ margin: '10px 0 0', color: 'var(--color-warning)', fontSize: 13, fontWeight: 600 }}>
                      Uyarı: Şu anda {restoreStep.openCount} açık sipariş var. Restore bu siparişleri etkileyebilir.
                    </p>
                  ) : null}
                  {restoreStep.backup.hasConfigBackup ? (
                    <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: 13 }}>
                      Bu yedekle birlikte pos-config.json (JWT secret, bridge token) de geri yüklenecek.
                    </p>
                  ) : null}
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-ghost" onClick={cancelRestoreStep}>Vazgeç</button>
                  <button type="button" className="btn btn-primary" onClick={advanceRestoreStep}>İleri →</button>
                </div>
              </>
            ) : (
              <>
                <div className="modal-header">
                  <h2 style={{ margin: 0, fontSize: 18 }}>Restore&apos;u Onayla</h2>
                  <p style={{ margin: '10px 0 0', color: 'var(--text-secondary)', fontSize: 14 }}>
                    <strong>{restoreStep.backup.name}</strong> yedeği bir sonraki yeniden başlatmada aktif veritabanının yerine geçecek.
                    İşlemden önce mevcut veritabanı otomatik olarak yedeklenir.
                  </p>
                  <p style={{ margin: '8px 0 0', color: 'var(--color-danger, #dc2626)', fontSize: 13, fontWeight: 600 }}>
                    Bu yedekten sonraki tüm değişiklikler geri gelmez.
                  </p>
                </div>
                <div className="modal-footer">
                  <button type="button" className="btn btn-ghost" onClick={cancelRestoreStep}>Vazgeç</button>
                  <button type="button" className="btn btn-danger" onClick={confirmRestore}>Anladım, devam et</button>
                </div>
              </>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
