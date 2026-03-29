import { useCallback, useEffect, useMemo, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Plus, Pencil, Trash2, UtensilsCrossed } from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency } from '../../constants/index.js';
import { MENU_ICON_OPTIONS, MENU_COLOR_OPTIONS } from '../../constants/menuUi.js';
import SettingsDetailHeader from './SettingsDetailHeader.jsx';

const PRINTER_OPTIONS = [
  { value: 'kitchen', label: 'Mutfak' },
  { value: 'bar', label: 'Bar' },
];

function CategoryModal({ item, categories, onClose, onSaved }) {
  const { success, error } = useToast();
  const [name, setName] = useState(item?.name || '');
  const [icon, setIcon] = useState(item?.icon || '🍽️');
  const [color, setColor] = useState(item?.color || '#6366f1');
  const [printerTarget, setPrinterTarget] = useState(item?.printer_target || 'kitchen');
  const [saving, setSaving] = useState(false);
  const isEdit = !!item?.id;

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      error('Kategori adı boş olamaz');
      return;
    }
    const dup = categories.find(
      (c) => c.id !== item?.id && Number(c.is_active) === 1 && c.name.trim().toLowerCase() === trimmed.toLowerCase(),
    );
    if (dup) {
      error('Bu isimde aktif bir kategori zaten var');
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await api.patchCategory(item.id, {
          name: trimmed,
          icon,
          color,
          printer_target: printerTarget,
        });
      } else {
        await api.postCategory({
          name: trimmed,
          icon,
          color,
          printer_target: printerTarget,
        });
      }
      success(isEdit ? 'Kategori güncellendi' : 'Kategori eklendi');
      onSaved();
    } catch (e) {
      error(e.message || 'Kayıt başarısız');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div role="dialog" className="modal" style={{ maxWidth: 480, width: '100%' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? 'Kategori düzenle' : 'Yeni kategori'}</h2>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} disabled={saving}>
            ×
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '0 4px 16px' }}>
          <div>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Ad</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Yazıcı</span>
            <select className="input" value={printerTarget} onChange={(e) => setPrinterTarget(e.target.value)}>
              {PRINTER_OPTIONS.map((o) => (
                <option key={o.value} value={o.value}>
                  {o.label}
                </option>
              ))}
            </select>
          </div>
          <div>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>İkon</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
              {MENU_ICON_OPTIONS.map((ic) => (
                <button
                  key={ic}
                  type="button"
                  className={`btn btn-sm ${icon === ic ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ minWidth: 44, padding: 8 }}
                  onClick={() => setIcon(ic)}
                >
                  {ic}
                </button>
              ))}
            </div>
          </div>
          <div>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Renk</span>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
              {MENU_COLOR_OPTIONS.map((c) => (
                <button
                  key={c}
                  type="button"
                  title={c}
                  onClick={() => setColor(c)}
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 8,
                    background: c,
                    border: color === c ? '3px solid var(--text-primary)' : '2px solid transparent',
                    cursor: 'pointer',
                  }}
                />
              ))}
            </div>
          </div>
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              İptal
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
              {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

function ProductModal({ item, categories, onClose, onSaved }) {
  const { success, error } = useToast();
  const activeCats = categories.filter(
    (c) => Number(c.is_active) === 1 || (item?.category_id && c.id === item.category_id),
  );
  const [name, setName] = useState(item?.name || '');
  const [price, setPrice] = useState(item?.price != null ? String(item.price) : '');
  const [categoryId, setCategoryId] = useState(item?.category_id || activeCats[0]?.id || '');
  const [saving, setSaving] = useState(false);
  const isEdit = !!item?.id;

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) {
      error('Ürün adı gerekli');
      return;
    }
    const p = Number(price);
    if (!Number.isFinite(p) || p <= 0) {
      error('Geçerli bir fiyat girin');
      return;
    }
    if (!categoryId) {
      error('Kategori seçin');
      return;
    }
    setSaving(true);
    try {
      if (isEdit) {
        await api.patchProduct(item.id, {
          name: trimmed,
          price: p,
          category_id: categoryId,
        });
      } else {
        await api.postProduct({
          name: trimmed,
          price: p,
          category_id: categoryId,
        });
      }
      success(isEdit ? 'Ürün güncellendi' : 'Ürün eklendi');
      onSaved();
    } catch (e) {
      error(e.message || 'Kayıt başarısız');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div role="dialog" className="modal" style={{ maxWidth: 480, width: '100%' }} onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{isEdit ? 'Ürün düzenle' : 'Yeni ürün'}</h2>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} disabled={saving}>
            ×
          </button>
        </div>
        <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '0 4px 16px' }}>
          <div>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Ad</span>
            <input className="input" value={name} onChange={(e) => setName(e.target.value)} autoFocus />
          </div>
          <div>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Fiyat (₺, KDV dahil)</span>
            <input type="number" min="0.01" step="0.01" className="input" value={price} onChange={(e) => setPrice(e.target.value)} />
          </div>
          <div>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>Kategori</span>
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
          <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8, marginTop: 8 }}>
            <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
              İptal
            </button>
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || activeCats.length === 0}>
              {saving ? 'Kaydediliyor…' : 'Kaydet'}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function MenuSettingsPage() {
  const navigate = useNavigate();
  const { success, error } = useToast();
  const [tab, setTab] = useState('categories');
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  const [filterCat, setFilterCat] = useState('all');
  const [catModal, setCatModal] = useState(null);
  const [prodModal, setProdModal] = useState(null);

  const loadCategories = useCallback(async () => {
    const rows = await api.getCategories({ include_inactive: 1 });
    setCategories(rows);
  }, []);

  const loadProducts = useCallback(async () => {
    const rows = await api.getProducts({ include_deleted: 1 });
    setProducts(rows);
  }, []);

  const load = useCallback(async () => {
    setLoading(true);
    try {
      await Promise.all([loadCategories(), loadProducts()]);
    } catch (e) {
      error(e.message || 'Veriler yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [error, loadCategories, loadProducts]);

  useEffect(() => {
    load();
  }, [load]);

  const handleBack = () => navigate('/settings');

  const isCatActive = (c) => Number(c?.is_active) === 1;

  const productCountByCat = useMemo(() => {
    const m = {};
    products.forEach((p) => {
      if (p.is_deleted) return;
      m[p.category_id] = (m[p.category_id] || 0) + 1;
    });
    return m;
  }, [products]);

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const ms = !search || p.name.toLowerCase().includes(search.toLowerCase());
      const mc = filterCat === 'all' || p.category_id === filterCat;
      return ms && mc;
    });
  }, [products, search, filterCat]);

  const deleteCategory = async (id) => {
    if (!window.confirm('Bu kategori pasif yapılacak ve içindeki ürünler menüden kaldırılacak. Devam edilsin mi?')) return;
    try {
      await api.deleteCategory(id);
      success('Kategori kaldırıldı');
      await load();
    } catch (e) {
      error(e.message || 'İşlem başarısız');
    }
  };

  const deleteProduct = async (id) => {
    if (!window.confirm('Ürün menüden kaldırılsın mı?')) return;
    try {
      await api.deleteProduct(id);
      success('Ürün kaldırıldı');
      await loadProducts();
    } catch (e) {
      error(e.message || 'İşlem başarısız');
    }
  };

  const restoreProduct = async (id) => {
    try {
      await api.patchProduct(id, { is_deleted: 0, is_active: 1 });
      success('Ürün tekrar aktif');
      await loadProducts();
    } catch (e) {
      error(e.message || 'İşlem başarısız');
    }
  };

  const activeCategories = categories.filter((c) => isCatActive(c));

  return (
    <div className="page-container">
      <SettingsDetailHeader title="Menü tanımları" onBack={handleBack} />

      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 16 }}>
        Kategori ve ürünleri buradan yönetin; sipariş ekranı bu listeyi kullanır.
      </p>

      <div style={{ display: 'flex', gap: 8, marginBottom: 16, flexWrap: 'wrap' }}>
        <button type="button" className={`btn btn-sm ${tab === 'categories' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('categories')}>
          Kategoriler ({activeCategories.length})
        </button>
        <button type="button" className={`btn btn-sm ${tab === 'products' ? 'btn-primary' : 'btn-ghost'}`} onClick={() => setTab('products')}>
          Ürünler ({products.filter((p) => !p.is_deleted).length})
        </button>
      </div>

      {loading ? (
        <div className="empty-state">Yükleniyor…</div>
      ) : tab === 'categories' ? (
        <>
          <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => setCatModal('new')}>
              <Plus size={16} /> Yeni kategori
            </button>
          </div>
          {categories.length === 0 ? (
            <div className="empty-state">Henüz kategori yok</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {categories.map((cat) => (
                <div
                  key={cat.id}
                  className="card card-padded"
                  style={{
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'space-between',
                    gap: 12,
                    opacity: isCatActive(cat) ? 1 : 0.55,
                  }}
                >
                  <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                    <div
                      style={{
                        width: 44,
                        height: 44,
                        borderRadius: 10,
                        background: `${cat.color || '#6366f1'}22`,
                        display: 'flex',
                        alignItems: 'center',
                        justifyContent: 'center',
                        fontSize: 22,
                      }}
                    >
                      {cat.icon || '🍽️'}
                    </div>
                    <div>
                      <div style={{ fontWeight: 600 }}>{cat.name}</div>
                      <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                        {productCountByCat[cat.id] || 0} ürün
                        {!isCatActive(cat) ? ' · Pasif' : ''}
                      </div>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {isCatActive(cat) && (
                      <>
                        <button type="button" className="btn btn-ghost btn-sm btn-icon" title="Düzenle" onClick={() => setCatModal(cat)}>
                          <Pencil size={16} />
                        </button>
                        <button type="button" className="btn btn-ghost btn-sm btn-icon" title="Kaldır" onClick={() => deleteCategory(cat.id)}>
                          <Trash2 size={16} color="var(--danger)" />
                        </button>
                      </>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </>
      ) : (
        <>
          <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
            <input
              className="input"
              placeholder="Ürün ara…"
              value={search}
              onChange={(e) => setSearch(e.target.value)}
              style={{ maxWidth: 220 }}
            />
            <select className="input" value={filterCat} onChange={(e) => setFilterCat(e.target.value)} style={{ maxWidth: 200 }}>
              <option value="all">Tüm kategoriler</option>
              {activeCategories.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
            <div style={{ flex: 1 }} />
            <button
              type="button"
              className="btn btn-primary btn-sm"
              onClick={() => setProdModal('new')}
              disabled={activeCategories.length === 0}
            >
              <Plus size={16} /> Yeni ürün
            </button>
          </div>
          {activeCategories.length === 0 ? (
            <div className="empty-state">Önce kategori ekleyin</div>
          ) : filteredProducts.length === 0 ? (
            <div className="empty-state">Ürün bulunamadı</div>
          ) : (
            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {filteredProducts.map((prod) => {
                const cat = categories.find((c) => c.id === prod.category_id);
                return (
                  <div
                    key={prod.id}
                    className="card card-padded"
                    style={{
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'space-between',
                      gap: 12,
                      opacity: prod.is_deleted ? 0.5 : 1,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 12 }}>
                      <UtensilsCrossed size={18} color="var(--accent)" />
                      <div>
                        <div style={{ fontWeight: 600 }}>{prod.name}</div>
                        <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                          {cat?.name || '—'} {prod.is_deleted ? ' · Kaldırıldı' : ''}
                        </div>
                      </div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                      <span style={{ fontWeight: 700 }}>{formatCurrency(prod.price)}</span>
                      {!prod.is_deleted ? (
                        <>
                          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => setProdModal(prod)}>
                            <Pencil size={16} />
                          </button>
                          <button type="button" className="btn btn-ghost btn-sm btn-icon" onClick={() => deleteProduct(prod.id)}>
                            <Trash2 size={16} color="var(--danger)" />
                          </button>
                        </>
                      ) : (
                        <button type="button" className="btn btn-primary btn-sm" onClick={() => restoreProduct(prod.id)}>
                          Geri al
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </>
      )}

      {catModal && (
        <CategoryModal
          item={catModal === 'new' ? null : catModal}
          categories={categories}
          onClose={() => setCatModal(null)}
          onSaved={async () => {
            setCatModal(null);
            await load();
          }}
        />
      )}
      {prodModal && (
        <ProductModal
          item={prodModal === 'new' ? null : prodModal}
          categories={categories}
          onClose={() => setProdModal(null)}
          onSaved={async () => {
            setProdModal(null);
            await load();
          }}
        />
      )}
    </div>
  );
}
