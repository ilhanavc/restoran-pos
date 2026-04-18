import { useState, useEffect } from 'react';
import { useToast } from '../../context/ToastContext.jsx';
import api from '../../services/api.js';
import { formatCurrency } from '../../constants/index.js';
import { X, CreditCard, Banknote, ArrowLeftRight, Check, Printer, Save } from 'lucide-react';
import SplitPaymentModal from './SplitPaymentModal.jsx';
import { getOrderTotal, getPaidTotal, getTotalDue, isOrderFullyPaid, roundMoney } from '../../utils/orderPaymentState.js';
import { getPrintErrorAction } from '../../utils/printErrorMessages.js';
import ManualPrintSelectorModal from '../common/ManualPrintSelectorModal.jsx';

const paymentTypes = [
  { key: 'cash', label: 'Nakit', icon: Banknote },
  { key: 'card', label: 'Kredi Kartı', icon: CreditCard },
];

const paymentActions = [
  { key: 'save', label: 'Kaydet', closeOrder: false, printReceipt: false, icon: Save, tone: 'primary' },
  { key: 'pay-close', label: 'Öde ve Kapat', closeOrder: true, printReceipt: false, icon: Check, tone: 'success' },
  { key: 'pay-print', label: 'Öde ve Yazdır', closeOrder: false, printReceipt: true, icon: Printer, tone: 'secondary' },
  { key: 'pay-print-close', label: 'Öde, Yazdır ve Kapat', closeOrder: true, printReceipt: true, icon: Printer, tone: 'secondary' },
];

function inputValueForAmount(amount) {
  return amount % 1 === 0 ? String(amount) : amount.toFixed(2);
}

function parseModifiers(value) {
  try {
    const parsed = JSON.parse(value || '[]');
    return Array.isArray(parsed) ? parsed : [];
  } catch {
    return [];
  }
}

function paymentActionClass(action, selected) {
  if (!selected) return 'btn btn-ghost';
  if (action.tone === 'success') return 'btn btn-success';
  if (action.tone === 'primary') return 'btn btn-primary';
  return 'btn btn-ghost';
}

