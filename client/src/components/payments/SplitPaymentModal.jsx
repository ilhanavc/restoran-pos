import { useEffect, useMemo, useState } from 'react';
import { Check, CreditCard, Banknote, Plus, RotateCcw, Undo2, X, UserPlus, Minus } from 'lucide-react';
import api from '../../services/api.js';
import { formatCurrency } from '../../constants/index.js';
import { useToast } from '../../context/ToastContext.jsx';

const paymentTypes = [
  { key: 'cash', label: 'Nakit', icon: Banknote },
  { key: 'card', label: 'Kart', icon: CreditCard },
  { key: 'other', label: 'Diğer', icon: Check },
];

function makePayer(no) {
  return {
    id: `draft-${Date.now()}-${no}`,
    no,
    label: `Kişi ${no}`,
    items: {},
    paymentType: 'cash',
    cashReceived: '',
  };
}

function nextPayerNoFromState(splitState, draftPayers = []) {
  const paidNos = (splitState?.payments || [])
    .map((payment) => Number(payment.payer_no || 0))
    .filter((no) => Number.isFinite(no) && no > 0);
  const draftNos = draftPayers
    .map((payer) => Number(payer.no || 0))
    .filter((no) => Number.isFinite(no) && no > 0);
  return Math.max(0, ...paidNos, ...draftNos) + 1;
}

function lineQty(payer, itemId) {
  return Number(payer.items[itemId] || 0);
}

function payerTotal(payer, itemMap) {
  return Object.entries(payer.items).reduce((sum, [itemId, qty]) => {
    const item = itemMap.get(itemId);
    return sum + (item ? Number(qty || 0) * Number(item.unit_price_snapshot || 0) : 0);
  }, 0);
}

