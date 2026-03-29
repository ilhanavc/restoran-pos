import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { applyDisplaySettings } from '../../utils/displayTheme.js';
import SettingsDetailHeader from './SettingsDetailHeader.jsx';

const defaults = { theme: 'dark', language: 'tr', density: 'comfortable' };

export default function DisplaySettingsPage() {
  const navigate = useNavigate();
  const { success, error, info } = useToast();
  const [form, setForm] = useState(defaults);
  const [loaded, setLoaded] = useState(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { display } = await api.getDisplaySettings();
      const next = { ...defaults, ...display };
      next.theme = 'dark';
      setForm(next);
      setLoaded({ ...next });
    } catch (e) {
      error(e.message || 'Ayarlar yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [error]);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = useMemo(() => JSON.stringify(form) !== JSON.stringify(loaded), [form, loaded]);

  const handleBack = () => {
    if (dirty && !window.confirm('Kaydedilmemiş değişiklikler var. Çıkmak istiyor musunuz?')) return;
    navigate('/settings');
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = { ...form, theme: 'dark' };
      const { display, message } = await api.patchDisplaySettings(body);
      const next = { ...defaults, ...display, theme: 'dark' };
      setForm(next);
      setLoaded({ ...next });
      applyDisplaySettings(next);
      success(message || 'Ekran ayarları kaydedildi');
      if (next.language === 'en') {
        info('İngilizce dil tercihi kaydedildi; arayüz çevirileri yakında eklenecek.');
      }
    } catch (e) {
      error(e.message || 'Kayıt başarısız');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-container">
      <SettingsDetailHeader title="Ekran Ayarları" onBack={handleBack} />

      <div style={{ marginBottom: 14 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={loading || saving || !dirty}>
          Kaydet
        </button>
      </div>

      <div className="card card-padded" style={{ maxWidth: 480 }}>
        {loading ? (
          <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>Tema</div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer' }}>
                <input type="radio" name="theme" checked readOnly />
                <span>Koyu (aktif — tek desteklenen tema)</span>
              </label>
              <div style={{ marginTop: 8, fontSize: 12, color: 'var(--text-muted)' }}>
                Açık ve sistem teması için uygulama güncellemesi gerekecek.
              </div>
            </div>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Dil</span>
              <select
                className="input"
                value={form.language}
                onChange={(e) => setForm((f) => ({ ...f, language: e.target.value }))}
                style={{ cursor: 'pointer' }}
              >
                <option value="tr">Türkçe</option>
                <option value="en">English (kısmi)</option>
              </select>
            </label>

            <label style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Görünüm / sıklık</span>
              <select
                className="input"
                value={form.density}
                onChange={(e) => setForm((f) => ({ ...f, density: e.target.value }))}
                style={{ cursor: 'pointer' }}
              >
                <option value="comfortable">Rahat (daha geniş aralık)</option>
                <option value="compact">Sıkı (daha çok satır)</option>
              </select>
            </label>

            <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
              Görünüm sıklığı kaydedildiğinde hemen uygulanır. Dil tercihi veritabanında saklanır.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}
