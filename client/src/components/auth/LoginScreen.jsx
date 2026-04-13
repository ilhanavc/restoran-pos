import { useState } from 'react';
import { useAuth } from '../../context/AuthContext.jsx';
import { Lock, Mail, Loader } from 'lucide-react';

export default function LoginScreen() {
  const { login } = useAuth();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [loading, setLoading] = useState(false);
  const [businesses, setBusinesses] = useState(null);
  const [selectedBusinessId, setSelectedBusinessId] = useState('');

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      await login(email, password, selectedBusinessId || undefined);
      setBusinesses(null);
    } catch (err) {
      if (err.requireBusinessId && err.businesses?.length) {
        setBusinesses(err.businesses);
        setSelectedBusinessId(err.businesses[0].id);
        setError(err.message || 'İşletme seçin');
      } else {
        setBusinesses(null);
        setError(err.message || 'Giriş başarısız');
      }
    } finally {
      setLoading(false);
    }
  };

  const quickLogin = async (em) => {
    setEmail(em);
    setPassword('123456');
    setError('');
    setBusinesses(null);
    setSelectedBusinessId('');
    setLoading(true);
    try {
      await login(em, '123456');
    } catch (err) {
      setError(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'center',
      minHeight: '100vh', background: 'var(--bg-page)',
      padding: '20px',
    }}>
      <div style={{ width: '100%', maxWidth: 420 }}>
        {/* Logo */}
        <div style={{ textAlign: 'center', marginBottom: 40 }}>
          <div style={{
            width: 64, height: 64, borderRadius: 'var(--radius-lg)',
            background: 'linear-gradient(135deg, var(--accent), var(--accent-gradient-end))',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 28, fontWeight: 800, color: 'white', marginBottom: 16,
          }}>P</div>
          <h1 style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.03em' }}>Restoran POS</h1>
          <p style={{ color: 'var(--text-muted)', marginTop: 6, fontSize: 14 }}>Hesabınıza giriş yapın</p>
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} className="card" style={{ padding: 28 }}>
          {error && (
            <div style={{
              padding: '10px 14px', borderRadius: 'var(--radius-sm)',
              background: 'var(--danger-muted)', color: 'var(--danger)',
              fontSize: 13, marginBottom: 18, fontWeight: 500,
            }}>{error}</div>
          )}

          <div style={{ marginBottom: 16 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>E-posta</label>
            <div style={{ position: 'relative' }}>
              <Mail size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input className="input" type="email" value={email} onChange={e => setEmail(e.target.value)}
                placeholder="ornek@restoran.com" style={{ paddingLeft: 38 }} autoComplete="email" />
            </div>
          </div>

          {businesses && businesses.length > 0 && (
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>İşletme</label>
              <select
                className="input"
                value={selectedBusinessId}
                onChange={e => setSelectedBusinessId(e.target.value)}
                style={{ width: '100%' }}
              >
                {businesses.map(b => (
                  <option key={b.id} value={b.id}>{b.name}</option>
                ))}
              </select>
            </div>
          )}

          <div style={{ marginBottom: 24 }}>
            <label style={{ display: 'block', fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', marginBottom: 6 }}>Şifre</label>
            <div style={{ position: 'relative' }}>
              <Lock size={16} style={{ position: 'absolute', left: 12, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
              <input className="input" type="password" value={password} onChange={e => setPassword(e.target.value)}
                placeholder="••••••" style={{ paddingLeft: 38 }} />
            </div>
          </div>

          <button type="submit" className="btn btn-primary btn-block btn-lg" disabled={loading}>
            {loading ? <Loader size={18} style={{ animation: 'spin 1s linear infinite' }} /> : 'Giriş Yap'}
          </button>
        </form>

        {/* Quick Login */}
        <div style={{ marginTop: 24 }}>
          <p style={{ textAlign: 'center', fontSize: 11, color: 'var(--text-muted)', marginBottom: 12, textTransform: 'uppercase', letterSpacing: '0.08em', fontWeight: 600 }}>
            Demo Hızlı Giriş
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {[
              { label: 'Yönetici', email: 'admin@demo.com', color: 'var(--accent)' },
              { label: 'Kasiyer', email: 'kasiyer@demo.com', color: 'var(--success)' },
              { label: 'Garson', email: 'garson@demo.com', color: 'var(--warning)' },
              { label: 'Mutfak', email: 'mutfak@demo.com', color: 'var(--orange)' },
            ].map(q => (
              <button key={q.email} className="btn btn-ghost btn-sm" onClick={() => quickLogin(q.email)}
                style={{ justifyContent: 'flex-start', gap: 8 }}>
                <div style={{ width: 8, height: 8, borderRadius: '50%', background: q.color, flexShrink: 0 }} />
                <span>{q.label}</span>
              </button>
            ))}
          </div>
        </div>
      </div>

      <style>{`@keyframes spin { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }`}</style>
    </div>
  );
}
