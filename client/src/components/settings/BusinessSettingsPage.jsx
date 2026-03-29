import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import SettingsDetailHeader from './SettingsDetailHeader.jsx';

const empty = { name: '', address: '', tax_id: '', receipt_header: '' };

export default function BusinessSettingsPage() {
  const navigate = useNavigate();
  const { success, error } = useToast();
  const [form, setForm] = useState(empty);
  const [loaded, setLoaded] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { business } = await api.getAdminBusiness();
      const next = {
        name: business.name || '',
        address: business.address || '',
        tax_id: business.tax_id || '',
        receipt_header: business.receipt_header || '',
      };
      setForm(next);
      setLoaded(next);
    } catch (e) {
      error(e.message || 'İşletme bilgileri yüklenemedi');
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
      const { business, message } = await api.patchAdminBusiness(form);
      const next = {
        name: business.name || '',
        address: business.address || '',
        tax_id: business.tax_id || '',
        receipt_header: business.receipt_header || '',
      };
      setForm(next);
      setLoaded(next);
      success(message || 'İşletme bilgileri kaydedildi');
    } catch (e) {
      error(e.message || 'Kayıt başarısız');
    } finally {
      setSaving(false);
    }
  };

  const resetToServer = () => {
    if (dirty && !window.confirm('Kaydedilmemiş değişiklikler atılacak. Devam edilsin mi?')) return;
    load();
  };

  return (
    <div className="page-container">
      <SettingsDetailHeader title="İşletme Bilgileri" onBack={handleBack} />

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 14 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={loading || saving || !dirty}>
          Kaydet
        </button>
        <button type="button" className="btn btn-ghost btn-sm" onClick={resetToServer} disabled={loading || saving}>
          Varsayılanlara dön
        </button>
      </div>

      <div className="card card-padded" style={{ maxWidth: 520 }}>
        {loading ? (
          <div style={{ color: 'var(--text-muted)', fontSize: 14 }}>Yükleniyor…</div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>İşletme adı</span>
              <input
                className="input"
                value={form.name}
                onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Adres</span>
              <input
                className="input"
                value={form.address}
                onChange={(e) => setForm((f) => ({ ...f, address: e.target.value }))}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Vergi numarası</span>
              <input
                className="input"
                value={form.tax_id}
                onChange={(e) => setForm((f) => ({ ...f, tax_id: e.target.value }))}
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Fiş başlığı</span>
              <input
                className="input"
                value={form.receipt_header}
                onChange={(e) => setForm((f) => ({ ...f, receipt_header: e.target.value }))}
              />
            </label>
          </div>
        )}
      </div>
    </div>
  );
}
