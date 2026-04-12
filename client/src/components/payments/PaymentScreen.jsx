import { useState, useEffect } from 'react';
import { useToast } from '../../context/ToastContext.jsx';
import api from '../../services/api.js';
import { formatCurrency } from '../../constants/index.js';
import { X, CreditCard, Banknote, ArrowLeftRight, Check } from 'lucide-react';
import SplitPaymentModal from './SplitPaymentModal.jsx';

export default function PaymentScreen({ order, onClose, onComplete }) {
  const [orderState, setOrderState] = useState(order);
  const [paymentType, setPaymentType] = useState('cash');
  const [mixedCash, setMixedCash] = useState('');
  const [mixedCard, setMixedCard] = useState('');
  const [discountPercent, setDiscountPercent] = useState('');
  const [discountAmount, setDiscountAmount] = useState('');
  const [customAmount, setCustomAmount] = useState('');
  const [processing, setProcessing] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [lastChange, setLastChange] = useState(0);
  const [splitOpen, setSplitOpen] = useState(false);
  const toast = useToast();

  useEffect(() => {
    setOrderState(order);
  }, [order?.id, order?.grand_total, order?.discount_amount]);

  useEffect(() => {
    if (paymentType === 'mixed' && orderState) {
      const paid = (orderState.payments || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
      const due = Math.max(0, Math.round(((Number(orderState.grand_total) || 0) - paid) * 100) / 100);
      setMixedCash('');
      setMixedCard(String(due % 1 === 0 ? due : due.toFixed(2)));
    }
  }, [paymentType, orderState?.grand_total, orderState?.payments]);

  if (!orderState) return null;

  const paidTotal = (orderState.payments || []).reduce((sum, p) => sum + (Number(p.amount) || 0), 0);
  const totalDue = Math.max(0, Math.round(((Number(orderState.grand_total) || 0) - paidTotal) * 100) / 100);
  const payAmount = customAmount ? parseFloat(customAmount) : totalDue;

  const handleApplyDiscount = async () => {
    try {
      const data = {};
      if (discountPercent) data.discount_percent = parseFloat(discountPercent);
      else if (discountAmount) data.discount_amount = parseFloat(discountAmount);
      else return;

      await api.applyDiscount(orderState.id, data);
      toast.success('İndirim uygulandı');
      const updated = await api.getOrder(orderState.id);
      setOrderState(updated);
      setDiscountPercent('');
      setDiscountAmount('');
    } catch (err) {
      toast.error(err.message);
    }
  };

  const handleSplitPaymentComplete = async (result) => {
    if (result?.order?.status === 'closed') {
      setLastChange(Number(result?.payment?.change_amount) || 0);
      setCompleted(true);
      setSplitOpen(false);
      setTimeout(() => {
        onComplete?.(result);
      }, 1200);
      return;
    }
    try {
      const updated = await api.getOrder(orderState.id);
      setOrderState(updated);
    } catch {
      // Split modal already refreshed its own state; keep the current payment screen usable.
    }
  };

  const handlePayment = async () => {
    setProcessing(true);
    try {
      const oid = orderState.id;

      if (paymentType === 'mixed') {
        const cashP = parseFloat(mixedCash) || 0;
        const cardP = parseFloat(mixedCard) || 0;
        if (cashP <= 0 || cardP <= 0) {
          toast.error('Karışık ödemede nakit ve kart tutarı sıfırdan büyük olmalıdır');
          return;
        }
        if (Math.abs(cashP + cardP - totalDue) > 0.02) {
          toast.error('Nakit ve kart tutarlarının toplamı ödenecek tutara eşit olmalıdır');
          return;
        }
        await api.createPayment({
          order_id: oid,
          payment_type: 'cash',
          amount: cashP,
          cash_received: cashP,
        });
        const result = await api.createPayment({
          order_id: oid,
          payment_type: 'card',
          amount: cardP,
          cash_received: cardP,
        });
        setLastChange(0);
        setCompleted(true);
        toast.success('Ödeme alındı');
        setTimeout(() => onComplete?.(result), 1500);
        return;
      }

      const payData = {
        order_id: oid,
        payment_type: paymentType,
        amount: payAmount,
        cash_received: payAmount,
      };
      const result = await api.createPayment(payData);

      setLastChange(0);
      setCompleted(true);
      toast.success('Ödeme alındı');

      setTimeout(() => {
        onComplete?.(result);
      }, 1500);
    } catch (err) {
      toast.error(err.message);
    } finally {
      setProcessing(false);
    }
  };

  if (completed) {
    return (
      <div className="modal-overlay">
        <div className="modal modal-sm" style={{ textAlign: 'center', padding: 40 }}>
          <div style={{
            width: 64, height: 64, borderRadius: '50%',
            background: 'var(--success-muted)', display: 'inline-flex',
            alignItems: 'center', justifyContent: 'center', marginBottom: 16,
          }}>
            <Check size={32} color="var(--success)" />
          </div>
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>Ödeme Alındı</h2>
          {lastChange > 0 && (
            <div style={{ fontSize: 24, fontWeight: 800, color: 'var(--success)' }}>
              Para Üstü: {formatCurrency(lastChange)}
            </div>
          )}
        </div>
      </div>
    );
  }

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-md" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Ödeme Al</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>

        <div className="modal-body">
          <div style={{
            background: 'var(--bg-tertiary)', borderRadius: 'var(--radius-sm)',
            padding: 16, marginBottom: 20, textAlign: 'center',
          }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Ödenecek tutar
            </div>
            <div style={{ fontSize: 32, fontWeight: 800, letterSpacing: '-0.03em', marginTop: 4 }}>
              {formatCurrency(totalDue)}
            </div>
            {orderState.discount_amount > 0 && (
              <div style={{ fontSize: 12, color: 'var(--danger)', marginTop: 4 }}>
                İndirim: -{formatCurrency(orderState.discount_amount)}
              </div>
            )}
            {paidTotal > 0 && (
              <div style={{ fontSize: 12, color: 'var(--success)', marginTop: 4 }}>
                Ödenen: {formatCurrency(paidTotal)} · Sipariş: {formatCurrency(orderState.grand_total)}
              </div>
            )}
          </div>

          <button
            type="button"
            className="btn btn-primary btn-block btn-lg"
            onClick={() => setSplitOpen(true)}
            disabled={totalDue <= 0}
            style={{ marginBottom: 20 }}
          >
            <ArrowLeftRight size={18} />
            Ayrı ayrı öde
          </button>

          <div style={{ marginBottom: 20 }}>
            <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
              Ödeme Tipi
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              {[
                { key: 'cash', label: 'Nakit', icon: Banknote },
                { key: 'card', label: 'Kredi Kartı', icon: CreditCard },
                { key: 'mixed', label: 'Karışık', icon: ArrowLeftRight },
              ].map(pt => (
                <button key={pt.key}
                  className={`btn ${paymentType === pt.key ? 'btn-primary' : 'btn-ghost'}`}
                  style={{ flex: 1 }}
                  type="button"
                  onClick={() => setPaymentType(pt.key)}>
                  <pt.icon size={16} /> {pt.label}
                </button>
              ))}
            </div>
          </div>

          {paymentType === 'mixed' && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Nakit ve kart tutarları (toplam = ödenecek)
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Nakit</label>
                  <input className="input input-lg" type="number" value={mixedCash}
                    onChange={e => setMixedCash(e.target.value)}
                    placeholder="0" style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', marginTop: 4 }} />
                </div>
                <div>
                  <label style={{ fontSize: 11, color: 'var(--text-muted)' }}>Kart</label>
                  <input className="input input-lg" type="number" value={mixedCard}
                    onChange={e => setMixedCard(e.target.value)}
                    placeholder="0" style={{ fontSize: 18, fontWeight: 700, textAlign: 'center', marginTop: 4 }} />
                </div>
              </div>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8, textAlign: 'center' }}>
                Toplam: {formatCurrency((parseFloat(mixedCash) || 0) + (parseFloat(mixedCard) || 0))}
                {' · '}
                {Math.abs((parseFloat(mixedCash) || 0) + (parseFloat(mixedCard) || 0) - totalDue) <= 0.02 ? (
                  <span style={{ color: 'var(--success)' }}>Tamam</span>
                ) : (
                  <span style={{ color: 'var(--warning)' }}>Hedef: {formatCurrency(totalDue)}</span>
                )}
              </div>
            </div>
          )}

          <details style={{ marginBottom: 12 }}>
            <summary style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', cursor: 'pointer', marginBottom: 8 }}>
              İndirim Uygula
            </summary>
            <div style={{ display: 'flex', gap: 8, marginTop: 8 }}>
              <input className="input" type="number" placeholder="% İndirim"
                value={discountPercent} onChange={e => { setDiscountPercent(e.target.value); setDiscountAmount(''); }}
                style={{ flex: 1 }} />
              <input className="input" type="number" placeholder="₺ Tutar"
                value={discountAmount} onChange={e => { setDiscountAmount(e.target.value); setDiscountPercent(''); }}
                style={{ flex: 1 }} />
              <button type="button" className="btn btn-ghost" onClick={handleApplyDiscount} disabled={paidTotal > 0}>Uygula</button>
            </div>
            {paidTotal > 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 8 }}>
                Ödeme alındıktan sonra indirim değiştirilemez.
              </div>
            )}
          </details>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Vazgeç</button>
          <button type="button" className="btn btn-success btn-lg" onClick={handlePayment} disabled={processing || totalDue <= 0}
            style={{ minWidth: 180 }}>
            <Check size={18} />
            {processing ? 'İşleniyor...' : `${formatCurrency(paymentType === 'mixed' ? totalDue : payAmount)} Ödeme Al`}
          </button>
        </div>
      </div>
      {splitOpen && (
        <SplitPaymentModal
          orderId={orderState.id}
          onClose={() => setSplitOpen(false)}
          onPaymentComplete={handleSplitPaymentComplete}
        />
      )}
    </div>
  );
}
