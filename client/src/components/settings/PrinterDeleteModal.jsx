import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, CheckCircle2, Info, ShieldAlert, Trash2, X } from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';

export default function PrinterDeleteModal({
  open,
  onClose,
  printerId,
  printerName,
  onAfterDelete,
}) {
  const { success, error } = useToast();
  const [loading, setLoading] = useState(false);
  const [el, setEl] = useState(null);
  const [busy, setBusy] = useState(false);
  const [eligibilityError, setEligibilityError] = useState('');

  useEffect(() => {
    if (!open || !printerId) {
      setEl(null);
      setEligibilityError('');
      return;
    }
    let cancelled = false;
    setLoading(true);
    setEl(null);
    setEligibilityError('');
    api
      .getAdminPrinterDeleteEligibility(printerId)
      .then((data) => {
        if (!cancelled) setEl(data);
      })
      .catch((e) => {
        if (!cancelled) {
          const message = e.message || 'Silme kontrolü yapılamadı';
          error(message);
          setEligibilityError(message);
          setEl({
            canHardDelete: false,
            blockers: ['Kalıcı silme uygunluğu doğrulanamadı. Lütfen bağlantıyı kontrol edip tekrar deneyin.'],
            usage: null,
          });
        }
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, printerId, error]);

  const usage = el?.usage;
  const blockers = useMemo(() => el?.blockers || [], [el?.blockers]);
  const hasHardDeleteBlocker = !loading && !el?.canHardDelete;
  const hardDeleteHelpText = useMemo(() => {
    if (loading) return 'Silme koşulları kontrol ediliyor...';
    if (eligibilityError) return eligibilityError;
    if (blockers.length > 0) return blockers[0];
    if (!el?.canHardDelete) return 'Kalıcı silme şu an kullanılamıyor.';
    return 'Kalıcı silme yapılabilir.';
  }, [loading, eligibilityError, blockers, el?.canHardDelete]);

  if (!open) return null;

  const doHardDelete = async () => {
    if (!el?.canHardDelete) return;
    setBusy(true);
    try {
      const res = await api.deleteAdminPrinter(printerId);
      success(res.message || 'Yazıcı silindi');
      onClose();
      onAfterDelete?.();
    } catch (e) {
      error(e.message || 'Silinemedi');
      if (Array.isArray(e.blockers) && e.blockers.length) {
        setEl((prev) =>
          prev
            ? {
                ...prev,
                blockers: e.blockers,
                canHardDelete: false,
                usage: e.usage || prev.usage,
              }
            : prev,
        );
      }
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div
        className="modal modal-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="printer-delete-title"
        style={{ width: '100%', maxWidth: 540 }}
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header" style={{ alignItems: 'flex-start' }}>
          <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
            <div
              style={{
                width: 42,
                height: 42,
                borderRadius: 12,
                display: 'inline-flex',
                alignItems: 'center',
                justifyContent: 'center',
                background: hasHardDeleteBlocker ? 'var(--warning-muted)' : 'var(--danger-muted)',
                color: hasHardDeleteBlocker ? 'var(--warning)' : 'var(--danger)',
                flexShrink: 0,
              }}
            >
              {hasHardDeleteBlocker ? <ShieldAlert size={20} /> : <Trash2 size={20} />}
            </div>
            <div>
              <h2 id="printer-delete-title" style={{ margin: 0, fontSize: 19, fontWeight: 800 }}>Yazıcıyı kaldır</h2>
              <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--text-secondary)', fontWeight: 600 }}>
                {printerName || 'Yazıcı'}
              </p>
              <p style={{ margin: '10px 0 0', fontSize: 13, color: 'var(--text-muted)', lineHeight: 1.55, maxWidth: 400 }}>
                Kalıcı silme yazıcı kaydını veritabanından kaldırır. Varsayılan yazıcı ayarı ve kategori yönlendirmeleri de bu kayıtla birlikte temizlenir.
              </p>
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} disabled={busy} aria-label="Kapat">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body" style={{ paddingTop: 20 }}>
          <div
            style={{
              display: 'flex',
              alignItems: 'flex-start',
              gap: 10,
              padding: '12px 14px',
              borderRadius: 12,
              marginBottom: 16,
              border: `1px solid ${
                loading ? 'var(--border)' : hasHardDeleteBlocker ? 'var(--warning)' : 'var(--success)'
              }`,
              background: loading
                ? 'var(--bg-tertiary)'
                : hasHardDeleteBlocker
                  ? 'var(--warning-muted)'
                  : 'var(--success-muted)',
              color: loading ? 'var(--text-secondary)' : hasHardDeleteBlocker ? 'var(--warning)' : 'var(--success)',
            }}
          >
            {loading ? <Info size={18} /> : hasHardDeleteBlocker ? <AlertTriangle size={18} /> : <CheckCircle2 size={18} />}
            <div style={{ minWidth: 0 }}>
              <div style={{ fontSize: 13, fontWeight: 800, marginBottom: 4 }}>
                {loading ? 'Koşullar kontrol ediliyor' : hasHardDeleteBlocker ? 'Kalıcı silme şu an engellendi' : 'Kalıcı silme yapılabilir'}
              </div>
              <div style={{ fontSize: 13, lineHeight: 1.55 }}>{hardDeleteHelpText}</div>
            </div>
          </div>

          {usage && (
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(2, minmax(0, 1fr))',
                gap: 10,
                marginBottom: 16,
              }}
            >
              <div style={{ padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-tertiary)' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Varsayılan</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{usage.isDefault ? 'Evet' : 'Hayır'}</div>
              </div>
              <div style={{ padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-tertiary)' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Yönlendirme</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{usage.routingCount}</div>
              </div>
              <div style={{ padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-tertiary)' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Bekleyen İş</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{usage.pendingJobs}</div>
              </div>
              <div style={{ padding: '12px 14px', borderRadius: 12, border: '1px solid var(--border)', background: 'var(--bg-tertiary)' }}>
                <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', textTransform: 'uppercase', marginBottom: 4 }}>Toplam Kayıt</div>
                <div style={{ fontSize: 14, fontWeight: 700 }}>{usage.totalJobs}</div>
              </div>
            </div>
          )}

          {!loading && blockers.length > 0 && (
            <div
              style={{
                padding: '14px 16px',
                borderRadius: 12,
                border: '1px solid var(--warning)',
                background: 'var(--warning-muted)',
              }}
            >
              <div style={{ fontSize: 13, fontWeight: 800, color: 'var(--warning)', marginBottom: 8 }}>
                Kalıcı silme neden kapalı?
              </div>
              <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.6 }}>
                {blockers.map((b) => (
                  <li key={b}>{b}</li>
                ))}
              </ul>
            </div>
          )}
        </div>

        <div className="modal-footer" style={{ justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap' }}>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
            {hasHardDeleteBlocker ? 'Buton kapalı çünkü silme koşulları henüz sağlanmıyor.' : 'Silme işlemi geri alınamaz.'}
          </div>
          <div style={{ display: 'flex', gap: 10, flexWrap: 'wrap', justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={busy}>
            Vazgeç
            </button>
            <button
              type="button"
              className="btn btn-danger"
              onClick={doHardDelete}
              disabled={busy || loading || !el?.canHardDelete}
              title={hasHardDeleteBlocker ? hardDeleteHelpText : 'Yazıcıyı kalıcı olarak sil'}
              style={{ minWidth: 124 }}
            >
              {busy ? 'Siliniyor...' : 'Kalıcı sil'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
