import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { applyDisplaySettings, persistDisplaySettings } from '../../utils/displayTheme.js';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import useConfirmDialog from '../common/useConfirmDialog.js';
import SettingsDetailHeader from './SettingsDetailHeader.jsx';

const defaults = { theme: 'dark', language: 'tr', density: 'comfortable' };
const THEME_OPTIONS = [
  { value: 'dark', label: 'Koyu', desc: 'Mevcut koyu POS görünümü korunur.' },
  { value: 'light', label: 'Aydınlık', desc: 'Profesyonel, dengeli ve mor vurgu kimliğini koruyan açık tema.' },
];

export default function DisplaySettingsPage() {
  const navigate = useNavigate();
  const { success, error, info } = useToast();
  const [form, setForm] = useState(defaults);
  const [loaded, setLoaded] = useState(defaults);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { confirmDialog, requestConfirm, cancelConfirm, acceptConfirm } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { display } = await api.getDisplaySettings();
      const next = { ...defaults, ...display };
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
    if (dirty) {
      requestConfirm({
        title: 'Kaydedilmemiş değişiklikler var',
        body: 'Ekran ayarlarındaki değişiklikler kaybolacak. Çıkmak istiyor musunuz?',
        confirmLabel: 'Çık',
        tone: 'danger',
        onConfirm: () => navigate('/settings'),
      });
      return;
    }
    navigate('/settings');
  };

  const save = async () => {
    setSaving(true);
    try {
      const body = { ...form };
      const { display, message } = await api.patchDisplaySettings(body);
      const next = { ...defaults, ...display };
      setForm(next);
      setLoaded({ ...next });
      applyDisplaySettings(next);
      persistDisplaySettings(next);
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

      <div className="card card-padded" style={{ maxWidth: 560 }}>
        {loading ? (
          <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 20 }}>
            <div>
              <div style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 10 }}>Tema</div>
              <div style={{ display: 'grid', gap: 10 }}>
                {THEME_OPTIONS.map((option) => {
                  const active = form.theme === option.value;
                  return (
                    <label
                      key={option.value}
                      style={{
                        display: 'flex',
                        alignItems: 'flex-start',
                        gap: 12,
                        cursor: 'pointer',
                        padding: '12px 14px',
                        borderRadius: 'var(--radius-md)',
                        border: `1px solid ${active ? 'var(--accent)' : 'var(--border)'}`,
                        background: active ? 'var(--accent-soft)' : 'var(--surface-2)',
                        boxShadow: active ? 'var(--shadow-soft)' : 'none',
                      }}
                    >
                      <input
                        type="radio"
                        name="theme"
                        value={option.value}
                        checked={active}
                        onChange={(e) => {
                          const next = { ...form, theme: e.target.value };
                          setForm(next);
                          applyDisplaySettings(next);
                          persistDisplaySettings(next);
                        }}
                      />
                      <span style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                        <span style={{ fontWeight: 700, color: 'var(--text-primary)' }}>{option.label}</span>
                        <span style={{ fontSize: 12, color: 'var(--text-secondary)', lineHeight: 1.5 }}>{option.desc}</span>
                      </span>
                    </label>
                  );
                })}
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
              Tema ve görünüm sıklığı kaydedildiğinde tüm uygulamaya uygulanır. Dil tercihi veritabanında saklanır.
            </p>
          </div>
        )}
      </div>

      <ConfirmDialog
        open={!!confirmDialog}
        title={confirmDialog?.title}
        body={confirmDialog?.body}
        confirmLabel={confirmDialog?.confirmLabel}
        tone={confirmDialog?.tone}
        onCancel={cancelConfirm}
        onConfirm={acceptConfirm}
      />
    </div>
  );
}
