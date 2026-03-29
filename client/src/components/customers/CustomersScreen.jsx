import { useState, useEffect } from 'react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, formatDateTime } from '../../constants/index.js';
import { Users, Search, Phone, MapPin, Plus, X, ShoppingBag } from 'lucide-react';

export default function CustomersScreen() {
  const [customers, setCustomers] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(null);
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => { loadCustomers(); }, []);

  const loadCustomers = async (params = {}) => {
    try {
      const data = await api.getCustomers(params);
      setCustomers(data);
    } catch (err) {
      toast.error('Müşteriler yüklenemedi');
    } finally {
      setLoading(false);
    }
  };

  const handleSearch = (q) => {
    setSearchQuery(q);
    if (q.length >= 2) {
      const isPhone = /\d/.test(q);
      loadCustomers(isPhone ? { phone: q } : { search: q });
    } else if (q === '') {
      loadCustomers();
    }
  };

  const viewCustomer = async (id) => {
    try {
      const detail = await api.getCustomer(id);
      setSelectedCustomer(detail);
    } catch (err) {
      toast.error('Müşteri bilgisi yüklenemedi');
    }
  };

  return (
    <div style={{ display: 'flex', height: '100%' }}>
      {/* List */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '16px 24px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <h1 className="page-title" style={{ fontSize: 20, marginBottom: 12 }}>
            <Users size={20} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />
            Müşteriler
          </h1>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input className="input" placeholder="Ad veya telefon ile ara..."
              value={searchQuery} onChange={e => handleSearch(e.target.value)}
              style={{ paddingLeft: 34 }} />
          </div>
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          {customers.map(cust => (
            <div key={cust.id} className="card card-padded" style={{ marginBottom: 8, cursor: 'pointer' }}
              onClick={() => viewCustomer(cust.id)}>
              <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 'var(--radius-sm)',
                  background: 'var(--accent-muted)', display: 'flex',
                  alignItems: 'center', justifyContent: 'center',
                  fontSize: 16, fontWeight: 800, color: 'var(--accent)', flexShrink: 0,
                }}>
                  {cust.full_name?.charAt(0)}
                </div>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontWeight: 600, fontSize: 14 }}>{cust.full_name}</div>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                    {cust.phones?.map(p => p.phone).join(' • ')}
                  </div>
                </div>
                <div style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-muted)' }}>
                  {cust.total_orders || 0} sipariş
                </div>
              </div>
            </div>
          ))}
          {customers.length === 0 && !loading && (
            <div className="empty-state">
              <Users size={32} className="empty-state-icon" />
              <div className="empty-state-text">Müşteri bulunamadı</div>
            </div>
          )}
        </div>
      </div>

      {/* Detail */}
      {selectedCustomer && (
        <div style={{ width: 380, borderLeft: '1px solid var(--border)', background: 'var(--bg-secondary)', display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'space-between' }}>
            <h2 style={{ fontSize: 15, fontWeight: 700 }}>Müşteri Detayı</h2>
            <button className="btn btn-ghost btn-icon" onClick={() => setSelectedCustomer(null)}><X size={16} /></button>
          </div>
          <div style={{ flex: 1, overflow: 'auto', padding: 20 }}>
            <div style={{ textAlign: 'center', marginBottom: 20 }}>
              <div style={{
                width: 56, height: 56, borderRadius: 'var(--radius-md)',
                background: 'var(--accent-muted)', display: 'inline-flex',
                alignItems: 'center', justifyContent: 'center',
                fontSize: 22, fontWeight: 800, color: 'var(--accent)', marginBottom: 8,
              }}>
                {selectedCustomer.full_name?.charAt(0)}
              </div>
              <div style={{ fontSize: 18, fontWeight: 700 }}>{selectedCustomer.full_name}</div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{selectedCustomer.total_orders || 0} sipariş</div>
            </div>

            {/* Phones */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Telefon</div>
              {selectedCustomer.phones?.map(p => (
                <div key={p.id} style={{ fontSize: 13, marginBottom: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                  <Phone size={12} color="var(--text-muted)" /> {p.phone}
                </div>
              ))}
            </div>

            {/* Addresses */}
            <div style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Adresler</div>
              {selectedCustomer.addresses?.map(addr => (
                <div key={addr.id} style={{ fontSize: 12, marginBottom: 6, padding: '8px 10px', background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)' }}>
                  <div style={{ fontWeight: 600, fontSize: 11, color: 'var(--text-muted)' }}>{addr.title}</div>
                  <div>{addr.address}</div>
                </div>
              ))}
            </div>

            {/* Note */}
            {selectedCustomer.note && (
              <div style={{ fontSize: 12, padding: '8px 10px', background: 'var(--warning-muted)', borderRadius: 'var(--radius-sm)', marginBottom: 16 }}>
                📝 {selectedCustomer.note}
              </div>
            )}

            {/* Recent Orders */}
            {selectedCustomer.recentOrders?.length > 0 && (
              <div>
                <div style={{ fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 6 }}>Son Siparişler</div>
                {selectedCustomer.recentOrders.map(order => (
                  <div key={order.id} style={{
                    padding: '8px 10px', background: 'var(--bg-tertiary)',
                    borderRadius: 'var(--radius-sm)', marginBottom: 6, fontSize: 12,
                  }}>
                    <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                      <span style={{ fontWeight: 600 }}>#{order.order_no}</span>
                      <span style={{ fontWeight: 700 }}>{formatCurrency(order.grand_total)}</span>
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 10, marginTop: 2 }}>
                      {order.items_summary?.substring(0, 50)}
                    </div>
                    <div style={{ color: 'var(--text-muted)', fontSize: 10 }}>{formatDateTime(order.created_at)}</div>
                  </div>
                ))}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
