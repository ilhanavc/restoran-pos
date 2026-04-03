import { useState, useEffect, useMemo } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import SettingsDetailHeader from './SettingsDetailHeader.jsx';

const PRINTER_OPTIONS = [
  { value: 'kitchen', label: 'Mutfak' },
  { value: 'bar', label: 'Bar' },
];

export default function MenuProductEditorPage() {
  const { productId } = useParams();
  const navigate = useNavigate();
  const location = useLocation();
  const { success, error } = useToast();
  const isNew = productId === 'new';

  const [loading, setLoading] = useState(!isNew);
  const [categories, setCategories] = useState([]);
  const [name, setName] = useState('');
  const [categoryId, setCategoryId] = useState('');
  const [description, setDescription] = useState('');
  const [barcode, setBarcode] = useState('');
  const [printerTarget, setPrinterTarget] = useState('kitchen');
  const [isActive, setIsActive] = useState(true);
  const [portions, setPortions] = useState(() => [
    { key: 'p0', label: 'Tam', price: '', is_default: true },
  ]);
  const [activePortionIdx, setActivePortionIdx] = useState(0);
  const [saving, setSaving] = useState(false);

  const defaultCategoryFromNav = location.state?.defaultCategoryId;

  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cats = await api.getCategories({ include_inactive: 1 });
        if (!cancelled) setCategories(cats);
      } catch (e) {
        if (!cancelled) error(e.message || 'Kategoriler yüklenemedi');
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []); // eslint-disable-line react-hooks/exhaustive-deps -- mount-only; `error` deps caused duplicate fetch/toast

  useEffect(() => {
    if (isNew) {
      if (defaultCategoryFromNav) setCategoryId(defaultCategoryFromNav);
      setLoading(false);
      return;
    }
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const p = await api.getProduct(productId);
        if (cancelled) return;
        setName(p.name || '');
        setCategoryId(p.category_id || '');
        setDescription(p.description || '');
        setBarcode(p.barcode || '');
        setPrinterTarget(p.printer_target || 'kitchen');
        setIsActive(Number(p.is_active) === 1);
        const pts = (p.portions || []).map((x, i) => ({
          key: x.id || `p${i}`,
          label: x.label,
          price: String(x.price),
          is_default: !!Number(x.is_default),
        }));
        if (pts.length === 0) {
          pts.push({ key: 'p0', label: 'Tam', price: String(p.price ?? ''), is_default: true });
        }
        setPortions(pts);
        setActivePortionIdx(0);
      } catch (e) {
        if (!cancelled) {
          error(e.message || 'Ürün yüklenemedi');
          navigate('/settings/menu');
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [isNew, productId, defaultCategoryFromNav, navigate]);

  useEffect(() => {
    if (!isNew || categoryId) return;
    const first = categories.find((c) => Number(c?.is_active) === 1)?.id;
    if (first) setCategoryId(first);
  }, [isNew, categories, categoryId]);

  const activeCats = useMemo(
    () =>
      categories.filter(
        (c) => Number(c?.is_active) === 1 || (categoryId && c.id === categoryId),
      ),
    [categories, categoryId],
  );

  const setDefaultPortion = (idx) => {
    setPortions((prev) => prev.map((p, i) => ({ ...p, is_default: i === idx })));
  };

  const addPortion = () => {
    setPortions((prev) => {
      const n = prev.length + 1;
      const row = { key: `p${Date.now()}`, label: `Porsiyon ${n}`, price: '', is_default: false };
      const next = [...prev, row];
      setActivePortionIdx(next.length - 1);
      return next;
    });
  };

  const removePortion = (idx) => {
    if (portions.length <= 1) {
      error('En az bir porsiyon olmalı');
      return;
    }
    setPortions((prev) => {
      const next = prev.filter((_, i) => i !== idx);
      const hasDef = next.some((p) => p.is_default);
      const fixed = !hasDef ? next.map((p, i) => ({ ...p, is_default: i === 0 })) : next;
      setActivePortionIdx((cur) => {
        if (cur === idx) return Math.min(idx, fixed.length - 1);
        if (cur > idx) return cur - 1;
        return cur;
      });
      return fixed;
    });
  };

  const updatePortionField = (idx, field, value) => {
    setPortions((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      error('Ürün adı gerekli');
      return;
    }
    if (!categoryId) {
      error('Kategori seçin');
      return;
    }
    for (const pt of portions) {
      const pr = Number(pt.price);
      if (!Number.isFinite(pr) || pr <= 0) {
        error(`"${pt.label || 'Porsiyon'}" için geçerli fiyat girin`);
        return;
      }
    }
    const portionsPayload = portions.map((p, i) => ({
      label: (p.label || '').trim() || `Porsiyon ${i + 1}`,
      price: Number(p.price),
      sort_order: i,
      is_default: p.is_default,
    }));
    const defaultPrice = portionsPayload.find((x) => x.is_default)?.price ?? portionsPayload[0].price;

    setSaving(true);
    try {
      if (isNew) {
        await api.postProduct({
          name: trimmed,
          category_id: categoryId,
          price: defaultPrice,
          description: description.trim(),
          barcode: barcode.trim(),
          printer_target: printerTarget || null,
          portions: portionsPayload,
        });
        success('Ürün eklendi');
      } else {
        await api.patchProduct(productId, {
          name: trimmed,
          category_id: categoryId,
          description: description.trim(),
          barcode: barcode.trim(),
          printer_target: printerTarget || null,
          is_active: isActive,
          portions: portionsPayload,
        });
        success('Ürün güncellendi');
      }
      navigate('/settings/menu');
    } catch (e) {
      error(e.message || 'Kayıt başarısız');
    } finally {
      setSaving(false);
    }
  };

  const handleBack = () => navigate('/settings/menu');

  if (loading) {
    return (
      <div className="page-container menu-product-editor">
        <SettingsDetailHeader title="Ürün" onBack={handleBack} />
        <div className="empty-state">Yükleniyor…</div>
      </div>
    );
  }

  const sel = portions[activePortionIdx];

  return (
    <div className="page-container menu-product-editor">
      <div className="menu-product-editor-head">
        <SettingsDetailHeader title={isNew ? 'Yeni ürün' : 'Ürün detayı'} onBack={handleBack} />
        <button type="button" className="btn btn-primary menu-product-editor-save" onClick={handleSave} disabled={saving || activeCats.length === 0}>
          {saving ? 'Kaydediliyor…' : 'Kaydet'}
        </button>
      </div>

      <p className="menu-settings-lead menu-product-editor-lead">
        Genel bilgileri ve porsiyonları buradan yönetin; varsayılan porsiyon fiyatı sipariş ekranında listelenen fiyattır.
      </p>

      <section className="menu-product-section">
        <h2 className="menu-product-section-title">Genel bilgiler</h2>
        <div className="menu-product-fields">
          <div className="menu-product-field">
            <span className="menu-product-label">Ürün adı</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus placeholder="Örn. Kuşbaşılı Pide" />
          </div>
          <div className="menu-product-field">
            <span className="menu-product-label">Kategori</span>
            {activeCats.length === 0 ? (
              <div className="empty-state" style={{ padding: 12 }}>
                Önce aktif kategori ekleyin
              </div>
            ) : (
              <select className="input" value={categoryId} onChange={(e) => setCategoryId(e.target.value)}>
                {activeCats.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.icon || '🍽️'} {c.name}
                  </option>
                ))}
              </select>
            )}
          </div>
          <div className="menu-product-field menu-product-field--wide">
            <span className="menu-product-label">Açıklama</span>
            <textarea className="input menu-product-textarea" rows={3} value={description} onChange={(e) => setDescription(e.target.value)} placeholder="İsteğe bağlı" />
          </div>
          <div className={`menu-product-row--extras${!isNew ? ' menu-product-row--extras-with-toggle' : ''}`}>
            <div className="menu-product-field">
              <span className="menu-product-label">Barkod</span>
              <input className="input" value={barcode} onChange={(e) => setBarcode(e.target.value)} placeholder="İsteğe bağlı" />
            </div>
            <div className="menu-product-field">
              <span className="menu-product-label">Yazıcı hedefi</span>
              <select className="input" value={printerTarget} onChange={(e) => setPrinterTarget(e.target.value)}>
                {PRINTER_OPTIONS.map((o) => (
                  <option key={o.value} value={o.value}>
                    {o.label}
                  </option>
                ))}
              </select>
            </div>
            {!isNew && (
              <div className="menu-product-field menu-product-field--toggle">
                <span className="menu-product-label menu-product-label--spacer" aria-hidden="true">
                  .
                </span>
                <label className="menu-product-toggle">
                  <input type="checkbox" checked={isActive} onChange={(e) => setIsActive(e.target.checked)} />
                  <span>Menüde aktif (sipariş ekranında listelenir)</span>
                </label>
              </div>
            )}
          </div>
        </div>
      </section>

      <section className="menu-product-section">
        <h2 className="menu-product-section-title">Porsiyon bilgileri</h2>
        <p className="menu-product-section-lead">
          Örneğin Tam, Yarım veya Bir buçuk gibi seçenekler ekleyin. Varsayılan işaretli porsiyonun fiyatı, ürünün ana satış fiyatı olarak kaydedilir.
        </p>
        <div className="menu-product-portion-tabs" role="tablist">
          {portions.map((p, i) => (
            <div key={p.key} className="menu-product-portion-tab-wrap">
              <button
                type="button"
                role="tab"
                aria-selected={activePortionIdx === i}
                className={`menu-product-portion-tab ${activePortionIdx === i ? 'menu-product-portion-tab--active' : ''}`}
                onClick={() => setActivePortionIdx(i)}
              >
                {p.label?.trim() || `Porsiyon ${i + 1}`}
              </button>
              {portions.length > 1 && (
                <button
                  type="button"
                  className="btn btn-ghost btn-sm btn-icon menu-product-portion-remove"
                  title="Porsiyonu kaldır"
                  onClick={(e) => {
                    e.stopPropagation();
                    removePortion(i);
                  }}
                >
                  <Trash2 size={14} />
                </button>
              )}
            </div>
          ))}
          <button type="button" className="btn btn-ghost btn-sm menu-product-portion-add" onClick={addPortion}>
            <Plus size={16} />
            Porsiyon ekle
          </button>
        </div>

        {sel && (
          <div className="menu-product-portion-panel">
            <div className="menu-product-row--portion">
              <div className="menu-product-field">
                <span className="menu-product-label">Porsiyon adı</span>
                <input
                  className="input"
                  value={sel.label}
                  onChange={(e) => updatePortionField(activePortionIdx, 'label', e.target.value)}
                  placeholder="Örn. Tam"
                />
              </div>
              <div className="menu-product-field">
                <span className="menu-product-label">Fiyat (₺, KDV dahil)</span>
                <input
                  type="number"
                  min="0.01"
                  step="0.01"
                  className="input"
                  value={sel.price}
                  onChange={(e) => updatePortionField(activePortionIdx, 'price', e.target.value)}
                />
              </div>
              <div className="menu-product-field menu-product-field--toggle">
                <span className="menu-product-label menu-product-label--spacer" aria-hidden="true">
                  .
                </span>
                <label className="menu-product-toggle">
                  <input
                    type="radio"
                    name="defaultPortion"
                    checked={sel.is_default}
                    onChange={() => setDefaultPortion(activePortionIdx)}
                  />
                  <span>Varsayılan porsiyon (sipariş ekranı fiyatı)</span>
                </label>
              </div>
            </div>
          </div>
        )}
      </section>
    </div>
  );
}
