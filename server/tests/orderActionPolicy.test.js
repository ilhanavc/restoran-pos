/**
 * orderActionPolicy.js — frontend utility fonksiyon unit testleri.
 *
 * Kapsam:
 *   getActiveOrderItems, hasUnsavedOrderChanges, getOrderTotalsForDisplay,
 *   isOrderClosedOrCancelled, canOpenOrderPayment, canEditOrderItem,
 *   canVoidOrderItem, canSaveOrderDraft
 *
 * Saf JS fonksiyonlar — React bağımsız, server vitest ortamında çalışır.
 */
import { describe, it, expect } from 'vitest';
import {
  getActiveOrderItems,
  hasUnsavedOrderChanges,
  getOrderTotalsForDisplay,
  isOrderClosedOrCancelled,
  canOpenOrderPayment,
  canEditOrderItem,
  canVoidOrderItem,
  canSaveOrderDraft,
} from '../../client/src/utils/orderActionPolicy.js';

// ── getActiveOrderItems ───────────────────────────────────────────────────────
describe('getActiveOrderItems', () => {
  it('cancelled olmayan kalemleri döner', () => {
    const order = {
      items: [
        { id: '1', status: 'new' },
        { id: '2', status: 'cancelled' },
        { id: '3', status: 'served' },
      ],
    };
    const result = getActiveOrderItems(order);
    expect(result).toHaveLength(2);
    expect(result.map(i => i.id)).toEqual(['1', '3']);
  });

  it('tüm kalemler iptalse boş dizi döner', () => {
    const order = { items: [{ status: 'cancelled' }, { status: 'cancelled' }] };
    expect(getActiveOrderItems(order)).toHaveLength(0);
  });

  it('order null/undefined → boş dizi', () => {
    expect(getActiveOrderItems(null)).toHaveLength(0);
    expect(getActiveOrderItems({})).toHaveLength(0);
  });
});

// ── hasUnsavedOrderChanges ────────────────────────────────────────────────────
describe('hasUnsavedOrderChanges', () => {
  it('sepette ürün varsa true', () => {
    expect(hasUnsavedOrderChanges([{ product_id: 'p1', quantity: 1 }])).toBe(true);
  });

  it('boş sepet false döner', () => {
    expect(hasUnsavedOrderChanges([])).toBe(false);
    expect(hasUnsavedOrderChanges(null)).toBe(false);
    expect(hasUnsavedOrderChanges(undefined)).toBe(false);
  });
});

// ── getOrderTotalsForDisplay ──────────────────────────────────────────────────
describe('getOrderTotalsForDisplay', () => {
  it('sepet ve kayıtlı siparişi birleştirir', () => {
    const order = { grand_total: 80, subtotal: 80 };
    const cartItems = [{ unit_price: 50, quantity: 2 }];

    const result = getOrderTotalsForDisplay(order, cartItems);

    expect(result.savedTotal).toBe(80);
    expect(result.cartSubtotal).toBe(100); // 50 * 2
    expect(result.displayTotal).toBe(180); // 80 + 100
    expect(result.araTotal).toBe(180);     // 80 + 100
  });

  it('boş sepet — displayTotal = savedTotal', () => {
    const order = { grand_total: 120, subtotal: 120 };
    const result = getOrderTotalsForDisplay(order, []);
    expect(result.displayTotal).toBe(120);
    expect(result.cartSubtotal).toBe(0);
  });

  it('sipariş ve sepet null → sıfır', () => {
    const result = getOrderTotalsForDisplay(null, null);
    expect(result.displayTotal).toBe(0);
    expect(result.cartSubtotal).toBe(0);
  });
});

// ── isOrderClosedOrCancelled ──────────────────────────────────────────────────
describe('isOrderClosedOrCancelled', () => {
  it("status 'closed' → true", () => {
    expect(isOrderClosedOrCancelled({ status: 'closed' })).toBe(true);
  });

  it("status 'cancelled' → true", () => {
    expect(isOrderClosedOrCancelled({ status: 'cancelled' })).toBe(true);
  });

  it("status 'served' → false", () => {
    expect(isOrderClosedOrCancelled({ status: 'served' })).toBe(false);
  });

  it('null/undefined order → false', () => {
    expect(isOrderClosedOrCancelled(null)).toBe(false);
    expect(isOrderClosedOrCancelled(undefined)).toBe(false);
  });
});

