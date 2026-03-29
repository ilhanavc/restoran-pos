import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatTime, timeAgo, ORDER_STATUS } from '../../constants/index.js';
import { RefreshCw, Clock, Package, ChefHat, Check, AlertCircle } from 'lucide-react';

export default function KitchenScreen() {
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  const loadOrders = useCallback(async () => {
    try {
      const data = await api.getActiveOrders();
      setOrders(data);
    } catch (err) {
      toast.error('Siparişler yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadOrders(); }, []);

  // Auto-refresh every 10s
  useEffect(() => {
    const interval = setInterval(loadOrders, 10000);
    return () => clearInterval(interval);
  }, [loadOrders]);

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

              return (
                <div key={order.id} className="card" style={{
                  borderColor: isNew ? 'var(--warning)' : 'var(--border)',
                  borderWidth: isNew ? 2 : 1,
                  animation: isNew ? 'pulse 2s ease-in-out 3' : 'none',
                }}>
                  {/* Order Header */}
                  <div style={{
                    padding: '12px 16px',
                    display: 'flex', alignItems: 'center', justifyContent: 'space-between',
                    background: isNew ? 'var(--warning-muted)' : 'var(--bg-tertiary)',
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
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 11, color: 'var(--text-muted)' }}>
                      <Clock size={12} />
                      {timeAgo(order.created_at)}
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
