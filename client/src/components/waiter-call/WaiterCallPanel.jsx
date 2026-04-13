/**
 * Garson çağırma modülü:
 *  - Bekleyen çağrıları listele + çözümle (Sidebar badge + açılır panel)
 *  - QR kod kurulum ekranı (admin/kasiyer için)
 *
 * Socket.io 'waiter_call' event'ini dinler; yeni çağrıda toast + badge günceller.
 */
import { useState, useEffect, useCallback, useRef } from 'react';
import { Bell, X, QrCode, Copy, Check, ChevronDown, ChevronUp } from 'lucide-react';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../services/api.js';
import { useSocket } from '../../context/SocketContext.jsx';

// ── QR generator (canvas, saf JS — harici kütüphane gerektirmez) ─────────────
// Basit, sınırlı QR implementasyonu yerine tarayıcı API ile URL oluşturup
// kullanıcıya kopyalama + masaüstü QR oluşturma linki sunuyoruz.
// Gerçek QR görüntüsü için 'qrcode' kütüphanesi eklenebilir.

function buildCallUrl(baseUrl, tableId, businessId, token) {
  const u = new URL('/api/waiter-call/call', baseUrl);
  u.searchParams.set('t', tableId);
  u.searchParams.set('b', businessId);
  u.searchParams.set('k', token);
  return u.toString();
}

// ── QR Kurulum Modal ──────────────────────────────────────────────────────────

