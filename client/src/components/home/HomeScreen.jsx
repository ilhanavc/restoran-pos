import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import ReactApexChart from 'react-apexcharts';
import { TrendingUp, TrendingDown, Minus } from 'lucide-react';
import { formatCurrency, PAYMENT_TYPES } from '../../constants/index.js';
import api from '../../services/api.js';
import { useSocket } from '../../context/SocketContext.jsx';

const PAYMENT_COLORS = ['#6366f1', '#10b981', '#f59e0b', '#3b82f6', '#8b5cf6'];
const LIVE_REFRESH_MS = 20000;
const ALERTS_REFRESH_MS = 60000;

const OP_HOURS = ['06','07','08','09','10','11','12','13','14','15','16','17','18','19','20','21','22','23','00','01','02'];

function todayStr() { return new Date().toISOString().slice(0, 10); }
function addDaysStr(days) {
  const d = new Date(); d.setDate(d.getDate() + days);
  return d.toISOString().slice(0, 10);
}
function formatPctDelta(a, b) {
  if (!Number.isFinite(a) || !Number.isFinite(b) || b <= 0) return null;
  return Math.round(((a - b) / b) * 100);
}
function parseIso(iso) {
  if (!iso) return null;
  const t = new Date(iso.includes('T') ? iso : `${iso.replace(' ', 'T')}Z`);
  return Number.isFinite(t.getTime()) ? t : null;
}
function formatHms(iso) {
  const d = parseIso(iso);
  return d ? d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit', second: '2-digit' }) : '';
}
function formatHm(iso) {
  const d = parseIso(iso);
  return d ? d.toLocaleTimeString('tr-TR', { hour: '2-digit', minute: '2-digit' }) : '';
}

// ── KPI Kart ──────────────────────────────────────────────────────────────────
function KpiCard({ label, value, pct, trendData, accent }) {
  const up   = pct > 0;
  const down = pct < 0;

  const sparkOptions = useMemo(() => ({
    chart: { type: 'area', sparkline: { enabled: true }, animations: { enabled: false } },
    stroke: { curve: 'smooth', width: 1.5 },
    fill: { type: 'gradient', gradient: { opacityFrom: 0.25, opacityTo: 0 } },
    colors: [accent || 'var(--accent)'],
    tooltip: { enabled: false },
  }), [accent]);

  const sparkSeries = useMemo(() => [{ data: (trendData || []).map(Number) }], [trendData]);

  return (
    <div className="kpi-card">
      <div className="kpi-label">{label}</div>
      <div className="kpi-value">{value}</div>
      {pct !== null && (
        <div className={`kpi-trend kpi-trend-${up ? 'up' : down ? 'down' : 'flat'}`}>
          {up ? <TrendingUp size={12} /> : down ? <TrendingDown size={12} /> : <Minus size={12} />}
          <span>%{Math.abs(pct)} {up ? 'artış' : down ? 'düşüş' : ''} dünden</span>
        </div>
      )}
      {(trendData?.length || 0) > 1 && (
        <div className="kpi-spark">
          <ReactApexChart type="area" height={36} options={sparkOptions} series={sparkSeries} />
        </div>
      )}
    </div>
  );
}

