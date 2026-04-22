import { X, Loader, Mail } from 'lucide-react';

export default function ForgotPasswordModal({
  open,
  email,
  error,
  loading,
  successMessage,
  onClose,
  onEmailChange,
  onSubmit,
}) {
  if (!open) return null;

  return (
    <div className="modal-overlay" onClick={() => !loading && onClose()}>
      <div
        className="modal modal-sm"
        role="dialog"
        aria-modal="true"
        aria-labelledby="forgot-password-title"
        onClick={(event) => event.stopPropagation()}
      >
        <div className="modal-header">
          <div>
            <h2 id="forgot-password-title" style={{ margin: 0, fontSize: 18 }}>Şifremi Unuttum</h2>
            <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.5 }}>
              E-posta adresinizi girin. Şifre sıfırlama talebinizi kaydedelim; işletme yöneticiniz geçici şifre tanımladığında aynı ekrandan devam edebilirsiniz.
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

        {successMessage ? (
          <div style={{ display: 'grid', gap: 14 }}>
            <div
              style={{
                padding: '12px 14px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--success-muted)',
                color: 'var(--success)',
                fontSize: 14,
                lineHeight: 1.5,
                fontWeight: 600,
              }}
            >
              {successMessage}
            </div>

            <div
              style={{
                padding: '12px 14px',
                borderRadius: 'var(--radius-sm)',
                background: 'var(--bg-secondary)',
                color: 'var(--text-secondary)',
                fontSize: 13,
                lineHeight: 1.6,
              }}
            >
              Yönetici size geçici şifre verdiğinde normal giriş alanlarını kullanın.
              İlk başarılı girişte sizden yeni şifre belirlemenizi isteyeceğiz.
            </div>

            <div className="modal-footer" style={{ paddingTop: 0 }}>
              <button type="button" className="btn btn-primary" onClick={onClose}>
                Tamam
              </button>
            </div>
          </div>
        ) : (
          <form onSubmit={onSubmit} style={{ display: 'grid', gap: 14 }}>
            {error ? (
              <div
                style={{
                  padding: '10px 12px',
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--danger-muted)',
                  color: 'var(--danger)',
                  fontSize: 13,
                  fontWeight: 600,
                }}
              >
                {error}
              </div>
            ) : null}

            <label style={{ display: 'grid', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)' }}>Kayıtlı E-posta</span>
              <div style={{ position: 'relative' }}>
                <Mail
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
                  type="email"
                  value={email}
                  onChange={(event) => onEmailChange(event.target.value)}
                  autoComplete="email"
                  placeholder="ornek@restoran.com"
                  style={{ paddingLeft: 38 }}
                  required
                />
              </div>
            </label>

            <div className="modal-footer" style={{ paddingTop: 0 }}>
              <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
                Vazgeç
              </button>
              <button type="submit" className="btn btn-primary" disabled={loading}>
                {loading ? <Loader size={16} style={{ animation: 'spin 1s linear infinite' }} /> : 'Talep Gönder'}
              </button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