function QrSetupModal({ onClose }) {
  const [setup, setSetup] = useState(null);
  const [baseUrl, setBaseUrl] = useState('');
  const [selectedTable, setSelectedTable] = useState(null);
  const [copied, setCopied] = useState(false);
  const [loading, setLoading] = useState(true);
  const { user } = useAuth();
  const toast = useToast();

  useEffect(() => {
    api.getWaiterCallSetup().then(data => {
      setSetup(data);
      // Varsayılan base URL: mevcut origin (LAN IP ile erişildiyse otomatik doğru)
      setBaseUrl(window.location.origin);
      if (data.tables?.length) setSelectedTable(data.tables[0]);
    }).catch(() => toast.error('QR kurulum verisi alınamadı'))
      .finally(() => setLoading(false));
  }, []);

  const callUrl = setup && selectedTable
    ? buildCallUrl(baseUrl, selectedTable.id, user?.businessId || '', setup.token)
    : '';

  const copyUrl = () => {
    navigator.clipboard.writeText(callUrl).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  };

  return (
    <div style={{
      position: 'fixed', inset: 0, background: 'var(--bg-overlay)',
      display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000,
    }}>
      <div className="card card-padded" style={{ width: 560, maxHeight: '90vh', overflowY: 'auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 16 }}>
          <h2 style={{ fontSize: 16, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 8 }}>
            <QrCode size={18} /> Garson Çağırma QR Kodları
          </h2>
          <button type="button" className="btn btn-ghost btn-sm" onClick={onClose}>
            <X size={16} />
          </button>
        </div>

        {loading ? (
          <div className="empty-state">Yükleniyor...</div>
        ) : !setup ? (
          <div className="empty-state">Veri alınamadı</div>
        ) : (
          <>
            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>
                Sunucu Adresi (LAN IP ile güncelleyin)
              </label>
              <input
                type="text"
                className="input"
                value={baseUrl}
                onChange={e => setBaseUrl(e.target.value)}
                placeholder="http://192.168.1.100:3001"
                style={{ width: '100%', fontFamily: 'monospace', fontSize: 13 }}
              />
              <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                Telefonun QR kodu okuyabilmesi için restoranın Wi-Fi IP adresini girin.
                Örn: <code>http://192.168.1.100:3001</code>
              </p>
            </div>

            <div style={{ marginBottom: 16 }}>
              <label style={{ display: 'block', fontSize: 12, color: 'var(--text-muted)', marginBottom: 6 }}>
                Masa Seç
              </label>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {setup.tables.map(t => (
                  <button
                    key={t.id}
                    type="button"
                    className={`btn btn-sm ${selectedTable?.id === t.id ? 'btn-primary' : 'btn-ghost'}`}
                    onClick={() => setSelectedTable(t)}
                    style={{ fontSize: 12 }}
                  >
                    {t.name}
                  </button>
                ))}
              </div>
            </div>

            {selectedTable && callUrl && (
              <div style={{ background: 'var(--surface-2)', borderRadius: 8, padding: 16, marginBottom: 16 }}>
                <div style={{ fontSize: 12, fontWeight: 600, marginBottom: 8 }}>
                  {selectedTable.area_name} — {selectedTable.name} Çağrı URL'si
                </div>
                <div style={{ display: 'flex', gap: 8, alignItems: 'center' }}>
                  <input
                    readOnly
                    className="input input-sm"
                    value={callUrl}
                    style={{ flex: 1, fontFamily: 'monospace', fontSize: 11 }}
                  />
                  <button type="button" className="btn btn-ghost btn-sm" onClick={copyUrl} title="Kopyala">
                    {copied ? <Check size={14} color="var(--success)" /> : <Copy size={14} />}
                  </button>
                </div>
                <p style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
                  Bu URL'yi QR oluşturucu (qr-code-generator.com vb.) ile QR koda dönüştürüp masaya yapıştırın.
                  Veya: <a
                    href={`https://api.qrserver.com/v1/create-qr-code/?size=200x200&data=${encodeURIComponent(callUrl)}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    style={{ color: 'var(--accent)' }}
                  >QR kodu görüntüle</a>
                </p>
              </div>
            )}

            <div style={{ fontSize: 11, color: 'var(--text-muted)', padding: '10px 0', borderTop: '1px solid var(--border)' }}>
              <strong>Token:</strong> <code style={{ fontSize: 10 }}>{setup.token}</code>
              <br />Token güvenli tutun — QR kodun çalışması için gereklidir.
            </div>
          </>
        )}
      </div>
    </div>
  );
}

// ── Çağrı listesi satırı ──────────────────────────────────────────────────────

function CallRow({ call, onResolve }) {
  const elapsed = Math.floor((Date.now() - new Date(call.createdAt || call.created_at).getTime()) / 60000);
  return (
    <div style={{
      display: 'flex', alignItems: 'center', justifyContent: 'space-between',
      padding: '8px 12px', borderBottom: '1px solid var(--border)',
    }}>
      <div>
        <span style={{ fontWeight: 600, fontSize: 13 }}>{call.tableName || call.table_name}</span>
        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
          {elapsed === 0 ? 'Az önce' : `${elapsed} dk önce`}
        </span>
      </div>
      <button
        type="button"
        className="btn btn-success btn-sm"
        onClick={() => onResolve(call.id)}
        style={{ fontSize: 11 }}
      >
        Gidildi
      </button>
    </div>
  );
}

// ── Ana bileşen ───────────────────────────────────────────────────────────────

export default function WaiterCallPanel() {
  const [calls, setCalls] = useState([]);
  const [open, setOpen] = useState(false);
  const [showQr, setShowQr] = useState(false);
  const { hasRole } = useAuth();
  const toast = useToast();
  const { subscribe } = useSocket();
  const panelRef = useRef(null);

  const loadPending = useCallback(async () => {
    try {
      const data = await api.getWaiterCallPending();
      setCalls(data.calls || []);
    } catch {
      // sessiz — sidebar'da hata gösterme
    }
  }, []);

  useEffect(() => {
    loadPending();
  }, [loadPending]);

  // Socket.io: yeni çağrı
  useEffect(() => {
    return subscribe('waiter_call', (payload) => {
      setCalls(prev => {
        if (prev.some(c => c.id === payload.id)) return prev;
        return [...prev, payload];
      });
      toast.warn(`🔔 ${payload.tableName} garson istiyor`);
      setOpen(true);
    });
  }, [subscribe, toast]);

  // Socket.io: çağrı çözümlendi (başka terminalde)
  useEffect(() => {
    return subscribe('waiter_call:resolved', ({ id }) => {
      setCalls(prev => prev.filter(c => c.id !== id));
    });
  }, [subscribe]);

  // Panel dışına tıklanınca kapat
  useEffect(() => {
    if (!open) return;
    const handler = (e) => {
      if (panelRef.current && !panelRef.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open]);

  const resolve = async (id) => {
    try {
      await api.resolveWaiterCall(id);
      setCalls(prev => prev.filter(c => c.id !== id));
    } catch {
      toast.error('Çağrı çözümlenemedi');
    }
  };

  const pendingCount = calls.length;

  return (
    <>
      {/* Sidebar butonu */}
      <div ref={panelRef} style={{ position: 'relative' }}>
        <button
          type="button"
          className={`sidebar-item ${open ? 'active' : ''}`}
          onClick={() => setOpen(v => !v)}
          title={pendingCount > 0 ? `${pendingCount} garson çağrısı` : 'Garson çağrıları'}
          style={{ position: 'relative' }}
        >
          <Bell size={20} strokeWidth={open ? 2.2 : 1.8} />
          <span className="sidebar-item-label">Çağrılar</span>
          {pendingCount > 0 && (
            <span style={{
              position: 'absolute', top: 6, right: 6,
              background: 'var(--danger)', color: 'var(--text-on-accent)',
              borderRadius: '999px', fontSize: 10, fontWeight: 700,
              minWidth: 16, height: 16, display: 'flex', alignItems: 'center', justifyContent: 'center',
              padding: '0 4px',
            }}>
              {pendingCount}
            </span>
          )}
          {open ? <ChevronUp size={12} /> : <ChevronDown size={12} />}
        </button>

        {open && (
          <div style={{
            position: 'absolute', left: '100%', top: 0, marginLeft: 4,
            background: 'var(--surface)', border: '1px solid var(--border)',
            borderRadius: 'var(--radius-md)', boxShadow: 'var(--shadow-soft)',
            width: 280, zIndex: 200,
          }}>
            <div style={{
              display: 'flex', alignItems: 'center', justifyContent: 'space-between',
              padding: '10px 12px', borderBottom: '1px solid var(--border)',
            }}>
              <span style={{ fontSize: 13, fontWeight: 700 }}>
                Garson Çağrıları {pendingCount > 0 && `(${pendingCount})`}
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                {hasRole('admin', 'cashier') && (
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setShowQr(true)}
                    title="QR Kodları Yönet"
                    style={{ padding: '2px 6px' }}
                  >
                    <QrCode size={13} />
                  </button>
                )}
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setOpen(false)} style={{ padding: '2px 6px' }}>
                  <X size={13} />
                </button>
              </div>
            </div>

            {calls.length === 0 ? (
              <div className="empty-state" style={{ padding: 20, fontSize: 13 }}>
                Bekleyen garson çağrısı yok
              </div>
            ) : (
              calls.map(call => (
                <CallRow key={call.id} call={call} onResolve={resolve} />
              ))
            )}
          </div>
        )}
      </div>

      {showQr && <QrSetupModal onClose={() => setShowQr(false)} />}
    </>
  );
}