export default function SplitPaymentModal({ orderId, onClose, onPaymentComplete }) {
  const toast = useToast();
  const [state, setState] = useState(null);
  const [loading, setLoading] = useState(true);
  const [processingPayerId, setProcessingPayerId] = useState(null);
  const [payers, setPayers] = useState([makePayer(1)]);
  const [activePayerId, setActivePayerId] = useState(null);
  const [history, setHistory] = useState([]);

  useEffect(() => {
    setActivePayerId((current) => current || payers[0]?.id || null);
  }, [payers]);

  const loadState = async ({ resetDraftPayers = false } = {}) => {
    setLoading(true);
    try {
      const data = await api.getSplitPaymentState(orderId);
      setState(data);
      if (resetDraftPayers) {
        const next = makePayer(nextPayerNoFromState(data));
        setPayers([next]);
        setActivePayerId(next.id);
        setHistory([]);
      }
    } catch (err) {
      toast.error(err.message || 'Ayrı ödeme bilgisi yüklenemedi');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    loadState({ resetDraftPayers: true });
  }, [orderId]);

  const itemMap = useMemo(() => {
    return new Map((state?.items || []).map((item) => [item.id, item]));
  }, [state]);

  const draftQtyByItem = useMemo(() => {
    const map = new Map();
    for (const payer of payers) {
      for (const [itemId, qty] of Object.entries(payer.items)) {
        map.set(itemId, (map.get(itemId) || 0) + Number(qty || 0));
      }
    }
    return map;
  }, [payers]);

  const paidGroups = useMemo(() => {
    const groups = new Map();
    for (const allocation of state?.allocations || []) {
      const key = allocation.payment_id;
      if (!groups.has(key)) {
        groups.set(key, {
          id: key,
          payer_label: allocation.payer_label || `Kişi ${allocation.payer_no || ''}`.trim(),
          payment_type: allocation.payment_type,
          amount: Number(allocation.amount || 0),
          items: [],
        });
      }
      groups.get(key).items.push(allocation);
    }
    return Array.from(groups.values());
  }, [state]);

  const activePayer = payers.find((payer) => payer.id === activePayerId) || payers[0];
  const draftTotal = payers.reduce((sum, payer) => sum + payerTotal(payer, itemMap), 0);

  const pushHistory = () => {
    setHistory((prev) => [...prev.slice(-24), JSON.parse(JSON.stringify(payers))]);
  };

  const updatePayer = (payerId, updater, remember = true) => {
    if (remember) pushHistory();
    setPayers((prev) => prev.map((payer) => (payer.id === payerId ? updater(payer) : payer)));
  };

  const assignItem = (itemId) => {
    if (!activePayer) return;
    const item = itemMap.get(itemId);
    if (!item) return;
    const draftQty = draftQtyByItem.get(itemId) || 0;
    const available = Number(item.remaining_quantity || 0) - draftQty;
    if (available <= 0) {
      toast.info('Bu ürün için kalan adet yok');
      return;
    }
    updatePayer(activePayer.id, (payer) => ({
      ...payer,
      items: { ...payer.items, [itemId]: lineQty(payer, itemId) + 1 },
    }));
  };

  const removeItem = (payerId, itemId) => {
    updatePayer(payerId, (payer) => {
      const nextQty = lineQty(payer, itemId) - 1;
      const items = { ...payer.items };
      if (nextQty > 0) items[itemId] = nextQty;
      else delete items[itemId];
      return { ...payer, items };
    });
  };

  const addPayer = () => {
    pushHistory();
    setPayers((prev) => {
      const nextNo = nextPayerNoFromState(state, prev);
      const next = makePayer(nextNo);
      setActivePayerId(next.id);
      return [...prev, next];
    });
  };

  const undo = () => {
    setHistory((prev) => {
      const last = prev[prev.length - 1];
      if (!last) return prev;
      setPayers(last);
      setActivePayerId(last[0]?.id || null);
      return prev.slice(0, -1);
    });
  };

  const resetDraft = () => {
    pushHistory();
    const next = makePayer(nextPayerNoFromState(state));
    setPayers([next]);
    setActivePayerId(next.id);
  };

  const setPaymentType = (payerId, paymentType) => {
    updatePayer(payerId, (payer) => ({ ...payer, paymentType, cashReceived: '' }), false);
  };

  const setCashReceived = (payerId, cashReceived) => {
    updatePayer(payerId, (payer) => ({ ...payer, cashReceived }), false);
  };

  const takePayment = async (payer) => {
    const entries = Object.entries(payer.items).filter(([, qty]) => Number(qty) > 0);
    if (!entries.length) {
      toast.error('Bu kişiye ürün atanmadı');
      return;
    }
    const amount = payerTotal(payer, itemMap);
    const cashReceived = payer.paymentType === 'cash'
      ? Number(payer.cashReceived || amount)
      : amount;
    if (payer.paymentType === 'cash' && cashReceived + 0.02 < amount) {
      toast.error('Alınan nakit tutarı eksik');
      return;
    }

    setProcessingPayerId(payer.id);
    try {
      const result = await api.createSplitPayment({
        order_id: orderId,
        payment_type: payer.paymentType,
        cash_received: cashReceived,
        payer_no: payer.no,
        payer_label: payer.label,
        allocations: entries.map(([order_item_id, quantity]) => ({
          order_item_id,
          quantity: Number(quantity),
        })),
      });
      setState(result.split);
      setHistory([]);
      setPayers((prev) => {
        const remainingDrafts = prev.filter((p) => p.id !== payer.id);
        const nextNo = Math.max(payer.no + 1, ...remainingDrafts.map((p) => p.no), 0);
        const next = remainingDrafts.length ? remainingDrafts : [makePayer(nextNo)];
        setActivePayerId(next[0]?.id || null);
        return next;
      });
      toast.success(`${payer.label} ödemesi alındı`);
      onPaymentComplete?.(result);
    } catch (err) {
      toast.error(err.message || 'Ödeme alınamadı');
      await loadState();
    } finally {
      setProcessingPayerId(null);
    }
  };

  if (loading) {
    return (
      <div className="modal-overlay">
        <div className="modal modal-md" style={{ padding: 32, textAlign: 'center' }}>
          Ayrı ödeme bilgisi yükleniyor...
        </div>
      </div>
    );
  }

  if (!state) return null;

  const orderTotal = Number(state.totals?.order_total || 0);
  const paidTotal = Number(state.totals?.paid_total || 0);
  const remainingTotal = Number(state.totals?.remaining_total || 0);

  return (
    <div
      className="modal-overlay"
      onClick={(e) => {
        e.stopPropagation();
        onClose();
      }}
    >
      <div
        className="modal split-payment-modal"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="modal-header split-payment-header">
          <div>
            <h2>Ayrı Ayrı Öde</h2>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {state.order?.table_name ? `${state.order.table_name} · ` : ''}Ürünleri kişilere paylaştırın
            </div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose} title="Kapat">
            <X size={16} />
          </button>
        </div>

        <div className="split-payment-summary">
          <div>
            <span>Sipariş toplamı</span>
            <strong>{formatCurrency(orderTotal)}</strong>
          </div>
          <div>
            <span>Ödenen</span>
            <strong style={{ color: 'var(--success)' }}>{formatCurrency(paidTotal)}</strong>
          </div>
          <div>
            <span>Kalan</span>
            <strong style={{ color: remainingTotal <= 0.02 ? 'var(--success)' : 'var(--warning)' }}>
              {formatCurrency(remainingTotal)}
            </strong>
          </div>
          <div>
            <span>Dağıtımda</span>
            <strong>{formatCurrency(draftTotal)}</strong>
          </div>
        </div>

        {state.totals?.has_unallocated_payments && (
          <div className="split-payment-warning">
            Bu siparişte kalem bazlı olmayan ödeme kaydı var. Yeni ayrı ödeme güvenlik için engellenebilir.
          </div>
        )}

        <div className="split-payment-body">
          <section className="split-items-panel">
            <div className="split-panel-title">
              <span>Kalan ürünler</span>
              <span>{activePayer?.label || 'Kişi seçin'} için ekle</span>
            </div>

            <div className="split-items-list">
              {(state.items || []).map((item) => {
                const draftQty = draftQtyByItem.get(item.id) || 0;
                const available = Math.max(0, Number(item.remaining_quantity || 0) - draftQty);
                const disabled = available <= 0 || remainingTotal <= 0.02;
                return (
                  <div key={item.id} className={`split-item-row ${disabled ? 'is-disabled' : ''}`}>
                    <div className="split-item-main">
                      <div className="split-item-name">{item.total_quantity}x {item.product_name}</div>
                      <div className="split-item-meta">
                        Kalan {available}
                      </div>
                    </div>
                    <div className="split-item-price">
                      <div>{formatCurrency(item.unit_price_snapshot)}</div>
                      <small>{formatCurrency(available * Number(item.unit_price_snapshot || 0))}</small>
                    </div>
                    <button
                      type="button"
                      className="btn btn-primary btn-icon"
                      disabled={disabled}
                      onClick={() => assignItem(item.id)}
                      title="Seçili kişiye 1 adet ekle"
                    >
                      <Plus size={18} />
                    </button>
                  </div>
                );
              })}
            </div>
          </section>

          <section className="split-payers-panel">
            <div className="split-payers-toolbar">
              <button type="button" className="btn btn-ghost" onClick={undo} disabled={!history.length}>
                <Undo2 size={15} /> Geri Al
              </button>
              <button type="button" className="btn btn-ghost" onClick={resetDraft}>
                <RotateCcw size={15} /> Bölmeyi Sıfırla
              </button>
              <button type="button" className="btn btn-primary" onClick={addPayer}>
                <UserPlus size={15} /> Kişi Ekle
              </button>
            </div>

            {!!paidGroups.length && (
              <div className="split-paid-groups">
                {paidGroups.map((group) => (
                  <div key={group.id} className="split-payer-card is-paid">
                    <div className="split-payer-head">
                      <strong>{group.payer_label || 'Ödenen kişi'}</strong>
                      <span>Ödendi · {formatCurrency(group.amount)}</span>
                    </div>
                    <div className="split-payer-lines">
                      {group.items.map((allocation) => {
                        const item = itemMap.get(allocation.order_item_id);
                        return (
                          <div key={allocation.id} className="split-payer-line">
                            <span>{item?.product_name || 'Ürün'} x {allocation.quantity}</span>
                            <strong>{formatCurrency(allocation.line_total)}</strong>
                          </div>
                        );
                      })}
                    </div>
                  </div>
                ))}
              </div>
            )}

            <div className="split-draft-payers">
              {payers.map((payer) => {
                const total = payerTotal(payer, itemMap);
                const isActive = payer.id === activePayer?.id;
                const isProcessing = processingPayerId === payer.id;
                const cashReceived = Number(payer.cashReceived || total);
                const change = payer.paymentType === 'cash' ? Math.max(0, cashReceived - total) : 0;
                const entries = Object.entries(payer.items).filter(([, qty]) => Number(qty) > 0);

                return (
                  <div
                    key={payer.id}
                    className={`split-payer-card ${isActive ? 'is-active' : ''}`}
                    onClick={() => setActivePayerId(payer.id)}
                  >
                    <div className="split-payer-head">
                      <strong className="split-payer-label">{payer.label}</strong>
                      <span>{formatCurrency(total)}</span>
                    </div>

                    <div className="split-payer-lines">
                      {entries.length ? entries.map(([itemId, qty]) => {
                        const item = itemMap.get(itemId);
                        if (!item) return null;
                        return (
                          <div key={itemId} className="split-payer-line">
                            <span>{item.product_name} x {qty}</span>
                            <div>
                              <strong>{formatCurrency(Number(qty) * Number(item.unit_price_snapshot || 0))}</strong>
                              <button
                                type="button"
                                className="split-line-remove"
                                onClick={(e) => {
                                  e.stopPropagation();
                                  removeItem(payer.id, itemId);
                                }}
                                title="Havuza geri al"
                              >
                                <Minus size={13} />
                              </button>
                            </div>
                          </div>
                        );
                      }) : (
                        <div className="split-empty-payer">Soldan ürün ekleyin</div>
                      )}
                    </div>

                    <div className="split-pay-type-row" onClick={(e) => e.stopPropagation()}>
                      {paymentTypes.map((type) => (
                        <button
                          key={type.key}
                          type="button"
                          className={`btn ${payer.paymentType === type.key ? 'btn-primary' : 'btn-ghost'} btn-sm`}
                          onClick={() => setPaymentType(payer.id, type.key)}
                        >
                          <type.icon size={14} /> {type.label}
                        </button>
                      ))}
                    </div>

                    {payer.paymentType === 'cash' && total > 0 && (
                      <div className="split-cash-row" onClick={(e) => e.stopPropagation()}>
                        <input
                          className="input"
                          type="number"
                          value={payer.cashReceived}
                          onChange={(e) => setCashReceived(payer.id, e.target.value)}
                          placeholder={formatCurrency(total)}
                        />
                        <button type="button" className="btn btn-ghost btn-sm" onClick={() => setCashReceived(payer.id, String(roundForInput(total)))}>
                          Tam
                        </button>
                        <span>Para üstü: {formatCurrency(change)}</span>
                      </div>
                    )}

                    <button
                      type="button"
                      className="btn btn-success btn-block"
                      disabled={isProcessing || total <= 0}
                      onClick={(e) => {
                        e.stopPropagation();
                        takePayment(payer);
                      }}
                    >
                      <Check size={16} />
                      {isProcessing ? 'İşleniyor...' : 'Bu kişiden ödemeyi al'}
                    </button>
                  </div>
                );
              })}
            </div>
          </section>
        </div>

        <style>{`
          .split-payment-modal {
            width: min(1180px, 96vw);
            height: min(820px, 94vh);
            display: flex;
            flex-direction: column;
            overflow: hidden;
          }
          .split-payment-header {
            flex-shrink: 0;
          }
          .split-payment-summary {
            display: grid;
            grid-template-columns: repeat(4, minmax(0, 1fr));
            gap: 10px;
            padding: 14px 18px;
            border-bottom: 1px solid var(--border);
            background: var(--bg-primary);
          }
          .split-payment-summary > div {
            border: 1px solid var(--border);
            border-radius: 8px;
            background: var(--bg-secondary);
            padding: 10px 12px;
          }
          .split-payment-summary span {
            display: block;
            font-size: 11px;
            color: var(--text-muted);
            font-weight: 700;
            text-transform: uppercase;
          }
          .split-payment-summary strong {
            display: block;
            margin-top: 4px;
            font-size: 20px;
            line-height: 1.1;
          }
          .split-payment-warning {
            flex-shrink: 0;
            padding: 10px 18px;
            background: var(--warning-muted);
            color: var(--warning);
            border-bottom: 1px solid rgba(245, 158, 11, .35);
            font-size: 13px;
            font-weight: 700;
          }
          .split-payment-body {
            flex: 1;
            min-height: 0;
            display: grid;
            grid-template-columns: minmax(360px, .9fr) minmax(0, 1.35fr);
          }
          .split-items-panel,
          .split-payers-panel {
            min-height: 0;
            overflow: auto;
            padding: 16px;
          }
          .split-items-panel {
            border-right: 1px solid var(--border);
            background: var(--bg-primary);
          }
          .split-panel-title {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 12px;
            margin-bottom: 12px;
            font-size: 12px;
            color: var(--text-muted);
            font-weight: 800;
            text-transform: uppercase;
          }
          .split-items-list,
          .split-draft-payers,
          .split-paid-groups {
            display: flex;
            flex-direction: column;
            gap: 10px;
          }
          .split-paid-groups {
            margin-bottom: 14px;
          }
          .split-item-row {
            display: grid;
            grid-template-columns: minmax(0, 1fr) auto auto;
            gap: 10px;
            align-items: center;
            min-height: 72px;
            border: 1px solid var(--border);
            border-radius: 8px;
            background: var(--bg-secondary);
            padding: 12px;
          }
          .split-item-row.is-disabled {
            opacity: .55;
          }
          .split-item-name {
            font-size: 15px;
            font-weight: 850;
            line-height: 1.25;
          }
          .split-item-meta,
          .split-item-price small {
            display: block;
            margin-top: 4px;
            color: var(--text-muted);
            font-size: 12px;
            font-weight: 700;
          }
          .split-item-price {
            text-align: right;
            font-size: 14px;
            font-weight: 850;
            min-width: 112px;
          }
          .split-payers-toolbar {
            display: flex;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 14px;
          }
          .split-payer-card {
            border: 1px solid var(--border);
            border-radius: 8px;
            background: var(--bg-card);
            padding: 12px;
            cursor: pointer;
          }
          .split-payer-card.is-active {
            border-color: var(--accent);
            box-shadow: inset 0 0 0 1px var(--accent);
          }
          .split-payer-card.is-paid {
            cursor: default;
            background: var(--success-muted);
            border-color: rgba(34, 197, 94, .35);
          }
          .split-payer-head {
            display: flex;
            align-items: center;
            justify-content: space-between;
            gap: 10px;
            margin-bottom: 10px;
          }
          .split-payer-label {
            min-height: 40px;
            min-width: 160px;
            display: inline-flex;
            align-items: center;
            border: 1px solid var(--border);
            border-radius: 8px;
            background: rgba(15, 23, 42, .36);
            padding: 0 14px;
            font-size: 14px;
            font-weight: 850;
          }
          .split-payer-head span {
            color: var(--text-secondary);
            font-size: 13px;
            font-weight: 800;
            white-space: nowrap;
          }
          .split-payer-lines {
            display: flex;
            flex-direction: column;
            gap: 6px;
            margin-bottom: 10px;
          }
          .split-payer-line {
            display: flex;
            justify-content: space-between;
            align-items: center;
            gap: 10px;
            min-height: 34px;
            border-radius: 8px;
            background: rgba(15, 23, 42, .42);
            padding: 7px 9px;
            font-size: 13px;
          }
          .split-payer-line > div {
            display: inline-flex;
            align-items: center;
            gap: 8px;
          }
          .split-line-remove {
            width: 28px;
            height: 28px;
            display: inline-flex;
            align-items: center;
            justify-content: center;
            border: 1px solid var(--border);
            border-radius: 8px;
            background: transparent;
            color: var(--danger);
            cursor: pointer;
          }
          .split-empty-payer {
            padding: 12px;
            border: 1px dashed var(--border);
            border-radius: 8px;
            color: var(--text-muted);
            text-align: center;
            font-size: 13px;
            font-weight: 700;
          }
          .split-pay-type-row,
          .split-cash-row {
            display: flex;
            align-items: center;
            flex-wrap: wrap;
            gap: 8px;
            margin-bottom: 10px;
          }
          .split-cash-row .input {
            max-width: 180px;
          }
          .split-cash-row span {
            color: var(--text-muted);
            font-size: 12px;
            font-weight: 800;
          }
          @media (max-width: 860px) {
            .split-payment-modal {
              width: 100vw;
              height: 100vh;
              max-width: 100vw;
              max-height: 100vh;
              border-radius: 0;
            }
            .split-payment-summary {
              grid-template-columns: repeat(2, minmax(0, 1fr));
            }
            .split-payment-body {
              grid-template-columns: 1fr;
            }
            .split-items-panel {
              border-right: none;
              border-bottom: 1px solid var(--border);
              max-height: 42vh;
            }
          }
        `}</style>
      </div>
    </div>
  );
}

function roundForInput(value) {
  const rounded = Math.round((Number(value) || 0) * 100) / 100;
  return Number.isInteger(rounded) ? rounded : rounded.toFixed(2);
}
