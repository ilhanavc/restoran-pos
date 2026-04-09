import { useState, useEffect, useCallback } from 'react';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell,
} from 'recharts';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency } from '../../constants/index.js';
import { BarChart3, TrendingUp, CreditCard, ShoppingBag, Award, Calendar, Receipt, Clock, Search, ChevronDown, Download, Printer } from 'lucide-react';

// ── Export yardımcıları ──────────────────────────────────────────────────────

function downloadBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

async function exportToExcel(report, closedOrders, selectedDate) {
  const XLSX = await import('xlsx');
  const wb = XLSX.utils.book_new();

  // Özet sayfası
  const summaryData = [
    ['Tarih', selectedDate],
    ['Toplam Gelir', report.revenue],
    ['Toplam Sipariş', report.orderStats?.total_orders || 0],
    ['Ortalama Sipariş Tutarı', Math.round((report.avgOrderValue || 0) * 100) / 100],
    ['Masa Siparişi', report.orderStats?.dine_in_count || 0],
    ['Paket Sipariş', report.orderStats?.takeaway_count || 0],
    ['İptal', report.orderStats?.cancelled_count || 0],
    ['Toplam İndirim', report.orderStats?.total_discounts || 0],
  ];
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(summaryData), 'Özet');

  // Ödeme dağılımı
  if (report.paymentBreakdown?.length) {
    const paymentLabel = { cash: 'Nakit', card: 'Kart', mixed: 'Karışık', other: 'Diğer' };
    const payRows = [['Ödeme Tipi', 'Adet', 'Tutar']];
    for (const p of report.paymentBreakdown) {
      payRows.push([paymentLabel[p.payment_type] || p.payment_type, p.count, p.total]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(payRows), 'Ödemeler');
  }

  // En çok satanlar
  if (report.topProducts?.length) {
    const prodRows = [['Ürün', 'Adet', 'Ciro']];
    for (const p of report.topProducts) {
      prodRows.push([p.product_name, p.total_qty, p.total_revenue]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(prodRows), 'Ürünler');
  }

  // Kapanan siparişler
  if (closedOrders.length) {
    const orderRows = [['No', 'Tür', 'Masa', 'Müşteri', 'Personel', 'Ödeme', 'Tutar', 'Kapanış']];
    for (const o of closedOrders) {
      orderRows.push([
        `#${o.order_no}`,
        o.order_type === 'takeaway' ? 'Paket' : 'Masa',
        o.table_name || '',
        o.customer_name || '',
        o.user_name || '',
        o.payment_type || '',
        o.grand_total,
        o.closed_at || '',
      ]);
    }
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(orderRows), 'Siparişler');
  }

  const out = XLSX.write(wb, { type: 'array', bookType: 'xlsx' });
  downloadBlob(
    new Blob([out], { type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet' }),
    `Rapor_${selectedDate}.xlsx`,
  );
}

function printReport(report, closedOrders, selectedDate) {
  const paymentLabel = { cash: 'Nakit', card: 'Kart', mixed: 'Karışık', other: 'Diğer' };
  const fmt = (n) => Number(n || 0).toLocaleString('tr-TR', { minimumFractionDigits: 2 }) + ' ₺';

  const orderRows = closedOrders.map(o => `
    <tr>
      <td>#${o.order_no}</td>
      <td>${o.order_type === 'takeaway' ? 'Paket' : (o.table_name || '—')}</td>
      <td>${o.customer_name || '—'}</td>
      <td>${o.user_name || '—'}</td>
      <td>${paymentLabel[o.payment_type] || o.payment_type || '—'}</td>
      <td style="text-align:right;font-weight:600">${fmt(o.grand_total)}</td>
    </tr>`).join('');

  const html = `<!DOCTYPE html><html lang="tr"><head><meta charset="UTF-8">
  <title>Günlük Rapor — ${selectedDate}</title>
  <style>
    body{font-family:Arial,sans-serif;font-size:11px;color:#111;margin:20px}
    h1{font-size:16px;margin-bottom:4px} h2{font-size:13px;margin:14px 0 6px;border-bottom:1px solid #ccc;padding-bottom:3px}
    .grid{display:grid;grid-template-columns:repeat(4,1fr);gap:8px;margin-bottom:14px}
    .card{border:1px solid #ddd;border-radius:4px;padding:10px;text-align:center}
    .card-val{font-size:18px;font-weight:700;color:#4f46e5} .card-lbl{font-size:10px;color:#666;margin-top:2px}
    table{width:100%;border-collapse:collapse;font-size:11px}
    th{background:#4f46e5;color:#fff;padding:6px 8px;text-align:left;font-size:10px}
    td{padding:5px 8px;border-bottom:1px solid #eee} tr:nth-child(even) td{background:#f9f9f9}
    @media print{body{margin:8px}}
  </style></head><body>
  <h1>Günlük Satış Raporu</h1>
  <p style="color:#666;font-size:11px;margin-bottom:12px">Tarih: ${selectedDate}</p>
  <div class="grid">
    <div class="card"><div class="card-val">${fmt(report.revenue)}</div><div class="card-lbl">Toplam Gelir</div></div>
    <div class="card"><div class="card-val">${report.orderStats?.total_orders || 0}</div><div class="card-lbl">Sipariş</div></div>
    <div class="card"><div class="card-val">${fmt(report.avgOrderValue)}</div><div class="card-lbl">Ort. Tutar</div></div>
    <div class="card"><div class="card-val">${fmt(report.orderStats?.total_discounts)}</div><div class="card-lbl">İndirim</div></div>
  </div>
  ${report.paymentBreakdown?.length ? `
  <h2>Ödeme Dağılımı</h2>
  <table><thead><tr><th>Tip</th><th>Adet</th><th>Tutar</th></tr></thead><tbody>
  ${report.paymentBreakdown.map(p => `<tr><td>${paymentLabel[p.payment_type]||p.payment_type}</td><td>${p.count}</td><td>${fmt(p.total)}</td></tr>`).join('')}
  </tbody></table>` : ''}
  ${report.topProducts?.length ? `
  <h2>En Çok Satan Ürünler</h2>
  <table><thead><tr><th>Ürün</th><th>Adet</th><th>Ciro</th></tr></thead><tbody>
  ${report.topProducts.slice(0,10).map(p=>`<tr><td>${p.product_name}</td><td>${p.total_qty}</td><td>${fmt(p.total_revenue)}</td></tr>`).join('')}
  </tbody></table>` : ''}
  ${closedOrders.length ? `
  <h2>Kapanan Siparişler (${closedOrders.length})</h2>
  <table><thead><tr><th>No</th><th>Tür</th><th>Müşteri</th><th>Personel</th><th>Ödeme</th><th>Tutar</th></tr></thead>
  <tbody>${orderRows}</tbody></table>` : ''}
  </body></html>`;

  const w = window.open('', '_blank', 'width=900,height=700');
  w.document.write(html);
  w.document.close();
  w.focus();
  setTimeout(() => { w.print(); }, 300);
}

const PIE_COLORS = ['#6366f1', '#22c55e', '#f59e0b', '#ef4444', '#14b8a6', '#a855f7'];

function buildTrendDates(anchorDate) {
  const dates = [];
  const base = new Date(anchorDate);
  for (let i = 6; i >= 0; i--) {
    const d = new Date(base);
    d.setDate(d.getDate() - i);
    dates.push(d.toISOString().slice(0, 10));
  }
  return dates;
}

function shortDate(isoDate) {
  const [, m, d] = isoDate.split('-');
  return `${parseInt(d)}/${parseInt(m)}`;
}

const CustomTooltipCurrency = ({ active, payload, label }) => {
  if (!active || !payload?.length) return null;
  return (
    <div style={{ background: 'var(--surface)', border: '1px solid var(--border)', borderRadius: 6, padding: '8px 12px', fontSize: 12 }}>
      <div style={{ fontWeight: 700, marginBottom: 4 }}>{label}</div>
      {payload.map((p, i) => (
        <div key={i} style={{ color: p.color }}>{p.name}: {typeof p.value === 'number' && p.name !== 'Sipariş' ? formatCurrency(p.value) : p.value}</div>
      ))}
    </div>
  );
};

export default function ReportsScreen() {
  const [report, setReport] = useState(null);
  const [closedOrders, setClosedOrders] = useState([]);
  const [closedOrdersTotal, setClosedOrdersTotal] = useState(0);
  const [closedOrdersHasMore, setClosedOrdersHasMore] = useState(false);
  const [closedOrdersPage, setClosedOrdersPage] = useState(1);
  const [loadingMoreOrders, setLoadingMoreOrders] = useState(false);
  const [hourlyData, setHourlyData] = useState([]);
  const [trendData, setTrendData] = useState([]);
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));
  const [loading, setLoading] = useState(true);
  // Sipariş geçmişi filtreleri
  const [orderFrom, setOrderFrom] = useState('');
  const [orderTo, setOrderTo] = useState('');
  const [orderCustomer, setOrderCustomer] = useState('');
  const [orderMinAmount, setOrderMinAmount] = useState('');
  const [orderMaxAmount, setOrderMaxAmount] = useState('');
  const [orderFilterOpen, setOrderFilterOpen] = useState(false);
  const toast = useToast();

  useEffect(() => { loadAll(); }, [selectedDate]);

  const loadAll = async () => {
    setLoading(true);
    try {
      const trendDates = buildTrendDates(selectedDate);
      const from = trendDates[0];
      const to = trendDates[trendDates.length - 1];

      const [data, closed, hourly, range] = await Promise.all([
        api.getDailyReport(selectedDate),
        api.getClosedOrders({ date: selectedDate, limit: 50, page: 1 }),
        api.getHourlyReport(selectedDate),
        api.getRangeReport(from, to),
      ]);

      setReport(data);
      setClosedOrders(closed.orders || []);
      setClosedOrdersTotal(closed.total ?? (closed.orders || []).length);
      setClosedOrdersHasMore(closed.has_more ?? false);
      setClosedOrdersPage(1);

      // Saatlik: sadece 07-23 arası göster
      setHourlyData(
        (hourly.data || []).filter(h => parseInt(h.hour) >= 7 && parseInt(h.hour) <= 23)
          .map(h => ({ ...h, hourLabel: `${parseInt(h.hour)}:00` }))
      );

      // 7 günlük trend
      const byDate = {};
      for (const r of range.revenue || []) byDate[r.date] = r.total;
      setTrendData(trendDates.map(d => ({ date: shortDate(d), revenue: byDate[d] || 0 })));
    } catch {
      toast.error('Rapor yüklenemedi');
    } finally {
      setLoading(false);
    }
  };

  const searchOrders = useCallback(async () => {
    setLoading(true);
    try {
      const params = {
        page: 1,
        limit: 50,
        ...(orderFrom && { from: orderFrom }),
        ...(orderTo && { to: orderTo || orderFrom }),
        ...(!orderFrom && !orderTo && { date: selectedDate }),
        ...(orderCustomer && { customer: orderCustomer }),
        ...(orderMinAmount && { min_amount: orderMinAmount }),
        ...(orderMaxAmount && { max_amount: orderMaxAmount }),
      };
      const closed = await api.getClosedOrders(params);
      setClosedOrders(closed.orders || []);
      setClosedOrdersTotal(closed.total ?? (closed.orders || []).length);
      setClosedOrdersHasMore(closed.has_more ?? false);
      setClosedOrdersPage(1);
    } catch {
      toast.error('Sipariş geçmişi yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [orderFrom, orderTo, orderCustomer, orderMinAmount, orderMaxAmount, selectedDate, toast]);

  const loadMoreOrders = async () => {
    const nextPage = closedOrdersPage + 1;
    setLoadingMoreOrders(true);
    try {
      const params = {
        page: nextPage,
        limit: 50,
        ...(orderFrom && { from: orderFrom }),
        ...(orderTo && { to: orderTo || orderFrom }),
        ...(!orderFrom && !orderTo && { date: selectedDate }),
        ...(orderCustomer && { customer: orderCustomer }),
        ...(orderMinAmount && { min_amount: orderMinAmount }),
        ...(orderMaxAmount && { max_amount: orderMaxAmount }),
      };
      const closed = await api.getClosedOrders(params);
      setClosedOrders(prev => [...prev, ...(closed.orders || [])]);
      setClosedOrdersHasMore(closed.has_more ?? false);
      setClosedOrdersPage(nextPage);
    } catch {
      toast.error('Yüklenemedi');
    } finally {
      setLoadingMoreOrders(false);
    }
  };

  const paymentLabel = { cash: 'Nakit', card: 'Kart', mixed: 'Karışık', other: 'Diğer' };

  const categoryPieData = (report?.categoryBreakdown || [])
    .filter(c => c.total_revenue > 0)
    .map(c => ({ name: c.category_name, value: c.total_revenue }));

  const topProductsChart = (report?.topProducts || [])
    .slice(0, 8)
    .map(p => ({ name: p.product_name.length > 16 ? p.product_name.slice(0, 15) + '…' : p.product_name, adet: p.total_qty }))
    .reverse();

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
          {report && (
            <>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => exportToExcel(report, closedOrders, selectedDate)}
                title="Excel olarak indir"
                style={{ display: 'flex', alignItems: 'center', gap: 5 }}
              >
                <Download size={14} /> Excel
              </button>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => printReport(report, closedOrders, selectedDate)}
                title="Yazdır / PDF kaydet"
                style={{ display: 'flex', alignItems: 'center', gap: 5 }}
              >
                <Printer size={14} /> Yazdır
              </button>
            </>
          )}
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

          {/* ---- GRAFİKLER ---- */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>

            {/* 7 Günlük Ciro Trendi */}
            <div className="card card-padded">
              <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                <TrendingUp size={14} /> Son 7 Gün Ciro Trendi
              </h3>
              {trendData.some(d => d.revenue > 0) ? (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={trendData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <XAxis dataKey="date" tick={{ fontSize: 11 }} />
                    <YAxis tick={{ fontSize: 11 }} tickFormatter={v => v >= 1000 ? `${(v / 1000).toFixed(0)}k` : v} width={40} />
                    <Tooltip content={<CustomTooltipCurrency />} />
                    <Bar dataKey="revenue" name="Ciro" fill="#6366f1" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="empty-state" style={{ padding: 40 }}>Veri yok</div>}
            </div>

            {/* Kategori Dağılımı */}
            <div className="card card-padded">
              <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                <ShoppingBag size={14} /> Kategori Satış Dağılımı
              </h3>
              {categoryPieData.length > 0 ? (
                <ResponsiveContainer width="100%" height={180}>
                  <PieChart>
                    <Pie data={categoryPieData} dataKey="value" nameKey="name"
                      cx="50%" cy="50%" outerRadius={65} innerRadius={30}
                      label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`}
                      labelLine={false}
                      style={{ fontSize: 10 }}
                    >
                      {categoryPieData.map((_, i) => (
                        <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />
                      ))}
                    </Pie>
                    <Tooltip formatter={v => formatCurrency(v)} />
                  </PieChart>
                </ResponsiveContainer>
              ) : <div className="empty-state" style={{ padding: 40 }}>Veri yok</div>}
            </div>

            {/* Saatlik Yoğunluk */}
            <div className="card card-padded">
              <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Clock size={14} /> Saatlik Sipariş Yoğunluğu
              </h3>
              {hourlyData.some(h => h.order_count > 0) ? (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={hourlyData} margin={{ top: 4, right: 8, left: 0, bottom: 0 }}>
                    <XAxis dataKey="hourLabel" tick={{ fontSize: 10 }} interval={1} />
                    <YAxis tick={{ fontSize: 11 }} allowDecimals={false} width={30} />
                    <Tooltip content={<CustomTooltipCurrency />} />
                    <Bar dataKey="order_count" name="Sipariş" fill="#22c55e" radius={[3, 3, 0, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="empty-state" style={{ padding: 40 }}>Veri yok</div>}
            </div>

            {/* En Çok Satan 8 Ürün */}
            <div className="card card-padded">
              <h3 style={{ fontSize: 13, fontWeight: 700, marginBottom: 14, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Award size={14} /> En Çok Satan Ürünler
              </h3>
              {topProductsChart.length > 0 ? (
                <ResponsiveContainer width="100%" height={180}>
                  <BarChart data={topProductsChart} layout="vertical" margin={{ top: 4, right: 16, left: 4, bottom: 0 }}>
                    <XAxis type="number" tick={{ fontSize: 11 }} allowDecimals={false} />
                    <YAxis type="category" dataKey="name" tick={{ fontSize: 10 }} width={100} />
                    <Tooltip content={<CustomTooltipCurrency />} />
                    <Bar dataKey="adet" name="Adet" fill="#f59e0b" radius={[0, 3, 3, 0]} />
                  </BarChart>
                </ResponsiveContainer>
              ) : <div className="empty-state" style={{ padding: 40 }}>Veri yok</div>}
            </div>
          </div>

          {/* ---- TABLOLAR ---- */}
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16, marginTop: 16 }}>
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

          {/* Sipariş Geçmişi */}
          <div className="card card-padded" style={{ marginTop: 16 }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 12 }}>
              <h3 style={{ fontSize: 13, fontWeight: 700, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Receipt size={14} /> Sipariş Geçmişi
                {closedOrdersTotal > 0 && <span style={{ fontWeight: 400, color: 'var(--text-muted)' }}>({closedOrdersTotal})</span>}
              </h3>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setOrderFilterOpen(v => !v)}
                style={{ display: 'flex', alignItems: 'center', gap: 4 }}
              >
                <Search size={13} /> Filtrele <ChevronDown size={12} style={{ transform: orderFilterOpen ? 'rotate(180deg)' : 'none' }} />
              </button>
            </div>

            {orderFilterOpen && (
              <div style={{ background: 'var(--bg-secondary)', borderRadius: 'var(--radius-sm)', padding: 12, marginBottom: 12, display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'flex-end' }}>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 130 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Başlangıç tarihi</span>
                  <input type="date" className="input input-sm" value={orderFrom} onChange={e => setOrderFrom(e.target.value)} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 130 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Bitiş tarihi</span>
                  <input type="date" className="input input-sm" value={orderTo} onChange={e => setOrderTo(e.target.value)} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 160 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Müşteri adı</span>
                  <input type="text" className="input input-sm" placeholder="Ad ara..." value={orderCustomer} onChange={e => setOrderCustomer(e.target.value)} />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 100 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Min. tutar</span>
                  <input type="number" className="input input-sm" placeholder="0" value={orderMinAmount} onChange={e => setOrderMinAmount(e.target.value)} min="0" />
                </label>
                <label style={{ display: 'flex', flexDirection: 'column', gap: 4, minWidth: 100 }}>
                  <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Maks. tutar</span>
                  <input type="number" className="input input-sm" placeholder="∞" value={orderMaxAmount} onChange={e => setOrderMaxAmount(e.target.value)} min="0" />
                </label>
                <div style={{ display: 'flex', gap: 6 }}>
                  <button type="button" className="btn btn-primary btn-sm" onClick={searchOrders}>Ara</button>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => {
                    setOrderFrom(''); setOrderTo(''); setOrderCustomer('');
                    setOrderMinAmount(''); setOrderMaxAmount('');
                    loadAll();
                  }}>Temizle</button>
                </div>
              </div>
            )}

            {closedOrders.length > 0 ? (
              <>
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
                        <td>{o.order_type === 'takeaway' ? 'Paket' : (o.table_name || '—')}</td>
                        <td>{o.customer_name || '—'}</td>
                        <td>{o.user_name || '—'}</td>
                        <td>{paymentLabel[o.payment_type] || o.payment_type || '—'}</td>
                        <td className="text-right" style={{ fontWeight: 600 }}>{formatCurrency(o.grand_total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {closedOrdersHasMore && (
                  <div style={{ textAlign: 'center', marginTop: 10 }}>
                    <button type="button" className="btn btn-ghost btn-sm" onClick={loadMoreOrders} disabled={loadingMoreOrders}>
                      {loadingMoreOrders ? 'Yükleniyor...' : `Daha fazla göster (${closedOrders.length} / ${closedOrdersTotal})`}
                    </button>
                  </div>
                )}
              </>
            ) : (
              <div className="empty-state" style={{ padding: 24 }}>Bu tarih için kapanan sipariş yok</div>
            )}
          </div>

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
