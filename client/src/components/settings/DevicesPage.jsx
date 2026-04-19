import { useState, useEffect, useCallback } from 'react';
import { Smartphone, Plus, Trash2, ToggleLeft, ToggleRight, RefreshCw, Copy, Check } from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';

function PlatformBadge({ platform }) {
  const map = { android: { label: 'Android', color: 'var(--green, #22c55e)' }, ios: { label: 'iOS', color: '#7c5af7' }, unknown: { label: 'Bilinmiyor', color: 'var(--text-muted)' } };
  const { label, color } = map[platform] || map.unknown;
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color, background: `${color}18`, border: `1px solid ${color}30`, borderRadius: 20, padding: '2px 9px' }}>
      {label}
    </span>
  );
}

function StatusBadge({ isActive }) {
  return (
    <span style={{ fontSize: 11, fontWeight: 700, color: isActive ? '#4ade80' : 'var(--text-muted)', background: isActive ? 'rgba(34,197,94,0.12)' : 'rgba(122,132,153,0.12)', border: `1px solid ${isActive ? 'rgba(34,197,94,0.3)' : 'rgba(122,132,153,0.2)'}`, borderRadius: 20, padding: '2px 9px' }}>
      {isActive ? 'Aktif' : 'Pasif'}
    </span>
  );
}

export default function DevicesPage() {
  const [devices, setDevices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [pairingToken, setPairingToken] = useState(null);
  const [copied, setCopied] = useState(false);
  const { toast } = useToast();

  const load = useCallback(async () => {
    try {
      setLoading(true);
      const data = await api.getDevices();
      setDevices(data);
    } catch {
      toast('Cihazlar yüklenemedi', 'error');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  async function handlePairingToken() {
    try {
      const data = await api.createPairingToken();
      setPairingToken(data);
    } catch {
      toast('Eşleştirme kodu oluşturulamadı', 'error');
    }
  }

  async function handleToggle(device) {
    try {
      await api.updateDevice(device.id, { is_active: !device.is_active });
      await load();
      toast(device.is_active ? 'Cihaz pasif yapıldı' : 'Cihaz aktif yapıldı', 'success');
    } catch {
      toast('Güncelleme başarısız', 'error');
    }
  }

  async function handleDelete(device) {
    try {
      await api.deleteDevice(device.id);
      setDevices((prev) => prev.filter((d) => d.id !== device.id));
      toast('Cihaz kaldırıldı', 'success');
    } catch {
      toast('Silme başarısız', 'error');
    }
  }

  function copyToken() {
    navigator.clipboard.writeText(pairingToken.token).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  const qrUrl = pairingToken
    ? `https://api.qrserver.com/v1/create-qr-code/?size=180x180&data=${encodeURIComponent(pairingToken.token)}`
    : null;

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-main page-title-line">
          <h1 className="page-title">
            <Smartphone size={22} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />
            Mobil Cihazlar
          </h1>
        </div>
        <div style={{ display: 'flex', gap: 8 }}>
          <button className="btn btn-secondary" onClick={load} disabled={loading}>
            <RefreshCw size={15} style={{ marginRight: 6 }} />
            Yenile
          </button>
          <button className="btn btn-primary" onClick={handlePairingToken}>
            <Plus size={15} style={{ marginRight: 6 }} />
            Yeni Cihaz Ekle
          </button>
        </div>
      </div>

      {/* Pairing token modal */}
      {pairingToken && (
        <div
          style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.6)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000 }}
          onClick={() => setPairingToken(null)}
        >
          <div
            className="card card-padded"
            style={{ width: 340, textAlign: 'center' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div style={{ fontWeight: 700, fontSize: 16, marginBottom: 4 }}>Cihaz Eşleştirme</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 20 }}>
              Garson uygulamasında bu kodu girin. 10 dakika geçerlidir.
            </div>

            {qrUrl && (
              <img src={qrUrl} alt="QR Kod" style={{ width: 180, height: 180, borderRadius: 8, marginBottom: 16, border: '1px solid var(--border)' }} />
            )}

            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 10, marginBottom: 16 }}>
              <span style={{ fontFamily: 'monospace', fontSize: 28, fontWeight: 800, letterSpacing: '0.15em', color: 'var(--accent)' }}>
                {pairingToken.token}
              </span>
              <button className="btn btn-secondary" style={{ padding: '6px 10px' }} onClick={copyToken}>
                {copied ? <Check size={14} color="var(--green)" /> : <Copy size={14} />}
              </button>
            </div>

            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 16 }}>
              Geçerlilik: {new Date(pairingToken.expires_at).toLocaleTimeString('tr-TR')}
            </div>

            <button className="btn btn-secondary" style={{ width: '100%' }} onClick={() => setPairingToken(null)}>
              Kapat
            </button>
          </div>
        </div>
      )}

      {/* Device list */}
      {loading ? (
        <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)' }}>Yükleniyor…</div>
      ) : devices.length === 0 ? (
        <div className="card card-padded" style={{ textAlign: 'center', padding: 48 }}>
          <Smartphone size={36} style={{ color: 'var(--text-muted)', marginBottom: 12 }} />
          <div style={{ fontWeight: 600, marginBottom: 6 }}>Kayıtlı cihaz yok</div>
          <div style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 20 }}>
            Garson uygulaması yüklü telefonları "Yeni Cihaz Ekle" ile kaydedin.
          </div>
          <button className="btn btn-primary" onClick={handlePairingToken}>
            <Plus size={15} style={{ marginRight: 6 }} />
            İlk Cihazı Ekle
          </button>
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse' }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)' }}>
                {['Cihaz Adı', 'Platform', 'Kullanıcı', 'Son Görülme', 'Durum', ''].map((h) => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {devices.map((d) => (
                <tr key={d.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '11px 14px', fontWeight: 600, fontSize: 13 }}>{d.device_name}</td>
                  <td style={{ padding: '11px 14px' }}><PlatformBadge platform={d.platform} /></td>
                  <td style={{ padding: '11px 14px', fontSize: 13, color: 'var(--text-secondary)' }}>
                    <div>{d.user_name}</div>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>{d.user_email}</div>
                  </td>
                  <td style={{ padding: '11px 14px', fontSize: 12, color: 'var(--text-muted)' }}>
                    {d.last_seen_at ? new Date(d.last_seen_at).toLocaleString('tr-TR') : '—'}
                  </td>
                  <td style={{ padding: '11px 14px' }}><StatusBadge isActive={Boolean(d.is_active)} /></td>
                  <td style={{ padding: '11px 14px' }}>
                    <div style={{ display: 'flex', gap: 6, justifyContent: 'flex-end' }}>
                      <button
                        className="btn btn-secondary"
                        style={{ padding: '5px 8px' }}
                        title={d.is_active ? 'Pasif yap' : 'Aktif yap'}
                        onClick={() => handleToggle(d)}
                      >
                        {d.is_active ? <ToggleRight size={15} color="var(--accent)" /> : <ToggleLeft size={15} />}
                      </button>
                      <button
                        className="btn btn-danger"
                        style={{ padding: '5px 8px' }}
                        title="Cihazı kaldır"
                        onClick={() => handleDelete(d)}
                      >
                        <Trash2 size={15} />
                      </button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}
