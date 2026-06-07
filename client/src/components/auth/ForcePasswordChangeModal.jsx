import { X, Loader, Lock } from 'lucide-react';

export default function ForcePasswordChangeModal({
  open,
  email,
  newPassword,
  confirmPassword,
  error,
  loading,
  onClose,
  onNewPasswordChange,
  onConfirmPasswordChange,
  onSubmit,
}) {
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={() => !loading && onClose()}>
      <div
        className="modal modal-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="force-password-change-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 id="force-password-change-title" style={{ margin: 0, fontSize: 18 }}>Yeni Şifre Belirleyin</h2>
            <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.5 }}>
              Bu hesap için geçici şifre kullanılıyor. Devam etmeden önce kendinize yeni bir şifre oluşturmanız gerekiyor.
            </p>
          </div>
          <button
            type="button"
            className="btn btn-ghost btn-icon"
            onClick={onClose}
            disabled={loading}
            title="Kapat"
          >
            <X size={16} />
          </button>
        </div>

        <form onSubmit={onSubmit} style={{ display: 'grid', gap: 14 }}>
          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Hesap</span>
            <input className="input" value={email} readOnly disabled />
          </label>

          {error ? (
            <div
              style={{
                padding: '10px 12px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--danger-muted)',
                color: 'var(--danger)',
                fontSize: 13,
                fontWeight: 600,
                lineHeight: 1.5,
              }}
            >
              {error}
            </div>
          ) : null}

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Yeni Şifre</span>
            <div style={{ position: 'relative' }}>
              <Lock
                size={16}
                style={{
                  position: 'absolute',
                  left: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                }}
              />
              <input
                className="input"
                type="password"
                value={newPassword}
                onChange={(event) => onNewPasswordChange(event.target.value)}
                autoComplete="new-password"
                placeholder="Yeni şifrenizi girin"
                style={{ paddingLeft: 38 }}
                required
              />
            </div>
          </label>

          <label style={{ display: 'grid', gap: 6 }}>
            <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Yeni Şifre Tekrar</span>
            <div style={{ position: 'relative' }}>
              <Lock
                size={16}
                style={{
                  position: 'absolute',
                  left: 12,
                  top: '50%',
                  transform: 'translateY(-50%)',
                  color: 'var(--text-muted)',
                }}
              />
              <input
                className="input"
                type="password"
                value={confirmPassword}
                onChange={(event) => onConfirmPasswordChange(event.target.value)}
                autoComplete="new-password"
                placeholder="Yeni şifrenizi tekrar girin"
                style={{ paddingLeft: 38 }}
                required
              />
            </div>
          </label>

          <div
            style={{
              padding: '10px 12px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-secondary)',
              color: 'var(--text-secondary)',
              fontSize: 12,
              lineHeight: 1.5,
            }}
          >
            Şifre en az 8 karakter olmalı, en az 1 büyük harf ve en az 1 rakam içermeli.
          </div>

          <div className="modal-footer" style={{ paddingTop: 0 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
              Sonra
            </button>
            <button type="submit" className="btn btn-primary" disabled={loading}>
              {loading ? <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> : 'Şifreyi Güncelle'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}
