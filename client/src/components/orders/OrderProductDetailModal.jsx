import { useState, useEffect } from 'react';
import { X, Minus, Plus } from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency } from '../../constants/index.js';

/**
 * Sipariş satırı düzenleme: adet, not, porsiyon (gridden açılmaz).
 */
export default function OrderProductDetailModal({
  product,
  onClose,
  onContinue,
  /** { quantity, note, portion_id } — satırdaki mevcut değerler */
  initialLine = null,
  /** Salt okunur: seçenek satırları */
  modifiersDisplay = null,
  readOnlyQuantity = false,
  readOnlyPortion = false,
  readOnlyNote = false,
  /** Tam salt okunur (ör. ikram satırı) */
  isReadOnly = false,
  saveLabel = 'Kaydet',
  subtitle = null,
  /** Satır değişince formu sıfırlamak için (örn. cart-0, existing-uuid) */
  lineKey = '',
}) {
  const toast = useToast();
  const [loading, setLoading] = useState(true);
  const [fullProduct, setFullProduct] = useState(null);
  const [quantity, setQuantity] = useState(1);
  const [note, setNote] = useState('');
  const [selectedPortionId, setSelectedPortionId] = useState(null);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        const p = await api.getProduct(product.id);
        if (cancelled) return;
        setFullProduct(p);
        const portions = p.portions || [];
        if (portions.length === 0) {
          setSelectedPortionId(null);
        } else {
          const fromLine = initialLine?.portion_id;
          const match = fromLine && portions.some((x) => x.id === fromLine);
          const def = portions.find((x) => Number(x.is_default)) || portions[0];
          setSelectedPortionId(match ? fromLine : def.id);
        }
        if (initialLine) {
          setQuantity(Math.max(1, Math.floor(Number(initialLine.quantity)) || 1));
          setNote(initialLine.note != null ? String(initialLine.note) : '');
        } else {
          setQuantity(1);
          setNote('');
        }
      } catch (e) {
        if (!cancelled) toast.error(e.message || 'Ürün yüklenemedi');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [product.id, toast, lineKey]);

  const handleSave = () => {
    if (!fullProduct || isReadOnly) return;
    const portions = fullProduct.portions || [];
    const qty = Math.max(1, Math.floor(Number(quantity)) || 1);

    let effectiveProduct = { ...fullProduct };
    let portion_id = null;
    let portion_label = null;

    if (portions.length > 0 && !readOnlyPortion) {
      const sel = portions.find((x) => x.id === selectedPortionId) || portions[0];
      portion_id = sel.id;
      portion_label = sel.label || '';
      effectiveProduct = { ...fullProduct, price: Number(sel.price) };
    } else if (portions.length > 0 && readOnlyPortion) {
      const sel = portions.find((x) => x.id === (initialLine?.portion_id || selectedPortionId)) || portions[0];
      portion_id = sel?.id ?? null;
      portion_label = sel?.label || initialLine?.portion_label || '';
      effectiveProduct = { ...fullProduct, price: Number(sel?.price ?? fullProduct.price) };
    }

    onContinue({
      quantity: readOnlyQuantity ? (initialLine?.quantity ?? qty) : qty,
      note: readOnlyNote ? (initialLine?.note ?? '') : note.trim(),
      effectiveProduct,
      portion_id,
      portion_label,
    });
  };

  const portions = fullProduct?.portions || [];
  const showPortionPicker = portions.length > 1 && !readOnlyPortion;
  const defaultSubtitle =
    'Adet, not ve porsiyon; Kaydet ile uygulanır.';

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-md order-product-detail-modal" onClick={(e) => e.stopPropagation()} role="dialog" aria-modal="true" aria-labelledby="order-product-detail-title">
        <div className="modal-header">
          <div>
            <h2 id="order-product-detail-title">{product?.name || fullProduct?.name || 'Ürün'}</h2>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4 }}>
              {subtitle ?? defaultSubtitle}
            </div>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} aria-label="Kapat">
            <X size={18} />
          </button>
        </div>

        <div className="modal-body" style={{ paddingTop: 8 }}>
          {loading ? (
            <div className="empty-state" style={{ padding: 24 }}>
              Yükleniyor…
            </div>
          ) : (
            <>
              {modifiersDisplay && modifiersDisplay.length > 0 && (
                <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--text-muted)' }}>
                  <span className="order-product-detail-label" style={{ display: 'block', marginBottom: 6 }}>
                    Seçenekler
                  </span>
                  {modifiersDisplay.map((m) => m.name).join(', ')}
                </div>
              )}

              <div className="order-product-detail-row">
                <span className="order-product-detail-label">Adet</span>
                {readOnlyQuantity || isReadOnly ? (
                  <span style={{ fontWeight: 700, fontSize: 16 }}>{initialLine?.quantity ?? quantity}</span>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button
                      type="button"
                      className="btn btn-ghost"
                      style={{ padding: 8, minWidth: 44 }}
                      onClick={() => setQuantity((q) => Math.max(1, q - 1))}
                    >
                      <Minus size={18} />
                    </button>
                    <input
                      type="number"
                      min={1}
                      className="input"
                      style={{ width: 72, textAlign: 'center', fontWeight: 700 }}
                      value={quantity}
                      onChange={(e) => {
                        const v = Math.max(1, Math.floor(Number(e.target.value)) || 1);
                        setQuantity(v);
                      }}
                    />
                    <button type="button" className="btn btn-ghost" style={{ padding: 8, minWidth: 44 }} onClick={() => setQuantity((q) => q + 1)}>
                      <Plus size={18} />
                    </button>
                  </div>
                )}
              </div>

              {showPortionPicker && (
                <div style={{ marginTop: 18 }}>
                  <span className="order-product-detail-label" style={{ display: 'block', marginBottom: 10 }}>
                    Porsiyon
                  </span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {portions.map((p) => {
                      const sel = p.id === selectedPortionId;
                      return (
                        <button
                          key={p.id}
                          type="button"
                          onClick={() => setSelectedPortionId(p.id)}
                          style={{
                            padding: '12px 16px',
                            borderRadius: 'var(--radius-sm)',
                            border: sel ? '2px solid var(--accent)' : '1px solid var(--border)',
                            background: sel ? 'var(--accent-muted)' : 'var(--bg-tertiary)',
                            color: sel ? 'var(--accent)' : 'var(--text-primary)',
                            cursor: 'pointer',
                            fontWeight: 700,
                            fontFamily: 'inherit',
                            fontSize: 14,
                            minWidth: 120,
                            textAlign: 'center',
                          }}
                        >
                          <div>{p.label}</div>
                          <div style={{ fontSize: 13, opacity: 0.85, marginTop: 4 }}>{formatCurrency(p.price)}</div>
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}

              {readOnlyPortion && portions.length > 0 && (
                <div style={{ marginTop: 14, fontSize: 13, color: 'var(--text-muted)' }}>
                  Porsiyon:{' '}
                  <strong style={{ color: 'var(--text-primary)' }}>
                    {initialLine?.portion_label || portions.find((x) => x.id === initialLine?.portion_id)?.label || portions[0].label}
                  </strong>
                </div>
              )}

              {!showPortionPicker && !readOnlyPortion && portions.length === 1 && (
                <div style={{ marginTop: 14, fontSize: 13, color: 'var(--text-muted)' }}>
                  Porsiyon: <strong style={{ color: 'var(--text-primary)' }}>{portions[0].label}</strong> — {formatCurrency(portions[0].price)}
                </div>
              )}

              <div style={{ marginTop: 18 }}>
                <span className="order-product-detail-label" style={{ display: 'block', marginBottom: 8 }}>
                  Ürün notu
                </span>
                <textarea
                  className="input"
                  rows={3}
                  placeholder="İsteğe bağlı…"
                  value={readOnlyNote || isReadOnly ? (initialLine?.note ?? '') : note}
                  onChange={(e) => setNote(e.target.value)}
                  readOnly={readOnlyNote || isReadOnly}
                  style={{
                    width: '100%',
                    resize: 'vertical',
                    minHeight: 72,
                    opacity: readOnlyNote || isReadOnly ? 0.85 : 1,
                  }}
                />
              </div>
            </>
          )}
        </div>

        <div className="modal-footer">
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={loading}>
            {isReadOnly ? 'Kapat' : 'İptal'}
          </button>
          {!isReadOnly && (
            <button type="button" className="btn btn-primary" onClick={handleSave} disabled={loading || !fullProduct}>
              {saveLabel}
            </button>
          )}
        </div>
      </div>
    </div>
  );
}
