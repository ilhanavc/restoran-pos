import { useState, useEffect } from 'react';
import { X, Check } from 'lucide-react';
import { formatCurrency } from '../../constants/index.js';

/**
 * Ürün özellik seçim modalı.
 *
 * Props:
 *   product        – { id, name, price } (efektif fiyat zaten çözülmüş olmalı)
 *   portions       – mevcut porsiyon listesi (varsa)
 *   pendingLine    – { quantity, note, portion_id, portion_label }
 *   attributeGroups – [{ id, name, selection_type, is_required, options: [{id,name,extra_price,is_default}] }]
 *   onConfirm      – (selections: [{group_id, option_ids[]}], totalExtraPrice) => void
 *   onCancel       – () => void
 */
export default function AttributePickerModal({
  product,
  portions = [],
  pendingLine = {},
  attributeGroups = [],
  onConfirm,
  onCancel,
}) {
  // selections: { [group_id]: Set<option_id> }
  const [selections, setSelections] = useState(() => {
    const init = {};
    for (const g of attributeGroups) {
      init[g.id] = new Set();
      // Varsayılan seçenekleri ön-seç
      for (const opt of g.options || []) {
        if (Number(opt.is_default)) {
          if (g.selection_type === 'single') {
            // Tekli seçimde yalnızca ilk varsayılanı al
            if (init[g.id].size === 0) init[g.id].add(opt.id);
          } else {
            init[g.id].add(opt.id);
          }
        }
      }
    }
    return init;
  });

  const [validationErrors, setValidationErrors] = useState({});

  // ─── Seçim yönetimi ──────────────────────────────────────────────────────

  const toggleOption = (group, optionId) => {
    setSelections((prev) => {
      const cur = new Set(prev[group.id] || []);
      if (group.selection_type === 'single') {
        // Tekli: sadece tıklanan seçili olsun
        if (cur.has(optionId)) {
          cur.clear();
        } else {
          cur.clear();
          cur.add(optionId);
        }
      } else {
        // Çoklu: toggle
        if (cur.has(optionId)) {
          cur.delete(optionId);
        } else {
          cur.add(optionId);
        }
      }
      return { ...prev, [group.id]: cur };
    });
    // Hata temizle
    setValidationErrors((prev) => {
      const next = { ...prev };
      delete next[group.id];
      return next;
    });
  };

  // ─── Ekstra tutar hesapla ─────────────────────────────────────────────────

  const totalExtraPrice = attributeGroups.reduce((sum, g) => {
    const sel = selections[g.id] || new Set();
    for (const opt of g.options || []) {
      if (sel.has(opt.id)) sum += Number(opt.extra_price) || 0;
    }
    return sum;
  }, 0);

  const basePrice = Number(product?.price) || 0;
  const displayPrice = basePrice + totalExtraPrice;

  // ─── Doğrulama ve onay ───────────────────────────────────────────────────

  const handleConfirm = () => {
    const errors = {};
    for (const g of attributeGroups) {
      if (Number(g.is_required) && (selections[g.id]?.size || 0) === 0) {
        errors[g.id] = `"${g.name}" grubu zorunludur`;
      }
    }
    if (Object.keys(errors).length > 0) {
      setValidationErrors(errors);
      return;
    }

    const result = attributeGroups
      .filter((g) => (selections[g.id]?.size || 0) > 0)
      .map((g) => ({
        group_id: g.id,
        option_ids: Array.from(selections[g.id]),
      }));

    onConfirm(result, totalExtraPrice);
  };

  // ─── Klavye ──────────────────────────────────────────────────────────────

  useEffect(() => {
    const handler = (e) => {
      if (e.key === 'Escape') onCancel();
    };
    document.addEventListener('keydown', handler);
    return () => document.removeEventListener('keydown', handler);
  }, [onCancel]);

  // ─── Render ──────────────────────────────────────────────────────────────

  return (
    <div
      className="modal-overlay"
      onClick={(e) => { if (e.target === e.currentTarget) onCancel(); }}
      style={{ zIndex: 500 }}
    >
      <div
        role="dialog"
        aria-modal="true"
        className="modal"
        style={{ maxWidth: 600, width: '100%', maxHeight: '90vh', display: 'flex', flexDirection: 'column' }}
        onClick={(e) => e.stopPropagation()}
      >
        {/* Başlık */}
        <div className="modal-header" style={{ flexShrink: 0 }}>
          <div>
            <h2 style={{ margin: 0, fontSize: 17, fontWeight: 800 }}>
              Çoklu Seçim{' '}
              <span style={{ fontWeight: 400, color: 'var(--text-secondary)' }}>
                ({product?.name})
              </span>
            </h2>
            <p style={{ margin: '4px 0 0', fontSize: 12, color: 'var(--text-muted)' }}>
              Özellik, porsiyon ve reçete seçimini hızlı bir şekilde yapabilirsiniz
            </p>
          </div>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onCancel}>
            <X size={18} />
          </button>
        </div>

        {/* İçerik */}
        <div style={{ overflowY: 'auto', flex: 1, padding: '4px 0' }}>

          {/* Porsiyonlar (salt okunur – burada değiştirilmez) */}
          {portions.length > 0 && (
            <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12,
              }}>
                <span style={{ fontSize: 14, fontWeight: 800 }}>Porsiyonlar</span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>
              <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
                {portions.map((p) => {
                  const isActive = pendingLine.portion_id === p.id;
                  return (
                    <div
                      key={p.id}
                      style={{
                        padding: '8px 16px',
                        borderRadius: 999,
                        border: `2px solid ${isActive ? 'var(--accent)' : 'var(--border)'}`,
                        background: isActive ? 'var(--accent-muted)' : 'transparent',
                        fontSize: 13, fontWeight: 600,
                        color: isActive ? 'var(--accent)' : 'var(--text-primary)',
                      }}
                    >
                      {p.label}{' '}
                      <span style={{ fontWeight: 400 }}>
                        {formatCurrency(p.price)}
                      </span>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* Özellik grupları */}
          {attributeGroups.length > 0 && (
            <div style={{ padding: '16px 20px' }}>
              <div style={{
                display: 'flex', alignItems: 'center', gap: 8, marginBottom: 16,
              }}>
                <span style={{ fontSize: 14, fontWeight: 800 }}>Özellikler</span>
                <div style={{ flex: 1, height: 1, background: 'var(--border)' }} />
              </div>

              <div style={{ display: 'flex', flexDirection: 'column', gap: 24 }}>
                {attributeGroups.map((group) => {
                  const groupSel = selections[group.id] || new Set();
                  const isSingle = group.selection_type === 'single';
                  const hasError = !!validationErrors[group.id];

                  return (
                    <div key={group.id}>
                      {/* Grup başlığı */}
                      <div style={{ marginBottom: 10 }}>
                        <span
                          style={{
                            fontSize: 13, fontWeight: 800,
                            borderBottom: `2px solid ${hasError ? 'var(--danger)' : 'var(--accent)'}`,
                            paddingBottom: 2,
                            color: hasError ? 'var(--danger)' : 'var(--text-primary)',
                          }}
                        >
                          {group.name}
                        </span>
                        <span style={{ fontSize: 11, color: 'var(--text-muted)', marginLeft: 8 }}>
                          ({isSingle ? '1 adet özellik seçilebilir' : 'birden fazla seçilebilir'}
                          {Number(group.is_required) ? ' · zorunlu' : ''})
                        </span>
                        {hasError && (
                          <div style={{ fontSize: 11, color: 'var(--danger)', marginTop: 4 }}>
                            {validationErrors[group.id]}
                          </div>
                        )}
                      </div>

                      {/* Seçenekler */}
                      <div
                        style={{
                          display: 'grid',
                          gridTemplateColumns: 'repeat(auto-fill, minmax(180px, 1fr))',
                          gap: 8,
                        }}
                      >
                        {(group.options || []).map((opt) => {
                          const isSelected = groupSel.has(opt.id);
                          return (
                            <button
                              key={opt.id}
                              type="button"
                              onClick={() => toggleOption(group, opt.id)}
                              style={{
                                padding: '12px 14px',
                                borderRadius: 10,
                                border: `2px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                                background: isSelected ? 'var(--accent-muted)' : 'var(--bg-card)',
                                cursor: 'pointer',
                                textAlign: 'left',
                                position: 'relative',
                                transition: 'border-color 0.15s, background 0.15s',
                              }}
                            >
                              {isSelected && (
                                <div
                                  style={{
                                    position: 'absolute', top: 6, right: 6,
                                    width: 16, height: 16, borderRadius: '50%',
                                    background: 'var(--accent)',
                                    display: 'flex', alignItems: 'center', justifyContent: 'center',
                                  }}
                                >
                                  <Check size={10} color="#fff" />
                                </div>
                              )}
                              <div style={{ fontSize: 13, fontWeight: 600, marginBottom: 2 }}>
                                {opt.name}
                              </div>
                              <div
                                style={{
                                  fontSize: 12,
                                  color: Number(opt.extra_price) === 0 ? 'var(--accent)' : 'var(--text-secondary)',
                                  fontWeight: 500,
                                }}
                              >
                                {Number(opt.extra_price) === 0
                                  ? 'Ücretsiz'
                                  : `+${formatCurrency(opt.extra_price)}`}
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
        </div>

        {/* Alt bar */}
        <div
          style={{
            padding: '14px 20px',
            borderTop: '1px solid var(--border)',
            display: 'flex',
            alignItems: 'center',
            justifyContent: 'space-between',
            flexShrink: 0,
            gap: 12,
          }}
        >
          <div>
            <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>Toplam</span>
            <div style={{ fontSize: 18, fontWeight: 800, color: 'var(--text-primary)' }}>
              {formatCurrency(displayPrice)}
              {totalExtraPrice > 0 && (
                <span style={{ fontSize: 12, color: 'var(--accent)', marginLeft: 6, fontWeight: 500 }}>
                  (+{formatCurrency(totalExtraPrice)} ekstra)
                </span>
              )}
            </div>
          </div>
          <div style={{ display: 'flex', gap: 10 }}>
            <button type="button" className="btn btn-ghost" onClick={onCancel}
              style={{ color: 'var(--accent)', fontWeight: 600 }}>
              İptal
            </button>
            <button type="button" className="btn btn-primary" onClick={handleConfirm}>
              Tamam
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
