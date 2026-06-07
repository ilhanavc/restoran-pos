import { useState, useEffect, useCallback } from 'react';
import { Package, Plus, X, TrendingUp, TrendingDown, AlertTriangle, Edit2, RotateCcw } from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useAuth } from '../../context/AuthContext.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import useConfirmDialog from '../common/useConfirmDialog.js';

const MOVEMENT_TYPES = {
  in:         { label: 'Giriş',      color: 'var(--success)', icon: TrendingUp },
  out:        { label: 'Çıkış',      color: 'var(--danger)',  icon: TrendingDown },
  adjustment: { label: 'Düzeltme',   color: 'var(--info)',    icon: RotateCcw },
  waste:      { label: 'Fire/Kayıp', color: 'var(--warning)', icon: AlertTriangle },
};

function ItemModal({ item, onClose, onSave }) {
  const [form, setForm] = useState({
    name: item?.name || '',
    unit: item?.unit || 'adet',
    quantity: item?.quantity ?? 0,
    min_quantity: item?.min_quantity ?? 0,
    cost_price: item?.cost_price ?? 0,
  });
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Kalem adı gerekli'); return; }
    setSaving(true);
    try {
      const body = { ...form, quantity: Number(form.quantity), min_quantity: Number(form.min_quantity), cost_price: Number(form.cost_price) };
      const result = item?.id
        ? await api.updateStockItem(item.id, body)
        : await api.createStockItem(body);
      onSave(result);
    } catch (err) { toast.error(err.message || 'Kaydedilemedi'); }
    finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{item?.id ? 'Stok Kalemi Düzenle' : 'Yeni Stok Kalemi'}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Kalem Adı *</span>
            <input className="input" value={form.name} onChange={e => set('name', e.target.value)} autoFocus />
          </label>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Birim</span>
              <select className="input" value={form.unit} onChange={e => set('unit', e.target.value)}>
                {['adet', 'kg', 'g', 'lt', 'ml', 'porsiyon', 'paket', 'kutu'].map(u => <option key={u}>{u}</option>)}
              </select>
            </label>
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Maliyet (₺)</span>
              <input className="input" type="number" min={0} step={0.01} value={form.cost_price} onChange={e => set('cost_price', e.target.value)} />
            </label>
            {!item?.id && (
              <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Başlangıç Miktarı</span>
                <input className="input" type="number" min={0} step={0.01} value={form.quantity} onChange={e => set('quantity', e.target.value)} />
              </label>
            )}
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Min. Stok Uyarısı</span>
              <input className="input" type="number" min={0} step={0.01} value={form.min_quantity} onChange={e => set('min_quantity', e.target.value)} />
            </label>
          </div>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Vazgeç</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Kaydediliyor...' : 'Kaydet'}</button>
        </div>
      </div>
    </div>
  );
}

function MovementModal({ item, onClose, onSave }) {
  const [form, setForm] = useState({ movement_type: 'in', quantity: '', notes: '' });
  const [saving, setSaving] = useState(false);
  const toast = useToast();
  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    const qty = Number(form.quantity);
    if (!qty || qty <= 0) { toast.error('Geçerli miktar girin'); return; }
    setSaving(true);
    try {
      await api.createStockMovement({ stock_item_id: item.id, movement_type: form.movement_type, quantity: qty, notes: form.notes || null });
      onSave();
    } catch (err) { toast.error(err.message || 'Kaydedilemedi'); }
    finally { setSaving(false); }
  };

  const mt = MOVEMENT_TYPES[form.movement_type];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-sm" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>Stok Hareketi — {item.name}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body" style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(2, 1fr)', gap: 8 }}>
            {Object.entries(MOVEMENT_TYPES).map(([k, v]) => {
              const Icon = v.icon;
              return (
                <button key={k} type="button"
                  className={form.movement_type === k ? 'btn btn-primary btn-sm' : 'btn btn-ghost btn-sm'}
                  style={{ justifyContent: 'flex-start', gap: 6 }}
                  onClick={() => set('movement_type', k)}>
                  <Icon size={14} /> {v.label}
                </button>
              );
            })}
          </div>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>
              Miktar ({item.unit}) <span style={{ color: mt.color }}>({mt.label})</span>
            </span>
            <input className="input input-lg" type="number" min={0.01} step={0.01} value={form.quantity}
              onChange={e => set('quantity', e.target.value)} autoFocus placeholder="0" style={{ fontSize: 20, fontWeight: 700, textAlign: 'center' }} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Not (opsiyonel)</span>
            <input className="input" value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Sebep, tedarikçi vb." />
          </label>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Vazgeç</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>{saving ? 'Kaydediliyor...' : 'Kaydet'}</button>
        </div>
      </div>
    </div>
  );
}

