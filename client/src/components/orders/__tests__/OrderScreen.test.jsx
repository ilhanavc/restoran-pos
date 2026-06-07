import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter } from 'react-router-dom';
import OrderScreen from '../OrderScreen.jsx';
import { ToastProvider } from '../../../context/ToastContext.jsx';

vi.mock('../../../context/AuthContext.jsx', () => ({
  useAuth: () => ({ user: { id: 'user-1', role: 'admin' }, hasRole: () => true }),
}));

// ── API mock ──────────────────────────────────────────────────────────────────
vi.mock('../../../services/api.js', () => ({
  default: {
    getCategories: vi.fn(),
    getProducts: vi.fn(),
    getOrder: vi.fn(),
    createOrder: vi.fn(),
    addOrderItems: vi.fn(),
    updateOrderItem: vi.fn(),
    getTables: vi.fn().mockResolvedValue({ tables: [] }),
    getCustomers: vi.fn().mockResolvedValue([]),
    getProduct: vi.fn(),
    getModifiers: vi.fn().mockResolvedValue([]),
    patchOrderCustomer: vi.fn(),
    createCustomer: vi.fn(),
    transferTable: vi.fn(),
  },
}));

// ── Sub-component mocks (heavy, not under test) ───────────────────────────────
vi.mock('../OrderProductDetailModal.jsx', () => ({ default: () => null }));
vi.mock('../../common/ConfirmDialog.jsx', () => ({ default: () => null }));

import api from '../../../services/api.js';

// ── Test data ─────────────────────────────────────────────────────────────────
const CATEGORIES = [
  { id: 'cat-1', name: 'Izgara', icon: '🔥', is_active: 1, sort_order: 0 },
  { id: 'cat-2', name: 'İçecekler', icon: '🥤', is_active: 1, sort_order: 1 },
];

const PRODUCTS = [
  { id: 'prod-1', name: 'Adana Kebap', price: 150, category_id: 'cat-1', is_active: 1, has_modifiers: 0, has_portions: 0, has_attributes: 0 },
  { id: 'prod-2', name: 'Şiş Kebap', price: 130, category_id: 'cat-1', is_active: 1, has_modifiers: 0, has_portions: 0, has_attributes: 0 },
];

// ── Wrapper ───────────────────────────────────────────────────────────────────
function Wrapper({ children }) {
  return (
    <MemoryRouter>
      <ToastProvider>
        {children}
      </ToastProvider>
    </MemoryRouter>
  );
}

function renderOrder(props = {}) {
  const onBack = vi.fn();
  const onPayment = vi.fn();
  const onQuickPayment = vi.fn();
  const onNavigateToTables = vi.fn();

  render(
    <Wrapper>
      <OrderScreen
        table={{ id: 'table-1', name: 'Masa 1', current_order_id: null }}
        orderType="dine_in"
        onBack={onBack}
        onPayment={onPayment}
        onQuickPayment={onQuickPayment}
        onNavigateToTables={onNavigateToTables}
        {...props}
      />
    </Wrapper>,
  );
  return { onBack, onPayment, onQuickPayment };
}

