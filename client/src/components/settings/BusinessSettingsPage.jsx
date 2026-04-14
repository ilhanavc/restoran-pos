import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import useConfirmDialog from '../common/useConfirmDialog.js';
import SettingsDetailHeader from './SettingsDetailHeader.jsx';

const empty = { name: '', address: '', tax_id: '', phone: '', receipt_header: '', receipt_footer: '' };

export default function BusinessSettingsPage() {
  const navigate = useNavigate();
  const { success, error } = useToast();
  const [form, setForm] = useState(empty);
  const [loaded, setLoaded] = useState(empty);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { confirmDialog, requestConfirm, cancelConfirm, acceptConfirm } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { business } = await api.getAdminBusiness();
      const next = {
        name: business.name || '',
        address: business.address || '',
        tax_id: business.tax_id || '',
        phone: business.phone || '',
        receipt_header: business.receipt_header || '',
        receipt_footer: business.receipt_footer || '',
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
    if (dirty) {
      requestConfirm({
        title: 'Kaydedilmemiş değişiklikler var',
        body: 'İşletme bilgilerindeki değişiklikler kaybolacak. Çıkmak istiyor musunuz?',
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
      const { business, message } = await api.patchAdminBusiness(form);
      const next = {
        name: business.name || '',
        address: business.address || '',
        tax_id: business.tax_id || '',
        phone: business.phone || '',
        receipt_header: business.receipt_header || '',
        receipt_footer: business.receipt_footer || '',
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
    if (dirty) {
      requestConfirm({
        title: 'Değişiklikler atılsın mı?',
        body: 'Kaydedilmemiş işletme bilgileri sunucudaki son değerlerle değiştirilecek.',
        confirmLabel: 'Değişiklikleri at',
        tone: 'danger',
        onConfirm: load,
      });
      return;
    }
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
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Telefon</span>
              <input
                className="input"
                value={form.phone}
                onChange={(e) => setForm((f) => ({ ...f, phone: e.target.value }))}
                placeholder="0212 000 00 00"
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
                placeholder="Hoş geldiniz!"
              />
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 6 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Fiş altı yazısı</span>
              <input
                className="input"
                value={form.receipt_footer}
                onChange={(e) => setForm((f) => ({ ...f, receipt_footer: e.target.value }))}
                placeholder="Afiyet Olsun"
              />
            </label>
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
