/**
 * orderPaymentState.js — frontend utility fonksiyon unit testleri.
 *
 * Kapsam:
 *   roundMoney, getPaidTotal, getOrderTotal, getTotalDue,
 *   isOrderFullyPaid, canCloseOrder, getPaymentStateLabel, getPaymentSummary
 *
 * Bu dosyalar React bağımsız saf JS olduğu için server vitest ortamında çalışır.
 */
import { describe, it, expect } from 'vitest';
import {
  roundMoney,
  getPaidTotal,
  getOrderTotal,
  getTotalDue,
  isOrderFullyPaid,
  canCloseOrder,
  getPaymentStateLabel,
  getPaymentSummary,
  PAYMENT_TOLERANCE,
} from '../../client/src/utils/orderPaymentState.js';

// ── roundMoney ────────────────────────────────────────────────────────────────
describe('roundMoney', () => {
  it('iki ondalıklı basamağa yuvarlar', () => {
    expect(roundMoney(10.004)).toBe(10.00);
    expect(roundMoney(10.999)).toBe(11.00);
    expect(roundMoney(10.126)).toBe(10.13);
    expect(roundMoney(80)).toBe(80);
    expect(roundMoney(0.1 + 0.2)).toBe(0.30); // floating-point trap
  });

  it('null/undefined için 0 döner', () => {
    expect(roundMoney(null)).toBe(0);
    expect(roundMoney(undefined)).toBe(0);
    expect(roundMoney('')).toBe(0);
  });

  it('negatif değerleri doğru yuvarlar', () => {
    expect(roundMoney(-10.005)).toBe(-10.01);
  });
});

// ── getPaidTotal ──────────────────────────────────────────────────────────────
describe('getPaidTotal', () => {
  it('payments dizisinden toplamı hesaplar', () => {
    const order = {
      grand_total: 200,
      payments: [
        { amount: 80 },
        { amount: 120 },
      ],
    };
    expect(getPaidTotal(order)).toBe(200);
  });

  it('payments yoksa paid_total alanını kullanır', () => {
    const order = { grand_total: 150, paid_total: 50 };
    expect(getPaidTotal(order)).toBe(50);
  });

  it('order_paid_total alanını fallback olarak kullanır', () => {
    const order = { grand_total: 100, order_paid_total: 30 };
    expect(getPaidTotal(order)).toBe(30);
  });

  it('null/undefined order için 0 döner', () => {
    expect(getPaidTotal(null)).toBe(0);
    expect(getPaidTotal(undefined)).toBe(0);
    expect(getPaidTotal({})).toBe(0);
  });

  it('boş payments dizisi için 0 döner', () => {
    const order = { grand_total: 100, payments: [] };
    expect(getPaidTotal(order)).toBe(0);
  });
});

// ── getOrderTotal ─────────────────────────────────────────────────────────────
describe('getOrderTotal', () => {
  it('grand_total alanını öncelikli kullanır', () => {
    expect(getOrderTotal({ grand_total: 200 })).toBe(200);
  });

  it('grand_total yoksa total kullanır', () => {
    expect(getOrderTotal({ total: 150 })).toBe(150);
  });

  it('order_total en son fallback', () => {
    expect(getOrderTotal({ order_total: 100 })).toBe(100);
  });

  it('null/undefined order için 0 döner', () => {
    expect(getOrderTotal(null)).toBe(0);
    expect(getOrderTotal({})).toBe(0);
  });
});

// ── getTotalDue ───────────────────────────────────────────────────────────────
describe('getTotalDue', () => {
  it('toplam - ödenen = kalan', () => {
    const order = { grand_total: 200, payments: [{ amount: 80 }] };
    expect(getTotalDue(order)).toBe(120);
  });

  it('tam ödenmiş siparişte 0 döner (negatif olmaz)', () => {
    const order = { grand_total: 100, payments: [{ amount: 100 }] };
    expect(getTotalDue(order)).toBe(0);
  });

  it('fazla ödeme varsa 0 döner (negatif olmaz)', () => {
    const order = { grand_total: 100, payments: [{ amount: 120 }] };
    expect(getTotalDue(order)).toBe(0);
  });

  it('hiç ödeme yoksa grand_total döner', () => {
    const order = { grand_total: 80, payments: [] };
    expect(getTotalDue(order)).toBe(80);
  });
});

