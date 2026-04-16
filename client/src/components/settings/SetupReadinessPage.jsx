import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { AlertTriangle, CheckCircle2, CircleAlert, RefreshCw, ShieldCheck } from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import SettingsDetailHeader from './SettingsDetailHeader.jsx';

function checkClass(status) {
  if (status === 'ok') return 'setup-check setup-check--ok';
  if (status === 'warning') return 'setup-check setup-check--warning';
  return 'setup-check setup-check--blocker';
}

function badgeClass(status) {
  if (status === 'ok') return 'badge badge-success';
  if (status === 'warning') return 'badge badge-warning';
  return 'badge badge-danger';
}

function statusLabel(status) {
  if (status === 'ok') return 'Hazır';
  if (status === 'warning') return 'Uyarı';
  return 'Eksik';
}

function StatusIcon({ status }) {
  if (status === 'ok') return <CheckCircle2 size={20} />;
  if (status === 'warning') return <AlertTriangle size={20} />;
  return <CircleAlert size={20} />;
}

export default function SetupReadinessPage() {
  const navigate = useNavigate();
  const { success, error } = useToast();
  const [readiness, setReadiness] = useState(null);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getDesktopReadiness();
      setReadiness(data);
    } catch (e) {
      error(e.message || 'Kurulum durumu alınamadı');
    } finally {
      setLoading(false);
    }
  }, [error]);

  useEffect(() => {
    load();
  }, [load]);

  const summary = useMemo(() => {
    const checks = readiness?.checks || [];
    return {
      ok: checks.filter((c) => c.status === 'ok').length,
      warning: readiness?.warningCount || 0,
      blocker: readiness?.blockerCount || 0,
      total: checks.length,
    };
  }, [readiness]);

  const complete = async () => {
    setSaving(true);
    try {
      const data = await api.completeDesktopReadiness();
      setReadiness(data);
      success(data.message || 'Kurulum kontrolü tamamlandı');
      navigate('/home', { replace: true });
    } catch (e) {
      if (e.readiness) setReadiness(e.readiness);
      error(e.message || 'Eksikler tamamlanmadan kurulum kapatılamaz');
    } finally {
      setSaving(false);
    }
  };

  const handleBack = () => navigate('/settings');

  return (
    <div className="page-container">
      <SettingsDetailHeader title="Kurulum Kontrolü" onBack={handleBack} />

      <div className="setup-readiness-hero">
        <div className="setup-readiness-hero-main">
          <div className="setup-readiness-icon">
            <ShieldCheck size={26} />
          </div>
          <div>
            <h1>Bu bilgisayar POS için hazır mı?</h1>
            <p>
              Masa, sipariş, mutfak, ödeme ve yazdırma akışları başlamadan önce zorunlu kurulum adımlarını kontrol edin.
            </p>
          </div>
        </div>
        <div className="setup-readiness-actions">
          <button type="button" className="btn btn-ghost btn-sm" onClick={load} disabled={loading || saving}>
            <RefreshCw size={14} />
            Yenile
          </button>
          <button
            type="button"
            className="btn btn-primary btn-sm"
            onClick={complete}
            disabled={loading || saving || !readiness?.ready}
          >
            Kurulumu Tamamla
          </button>
        </div>
      </div>

      <div className="setup-summary-grid">
        <div className="stat-card">
          <div className="stat-card-label">Hazır adım</div>
          <div className="stat-card-value">{summary.ok}</div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Bloklayıcı eksik</div>
          <div className="stat-card-value" style={{ color: summary.blocker ? 'var(--danger)' : 'var(--success)' }}>
            {summary.blocker}
          </div>
        </div>
        <div className="stat-card">
          <div className="stat-card-label">Operasyon uyarısı</div>
          <div className="stat-card-value" style={{ color: summary.warning ? 'var(--warning)' : 'var(--success)' }}>
            {summary.warning}
          </div>
        </div>
      </div>

      {loading ? (
        <div className="card card-padded" style={{ color: 'var(--text-muted)' }}>
          Kontrol ediliyor...
        </div>
      ) : (
        <div className="setup-check-list">
          {(readiness?.checks || []).map((check) => (
            <div key={check.key} className={checkClass(check.status)}>
              <div className="setup-check-status">
                <StatusIcon status={check.status} />
              </div>
              <div className="setup-check-body">
                <div className="setup-check-title-row">
                  <h2>{check.title}</h2>
                  <span className={badgeClass(check.status)}>{statusLabel(check.status)}</span>
                </div>
                <p>{check.message}</p>
              </div>
              {check.action ? (
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => navigate(check.action)}>
                  Düzenle
                </button>
              ) : null}
            </div>
          ))}
        </div>
      )}

      {readiness?.completed ? (
        <div className="setup-readiness-note">
          Son tamamlanma: {new Date(readiness.completed_at).toLocaleString('tr-TR')}
        </div>
      ) : null}
    </div>
  );
}
