import { useEffect, useState } from 'react';
import { X } from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';

export default function PrinterDeleteModal({
  open,
  onClose,
  printerId,
  printerName,
  onAfterDeactivate,
  onAfterDelete,
}) {
  const { success, error } = useToast();
  const [loading, setLoading] = useState(false);
  const [el, setEl] = useState(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open || !printerId) {
      setEl(null);
      return;
    }
    let cancelled = false;
    setLoading(true);
    setEl(null);
    api
      .getAdminPrinterDeleteEligibility(printerId)
      .then((data) => {
        if (!cancelled) setEl(data);
      })
      .catch((e) => {
        if (!cancelled) error(e.message || 'Silme kontrolü yapılamadı');
      })
      .finally(() => {
        if (!cancelled) setLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, printerId]);

  if (!open) return null;

  const doDeactivate = async () => {
    setBusy(true);
    try {
      const res = await api.patchAdminPrinter(printerId, { is_active: false });
      success(res.message || 'Yazıcı pasifleştirildi');
      onClose();
      onAfterDeactivate?.();
    } catch (e) {
      error(e.message || 'İşlem başarısız');
    } finally {
      setBusy(false);
    }
  };

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

  const usage = el?.usage;
  const blockers = el?.blockers || [];

  return (
    <div className="modal-overlay" onClick={() => !busy && onClose()}>
      <div className="modal" style={{ maxWidth: 480, width: '100%' }} onClick={(e) => e.stopPropagation()}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 12 }}>
          <div>
            <h2 style={{ fontSize: 18, fontWeight: 700, margin: 0 }}>Yazıcıyı kaldır</h2>
            <p style={{ margin: '6px 0 0', fontSize: 14, color: 'var(--text-secondary)' }}>{printerName || 'Yazıcı'}</p>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} disabled={busy} aria-label="Kapat">
            <X size={18} />
          </button>
        </div>

        <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
          Kalıcı silme, yazıcı kaydını veritabanından siler; geçmiş yazdırma kayıtlarındaki yazıcı bağlantısı kaldırılır. Koşullar
          uygun değilse yazıcıyı pasifleştirmeniz güvenlidir — listeden düşer, ayarlar korunur.
        </p>

        {loading && <div style={{ padding: '12px 0', color: 'var(--text-muted)', fontSize: 14 }}>Kontroller yapılıyor…</div>}

        {!loading && el && (
          <>
            {usage && (
              <div
                style={{
                  fontSize: 12,
                  color: 'var(--text-muted)',
                  marginBottom: 12,
                  display: 'grid',
                  gap: 4,
                  padding: '10px 12px',
                  borderRadius: 8,
                  background: 'var(--bg-tertiary, rgba(255,255,255,0.04))',
                  border: '1px solid var(--border)',
                }}
              >
                <span>Varsayılan yazıcı: {usage.isDefault ? 'Evet' : 'Hayır'}</span>
                <span>Kategori yönlendirmesi: {usage.routingCount}</span>
                <span>Bekleyen yazdırma işi: {usage.pendingJobs}</span>
                <span>Toplam iş kaydı (bu yazıcı): {usage.totalJobs}</span>
              </div>
            )}

            {blockers.length > 0 && (
              <div style={{ marginBottom: 14 }}>
                <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8 }}>
                  Kalıcı silme şu an engellendi:
                </div>
                <ul style={{ margin: 0, paddingLeft: 18, fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                  {blockers.map((b) => (
                    <li key={b}>{b}</li>
                  ))}
                </ul>
                <p style={{ margin: '12px 0 0', fontSize: 13, color: 'var(--warning, #f59e0b)' }}>
                  Bunun yerine yazıcıyı pasifleştirebilirsiniz; varsayılan ayar ve kategori yönlendirmeleri bu yazıcıdan temizlenir.
                </p>
              </div>
            )}

            {el.canHardDelete && (
              <p style={{ margin: '0 0 14px', fontSize: 13, color: 'var(--success, #22c55e)' }}>
                Koşullar uygun: kalıcı silme yapılabilir.
              </p>
            )}
          </>
        )}

        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, justifyContent: 'flex-end', marginTop: 8 }}>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose} disabled={busy}>
            Vazgeç
          </button>
          {el?.canDeactivate ? (
            <button type="button" className="btn btn-primary btn-sm" onClick={doDeactivate} disabled={busy || loading}>
              {busy ? '…' : 'Pasif yap'}
            </button>
          ) : null}
          <button
            type="button"
            className="btn btn-danger btn-sm"
            onClick={doHardDelete}
            disabled={busy || loading || !el?.canHardDelete}
            title={!el?.canHardDelete ? 'Önce engelleri giderin veya pasif yapın' : undefined}
          >
            {busy ? '…' : 'Kalıcı sil'}
          </button>
        </div>
      </div>
    </div>
  );
}
