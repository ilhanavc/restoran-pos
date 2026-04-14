import { useState, useEffect, useMemo, useRef } from 'react';
import { useNavigate, useParams, useLocation } from 'react-router-dom';
import { Plus, Trash2, ImagePlus, X } from 'lucide-react';
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
  const [imageUrl, setImageUrl] = useState('');
  const [imageFile, setImageFile] = useState(null);
  const [imagePreview, setImagePreview] = useState('');
  const [combos, setCombos] = useState([]);
  const [allProducts, setAllProducts] = useState([]);
  const [comboChildId, setComboChildId] = useState('');
  const [comboQty, setComboQty] = useState(1);
  const [comboLoading, setComboLoading] = useState(false);
  const imageInputRef = useRef(null);

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
        setImageUrl(p.image_url || '');
        // Load combos
        try {
          const comboRows = await api.getProductCombos(productId);
          if (!cancelled) setCombos(comboRows);
        } catch { /* combos optional */ }
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

  // Load all products for combo picker (edit mode only)
  useEffect(() => {
    if (isNew) return;
    api.getProducts({ include_deleted: 0 }).then(setAllProducts).catch(() => {});
  }, [isNew]);

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
    const nextIndex = portions.length;
    const row = {
      key: `p${Date.now()}`,
      label: `Porsiyon ${nextIndex + 1}`,
      price: '',
      is_default: false,
    };
    setPortions((prev) => [...prev, row]);
    setActivePortionIdx(nextIndex);
  };

  const removePortion = (idx) => {
    if (portions.length <= 1) {
      error('En az bir porsiyon olmalı');
      return;
    }
    const next = portions.filter((_, i) => i !== idx);
    const fixed = next.some((p) => p.is_default)
      ? next
      : next.map((p, i) => ({ ...p, is_default: i === 0 }));
    setPortions(fixed);
    setActivePortionIdx((cur) => {
      if (cur === idx) return Math.min(idx, fixed.length - 1);
      if (cur > idx) return cur - 1;
      return cur;
    });
  };

  const updatePortionField = (idx, field, value) => {
    setPortions((prev) => {
      const next = [...prev];
      next[idx] = { ...next[idx], [field]: value };
      return next;
    });
  };

  const handleImagePick = (file) => {
    if (!file) return;
    setImageFile(file);
    setImagePreview(URL.createObjectURL(file));
  };

  const handleImageUpload = async (productId) => {
    if (!imageFile) return;
    try {
      const res = await api.uploadProductImage(productId, imageFile);
      setImageUrl(res.image_url);
      setImageFile(null);
      setImagePreview('');
    } catch (e) {
      error(e.message || 'Görsel yüklenemedi');
    }
  };

  const handleRemoveImage = async () => {
    if (!productId || isNew) { setImageFile(null); setImagePreview(''); return; }
    try {
      await api.deleteProductImage(productId);
      setImageUrl('');
      setImagePreview('');
      setImageFile(null);
    } catch (e) {
      error(e.message || 'Görsel kaldırılamadı');
    }
  };

  const handleAddCombo = async () => {
    if (!comboChildId) return;
    setComboLoading(true);
    try {
      const row = await api.addProductCombo(productId, { child_product_id: comboChildId, quantity: comboQty });
      const child = allProducts.find(p => p.id === comboChildId);
      setCombos(prev => [...prev, { ...row, child_name: child?.name || row.child_name }]);
      setComboChildId('');
      setComboQty(1);
    } catch (e) {
      error(e.message || 'Combo öğesi eklenemedi');
    } finally {
      setComboLoading(false);
    }
  };

  const handleRemoveCombo = async (comboId) => {
    try {
      await api.removeProductCombo(productId, comboId);
      setCombos(prev => prev.filter(c => c.id !== comboId));
    } catch (e) {
      error(e.message || 'Combo öğesi kaldırılamadı');
    }
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
        const newProduct = await api.postProduct({
          name: trimmed,
          category_id: categoryId,
          price: defaultPrice,
          description: description.trim(),
          barcode: barcode.trim(),
          printer_target: printerTarget || null,
          portions: portionsPayload,
        });
        if (imageFile) await handleImageUpload(newProduct.id);
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
        if (imageFile) await handleImageUpload(productId);
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

      {/* ── Görsel ── */}
      <section className="menu-product-section">
        <h2 className="menu-product-section-title">Ürün görseli</h2>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: 16, flexWrap: 'wrap' }}>
          {(imagePreview || imageUrl) && (
            <div style={{ position: 'relative', display: 'inline-block' }}>
              <img
                src={imagePreview || imageUrl}
                alt="Ürün görseli"
                style={{ width: 120, height: 120, objectFit: 'cover', borderRadius: 8, border: '1px solid var(--border)' }}
              />
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                style={{ position: 'absolute', top: -8, right: -8, background: 'var(--bg-primary)', border: '1px solid var(--border)', borderRadius: '50%', width: 24, height: 24, padding: 0 }}
                onClick={handleRemoveImage}
                title="Görseli kaldır"
              >
                <X size={12} />
              </button>
            </div>
          )}
          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            <button
              type="button"
              className="btn btn-ghost"
              style={{ display: 'flex', alignItems: 'center', gap: 6 }}
              onClick={() => imageInputRef.current?.click()}
            >
              <ImagePlus size={16} />
              {imageUrl || imagePreview ? 'Görseli değiştir' : 'Görsel seç'}
            </button>
            <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>Maks. 5 MB · JPG, PNG, WEBP</span>
            <input
              ref={imageInputRef}
              type="file"
              accept="image/*"
              style={{ display: 'none' }}
              onChange={(e) => handleImagePick(e.target.files?.[0])}
            />
          </div>
        </div>
      </section>

      {/* ── Combo Menü (sadece mevcut ürünlerde) ── */}
      {!isNew && (
        <section className="menu-product-section">
          <h2 className="menu-product-section-title">Combo içeriği</h2>
          <p className="menu-product-section-lead">
            Bu ürünü sipariş edildiğinde otomatik eklenmesini istediğiniz alt ürünleri belirtin. Örn: &quot;Lahmacun Menü&quot; = Lahmacun + Ayran + Salata
          </p>

          {combos.length > 0 && (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 6, marginBottom: 12 }}>
              {combos.map(c => (
                <div key={c.id} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '8px 12px', background: 'var(--bg-secondary)', borderRadius: 8, border: '1px solid var(--border)' }}>
                  <span style={{ flex: 1, fontSize: 13 }}>{c.child_name}</span>
                  <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 60 }}>{c.quantity} adet</span>
                  <button type="button" className="btn btn-ghost btn-icon btn-sm" onClick={() => handleRemoveCombo(c.id)} title="Kaldır">
                    <Trash2 size={13} />
                  </button>
                </div>
              ))}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, alignItems: 'center', flexWrap: 'wrap' }}>
            <select
              className="input"
              style={{ flex: 1, minWidth: 180 }}
              value={comboChildId}
              onChange={e => setComboChildId(e.target.value)}
            >
              <option value="">— Ürün seç —</option>
              {allProducts
                .filter(p => p.id !== productId && !combos.some(c => c.child_product_id === p.id))
                .map(p => <option key={p.id} value={p.id}>{p.name}</option>)}
            </select>
            <input
              type="number"
              className="input"
              style={{ width: 72 }}
              min={1}
              value={comboQty}
              onChange={e => setComboQty(Math.max(1, Number(e.target.value) || 1))}
              placeholder="Adet"
            />
            <button
              type="button"
              className="btn btn-ghost"
              disabled={!comboChildId || comboLoading}
              onClick={handleAddCombo}
            >
              <Plus size={15} /> Ekle
            </button>
          </div>
        </section>
      )}
    </div>
  );
}