// ── canOpenOrderPayment ───────────────────────────────────────────────────────
describe('canOpenOrderPayment', () => {
  const baseOrder = {
    id: 'order-1',
    status: 'served',
    items: [{ id: 'item-1', status: 'served' }],
  };

  it('sipariş var, sepet boş, kapalı değil, aktif kalem var → true', () => {
    expect(canOpenOrderPayment(baseOrder, [])).toBe(true);
  });

  it('sepette bekleyen ürün varsa → false', () => {
    expect(canOpenOrderPayment(baseOrder, [{ product_id: 'p1' }])).toBe(false);
  });

  it('sipariş kapalı → false', () => {
    const closed = { ...baseOrder, status: 'closed' };
    expect(canOpenOrderPayment(closed, [])).toBe(false);
  });

  it('sipariş iptal → false', () => {
    const cancelled = { ...baseOrder, status: 'cancelled' };
    expect(canOpenOrderPayment(cancelled, [])).toBe(false);
  });

  it('sipariş null → false', () => {
    expect(canOpenOrderPayment(null, [])).toBe(false);
  });

  it('tüm kalemler iptal → false', () => {
    const allCancelled = {
      id: 'order-2',
      status: 'saved',
      items: [{ id: 'i1', status: 'cancelled' }],
    };
    expect(canOpenOrderPayment(allCancelled, [])).toBe(false);
  });

  it('aktif kalem var ve sepet boş → true', () => {
    const order = {
      id: 'order-3',
      status: 'in_kitchen',
      items: [
        { id: 'i1', status: 'cancelled' },
        { id: 'i2', status: 'sent' },
      ],
    };
    expect(canOpenOrderPayment(order, [])).toBe(true);
  });
});

// ── canEditOrderItem ──────────────────────────────────────────────────────────
describe('canEditOrderItem', () => {
  it("item new ve sipariş açık → true", () => {
    const item = { id: 'i1', status: 'new', is_comped: false };
    const order = { status: 'saved' };
    expect(canEditOrderItem(item, order)).toBe(true);
  });

  it("item sent → false (mutfağa gönderildi)", () => {
    const item = { id: 'i1', status: 'sent', is_comped: false };
    const order = { status: 'in_kitchen' };
    expect(canEditOrderItem(item, order)).toBe(false);
  });

  it('is_comped item → false', () => {
    const item = { id: 'i1', status: 'new', is_comped: true };
    const order = { status: 'saved' };
    expect(canEditOrderItem(item, order)).toBe(false);
  });

  it('sipariş kapalı → false', () => {
    const item = { id: 'i1', status: 'new', is_comped: false };
    const order = { status: 'closed' };
    expect(canEditOrderItem(item, order)).toBe(false);
  });

  it('item null → false', () => {
    expect(canEditOrderItem(null, { status: 'saved' })).toBe(false);
  });
});

// ── canVoidOrderItem ──────────────────────────────────────────────────────────
describe('canVoidOrderItem', () => {
  it("new item, açık sipariş → true (herkes için)", () => {
    const item = { status: 'new', is_comped: false };
    const order = { status: 'in_kitchen' };
    expect(canVoidOrderItem(item, order, false)).toBe(true);
  });

  it("sent item + normal rol → false", () => {
    const item = { status: 'sent', is_comped: false };
    const order = { status: 'in_kitchen' };
    expect(canVoidOrderItem(item, order, false)).toBe(false);
  });

  it("sent item + yetkili rol → true", () => {
    const item = { status: 'sent', is_comped: false };
    const order = { status: 'in_kitchen' };
    expect(canVoidOrderItem(item, order, true)).toBe(true);
  });

  it('is_comped item → false (comped void edilemez)', () => {
    const item = { status: 'new', is_comped: true };
    const order = { status: 'saved' };
    expect(canVoidOrderItem(item, order, true)).toBe(false);
  });

  it('sipariş kapalı → false', () => {
    const item = { status: 'new', is_comped: false };
    const order = { status: 'closed' };
    expect(canVoidOrderItem(item, order, true)).toBe(false);
  });

  it('item null → false', () => {
    expect(canVoidOrderItem(null, { status: 'saved' }, true)).toBe(false);
  });

  it('order null → false', () => {
    expect(canVoidOrderItem({ status: 'new', is_comped: false }, null, true)).toBe(false);
  });
});

// ── canSaveOrderDraft ─────────────────────────────────────────────────────────
describe('canSaveOrderDraft', () => {
  it('dine_in + sepette ürün var → ok', () => {
    const result = canSaveOrderDraft({
      cartItems: [{ product_id: 'p1', quantity: 1 }],
      orderType: 'dine_in',
      selectedCustomer: null,
    });
    expect(result.ok).toBe(true);
    expect(result.reason).toBeNull();
  });

  it('takeaway + müşteri var → ok', () => {
    const result = canSaveOrderDraft({
      cartItems: [{ product_id: 'p1', quantity: 1 }],
      orderType: 'takeaway',
      selectedCustomer: { id: 'customer-1' },
    });
    expect(result.ok).toBe(true);
  });

  it('takeaway + müşteri yok → customer-required hatası', () => {
    const result = canSaveOrderDraft({
      cartItems: [{ product_id: 'p1', quantity: 1 }],
      orderType: 'takeaway',
      selectedCustomer: null,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('customer-required');
  });

  it('boş sepet → empty hatası', () => {
    const result = canSaveOrderDraft({
      cartItems: [],
      orderType: 'dine_in',
      selectedCustomer: null,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('empty');
  });

  it('null sepet → empty hatası', () => {
    const result = canSaveOrderDraft({
      cartItems: null,
      orderType: 'dine_in',
      selectedCustomer: null,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('empty');
  });

  it('boş sepet + müşteri yok takeaway → empty hatası (sepet öncelikli)', () => {
    const result = canSaveOrderDraft({
      cartItems: [],
      orderType: 'takeaway',
      selectedCustomer: null,
    });
    expect(result.ok).toBe(false);
    expect(result.reason).toBe('empty');
  });
});
