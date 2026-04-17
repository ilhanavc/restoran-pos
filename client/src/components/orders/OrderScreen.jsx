import { useState, useEffect, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { useAuth } from '../../context/AuthContext.jsx';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency, ORDER_ITEM_LINE_STATUS } from '../../constants/index.js';
import { masaLabelInArea } from '../../utils/tableUtils.js';
import {
  canEditOrderItem,
  canOpenOrderPayment,
  canSaveOrderDraft,
  canVoidOrderItem,
  getOrderTotalsForDisplay,
  hasUnsavedOrderChanges,
  isOrderClosedOrCancelled,
} from '../../utils/orderActionPolicy.js';
import {
  Search, Plus, Minus, Trash2, Save,
  CreditCard, X, ArrowRightLeft, Phone, User, ChevronLeft,
} from 'lucide-react';
import OrderProductDetailModal from './OrderProductDetailModal.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';

function toOrderAttributePayload(selectedAttributes = []) {
  const byGroup = new Map();
  for (const attr of selectedAttributes || []) {
    if (!attr?.group_id) continue;
    const optionIds = Array.isArray(attr.option_ids)
      ? attr.option_ids
      : attr.option_id
        ? [attr.option_id]
        : [];
    if (optionIds.length === 0) continue;
    const bucket = byGroup.get(attr.group_id) || new Set();
    for (const optionId of optionIds) {
      if (optionId) bucket.add(optionId);
    }
    byGroup.set(attr.group_id, bucket);
  }
  return Array.from(byGroup.entries()).map(([group_id, optionIds]) => ({
    group_id,
    option_ids: Array.from(optionIds),
  }));
}

