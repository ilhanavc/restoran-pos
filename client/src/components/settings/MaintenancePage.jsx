import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, DatabaseBackup, RefreshCw, RotateCcw, ShieldAlert } from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import useConfirmDialog from '../common/useConfirmDialog.js';
import SettingsDetailHeader from './SettingsDetailHeader.jsx';

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

export default function MaintenancePage() {
  const navigate = useNavigate();
  const { success, error } = useToast();
  const [status, setStatus] = useState(null);
  const [loading, setLoading] = useState(true);
  const [working, setWorking] = useState(false);
  const { confirmDialog, requestConfirm, cancelConfirm, acceptConfirm } = useConfirmDialog();

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

  useEffect(() => {
    load();
  }, [load]);

  const backups = useMemo(() => status?.backups || [], [status]);
  const latest = status?.latest || null;
  const pendingRestore = status?.pendingRestore || null;

  // Show staleness warning if latest backup is more than 2 days old (or missing)
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

  const requestRestore = (backup) => {
    requestConfirm({
      title: 'Restore planlansın mı?',
      body: `${backup.name} yedeği bir sonraki yeniden başlatmada aktif veritabanının yerine geçecek. İşlemden önce mevcut veritabanı restore-safety yedeği olarak saklanır.`,
      confirmLabel: 'Restore Planla',
      tone: 'danger',
      onConfirm: async () => {
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
      },
    });
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
                ? `Son yedek ${new Date(latest.modified_at).toLocaleDateString('tr-TR')} tarihinde alındı. Otomatik yedekleme çalışmıyor olabilir.`
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
                  {backupKindLabel(backup.kind)} · {formatBytes(backup.size)} · {new Date(backup.modified_at).toLocaleString('tr-TR')}
                </div>
              </div>
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
