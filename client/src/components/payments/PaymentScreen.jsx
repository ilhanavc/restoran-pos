import { useState, useEffect } from 'react';
import { useToast } from '../../context/ToastContext.jsx';
import api from '../../services/api.js';
import { formatCurrency } from '../../constants/index.js';
import { X, CreditCard, Banknote, ArrowLeftRight, Check } from 'lucide-react';

export default function PaymentScreen({ order, onClose, onComplete }) {
  const [orderState, setOrderState] = useState(order);
  const [paymentType, setPaymentType] = useState('cash');
  const [cashReceived, setCashReceived] = useState('');
  const [mixedCash, setMixedCash] = useState('');
  const [mixedCard, setMixedCard] = useState('');
  const [discountPercent, setDiscountPercent] = useState('');
  const [discountAmount, setDiscountAmount] = useState('');
  const [customAmount, setCustomAmount] = useState('');
  const [processing, setProcessing] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [lastChange, setLastChange] = useState(0);
  const toast = useToast();

  useEffect(() => {
    setOrderState(order);
  }, [order?.id, order?.grand_total, order?.discount_amount]);

  useEffect(() => {
    if (paymentType === 'mixed' && orderState) {
      const due = orderState.grand_total;
      setMixedCash('');
      setMixedCard(String(due % 1 === 0 ? due : due.toFixed(2)));
    }
  }, [paymentType, orderState?.grand_total]);

  if (!orderState) return null;

  const totalDue = orderState.grand_total;
  const cashVal = parseFloat(cashReceived) || 0;
  const change = paymentType === 'cash' ? Math.max(0, cashVal - totalDue) : 0;
  const payAmount = customAmount ? parseFloat(customAmount) : totalDue;

  const quickCashAmounts = [50, 100, 200, 500, 1000].filter(a => a >= totalDue * 0.5);

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
        cash_received: paymentType === 'cash' ? cashVal : payAmount,
      };
      const result = await api.createPayment(payData);

      setLastChange(paymentType === 'cash' ? change : 0);
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
          </div>

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

          {paymentType === 'cash' && (
            <div style={{ marginBottom: 20 }}>
              <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--text-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
                Alınan Tutar
              </div>
              <input className="input input-lg" type="number" value={cashReceived}
                onChange={e => setCashReceived(e.target.value)}
                placeholder={formatCurrency(totalDue)} style={{ fontSize: 20, fontWeight: 700, textAlign: 'center' }} autoFocus />

              <div style={{ display: 'flex', gap: 6, marginTop: 8, flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCashReceived(String(totalDue))}>
                  Tam
                </button>
                {quickCashAmounts.map(amt => (
                  <button key={amt} type="button" className="btn btn-ghost btn-sm"
                    onClick={() => setCashReceived(String(amt))}>
                    {formatCurrency(amt)}
                  </button>
                ))}
              </div>

              {cashVal > 0 && cashVal >= totalDue && (
                <div style={{
                  marginTop: 12, padding: 12, borderRadius: 'var(--radius-sm)',
                  background: 'var(--success-muted)', textAlign: 'center',
                }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>Para Üstü</div>
                  <div style={{ fontSize: 22, fontWeight: 800, color: 'var(--success)' }}>
                    {formatCurrency(change)}
                  </div>
                </div>
              )}
            </div>
          )}

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
              <button type="button" className="btn btn-ghost" onClick={handleApplyDiscount}>Uygula</button>
            </div>
          </details>
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose}>Vazgeç</button>
          <button type="button" className="btn btn-success btn-lg" onClick={handlePayment} disabled={processing}
            style={{ minWidth: 180 }}>
            <Check size={18} />
            {processing ? 'İşleniyor...' : `${formatCurrency(paymentType === 'mixed' ? totalDue : payAmount)} Ödeme Al`}
          </button>
        </div>
      </div>
    </div>
  );
}
