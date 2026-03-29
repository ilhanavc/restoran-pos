import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid } from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import SettingsDetailHeader from './SettingsDetailHeader.jsx';

export default function DiningAreasSettingsPage() {
  const navigate = useNavigate();
  const { success, error } = useToast();
  const [areas, setAreas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [targets, setTargets] = useState({});
  const [syncing, setSyncing] = useState(null);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { areas: rows } = await api.getAdminDiningAreas();
      setAreas(rows || []);
      const t = {};
      (rows || []).forEach((a) => {
        const c = a.target_table_count;
        t[a.id] = c != null && c !== '' ? String(c) : String(a.active_table_count ?? 0);
      });
      setTargets(t);
    } catch (e) {
      error(e.message || 'Bölgeler yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [error]);

  useEffect(() => {
    load();
  }, [load]);

  const handleBack = () => navigate('/settings');

  const applySync = async (areaId) => {
    const raw = targets[areaId];
    const n = Math.max(0, Math.floor(Number(raw)));
    if (!Number.isFinite(n)) {
      error('Geçerli bir sayı girin');
      return;
    }
    setSyncing(areaId);
    try {
      await api.syncDiningAreaTables(areaId, n);
      success('Masa sayısı güncellendi');
      await load();
    } catch (e) {
      error(e.message || 'Senkronizasyon başarısız');
    } finally {
      setSyncing(null);
    }
  };

  return (
    <div className="page-container">
      <SettingsDetailHeader title="Salon bölgeleri ve masa sayısı" onBack={handleBack} />

      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
        Her bölge için hedef masa sayısını girin. Boş masalar güvenle kapatılır; dolu masa veya açık adisyon varken
        sayı düşürülemez.
      </p>

      {loading ? (
        <div className="empty-state">Yükleniyor…</div>
      ) : areas.length === 0 ? (
        <div className="empty-state">Kayıtlı bölge yok</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {areas.map((a) => (
            <div key={a.id} className="card card-padded">
              <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 10 }}>
                <LayoutGrid size={18} color="var(--accent)" />
                <div style={{ fontWeight: 700 }}>{a.name}</div>
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  Aktif masa: {a.active_table_count ?? 0}
                </span>
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  Hedef masa sayısı
                  <input
                    type="number"
                    min={0}
                    className="input"
                    style={{ width: 100 }}
                    value={targets[a.id] ?? ''}
                    onChange={(e) => setTargets((prev) => ({ ...prev, [a.id]: e.target.value }))}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={syncing === a.id}
                  onClick={() => applySync(a.id)}
                >
                  {syncing === a.id ? 'Uygulanıyor…' : 'Uygula'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