// ── Tests ─────────────────────────────────────────────────────────────────────
describe('OrderScreen', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    api.getCategories.mockResolvedValue(CATEGORIES);
    api.getProducts.mockResolvedValue(PRODUCTS);
    api.getProduct.mockResolvedValue(PRODUCTS[0]);
  });

  // 1 ─────────────────────────────────────────────────────────────────────────
  it('kategoriler yüklendikten sonra kategori butonları görünür', async () => {
    renderOrder();
    await waitFor(() => {
      expect(screen.getByRole('button', { name: /Izgara/i })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /İçecekler/i })).toBeInTheDocument();
    });
  });

  // 2 ─────────────────────────────────────────────────────────────────────────
  it('kategoriye tıklayınca ürünler yüklenir ve görünür', async () => {
    renderOrder();
    await waitFor(() => screen.getByRole('button', { name: /Izgara/i }));

    await userEvent.click(screen.getByRole('button', { name: /Izgara/i }));

    await waitFor(() => {
      expect(api.getProducts).toHaveBeenCalledWith(
        expect.objectContaining({ category_id: 'cat-1' }),
      );
      expect(screen.getByTestId('product-card-prod-1')).toBeInTheDocument();
      expect(screen.getByTestId('product-card-prod-2')).toBeInTheDocument();
    });
  });

  // 3 ─────────────────────────────────────────────────────────────────────────
  it('ürün kartına tıklayınca sepete eklenir (ürün adı en az 2 kez görünür)', async () => {
    api.getProduct.mockResolvedValue({ ...PRODUCTS[0], has_modifiers: 0, has_attributes: 0 });
    renderOrder();
    await waitFor(() => screen.getByRole('button', { name: /Izgara/i }));
    await userEvent.click(screen.getByRole('button', { name: /Izgara/i }));
    await waitFor(() => screen.getByTestId('product-card-prod-1'));

    await userEvent.click(screen.getByTestId('product-card-prod-1'));

    // Ürün hem grid'de hem sepette görünür
    await waitFor(() => {
      expect(screen.getAllByText('Adana Kebap').length).toBeGreaterThanOrEqual(2);
    });
  });

  // 4 ─────────────────────────────────────────────────────────────────────────
  it('aynı ürüne iki kez tıklanınca miktar 2 olur', async () => {
    api.getProduct.mockResolvedValue({ ...PRODUCTS[0], has_modifiers: 0, has_attributes: 0 });
    renderOrder();
    await waitFor(() => screen.getByRole('button', { name: /Izgara/i }));
    await userEvent.click(screen.getByRole('button', { name: /Izgara/i }));
    await waitFor(() => screen.getByTestId('product-card-prod-1'));

    // İki kez tıkla → addItemToCart miktarı 1'den 2'ye artırır
    await userEvent.click(screen.getByTestId('product-card-prod-1'));
    await userEvent.click(screen.getByTestId('product-card-prod-1'));

    await waitFor(() => {
      // Miktar span'ı ya da grid badge'i "2" göstermeli
      const twos = screen.getAllByText('2');
      expect(twos.length).toBeGreaterThan(0);
    });
  });

  // 5 ─────────────────────────────────────────────────────────────────────────
  it('ürün eklenince sipariş toplamı güncellenir', async () => {
    api.getProduct.mockResolvedValue({ ...PRODUCTS[0], has_modifiers: 0, has_attributes: 0 });
    renderOrder();
    await waitFor(() => screen.getByRole('button', { name: /Izgara/i }));
    await userEvent.click(screen.getByRole('button', { name: /Izgara/i }));
    await waitFor(() => screen.getByTestId('product-card-prod-1'));
    await userEvent.click(screen.getByTestId('product-card-prod-1'));

    await waitFor(() => {
      // 150 TL ürün eklendiğinde toplam göstergede görünmeli
      expect(screen.getAllByText(/150/).length).toBeGreaterThan(0);
    });
  });

  // 6 ─────────────────────────────────────────────────────────────────────────
  it('sepet boşken order-save-button görünmez', async () => {
    renderOrder();
    await waitFor(() => screen.getByRole('button', { name: /Izgara/i }));
    // Sepet boşken kaydet butonu olmamalı
    expect(screen.queryByTestId('order-save-button')).toBeNull();
  });

  // 7 ─────────────────────────────────────────────────────────────────────────
  it('geri butonuna basınca onBack çağrılır', async () => {
    const { onBack } = renderOrder();
    await waitFor(() => screen.getByRole('button', { name: /Izgara/i }));
    const backBtn = screen.getByTitle('Masalar ekranına dön');
    await userEvent.click(backBtn);
    expect(onBack).toHaveBeenCalled();
  });

  // 8 ─────────────────────────────────────────────────────────────────────────
  it('ürün ekleyip kaydet\'e basınca api.createOrder çağrılır', async () => {
    api.getProduct.mockResolvedValue({ ...PRODUCTS[0], has_modifiers: 0, has_attributes: 0 });
    api.createOrder.mockResolvedValue({ id: 'new-order-1', status: 'draft', items: [], grand_total: 150 });
    api.getOrder.mockResolvedValue({ id: 'new-order-1', status: 'draft', items: [], grand_total: 150, payments: [] });

    renderOrder();
    await waitFor(() => screen.getByRole('button', { name: /Izgara/i }));
    await userEvent.click(screen.getByRole('button', { name: /Izgara/i }));
    await waitFor(() => screen.getByTestId('product-card-prod-1'));
    await userEvent.click(screen.getByTestId('product-card-prod-1'));
    await waitFor(() => screen.getByTestId('order-save-button'));

    await userEvent.click(screen.getByTestId('order-save-button'));

    await waitFor(() => {
      expect(api.createOrder).toHaveBeenCalled();
    });
  });

  // 9 ─────────────────────────────────────────────────────────────────────────
  it('mevcut sipariş yüklenince sipariş kalemleri görünür', async () => {
    const existingOrder = {
      id: 'ord-existing',
      status: 'open',
      order_type: 'dine_in',
      grand_total: 300,
      payments: [],
      items: [
        { id: 'oi-1', product_id: 'prod-1', product_name: 'Izgara Köfte', quantity: 2, unit_price: 150, status: 'pending', modifiers: '[]' },
      ],
    };
    api.getOrder.mockResolvedValue(existingOrder);

    renderOrder({ existingOrderId: 'ord-existing' });

    await waitFor(() => {
      expect(screen.getByText('Izgara Köfte')).toBeInTheDocument();
    });
  });

  // 10 ────────────────────────────────────────────────────────────────────────
  it('mevcut ödeme yapılmış sipariş için ödeme butonu görünür', async () => {
    const existingOrder = {
      id: 'ord-existing',
      status: 'open',
      order_type: 'dine_in',
      grand_total: 150,
      payments: [],
      items: [
        { id: 'oi-1', product_id: 'prod-1', product_name: 'Adana Kebap', quantity: 1, unit_price: 150, status: 'pending', modifiers: '[]' },
      ],
    };
    api.getOrder.mockResolvedValue(existingOrder);

    renderOrder({ existingOrderId: 'ord-existing' });

    await waitFor(() => {
      expect(screen.getByTestId('order-payment-button')).toBeInTheDocument();
    });
  });
});
