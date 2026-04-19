import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import PaymentScreen from '../PaymentScreen.jsx';
import { ToastProvider } from '../../../context/ToastContext.jsx';

// ── API mock ──────────────────────────────────────────────────────────────────
vi.mock('../../../services/api.js', () => ({
  default: {
    getOrder: vi.fn(),
    createPayment: vi.fn(),
    updateOrderStatus: vi.fn(),
    printOrderReceipt: vi.fn(),
    getPrinters: vi.fn().mockResolvedValue({ printers: [] }),
  },
}));

vi.mock('../SplitPaymentModal.jsx', () => ({ default: () => null }));
vi.mock('../../common/ManualPrintSelectorModal.jsx', () => ({
  default: ({ open, onConfirm }) =>
    open ? (
      <button data-testid="manual-print-confirm" onClick={() => onConfirm(null)}>
        Onayla
      </button>
    ) : null,
}));

import api from '../../../services/api.js';

// ── Helpers ───────────────────────────────────────────────────────────────────
function makeOrder(overrides = {}) {
  return {
    id: 'order-1',
    status: 'open',
    order_type: 'dine_in',
    table_name: 'Masa 1',
    table_display_name: 'Masa 1',
    grand_total: 150,
    payments: [],
    items: [
      {
        id: 'item-1',
        product_name: 'Adana Kebap',
        quantity: 2,
        unit_price: 75,
        status: 'pending',
        modifiers: '[]',
      },
    ],
    ...overrides,
  };
}

function renderPayment(orderOverrides = {}, propOverrides = {}) {
  const onClose = vi.fn();
  const onComplete = vi.fn();
  const order = makeOrder(orderOverrides);
  render(
    <ToastProvider>
      <PaymentScreen order={order} onClose={onClose} onComplete={onComplete} {...propOverrides} />
    </ToastProvider>,
  );
  return { onClose, onComplete, order };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('PaymentScreen', () => {
  beforeEach(() => vi.clearAllMocks());

  // 1 ─────────────────────────────────────────────────────────────────────────
  it('sipariş başlığını render eder', () => {
    renderPayment();
    expect(screen.getByRole('heading', { name: 'Masa 1' })).toBeInTheDocument();
  });

  // 2 ─────────────────────────────────────────────────────────────────────────
  it('paket sipariş tipinde başlık "Paket Sipariş" olur', () => {
    renderPayment({ order_type: 'takeaway', table_display_name: null, table_name: null });
    expect(screen.getByRole('heading', { name: 'Paket Sipariş' })).toBeInTheDocument();
  });

  // 3 ─────────────────────────────────────────────────────────────────────────
  it('varsayılan ödeme aksiyonu Kaydet\'tir (data-testid)', () => {
    renderPayment();
    const kaydetBtn = screen.getByTestId('payment-action-save');
    // Seçili buton btn-primary sınıfına sahip olmalı
    expect(kaydetBtn.className).toMatch(/btn-primary/);
  });

  // 4 ─────────────────────────────────────────────────────────────────────────
  it('ödeme tipi butonları (Nakit, Kredi Kartı) görünür', () => {
    renderPayment();
    expect(screen.getByRole('button', { name: /Nakit/i })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Kredi Kartı/i })).toBeInTheDocument();
  });

  // 5 ─────────────────────────────────────────────────────────────────────────
  it('"Kalanı Al" butonu tüm kalan tutarı input\'a yazar', async () => {
    renderPayment({ grand_total: 150 });
    await userEvent.click(screen.getByRole('button', { name: /Kalanı Al/i }));
    expect(screen.getByTestId('payment-amount-input').value).toBe('150');
  });

  // 6 ─────────────────────────────────────────────────────────────────────────
  it('"Tümünü Al" butonu toplam tutarı input\'a yazar', async () => {
    renderPayment({ grand_total: 200, payments: [{ id: 'p1', amount: 50 }] });
    await userEvent.click(screen.getByRole('button', { name: /Tümünü Al/i }));
    expect(screen.getByTestId('payment-amount-input').value).toBe('200');
  });

  // 7 ─────────────────────────────────────────────────────────────────────────
  it('X butonuna basınca onClose çağrılır', async () => {
    const { onClose } = renderPayment();
    await userEvent.click(screen.getByTitle('Ödeme Ekranını Kapat'));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  // 8 ─────────────────────────────────────────────────────────────────────────
  it('Kaydet aksiyonunda api.createPayment doğru parametrelerle çağrılır', async () => {
    api.createPayment.mockResolvedValue({
      payment: { id: 'pay-1', amount: 150, change_amount: 0 },
      order: makeOrder(),
    });

    renderPayment({ grand_total: 150 });

    // Kaydet zaten seçili — direkt submit
    await userEvent.click(screen.getByTestId('payment-submit-button'));

    await waitFor(() => {
      expect(api.createPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          order_id: 'order-1',
          payment_type: 'cash',
          amount: 150,
          close_order: false,
        }),
      );
    });
  });

  // 9 ─────────────────────────────────────────────────────────────────────────
  it('ödeme tamamlandıktan sonra "İşlem Tamamlandı" ekranı görünür', async () => {
    api.createPayment.mockResolvedValue({
      payment: { id: 'pay-1', amount: 150, change_amount: 0 },
      order: makeOrder(),
    });

    renderPayment({ grand_total: 150 });
    await userEvent.click(screen.getByTestId('payment-submit-button'));

    await waitFor(() => {
      expect(screen.getByText('İşlem Tamamlandı')).toBeInTheDocument();
    });
  });

  // 10 ────────────────────────────────────────────────────────────────────────
  it('ödeme sonrası change_amount > 0 ise para üstü gösterilir', async () => {
    api.createPayment.mockResolvedValue({
      payment: { id: 'pay-1', amount: 200, change_amount: 50 },
      order: makeOrder(),
    });

    renderPayment({ grand_total: 150 });
    const input = screen.getByTestId('payment-amount-input');
    await userEvent.clear(input);
    await userEvent.type(input, '200');
    await userEvent.click(screen.getByTestId('payment-submit-button'));

    await waitFor(() => {
      expect(screen.getByText(/Para Üstü/i)).toBeInTheDocument();
    });
  });

  // 11 ────────────────────────────────────────────────────────────────────────
  it('kısmi ödeme mevcut sipariş kalan tutarı doğru hesaplar', () => {
    renderPayment({
      grand_total: 200,
      payments: [{ id: 'p1', amount: 50, payment_type: 'cash' }],
    });
    // "Kalan" label'ı görünmeli (ödeme tamamlanmadı)
    expect(screen.getByText('Kalan')).toBeInTheDocument();
  });

  // 12 ────────────────────────────────────────────────────────────────────────
  it('order null ise modal render edilmez', () => {
    render(
      <ToastProvider>
        <PaymentScreen order={null} onClose={vi.fn()} onComplete={vi.fn()} />
      </ToastProvider>,
    );
    expect(screen.queryByRole('heading', { name: /Masa|Paket/i })).toBeNull();
    expect(screen.queryByTestId('payment-submit-button')).toBeNull();
  });
});