// ── Ana Component ──────────────────────────────────────────────────────────────
export default function HomeScreen() {
  const navigate = useNavigate();
  const socket   = useSocket();

  const [daily,          setDaily]          = useState(null);
  const [hourlyToday,    setHourlyToday]    = useState([]);
  const [rangeDays,      setRangeDays]      = useState([]);
  const [compare,        setCompare]        = useState(null);
  const [alerts,         setAlerts]         = useState([]);
  const [recent,         setRecent]         = useState([]);
  const [recentClosed,   setRecentClosed]   = useState([]);
  const [loading,        setLoading]        = useState(true);

  const liveTimer  = useRef(null);
  const alertTimer = useRef(null);

  const loadLive = useCallback(async () => {
    try {
      const b = await api.getDashboardCompare();
      setCompare(b);
    } catch (e) { console.error('dashboard compare failed', e); }
    try {
      const c = await api.getDashboardRecentOrders(8);
      setRecent(Array.isArray(c?.orders) ? c.orders : []);
    } catch (e) { console.error('dashboard recent-orders failed', e); }
    try {
      const cl = await api.getClosedOrders({ date: todayStr(), limit: 8, page: 1 });
      setRecentClosed(Array.isArray(cl?.orders) ? cl.orders : []);
    } catch (e) { console.error('closed-orders failed', e); }
  }, []);

  const loadAlerts = useCallback(async () => {
    try { const d = await api.getDashboardAlerts(); setAlerts(d.alerts || []); }
    catch { /* silent */ }
  }, []);

  const loadHeavy = useCallback(async () => {
    try {
      const today = todayStr();
      const [dailyData, ht, range] = await Promise.all([
        api.getDailyReport(today),
        api.getHourlyReport(today),
        api.getRangeReport(addDaysStr(-6), today),
      ]);
      setDaily(dailyData);
      setHourlyToday(ht?.data || []);
      setRangeDays(range?.revenue || []);
    } catch { /* silent */ }
  }, []);

  const loadAll = useCallback(async () => {
    setLoading(true);
    try { await Promise.all([loadLive(), loadAlerts(), loadHeavy()]); }
    finally { setLoading(false); }
  }, [loadLive, loadAlerts, loadHeavy]);

  useEffect(() => { loadAll(); }, [loadAll]);

  useEffect(() => {
    liveTimer.current  = setInterval(loadLive,   LIVE_REFRESH_MS);
    alertTimer.current = setInterval(loadAlerts, ALERTS_REFRESH_MS);
    return () => { clearInterval(liveTimer.current); clearInterval(alertTimer.current); };
  }, [loadLive, loadAlerts]);

  useEffect(() => {
    if (!socket?.subscribe) return undefined;
    const bump    = () => { loadLive(); loadHeavy(); };
    const unsubs = [
      socket.subscribe('order:created', () => {
        bump();
        api.getDashboardRecentOrders(8).then((d) => setRecent(d.orders || [])).catch(() => {});
      }),
      socket.subscribe('order:updated',     bump),
      socket.subscribe('payment:created',   bump),
    ];
    return () => unsubs.forEach((u) => u?.());
  }, [socket, loadLive, loadHeavy]);

  // Grafik: işletme saatleri
  const chartRows = useMemo(() => {
    const m = {};
    for (const r of hourlyToday) m[r.hour] = Number(r.revenue || 0);
    return OP_HOURS.map((h) => ({ label: `${h}:00`, value: m[h] || 0 }));
  }, [hourlyToday]);

  const areaOptions = useMemo(() => ({
    chart: { type: 'area', height: 240, toolbar: { show: false }, animations: { enabled: true, speed: 600 }, background: 'transparent', fontFamily: 'inherit' },
    dataLabels: { enabled: false },
    stroke: { curve: 'smooth', width: [2.5] },
    fill: { type: 'gradient', gradient: { type: 'vertical', opacityFrom: [0.4], opacityTo: [0.0] } },
    colors: ['#6366f1'],
    xaxis: {
      categories: chartRows.map((r) => r.label),

      axisBorder: { show: false }, axisTicks: { show: false },
      labels: { style: { colors: '#94a3b8', fontSize: '11px' }, rotate: 0 },
      tickAmount: 8,
    },
    yaxis: { labels: { style: { colors: '#94a3b8', fontSize: '11px' }, formatter: (v) => v === 0 ? '₺0' : `₺${(v / 1000).toFixed(0)}K` } },
    grid: { borderColor: 'rgba(148,163,184,0.12)', strokeDashArray: 3, xaxis: { lines: { show: false } }, padding: { left: 4, right: 8 } },
    tooltip: { theme: 'dark', y: { formatter: (v) => formatCurrency(v) } },
    legend: { show: false },
  }), [chartRows]);

  const areaSeries = useMemo(() => [
    { name: 'Bugün', data: chartRows.map((r) => r.value) },
  ], [chartRows]);

  // Donut
  const pb = daily?.paymentBreakdown || [];
  const donutLabels = pb.map((p) => PAYMENT_TYPES[p.payment_type]?.label || p.payment_type || 'Diğer');
  const donutSeries = pb.map((p) => Number(p.total || 0));
  const donutTotal  = donutSeries.reduce((s, v) => s + v, 0);
  const donutOptions = useMemo(() => ({
    chart: { type: 'donut', animations: { enabled: true }, background: 'transparent', fontFamily: 'inherit' },
    labels: donutLabels,
    colors: PAYMENT_COLORS,
    legend: { position: 'bottom', labels: { colors: '#94a3b8' }, fontSize: '12px', itemMargin: { horizontal: 8 } },
    plotOptions: {
      pie: { donut: { size: '70%', labels: { show: true,
        name:  { show: true, color: '#94a3b8', fontSize: '12px', offsetY: 18 },
        value: { show: true, color: 'var(--text, #0f172a)', fontSize: '20px', fontWeight: '700', formatter: (v) => formatCurrency(Number(v)), offsetY: -10 },
        total: { show: true, showAlways: false, label: 'Toplam', color: '#94a3b8', fontSize: '12px', formatter: () => formatCurrency(donutTotal) },
      } } },
    },
    dataLabels: { enabled: false },
    stroke: { width: 0 },
    tooltip: { theme: 'dark', y: { formatter: (v) => formatCurrency(v) } },
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }), [JSON.stringify(donutLabels), donutTotal]);

  // Metrikler
  const revenue  = Number(daily?.revenue || 0);
  const orders   = Number(daily?.orderStats?.total_orders || 0);
  const avg      = Number(daily?.avgOrderValue || 0);
  const spark    = useMemo(() => rangeDays.map((r) => Number(r.total || 0)), [rangeDays]);
  const revPct   = compare ? formatPctDelta(compare.today?.revenue, compare.yesterday?.revenue) : null;
  const ordPct   = compare ? formatPctDelta(compare.today?.orderCount, compare.yesterday?.orderCount) : null;

  // Top ürünler
  const top    = (daily?.topProducts || []).slice(0, 6);
  const maxQty = top.reduce((m, p) => Math.max(m, Number(p.total_qty || 0)), 1);


  return (
    <div className="page-container home-page">

      <div className="home-header-actions">
        <span className={`conn-dot ${socket?.isConnected ? 'conn-dot-on' : 'conn-dot-off'}`} title={socket?.isConnected ? 'Canlı' : 'Bağlantı kesik'} />
        <button className="btn btn-ghost" onClick={loadAll} disabled={loading}>Yenile</button>
      </div>

      {/* Uyarılar */}
      {alerts.length > 0 && (
        <div className="home-alerts">
          {alerts.map((a) => (
            <button type="button" key={a.id} className={`home-alert home-alert-${a.severity}`} onClick={() => a.href && navigate(a.href)}>
              <span className="home-alert-title">{a.title}</span>
              <span className="home-alert-message">{a.message}</span>
            </button>
          ))}
        </div>
      )}

      {/* KPI Kartları */}
      <div className="kpi-grid">
        <KpiCard label="Bugün Ciro"      value={formatCurrency(revenue)} pct={revPct} trendData={spark}  accent="#6366f1" />
        <KpiCard label="Toplam Sipariş"  value={String(orders)}          pct={ordPct} trendData={spark}  accent="#10b981" />
        <KpiCard label="Ortalama Hesap"  value={formatCurrency(avg)}     pct={null}                      accent="#f59e0b" />
      </div>

      {/* Saatlik Grafik */}
      <div className="card card-padded home-area-card">
        <div className="hc-header">
          <span className="hc-title">Saatlik Ciro</span>
          <span className="hc-sub">Bugün · İşletme saatleri (06:00–02:00)</span>
        </div>
        <ReactApexChart type="area" height={240} options={areaOptions} series={areaSeries} />
      </div>

      {/* Alt Grid */}
      <div className="home-bottom-grid">

        {/* Ödeme Dağılımı */}
        <div className="card card-padded">
          <div className="hc-title" style={{ marginBottom: 8 }}>Ödeme Dağılımı</div>
          {donutSeries.length === 0
            ? <div className="home-empty">Bugün ödeme kaydı yok</div>
            : <ReactApexChart type="donut" height={260} options={donutOptions} series={donutSeries} />}
        </div>

        {/* En Çok Satan */}
        <div className="card card-padded">
          <div className="hc-title" style={{ marginBottom: 12 }}>En Çok Satan</div>
          {top.length === 0
            ? <div className="home-empty">Bugün satış yok</div>
            : (
              <div className="product-list">
                {top.map((p, i) => {
                  const qty = Number(p.total_qty || 0);
                  const pct = Math.round((qty / maxQty) * 100);
                  return (
                    <div key={p.product_name} className="product-row">
                      <span className="product-rank">{i + 1}</span>
                      <div className="product-body">
                        <div className="product-name-row">
                          <span className="product-name">{p.product_name}</span>
                          <span className="product-rev">{formatCurrency(Number(p.total_revenue || 0))}</span>
                        </div>
                        <div className="product-bar-bg">
                          <div className="product-bar-fill" style={{ width: `${pct}%` }} />
                        </div>
                      </div>
                      <span className="product-qty">{qty}</span>
                    </div>
                  );
                })}
              </div>
            )}
        </div>

      </div>

      {/* Sipariş Akışları */}
      <div className="home-orders-grid">
        {/* Son Siparişler */}
        <div className="card card-padded">
          <div className="hc-title" style={{ marginBottom: 12 }}>Son Siparişler</div>
          <div className="feed-list">
            {recent.length === 0
              ? <div className="home-empty">Henüz sipariş yok</div>
              : recent.map((o) => (
                <div key={o.id} className="feed-row">
                  <div className={`feed-type-dot feed-type-${o.order_type}`} />
                  <div className="feed-body">
                    <div className="feed-title">
                      {o.order_type === 'takeaway' ? (o.customer_name || 'Paket') : (o.table_name || 'Masa')}
                      {o.order_no ? <span className="feed-no"> #{o.order_no}</span> : null}
                    </div>
                    <div className="feed-meta">{o.user_name || '—'} · {formatHms(o.created_at)}</div>
                  </div>
                  <div className={`feed-amount ${o.status === 'cancelled' ? 'feed-cancelled' : o.status === 'closed' ? 'feed-closed' : ''}`}>
                    {formatCurrency(o.grand_total || 0)}
                  </div>
                </div>
              ))}
          </div>
        </div>

        {/* Kapanan Siparişler */}
        <div className="card card-padded">
          <div className="hc-title" style={{ marginBottom: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <span>Kapanan Siparişler</span>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate('/reports')}>Tümü</button>
          </div>
          <div className="feed-list">
            {recentClosed.length === 0
              ? <div className="home-empty">Bugün kapanan sipariş yok</div>
              : recentClosed.map((o) => (
                <button
                  type="button"
                  key={o.id}
                  className="feed-row feed-row-clickable"
                  onClick={() => navigate('/reports')}
                  title="Detay için Raporlar sayfasına git"
                >
                  <div className={`feed-type-dot feed-type-${o.order_type}`} />
                  <div className="feed-body">
                    <div className="feed-title">
                      {o.order_type === 'takeaway' ? (o.customer_name || 'Paket') : (o.table_name || 'Masa')}
                      {o.order_no ? <span className="feed-no"> #{o.order_no}</span> : null}
                    </div>
                    <div className="feed-meta">{o.user_name || '—'} · {formatHm(o.closed_at || o.created_at)}</div>
                  </div>
                  <div className="feed-amount feed-closed">
                    {formatCurrency(o.grand_total || 0)}
                  </div>
                </button>
              ))}
          </div>
        </div>
      </div>
    </div>
  );
}
