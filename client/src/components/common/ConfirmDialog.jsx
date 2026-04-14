import { X } from 'lucide-react';

export default function ConfirmDialog({
  open,
  title,
  body,
  confirmLabel = 'Onayla',
  cancelLabel = 'Vazgeç',
  tone = 'primary',
  loading = false,
  onCancel,
  onConfirm,
}) {
  if (!open) return null;

  return (
    <div
      className="modal-overlay"
      onClick={() => {
        if (!loading) onCancel?.();
      }}
    >
      <div
        className="modal modal-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="confirm-dialog-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 id="confirm-dialog-title" style={{ margin: 0, fontSize: 18 }}>{title}</h2>
            {body ? (
              <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.45, fontWeight: 650 }}>
                {body}
              </p>
            ) : null}
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={onCancel}
            disabled={loading}
            title="Kapat"
          >
            <X size={16} />
          </button>
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onCancel} disabled={loading}>
            {cancelLabel}
          </button>
          <button
            type="button"
            className={tone === 'danger' ? 'btn btn-danger' : 'btn btn-primary'}
            onClick={onConfirm}
            disabled={loading}
          >
            {loading ? 'İşleniyor...' : confirmLabel}
          </button>
        </div>
      </div>
    </div>
  );
}