export default function PaymentScreen({ order, onClose, onComplete }) {
  const [orderState, setOrderState] = useState(order);
  const [paymentType, setPaymentType] = useState('cash');
  const [paymentAction, setPaymentAction] = useState('save');
  const [amountInput, setAmountInput] = useState('');
  const [tipInput, setTipInput] = useState('');
  const [processing, setProcessing] = useState(false);
  const [completed, setCompleted] = useState(false);
  const [lastChange, setLastChange] = useState(0);
  const [splitOpen, setSplitOpen] = useState(false);
  const [manualPrintDialog, setManualPrintDialog] = useState({ open: false, kind: 'print-only' });
  const toast = useToast();

  useEffect(() => {
    setOrderState(order);
  // eslint-disable-next-line react-hooks/exhaustive-deps -- intentional: sync only on specific order fields to avoid reset loop on unrelated re-renders
  }, [order?.id, order?.grand_total, order?.payments]);

  if (!orderState) return null;

  const paidTotal = getPaidTotal(orderState);
  const orderTotal = getOrderTotal(orderState);
  const totalDue = getTotalDue(orderState);
  const isFullyPaid = isOrderFullyPaid(orderState);
  const selectedAction = paymentActions.find((action) => action.key === paymentAction) || paymentActions[0];
  const requestedAmount = amountInput ? Number(amountInput) : totalDue;
  const payAmount = roundMoney(Math.min(Math.max(0, requestedAmount), totalDue));
  const tipAmount = roundMoney(Math.max(0, Number(tipInput || 0)));
  const activeItems = (orderState.items || []).filter((item) => item.status !== 'cancelled');
  const contextParts = [
    orderState.waiter_name || orderState.user_name ? `Garson: ${orderState.waiter_name || orderState.user_name}` : null,
    orderState.customer_name ? `Müşteri: ${orderState.customer_name}` : null,
    activeItems.length ? `${activeItems.length} kalem` : null,
  ].filter(Boolean);
  const title = orderState.table_display_name || orderState.table_name || (orderState.order_type === 'takeaway' ? 'Paket Sipariş' : 'Masa');

  const refreshOrder = async () => {
    const updated = await api.getOrder(orderState.id);
    setOrderState(updated);
    return updated;
  };

  const finishSuccess = (result, message = 'Ödeme alındı') => {
    setLastChange(Number(result?.payment?.change_amount) || 0);
    setCompleted(true);
    toast.success(message);
    setTimeout(() => {
      onComplete?.(result);
    }, 1200);
  };

  const handleSplitPaymentComplete = async () => {
    try {
      await refreshOrder();
    } catch {
      // Split modal already keeps its local state current.
    }
  };

  const closePaidOrder = async ({ printReceipt = false, printerId = null } = {}) => {
    const current = await refreshOrder();
    const currentDue = getTotalDue(current);
    if (currentDue > 0.02) {
      toast.error('Sipariş tamamen ödenmeden masa kapatılamaz');
      return;
    }
    if (printReceipt) {
      const printResult = await api.printOrderReceipt(current.id, printerId ? { printer_id: printerId } : {});
      if (printResult?.printJob?.status === 'failed' || printResult?.printJob?.error_code) {
        const action = getPrintErrorAction(printResult.printJob?.error_code);
        toast.warning(`Fiş kuyruğa alındı ancak yazıcıya ulaşılamadı. ${action}`);
      }
    }
    const updated = await api.updateOrderStatus(current.id, 'closed');
    finishSuccess({ order: updated }, printReceipt ? 'Masa kapatıldı ve yazdırıldı' : 'Masa kapatıldı');
  };

  const printPaidOrder = async (printerId = null) => {
    setProcessing(true);
    try {
      const printResult = await api.printOrderReceipt(orderState.id, printerId ? { printer_id: printerId } : {});
      if (printResult?.printJob?.status === 'failed' || printResult?.printJob?.error_code) {
        const action = getPrintErrorAction(printResult.printJob?.error_code);
        toast.warning(`Fiş kuyruğa alındı ancak yazıcıya ulaşılamadı. ${action}`);
      } else {
        toast.success('Yazdırma isteği gönderildi');
      }
    } catch (err) {
      toast.error(err.message || 'Yazdırma isteği gönderilemedi');
    } finally {
      setProcessing(false);
    }
  };

  const handlePayment = async () => {
    if (selectedAction.printReceipt && !manualPrintDialog.open) {
      setManualPrintDialog({ open: true, kind: 'payment' });
      return;
    }
    await executePayment(null);
  };

  const executePayment = async (printerId = null) => {
    if (processing) return;
    setProcessing(true);
    try {
      if (isFullyPaid) {
        if (selectedAction.closeOrder || selectedAction.printReceipt) {
          await closePaidOrder({
            printReceipt: selectedAction.printReceipt && !selectedAction.closeOrder,
            printerId,
          });
        } else {
          toast.info('Bu siparişin ödenecek bakiyesi yok');
        }
        return;
      }

      if (payAmount <= 0) {
        toast.error('Ödeme tutarı sıfırdan büyük olmalıdır');
        return;
      }
      if (selectedAction.closeOrder && payAmount + 0.02 < totalDue) {
        toast.error('Masa kapatmak için kalan tutarın tamamı ödenmelidir');
        return;
      }

      const result = await api.createPayment({
        order_id: orderState.id,
        payment_type: paymentType,
        amount: payAmount,
        tip_amount: tipAmount,
        cash_received: payAmount + tipAmount,
        close_order: selectedAction.closeOrder,
        print_receipt: selectedAction.printReceipt,
        print_printer_id: selectedAction.printReceipt ? printerId : null,
      });

      finishSuccess(result, selectedAction.label === 'Kaydet' ? 'Ödeme kaydedildi' : 'Ödeme alındı');
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
          <h2 style={{ fontSize: 18, fontWeight: 700, marginBottom: 8 }}>İşlem Tamamlandı</h2>
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
      <div
        className="modal detailed-payment-modal"
        onClick={e => e.stopPropagation()}
        style={{
          width: 'min(1180px, 96vw)',
          height: 'min(820px, 94vh)',
          display: 'flex',
          flexDirection: 'column',
          overflow: 'hidden',
        }}
      >
        <div className="modal-header" style={{ alignItems: 'flex-start', gap: 16, flexShrink: 0 }}>
          <div style={{ minWidth: 0 }}>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase', marginBottom: 4 }}>
              Detaylı ödeme
            </div>
            <h2 style={{ margin: 0, fontSize: 26, lineHeight: 1.15 }}>{title}</h2>
            {!!contextParts.length && (
              <div style={{ fontSize: 12, color: 'var(--text-secondary)', marginTop: 8, display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {contextParts.map((part) => (
                  <span key={part} style={{ border: '1px solid var(--border)', borderRadius: 8, padding: '4px 8px', background: 'var(--bg-tertiary)' }}>
                    {part}
                  </span>
                ))}
              </div>
            )}
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} title="Ödeme Ekranını Kapat" style={{ marginLeft: 'auto', flexShrink: 0 }}>
            <X size={18} />
          </button>
        </div>

        <div
          className="modal-body"
          style={{
            flex: 1,
            minHeight: 0,
            display: 'grid',
            gridTemplateColumns: 'minmax(360px, 1.05fr) minmax(380px, .95fr)',
            gap: 16,
            overflow: 'hidden',
          }}
        >
          <section style={{
            minHeight: 0,
            display: 'flex',
            flexDirection: 'column',
            border: '1px solid var(--border)',
            borderRadius: 8,
            background: 'var(--bg-secondary)',
            overflow: 'hidden',
          }}>
            <div style={{ padding: 16, borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', gap: 12 }}>
              <div>
                <div style={{ fontSize: 15, fontWeight: 850 }}>Kalemler</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                  Ödenmemiş hesap kontrolü
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-sm"
                onClick={() => setSplitOpen(true)}
                disabled={isFullyPaid}
              >
                <ArrowLeftRight size={15} />
                Ayrı ayrı öde
              </button>
            </div>

            <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 12, display: 'flex', flexDirection: 'column', gap: 8 }}>
              {activeItems.length ? activeItems.map((item) => {
                const mods = parseModifiers(item.modifiers);
                const qty = Number(item.quantity || 0);
                const lineTotal = Number(item.unit_price || 0) * qty - Number(item.discount_amount || 0);
                return (
                  <div
                    key={item.id}
                    style={{
                      display: 'grid',
                      gridTemplateColumns: 'auto minmax(0, 1fr) auto',
                      gap: 12,
                      alignItems: 'center',
                      padding: 12,
                      border: '1px solid var(--border)',
                      borderRadius: 8,
                      background: 'var(--bg-card)',
                    }}
                  >
                    <div style={{
                      width: 36,
                      height: 36,
                      borderRadius: 8,
                      background: 'var(--bg-tertiary)',
                      display: 'flex',
                      alignItems: 'center',
                      justifyContent: 'center',
                      fontWeight: 850,
                    }}>
                      {qty}x
                    </div>
                    <div style={{ minWidth: 0 }}>
                      <div style={{ fontSize: 14, fontWeight: 800, lineHeight: 1.25 }} className="truncate">
                        {item.product_name}
                      </div>
                      <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                        {[item.portion_label, ...mods.map((mod) => mod.name)].filter(Boolean).join(' · ') || 'Standart'}
                      </div>
                    </div>
                    <strong style={{ fontSize: 14, whiteSpace: 'nowrap' }}>
                      {formatCurrency(lineTotal)}
                    </strong>
                  </div>
                );
              }) : (
                <div style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                  Ödenecek kalem bulunamadı.
                </div>
              )}
            </div>

            <div style={{ padding: 14, borderTop: '1px solid var(--border)', background: 'var(--bg-primary)' }}>
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>
                Ayrı ödeme gerektiğinde kalemleri kişilere paylaştırın. Normal ödeme için sağdaki ödeme alanını kullanın.
              </div>
            </div>
          </section>

          <section style={{ minHeight: 0, overflow: 'auto', display: 'flex', flexDirection: 'column', gap: 14 }}>
            <div style={{
              border: '1px solid var(--border)',
              borderRadius: 8,
              background: 'var(--bg-secondary)',
              padding: 16,
            }}>
              <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10, marginBottom: 12 }}>
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, background: 'var(--bg-card)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase' }}>Sipariş Toplamı</div>
                  <div style={{ fontSize: 19, fontWeight: 850, marginTop: 5 }}>{formatCurrency(orderTotal)}</div>
                </div>
                <div style={{ border: '1px solid var(--border)', borderRadius: 8, padding: 12, background: 'var(--bg-card)' }}>
                  <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 800, textTransform: 'uppercase' }}>Ödenen</div>
                  <div style={{ fontSize: 19, fontWeight: 850, marginTop: 5, color: paidTotal > 0 ? 'var(--success)' : 'var(--text-primary)' }}>
                    {formatCurrency(paidTotal)}
                  </div>
                </div>
              </div>
              <div style={{
                border: `1px solid ${isFullyPaid ? 'var(--success)' : 'var(--warning)'}`,
                borderRadius: 8,
                padding: 16,
                background: isFullyPaid ? 'var(--success-muted)' : 'var(--warning-muted)',
                textAlign: 'center',
              }}>
                <div style={{ fontSize: 12, color: isFullyPaid ? 'var(--success)' : 'var(--warning)', fontWeight: 850, textTransform: 'uppercase' }}>
                  {isFullyPaid ? 'Hesap Tamamlandı' : 'Kalan'}
                </div>
                <div style={{ fontSize: 38, fontWeight: 900, marginTop: 4, color: isFullyPaid ? 'var(--success)' : 'var(--text-primary)' }}>
                  {formatCurrency(totalDue)}
                </div>
              </div>
            </div>

            {isFullyPaid ? (
              <div style={{
                border: '1px solid var(--success)',
                borderRadius: 8,
                background: 'var(--bg-secondary)',
                padding: 18,
              }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 12 }}>
                  <div style={{
                    width: 42,
                    height: 42,
                    borderRadius: 8,
                    background: 'var(--success-muted)',
                    display: 'flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    color: 'var(--success)',
                  }}>
                    <Check size={24} />
                  </div>
                  <div>
                    <div style={{ fontSize: 17, fontWeight: 850 }}>Ödeme Tamamlandı</div>
                    <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 3 }}>
                      Yeni ödeme alınmasına gerek yok.
                    </div>
                  </div>
                </div>
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                  <button
                    type="button"
                    className="btn btn-ghost"
                    onClick={() => setManualPrintDialog({ open: true, kind: 'print-only' })}
                    disabled={processing}
                  >
                    <Printer size={16} /> Yazdır
                  </button>
                  <button type="button" className="btn btn-success" onClick={() => closePaidOrder()} disabled={processing}>
                    <Check size={16} /> Masayı Kapat
                  </button>
                </div>
              </div>
            ) : (
              <>
                <div style={{
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  background: 'var(--bg-secondary)',
                  padding: 16,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 850, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase' }}>
                    İşlem Aksiyonu
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {paymentActions.map((action) => {
                      const Icon = action.icon;
                      const selected = paymentAction === action.key;
                      return (
                        <button
                          key={action.key}
                          type="button"
                          data-testid={`payment-action-${action.key}`}
                          className={paymentActionClass(action, selected)}
                          onClick={() => setPaymentAction(action.key)}
                          style={{ minHeight: 48, justifyContent: 'center', fontWeight: selected ? 850 : 750 }}
                        >
                          <Icon size={16} /> {action.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  background: 'var(--bg-secondary)',
                  padding: 16,
                }}>
                  <div style={{ fontSize: 12, fontWeight: 850, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase' }}>
                    Ödeme Tipi
                  </div>
                  <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                    {paymentTypes.map((type) => {
                      const Icon = type.icon;
                      return (
                        <button
                          key={type.key}
                          className={`btn ${paymentType === type.key ? 'btn-primary' : 'btn-ghost'}`}
                          type="button"
                          onClick={() => setPaymentType(type.key)}
                          style={{ minHeight: 54, justifyContent: 'center' }}
                        >
                          <Icon size={18} /> {type.label}
                        </button>
                      );
                    })}
                  </div>
                </div>

                <div style={{
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  background: 'var(--bg-secondary)',
                  padding: 16,
                }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 850, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase' }}>
                    Alınacak Tutar
                  </label>
                  <div style={{ display: 'grid', gridTemplateColumns: 'minmax(0, 1fr) auto auto', gap: 8 }}>
                    <input
                      className="input input-lg"
                      type="number"
                      min="0"
                      step="0.01"
                      value={amountInput}
                      onChange={(e) => setAmountInput(e.target.value)}
                      placeholder={formatCurrency(totalDue)}
                      style={{ fontSize: 22, fontWeight: 850, textAlign: 'center' }}
                    />
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setAmountInput(inputValueForAmount(totalDue))}
                    >
                      Kalanı Al
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      onClick={() => setAmountInput(inputValueForAmount(orderTotal))}
                    >
                      Tümünü Al
                    </button>
                  </div>
                  <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                    İşlenecek tutar: <strong style={{ color: 'var(--text-primary)' }}>{formatCurrency(payAmount)}</strong>
                  </div>
                </div>

                <div style={{
                  border: '1px solid var(--border)',
                  borderRadius: 8,
                  background: 'var(--bg-secondary)',
                  padding: 16,
                }}>
                  <label style={{ display: 'block', fontSize: 12, fontWeight: 850, color: 'var(--text-muted)', marginBottom: 10, textTransform: 'uppercase' }}>
                    Bahşiş
                  </label>
                  <input
                    className="input input-lg"
                    type="number"
                    min="0"
                    step="0.01"
                    value={tipInput}
                    onChange={(e) => setTipInput(e.target.value)}
                    placeholder="0,00"
                    style={{ fontSize: 18, fontWeight: 850, textAlign: 'center' }}
                  />
                  <div style={{ marginTop: 10, fontSize: 12, color: 'var(--text-muted)' }}>
                    Toplam tahsilat: <strong style={{ color: 'var(--text-primary)' }}>{formatCurrency(payAmount + tipAmount)}</strong>
                  </div>
                </div>
              </>
            )}
          </section>
        </div>

        <div className="modal-footer" style={{ flexShrink: 0, justifyContent: 'space-between', gap: 12 }}>
          <button type="button" className="btn btn-ghost" onClick={onClose}>Ödeme Ekranını Kapat</button>
          {!isFullyPaid && (
            <button
              type="button"
              data-testid="payment-submit-button"
              className={selectedAction.tone === 'success' ? 'btn btn-success btn-lg' : 'btn btn-primary btn-lg'}
              onClick={handlePayment}
              disabled={processing}
              style={{ minWidth: 240 }}
            >
              <Check size={18} />
              {processing ? 'İşleniyor...' : selectedAction.label}
            </button>
          )}
        </div>

        <style>{`
          @media (max-width: 900px) {
            .detailed-payment-modal {
              width: 96vw !important;
              height: 94vh !important;
            }
            .detailed-payment-modal .modal-body {
              grid-template-columns: minmax(0, 1fr) !important;
              overflow: auto !important;
            }
          }
        `}</style>
      </div>
      {splitOpen && (
        <SplitPaymentModal
          orderId={orderState.id}
          onClose={() => setSplitOpen(false)}
          onPaymentComplete={handleSplitPaymentComplete}
        />
      )}
      <ManualPrintSelectorModal
        open={!!manualPrintDialog.open}
        onClose={() => setManualPrintDialog({ open: false, kind: 'print-only' })}
        printRole="receipt"
        title="Fiş yazdır"
        description="Hangi yazıcıdan yazdırmak istiyorsunuz?"
        onConfirm={async (printerId) => {
          if (manualPrintDialog.kind === 'print-only') {
            await printPaidOrder(printerId);
          } else {
            await executePayment(printerId);
          }
        }}
      />
    </div>
  );
}
