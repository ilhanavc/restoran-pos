import { useCallback, useEffect, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Activity, AlertTriangle, CheckCircle2, Download, RefreshCw, XCircle } from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import SettingsDetailHeader from './SettingsDetailHeader.jsx';
import { BASE_URL } from '../../services/api/core.js';
import { formatDateTimeInIstanbul, todayInIstanbul } from '../../utils/time.js';

function StatusBadge({ status }) {
  if (status === 'ok')
    return (
      <span className="badge badge-success" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <CheckCircle2 size={13} /> Sağlıklı
      </span>
    );
  if (status === 'degraded')
    return (
      <span className="badge badge-warning" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <AlertTriangle size={13} /> Dikkat
      </span>
    );
  if (status === 'down')
    return (
      <span className="badge badge-danger" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
        <XCircle size={13} /> Erişilemiyor
      </span>
    );
  return (
    <span className="badge" style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
      <Activity size={13} /> Yapılandırılmamış
    </span>
  );
}

function fmtTime(iso) {
  if (!iso) return '—';
  return formatDateTimeInIstanbul(iso) || '—';
}

export default function StoreBridgePage() {
  const navigate = useNavigate();
  const { error } = useToast();
  const [health, setHealth] = useState(null);
  const [logs, setLogs] = useState(null);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [downloading, setDownloading] = useState(false);
  const logEndRef = useRef(null);

  const load = useCallback(
    async (quiet = false) => {
      if (!quiet) setLoading(true);
      else setRefreshing(true);
      try {
        const [h, l] = await Promise.all([
          api.getAdminStoreBridgeHealth(),
          api.getAdminStoreBridgeLogs({ limit: 200 }),
        ]);
        setHealth(h);
        setLogs(l);
      } catch (e) {
        if (!quiet) error(e.message || 'StoreBridge durumu alınamadı');
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [error],
  );

  useEffect(() => {
    load();
  }, [load]);

  const downloadSupportBundle = useCallback(async () => {
    setDownloading(true);
    try {
      const token = localStorage.getItem('pos_token');
      // process.env.VITE_API_URL mantığına uygun bir API prefiksi için tam path kullanılmalı
      // Uygulamada proxy /api'ye devrettiğine göre doğrudan /api/admin/support-bundle kullanıyoruz.
      const res = await fetch(`${BASE_URL}/api/admin/support-bundle`, {
        headers: { Authorization: 'Bearer ' + token }
      });
      if (!res.ok) throw new Error('Destek paketi alınamadı');
      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `destek-paketi-${todayInIstanbul()}.zip`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      URL.revokeObjectURL(url);
    } catch (e) {
      error(e.message || 'Destek paketi indirilemedi');
    } finally {
      setDownloading(false);
    }
  }, [error]);

  // Auto-scroll to bottom of log on first load
  useEffect(() => {
    if (logs && logEndRef.current) {
      logEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [logs]);

  const q = health?.queueSummary || {};

  return (
    <div className="page-container">
      <SettingsDetailHeader title="StoreBridge Durumu" onBack={() => navigate('/settings')} />

      <div className="maintenance-hero">
        <div className="maintenance-hero-main">
          <div className="maintenance-hero-icon">
            <Activity size={26} />
          </div>
          <div>
            <h1>Yazıcı köprüsü ve baskı kuyruğu</h1>
            <p>StoreBridge bağlantısı, keşfedilen yazıcılar, baskı kuyruğu özeti ve son log satırları.</p>
          </div>
        </div>
        <div className="maintenance-actions">
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={downloadSupportBundle}
            disabled={loading || downloading}
            title="Sistem bilgisi, print kuyruğu, loglar ve hata özeti içeren ZIP dosyası"
          >
            <Download size={14} />
            {downloading ? 'İndiriliyor...' : 'Destek Paketi İndir'}
          </button>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            onClick={() => load(true)}
            disabled={loading || refreshing}
          >
            <RefreshCw size={14} style={refreshing ? { animation: 'spin 1s linear infinite' } : undefined} />
            Yenile
          </button>
        </div>
      </div>

      {loading ? (
        <div className="card card-padded" style={{ color: 'var(--text-muted)' }}>
          StoreBridge durumu yükleniyor...
        </div>
      ) : (
        <>
          {/* Status summary */}
          <div className="card card-padded" style={{ marginBottom: 12 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: 12, marginBottom: 12 }}>
              <StatusBadge status={health?.status} />
              <span style={{ color: 'var(--text-secondary)', fontSize: 13 }}>{health?.message}</span>
            </div>
            <div
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(auto-fill, minmax(160px, 1fr))',
                gap: 10,
              }}
            >
              <StatCell label="Son görülme" value={fmtTime(health?.lastSeenAt)} />
              <StatCell label="Son iş zamanı" value={fmtTime(health?.lastAttemptAt || health?.lastJobAt)} />
              <StatCell label="Keşfedilen yazıcı" value={String(health?.discovery?.printerCount ?? '—')} />
              <StatCell label="Son hata kodu" value={health?.lastErrorCode || '—'} />
            </div>
          </div>

          {/* Queue summary */}
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'repeat(4, 1fr)',
              gap: 10,
              marginBottom: 12,
            }}
          >
            <QueueCard label="Bekleyen" value={q.pending ?? 0} tone="neutral" />
            <QueueCard label="İşleniyor" value={q.claimed ?? 0} tone="neutral" />
            <QueueCard label="Başarısız" value={q.failed ?? 0} tone={q.failed > 0 ? 'danger' : 'neutral'} />
            <QueueCard label="Takılı" value={q.stale_claimed ?? 0} tone={q.stale_claimed > 0 ? 'warning' : 'neutral'} />
          </div>

          {/* Discovered printers */}
          {health?.discovery?.printers?.length > 0 && (
            <div className="card card-padded" style={{ marginBottom: 12 }}>
              <div
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                  marginBottom: 10,
                }}
              >
                Keşfedilen Yazıcılar
              </div>
              <div style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
                {health.discovery.printers.map((p, i) => (
                  <div
                    key={i}
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      gap: 10,
                      padding: '6px 8px',
                      background: 'var(--bg-surface)',
                      borderRadius: 'var(--radius-sm)',
                      fontSize: 13,
                    }}
                  >
                    <CheckCircle2 size={14} color="var(--color-success)" />
                    <span style={{ fontWeight: 500 }}>{p.name || p.physicalName || 'Bilinmiyor'}</span>
                    {p.connection_type && (
                      <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{p.connection_type}</span>
                    )}
                    {p.ip && <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>{p.ip}</span>}
                  </div>
                ))}
              </div>
            </div>
          )}

          {/* Log tail */}
          <div className="card" style={{ marginBottom: 12 }}>
            <div
              style={{
                padding: '10px 14px',
                borderBottom: '1px solid var(--border)',
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
              }}
            >
              <span
                style={{
                  fontSize: 11,
                  fontWeight: 600,
                  color: 'var(--text-muted)',
                  textTransform: 'uppercase',
                  letterSpacing: '0.05em',
                }}
              >
                Son Loglar{logs?.file ? ` — ${logs.file}` : ''}
              </span>
              {!logs?.exists && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Log dosyası bulunamadı</span>
              )}
            </div>
            <div
              style={{
                fontFamily: 'monospace',
                fontSize: 11,
                lineHeight: 1.5,
                padding: '10px 14px',
                maxHeight: 320,
                overflowY: 'auto',
                background: 'var(--bg-surface)',
                color: 'var(--text-secondary)',
                whiteSpace: 'pre-wrap',
                wordBreak: 'break-all',
              }}
            >
              {logs?.lines?.length > 0 ? (
                logs.lines.map((line, i) => (
                  <div
                    key={i}
                    style={{
                      color: /error|hata/i.test(line)
                        ? 'var(--color-danger)'
                        : /warn/i.test(line)
                          ? 'var(--color-warning)'
                          : undefined,
                    }}
                  >
                    {line}
                  </div>
                ))
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>Log satırı yok.</span>
              )}
              <div ref={logEndRef} />
            </div>
          </div>
        </>
      )}
    </div>
  );
}

function StatCell({ label, value }) {
  return (
    <div>
      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 2 }}>{label}</div>
      <div style={{ fontSize: 13, fontWeight: 500, color: 'var(--text-primary)' }}>{value}</div>
    </div>
  );
}

function QueueCard({ label, value, tone }) {
  const colors = {
    danger: { bg: 'var(--color-danger-muted, #fef2f2)', text: 'var(--color-danger)' },
    warning: { bg: 'var(--color-warning-muted, #fffbeb)', text: 'var(--color-warning)' },
    neutral: { bg: 'var(--bg-card)', text: 'var(--text-primary)' },
  };
  const c = colors[tone] || colors.neutral;
  return (
    <div
      className="stat-card"
      style={{ background: c.bg }}
    >
      <div className="stat-card-label">{label}</div>
      <div className="stat-card-value" style={{ color: c.text }}>
        {value}
      </div>
    </div>
  );
}
