import { useState, useEffect, useCallback, useRef } from 'react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';
import { formatTime, timeAgo, ORDER_STATUS, parseDbTimestampMs } from '../../constants/index.js';
import { RefreshCw, Clock, Package, ChefHat, Check, AlertCircle } from 'lucide-react';

/** Web Audio API ile kısa bip sesi çalar */
function playBeep() {
  try {
    const ctx = new (window.AudioContext || window.webkitAudioContext)();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain);
    gain.connect(ctx.destination);
    osc.type = 'sine';
    osc.frequency.value = 880;
    gain.gain.setValueAtTime(0.4, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.4);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.4);
    osc.onended = () => ctx.close();
  } catch {}
}

/** Sipariş yaşına göre (dakika) renk döner */
function ageColor(createdAt, now) {
  if (!createdAt) return null;
  const createdMs = parseDbTimestampMs(createdAt);
  if (!Number.isFinite(createdMs)) return null;
  const mins = (now - createdMs) / 60000;
  if (mins > 20) return { border: 'var(--danger)', bg: 'var(--danger-muted)' };
  if (mins > 10) return { border: 'var(--warning)', bg: 'var(--warning-muted)' };
  return null;
}

export default function KitchenScreen() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [now, setNow] = useState(Date.now());
  const prevOrderIds = useRef(new Set());
  const toast = useToast();
  const { isConnected, subscribe } = useSocket();

  const loadOrders = useCallback(async () => {
    try {
      const data = await api.getActiveOrders();
      // Yeni sipariş geldi mi? → bip
      const newIds = new Set(data.map(o => o.id));
      const hasNew = data.some(o => !prevOrderIds.current.has(o.id));
      if (prevOrderIds.current.size > 0 && hasNew) playBeep();
      prevOrderIds.current = newIds;
      setOrders(data);
    } catch (err) {
      toast.error('Siparişler yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadOrders(); }, []);

  // Saniye sayacı — yaş renklerini canlı günceller
  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 10000);
    return () => clearInterval(t);
  }, []);

  // Socket: sipariş değişikliklerini anlık dinle
  useEffect(() => {
    const events = ['order:created', 'order:updated', 'order:item_updated', 'order:items_added'];
    const unsubs = events.map(ev => subscribe(ev, () => loadOrders()));
    return () => unsubs.forEach(fn => fn());
  }, [subscribe, loadOrders]);

  // Fallback polling: socket kopuksa 30s'de bir
  useEffect(() => {
    if (isConnected) return;
    const interval = setInterval(loadOrders, 30000);
    return () => clearInterval(interval);
  }, [isConnected, loadOrders]);

  const updateItemStatus = async (orderId, itemId, status) => {
    try {
      await api.updateOrderItem(orderId, itemId, { status });
      loadOrders();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const markOrderReady = async (orderId) => {
    try {
      await api.updateOrderStatus(orderId, 'ready');
      toast.success('Sipariş hazır!');
      loadOrders();
    } catch (err) {
      toast.error(err.message);
    }
  };

  return (
    <div className="page-container" style={{ height: '100%', display: 'flex', flexDirection: 'column', padding: 0 }}>
      {/* Header */}
      <div style={{
        padding: '14px 24px', borderBottom: '1px solid var(--border)',
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        background: 'var(--bg-secondary)', flexShrink: 0,
      }}>
        <div>
          <h1 style={{ fontSize: 20, fontWeight: 800 }}>
            <ChefHat size={22} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />
            Mutfak Ekranı
          </h1>
          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
            {orders.length} aktif sipariş
          </div>
        </div>
        <button className="btn btn-ghost" onClick={loadOrders}>
          <RefreshCw size={16} /> Yenile
        </button>
      </div>

      {/* Orders Grid */}
      <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
        {loading ? (
          <div className="empty-state">Yükleniyor...</div>
        ) : orders.length === 0 ? (
          <div className="empty-state" style={{ height: '60vh' }}>
            <ChefHat size={48} className="empty-state-icon" />
            <div className="empty-state-title">Bekleyen sipariş yok</div>
            <div className="empty-state-text">Yeni siparişler buraya otomatik gelecek</div>
          </div>
        ) : (
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(320px, 1fr))',
            gap: 14,
          }}>
            {orders.map(order => {
              const isNew = order.status === 'in_kitchen';
              const items = (order.items || []).filter(i => i.status !== 'cancelled');
              const allReady = items.every(i => i.status === 'ready' || i.status === 'served');
              const age = ageColor(order.created_at, now);

              // Renk önceliği: yaş > yeni sipariş > varsayılan
              const cardBorder = age ? age.border : isNew ? 'var(--warning)' : 'var(--border)';
              const headerBg = age?.bg ?? (isNew ? 'var(--warning-muted)' : 'var(--bg-tertiary)');

              return (
                <div key={order.id} className="card" style={{
                  borderColor: cardBorder,
                  borderWidth: isNew || age ? 2 : 1,
                  animation: isNew && !age ? 'pulse 2s ease-in-out 3' : 'none',
                }}>
                  {/* Order Header */}
                  <div style={{
                    padding: '12px 16px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: headerBg,
                    borderBottom: '1px solid var(--border)',
                  }}>
                    <div>
                      <span style={{ fontWeight: 700, fontSize: 16 }}>
                        {order.order_type === 'takeaway' ? (
                          <><Package size={14} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 4 }} /> Paket</>
                        ) : (
                          <>Masa {order.table_name || '?'}</>
                        )}
                      </span>
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>#{order.order_no}</span>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: age ? age.border : 'var(--text-muted)', fontWeight: age ? 700 : 400 }}>
                      <Clock size={12} />
                      {timeAgo(order.created_at, now)}
                      {age && <AlertCircle size={12} />}
                    </div>
                  </div>

                  {/* Items */}
                  <div style={{ padding: '8px 0' }}>
                    {items.map(item => {
                      const mods = JSON.parse(item.modifiers || '[]');
                      const isItemReady = item.status === 'ready';

                      return (
                        <div key={item.id} style={{
                          padding: '8px 16px',
                          display: 'flex', alignItems: 'flex-start', gap: 10,
                          opacity: isItemReady ? 0.5 : 1,
                        }}>
                          <span style={{
                            fontSize: 16, fontWeight: 800,
                            color: 'var(--accent)', minWidth: 28,
                          }}>
                            {item.quantity}x
                          </span>
                          <div style={{ flex: 1 }}>
                            <div style={{
                              fontSize: 15, fontWeight: 700,
                              textDecoration: isItemReady ? 'line-through' : 'none',
                            }}>
                              {item.product_name}
                            </div>
                            {mods.length > 0 && (
                              <div style={{ fontSize: 12, color: 'var(--warning)', fontWeight: 600, marginTop: 2 }}>
                                {mods.map(m => m.name).join(', ')}
                              </div>
                            )}
                            {item.note && (
                              <div style={{
                                fontSize: 12, color: 'var(--danger)', fontWeight: 600,
                                marginTop: 3, display: 'flex', alignItems: 'center', gap: 4,
                              }}>
                                <AlertCircle size={11} /> {item.note}
                              </div>
                            )}
                          </div>
                          {!isItemReady && (
                            <button className="btn btn-success btn-sm"
                              onClick={() => updateItemStatus(order.id, item.id, 'ready')}
                              style={{ padding: '4px 10px' }}>
                              <Check size={13} /> Hazır
                            </button>
                          )}
                        </div>
                      );
                    })}
                  </div>

                  {/* Footer */}
                  <div style={{ padding: '10px 16px', borderTop: '1px solid var(--border)' }}>
                    <button className="btn btn-success btn-block"
                      onClick={() => markOrderReady(order.id)}
                      disabled={!allReady && items.length > 0}>
                      <Check size={16} /> Sipariş Tamam
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
