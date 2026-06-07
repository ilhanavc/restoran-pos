import { useState } from 'react';
import { X } from 'lucide-react';
import { formatCurrency } from '../../constants/index.js';

export default function ModifierModal({ product, groups, onConfirm, onClose }) {
  const [selected, setSelected] = useState({});

  const toggle = (groupName, mod) => {
    setSelected((prev) => {
      const current = prev[groupName] || [];
      const exists = current.find((m) => m.id === mod.id);
      if (exists) return { ...prev, [groupName]: current.filter((m) => m.id !== mod.id) };
      return { ...prev, [groupName]: [...current, mod] };
    });
  };

  const allSelected = Object.values(selected).flat();

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={(e) => e.stopPropagation()}>
        <div className="modal-header">
          <div>
            <h2>{product.name}</h2>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2 }}>Seçenekleri belirleyin</div>
          </div>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body">
          {Object.entries(groups).map(([groupName, mods]) => (
            <div key={groupName} style={{ marginBottom: 16 }}>
              <div style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 8 }}>
                {groupName}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}>
                {mods.map((mod) => {
                  const isSelected = (selected[groupName] || []).find((m) => m.id === mod.id);
                  return (
                    <button
                      key={mod.id}
                      onClick={() => toggle(groupName, mod)}
                      style={{
                        padding: '8px 14px',
                        borderRadius: 'var(--radius-sm)',
                        border: `1.5px solid ${isSelected ? 'var(--accent)' : 'var(--border)'}`,
                        background: isSelected ? 'var(--accent-muted)' : 'var(--bg-tertiary)',
                        color: isSelected ? 'var(--accent)' : 'var(--text-secondary)',
                        cursor: 'pointer',
                        fontSize: 12,
                        fontWeight: 600,
                        fontFamily: 'inherit',
                      }}
                    >
                      {mod.name}
                      {mod.price_delta !== 0 && (
                        <span style={{ marginLeft: 4, fontSize: 10, opacity: 0.7 }}>
                          {mod.price_delta > 0 ? '+' : ''}{formatCurrency(mod.price_delta)}
                        </span>
                      )}
                    </button>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Vazgeç</button>
          <button className="btn btn-primary" onClick={() => onConfirm(allSelected)}>
            Ekle {allSelected.length > 0 && `(${allSelected.length})`}
          </button>
        </div>
      </div>
    </div>
  );
}
