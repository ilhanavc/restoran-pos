import { useEffect, useState } from 'react';
import { Banknote, Check, CreditCard, X } from 'lucide-react';
import api from '../../services/api.js';
import { formatCurrency } from '../../constants/index.js';
import { useToast } from '../../context/ToastContext.jsx';

const operationTypes = [
  { key: 'pay', label: 'Öde', helper: 'Masa açık kalır', closeOrder: false, printReceipt: false },
  { key: 'pay-close', label: 'Öde & Kapat', helper: 'Tahsil et ve masayı boşalt', closeOrder: true, printReceipt: false },
  { key: 'pay-print', label: 'Öde & Yazdır', helper: 'Fiş gönder, masa açık kalsın', closeOrder: false, printReceipt: true },
  { key: 'pay-print-close', label: 'Öde, Yazdır ve Kapat', helper: 'Fiş ve masa kapanışı', closeOrder: true, printReceipt: true },
];

const paymentTypes = [
  { key: 'cash', label: 'Nakit', icon: Banknote },
  { key: 'card', label: 'Kredi Kartı', icon: CreditCard },
];

function round2(value) {
  return Math.round((Number(value) || 0) * 100) / 100;
}

export default function QuickPaymentModal({ order, onClose, onComplete }) {
  const toast = useToast();
  const [orderState, setOrderState] = useState(order);
  const [operationType, setOperationType] = useState('pay');
  const [processingType, setProcessingType] = useState(null);
  const [completed, setCompleted] = useState(false);

  useEffect(() => {
    setOrderState(order);
  }, [order?.id, order?.grand_total, order?.payments]);

  if (!orderState) return null;

  const paidTotal = (orderState.payments || []).reduce((sum, payment) => sum + (Number(payment.amount) || 0), 0);
  const totalDue = round2(Math.max(0, (Number(orderState.grand_total) || 0) - paidTotal));
  const selectedOperation = operationTypes.find((operation) => operation.key === operationType) || operationTypes[0];

  const handlePayment = async (paymentType) => {
    if (processingType) return;
    setProcessingType(paymentType);
    try {
      if (totalDue <= 0.02) {
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
              Tek hamlede tahsilat
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
          </div>

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
                  disabled={processingType || totalDue <= 0.02}
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
        </div>
      </div>
    </div>
  );
}