export default function OrderScreen({
  table,
  existingOrderId,
  orderType = 'dine_in',
  customer,
  prefillPhone,
  callLogId,
  onBack,
  onPayment,
  onQuickPayment,
  onNavigateToTables,
}) {
  const [categories, setCategories] = useState([]);
  const [products, setProducts] = useState([]);
  const [activeCat, setActiveCat] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [cartItems, setCartItems] = useState([]);
  const [existingOrder, setExistingOrder] = useState(null);
  const [modifierModal, setModifierModal] = useState(null); // { product, groups, pendingLine? }
  /** Satır düzenleme: gridden açılmaz */
  const [lineDetailModal, setLineDetailModal] = useState(null); // { kind: 'cart', index } | { kind: 'existing', itemId }
  const [saving, setSaving] = useState(false);
  const [categoriesLoading, setCategoriesLoading] = useState(true);
  const [moveModalOpen, setMoveModalOpen] = useState(false);
  const [emptyTables, setEmptyTables] = useState([]);
  const [takeawayPhone, setTakeawayPhone] = useState('');
  const [selectedCustomer, setSelectedCustomer] = useState(customer ?? null);
  const [customerModalOpen, setCustomerModalOpen] = useState(false);
  const [customerSearchQuery, setCustomerSearchQuery] = useState('');
  const [customerList, setCustomerList] = useState([]);
  const [customerListLoading, setCustomerListLoading] = useState(false);
  const [newCustomerMode, setNewCustomerMode] = useState(false);
  const [newCustomer, setNewCustomer] = useState({ full_name: '', phone: '', address: '', address_title: 'Ev' });
  const [selectedTakeawayAddress, setSelectedTakeawayAddress] = useState(customer?.selectedAddress || '');
  const [confirmDialog, setConfirmDialog] = useState(null);
  const toast = useToast();
  const { hasRole } = useAuth();
  const searchRef = useRef(null);
  const navigate = useNavigate();

  useEffect(() => {
    loadCategories();
  // eslint-disable-next-line react-hooks/exhaustive-deps -- mount-only; loadCategories is not memoized
  }, []);

  useEffect(() => {
    const oid = existingOrderId || table?.current_order_id;
    if (oid) loadExistingOrder(oid);
  }, [existingOrderId, table?.current_order_id]);

  useEffect(() => {
    if (!existingOrder?.id) return;
    if (existingOrder.customer_id) {
      setSelectedCustomer({
        id: existingOrder.customer_id,
        full_name: existingOrder.customer_name || '',
      });
      if (orderType === 'takeaway' && existingOrder.delivery_address) {
        setSelectedTakeawayAddress(existingOrder.delivery_address);
      }
    } else {
      setSelectedCustomer(null);
    }
  }, [existingOrder?.id, existingOrder?.customer_id, existingOrder?.customer_name, existingOrder?.delivery_address, orderType]);

  useEffect(() => {
    if (existingOrder?.id) return;
    setSelectedCustomer(customer ?? null);
    if (orderType === 'takeaway') {
      setSelectedTakeawayAddress(customer?.selectedAddress || '');
    }
  }, [customer, existingOrder?.id, orderType]);

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

  const normalizeCustomerList = (data) => {
    if (Array.isArray(data)) return data;
    if (Array.isArray(data?.customers)) return data.customers;
    return [];
  };

  const loadCategories = async () => {
    setCategoriesLoading(true);
    try {
      const cats = await api.getCategories();
      setCategories(cats);
      if (cats.length > 0) {
        setActiveCat(cats[0].id);
        loadProducts(cats[0].id);
      }
    } catch { toast.error('Kategoriler yüklenemedi'); }
    finally { setCategoriesLoading(false); }
  };

  const loadProducts = async (catId) => {
    try {
      const prods = catId === '__all__'
        ? await api.getProducts({})
        : await api.getProducts({ category_id: catId });
      setProducts(prods);
    } catch { toast.error('Ürünler yüklenemedi'); }
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
      } catch {}
    } else if (q === '') {
      const catId = activeCat || categories[0]?.id;
      if (catId) {
        setActiveCat(catId);
        loadProducts(catId);
      }
    }
  };

  const quickAddFromGrid = async (product) => {
    try {
      const fullProduct = await api.getProduct(product.id);
      const portions = fullProduct.portions || [];
      let effectiveProduct = { ...fullProduct };
      let portion_id = null;
      let portion_label = null;
      if (portions.length > 0) {
        const def = portions.find((x) => Number(x.is_default)) || portions[0];
        portion_id = def.id;
        portion_label = def.label || '';
        effectiveProduct = { ...fullProduct, price: Number(def.price) };
      }
      // Eski modifier sistemi (geriye uyumluluk)
      const modGroups = await api.getModifiers(product.id);
      if (Object.keys(modGroups).length > 0) {
        setModifierModal({
          product: effectiveProduct,
          groups: modGroups,
          pendingLine: { quantity: 1, note: '', portion_id, portion_label },
        });
        return;
      }
      addItemToCart(effectiveProduct, [], { quantity: 1, note: '', portion_id, portion_label });
    } catch (e) {
      toast.error(e.message || 'Ürün eklenemedi');
    }
  };

  const applyCartLineEdit = (index, { quantity, note, effectiveProduct, portion_id, portion_label, selected_attributes, attrExtraPrice }) => {
    setCartItems((prev) => {
      const ci = prev[index];
      if (!ci) return prev;
      const modDelta = (ci.modifiers || []).reduce((s, m) => s + (m.price_delta || 0), 0);
      const extraAttr = attrExtraPrice != null ? attrExtraPrice : (ci.selected_attributes || []).reduce((s, a) => s + (a.extra_price || 0), 0);
      const updated = {
        ...ci,
        quantity,
        note,
        portion_id: portion_id ?? null,
        portion_label: portion_label ?? null,
        unit_price: Number(effectiveProduct.price) + modDelta + extraAttr,
        base_price: Number(effectiveProduct.price),
        selected_attributes: selected_attributes !== undefined ? selected_attributes : (ci.selected_attributes || []),
      };
      return prev.map((c, i) => (i === index ? updated : c));
    });
  };

  const saveExistingLineFromModal = async (itemId, { quantity, note, portion_id }) => {
    if (!existingOrder) return;
    const item = (existingOrder.items || []).find((i) => i.id === itemId);
    if (!item) return;
    setSaving(true);
    try {
      const body = {};
      const closed = existingOrder.status === 'closed';
      const isNew = item.status === 'new';
      if (!closed && !item.is_comped && isNew) {
        body.quantity = quantity;
        body.note = note != null && String(note).trim() !== '' ? note : null;
        body.portion_id = portion_id ?? null;
      } else if (!closed && !item.is_comped && !isNew) {
        body.note = note != null && String(note).trim() !== '' ? note : null;
      }
      if (Object.keys(body).length === 0) {
        return;
      }
      await api.updateOrderItem(existingOrder.id, itemId, body);
      toast.success('Güncellendi');
      await refreshOrder();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setSaving(false);
    }
  };

  const handleLineDetailContinue = (payload) => {
    const ctx = lineDetailModal;
    setLineDetailModal(null);
    if (!ctx) return;
    if (ctx.kind === 'cart') {
      applyCartLineEdit(ctx.index, payload);
      return;
    }
    saveExistingLineFromModal(ctx.itemId, payload);
  };

  const addItemToCart = (product, modifiers, options = {}) => {
    const quantity = options.quantity != null ? Math.max(1, Math.floor(Number(options.quantity)) || 1) : 1;
    const note = options.note != null ? String(options.note) : '';
    const portion_id = options.portion_id != null ? options.portion_id : null;
    const portion_label = options.portion_label != null ? options.portion_label : null;
    const selected_attributes = options.selected_attributes || [];
    const attrExtraPrice = options.attrExtraPrice || 0;

    const modDelta = modifiers.reduce((sum, m) => sum + (m.price_delta || 0), 0);
    // Ürünleri attribute seçimleri farklıysa ayrı satır olarak ekle
    const attrKey = JSON.stringify(selected_attributes);
    const existing = cartItems.findIndex(
      (ci) =>
        ci.product_id === product.id &&
        (ci.portion_id || null) === (portion_id || null) &&
        JSON.stringify(ci.modifiers || []) === JSON.stringify(modifiers) &&
        JSON.stringify(ci.selected_attributes || []) === attrKey &&
        (ci.note || '') === (note || ''),
    );

    if (existing >= 0) {
      setCartItems((prev) =>
        prev.map((ci, i) => (i === existing ? { ...ci, quantity: ci.quantity + quantity } : ci)),
      );
    } else {
      setCartItems((prev) => [
        ...prev,
        {
          product_id: product.id,
          product_name: product.name,
          unit_price: product.price + modDelta + attrExtraPrice,
          base_price: product.price,
          quantity,
          modifiers,
          selected_attributes,
          note,
          category_name: product.category_name,
          portion_id,
          portion_label,
        },
      ]);
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
    setLineDetailModal((m) => {
      if (!m || m.kind !== 'cart') return m;
      if (m.index === index) return null;
      if (m.index > index) return { ...m, index: m.index - 1 };
      return m;
    });
    setCartItems((prev) => prev.filter((_, i) => i !== index));
  };

  const getCartQtyForProduct = (productId) =>
    cartItems
      .filter((ci) => ci.product_id === productId)
      .reduce((sum, ci) => sum + ci.quantity, 0);

  const decrementProductInCart = (productId) => {
    setCartItems((prev) => {
      const simpleIdx = prev.findIndex(
        (ci) => ci.product_id === productId &&
          JSON.stringify(ci.modifiers || []) === JSON.stringify([]) &&
          !ci.note &&
          !ci.portion_id,
      );
      const idx = simpleIdx >= 0 ? simpleIdx : prev.findIndex((ci) => ci.product_id === productId);
      if (idx < 0) return prev;
      return prev
        .map((ci, i) => {
          if (i !== idx) return ci;
          const newQty = ci.quantity - 1;
          return newQty <= 0 ? null : { ...ci, quantity: newQty };
        })
        .filter(Boolean);
    });
  };

  const handleSaveOrder = async ({ skipNavigate = false } = {}) => {
    const draftState = canSaveOrderDraft({ cartItems, orderType, selectedCustomer });
    if (!draftState.ok && draftState.reason === 'empty') { toast.error('Sipariş boş'); return null; }
    if (!draftState.ok && draftState.reason === 'customer-required') {
      openCustomerModal();
      toast.error('Paket sipariş için müşteri seçimi zorunludur');
      return null;
    }
    setSaving(true);
    try {
      if (existingOrder) {
        const result = await api.addOrderItems(existingOrder.id, cartItems.map((ci) => ({
          product_id: ci.product_id,
          quantity: ci.quantity,
          modifiers: ci.modifiers,
          note: ci.note,
          ...(ci.portion_id ? { portion_id: ci.portion_id } : {}),
          ...(ci.selected_attributes?.length ? { selected_attributes: toOrderAttributePayload(ci.selected_attributes) } : {}),
        })));
        setExistingOrder(result);
        setCartItems([]);
        toast.success('Ürünler kaydedildi');
        if (!skipNavigate && onNavigateToTables) onNavigateToTables();
        return { order: result, isNew: false };
      }
      const orderData = {
        table_id: table?.id || null,
        order_type: orderType,
        customer_id: selectedCustomer?.id || null,
        call_log_id: callLogId != null ? String(callLogId).trim() || null : null,
        guest_count: table?.guest_count || 0,
        delivery_address: selectedTakeawayAddress || customer?.selectedAddress || null,
        items: cartItems.map((ci) => ({
          product_id: ci.product_id,
          quantity: ci.quantity,
          modifiers: ci.modifiers,
          note: ci.note,
          ...(ci.portion_id ? { portion_id: ci.portion_id } : {}),
          ...(ci.selected_attributes?.length ? { selected_attributes: toOrderAttributePayload(ci.selected_attributes) } : {}),
        })),
      };
      const result = await api.createOrder(orderData);
      let savedOrder = result;
      try {
        const full = await api.getOrder(result.id);
        savedOrder = full;
        setExistingOrder(full);
      } catch {
        setExistingOrder(result);
      }
      setCartItems([]);
      toast.success('Sipariş kaydedildi');
      if (!skipNavigate && onNavigateToTables) onNavigateToTables();
      return { order: savedOrder, isNew: true };
    } catch (err) {
      toast.error(err.message);
      return null;
    } finally {
      setSaving(false);
    }
  };

  const handleVoidItem = async (itemId) => {
    setConfirmDialog({
      title: 'Ürün iptal edilsin mi?',
      body: 'Bu ürün siparişten iptal edilecek.',
      confirmLabel: 'Ürünü İptal Et',
      tone: 'danger',
      onConfirm: async () => {
        try {
          setSaving(true);
          await api.updateOrderItem(existingOrder.id, itemId, { status: 'cancelled' });
          toast.success('Ürün iptal edildi');
          const updated = await api.getOrder(existingOrder.id);
          setExistingOrder(updated);
          if (updated.status === 'cancelled' && orderType === 'dine_in' && onNavigateToTables) {
            onNavigateToTables();
          }
        } catch (err) {
          toast.error(err.message);
        } finally {
          setSaving(false);
        }
      },
    });
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
      setConfirmDialog({
        title: 'Satır iptal edilsin mi?',
        body: 'Adet sıfıra düşürüldüğü için bu satır siparişten iptal edilecek.',
        confirmLabel: 'Satırı İptal Et',
        tone: 'danger',
        onConfirm: async () => {
          try {
            setSaving(true);
            await api.updateOrderItem(existingOrder.id, itemId, { status: 'cancelled' });
            toast.success('Satır iptal edildi');
            const updated = await api.getOrder(existingOrder.id);
            setExistingOrder(updated);
            if (updated.status === 'cancelled' && orderType === 'dine_in' && onNavigateToTables) {
              onNavigateToTables();
            }
          } catch (err) {
            toast.error(err.message);
          } finally {
            setSaving(false);
          }
        },
      });
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
    setConfirmDialog({
      title: 'Masa taşınsın mı?',
      body: `${fromLabel} siparişi ${toLabel} masasına taşınacak.`,
      confirmLabel: 'Masayı Taşı',
      tone: 'primary',
      onConfirm: async () => {
        try {
          setSaving(true);
          await api.transferTable(table.id, targetTableId);
          toast.success('Sipariş hedef masaya taşındı');
          setMoveModalOpen(false);
          if (onNavigateToTables) onNavigateToTables({ highlightTableId: targetTableId });
        } catch (err) {
          toast.error(err.message);
        } finally {
          setSaving(false);
        }
      },
    });
  };

  const loadCustomersForModal = async (q = '') => {
    setCustomerListLoading(true);
    try {
      let data;
      if (q.length >= 2) {
        const isPhone = /\d/.test(q);
        data = await api.getCustomers(isPhone ? { phone: q } : { search: q });
      } else {
        data = await api.getCustomers();
      }
      setCustomerList(normalizeCustomerList(data));
    } catch {
      toast.error('Müşteriler yüklenemedi');
      setCustomerList([]);
    } finally {
      setCustomerListLoading(false);
    }
  };

  const openCustomerModal = () => {
    setCustomerModalOpen(true);
    setCustomerSearchQuery('');
    setNewCustomerMode(false);
    setNewCustomer({ full_name: '', phone: '', address: '', address_title: 'Ev' });
    loadCustomersForModal('');
  };

  const handleCustomerSearchInput = (q) => {
    setCustomerSearchQuery(q);
    if (q.length >= 2) {
      loadCustomersForModal(q);
    } else if (q === '') {
      loadCustomersForModal('');
    }
  };

  const revertSelectedCustomerFromOrder = () => {
    if (existingOrder?.customer_id) {
      setSelectedCustomer({
        id: existingOrder.customer_id,
        full_name: existingOrder.customer_name || '',
      });
    } else {
      setSelectedCustomer(null);
    }
  };

  const handlePickCustomer = async (cust) => {
    const next = { id: cust.id, full_name: cust.full_name };
    setSelectedCustomer(next);
    if (orderType === 'takeaway') {
      const defaultAddr = cust.addresses?.find((a) => a.is_default) || cust.addresses?.[0];
      setSelectedTakeawayAddress(defaultAddr?.address || '');
    }
    setCustomerModalOpen(false);
    if (existingOrder?.id && !isOrderClosedOrCancelled(existingOrder)) {
      try {
        setSaving(true);
        const updated = await api.patchOrderCustomer(existingOrder.id, cust.id);
        setExistingOrder(updated);
        toast.success('Müşteri güncellendi');
      } catch (err) {
        toast.error(err.message);
        revertSelectedCustomerFromOrder();
      } finally {
        setSaving(false);
      }
    }
  };

  const handleClearTableCustomer = async () => {
    if (orderType === 'takeaway') return;
    setSelectedCustomer(null);
    setCustomerModalOpen(false);
    if (existingOrder?.id && !isOrderClosedOrCancelled(existingOrder)) {
      try {
        setSaving(true);
        const updated = await api.patchOrderCustomer(existingOrder.id, null);
        setExistingOrder(updated);
        toast.success('Müşteri kaldırıldı');
      } catch (err) {
        toast.error(err.message);
        revertSelectedCustomerFromOrder();
      } finally {
        setSaving(false);
      }
    }
  };

  const handleCreateCustomerFromModal = async () => {
    try {
      const cust = await api.createCustomer(newCustomer);
      setSelectedCustomer({ id: cust.id, full_name: cust.full_name });
      setSelectedTakeawayAddress(newCustomer.address || '');
      setCustomerModalOpen(false);
      setNewCustomerMode(false);
      setNewCustomer({ full_name: '', phone: '', address: '', address_title: 'Ev' });
      toast.success('Müşteri oluşturuldu');
    } catch (err) {
      toast.error(err.message || 'Müşteri oluşturulamadı');
    }
  };

  // Fiyatlar KDV dahil; grand_total = satır toplamı − indirim
  const { displayTotal, araTotal } = getOrderTotalsForDisplay(existingOrder, cartItems);

  const allExistingItems = existingOrder?.items || [];
  const hasUnsavedChanges = hasUnsavedOrderChanges(cartItems);
  const canOpenPayment = canOpenOrderPayment(existingOrder, cartItems);
  const tableDisplayName = table
    ? (table.displayName || `Masa ${table.name}`)
    : existingOrder?.table_name || null;

  const withOrderPaymentContext = (order) => ({
    ...order,
    table_id: order.table_id || table?.id || null,
    table_name: order.table_name || table?.name || null,
    table_display_name: tableDisplayName || order.table_display_name || order.table_name || null,
    area_name: table?.area_name || order.area_name || null,
  });

  const openPaymentFlow = async (kind) => {
    if (!canOpenPayment || saving) return;
    const payableOrder = withOrderPaymentContext(existingOrder);
    if (kind === 'quick') onQuickPayment?.(payableOrder);
    else onPayment?.(payableOrder);
  };

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
          </div>
        </div>
      </div>
    );
  }

  return (
    <div style={{ display: 'flex', height: '100%', overflow: 'hidden' }}>
      {/* Sol: üst bar + arama + yatay kategoriler + ürün ızgarası */}
      <div style={{ flex: 1, display: 'flex', flexDirection: 'column', borderRight: '1px solid var(--border)' }}>
        <div className="order-screen-topbar">
          <button type="button" className="order-screen-back-zone" onClick={onBack} title="Masalar ekranına dön">
            <span className="order-screen-back-zone-icon" aria-hidden="true">
              <ChevronLeft size={20} />
            </span>
            <span className="order-screen-back-zone-body">
              <span className="order-screen-table-title">
                {table
                  ? (table.displayName || `Masa ${table.name}`)
                  : orderType === 'takeaway'
                    ? 'Paket Sipariş'
                    : 'Sipariş'}
              </span>
              {table?.area_name && (
                <span className="order-screen-area-pill">{table.area_name}</span>
              )}
              {orderType === 'dine_in' && selectedCustomer?.full_name && (
                <span className="order-screen-customer-line">{selectedCustomer.full_name}</span>
              )}
              {orderType === 'takeaway' && selectedCustomer?.full_name && (
                <span className="order-screen-customer-line">{selectedCustomer.full_name}</span>
              )}
              {orderType === 'takeaway' && (customer || (takeawayPhone && takeawayPhone.trim() !== '')) && (
                <span className="order-screen-customer-line order-screen-takeaway-phone">
                  <Phone size={12} style={{ flexShrink: 0 }} />
                  {(takeawayPhone && takeawayPhone.trim()) || (prefillPhone != null ? String(prefillPhone) : '') || customer?.phones?.[0]?.phone || ''}
                </span>
              )}
            </span>
          </button>

          {orderType === 'dine_in' && table && (
            <>
              <span className="order-screen-topbar-divider" aria-hidden />
              <button
                type="button"
                className="order-screen-topbar-icon-btn"
                onClick={openCustomerModal}
                data-testid="order-select-customer-button"
                disabled={saving || (existingOrder && ['closed', 'cancelled'].includes(existingOrder.status))}
                title={selectedCustomer ? 'Müşteriyi değiştir' : 'Müşteri seç'}
              >
                <User size={22} strokeWidth={2} />
              </button>
            </>
          )}

          {existingOrder && (
            <span className="badge badge-info order-screen-order-badge" style={{ fontSize: 11 }}>#{existingOrder.order_no}</span>
          )}

          <div className="order-screen-topbar-search">
            <div style={{ position: 'relative', width: '100%' }}>
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
                  className="order-screen-search-clear"
                  onClick={() => handleSearch('')}
                >
                  <X size={14} />
                </button>
              )}
            </div>
          </div>
        </div>

        <div style={{
          display: 'flex', gap: 10, padding: '14px 18px',
          overflowX: 'auto', flexShrink: 0,
          borderBottom: '1px solid var(--border)',
        }}>
          {/* Tümü tab */}
          <button
            type="button"
            onClick={() => handleCategorySelect('__all__')}
            style={{
              padding: '12px 20px', borderRadius: 'var(--radius-sm)',
              border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
              fontSize: 15, fontWeight: 600, fontFamily: 'inherit',
              lineHeight: 1.25, minHeight: 46,
              transition: 'all var(--transition-fast)',
              background: activeCat === '__all__' ? 'var(--accent)22' : 'var(--bg-tertiary)',
              color: activeCat === '__all__' ? 'var(--accent)' : 'var(--text-secondary)',
              borderBottom: activeCat === '__all__' ? '3px solid var(--accent)' : '3px solid transparent',
            }}
          >
            Tümü
          </button>
          {categories.map((cat) => (
            <button
              key={cat.id}
              type="button"
              onClick={() => handleCategorySelect(cat.id)}
              style={{
                padding: '12px 20px', borderRadius: 'var(--radius-sm)',
                border: 'none', cursor: 'pointer', whiteSpace: 'nowrap',
                fontSize: 15, fontWeight: 600, fontFamily: 'inherit',
                lineHeight: 1.25,
                minHeight: 46,
                transition: 'all var(--transition-fast)',
                background: activeCat === cat.id ? `${cat.color}22` : 'var(--bg-tertiary)',
                color: activeCat === cat.id ? cat.color : 'var(--text-secondary)',
                borderBottom: activeCat === cat.id ? `3px solid ${cat.color}` : '3px solid transparent',
              }}
            >
              {cat.icon} {cat.name}
            </button>
          ))}
        </div>

        <div style={{ flex: 1, overflow: 'auto', padding: 16 }}>
          <div style={{
            display: 'grid',
            gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))',
            gap: 14,
          }}>
            {products.map((prod) => {
              const qty = getCartQtyForProduct(prod.id);
              return (
                <div
                  key={prod.id}
                  style={{
                    display: 'flex',
                    position: 'relative',
                    background: 'var(--bg-card)',
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-sm)',
                    minHeight: 104,
                    overflow: 'hidden',
                    transition: 'all var(--transition-fast)',
                  }}
                  onMouseEnter={(e) => {
                    e.currentTarget.style.borderColor = 'var(--accent)';
                    e.currentTarget.style.background = 'var(--bg-card-hover)';
                  }}
                  onMouseLeave={(e) => {
                    e.currentTarget.style.borderColor = 'var(--border)';
                    e.currentTarget.style.background = 'var(--bg-card)';
                  }}
                >
                  <button
                    type="button"
                    onClick={() => quickAddFromGrid(prod)}
                    data-testid={`product-card-${prod.id}`}
                    style={{
                      flex: 1,
                      minWidth: 0,
                      padding: '16px 14px',
                      cursor: 'pointer',
                      textAlign: 'left',
                      border: 'none',
                      background: 'transparent',
                      fontFamily: 'inherit',
                      display: 'flex',
                      flexDirection: 'column',
                      justifyContent: 'space-between',
                    }}
                  >
                    <div style={{ fontSize: 15, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 'auto', lineHeight: 1.35 }}>
                      {prod.name}
                    </div>
                    <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--accent)', marginTop: 10 }}>
                      {formatCurrency(prod.price)}
                    </div>
                  </button>
                  {qty > 0 && (
                    <div
                      style={{
                        display: 'flex',
                        flexDirection: 'column',
                        alignItems: 'center',
                        justifyContent: 'space-between',
                        width: 46,
                        flexShrink: 0,
                        background: 'var(--danger)',
                        color: 'var(--text-on-accent)',
                        padding: '8px 0',
                      }}
                    >
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          quickAddFromGrid(prod);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'inherit',
                          cursor: 'pointer',
                          padding: 4,
                          minWidth: 34,
                          minHeight: 34,
                          lineHeight: 1,
                          fontSize: 18,
                          fontWeight: 700,
                          fontFamily: 'inherit',
                        }}
                        aria-label="Arttır"
                      >
                        +
                      </button>
                      <span style={{ fontSize: 17, fontWeight: 800, lineHeight: 1.2 }}>{qty}</span>
                      <button
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          decrementProductInCart(prod.id);
                        }}
                        style={{
                          background: 'none',
                          border: 'none',
                          color: 'inherit',
                          cursor: 'pointer',
                          padding: 4,
                          minWidth: 34,
                          minHeight: 34,
                          lineHeight: 1,
                          fontSize: 18,
                          fontWeight: 700,
                          fontFamily: 'inherit',
                        }}
                        aria-label="Azalt"
                      >
                        −
                      </button>
                    </div>
                  )}
                </div>
              );
            })}
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
      <div style={{ width: 460, display: 'flex', flexDirection: 'column', background: 'var(--bg-secondary)', flexShrink: 0 }}>
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
              <div style={{ padding: '6px 18px', fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Mevcut Ürünler
              </div>
              {allExistingItems.filter((i) => i.status !== 'cancelled').map((item) => {
                const mods = JSON.parse(item.modifiers || '[]');
                const st = ORDER_ITEM_LINE_STATUS[item.status] || ORDER_ITEM_LINE_STATUS.sent;
                const lineBadge = item.status && item.status !== 'new' ? st : null;
                const canEditQty = canEditOrderItem(item, existingOrder);
                return (
                  <div
                    key={item.id}
                    role="button"
                    tabIndex={0}
                    onClick={() => setLineDetailModal({ kind: 'existing', itemId: item.id })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setLineDetailModal({ kind: 'existing', itemId: item.id });
                      }
                    }}
                    style={{
                      padding: '12px 18px',
                      display: 'flex',
                      alignItems: 'flex-start',
                      gap: 10,
                      opacity: item.is_comped ? 0.5 : 1,
                      fontSize: 15,
                      borderBottom: '1px solid var(--border)',
                      cursor: 'pointer',
                    }}
                    className="order-line-row-clickable"
                  >
                    {canEditQty ? (
                      <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                        <button type="button" className="btn btn-ghost" style={{ padding: 6, minWidth: 40, minHeight: 40 }} onClick={() => handleUpdateExistingQty(item.id, -1)} disabled={saving}>
                          <Minus size={14} />
                        </button>
                        <span style={{ fontSize: 15, fontWeight: 700, minWidth: 26, textAlign: 'center' }}>{item.quantity}</span>
                        <button type="button" className="btn btn-ghost" style={{ padding: 6, minWidth: 40, minHeight: 40 }} onClick={() => handleUpdateExistingQty(item.id, 1)} disabled={saving}>
                          <Plus size={14} />
                        </button>
                      </div>
                    ) : (
                      <span style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-muted)', width: 32, textAlign: 'center', flexShrink: 0, paddingTop: 2 }}>
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
                      {item.portion_label && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>{item.portion_label}</div>
                      )}
                      {mods.length > 0 && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>
                          {mods.map((m) => m.name).join(', ')}
                        </div>
                      )}
                      {(() => {
                        let attrs = [];
                        try { attrs = JSON.parse(item.selected_attributes || '[]'); } catch {}
                        return attrs.length > 0 ? (
                          <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 2 }}>
                            {attrs.map((a) => a.option_name).join(', ')}
                          </div>
                        ) : null;
                      })()}
                      <div style={{ fontSize: 13, color: 'var(--text-muted)', marginTop: 4 }}>
                        {item.is_comped ? (
                          <span style={{ color: 'var(--danger)' }}>İKRAM</span>
                        ) : (
                          <>
                            {formatCurrency(item.unit_price)} × {item.quantity} ={' '}
                            <span style={{ fontWeight: 600, color: 'var(--text-secondary)' }}>{formatCurrency(item.unit_price * item.quantity)}</span>
                          </>
                        )}
                      </div>
                      {item.note && <div style={{ fontSize: 12, color: 'var(--warning)', marginTop: 2 }}>📝 {item.note}</div>}
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2, flexShrink: 0 }} onClick={(e) => e.stopPropagation()}>
                      {canVoidOrderItem(item, existingOrder, false) && (
                        <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 4, minWidth: 40, minHeight: 40 }} onClick={() => handleVoidItem(item.id)} title="Satırı iptal">
                          <Trash2 size={16} />
                        </button>
                      )}
                      {item.status !== 'new' && canVoidOrderItem(item, existingOrder, hasRole('admin', 'cashier')) && (
                        <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 4, minWidth: 40, minHeight: 40 }} onClick={() => handleVoidItem(item.id)} title="İptal (void)">
                          <Trash2 size={16} />
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
                <div style={{ padding: '6px 18px', display: 'flex', alignItems: 'center', gap: 8, fontSize: 11, fontWeight: 600, color: 'var(--accent)', textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                  <span>Yeni Eklenen</span>
                  <span style={{
                    borderRadius: 6,
                    border: '1px solid var(--accent)',
                    padding: '2px 6px',
                    color: 'var(--accent)',
                    background: 'var(--accent-muted)',
                    letterSpacing: 0,
                    textTransform: 'none',
                  }}>
                    Kaydedilmedi
                  </span>
                </div>
              )}
              {cartItems.map((item, idx) => {
                const mods = item.modifiers || [];
                return (
                  <div
                    key={idx}
                    role="button"
                    tabIndex={0}
                    onClick={() => setLineDetailModal({ kind: 'cart', index: idx })}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        setLineDetailModal({ kind: 'cart', index: idx });
                      }
                    }}
                    style={{
                      padding: '10px 18px', display: 'flex', alignItems: 'center', gap: 10,
                      fontSize: 15, borderLeft: '3px solid var(--accent)',
                      background: 'var(--accent-muted)',
                      marginBottom: 1,
                      cursor: 'pointer',
                    }}
                    className="order-line-row-clickable"
                  >
                    {/* Quantity Controls */}
                    <div style={{ display: 'flex', alignItems: 'center', gap: 2 }} onClick={(e) => e.stopPropagation()}>
                      <button type="button" className="btn btn-ghost" onClick={() => updateQuantity(idx, -1)}
                        style={{ padding: 6, minWidth: 40, minHeight: 40, borderRadius: 4 }}>
                        <Minus size={14} />
                      </button>
                      <span style={{ fontSize: 15, fontWeight: 700, width: 28, textAlign: 'center' }}>{item.quantity}</span>
                      <button type="button" className="btn btn-ghost" onClick={() => updateQuantity(idx, 1)}
                        style={{ padding: 6, minWidth: 40, minHeight: 40, borderRadius: 4 }}>
                        <Plus size={14} />
                      </button>
                    </div>

                    {/* Item Info */}
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div style={{ fontWeight: 600, fontSize: 15 }} className="truncate">{item.product_name}</div>
                      {item.portion_label && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{item.portion_label}</div>
                      )}
                      {mods.length > 0 && (
                        <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                          {mods.map(m => m.name).join(', ')}
                        </div>
                      )}
                      {(item.selected_attributes || []).length > 0 && (
                        <div style={{ fontSize: 12, color: 'var(--text-secondary)' }}>
                          {item.selected_attributes.map((a) => a.option_name).join(', ')}
                        </div>
                      )}
                      {item.note && <div style={{ fontSize: 12, color: 'var(--warning)' }}>📝 {item.note}</div>}
                    </div>

                    {/* Price */}
                    <span style={{ fontWeight: 700, fontSize: 15, whiteSpace: 'nowrap' }}>
                      {formatCurrency(item.unit_price * item.quantity)}
                    </span>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 2 }} onClick={(e) => e.stopPropagation()}>
                      <button type="button" style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--danger)', padding: 4, minWidth: 40, minHeight: 40 }}
                        onClick={() => removeItem(idx)}>
                        <Trash2 size={16} />
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

        {/* Totals & payment actions */}
        <div
          style={{
            borderTop: '1px solid var(--border)',
            padding: '12px 16px',
            flexShrink: 0,
            background: 'linear-gradient(180deg, var(--bg-card), var(--bg-secondary))',
            boxShadow: '0 -10px 28px rgba(0,0,0,.18)',
          }}
        >
          <div style={{ marginBottom: 10 }}>
            <div>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: 13, color: 'var(--text-muted)', marginBottom: 6 }}>
                <span>Ara toplam</span>
                <span>{formatCurrency(araTotal)}</span>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', gap: 16, fontSize: 20, fontWeight: 850 }}>
                <span>Toplam</span>
                <span>{formatCurrency(displayTotal)}</span>
              </div>
            </div>
          </div>

          {hasUnsavedChanges && (
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 10 }}>
              Yeni ürünleri kaydettikten sonra ödeme aksiyonları açılır.
            </div>
          )}
          {orderType === 'takeaway' && !selectedCustomer?.id && hasUnsavedChanges && (
            <div style={{ fontSize: 11, color: 'var(--danger)', textAlign: 'center', marginBottom: 10 }}>
              Kaydetmeden önce müşteri seçimi zorunludur.
            </div>
          )}

          {hasUnsavedChanges ? (
            <button
              type="button"
              className="btn btn-primary"
              data-testid="order-save-button"
              style={{ width: '100%', minHeight: 46, justifyContent: 'center' }}
              onClick={handleSaveOrder}
              disabled={saving}
            >
              <Save size={16} /> {saving ? 'Kaydediliyor...' : 'Kaydet'}
            </button>
          ) : canOpenPayment && (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
              <button
                type="button"
                className="btn btn-primary"
                data-testid="order-payment-button"
                style={{ width: '100%', minHeight: 46, justifyContent: 'center' }}
                onClick={() => openPaymentFlow('detail')}
                disabled={saving}
              >
                <CreditCard size={16} /> Ödeme
              </button>
              <button
                type="button"
                className="btn btn-success"
                style={{ width: '100%', minHeight: 46, justifyContent: 'center' }}
                onClick={() => openPaymentFlow('quick')}
                disabled={saving || !onQuickPayment}
              >
                <CreditCard size={16} /> Hızlı Öde
              </button>
            </div>
          )}
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

      {lineDetailModal?.kind === 'cart' && lineDetailModal.index != null && cartItems[lineDetailModal.index] != null && (() => {
        const idx = lineDetailModal.index;
        const item = cartItems[idx];
        return (
          <OrderProductDetailModal
            key={`line-cart-${idx}`}
            lineKey={`cart-${idx}`}
            product={{ id: item.product_id, name: item.product_name }}
            initialLine={{
              quantity: item.quantity,
              note: item.note,
              portion_id: item.portion_id,
              portion_label: item.portion_label,
              selected_attributes: item.selected_attributes || [],
            }}
            modifiersDisplay={item.modifiers?.length ? item.modifiers : null}
            onClose={() => setLineDetailModal(null)}
            onContinue={handleLineDetailContinue}
          />
        );
      })()}
      {lineDetailModal?.kind === 'existing' && existingOrder && (() => {
        const item = (existingOrder.items || []).find((i) => i.id === lineDetailModal.itemId);
        if (!item) return null;
        let mods;
        try {
          mods = JSON.parse(item.modifiers || '[]');
        } catch {
          mods = [];
        }
        const isNew = item.status === 'new';
        const closed = existingOrder.status === 'closed';
        const comped = item.is_comped;
        return (
          <OrderProductDetailModal
            key={`line-ex-${item.id}`}
            lineKey={`existing-${item.id}`}
            product={{ id: item.product_id, name: item.product_name }}
            initialLine={{
              quantity: item.quantity,
              note: item.note || '',
              portion_id: item.portion_id,
              portion_label: item.portion_label,
              selected_attributes: (() => { try { return JSON.parse(item.selected_attributes || '[]'); } catch { return []; } })(),
            }}
            modifiersDisplay={mods.length ? mods : null}
            readOnlyAttributes
            readOnlyQuantity={closed || comped || !isNew}
            readOnlyPortion={closed || comped || !isNew}
            readOnlyNote={closed || comped}
            isReadOnly={closed || comped}
            subtitle={
              closed
                ? 'Sipariş kapalı — salt görüntüleme'
                : comped
                  ? 'İkram satırı — düzenlenemez'
                  : undefined
            }
            onClose={() => setLineDetailModal(null)}
            onContinue={handleLineDetailContinue}
          />
        );
      })()}

      {/* ═══ Modifier Modal ═══ */}
      {modifierModal && (
        <ModifierModal
          product={modifierModal.product}
          groups={modifierModal.groups}
          onConfirm={(selectedMods) => {
            if (modifierModal.pendingLine) {
              const { quantity, note, portion_id, portion_label } = modifierModal.pendingLine;
              addItemToCart(modifierModal.product, selectedMods, { quantity, note, portion_id, portion_label });
            } else {
              addItemToCart(modifierModal.product, selectedMods);
            }
            setModifierModal(null);
          }}
          onClose={() => setModifierModal(null)}
        />
      )}

      <ConfirmDialog
        open={!!confirmDialog}
        title={confirmDialog?.title}
        body={confirmDialog?.body}
        confirmLabel={confirmDialog?.confirmLabel}
        tone={confirmDialog?.tone}
        onCancel={() => setConfirmDialog(null)}
        onConfirm={() => {
          const onConfirm = confirmDialog?.onConfirm;
          setConfirmDialog(null);
          onConfirm?.();
        }}
      />

      {customerModalOpen && (
        <div className="modal-overlay" onClick={() => setCustomerModalOpen(false)}>
          <div className="modal modal-md order-customer-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>{orderType === 'takeaway' ? 'Müşteri seçimi zorunlu' : 'Kayıtlı müşteri seç'}</h2>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setCustomerModalOpen(false)} title="Kapat">
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div className="order-customer-modal-search">
                <Search size={15} className="order-customer-modal-search-icon" />
                <input
                  className="input"
                  data-testid="order-customer-search-input"
                  placeholder="Ad veya telefon ile ara..."
                  value={customerSearchQuery}
                  onChange={(e) => handleCustomerSearchInput(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
              </div>
              {selectedCustomer && (
                <div className="order-customer-modal-selected">
                  <span>
                    Seçili: <strong>{selectedCustomer.full_name}</strong>
                  </span>
                  {orderType !== 'takeaway' && (
                    <button type="button" className="btn btn-ghost btn-sm" onClick={handleClearTableCustomer} disabled={saving}>
                      Kaldır
                    </button>
                  )}
                </div>
              )}
              {!selectedCustomer && (
                <div style={{ marginBottom: 10 }}>
                  <button
                    type="button"
                    className="btn btn-ghost btn-sm"
                    onClick={() => setNewCustomerMode((prev) => !prev)}
                  >
                    <Plus size={14} /> Yeni Müşteri
                  </button>
                </div>
              )}
              {newCustomerMode && !selectedCustomer && (
                <div style={{ display: 'flex', flexDirection: 'column', gap: 8, marginBottom: 12 }}>
                  <input
                    className="input"
                    placeholder="Ad Soyad"
                    value={newCustomer.full_name}
                    onChange={(e) => setNewCustomer((p) => ({ ...p, full_name: e.target.value }))}
                  />
                  <input
                    className="input"
                    placeholder="Telefon"
                    value={newCustomer.phone}
                    onChange={(e) => setNewCustomer((p) => ({ ...p, phone: e.target.value }))}
                  />
                  <input
                    className="input"
                    placeholder="Adres"
                    value={newCustomer.address}
                    onChange={(e) => setNewCustomer((p) => ({ ...p, address: e.target.value }))}
                  />
                  <button
                    type="button"
                    className="btn btn-primary btn-sm"
                    onClick={handleCreateCustomerFromModal}
                    disabled={!newCustomer.full_name || !newCustomer.phone}
                  >
                    Müşteri Oluştur
                  </button>
                </div>
              )}
              <div className="order-customer-modal-list">
                {customerListLoading ? (
                  <div className="empty-state" style={{ padding: 24 }}>Yükleniyor...</div>
                ) : (
                  customerList.map((c) => (
                    <button
                      key={c.id}
                      type="button"
                      data-testid={`customer-row-${c.id}`}
                      className={`order-customer-row ${selectedCustomer?.id === c.id ? 'is-active' : ''}`}
                      onClick={() => handlePickCustomer(c)}
                      disabled={saving}
                    >
                      <span className="order-customer-avatar">{c.full_name?.charAt(0) || '?'}</span>
                      <span className="order-customer-row-text">
                        <span className="order-customer-row-name">{c.full_name}</span>
                        <span className="order-customer-row-phone">{c.phones?.map((p) => p.phone).join(' · ') || '—'}</span>
                      </span>
                      <span className="order-customer-row-meta">{c.total_orders ?? 0} sipariş</span>
                    </button>
                  ))
                )}
                {!customerListLoading && customerList.length === 0 && (
                  <div className="empty-state" style={{ padding: 20 }}>
                    <div className="empty-state-text">Müşteri bulunamadı</div>
                  </div>
                )}
              </div>
              {orderType === 'takeaway' && selectedCustomer && (
                <div style={{ marginTop: 10 }}>
                  <label style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                    Teslimat Adresi
                  </label>
                  <textarea
                    className="input"
                    rows={2}
                    value={selectedTakeawayAddress}
                    onChange={(e) => setSelectedTakeawayAddress(e.target.value)}
                    placeholder="Teslimat adresi..."
                  />
                </div>
              )}
            </div>
            <div className="modal-footer">
              <button type="button" className="btn btn-ghost" data-testid="order-customer-modal-close-button" onClick={() => setCustomerModalOpen(false)}>Kapat</button>
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
