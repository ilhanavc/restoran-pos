import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import {
  Plus,
  Pencil,
  Trash2,
  MoreVertical,
  Search,
  SlidersHorizontal,
  ArrowUp,
  ArrowDown,
  FilePlus,
  CheckSquare,
  ListOrdered,
} from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency } from '../../constants/index.js';
import { MENU_ICON_OPTIONS, MENU_COLOR_OPTIONS } from '../../constants/menuUi.js';
import SettingsDetailHeader from './SettingsDetailHeader.jsx';

const PRINTER_OPTIONS = [
  { value: 'kitchen', label: 'Mutfak' },
  { value: 'bar', label: 'Bar' },
];

const PAGE_SIZE = 30;

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

function ProductSortModal({ category, productsInCategory, onClose, onSaved }) {
  const { success, error } = useToast();
  const [order, setOrder] = useState(() =>
    [...productsInCategory].sort((a, b) => {
      const so = (a.sort_order ?? 0) - (b.sort_order ?? 0);
      if (so !== 0) return so;
      return String(a.name).localeCompare(String(b.name), 'tr');
    })
  );
  const [saving, setSaving] = useState(false);

  const move = (index, dir) => {
    const j = index + dir;
    if (j < 0 || j >= order.length) return;
    setOrder((prev) => {
      const next = [...prev];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  };

  const handleSave = async () => {
    setSaving(true);
    try {
      for (let i = 0; i < order.length; i++) {
        await api.patchProduct(order[i].id, { sort_order: i });
      }
      success('Sıralama kaydedildi');
      onSaved();
    } catch (e) {
      error(e.message || 'Kayıt başarısız');
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="modal-overlay" onClick={() => !saving && onClose()}>
      <div role="dialog" className="modal modal-md" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Ürünleri sırala — {category.name}</h2>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} disabled={saving}>
            ×
          </button>
        </div>
        <div className="modal-body" style={{ paddingTop: 0 }}>
          <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
            Listeyi yukarı / aşağı taşıyın; kaydettiğinizde sipariş ekranındaki ürün sırası güncellenir.
          </p>
          {order.length === 0 ? (
            <div className="empty-state" style={{ padding: 24 }}>
              Bu kategoride sıralanacak ürün yok
            </div>
          ) : (
            <ul className="menu-settings-sort-list">
              {order.map((p, i) => (
                <li key={p.id} className="menu-settings-sort-row">
                  <span className="menu-settings-sort-name truncate">{p.name}</span>
                  <span className="menu-settings-sort-price">{formatCurrency(p.price)}</span>
                  <div className="menu-settings-sort-actions">
                    <button type="button" className="btn btn-ghost btn-sm btn-icon" title="Yukarı" disabled={saving || i === 0} onClick={() => move(i, -1)}>
                      <ArrowUp size={16} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-icon"
                      title="Aşağı"
                      disabled={saving || i === order.length - 1}
                      onClick={() => move(i, 1)}
                    >
                      <ArrowDown size={16} />
                    </button>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            İptal
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving || order.length === 0}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function MenuSettingsPage() {
  const navigate = useNavigate();
  const { success, error } = useToast();
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [search, setSearch] = useState('');
  /** 'all' = tüm kategorilerdeki ürünler; 'one' = tek kategori */
  const [filterMode, setFilterMode] = useState('one');
  /** filterMode === 'one' iken geçerli kategori id */
  const [activeCategoryId, setActiveCategoryId] = useState(null);
  const [initialized, setInitialized] = useState(false);

  const [catModal, setCatModal] = useState(null);
  const [sortModalCategory, setSortModalCategory] = useState(null);
  const [bulkMode, setBulkMode] = useState(null);
  const [bulkSelected, setBulkSelected] = useState(() => new Set());
  const [bulkTargetCategoryId, setBulkTargetCategoryId] = useState('');
  const [openMenuCatId, setOpenMenuCatId] = useState(null);
  const [dropdownPos, setDropdownPos] = useState(null);
  const [visibleCount, setVisibleCount] = useState(PAGE_SIZE);

  const menuRef = useRef(null);

  const closeCategoryMenu = useCallback(() => {
    setOpenMenuCatId(null);
    setDropdownPos(null);
  }, []);

  const toggleCategoryMenu = useCallback(
    (e, cat) => {
      e.stopPropagation();
      if (openMenuCatId === cat.id) {
        closeCategoryMenu();
        return;
      }
      const r = e.currentTarget.getBoundingClientRect();
      const w = 220;
      let left = r.right - w;
      if (left < 8) left = 8;
      if (left + w > window.innerWidth - 8) left = window.innerWidth - w - 8;
      setDropdownPos({ top: r.bottom + 4, left });
      setOpenMenuCatId(cat.id);
    },
    [openMenuCatId, closeCategoryMenu],
  );

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

  const activeCategories = useMemo(
    () => categories.filter((c) => Number(c?.is_active) === 1).sort((a, b) => (a.sort_order ?? 0) - (b.sort_order ?? 0) || String(a.name).localeCompare(String(b.name), 'tr')),
    [categories],
  );

  useEffect(() => {
    if (loading || initialized || activeCategories.length === 0) return;
    setActiveCategoryId(activeCategories[0].id);
    setFilterMode('one');
    setInitialized(true);
  }, [loading, initialized, activeCategories]);

  useEffect(() => {
    if (!openMenuCatId) return;
    const onDoc = (e) => {
      if (e.target.closest('[data-cat-menu-trigger]')) return;
      if (menuRef.current?.contains(e.target)) return;
      closeCategoryMenu();
    };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [openMenuCatId, closeCategoryMenu]);

  const isCatActive = (c) => Number(c?.is_active) === 1;

  const productCountByCat = useMemo(() => {
    const m = {};
    products.forEach((p) => {
      if (p.is_deleted) return;
      m[p.category_id] = (m[p.category_id] || 0) + 1;
    });
    return m;
  }, [products]);

  const searchNorm = search.trim().toLowerCase();

  const filteredProducts = useMemo(() => {
    return products.filter((p) => {
      const nameOk = !searchNorm || String(p.name).toLowerCase().includes(searchNorm);
      const catOk =
        filterMode === 'all' || (filterMode === 'one' && activeCategoryId && p.category_id === activeCategoryId);
      return nameOk && catOk;
    });
  }, [products, searchNorm, filterMode, activeCategoryId]);

  const displayedProducts = useMemo(() => filteredProducts.slice(0, visibleCount), [filteredProducts, visibleCount]);

  useEffect(() => {
    setVisibleCount(PAGE_SIZE);
  }, [searchNorm, filterMode, activeCategoryId, bulkMode]);

  const deleteCategory = async (id) => {
    const n = productCountByCat[id] || 0;
    const msg =
      n > 0
        ? `Bu kategori pasif yapılacak ve içindeki ${n} ürün menüden kaldırılacak. Devam edilsin mi?`
        : 'Bu kategori pasif yapılacak. Devam edilsin mi?';
    if (!window.confirm(msg)) return;
    try {
      await api.deleteCategory(id);
      success('Kategori kaldırıldı');
      await load();
      if (activeCategoryId === id) {
        setFilterMode('all');
        setActiveCategoryId(null);
      }
      if (bulkMode?.categoryId === id) {
        setBulkMode(null);
        setBulkSelected(new Set());
      }
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
      setBulkSelected((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
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

  const handleSidebarSelect = (id) => {
    setFilterMode('one');
    setActiveCategoryId(id);
    closeCategoryMenu();
  };

  const menuCatForDropdown = useMemo(
    () => (openMenuCatId ? categories.find((c) => c.id === openMenuCatId) : null),
    [openMenuCatId, categories],
  );

  const handleFilterDropdown = (value) => {
    if (value === 'all') {
      setFilterMode('all');
      setActiveCategoryId(null);
    } else {
      setFilterMode('one');
      setActiveCategoryId(value);
    }
  };

  const newProductDefaultCategoryId = useMemo(() => {
    if (filterMode === 'one' && activeCategoryId) return activeCategoryId;
    return activeCategories[0]?.id || '';
  }, [filterMode, activeCategoryId, activeCategories]);

  const openNewProduct = () => {
    if (!newProductDefaultCategoryId) {
      error('Önce aktif kategori ekleyin');
      return;
    }
    navigate('/settings/menu/product/new', { state: { defaultCategoryId: newProductDefaultCategoryId } });
  };

  const productsForSort = useMemo(() => {
    if (!sortModalCategory) return [];
    return products.filter((p) => p.category_id === sortModalCategory.id && !p.is_deleted);
  }, [sortModalCategory, products]);

  const bulkAppliesToProduct = (p) => {
    if (!bulkMode) return false;
    return p.category_id === bulkMode.categoryId && !p.is_deleted;
  };

  const toggleBulkOne = (id) => {
    setBulkSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const selectAllInBulkScope = () => {
    if (!bulkMode) return;
    const ids = products.filter((p) => bulkAppliesToProduct(p)).map((p) => p.id);
    setBulkSelected(new Set(ids));
  };

  const clearBulkSelection = () => setBulkSelected(new Set());

  const exitBulkMode = () => {
    setBulkMode(null);
    setBulkSelected(new Set());
    setBulkTargetCategoryId('');
  };

  const applyBulkMove = async () => {
    if (!bulkTargetCategoryId || bulkSelected.size === 0) {
      error('Hedef kategori ve en az bir ürün seçin');
      return;
    }
    try {
      for (const id of bulkSelected) {
        await api.patchProduct(id, { category_id: bulkTargetCategoryId });
      }
      success(`${bulkSelected.size} ürün taşındı`);
      exitBulkMode();
      await loadProducts();
    } catch (e) {
      error(e.message || 'İşlem başarısız');
    }
  };

  const applyBulkDeactivate = async () => {
    if (bulkSelected.size === 0) {
      error('En az bir ürün seçin');
      return;
    }
    if (!window.confirm(`${bulkSelected.size} ürün pasif yapılsın mı? (Menüden gizlenir.)`)) return;
    try {
      for (const id of bulkSelected) {
        await api.patchProduct(id, { is_active: 0 });
      }
      success('Seçilen ürünler pasif yapıldı');
      exitBulkMode();
      await loadProducts();
    } catch (e) {
      error(e.message || 'İşlem başarısız');
    }
  };

  const handleBack = () => navigate('/settings');

  const dropdownValue = filterMode === 'all' ? 'all' : activeCategoryId || 'all';
  const selectedCategory = useMemo(
    () => (activeCategoryId ? categories.find((c) => c.id === activeCategoryId) : null),
    [activeCategoryId, categories],
  );
  const toolbarTitle = filterMode === 'all' ? 'Tüm ürünler' : selectedCategory?.name || 'Kategori seçin';
  const toolbarSummary = searchNorm
    ? `"${search.trim()}" için ${filteredProducts.length} sonuç`
    : filterMode === 'all'
      ? `${filteredProducts.length} ürün listeleniyor`
      : `${productCountByCat[activeCategoryId] || 0} ürün bu kategoride`;

  return (
    <div className="page-container menu-settings-page">
      <SettingsDetailHeader title="Menü tanımları" onBack={handleBack} />

      <p className="menu-settings-lead">
        Kategori ve ürünleri buradan yönetin; sipariş ekranı bu listeyi kullanır.
      </p>

      {loading ? (
        <div className="empty-state">Yükleniyor…</div>
      ) : (
        <>
        <div className="menu-settings-split">
          <aside className="menu-settings-sidebar">
            <div className="menu-settings-sidebar-head">
              <div className="menu-settings-sidebar-copy">
                <span className="menu-settings-sidebar-label">Kategoriler</span>
                <strong className="menu-settings-sidebar-title">
                  {activeCategories.length} aktif, {categories.length} toplam
                </strong>
              </div>
              <button type="button" className="btn btn-primary btn-sm menu-settings-add-cat" onClick={() => setCatModal('new')}>
                <Plus size={16} />
                Kategori Ekle
              </button>
            </div>
            <div
              className="menu-settings-cat-scroll"
              onScroll={() => {
                if (openMenuCatId) closeCategoryMenu();
              }}
            >
              {categories.length === 0 ? (
                <div className="empty-state menu-settings-cat-empty">Henüz kategori yok</div>
              ) : (
                categories.map((cat) => {
                  const activeRow = filterMode === 'one' && activeCategoryId === cat.id;
                  return (
                    <div
                      key={cat.id}
                      className={`menu-settings-cat-row ${activeRow ? 'menu-settings-cat-row--active' : ''} ${!isCatActive(cat) ? 'menu-settings-cat-row--inactive' : ''}`}
                      style={{ '--menu-category-color': cat.color || '#6366f1' }}
                    >
                      <button
                        type="button"
                        className="menu-settings-cat-main"
                        onClick={() => handleSidebarSelect(cat.id)}
                      >
                        <span
                          className="menu-settings-cat-icon"
                          style={{ background: `${cat.color || '#6366f1'}22` }}
                        >
                          {cat.icon || '🍽️'}
                        </span>
                        <span className="menu-settings-cat-text">
                          <span className="menu-settings-cat-name truncate">{cat.name}</span>
                          <span className="menu-settings-cat-meta">
                            <span className="menu-settings-cat-count">{productCountByCat[cat.id] || 0} ürün</span>
                            {!isCatActive(cat) ? <span className="menu-settings-cat-state">Pasif</span> : null}
                          </span>
                        </span>
                      </button>
                      {isCatActive(cat) && (
                        <div className="menu-settings-cat-menu-wrap">
                          <button
                            type="button"
                            data-cat-menu-trigger
                            className="btn btn-ghost btn-sm btn-icon menu-settings-kebab"
                            aria-expanded={openMenuCatId === cat.id}
                            aria-label="Kategori işlemleri"
                            onClick={(e) => toggleCategoryMenu(e, cat)}
                          >
                            <MoreVertical size={18} />
                          </button>
                        </div>
                      )}
                    </div>
                  );
                })
              )}
            </div>
          </aside>

          <section className="menu-settings-main">
            <div className="menu-settings-main-head">
              <div className="menu-settings-main-copy">
                <span className="menu-settings-main-eyebrow">Menü görünümü</span>
                <div className="menu-settings-main-title-row">
                  <h2 className="menu-settings-main-title">{toolbarTitle}</h2>
                  {filterMode === 'one' && selectedCategory && !isCatActive(selectedCategory) && (
                    <span className="badge badge-warning">Pasif kategori</span>
                  )}
                </div>
                <p className="menu-settings-main-subtitle">{toolbarSummary}</p>
              </div>
              <div className="menu-settings-main-stats" aria-label="Menü özet bilgileri">
                <span className="menu-settings-stat-chip">
                  <strong>{categories.length}</strong>
                  kategori
                </span>
                <span className="menu-settings-stat-chip">
                  <strong>{products.filter((p) => !p.is_deleted).length}</strong>
                  aktif ürün
                </span>
              </div>
            </div>

            <div className="menu-settings-toolbar">
              <div className="menu-settings-toolbar-field">
                <span className="menu-settings-toolbar-label">Kategori</span>
                <select
                  className="input menu-settings-toolbar-filter"
                  value={dropdownValue}
                  onChange={(e) => handleFilterDropdown(e.target.value)}
                >
                  <option value="all">Tüm kategoriler</option>
                  {categories.map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                      {!isCatActive(c) ? ' (pasif)' : ''}
                    </option>
                  ))}
                </select>
              </div>
              <div className="menu-settings-toolbar-field menu-settings-toolbar-field--search">
                <span className="menu-settings-toolbar-label">Ara</span>
                <div className="menu-settings-search-wrap">
                  <Search size={18} className="menu-settings-search-icon" aria-hidden />
                  <input
                    className="input menu-settings-search"
                    placeholder="Ürün adı veya açıklama ara"
                    value={search}
                    onChange={(e) => setSearch(e.target.value)}
                  />
                </div>
              </div>
              <div className="menu-settings-toolbar-actions">
                <button
                  type="button"
                  className="btn btn-primary btn-sm menu-settings-new-prod"
                  onClick={openNewProduct}
                  disabled={activeCategories.length === 0}
                >
                  <Plus size={16} />
                  Yeni ürün ekle
                </button>
              </div>
            </div>

            {bulkMode && (
              <div className="menu-settings-bulk-bar">
                <span className="menu-settings-bulk-label">
                  <CheckSquare size={18} />
                  Toplu işlem —{' '}
                  {categories.find((c) => c.id === bulkMode.categoryId)?.name || 'Kategori'}
                </span>
                <button type="button" className="btn btn-ghost btn-sm" onClick={selectAllInBulkScope}>
                  Bu kategorideki tümünü seç
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={clearBulkSelection}>
                  Seçimi temizle
                </button>
                <select
                  className="input menu-settings-bulk-target"
                  value={bulkTargetCategoryId}
                  onChange={(e) => setBulkTargetCategoryId(e.target.value)}
                >
                  <option value="">Taşı: hedef kategori…</option>
                  {activeCategories.filter((c) => c.id !== bulkMode.categoryId).map((c) => (
                    <option key={c.id} value={c.id}>
                      {c.name}
                    </option>
                  ))}
                </select>
                <button type="button" className="btn btn-primary btn-sm" onClick={applyBulkMove} disabled={bulkSelected.size === 0 || !bulkTargetCategoryId}>
                  Seçilenleri taşı
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={applyBulkDeactivate} disabled={bulkSelected.size === 0}>
                  Pasifleştir
                </button>
                <button type="button" className="btn btn-ghost btn-sm" onClick={exitBulkMode}>
                  İptal
                </button>
                <span className="menu-settings-bulk-count">{bulkSelected.size} seçili</span>
              </div>
            )}

            {activeCategories.length === 0 ? (
              <div className="empty-state">Önce kategori ekleyin</div>
            ) : filteredProducts.length === 0 ? (
              <div className="empty-state">Ürün bulunamadı</div>
            ) : (
              <>
                <div className="menu-settings-product-grid">
                  {displayedProducts.map((prod) => {
                    const cat = categories.find((c) => c.id === prod.category_id);
                    const description = prod.description && String(prod.description).trim();
                    const bulkOn = bulkMode && bulkAppliesToProduct(prod);
                    return (
                      <div
                        key={prod.id}
                        className={`menu-settings-prod-card ${prod.is_deleted ? 'menu-settings-prod-card--deleted' : ''} ${bulkOn ? 'menu-settings-prod-card--bulk' : ''}`}
                        style={{ '--menu-category-color': cat?.color || '#6366f1' }}
                      >
                        <div className="menu-settings-prod-card-top">
                          <div className="menu-settings-prod-top-left">
                            {bulkOn && (
                              <label className="menu-settings-prod-check">
                                <input
                                  type="checkbox"
                                  checked={bulkSelected.has(prod.id)}
                                  onChange={() => toggleBulkOne(prod.id)}
                                />
                              </label>
                            )}
                            {cat?.name ? <span className="menu-settings-prod-category">{cat.name}</span> : null}
                          </div>
                          <div className="menu-settings-prod-actions">
                            {!prod.is_deleted ? (
                              <>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm btn-icon menu-settings-prod-action"
                                  title="Düzenle"
                                  aria-label={`${prod.name} ürününü düzenle`}
                                  onClick={() => navigate(`/settings/menu/product/${prod.id}`)}
                                >
                                  <Pencil size={16} />
                                </button>
                                <button
                                  type="button"
                                  className="btn btn-ghost btn-sm btn-icon menu-settings-prod-action menu-settings-prod-action--danger"
                                  title="Kaldır"
                                  aria-label={`${prod.name} ürününü kaldır`}
                                  onClick={() => deleteProduct(prod.id)}
                                >
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
                        <div className="menu-settings-prod-title truncate" title={prod.name}>
                          {prod.name}
                        </div>
                        <div
                          className={`menu-settings-prod-sub ${description ? 'truncate' : 'menu-settings-prod-sub--muted'}`}
                          title={description || 'Bu ürün için açıklama eklenmemiş'}
                        >
                          {description || 'Bu ürün için açıklama eklenmemiş'}
                        </div>
                        <div className="menu-settings-prod-bottom">
                          <div className="menu-settings-prod-price-block">
                            <span className="menu-settings-prod-price-label">Fiyat</span>
                            <span className="menu-settings-prod-price">{formatCurrency(prod.price)}</span>
                          </div>
                          <div className="menu-settings-prod-status">
                            {!prod.is_deleted && Number(prod.is_active) === 0 && (
                              <span className="badge badge-warning">Pasif</span>
                            )}
                            {prod.is_deleted && <span className="badge badge-danger">Kaldırıldı</span>}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
                {filteredProducts.length > displayedProducts.length && (
                  <div className="menu-settings-more-wrap">
                    <button type="button" className="btn btn-ghost btn-sm" onClick={() => setVisibleCount((v) => v + PAGE_SIZE)}>
                      Daha fazla göster ({filteredProducts.length - displayedProducts.length} kaldı)
                    </button>
                  </div>
                )}
              </>
            )}
          </section>
        </div>

        {openMenuCatId && dropdownPos && menuCatForDropdown && isCatActive(menuCatForDropdown) && (
          <div
            ref={menuRef}
            className="menu-settings-dropdown menu-settings-dropdown--fixed"
            style={{ top: dropdownPos.top, left: dropdownPos.left }}
            role="menu"
          >
            <button
              type="button"
              className="menu-settings-dropdown-item"
              role="menuitem"
              onClick={() => {
                const cat = menuCatForDropdown;
                closeCategoryMenu();
                setFilterMode('one');
                setActiveCategoryId(cat.id);
                setBulkMode({ categoryId: cat.id });
                setBulkSelected(new Set());
                setBulkTargetCategoryId(activeCategories.find((c) => c.id !== cat.id)?.id || '');
              }}
            >
              <SlidersHorizontal size={16} />
              Toplu işlemler
            </button>
            <button
              type="button"
              className="menu-settings-dropdown-item"
              role="menuitem"
              onClick={() => {
                const cat = menuCatForDropdown;
                closeCategoryMenu();
                setSortModalCategory(cat);
              }}
            >
              <ListOrdered size={16} />
              Ürünleri sırala
            </button>
            <button
              type="button"
              className="menu-settings-dropdown-item"
              role="menuitem"
              onClick={() => {
                const cat = menuCatForDropdown;
                closeCategoryMenu();
                setFilterMode('one');
                setActiveCategoryId(cat.id);
                navigate('/settings/menu/product/new', { state: { defaultCategoryId: cat.id } });
              }}
            >
              <FilePlus size={16} />
              Yeni ürün ekle
            </button>
            <button
              type="button"
              className="menu-settings-dropdown-item"
              role="menuitem"
              onClick={() => {
                const cat = menuCatForDropdown;
                closeCategoryMenu();
                setCatModal(cat);
              }}
            >
              <Pencil size={16} />
              Düzenle
            </button>
            <button
              type="button"
              className="menu-settings-dropdown-item menu-settings-dropdown-item--danger"
              role="menuitem"
              onClick={() => {
                const cat = menuCatForDropdown;
                closeCategoryMenu();
                deleteCategory(cat.id);
              }}
            >
              <Trash2 size={16} />
              Kategoriyi sil
            </button>
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
      {sortModalCategory && (
        <ProductSortModal
          key={sortModalCategory.id}
          category={sortModalCategory}
          productsInCategory={productsForSort}
          onClose={() => setSortModalCategory(null)}
          onSaved={async () => {
            setSortModalCategory(null);
            await loadProducts();
          }}
        />
      )}
    </div>
  );
}
