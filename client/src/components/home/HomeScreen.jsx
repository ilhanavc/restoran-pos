import { useCallback, useEffect, useMemo, useState } from 'react';
import {
  BarChart,
  Bar,
  CartesianGrid,
  Legend,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from 'recharts';
import { formatCurrency, PAYMENT_TYPES } from '../../constants/index.js';
import api from '../../services/api.js';

const PAYMENT_COLORS = ['var(--accent)', 'var(--success)', 'var(--warning)', 'var(--info)', 'var(--purple)'];

function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function dateDaysAgo(days) {
  const d = new Date();
  d.setDate(d.getDate() - days);
  return d.toISOString().slice(0, 10);
}

export default function HomeScreen() {
  const [daily, setDaily] = useState(null);
  const [range, setRange] = useState(null);
  const [loading, setLoading] = useState(true);

  const loadDashboard = useCallback(async () => {
    setLoading(true);
    try {
      const today = todayStr();
      const from = dateDaysAgo(6);
      const [dailyData, rangeData] = await Promise.all([
        api.getDailyReport(today),
        api.getRangeReport(from, today),
      ]);
      setDaily(dailyData);
      setRange(rangeData);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadDashboard();
  }, [loadDashboard]);

  const paymentChartData = useMemo(
    () =>
      (daily?.paymentBreakdown || []).map((item) => ({
        name: PAYMENT_TYPES[item.payment_type]?.label || item.payment_type || 'Diğer',
        value: Number(item.total || 0),
        count: Number(item.count || 0),
      })),
    [daily],
  );

  const salesTrendData = useMemo(
    () =>
      (range?.revenue || []).map((item) => ({
        date: String(item.date || '').slice(5),
        total: Number(item.total || 0),
      })),
    [range],
  );

  const topProductsData = useMemo(
    () =>
      (daily?.topProducts || []).slice(0, 8).map((item) => ({
        name: item.product_name || '-',
        qty: Number(item.total_qty || 0),
      })),
    [daily],
  );

  const metricCards = useMemo(
    () => [
      { label: 'Bugün Ciro', value: formatCurrency(daily?.revenue || 0) },
      { label: 'Toplam Sipariş', value: Number(daily?.orderStats?.total_orders || 0) },
      { label: 'Ortalama Sipariş', value: formatCurrency(daily?.avgOrderValue || 0) },
      { label: 'İptal Sipariş', value: Number(daily?.orderStats?.cancelled_count || 0) },
    ],
    [daily],
  );

  return (
    <div className="page-container home-page">
      <div className="page-header">
        <div>
          <h1 className="page-title">Anasayfa</h1>
          <div className="home-subtitle">Günlük operasyon özeti ve canlı satış görünümü</div>
        </div>
        <button className="btn btn-ghost" onClick={loadDashboard} disabled={loading}>
          Yenile
        </button>
      </div>

      <div className="home-metric-grid">
        {metricCards.map((card) => (
          <div key={card.label} className="card home-metric-card">
            <div className="home-metric-label">{card.label}</div>
            <div className="home-metric-value">{card.value}</div>
          </div>
        ))}
      </div>

      <div className="home-chart-grid">
        <div className="card card-padded home-chart-card">
          <div className="home-chart-title">Son 7 Gün Ciro Trendi</div>
          <div className="home-chart-body">
            <ResponsiveContainer width="100%" height="100%">
              <LineChart data={salesTrendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
                <XAxis dataKey="date" stroke="var(--text-muted)" />
                <YAxis stroke="var(--text-muted)" />
                <Tooltip
                  contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
                  formatter={(value) => formatCurrency(value)}
                />
                <Line type="monotone" dataKey="total" stroke="var(--accent)" strokeWidth={3} dot={{ r: 3 }} />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </div>

        <div className="card card-padded home-chart-card">
          <div className="home-chart-title">Ödeme Türü Dağılımı</div>
          <div className="home-chart-body">
            <ResponsiveContainer width="100%" height="100%">
              <PieChart>
                <Pie
                  data={paymentChartData}
                  dataKey="value"
                  nameKey="name"
                  innerRadius={58}
                  outerRadius={92}
                  paddingAngle={3}
                >
                  {paymentChartData.map((entry, idx) => (
                    <Cell key={`${entry.name}-${idx}`} fill={PAYMENT_COLORS[idx % PAYMENT_COLORS.length]} />
                  ))}
                </Pie>
                <Tooltip
                  contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
                  formatter={(value) => formatCurrency(value)}
                />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </div>
      </div>

      <div className="card card-padded home-chart-card home-chart-card-full">
        <div className="home-chart-title">En Çok Satan Ürünler</div>
        <div className="home-chart-body">
          <ResponsiveContainer width="100%" height="100%">
            <BarChart data={topProductsData} margin={{ top: 8, right: 16, left: 0, bottom: 40 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" />
              <XAxis dataKey="name" stroke="var(--text-muted)" angle={-15} textAnchor="end" interval={0} height={65} />
              <YAxis stroke="var(--text-muted)" />
              <Tooltip
                contentStyle={{ background: 'var(--bg-secondary)', border: '1px solid var(--border)' }}
                formatter={(value) => [`${value} adet`, 'Satış']}
              />
              <Bar dataKey="qty" fill="var(--success)" radius={[6, 6, 0, 0]} />
            </BarChart>
          </ResponsiveContainer>
        </div>
      </div>
    </div>
  );
}
