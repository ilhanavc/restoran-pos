import { useEffect, useState } from 'react';
import { Banknote, Check, CreditCard, X } from 'lucide-react';
import api from '../../services/api.js';
import { formatCurrency } from '../../constants/index.js';
import { useToast } from '../../context/ToastContext.jsx';
import { getTotalDue, isOrderFullyPaid } from '../../utils/orderPaymentState.js';

const operationTypes = [
  { key: 'pay', label: 'Öde', helper: 'Masa açık kalır', closeOrder: false, printReceipt: false },
  { key: 'pay-close', label: 'Öde & Kapat', helper: 'Ödemeyi al ve masayı boşalt', closeOrder: true, printReceipt: false },
  { key: 'pay-print', label: 'Öde & Yazdır', helper: 'Fiş gönder, masa açık kalsın', closeOrder: false, printReceipt: true },
  { key: 'pay-print-close', label: 'Öde, Yazdır ve Kapat', helper: 'Fiş ve masa kapanışı', closeOrder: true, printReceipt: true },
];

const paymentTypes = [
  { key: 'cash', label: 'Nakit', icon: Banknote },
  { key: 'card', label: 'Kredi Kartı', icon: CreditCard },
];

export default function QuickPaymentModal({ order, onClose, onComplete }) {
  const toast = useToast();
  const [orderState, setOrderState] = useState(order);
  const [operationType, setOperationType] = useState('pay');
  const [processingType, setProcessingType] = useState(null);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    setOrderState(order);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: sync only on specific order fields to avoid reset loop on unrelated re-renders
  }, [order?.id, order?.grand_total, order?.payments]);

  if (!orderState) return null;

  const totalDue = getTotalDue(orderState);
  const selectedOperation = operationTypes.find((operation) => operation.key === operationType) || operationTypes[0];
  const isFullyPaid = isOrderFullyPaid(orderState);

  const handleClosePaidOrder = async () => {
    if (processingType) return;
    setProcessingType('close-paid');
    try {
      await api.updateOrderStatus(orderState.id, 'closed');
      setCompleted(true);
      toast.success(orderState.table_id ? 'Masa kapatıldı' : 'Sipariş kapatıldı');
      setTimeout(() => onComplete?.({ closed: true }), 1000);
    } catch (err) {
      toast.error(err.message || 'Sipariş kapatılamadı');
    } finally {
      setProcessingType(null);
    }
  };

  const executePayment = async (paymentType, printerId = null) => {
    if (processingType) return;
    setProcessingType(paymentType);
    try {
      if (isFullyPaid) {
        toast.info('Bu siparişin ödenecek bakiyesi yok');
        return;
      }

      const result = await api.createPayment({
        order_id: orderState.id,
        payment_type: paymentType,
        amount: totalDue,
        cash_received: totalDue,
        close_order: selectedOperation.closeOrder,
        print_receipt: selectedOperation.printReceipt,
        print_printer_id: selectedOperation.printReceipt ? printerId : null,
      });

      setCompleted(true);
      toast.success(selectedOperation.closeOrder ? 'Ödeme alındı ve masa kapatıldı' : 'Ödeme alındı');
      setTimeout(() => onComplete?.(result), 1000);
    } catch (err) {
      toast.error(err.message || 'Ödeme alınamadı');
    } finally {
      setProcessingType(null);
    }
  };

  const handlePayment = async (paymentType) => {
    await executePayment(paymentType, null);
  };

  if (completed) {
    return (
      <div className="modal-overlay">
        <div className="modal modal-sm" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{
            width: 64,
            height: 64,
            borderRadius: '50%',
            background: 'var(--success-muted)',
            display: 'inline-flex',
            alignItems: 'center',
            justifyContent: 'center',
            marginBottom: 16,
          }}>
            <Check size={32} color="var(--success)" />
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 800, margin: 0 }}>İşlem Tamamlandı</h2>
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={(event) => event.stopPropagation()} style={{ maxWidth: 560 }}>
        <div className="modal-header">
          <div>
            <h2>Hızlı Öde</h2>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              Tek hamlede ödeme al
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} title="Kapat">
            <X size={16} />
          </button>
        </div>

        <div className="modal-body">
          <div style={{
            background: 'var(--bg-tertiary)',
            border: '1px solid var(--border)',
            borderRadius: 8,
            padding: 16,
            textAlign: 'center',
            marginBottom: 18,
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase' }}>
              Ödenecek Toplam
            </div>
            <div style={{ fontSize: 34, fontWeight: 850, marginTop: 6 }}>
              {formatCurrency(totalDue)}
            </div>
            {isFullyPaid && (
              <div style={{ fontSize: 12, color: 'var(--success)', fontWeight: 800, marginTop: 8 }}>
                Hesap tamamen ödendi. Masayı kapatabilirsiniz.
              </div>
            )}
          </div>

          {!isFullyPaid && (
            <>
              <div style={{ fontSize: 11, fontWeight: 800, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase' }}>
                İşlem Tipi Seçimi
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8, marginBottom: 20 }}>
                {operationTypes.map((operation) => {
                  const selected = operationType === operation.key;
                  return (
                    <button
                      key={operation.key}
                      type="button"
                      onClick={() => setOperationType(operation.key)}
                      aria-pressed={selected}
                      style={{
                        minHeight: 74,
                        borderRadius: 8,
                        border: selected ? '1.5px solid var(--accent)' : '1px solid var(--border)',
                        background: selected ? 'var(--accent-muted)' : 'var(--bg-tertiary)',
                        color: 'var(--text-primary)',
                        cursor: 'pointer',
                        padding: '11px 12px',
                        textAlign: 'left',
                        fontFamily: 'inherit',
                        boxShadow: selected ? 'inset 0 0 0 1px var(--accent-muted)' : 'none',
                        transition: 'border-color var(--transition-fast), background var(--transition-fast), opacity var(--transition-fast)',
                      }}
                      onMouseEnter={(event) => {
                        if (!selected) event.currentTarget.style.borderColor = 'var(--border-light)';
                      }}
                      onMouseLeave={(event) => {
                        if (!selected) event.currentTarget.style.borderColor = 'var(--border)';
                      }}
                    >
                      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 8 }}>
                        <strong style={{ fontSize: 13, lineHeight: 1.2 }}>{operation.label}</strong>
                        <span
                          aria-hidden="true"
                          style={{
                            width: 18,
                            height: 18,
                            borderRadius: '50%',
                            border: selected ? '5px solid var(--accent)' : '1px solid var(--border-light)',
                            background: selected ? 'var(--text-on-accent)' : 'transparent',
                            flexShrink: 0,
                          }}
                        />
                      </div>
                      <div style={{ fontSize: 11, color: selected ? 'var(--text-primary)' : 'var(--text-muted)', marginTop: 7, lineHeight: 1.35 }}>
                        {operation.helper}
                      </div>
                    </button>
                  );
                })}
              </div>
            </>
          )}

          {isFullyPaid ? (
            <button
              type="button"
              className="btn btn-primary"
              onClick={handleClosePaidOrder}
              disabled={!!processingType}
              style={{ width: '100%', minHeight: 54, justifyContent: 'center', fontSize: 15, fontWeight: 800 }}
            >
              {processingType === 'close-paid' ? 'Kapatılıyor...' : (orderState.table_id ? 'Masayı Kapat' : 'Siparişi Kapat')}
            </button>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {paymentTypes.map((type) => {
                const Icon = type.icon;
                const busy = processingType === type.key;
                return (
                  <button
                    key={type.key}
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => handlePayment(type.key)}
                    disabled={!!processingType}
                    style={{
                      minHeight: 112,
                      flexDirection: 'column',
                      justifyContent: 'center',
                      gap: 10,
                      fontSize: 15,
                      fontWeight: 800,
                    }}
                  >
                    <Icon size={34} color="var(--accent)" />
                    {busy ? 'İşleniyor...' : type.label}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
