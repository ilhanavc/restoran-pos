import { useState, useEffect, useCallback } from 'react';
import { CalendarDays, Plus, X, Users, Clock, Phone, Edit2, Trash2, Check } from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';

const STATUS_LABELS = {
  confirmed: { label: 'Onaylı', color: 'var(--info)', bg: 'var(--info-muted)' },
  arrived:   { label: 'Geldi',  color: 'var(--success)', bg: 'var(--success-muted)' },
  cancelled: { label: 'İptal',  color: 'var(--danger)', bg: 'rgba(239,68,68,0.08)' },
  no_show:   { label: 'Gelmedi', color: 'var(--text-muted)', bg: 'var(--bg-tertiary)' },
};

function today() { return new Date().toISOString().slice(0, 10); }

function ReservationModal({ reservation, tables, onClose, onSave }) {
  const [form, setForm] = useState({
    customer_name: reservation?.customer_name || '',
    customer_phone: reservation?.customer_phone || '',
    party_size: reservation?.party_size ?? 2,
    reservation_date: reservation?.reservation_date || today(),
    reservation_time: reservation?.reservation_time || '19:00',
    table_id: reservation?.table_id || '',
    notes: reservation?.notes || '',
    status: reservation?.status || 'confirmed',
  });
  const [saving, setSaving] = useState(false);
  const toast = useToast();

  const set = (k, v) => setForm(f => ({ ...f, [k]: v }));

  const handleSave = async () => {
    if (!form.customer_name.trim()) { toast.error('Müşteri adı gerekli'); return; }
    if (!form.reservation_date || !form.reservation_time) { toast.error('Tarih ve saat gerekli'); return; }
    setSaving(true);
    try {
      const body = { ...form, table_id: form.table_id || null, party_size: Number(form.party_size) };
      const result = reservation?.id
        ? await api.updateReservation(reservation.id, body)
        : await api.createReservation(body);
      onSave(result);
    } catch (err) {
      toast.error(err.message || 'Kaydedilemedi');
    } finally { setSaving(false); }
  };

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div className="modal modal-md" onClick={e => e.stopPropagation()}>
        <div className="modal-header">
          <h2>{reservation?.id ? 'Rezervasyon Düzenle' : 'Yeni Rezervasyon'}</h2>
          <button className="btn btn-ghost btn-icon" onClick={onClose}><X size={16} /></button>
        </div>
        <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 12 }}>
          <label style={{ gridColumn: '1/-1', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Müşteri Adı *</span>
            <input className="input" value={form.customer_name} onChange={e => set('customer_name', e.target.value)} placeholder="Ad Soyad" autoFocus />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Telefon</span>
            <input className="input" type="tel" value={form.customer_phone} onChange={e => set('customer_phone', e.target.value)} placeholder="05XX..." />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Kişi Sayısı</span>
            <input className="input" type="number" min={1} max={100} value={form.party_size} onChange={e => set('party_size', e.target.value)} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Tarih *</span>
            <input className="input" type="date" value={form.reservation_date} onChange={e => set('reservation_date', e.target.value)} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Saat *</span>
            <input className="input" type="time" value={form.reservation_time} onChange={e => set('reservation_time', e.target.value)} />
          </label>
          <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Masa</span>
            <select className="input" value={form.table_id} onChange={e => set('table_id', e.target.value)}>
              <option value="">— Seçilmedi —</option>
              {tables.map(t => <option key={t.id} value={t.id}>{t.name}</option>)}
            </select>
          </label>
          {reservation?.id && (
            <label style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Durum</span>
              <select className="input" value={form.status} onChange={e => set('status', e.target.value)}>
                {Object.entries(STATUS_LABELS).map(([k, v]) => <option key={k} value={k}>{v.label}</option>)}
              </select>
            </label>
          )}
          <label style={{ gridColumn: '1/-1', display: 'flex', flexDirection: 'column', gap: 4 }}>
            <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Not</span>
            <textarea className="input" rows={2} value={form.notes} onChange={e => set('notes', e.target.value)} placeholder="Özel istek, allerji vb." style={{ resize: 'vertical' }} />
          </label>
        </div>
        <div className="modal-footer">
          <button className="btn btn-ghost" onClick={onClose}>Vazgeç</button>
          <button className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Kaydediliyor...' : 'Kaydet'}
          </button>
        </div>
      </div>
    </div>
  );
}