export default function StockScreen() {
  const [items, setItems] = useState([]);
  const [loading, setLoading] = useState(true);
  const [itemModal, setItemModal] = useState(null); // null | 'new' | {item}
  const [movementModal, setMovementModal] = useState(null); // null | {item}
  const toast = useToast();
  const { hasRole } = useAuth();
  const isAdmin = hasRole('admin');
  const { confirmDialog, requestConfirm, cancelConfirm, acceptConfirm } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      setItems(await api.getStockItems());
    } catch { toast.error('Stok yüklenemedi'); }
    finally { setLoading(false); }
  }, [toast]);

  useEffect(() => { load(); }, [load]);

  const handleDelete = async (id) => {
    requestConfirm({
      title: 'Stok kalemi silinsin mi?',
      body: 'Bu stok kalemi listeden kaldırılacak. Geçmiş hareket kayıtları etkilenmeyebilir.',
      confirmLabel: 'Sil',
      tone: 'danger',
      onConfirm: async () => {
        try { await api.deleteStockItem(id); load(); toast.success('Silindi'); }
        catch (err) { toast.error(err.message); }
      },
    });
  };

  const lowStock = items.filter(i => i.min_quantity > 0 && i.quantity <= i.min_quantity);

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-main page-title-line">
          <h1 className="page-title">
            <Package size={22} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />
            Stok Takibi
          </h1>
        </div>
        {isAdmin && (
          <div className="page-header-actions">
            <button className="btn btn-primary" onClick={() => setItemModal('new')}>
              <Plus size={16} /> Yeni Kalem
            </button>
          </div>
        )}
      </div>
      {lowStock.length > 0 && (
        <div style={{ background: 'var(--danger-muted)', border: '1px solid var(--danger)', borderRadius: 'var(--radius-sm)', padding: '10px 16px', marginBottom: 16, display: 'flex', alignItems: 'center', gap: 8, fontSize: 13, color: 'var(--danger)', fontWeight: 600 }}>
          <AlertTriangle size={16} />
          {lowStock.length} kalem minimum stok altında: {lowStock.map(i => i.name).join(', ')}
        </div>
      )}

      {loading ? (
        <div className="empty-state">Yükleniyor...</div>
      ) : items.length === 0 ? (
        <div className="empty-state" style={{ marginTop: 60 }}>
          <Package size={48} className="empty-state-icon" />
          <div className="empty-state-title">Stok kalemi yok</div>
          {isAdmin && <div className="empty-state-text">"Yeni Kalem" butonu ile stok eklemeye başlayın</div>}
        </div>
      ) : (
        <div className="card" style={{ overflow: 'hidden' }}>
          <table className="data-table">
            <thead>
              <tr>
                <th>Kalem</th>
                <th>Birim</th>
                <th className="text-right">Mevcut</th>
                <th className="text-right">Min.</th>
                <th className="text-right">Maliyet</th>
                <th>Durum</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {items.map(item => {
                const isLow = item.min_quantity > 0 && item.quantity <= item.min_quantity;
                return (
                  <tr key={item.id}>
                    <td style={{ fontWeight: 600 }}>{item.name}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{item.unit}</td>
                    <td className="text-right" style={{ fontWeight: 700, color: isLow ? 'var(--danger)' : 'var(--text-primary)' }}>
                      {item.quantity % 1 === 0 ? item.quantity : item.quantity.toFixed(2)}
                    </td>
                    <td className="text-right" style={{ color: 'var(--text-muted)' }}>
                      {item.min_quantity > 0 ? item.min_quantity : '—'}
                    </td>
                    <td className="text-right" style={{ color: 'var(--text-muted)' }}>
                      {item.cost_price > 0 ? `₺${item.cost_price.toFixed(2)}` : '—'}
                    </td>
                    <td>
                      {isLow ? (
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--danger)', background: 'var(--danger-muted)', padding: '2px 8px', borderRadius: 6 }}>
                          DÜŞÜK
                        </span>
                      ) : (
                        <span style={{ fontSize: 10, fontWeight: 700, color: 'var(--success)', background: 'var(--success-muted)', padding: '2px 8px', borderRadius: 6 }}>
                          OK
                        </span>
                      )}
                    </td>
                    <td>
                      <div style={{ display: 'flex', gap: 4, justifyContent: 'flex-end' }}>
                        <button className="btn btn-ghost btn-sm" onClick={() => setMovementModal(item)} title="Hareket ekle">
                          <Plus size={14} />
                        </button>
                        {isAdmin && (
                          <>
                            <button className="btn btn-ghost btn-sm" onClick={() => setItemModal(item)} title="Düzenle">
                              <Edit2 size={14} />
                            </button>
                            <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleDelete(item.id)} title="Sil">
                              <X size={14} />
                            </button>
                          </>
                        )}
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      {itemModal && (
        <ItemModal
          item={itemModal === 'new' ? null : itemModal}
          onClose={() => setItemModal(null)}
          onSave={() => { setItemModal(null); load(); toast.success('Kaydedildi'); }}
        />
      )}
      {movementModal && (
        <MovementModal
          item={movementModal}
          onClose={() => setMovementModal(null)}
          onSave={() => { setMovementModal(null); load(); toast.success('Hareket kaydedildi'); }}
        />
      )}
      <ConfirmDialog
        open={!!confirmDialog}
        title={confirmDialog?.title}
        body={confirmDialog?.body}
        confirmLabel={confirmDialog?.confirmLabel}
        tone={confirmDialog?.tone}
        onCancel={cancelConfirm}
        onConfirm={acceptConfirm}
      />
    </div>
  );
}
