import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, ORDER_ITEM_LINE_STATUS } from '../../constants/index.js';
import { ORDER_QUICK_NOTES } from '../../constants/menuUi.js';
import { masaLabelInArea } from '../../utils/tableUtils.js';
import {
  ArrowLeft, Search, Plus, Minus, Trash2, Save,
  CreditCard, MessageSquare, X, ArrowRightLeft, Phone,
} from 'lucide-react';

export default function OrderScreen({
  table,
  existingOrderId,
  orderType = 'dine_in',
  customer,
  prefillPhone,
  callLogId,
  onBack,
  onPayment,
  onNavigateToTables,
}) {
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [activeCat, setActiveCat] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [cartItems, setCartItems] = useState([]);
  const [existingOrder, setExistingOrder] = useState(null);
  const [modifierModal, setModifierModal] = useState(null); // { product, modifiers }
  const [noteModal, setNoteModal] = useState(null); // { kind: 'cart', index } | { kind: 'item', itemId }
  const [noteText, setNoteText] = useState('');
  const [saving, setSaving] = useState(false);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [emptyTables, setEmptyTables] = useState([]);
  const [takeawayPhone, setTakeawayPhone] = useState('');
  const toast = useToast();
  const { hasRole } = useAuth();
  const searchRef = useRef(null);
  const callLogOpenedPatchSentRef = useRef(false);
  const navigate = useNavigate();

  useEffect(() => {
    loadCategories();
  }, []);

  useEffect(() => {
    const oid = existingOrderId || table?.current_order_id;
    if (oid) loadExistingOrder(oid);
  }, [existingOrderId, table?.current_order_id]);

  useEffect(() => {
    if (orderType !== 'takeaway') return;
    if (customer?.phones?.length) {
      const p = customer.phones.find((x) => x.is_primary) || customer.phones[0];
      setTakeawayPhone(String(p.phone || ''));
    } else if (prefillPhone != null && String(prefillPhone).trim() !== '') {
      setTakeawayPhone(String(prefillPhone).trim());
    } else {
      setTakeawayPhone('');
    }
  }, [orderType, customer, prefillPhone]);

  const loadCategories = async () => {
    setCategoriesLoading(true);
    try {
      const cats = await api.getCategories();
      setCategories(cats);
      if (cats.length > 0) {
        setActiveCat(cats[0].id);
        loadProducts(cats[0].id);
      }
    } catch (err) { toast.error('Kategoriler yüklenemedi'); }
    finally { setCategoriesLoading(false); }
  };

  const loadProducts = async (catId) => {
    try {
      const prods = await api.getProducts({ category_id: catId });
      setProducts(prods);
    } catch (err) { toast.error('Ürünler yüklenemedi'); }
  };

  const loadExistingOrder = async (orderId) => {
    try {
      const order = await api.getOrder(orderId);
      setExistingOrder(order);
    } catch {
      /* sipariş yok veya ağ hatası */
    }
  };

  const handleCategorySelect = (catId) => {
    setActiveCat(catId);
    setSearchQuery('');
    loadProducts(catId);
  };

  const handleSearch = async (q) => {
    setSearchQuery(q);
    if (q.length >= 2) {
      try {
        const prods = await api.getProducts({ search: q });
        setProducts(prods);
        setActiveCat(null);
      } catch (err) {}
    } else if (q === '') {
      const catId = activeCat || categories[0]?.id;
      if (catId) {
        setActiveCat(catId);
        loadProducts(catId);
      }
    }
  };

  const addToCart = async (product) => {
    // Check modifiers
    try {
      const modGroups = await api.getModifiers(product.id);
      if (Object.keys(modGroups).length > 0) {
        setModifierModal({ product, groups: modGroups, selected: {} });
        return;
      }
    } catch {}

    addItemToCart(product, []);
  };

  const addItemToCart = (product, modifiers) => {
    const modDelta = modifiers.reduce((sum, m) => sum + (m.price_delta || 0), 0);
    const existing = cartItems.findIndex(
      ci => ci.product_id === product.id &&
        JSON.stringify(ci.modifiers) === JSON.stringify(modifiers) &&
        !ci.note
    );

    if (existing >= 0) {
      setCartItems(prev => prev.map((ci, i) => i === existing ? { ...ci, quantity: ci.quantity + 1 } : ci));
    } else {
      setCartItems(prev => [...prev, {
        product_id: product.id,
        product_name: product.name,
        unit_price: product.price + modDelta,
        base_price: product.price,
        quantity: 1,
        modifiers,
        note: '',
        category_name: product.category_name,
      }]);
    }
  };

  const updateQuantity = (index, delta) => {
    setCartItems(prev => prev.map((ci, i) => {
      if (i !== index) return ci;
      const newQty = ci.quantity + delta;
      return newQty <= 0 ? null : { ...ci, quantity: newQty };
    }).filter(Boolean));
  };

  const removeItem = (index) => {
    setCartItems(prev => prev.filter((_, i) => i !== index));
  };

  const handleSaveOrder = async ({ skipNavigate = false } = {}) => {
    if (cartItems.length === 0) { toast.error('Sipariş boş'); return null; }
    setSaving(true);
    try {
      if (existingOrder) {
        const result = await api.addOrderItems(existingOrder.id, cartItems.map(ci => ({
          product_id: ci.product_id,
          quantity: ci.quantity,
          modifiers: ci.modifiers,
          note: ci.note,
        })));
        setExistingOrder(result);
        setCartItems([]);
        toast.success('Ürünler eklendi');
        return { order: result, isNew: false };
      }
      const orderData = {
        table_id: table?.id || null,
        order_type: orderType,
        customer_id: customer?.id || null,
        guest_count: table?.guest_count || 0,
        delivery_address: customer?.selectedAddress || null,
        items: cartItems.map(ci => ({
          product_id: ci.product_id,
          quantity: ci.quantity,
          modifiers: ci.modifiers,
          note: ci.note,
        })),
      };
      const result = await api.createOrder(orderData);
      setExistingOrder(result);
      setCartItems([]);
      toast.success('Sipariş kaydedildi');
      const logId = callLogId != null ? String(callLogId).trim() : '';
      if (logId && result?.id && !callLogOpenedPatchSentRef.current) {
        callLogOpenedPatchSentRef.current = true;
        api.patchCallLogStatus(logId, 'opened_order').catch(() => {});
      }
      if (!skipNavigate && onNavigateToTables) onNavigateToTables();
      return { order: result, isNew: true };
    } catch (err) {
      toast.error(err.message);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleVoidItem = async (itemId) => {
    if (!window.confirm('Bu ürünü iptal (void) etmek istediğinize emin misiniz?')) return;
    try {
      setSaving(true);
      await api.updateOrderItem(existingOrder.id, itemId, { status: 'cancelled' });
      toast.success('Ürün iptal edildi');
      const updated = await api.getOrder(existingOrder.id);
      setExistingOrder(updated);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const refreshOrder = async () => {
    if (!existingOrder?.id) return;
    const updated = await api.getOrder(existingOrder.id);
    setExistingOrder(updated);
  };

  const handleUpdateExistingQty = async (itemId, delta) => {
    if (!existingOrder) return;
    const item = (existingOrder.items || []).find((i) => i.id === itemId);
    if (!item || item.status !== 'new' || item.is_comped) return;
    const next = item.quantity + delta;
    if (next <= 0) {
      if (!window.confirm('Bu satırı iptal etmek istiyor musunuz?')) return;
      try {
        setSaving(true);
        await api.updateOrderItem(existingOrder.id, itemId, { status: 'cancelled' });
        toast.success('Satır iptal edildi');
        await refreshOrder();
      } catch (err) {
        toast.error(err.message);
      } finally {
        setSaving(false);
      }
      return;
    }
    try {
      setSaving(true);
      await api.updateOrderItem(existingOrder.id, itemId, { quantity: next });
      await refreshOrder();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const openMoveModal = async () => {
    if (!table?.id || orderType !== 'dine_in') return;
    try {
      const areas = await api.getTables();
      const empty = [];
      for (const a of areas) {
        const all = a.tables || [];
        for (const t of all.filter((x) => x.status === 'empty')) {
          empty.push({ ...t, displayName: masaLabelInArea(t, all) });
        }
      }
      setEmptyTables(empty);
      setMoveModalOpen(true);
    } catch (err) {
      toast.error(err.message || 'Masalar yüklenemedi');
    }
  };

  const handleTransferToTable = async (targetTableId) => {
    if (!table?.id) return;
    const target = emptyTables.find((x) => x.id === targetTableId);
    const fromLabel = table.displayName || 'Masa';
    const toLabel = target?.displayName || 'Masa';
    if (!window.confirm(`${fromLabel} → ${toLabel} masasına taşınsın mı?`)) return;
    try {
      setSaving(true);
      await api.transferTable(table.id, targetTableId);
      toast.success('Sipariş hedef masaya taşındı');
      setMoveModalOpen(false);
      if (onNavigateToTables) onNavigateToTables();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  // Fiyatlar KDV dahil; grand_total = satır toplamı − indirim
  const cartSubtotal = cartItems.reduce((sum, ci) => sum + ci.unit_price * ci.quantity, 0);
  const savedTotal = Number(existingOrder?.grand_total) || 0;
  const displayTotal = savedTotal + cartSubtotal;
  const araTotal = (Number(existingOrder?.subtotal) || 0) + cartSubtotal;

  const allExistingItems = existingOrder?.items || [];
  if (categoriesLoading) {
    return (
      <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', flexDirection: 'column', gap: 12, background: 'var(--bg-primary)' }}>
        <div style={{ width: 36, height: 36, border: '3px solid var(--border)', borderTopColor: 'var(--accent)', borderRadius: '50%', animation: 'spin 0.9s linear infinite' }} />
        <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Menü yükleniyor...</div>
        <style>{`@keyframes spin { to { transform: rotate(360deg); } }`}</style>
      </div>
    );
  }

  if (categories.length === 0) {
    return (
      <div style={{ display: 'flex', height: '100%', alignItems: 'center', justifyContent: 'center', padding: 24, background: 'var(--bg-primary)' }}>
        <div style={{ textAlign: 'center', maxWidth: 400 }}>
          <div style={{ fontSize: 48, marginBottom: 16 }}>📝</div>
          <div style={{ fontSize: 20, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 8 }}>Menü tanımlanmamış</div>
          <div style={{ fontSize: 14, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 24 }}>
            Sipariş alabilmek için önce Ayarlar → Menü’den kategori ve ürün ekleyin.
          </div>
          <div style={{ display: 'flex', gap: 10, justifyContent: 'center', flexWrap: 'wrap' }}>
            <button type="button" className="btn btn-primary" onClick={() => navigate('/settings/menu')}>Menü ayarları</button>
            <button type="button" className="btn btn-ghost" onClick={onBack}>← Masalara dön</button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Sol: üst bar + arama + yatay kategoriler + ürün ızgarası */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)' }}>
        <div style={{
          display: 'flex', alignItems: 'center', gap: 12,
          padding: '12px 16px', borderBottom: '1px solid var(--border)',
          background: 'var(--bg-secondary)', flexShrink: 0,
        }}>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onBack}>
            <ArrowLeft size={18} />
          </button>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ fontSize: 15, fontWeight: 700 }}>
              {table
                ? (table.displayName || `Masa ${table.name}`)
                : orderType === 'takeaway'
                  ? 'Paket Sipariş'
                  : 'Sipariş'}
            </div>
            {table?.area_name && (
              <span style={{ display: 'inline-block', marginTop: 4, fontSize: 11, color: 'var(--text-muted)', background: 'var(--bg-tertiary)', padding: '3px 10px', borderRadius: 8 }}>
                {table.area_name}
              </span>
            )}
            {customer && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>{customer.full_name}</div>}
            {orderType === 'takeaway' && (customer || (takeawayPhone && takeawayPhone.trim() !== '')) && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Phone size={12} />
                <span>{(takeawayPhone && takeawayPhone.trim()) || (prefillPhone != null ? String(prefillPhone) : '') || customer?.phones?.[0]?.phone || ''}</span>
              </div>
            )}
          </div>
          {existingOrder && (
            <span className="badge badge-info" style={{ fontSize: 11 }}>#{existingOrder.order_no}</span>
          )}
        </div>

        <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0 }}>
          <div style={{ position: 'relative' }}>
            <Search size={15} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
            <input
              ref={searchRef}
              className="input"
              placeholder="Ürün ara..."
              value={searchQuery}
              onChange={(e) => handleSearch(e.target.value)}
              lang="tr"
              autoComplete="off"
              spellCheck={false}
              style={{ paddingLeft: 34, height: 38, fontSize: 13, width: '100%' }}
            />
            {searchQuery && (
              <button
                type="button"
                style={{ position: 'absolute', right: 8, top: '50%', transform: 'translateY(-50%)', background: 'none', border: 'none', color: 'var(--text-muted)', cursor: 'pointer' }}
                onClick={() => handleSearch('')}
              >
                <X size={14} />
              </button>
            )}
          </div>
        </div>

        <div style={{
          display: 'flex', gap: 6, padding: '10px 16px',
          overflowX: 'auto', flexShrink: 0,
          borderBottom: '1px solid var(--border)',
        }}>
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => handleCategorySelect(cat.id)}
              style={{
                padding: '7px 14px', borderRadius: 'var(--radius-sm)',
                border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                transition: 'all var(--transition-fast)',
                background: activeCat === cat.id ? `${cat.color}22` : 'var(--bg-tertiary)',
                color: activeCat === cat.id ? cat.color : 'var(--text-secondary)',
                borderBottom: activeCat === cat.id ? `2px solid ${cat.color}` : '2px solid transparent',
              }}
            >
              {cat.icon} {cat.name}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(135px, 1fr))',
            gap: 10,
          }}>
            {products.map((prod) => (
              <button
                key={prod.id}
                type="button"
                onClick={() => addToCart(prod)}
                style={{
                  background: 'var(--bg-card)', border: '1px solid var(--border)',
                  borderRadius: 'var(--radius-sm)', padding: '14px 10px',
                  cursor: 'pointer', textAlign: 'left',
                  transition: 'all var(--transition-fast)',
                  fontFamily: 'inherit', display: 'flex', flexDirection: 'column',
                  minHeight: 80,
                }}
                onMouseEnter={(e) => { e.currentTarget.style.borderColor = 'var(--accent)'; e.currentTarget.style.background = 'var(--bg-card-hover)'; }}
                onMouseLeave={(e) => { e.currentTarget.style.borderColor = 'var(--border)'; e.currentTarget.style.background = 'var(--bg-card)'; }}
              >
                <div style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'auto', lineHeight: 1.3 }}>
                  {prod.name}
                </div>
                <div style={{ fontSize: 14, fontWeight: 700, color: 'var(--accent)', marginTop: 8 }}>
                  {formatCurrency(prod.price)}
                </div>
              </button>
            ))}
          </div>

          {products.length === 0 && (
            <div className="empty-state">
              <Search size={32} className="empty-state-icon" />
              <div className="empty-state-text">
                {searchQuery.trim().length >= 2
                  ? 'Aramanızla eşleşen ürün yok'
                  : 'Bu kategoride ürün yok — Ayarlar → Menü’den ekleyebilirsiniz'}
              </div>
            </div>
          )}
        </div>
      </div>

      {/* ═══ Adisyon ═══ */}
      <div style={{ width: 360, display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)', flexShrink: 0 }}>
        <div style={{
          padding: '14px 16px', borderBottom: '1px solid var(--border)', flexShrink: 0,
          display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8,
        }}>
          <div>
            <div style={{ fontSize: 14, fontWeight: 700 }}>Adisyon</div>
            {allExistingItems.filter((i) => i.status !== 'cancelled').length > 0 && (
              <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
                {allExistingItems.filter((i) => i.status !== 'cancelled').length} kayıtlı ürün
              </div>
            )}
          </div>
          <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
            {table?.id && orderType === 'dine_in' && existingOrder && (
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                style={{ fontSize: 11, fontWeight: 600 }}
                onClick={openMoveModal}
              >
                <ArrowRightLeft size={14} style={{ marginRight: 4 }} />
                Taşı
              </button>
            )}
            <button type="button" className="btn btn-ghost btn-icon" onClick={onBack} title="Kapat">
              <X size={18} />
            </button>
          </div>
        </div>

        {/* Existing Items */}
        <div style={{ flex: 1, overflow: 'auto' }}>
          {allExistingItems.length > 0 && (
            <div style={{ padding: '8px 0' }}>
              <div style={{ padding: '4px 16px', fontSize: 10, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Mevcut Ürünler
              </div>
              {allExistingItems.filter((i) => i.status !== 'cancelled').map((item) => {
                const mods = JSON.parse(item.modifiers || '[]');
                const st = ORDER_ITEM_LINE_STATUS[item.status] || ORDER_ITEM_LINE_STATUS.sent;
                const lineBadge = item.status && item.status !== 'new' ? st : null;
                const canEditQty = item.status === 'new' && !item.is_comped && existingOrder.status !== 'closed';
                return (
                  <div
                    key={item.id}
                    style={{
                      padding: '10px 16px',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 8,
                      opacity: item.is_comped ? 0.5 : 1,
                      fontSize: 13,
                      borderBottom: '1px solid var(--border)',
                    }}
                  >
                    {canEditQty ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                        <button type="button" className="btn btn-ghost" style={{ padding: 4, minHeight: 'auto' }} onClick={() => handleUpdateExistingQty(item.id, -1)} disabled={saving}>
                          <Minus size={12} />
                        </button>
                        <span style={{ fontSize: 13, fontWeight: 700, minWidth: 22, textAlign: 'center' }}>{item.quantity}</span>
                        <button type="button" className="btn btn-ghost" style={{ padding: 4, minHeight: 'auto' }} onClick={() => handleUpdateExistingQty(item.id, 1)} disabled={saving}>
                          <Plus size={12} />
                        </button>
                      </div>
                    ) : (
                      <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', width: 28, textAlign: 'center', flexShrink: 0, paddingTop: 2 }}>
                        {item.quantity}×
                      </span>
                    )}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
                        <span style={{ fontWeight: 600 }}>{item.product_name}</span>
                        {lineBadge && (
                          <span style={{
                            fontSize: 8, fontWeight: 800, padding: '2px 6px', borderRadius: 4,
                            background: lineBadge.bg, color: lineBadge.color,
                          }}>
                            {lineBadge.short}
                          </span>
                        )}
                      </div>
                      {mods.length > 0 && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)', marginTop: 2 }}>
                          {mods.map((m) => m.name).join(', ')}
                        </div>
                      )}
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 4 }}>
                        {item.is_comped ? (
                          <span style={{ color: 'var(--danger)' }}>İKRAM</span>
                        ) : (
                          <>
                            {formatCurrency(item.unit_price)} × {item.quantity} ={' '}
                            <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{formatCurrency(item.unit_price * item.quantity)}</span>
                          </>
                        )}
                      </div>
                      {item.note && <div style={{ fontSize: 10, color: 'var(--warning)', marginTop: 2 }}>📝 {item.note}</div>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }}>
                      <button
                        type="button"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 3 }}
                        onClick={() => { setNoteModal({ kind: 'item', itemId: item.id }); setNoteText(item.note || ''); }}
                        title="Not"
                      >
                        <MessageSquare size={14} />
                      </button>
                      {!item.is_comped && item.status === 'new' && existingOrder.status !== 'closed' && (
                        <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 3 }} onClick={() => handleVoidItem(item.id)} title="Satırı iptal">
                          <Trash2 size={14} />
                        </button>
                      )}
                      {hasRole('admin', 'cashier') && existingOrder.status !== 'closed' && item.status !== 'new' && !item.is_comped && (
                        <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 3 }} onClick={() => handleVoidItem(item.id)} title="İptal (void)">
                          <Trash2 size={14} />
                        </button>
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* New Cart Items */}
          {cartItems.length > 0 && (
            <div style={{ padding: '8px 0' }}>
              {allExistingItems.length > 0 && (
                <div style={{ padding: '4px 16px', fontSize: 10, fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  Yeni Eklenen
                </div>
              )}
              {cartItems.map((item, idx) => {
                const mods = item.modifiers || [];
                return (
                  <div key={idx} style={{
                    padding: '8px 16px', display: 'flex', alignItems: 'center', gap: 8,
                    fontSize: 13, borderLeft: '3px solid var(--accent)',
                    background: 'var(--accent-muted)',
                    marginBottom: 1,
                  }}>
                    {/* Quantity Controls */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }}>
                      <button className="btn btn-ghost" onClick={() => updateQuantity(idx, -1)}
                        style={{ padding: 4, minHeight: 'auto', borderRadius: 4 }}>
                        <Minus size={12} />
                      </button>
                      <span style={{ fontSize: 13, fontWeight: 700, width: 22, textAlign: 'center' }}>{item.quantity}</span>
                      <button className="btn btn-ghost" onClick={() => updateQuantity(idx, 1)}
                        style={{ padding: 4, minHeight: 'auto', borderRadius: 4 }}>
                        <Plus size={12} />
                      </button>
                    </div>

                    {/* Item Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 12 }} className="truncate">{item.product_name}</div>
                      {mods.length > 0 && (
                        <div style={{ fontSize: 10, color: 'var(--text-muted)' }}>
                          {mods.map(m => m.name).join(', ')}
                        </div>
                      )}
                      {item.note && <div style={{ fontSize: 10, color: 'var(--warning)' }}>📝 {item.note}</div>}
                    </div>

                    {/* Price */}
                    <span style={{ fontWeight: 700, fontSize: 12, whiteSpace: 'nowrap' }}>
                      {formatCurrency(item.unit_price * item.quantity)}
                    </span>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 2 }}>
                      <button
                        type="button"
                        style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)', padding: 3 }}
                        onClick={() => { setNoteModal({ kind: 'cart', index: idx }); setNoteText(item.note || ''); }}
                      >
                        <MessageSquare size={12} />
                      </button>
                      <button style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 3 }}
                        onClick={() => removeItem(idx)}>
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                );
              })}
            </div>
          )}

          {/* Empty Cart */}
          {cartItems.length === 0 && allExistingItems.length === 0 && (
            <div className="empty-state" style={{ padding: 32 }}>
              <ClipboardEmpty />
              <div className="empty-state-text">Ürün ekleyin</div>
            </div>
          )}
        </div>

        {/* Totals */}
        <div style={{ borderTop: '1px solid var(--border)', padding: '12px 16px', flexShrink: 0, background: 'var(--bg-card)' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
            <span>Ara toplam</span>
            <span>{formatCurrency(araTotal)}</span>
          </div>
          {existingOrder && existingOrder.discount_amount > 0 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 12, color: 'var(--danger)', marginBottom: 4 }}>
              <span>İndirim</span>
              <span>-{formatCurrency(existingOrder.discount_amount)}</span>
            </div>
          )}
          <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 20, fontWeight: 800, marginBottom: 6 }}>
            <span>Toplam</span>
            <span>{formatCurrency(displayTotal)}</span>
          </div>
          {cartItems.length > 0 && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
              Sepetteki ürünler kaydedilince toplam güncellenir.
            </div>
          )}

          <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
            {cartItems.length > 0 && (
              <button type="button" className="btn btn-primary" style={{ width: '100%' }} onClick={handleSaveOrder} disabled={saving}>
                <Save size={15} /> Kaydet
              </button>
            )}
            {existingOrder && cartItems.length === 0 && existingOrder.status !== 'closed' && (
              <button
                type="button"
                className="btn btn-primary"
                style={{ width: '100%' }}
                onClick={() => onPayment(existingOrder)}
                disabled={!allExistingItems.filter((i) => i.status !== 'cancelled').length && !cartItems.length}
              >
                <CreditCard size={15} /> Ödeme
              </button>
            )}
          </div>
        </div>
      </div>

      {moveModalOpen && (
        <div className="modal-overlay" onClick={() => setMoveModalOpen(false)}>
          <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Masa taşı</h2>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setMoveModalOpen(false)}><X size={16} /></button>
            </div>
            <div className="modal-body">
              {emptyTables.length === 0 ? (
                <p style={{ fontSize: 14, color: 'var(--text-muted)', margin: 0 }}>Boş masa yok. Önce başka bir masayı boşaltın.</p>
              ) : (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
                  {emptyTables.map((t) => (
                    <button
                      key={t.id}
                      type="button"
                      className="btn btn-ghost"
                      style={{ justifyContent: 'space-between' }}
                      onClick={() => handleTransferToTable(t.id)}
                      disabled={saving}
                    >
                      <span>{t.displayName || `Masa ${t.name}`}</span>
                      <ArrowRightLeft size={16} />
                    </button>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}

      {/* ═══ Modifier Modal ═══ */}
      {modifierModal && (
        <ModifierModal
          product={modifierModal.product}
          groups={modifierModal.groups}
          onConfirm={(selectedMods) => {
            addItemToCart(modifierModal.product, selectedMods);
            setModifierModal(null);
          }}
          onClose={() => setModifierModal(null)}
        />
      )}

      {/* ═══ Note Modal ═══ */}
      {noteModal !== null && (
        <div className="modal-overlay" onClick={() => setNoteModal(null)}>
          <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Ürün Notu</h2>
              <button className="btn btn-ghost btn-icon" onClick={() => setNoteModal(null)}><X size={16} /></button>
            </div>
            <div className="modal-body">
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginBottom: 10 }}>
                {ORDER_QUICK_NOTES.map((q) => (
                  <button
                    key={q}
                    type="button"
                    className="btn btn-ghost btn-sm"
                    style={{ fontSize: 11 }}
                    onClick={() =>
                      setNoteText((prev) => (prev && prev.trim() ? `${prev}, ${q}` : q))
                    }
                  >
                    {q}
                  </button>
                ))}
              </div>
              <textarea className="input" rows={3} value={noteText} onChange={e => setNoteText(e.target.value)}
                placeholder="Örn: Soğansız, az pişmiş..." autoFocus />
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" onClick={() => setNoteModal(null)}>İptal</button>
              <button
                type="button"
                className="btn btn-primary"
                disabled={saving}
                onClick={async () => {
                  if (!noteModal) return;
                  if (noteModal.kind === 'cart') {
                    setCartItems((prev) => prev.map((ci, i) => (i === noteModal.index ? { ...ci, note: noteText } : ci)));
                    setNoteModal(null);
                    return;
                  }
                  try {
                    setSaving(true);
                    await api.updateOrderItem(existingOrder.id, noteModal.itemId, { note: noteText });
                    toast.success('Not kaydedildi');
                    await refreshOrder();
                    setNoteModal(null);
                  } catch (err) {
                    toast.error(err.message);
                  } finally {
                    setSaving(false);
                  }
                }}
              >
                Kaydet
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function ModifierModal({ product, groups, onConfirm, onClose }) {
  const [selected, setSelected] = useState({});

  const toggle = (groupName, mod) => {
    setSelected(prev => {
      const current = prev[groupName] || [];
      const exists = current.find(m => m.id === mod.id);
      if (exists) return { ...prev, [groupName]: current.filter(m => m.id !== mod.id) };
      return { ...prev, [groupName]: [...current, mod] };
    });
  };

  const allSelected = Object.values(selected).flat();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{product.name}</h2>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Seçenekleri belirleyin</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          {Object.entries(groups).map(([groupName, mods]) => (
            <div key={groupName} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                {groupName}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {mods.map(mod => {
                  const isSelected = (selected[groupName] || []).find(m => m.id === mod.id);
                  return (
                    <button key={mod.id} onClick={() => toggle(groupName, mod)}
                      style={{
                        padding: '8px 14px', borderRadius: 'var(--radius-sm)',
                        border: `1.5px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                        background: isSelected ? 'var(--accent-muted)' : 'var(--bg-tertiary)',
                        color: isSelected ? 'var(--accent)' : 'var(--text-secondary)',
                        cursor: 'pointer', fontSize: 12, fontWeight: 600, fontFamily: 'inherit',
                      }}>
                      {mod.name}
                      {mod.price_delta !== 0 && (
                        <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>
                          {mod.price_delta > 0 ? '+' : ''}{formatCurrency(mod.price_delta)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Vazgeç</button>
          <button className="btn btn-primary" onClick={() => onConfirm(allSelected)}>
            Ekle {allSelected.length > 0 && `(${allSelected.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}

function ClipboardEmpty() {
  return (
    <svg width="40" height="40" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" className="empty-state-icon">
      <path d="M16 4h2a2 2 0 0 1 2 2v14a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V6a2 2 0 0 1 2-2h2" />
      <rect x="8" y="2" width="8" height="4" rx="1" ry="1" />
    </svg>
  );
}
