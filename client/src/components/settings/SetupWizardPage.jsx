import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../services/api.js';

const STEPS = ['Hoş Geldiniz', 'İşletme Adı', 'Admin Parola', 'Tamamlandı'];

export default function SetupWizardPage({ onComplete }) {
  const { user } = useAuth();
  const navigate = useNavigate();

  const [step, setStep] = useState(0);
  const [businessName, setBusinessName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirmPassword, setConfirmPassword] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  async function finish() {
    setSaving(true);
    setError('');
    try {
      if (businessName.trim()) {
        await api.patchAdminBusiness({ name: businessName.trim() });
      }
      if (window.electronAPI?.setupComplete) {
        await window.electronAPI.setupComplete({ businessName: businessName.trim() });
      }
      onComplete?.();
      navigate('/home', { replace: true });
    } catch (e) {
      setError(e?.message || 'Bir hata oluştu.');
    } finally {
      setSaving(false);
    }
  }

  async function handlePasswordNext() {
    if (!newPassword) {
      setStep(3);
      return;
    }
    if (newPassword.length < 6) {
      setError('Parola en az 6 karakter olmalı.');
      return;
    }
    if (newPassword !== confirmPassword) {
      setError('Parola tekrarı eşleşmiyor.');
      return;
    }
    setSaving(true);
    setError('');
    try {
      await api.patchAdminUser(user.id, { password: newPassword });
      setStep(3);
    } catch (e) {
      setError(e?.message || 'Parola güncellenemedi.');
    } finally {
      setSaving(false);
    }
  }

  const stepPercent = Math.round((step / (STEPS.length - 1)) * 100);

  return (
    <div style={{
      minHeight: '100vh',
      display: 'flex',
      alignItems: 'center',
      justifyContent: 'center',
      background: 'var(--bg-base, #f5f5f5)',
      padding: '24px',
    }}>
      <div className="card card-padded" style={{ maxWidth: 480, width: '100%' }}>
        {/* İlerleme çubuğu */}
        <div style={{ marginBottom: 24 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 6, fontSize: 12, color: 'var(--text-secondary, #888)' }}>
            <span>Adım {step + 1} / {STEPS.length}</span>
            <span>{STEPS[step]}</span>
          </div>
          <div style={{ height: 4, background: 'var(--border, #e0e0e0)', borderRadius: 2 }}>
            <div style={{ height: '100%', width: `${stepPercent}%`, background: 'var(--primary, #2563eb)', borderRadius: 2, transition: 'width .3s' }} />
          </div>
        </div>

        {/* Adım 0: Hoş Geldiniz */}
        {step === 0 && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>🍽️</div>
            <h2 style={{ marginBottom: 8 }}>Restoran POS'a Hoş Geldiniz</h2>
            <p style={{ color: 'var(--text-secondary, #666)', marginBottom: 24 }}>
              Birkaç adımda kurulumu tamamlayalım.
            </p>
            <button className="btn btn-primary" onClick={() => setStep(1)}>
              Kuruluma Başla
            </button>
          </div>
        )}

        {/* Adım 1: İşletme Adı */}
        {step === 1 && (
          <div>
            <h3 style={{ marginBottom: 16 }}>İşletme Adı</h3>
            <p style={{ color: 'var(--text-secondary, #666)', marginBottom: 16, fontSize: 14 }}>
              Fiş ve raporlarda görünecek işletme adını girin.
            </p>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 500 }}>İşletme Adı</label>
              <input
                className="input"
                style={{ width: '100%' }}
                placeholder="örn. Lezzet Durağı"
                value={businessName}
                onChange={(e) => setBusinessName(e.target.value)}
                autoFocus
              />
            </div>
            {error && <p style={{ color: 'var(--error, #dc2626)', marginBottom: 12, fontSize: 13 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => { setError(''); setStep(0); }}>Geri</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setError(''); setStep(2); }}>Atla</button>
              <button
                className="btn btn-primary"
                disabled={!businessName.trim()}
                onClick={() => { setError(''); setStep(2); }}
              >
                İleri
              </button>
            </div>
          </div>
        )}

        {/* Adım 2: Admin Parola */}
        {step === 2 && (
          <div>
            <h3 style={{ marginBottom: 8 }}>Admin Parolası</h3>
            <p style={{ color: 'var(--text-secondary, #666)', marginBottom: 16, fontSize: 14 }}>
              Varsayılan parolayı değiştirmenizi öneririz. Boş bırakırsanız bu adım atlanır.
            </p>
            <div style={{ marginBottom: 12 }}>
              <label style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 500 }}>Yeni Parola</label>
              <input
                className="input"
                style={{ width: '100%' }}
                type="password"
                placeholder="En az 6 karakter"
                value={newPassword}
                onChange={(e) => { setNewPassword(e.target.value); setError(''); }}
                autoFocus
              />
            </div>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', marginBottom: 6, fontSize: 14, fontWeight: 500 }}>Parola Tekrar</label>
              <input
                className="input"
                style={{ width: '100%' }}
                type="password"
                placeholder="Parola tekrar"
                value={confirmPassword}
                onChange={(e) => { setConfirmPassword(e.target.value); setError(''); }}
              />
            </div>
            {error && <p style={{ color: 'var(--error, #dc2626)', marginBottom: 12, fontSize: 13 }}>{error}</p>}
            <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
              <button className="btn btn-ghost" onClick={() => { setError(''); setNewPassword(''); setConfirmPassword(''); setStep(1); }}>Geri</button>
              <button className="btn btn-ghost btn-sm" onClick={() => { setError(''); setStep(3); }}>Atla</button>
              <button className="btn btn-primary" disabled={saving} onClick={handlePasswordNext}>
                {saving ? 'Kaydediliyor…' : 'İleri'}
              </button>
            </div>
          </div>
        )}

        {/* Adım 3: Tamamlandı */}
        {step === 3 && (
          <div style={{ textAlign: 'center' }}>
            <div style={{ fontSize: 48, marginBottom: 16 }}>✅</div>
            <h2 style={{ marginBottom: 8 }}>Kurulum Tamamlandı</h2>
            {businessName && (
              <p style={{ color: 'var(--text-secondary, #666)', marginBottom: 8 }}>
                İşletme: <strong>{businessName}</strong>
              </p>
            )}
            <p style={{ color: 'var(--text-secondary, #666)', marginBottom: 24, fontSize: 14 }}>
              Yazıcı ve köprü ayarları için Ayarlar menüsünü kullanabilirsiniz.
            </p>
            {error && <p style={{ color: 'var(--error, #dc2626)', marginBottom: 12, fontSize: 13 }}>{error}</p>}
            <button className="btn btn-primary" disabled={saving} onClick={finish}>
              {saving ? 'Kaydediliyor…' : 'Uygulamayı Aç'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
