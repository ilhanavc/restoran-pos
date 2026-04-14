import { useCallback, useEffect, useMemo, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import useConfirmDialog from '../common/useConfirmDialog.js';
import SettingsDetailHeader from './SettingsDetailHeader.jsx';
import { primaryTypeLabel } from './printerDefaults.js';

function printerOptionLabel(p) {
  return `${p.name} (${primaryTypeLabel(p.type)})`;
}

export default function PrinterRoutingPage() {
  const navigate = useNavigate();
  const { success, error } = useToast();
  const [categories, setCategories] = useState([]);
  const [printers, setPrinters] = useState([]);
  const [selection, setSelection] = useState({});
  const [loadedSig, setLoadedSig] = useState('');
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const { confirmDialog, requestConfirm, cancelConfirm, acceptConfirm } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const data = await api.getAdminPrinterRouting();
      const cats = data.categories || [];
      const prs = data.printers || [];
      const assign = data.assignments || [];
      const map = {};
      for (const c of cats) {
        map[c.id] = '';
      }
      for (const a of assign) {
        if (a.category_id && a.printer_id) map[a.category_id] = a.printer_id;
      }
      setCategories(cats);
      setPrinters(prs);
      setSelection(map);
      setLoadedSig(JSON.stringify(map));
    } catch (e) {
      error(e.message || 'Veriler yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [error]);

  useEffect(() => {
    load();
  }, [load]);

  const dirty = useMemo(() => JSON.stringify(selection) !== loadedSig, [selection, loadedSig]);

  const handleBack = () => {
    if (dirty) {
      requestConfirm({
        title: 'Kaydedilmemiş değişiklikler var',
        body: 'Yazıcı yönlendirme değişiklikleri kaybolacak. Çıkmak istiyor musunuz?',
        confirmLabel: 'Çık',
        tone: 'danger',
        onConfirm: () => navigate('/settings/printers'),
      });
      return;
    }
    navigate('/settings/printers');
  };

  const setPrinter = (categoryId, printerId) => {
    setSelection((s) => ({ ...s, [categoryId]: printerId || '' }));
  };

  const save = async () => {
    setSaving(true);
    try {
      const assignments = categories.map((c) => ({
        category_id: c.id,
        printer_id: selection[c.id] || null,
      }));
      await api.patchAdminPrinterRouting({ assignments });
      success('Yazıcı yönlendirmesi kaydedildi');
      await load();
    } catch (e) {
      error(e.message || 'Kayıt başarısız');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="page-container">
      <SettingsDetailHeader title="Kategori → Yazıcı Yönlendirme" onBack={handleBack} />

      <p style={{ margin: '0 0 16px', color: 'var(--text-secondary)', fontSize: 14, maxWidth: 720 }}>
        Her kategoriyi doğrudan bir yazıcıya bağlayın (ör. fırın, ızgara, bar). Boş bırakıldığında sistem{' '}
        <strong>ürün/kategori printer_target</strong> ve diğer varsayılan kuralları kullanır.
      </p>

      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, marginBottom: 16 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={save} disabled={loading || saving || !dirty}>
          Kaydet
        </button>
        <Link to="/settings/printers" className="btn btn-ghost btn-sm">
          Yazıcı listesine dön
        </Link>
      </div>

      {loading ? (
        <div style={{ color: 'var(--text-muted)' }}>Yükleniyor…</div>
      ) : categories.length === 0 ? (
        <div className="card card-padded" style={{ color: 'var(--text-muted)' }}>
          Henüz aktif kategori yok.{' '}
          <Link to="/settings/menu" style={{ color: 'var(--accent)' }}>
            Menü tanımları
          </Link>{' '}
          üzerinden kategori ekleyin.
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <div
            style={{
              display: 'grid',
              gridTemplateColumns: 'minmax(140px,1fr) minmax(200px,1.2fr)',
              gap: 12,
              padding: '12px 16px',
              borderBottom: '1px solid var(--border)',
              fontSize: 11,
              fontWeight: 700,
              color: 'var(--text-muted)',
              textTransform: 'uppercase',
              letterSpacing: '0.04em',
            }}
          >
            <span>Kategori</span>
            <span>Hedef yazıcı</span>
          </div>
          {categories.map((c) => (
            <div
              key={c.id}
              style={{
                display: 'grid',
                gridTemplateColumns: 'minmax(140px,1fr) minmax(200px,1.2fr)',
                gap: 12,
                padding: '12px 16px',
                borderBottom: '1px solid var(--border)',
                alignItems: 'center',
              }}
            >
              <span style={{ fontWeight: 600 }}>{c.name}</span>
              <select
                className="input"
                value={selection[c.id] || ''}
                onChange={(e) => setPrinter(c.id, e.target.value)}
                style={{ cursor: 'pointer' }}
              >
                <option value="">— Varsayılan / yönlendirme yok —</option>
                {printers.map((p) => (
                  <option key={p.id} value={p.id}>
                    {printerOptionLabel(p)}
                  </option>
                ))}
              </select>
            </div>
          ))}
        </div>
      )}

      {printers.length === 0 && !loading && (
        <p style={{ marginTop: 14, fontSize: 13, color: 'var(--text-muted)' }}>
          Aktif yazıcı yok. Önce{' '}
          <Link to="/settings/printers" style={{ color: 'var(--accent)' }}>
            yazıcı ekleyin
          </Link>
          .
        </p>
      )}
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