// ── isOrderFullyPaid ──────────────────────────────────────────────────────────
describe('isOrderFullyPaid', () => {
  it('tam ödenen sipariş için true döner', () => {
    const order = { grand_total: 100, payments: [{ amount: 100 }] };
    expect(isOrderFullyPaid(order)).toBe(true);
  });

  it('PAYMENT_TOLERANCE (0.02) dahilinde tam ödenmiş sayılır', () => {
    const order = { grand_total: 100, payments: [{ amount: 99.99 }] };
    expect(isOrderFullyPaid(order)).toBe(true);
  });

  it('eksik ödeme için false döner', () => {
    const order = { grand_total: 100, payments: [{ amount: 90 }] };
    expect(isOrderFullyPaid(order)).toBe(false);
  });

  it('hiç ödeme yok → false', () => {
    const order = { grand_total: 100, payments: [] };
    expect(isOrderFullyPaid(order)).toBe(false);
  });

  it('grand_total 0 olan sipariş için false döner (tutarsız veri)', () => {
    const order = { grand_total: 0, payments: [] };
    expect(isOrderFullyPaid(order)).toBe(false);
  });

  it('tolerance sınırı: tam olarak tolerance altında → false', () => {
    // paid = 99.97, total = 100, fark = 0.03 > tolerance
    const order = { grand_total: 100, payments: [{ amount: 99.97 }] };
    expect(isOrderFullyPaid(order)).toBe(false);
  });
});

// ── canCloseOrder ─────────────────────────────────────────────────────────────
describe('canCloseOrder', () => {
  it('id olan ve tam ödenmiş sipariş kapatılabilir', () => {
    const order = { id: 'order-1', grand_total: 100, payments: [{ amount: 100 }] };
    expect(canCloseOrder(order)).toBe(true);
  });

  it('id yok → false', () => {
    const order = { grand_total: 100, payments: [{ amount: 100 }] };
    expect(canCloseOrder(order)).toBe(false);
  });

  it('id var ama ödenmemiş → false', () => {
    const order = { id: 'order-2', grand_total: 100, payments: [{ amount: 50 }] };
    expect(canCloseOrder(order)).toBe(false);
  });

  it('masa context ile current_order_id kullanılabilir', () => {
    const order = { current_order_id: 'order-3', grand_total: 100, payments: [{ amount: 100 }] };
    expect(canCloseOrder(order)).toBe(true);
  });

  it('kapalı sipariş için false döner', () => {
    const order = { id: 'order-closed', status: 'closed', grand_total: 100, payments: [{ amount: 100 }] };
    expect(canCloseOrder(order)).toBe(false);
  });

  it('iptal sipariş için false döner', () => {
    const order = { id: 'order-cancelled', status: 'cancelled', grand_total: 100, payments: [{ amount: 100 }] };
    expect(canCloseOrder(order)).toBe(false);
  });
});

// ── getPaymentStateLabel ──────────────────────────────────────────────────────
describe('getPaymentStateLabel', () => {
  it('tam ödenmiş → paid', () => {
    const order = { grand_total: 100, payments: [{ amount: 100 }] };
    expect(getPaymentStateLabel(order).key).toBe('paid');
    expect(getPaymentStateLabel(order).label).toBe('Ödendi');
  });

  it('kısmi ödeme → partial', () => {
    const order = { grand_total: 100, payments: [{ amount: 50 }] };
    expect(getPaymentStateLabel(order).key).toBe('partial');
    expect(getPaymentStateLabel(order).label).toBe('Kısmi ödendi');
  });

  it('ödeme yok → unpaid', () => {
    const order = { grand_total: 100, payments: [] };
    expect(getPaymentStateLabel(order).key).toBe('unpaid');
    expect(getPaymentStateLabel(order).label).toBe('Ödenmedi');
  });

  it('grand_total 0 → empty', () => {
    const order = { grand_total: 0, payments: [] };
    expect(getPaymentStateLabel(order).key).toBe('empty');
  });
});

// ── getPaymentSummary ─────────────────────────────────────────────────────────
describe('getPaymentSummary', () => {
  it('tüm alanları doğru döner', () => {
    const order = {
      id: 'order-s',
      grand_total: 200,
      payments: [{ amount: 120 }],
    };
    const summary = getPaymentSummary(order);

    expect(summary.total).toBe(200);
    expect(summary.paid).toBe(120);
    expect(summary.due).toBe(80);
    expect(summary.fullyPaid).toBe(false);
    expect(summary.canClose).toBe(false);
    expect(summary.label.key).toBe('partial');
  });

  it('tam ödenmiş sipariş için canClose true', () => {
    const order = {
      id: 'order-full',
      grand_total: 100,
      payments: [{ amount: 100 }],
    };
    const summary = getPaymentSummary(order);

    expect(summary.fullyPaid).toBe(true);
    expect(summary.canClose).toBe(true);
    expect(summary.due).toBe(0);
    expect(summary.label.key).toBe('paid');
  });

  it('PAYMENT_TOLERANCE sabit değeri doğru export edilmiş', () => {
    expect(PAYMENT_TOLERANCE).toBe(0.02);
  });
});
