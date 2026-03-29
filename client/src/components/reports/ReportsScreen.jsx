import { useState, useEffect } from 'react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency } from '../../constants/index.js';
import { BarChart3, TrendingUp, CreditCard, ShoppingBag, Award, Calendar, Receipt } from 'lucide-react';

export default function ReportsScreen() {
  const [report, setReport] = useState(null);
  const [closedOrders, setClosedOrders] = useState([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  const toast = useToast();

  useEffect(() => { loadReport(); }, [selectedDate]);

  const loadReport = async () => {
    setLoading(true);
    try {
      const [data, closed] = await Promise.all([
        api.getDailyReport(selectedDate),
        api.getClosedOrders(selectedDate),
      ]);
      setReport(data);
      setClosedOrders(closed.orders || []);
    } catch (err) {
      toast.error('Rapor yüklenemedi');
    } finally {
      setLoading(false);
    }
  };

  const paymentLabel = { cash: 'Nakit', card: 'Kart', mixed: 'Karışık', other: 'Diğer' };

  return (
    <div className="page-container">
      <div className="page-header">
        <div>
          <h1 className="page-title">
            <BarChart3 size={22} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />
            Raporlar
          </h1>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <Calendar size={16} color="var(--text-muted)" />
          <input type="date" className="input" value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)}
            style={{ width: 180 }} />
        </div>
      </div>

      {loading ? (
        <div className="empty-state">Yükleniyor...</div>
      ) : report ? (
        <>
          {/* Stat Cards */}
          <div className="stat-grid">
            <div className="stat-card">
              <div className="stat-card-label">Toplam Gelir</div>
              <div className="stat-card-value" style={{ color: 'var(--success)' }}>{formatCurrency(report.revenue)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">Toplam Sipariş</div>
              <div className="stat-card-value">{report.orderStats?.total_orders || 0}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">Ort. Sipariş Tutarı</div>
              <div className="stat-card-value">{formatCurrency(report.avgOrderValue)}</div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">Masa / Paket</div>
              <div className="stat-card-value" style={{ fontSize: 18 }}>
                {report.orderStats?.dine_in_count || 0} / {report.orderStats?.takeaway_count || 0}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">İndirimler</div>
              <div className="stat-card-value" style={{ color: 'var(--danger)', fontSize: 18 }}>
                {formatCurrency(report.orderStats?.total_discounts || 0)}
              </div>
            </div>
            <div className="stat-card">
              <div className="stat-card-label">İptal</div>
              <div className="stat-card-value" style={{ fontSize: 18 }}>{report.orderStats?.cancelled_count || 0}</div>
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 8 }}>
            {/* Payment Breakdown */}
            <div className="card card-padded">
              <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                <CreditCard size={14} /> Ödeme Dağılımı
              </h3>
              {report.paymentBreakdown?.length > 0 ? (
                <table className="data-table">
                  <thead><tr><th>Tip</th><th>Adet</th><th className="text-right">Tutar</th></tr></thead>
                  <tbody>
                    {report.paymentBreakdown.map(p => (
                      <tr key={p.payment_type}>
                        <td>{paymentLabel[p.payment_type] || p.payment_type}</td>
                        <td>{p.count}</td>
                        <td className="text-right" style={{ fontWeight: 600 }}>{formatCurrency(p.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="empty-state" style={{ padding: 16 }}>Veri yok</div>}
            </div>

            {/* Top Products */}
            <div className="card card-padded">
              <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Award size={14} /> En Çok Satan Ürünler
              </h3>
              {report.topProducts?.length > 0 ? (
                <table className="data-table">
                  <thead><tr><th>Ürün</th><th>Adet</th><th className="text-right">Tutar</th></tr></thead>
                  <tbody>
                    {report.topProducts.map((p, i) => (
                      <tr key={i}>
                        <td style={{ fontWeight: i < 3 ? 600 : 400 }}>{p.product_name}</td>
                        <td>{p.total_qty}</td>
                        <td className="text-right" style={{ fontWeight: 600 }}>{formatCurrency(p.total_revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="empty-state" style={{ padding: 16 }}>Veri yok</div>}
            </div>

            {/* Category Breakdown */}
            <div className="card card-padded">
              <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                <ShoppingBag size={14} /> Kategori Bazlı Satış
              </h3>
              {report.categoryBreakdown?.length > 0 ? (
                <table className="data-table">
                  <thead><tr><th>Kategori</th><th>Adet</th><th className="text-right">Tutar</th></tr></thead>
                  <tbody>
                    {report.categoryBreakdown.map((c, i) => (
                      <tr key={i}>
                        <td>{c.category_name}</td>
                        <td>{c.total_qty}</td>
                        <td className="text-right" style={{ fontWeight: 600 }}>{formatCurrency(c.total_revenue)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="empty-state" style={{ padding: 16 }}>Veri yok</div>}
            </div>

            {/* User Sales */}
            <div className="card card-padded">
              <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                <TrendingUp size={14} /> Kullanıcı Bazlı Satış
              </h3>
              {report.userSales?.length > 0 ? (
                <table className="data-table">
                  <thead><tr><th>Kullanıcı</th><th>Sipariş</th><th className="text-right">Tahsilat</th></tr></thead>
                  <tbody>
                    {report.userSales.map((u, i) => (
                      <tr key={i}>
                        <td>{u.full_name}</td>
                        <td>{u.order_count}</td>
                        <td className="text-right" style={{ fontWeight: 600 }}>{formatCurrency(u.total_collected)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              ) : <div className="empty-state" style={{ padding: 16 }}>Veri yok</div>}
            </div>
          </div>

          {/* Closed orders (günlük kapanan adisyonlar) */}
          {closedOrders.length > 0 && (
            <div className="card card-padded" style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Receipt size={14} /> Kapanan siparişler ({closedOrders.length})
              </h3>
              <table className="data-table">
                <thead>
                  <tr>
                    <th>No</th>
                    <th>Masa / Tür</th>
                    <th>Müşteri</th>
                    <th>Personel</th>
                    <th>Ödeme</th>
                    <th className="text-right">Tutar</th>
                  </tr>
                </thead>
                <tbody>
                  {closedOrders.map((o) => (
                    <tr key={o.id}>
                      <td>#{o.order_no}</td>
                      <td>
                        {o.order_type === 'takeaway' ? 'Paket' : (o.table_name || '—')}
                      </td>
                      <td>{o.customer_name || '—'}</td>
                      <td>{o.user_name || '—'}</td>
                      <td>{paymentLabel[o.payment_type] || o.payment_type || '—'}</td>
                      <td className="text-right" style={{ fontWeight: 600 }}>{formatCurrency(o.grand_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Open Orders */}
          {report.openOrders?.length > 0 && (
            <div className="card card-padded" style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>Açık Adisyonlar ({report.openOrders.length})</h3>
              <table className="data-table">
                <thead><tr><th>No</th><th>Masa</th><th>Durum</th><th className="text-right">Tutar</th></tr></thead>
                <tbody>
                  {report.openOrders.map(o => (
                    <tr key={o.id}>
                      <td>#{o.order_no}</td>
                      <td>{o.table_name || 'Paket'}</td>
                      <td><span className="badge badge-warning">{o.status}</span></td>
                      <td className="text-right" style={{ fontWeight: 600 }}>{formatCurrency(o.grand_total)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {/* Comped Items */}
          {report.compedItems?.length > 0 && (
            <div className="card card-padded" style={{ marginTop: 16 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 14 }}>İkramlar ({report.compedItems.length})</h3>
              <table className="data-table">
                <thead><tr><th>Ürün</th><th>Adet</th><th>Tutar</th><th>Sebep</th><th>Personel</th></tr></thead>
                <tbody>
                  {report.compedItems.map((item, i) => (
                    <tr key={i}>
                      <td>{item.product_name}</td>
                      <td>{item.quantity}</td>
                      <td>{formatCurrency(item.unit_price * item.quantity)}</td>
                      <td>{item.comp_reason || '-'}</td>
                      <td>{item.comped_by || '-'}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </>
      ) : (
        <div className="empty-state">Rapor verisi bulunamadı</div>
      )}
    </div>
  );
}