export default function ReservationsScreen() {
  const [reservations, setReservations] = useState([]);
  const [tables, setTables] = useState([]);
  const [selectedDate, setSelectedDate] = useState(today());
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [editingReservation, setEditingReservation] = useState(null);
  const toast = useToast();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [res, tData] = await Promise.all([
        api.getReservations({ date: selectedDate }),
        api.getTables(),
      ]);
      setReservations(res);
      setTables(tData.flatMap(a => a.tables || []));
    } catch {
      toast.error('Rezervasyonlar yüklenemedi');
    } finally { setLoading(false); }
  }, [selectedDate, toast]);

  useEffect(() => { load(); }, [load]);

  const handleSave = (result) => {
    setModalOpen(false);
    setEditingReservation(null);
    load();
    toast.success('Rezervasyon kaydedildi');
  };

  const handleDelete = async (id) => {
    if (!window.confirm('Bu rezervasyonu silmek istiyor musunuz?')) return;
    try {
      await api.deleteReservation(id);
      toast.success('Silindi');
      load();
    } catch (err) { toast.error(err.message); }
  };

  const handleStatusQuick = async (id, status) => {
    try {
      await api.updateReservation(id, { status });
      load();
    } catch (err) { toast.error(err.message); }
  };

  const grouped = reservations.reduce((acc, r) => {
    const h = r.reservation_time.slice(0, 2);
    (acc[h] = acc[h] || []).push(r);
    return acc;
  }, {});
  const hours = Object.keys(grouped).sort();

  return (
    <div className="page-container">
      <div className="page-header">
        <h1 className="page-title">
          <CalendarDays size={22} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />
          Rezervasyonlar
        </h1>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <input type="date" className="input" value={selectedDate}
            onChange={e => setSelectedDate(e.target.value)} style={{ width: 180 }} />
          <button className="btn btn-primary" onClick={() => { setEditingReservation(null); setModalOpen(true); }}>
            <Plus size={16} /> Yeni
          </button>
        </div>
      </div>

      {loading ? (
        <div className="empty-state">Yükleniyor...</div>
      ) : reservations.length === 0 ? (
        <div className="empty-state" style={{ marginTop: 60 }}>
          <CalendarDays size={48} className="empty-state-icon" />
          <div className="empty-state-title">Bu tarihte rezervasyon yok</div>
          <div className="empty-state-text">Yeni eklemek için "Yeni" butonunu kullanın</div>
        </div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 24, marginTop: 8 }}>
          {hours.map(h => (
            <div key={h}>
              <div style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', marginBottom: 10, display: 'flex', alignItems: 'center', gap: 6 }}>
                <Clock size={13} /> {h}:00 — {h}:59
                <span style={{ background: 'var(--bg-tertiary)', borderRadius: 10, padding: '1px 8px', fontSize: 11 }}>{grouped[h].length}</span>
              </div>
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(300px, 1fr))', gap: 12 }}>
                {grouped[h].map(r => {
                  const st = STATUS_LABELS[r.status] || STATUS_LABELS.confirmed;
                  return (
                    <div key={r.id} className="card card-padded" style={{ borderLeft: `3px solid ${st.color}` }}>
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 }}>
                        <div>
                          <div style={{ fontWeight: 700, fontSize: 15 }}>{r.customer_name}</div>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 2, display: 'flex', gap: 10 }}>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Clock size={11} /> {r.reservation_time}</span>
                            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Users size={11} /> {r.party_size} kişi</span>
                            {r.customer_phone && <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}><Phone size={11} /> {r.customer_phone}</span>}
                          </div>
                          {r.table_name && <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 3 }}>Masa: {r.table_name}</div>}
                          {r.notes && <div style={{ fontSize: 11, color: 'var(--warning)', marginTop: 4, fontStyle: 'italic' }}>{r.notes}</div>}
                        </div>
                        <span style={{ fontSize: 10, fontWeight: 700, padding: '3px 8px', borderRadius: 6, background: st.bg, color: st.color, whiteSpace: 'nowrap' }}>
                          {st.label}
                        </span>
                      </div>
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap', borderTop: '1px solid var(--border)', paddingTop: 8, marginTop: 4 }}>
                        {r.status === 'confirmed' && (
                          <button className="btn btn-success btn-sm" onClick={() => handleStatusQuick(r.id, 'arrived')}>
                            <Check size={12} /> Geldi
                          </button>
                        )}
                        {r.status !== 'cancelled' && r.status !== 'no_show' && (
                          <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleStatusQuick(r.id, 'cancelled')}>
                            İptal
                          </button>
                        )}
                        <button className="btn btn-ghost btn-sm" style={{ marginLeft: 'auto' }} onClick={() => { setEditingReservation(r); setModalOpen(true); }}>
                          <Edit2 size={12} />
                        </button>
                        <button className="btn btn-ghost btn-sm" style={{ color: 'var(--danger)' }} onClick={() => handleDelete(r.id)}>
                          <Trash2 size={12} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          ))}
        </div>
      )}

      {modalOpen && (
        <ReservationModal
          reservation={editingReservation}
          tables={tables}
          onClose={() => { setModalOpen(false); setEditingReservation(null); }}
          onSave={handleSave}
        />
      )}
    </div>
  );
}
