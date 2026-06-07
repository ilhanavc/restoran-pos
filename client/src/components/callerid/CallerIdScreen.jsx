import { useState, useEffect } from 'react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useIncomingCall } from '../../context/IncomingCallContext.jsx';
import { timeAgo } from '../../constants/index.js';
import {
  Phone, PhoneIncoming, PhoneOff, User, History,
} from 'lucide-react';

function getCallStatusLabel(status) {
  const labels = {
    ringing: 'Çalıyor',
    dismissed: 'Kapatıldı',
    opened_order: 'Siparişe Dönüştü',
    completed: 'Tamamlandı',
  };
  return labels[status] || status || '-';
}

export default function CallerIdScreen() {
  const [callHistory, setCallHistory] = useState([]);
  const [simulatePhone, setSimulatePhone] = useState('');
  const [loading, setLoading] = useState(false);
  const toast = useToast();
  const { refresh, openOrder } = useIncomingCall() || {};

  useEffect(() => {
    loadHistory();
  }, []);

  const loadHistory = async () => {
    try {
      const data = await api.getCallHistory();
      setCallHistory(data);
    } catch {
      /* ignore */
    }
  };

  const handleSimulateCall = async () => {
    if (!simulatePhone || simulatePhone.length < 4) {
      toast.error('Geçerli bir telefon numarası girin');
      return;
    }
    setLoading(true);
    try {
      await api.simulateIncomingCall(simulatePhone);
      setSimulatePhone('');
      loadHistory();
      if (refresh) refresh();
      toast.success('Arama simüle edildi — üstte bildirim görünecek');
    } catch (err) {
      toast.error(err.message);
    } finally {
      setLoading(false);
    }
  };

  return (
    <div style={{ height: '100%', display: 'flex', flexDirection: 'column' }}>
      <div className="page-top-safe" style={{ flex: 1, overflow: 'auto', paddingLeft: 24, paddingRight: 24, paddingBottom: 24 }}>
        <div className="card card-padded" style={{ marginBottom: 24 }}>
          <div style={{ fontSize: 13, fontWeight: 700, marginBottom: 12, display: 'flex', alignItems: 'center', gap: 8 }}>
            <PhoneIncoming size={16} color="var(--success)" />
            Gelen Arama Simülasyonu
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <input className="input" value={simulatePhone}
              onChange={e => setSimulatePhone(e.target.value)}
              placeholder="Telefon (ör: 05321234567, +90 532 111 22 33)"
              onKeyDown={e => e.key === 'Enter' && handleSimulateCall()}
              style={{ flex: 1 }} />
            <button className="btn btn-success" onClick={handleSimulateCall} disabled={loading}>
              <PhoneIncoming size={16} /> Simüle Et
            </button>
          </div>
          <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 8 }}>
            Demo müşteri: 05321234567 · Diğer: 05339876543, 05447654321
          </div>
        </div>

        <div>
          <h2 style={{ fontSize: 15, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 8 }}>
            <History size={16} /> Arama Geçmişi (call_logs)
          </h2>
          {callHistory.length === 0 ? (
            <div className="empty-state" style={{ padding: 32 }}>
              <Phone size={32} className="empty-state-icon" />
              <div className="empty-state-text">Henüz arama kaydı yok</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              {callHistory.map(call => {
                const orderOpened = Boolean(call.order_id || call.order_no || call.status === 'opened_order');
                return (
                <div key={call.id} className="card card-padded" style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{
                    width: 36, height: 36, borderRadius: '50%',
                    background: call.customer_id ? 'var(--success-muted)' : 'var(--warning-muted)',
                    display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
                  }}>
                    {call.customer_id ? <User size={16} color="var(--success)" /> : <PhoneOff size={16} color="var(--warning)" />}
                  </div>
                  <div style={{ flex: 1 }}>
                    <div style={{ fontWeight: 600, fontSize: 13 }}>
                      {call.customer_name_snapshot || call.customer_name || 'Bilinmeyen Arayan'}
                    </div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                      {call.phone} · {getCallStatusLabel(call.status)}
                      {call.order_no ? ` · Sipariş #${call.order_no}` : ''}
                    </div>
                  </div>
                  <div style={{ textAlign: 'right' }}>
                    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'flex-end', gap: 8, flexWrap: 'wrap' }}>
                      <span className={`badge ${call.customer_id ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: 10 }}>
                        {call.customer_id ? 'Kayıtlı' : 'Yeni'}
                      </span>
                      {!orderOpened && openOrder && (
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => openOrder(call)}>
                          Sipariş Al
                        </button>
                      )}
                    </div>
                    <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 4 }}>{timeAgo(call.created_at)}</div>
                  </div>
                </div>
              );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
