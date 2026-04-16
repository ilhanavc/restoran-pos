import { useState, useEffect } from 'react';
import { X, Minus, Plus, Check } from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency } from '../../constants/index.js';

/**
 * Sipariş satırı düzenleme: adet, not, porsiyon, özellikler (gridden açılmaz).
 */
export default function OrderProductDetailModal({
  product,
  onClose,
  onContinue,
  /** { quantity, note, portion_id, selected_attributes } — satırdaki mevcut değerler */
  initialLine = null,
  /** Salt okunur: eski modifier seçenek satırları */
  modifiersDisplay = null,
  readOnlyQuantity = false,
  readOnlyPortion = false,
  readOnlyNote = false,
  /** Özellikler salt okunur (kaydedilmiş siparişler) */
  readOnlyAttributes = false,
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

  // Özellik seçimleri: { [group_id]: Set<option_id> }
  const [attrGroups, setAttrGroups] = useState([]);
  const [attrSelections, setAttrSelections] = useState({});
  const [attrErrors, setAttrErrors] = useState({});

  useEffect(() => {
    let cancelled = false;
    (async () => {
      setLoading(true);
      try {
        // Ürün + özellik gruplarını paralel çek
        const [p, groups] = await Promise.all([
          api.getProduct(product.id),
          api.getEffectiveAttributes(product.id).catch(() => []),
        ]);
        if (cancelled) return;

        setFullProduct(p);

        // Porsiyon
        const portions = p.portions || [];
        if (portions.length === 0) {
          setSelectedPortionId(null);
        } else {
          const fromLine = initialLine?.portion_id;
          const match = fromLine && portions.some((x) => x.id === fromLine);
          const def = portions.find((x) => Number(x.is_default)) || portions[0];
          setSelectedPortionId(match ? fromLine : def.id);
        }

        // Adet + not
        if (initialLine) {
          setQuantity(Math.max(1, Math.floor(Number(initialLine.quantity)) || 1));
          setNote(initialLine.note != null ? String(initialLine.note) : '');
        } else {
          setQuantity(1);
          setNote('');
        }

        // Özellik grupları + mevcut seçimleri yükle
        setAttrGroups(groups);
        if (groups.length > 0) {
          const initSel = {};
          const existingAttrs = initialLine?.selected_attributes || [];
          for (const g of groups) {
            initSel[g.id] = new Set();
            // Önce mevcut seçimleri uygula
            const existing = existingAttrs.filter((a) => a.group_id === g.id);
            if (existing.length > 0) {
              for (const a of existing) initSel[g.id].add(a.option_id);
            } else {
              // Mevcut seçim yoksa varsayılanları ön-seç
              for (const opt of g.options || []) {
                if (Number(opt.is_default)) {
                  if (g.selection_type === 'single') {
                    if (initSel[g.id].size === 0) initSel[g.id].add(opt.id);
                  } else {
                    initSel[g.id].add(opt.id);
                  }
                }
              }
            }
          }
          setAttrSelections(initSel);
        } else {
          setAttrSelections({});
        }
      } catch (e) {
        if (!cancelled) toast.error(e.message || 'Ürün yüklenemedi');
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [product.id, toast, lineKey]); // eslint-disable-line react-hooks/exhaustive-deps

  // ─── Özellik seçim yönetimi ───────────────────────────────────────────────

  const toggleAttr = (group, optionId) => {
    if (readOnlyAttributes || isReadOnly) return;
    setAttrSelections((prev) => {
      const cur = new Set(prev[group.id] || []);
      if (group.selection_type === 'single') {
        cur.has(optionId) ? cur.clear() : (cur.clear(), cur.add(optionId));
      } else {
        cur.has(optionId) ? cur.delete(optionId) : cur.add(optionId);
      }
      return { ...prev, [group.id]: cur };
    });
    setAttrErrors((prev) => { const n = { ...prev }; delete n[group.id]; return n; });
  };

  // Seçilen özelliklerin snapshot'ı (onContinue'ya gönderilecek)
  const buildAttrSnapshot = () => {
    const result = [];
    for (const g of attrGroups) {
      const sel = attrSelections[g.id] || new Set();
      for (const opt of g.options || []) {
        if (sel.has(opt.id)) {
          result.push({
            group_id: g.id,
            group_name: g.name,
            option_id: opt.id,
            option_name: opt.name,
            extra_price: Number(opt.extra_price) || 0,
          });
        }
      }
    }
    return result;
  };

  const calcAttrExtraPrice = () =>
    attrGroups.reduce((sum, g) => {
      const sel = attrSelections[g.id] || new Set();
      for (const opt of g.options || []) {
        if (sel.has(opt.id)) sum += Number(opt.extra_price) || 0;
      }
      return sum;
    }, 0);

  // ─── Kaydet ───────────────────────────────────────────────────────────────

  const handleSave = () => {
    if (!fullProduct || isReadOnly) return;

    // Zorunlu özellik validasyonu
    if (!readOnlyAttributes) {
      const errors = {};
      for (const g of attrGroups) {
        if (Number(g.is_required) && (attrSelections[g.id]?.size || 0) === 0) {
          errors[g.id] = `"${g.name}" zorunludur`;
        }
      }
      if (Object.keys(errors).length > 0) {
        setAttrErrors(errors);
        return;
      }
    }

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

    const selected_attributes = readOnlyAttributes
      ? (initialLine?.selected_attributes || [])
      : buildAttrSnapshot();
    const attrExtraPrice = readOnlyAttributes ? 0 : calcAttrExtraPrice();

    onContinue({
      quantity: readOnlyQuantity ? (initialLine?.quantity ?? qty) : qty,
      note: readOnlyNote ? (initialLine?.note ?? '') : note.trim(),
      effectiveProduct,
      portion_id,
      portion_label,
      selected_attributes,
      attrExtraPrice,
    });
  };

  const portions = fullProduct?.portions || [];
  const showPortionPicker = portions.length > 1 && !readOnlyPortion;
  const defaultSubtitle = 'Adet, not ve porsiyon; Kaydet ile uygulanır.';

  // Toplam ekstra fiyat (anlık gösterim)
  const liveAttrExtra = calcAttrExtraPrice();
  const basePrice = (() => {
    if (!fullProduct) return 0;
    if (portions.length > 0) {
      const sel = portions.find((x) => x.id === selectedPortionId) || portions[0];
      return Number(sel?.price ?? fullProduct.price);
    }
    return Number(fullProduct.price);
  })();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal modal-md order-product-detail-modal"
        onClick={(e) => e.stopPropagation()}
        role="dialog"
        aria-modal="true"
        aria-labelledby="order-product-detail-title"
        style={{ maxHeight: '92vh', display: 'flex', flexDirection: 'column' }}
      >
        <div className="modal-header" style={{ flexShrink: 0 }}>
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

        <div className="modal-body" style={{ paddingTop: 8, overflowY: 'auto', flex: 1 }}>
          {loading ? (
            <div className="empty-state" style={{ padding: 24 }}>Yükleniyor…</div>
          ) : (
            <>
              {/* Eski modifier gösterimi (geriye uyumluluk) */}
              {modifiersDisplay && modifiersDisplay.length > 0 && (
                <div style={{ marginBottom: 14, fontSize: 13, color: 'var(--text-muted)' }}>
                  <span className="order-product-detail-label" style={{ display: 'block', marginBottom: 6 }}>Seçenekler</span>
                  {modifiersDisplay.map((m) => m.name).join(', ')}
                </div>
              )}

              {/* Adet */}
              <div className="order-product-detail-row">
                <span className="order-product-detail-label">Adet</span>
                {readOnlyQuantity || isReadOnly ? (
                  <span style={{ fontWeight: 700, fontSize: 16 }}>{initialLine?.quantity ?? quantity}</span>
                ) : (
                  <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
                    <button type="button" className="btn btn-ghost" style={{ padding: 8, minWidth: 44 }}
                      onClick={() => setQuantity((q) => Math.max(1, q - 1))}>
                      <Minus size={18} />
                    </button>
                    <input type="number" min={1} className="input"
                      style={{ width: 72, textAlign: 'center', fontWeight: 700 }}
                      value={quantity}
                      onChange={(e) => setQuantity(Math.max(1, Math.floor(Number(e.target.value)) || 1))} />
                    <button type="button" className="btn btn-ghost" style={{ padding: 8, minWidth: 44 }}
                      onClick={() => setQuantity((q) => q + 1)}>
                      <Plus size={18} />
                    </button>
                  </div>
                )}
              </div>

              {/* Porsiyon seçici */}
              {showPortionPicker && (
                <div style={{ marginTop: 18 }}>
                  <span className="order-product-detail-label" style={{ display: 'block', marginBottom: 10 }}>Porsiyon</span>
                  <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10 }}>
                    {portions.map((p) => {
                      const sel = p.id === selectedPortionId;
                      return (
                        <button key={p.id} type="button" onClick={() => setSelectedPortionId(p.id)}
                          style={{
                            padding: '12px 16px', borderRadius: 'var(--radius-sm)',
                            border: sel ? '2px solid var(--accent)' : '1px solid var(--border)',
                            background: sel ? 'var(--accent-muted)' : 'var(--bg-tertiary)',
                            color: sel ? 'var(--accent)' : 'var(--text-primary)',
                            cursor: 'pointer', fontWeight: 700, fontFamily: 'inherit', fontSize: 14,
                            minWidth: 120, textAlign: 'center',
                          }}>
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

              {/* Not alanı */}
              <div style={{ marginTop: 18 }}>
                <span className="order-product-detail-label" style={{ display: 'block', marginBottom: 8 }}>Ürün notu</span>
                <textarea className="input" rows={3} placeholder="İsteğe bağlı…"
                  value={readOnlyNote || isReadOnly ? (initialLine?.note ?? '') : note}
                  onChange={(e) => setNote(e.target.value)}
                  readOnly={readOnlyNote || isReadOnly}
                  style={{ width: '100%', resize: 'vertical', minHeight: 72, opacity: readOnlyNote || isReadOnly ? 0.85 : 1 }} />
              </div>

              {/* ─── Özellik Grupları ─── */}
              {attrGroups.length > 0 && (
                <div style={{ marginTop: 20, borderTop: '1px solid var(--border)', paddingTop: 16 }}>
                  <span className="order-product-detail-label" style={{ display: 'block', marginBottom: 14 }}>
                    Özellikler
                    {readOnlyAttributes && (
                      <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8, fontWeight: 400 }}>
                        (salt görüntüleme)
                      </span>
                    )}
                  </span>

                  <div style={{ display: 'flex', flexDirection: 'column', gap: 18 }}>
                    {attrGroups.map((group) => {
                      const groupSel = attrSelections[group.id] || new Set();
                      const isSingle = group.selection_type === 'single';
                      const hasError = !!attrErrors[group.id];

                      return (
                        <div key={group.id}>
                          {/* Grup başlık */}
                          <div style={{ marginBottom: 8 }}>
                            <span style={{
                              fontSize: 13, fontWeight: 700,
                              borderBottom: `2px solid ${hasError ? 'var(--danger)' : 'var(--accent)'}`,
                              paddingBottom: 2,
                              color: hasError ? 'var(--danger)' : 'var(--text-primary)',
                            }}>
                              {group.name}
                            </span>
                            <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                              ({isSingle ? '1 adet seçilebilir' : 'çoklu seçim'}
                              {Number(group.is_required) ? ' · zorunlu' : ''})
                            </span>
                            {hasError && (
                              <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 3 }}>
                                {attrErrors[group.id]}
                              </div>
                            )}
                          </div>

                          {/* Seçenekler */}
                          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8 }}>
                            {(group.options || []).map((opt) => {
                              const isSelected = groupSel.has(opt.id);
                              const disabled = readOnlyAttributes || isReadOnly;
                              return (
                                <button
                                  key={opt.id}
                                  type="button"
                                  onClick={() => toggleAttr(group, opt.id)}
                                  disabled={disabled}
                                  style={{
                                    padding: '9px 14px',
                                    borderRadius: 8,
                                    border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                                    background: isSelected ? 'var(--accent-muted)' : 'var(--bg-tertiary)',
                                    cursor: disabled ? 'default' : 'pointer',
                                    textAlign: 'left',
                                    opacity: disabled ? 0.85 : 1,
                                    position: 'relative',
                                    display: 'flex', alignItems: 'center', gap: 6,
                                  }}
                                >
                                  {isSelected && (
                                    <div style={{
                                      width: 16, height: 16, borderRadius: '50%',
                                      background: 'var(--accent)', flexShrink: 0,
                                      display: 'flex', alignItems: 'center', justifyContent: 'center',
                                    }}>
                                      <Check size={10} color="#fff" />
                                    </div>
                                  )}
                                  <div>
                                    <div style={{ fontSize: 13, fontWeight: 600 }}>{opt.name}</div>
                                    <div style={{ fontSize: 11, color: Number(opt.extra_price) === 0 ? 'var(--accent)' : 'var(--text-secondary)', marginTop: 1 }}>
                                      {Number(opt.extra_price) === 0 ? 'Ücretsiz' : `+${formatCurrency(opt.extra_price)}`}
                                    </div>
                                  </div>
                                </button>
                              );
                            })}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                </div>
              )}
            </>
          )}
        </div>

        <div className="modal-footer" style={{ flexShrink: 0 }}>
          {/* Fiyat özeti */}
          {!loading && attrGroups.length > 0 && !readOnlyAttributes && (
            <div style={{ flex: 1, fontSize: 13 }}>
              <span style={{ color: 'var(--text-muted)' }}>Birim: </span>
              <strong>{formatCurrency(basePrice + liveAttrExtra)}</strong>
              {liveAttrExtra > 0 && (
                <span style={{ fontSize: 11, color: 'var(--accent)', marginLeft: 4 }}>
                  (+{formatCurrency(liveAttrExtra)} ekstra)
                </span>
              )}
            </div>
          )}
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
