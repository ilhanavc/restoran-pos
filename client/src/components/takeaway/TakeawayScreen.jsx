import { useState, useEffect, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatTime, timeAgo, TAKEAWAY_STATUS } from '../../constants/index.js';
import { ArrowLeft, Package, Plus, Phone, Search, User, MapPin, Clock, RefreshCw } from 'lucide-react';

export default function TakeawayScreen({ onNewOrder }) {
  const navigate = useNavigate();
  const [orders, setOrders] = useState([]);
  const [loading, setLoading] = useState(true);
  const [customerSearch, setCustomerSearch] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [showNewOrder, setShowNewOrder] = useState(false);
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [selectedAddress, setSelectedAddress] = useState('');
  const [newCustomerMode, setNewCustomerMode] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ full_name: '', phone: '', address: '', address_title: 'Ev' });
  const toast = useToast();

  const loadOrders = useCallback(async () => {
    try {
      const data = await api.getOrders({ order_type: 'takeaway', limit: 50 });
      setOrders(data.filter(o => o.status !== 'closed'));
    } catch (err) {
      toast.error('Siparişler yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [toast]);

  useEffect(() => { loadOrders(); }, []);

  useEffect(() => {
    const interval = setInterval(loadOrders, 15000);
    return () => clearInterval(interval);
  }, [loadOrders]);

  const searchCustomer = async (query) => {
    setCustomerSearch(query);
    if (query.length >= 3) {
      try {
        const isPhone = /\d/.test(query);
        const results = await api.getCustomers(isPhone ? { phone: query } : { search: query });
        setSearchResults(results);
      } catch (err) {}
    } else {
      setSearchResults([]);
    }
  };

  const selectCustomer = (customer) => {
    setSelectedCustomer(customer);
    setSearchResults([]);
    setCustomerSearch('');
    const defaultAddr = customer.addresses?.find(a => a.is_default) || customer.addresses?.[0];
    if (defaultAddr) setSelectedAddress(defaultAddr.address);
  };

  const handleCreateCustomer = async () => {
    try {
      const cust = await api.createCustomer(newCustomer);
      setSelectedCustomer(cust);
      setSelectedAddress(newCustomer.address || '');
      setNewCustomerMode(false);
      setNewCustomer({ full_name: '', phone: '', address: '', address_title: 'Ev' });
      toast.success('Müşteri oluşturuldu');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleStartOrder = () => {
    onNewOrder({
      orderType: 'takeaway',
      customer: selectedCustomer ? { ...selectedCustomer, selectedAddress } : null,
    });
  };

  const getStatusBadge = (status) => {
    const st = TAKEAWAY_STATUS[status] || TAKEAWAY_STATUS.new;
    return <span className={`badge badge-${st.color}`}>{st.label}</span>;
  };

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* ═══ LEFT: Order List ═══ */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)' }}>
        <div style={{
          padding: '16px 24px', borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          flexShrink: 0,
        }}>
          <div>
            <button
              type="button"
              className="btn btn-ghost btn-sm takeaway-back-btn"
              onClick={() => navigate('/tables')}
            >
              <ArrowLeft size={14} />
              Masalara Dön
            </button>
            <h1 className="page-title" style={{ fontSize: 20 }}>
              <Package size={20} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />
              Paket Siparişler
            </h1>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
              {orders.length} aktif sipariş
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button className="btn btn-ghost btn-icon" onClick={loadOrders}><RefreshCw size={16} /></button>
            <button className="btn btn-primary" onClick={() => setShowNewOrder(true)}>
              <Plus size={16} /> Yeni Sipariş
            </button>
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {loading ? (
            <div className="empty-state">Yükleniyor...</div>
          ) : orders.length === 0 ? (
            <div className="empty-state" style={{ height: '50vh' }}>
              <Package size={48} className="empty-state-icon" />
              <div className="empty-state-title">Aktif paket sipariş yok</div>
            </div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
              {orders.map(order => (
                <div key={order.id} className="card card-padded" style={{ cursor: 'pointer' }}
                  onClick={() => onNewOrder({ orderType: 'takeaway', existingOrderId: order.id })}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', justifyContent: 'space-between' }}>
                    <div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4 }}>
                        <span style={{ fontWeight: 700, fontSize: 14 }}>#{order.order_no}</span>
                        {getStatusBadge(order.status)}
                      </div>
                      {order.customer_name && (
                        <div style={{ fontSize: 13, color: 'var(--text-secondary)', display: 'flex', alignItems: 'center', gap: 4 }}>
                          <User size={12} /> {order.customer_name}
                        </div>
                      )}
                      {order.delivery_address && (
                        <div style={{ fontSize: 11, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4, marginTop: 2 }}>
                          <MapPin size={10} /> {order.delivery_address}
                        </div>
                      )}
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: 16, fontWeight: 700 }}>{formatCurrency(order.grand_total)}</div>
                      <div style={{ fontSize: 10, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 3, justifyContent: 'flex-end', marginTop: 2 }}>
                        <Clock size={10} /> {timeAgo(order.created_at)}
                      </div>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* ═══ RIGHT: New Order Panel ═══ */}
      {showNewOrder && (
        <div style={{ width: 380, display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)' }}>
          <div style={{
            padding: '16px 20px', borderBottom: '1px solid var(--border)',
            display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          }}>
            <h2 style={{ fontSize: 15, fontWeight: 700 }}>Yeni Paket Sipariş</h2>
            <button className="btn btn-ghost btn-sm" onClick={() => { setShowNewOrder(false); setSelectedCustomer(null); }}>
              İptal
            </button>
          </div>

          <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
            {/* Customer Search */}
            <div style={{ marginBottom: 20 }}>
              <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Müşteri
              </label>

              {selectedCustomer ? (
                <div style={{
                  padding: 14, borderRadius: 'var(--radius-sm)',
                  background: 'var(--accent-muted)', border: '1px solid var(--accent)',
                }}>
                  <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{selectedCustomer.full_name}</div>
                  {selectedCustomer.phones?.map(p => (
                    <div key={p.id} style={{ fontSize: 12, color: 'var(--text-muted)', display: 'flex', alignItems: 'center', gap: 4 }}>
                      <Phone size={10} /> {p.phone}
                    </div>
                  ))}
                  {selectedCustomer.addresses?.length > 1 && (
                    <div style={{ marginTop: 8 }}>
                      <label style={{ fontSize: 10, color: 'var(--text-muted)' }}>Adres Seçin:</label>
                      {selectedCustomer.addresses.map(addr => (
                        <button key={addr.id}
                          className={`btn btn-sm ${selectedAddress === addr.address ? 'btn-primary' : 'btn-ghost'}`}
                          style={{ marginTop: 4, width: '100%', justifyContent: 'flex-start', fontSize: 11 }}
                          onClick={() => setSelectedAddress(addr.address)}>
                          <MapPin size={10} /> {addr.title}: {addr.address}
                        </button>
                      ))}
                    </div>
                  )}
                  {selectedAddress && selectedCustomer.addresses?.length <= 1 && (
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 4 }}>
                      <MapPin size={10} /> {selectedAddress}
                    </div>
                  )}
                  <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}
                    onClick={() => { setSelectedCustomer(null); setSelectedAddress(''); }}>
                    Değiştir
                  </button>
                </div>
              ) : (
                <>
                  <div style={{ position: 'relative' }}>
                    <Phone size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                    <input className="input" value={customerSearch}
                      onChange={e => searchCustomer(e.target.value)}
                      placeholder="Telefon veya ad ile ara..."
                      style={{ paddingLeft: 32 }} />
                  </div>

                  {searchResults.length > 0 && (
                    <div style={{
                      marginTop: 8, border: '1px solid var(--border)',
                      borderRadius: 'var(--radius-sm)', maxHeight: 200, overflow: 'auto',
                    }}>
                      {searchResults.map(c => (
                        <button key={c.id} onClick={() => selectCustomer(c)}
                          style={{
                            width: '100%', padding: '10px 14px', background: 'none',
                            border: 'none', borderBottom: '1px solid var(--border)',
                            cursor: 'pointer', textAlign: 'left', fontFamily: 'inherit',
                            color: 'var(--text-primary)',
                          }}>
                          <div style={{ fontWeight: 600, fontSize: 13 }}>{c.full_name}</div>
                          <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                            {c.phones?.map(p => p.phone).join(', ')}
                          </div>
                        </button>
                      ))}
                    </div>
                  )}

                  <button className="btn btn-ghost btn-sm" style={{ marginTop: 8 }}
                    onClick={() => setNewCustomerMode(!newCustomerMode)}>
                    <Plus size={14} /> Yeni Müşteri
                  </button>

                  {newCustomerMode && (
                    <div style={{ marginTop: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
                      <input className="input" placeholder="Ad Soyad" value={newCustomer.full_name}
                        onChange={e => setNewCustomer(p => ({ ...p, full_name: e.target.value }))} />
                      <input className="input" placeholder="Telefon" value={newCustomer.phone}
                        onChange={e => setNewCustomer(p => ({ ...p, phone: e.target.value }))} />
                      <input className="input" placeholder="Adres" value={newCustomer.address}
                        onChange={e => setNewCustomer(p => ({ ...p, address: e.target.value }))} />
                      <button className="btn btn-primary btn-sm" onClick={handleCreateCustomer}
                        disabled={!newCustomer.full_name || !newCustomer.phone}>
                        Müşteri Oluştur
                      </button>
                    </div>
                  )}
                </>
              )}
            </div>

            {/* Delivery Address override */}
            {selectedCustomer && (
              <div style={{ marginBottom: 20 }}>
                <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                  Teslimat Adresi
                </label>
                <textarea className="input" rows={2} value={selectedAddress}
                  onChange={e => setSelectedAddress(e.target.value)}
                  placeholder="Teslimat adresi..." />
              </div>
            )}
          </div>

          {/* Start Order Button */}
          <div style={{ padding: 20, borderTop: '1px solid var(--border)' }}>
            <button className="btn btn-primary btn-block btn-lg" onClick={handleStartOrder}>
              Sipariş Oluştur
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
