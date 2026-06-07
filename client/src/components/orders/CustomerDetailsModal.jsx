import { useEffect, useRef, useState } from 'react';
import { X, Plus, Trash2, MapPin, Search, ChevronLeft } from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';

const EMPTY_ADDRESS = {
  title: '',
  address: '',
  note: '',
  province: '',
  district: '',
  neighborhood: '',
  is_default: false,
};

function splitFullNameFallback(full) {
  const trimmed = (full || '').trim();
  if (!trimmed) return { first: '', last: '' };
  const idx = trimmed.indexOf(' ');
  if (idx === -1) return { first: trimmed, last: '' };
  return { first: trimmed.slice(0, idx), last: trimmed.slice(idx + 1).trim() };
}

function formatAddressOneLine(a) {
  if (!a) return '';
  const parts = [a.title, a.address, [a.province, a.district, a.neighborhood].filter(Boolean).join(' / ')];
  return parts.filter(Boolean).join(' — ');
}

export default function CustomerDetailsModal({
  customerId,
  initialCustomer,
  onClose,
  onClearSelection,
  onSaved,
  onSelectCustomer,
  onCreateNew,
}) {
  const { show } = useToast();

  // 'list' = Adisyo-tarzı arama+kart listesi, 'edit' = form
  const [view, setView] = useState('list');

  // Edit view state
  const [editLoading, setEditLoading] = useState(false);
  const [saving, setSaving] = useState(false);
  const [customer, setCustomer] = useState(initialCustomer || null);
  const [form, setForm] = useState(() => {
    const phones = Array.isArray(initialCustomer?.phones) ? initialCustomer.phones : [];
    let firstName = initialCustomer?.first_name || '';
    let lastName = initialCustomer?.last_name || '';
    if (!firstName && !lastName) {
      const split = splitFullNameFallback(initialCustomer?.full_name);
      firstName = split.first;
      lastName = split.last;
    }
    return {
      first_name: firstName,
      last_name: lastName,
      phone: phones[0]?.phone || '',
      phone_2: phones[1]?.phone || '',
      note: initialCustomer?.note || '',
    };
  });
  const [addressEditor, setAddressEditor] = useState(null);
  const [confirm, setConfirm] = useState(null);
  const [editingCustomerId, setEditingCustomerId] = useState(customerId);

  // List view state
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [searchLoading, setSearchLoading] = useState(false);
  const searchDebounceRef = useRef(null);

  // Fetch fresh customer when entering edit view
  useEffect(() => {
    if (view !== 'edit' || !editingCustomerId) return undefined;
    let cancelled = false;
    (async () => {
      setEditLoading(true);
      try {
        const data = await api.getCustomer(editingCustomerId);
        if (cancelled) return;
        setCustomer(data);
        const phones = Array.isArray(data.phones) ? data.phones : [];
        let firstName = data.first_name || '';
        let lastName = data.last_name || '';
        if (!firstName && !lastName) {
          const split = splitFullNameFallback(data.full_name);
          firstName = split.first;
          lastName = split.last;
        }
        setForm({
          first_name: firstName,
          last_name: lastName,
          phone: phones[0]?.phone || '',
          phone_2: phones[1]?.phone || '',
          note: data.note || '',
        });
      } catch (err) {
        show(err?.response?.data?.error || 'Müşteri bilgileri yüklenemedi', 'error');
      } finally {
        if (!cancelled) setEditLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [view, editingCustomerId]); // eslint-disable-line react-hooks/exhaustive-deps

  // Debounced search when in list view
  useEffect(() => {
    if (view !== 'list') return undefined;
    if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current);
    const q = searchQuery.trim();
    if (q.length < 2) {
      setSearchResults([]);
      setSearchLoading(false);
      return undefined;
    }
    setSearchLoading(true);
    searchDebounceRef.current = setTimeout(async () => {
      try {
        const resp = await api.getCustomers({ search: q, page: 1, limit: 20 });
        const list = Array.isArray(resp?.customers) ? resp.customers : (Array.isArray(resp) ? resp : []);
        setSearchResults(list);
      } catch {
        setSearchResults([]);
      } finally {
        setSearchLoading(false);
      }
    }, 300);
    return () => { if (searchDebounceRef.current) clearTimeout(searchDebounceRef.current); };
  }, [searchQuery, view]);

  async function reloadEditCustomer() {
    if (!editingCustomerId) return;
    try {
      const data = await api.getCustomer(editingCustomerId);
      setCustomer(data);
    } catch (err) {
      show(err?.response?.data?.error || 'Müşteri güncel veriler okunamadı', 'error');
    }
  }

  async function handleSave() {
    if (!form.first_name.trim()) {
      show('Müşteri adı zorunludur', 'error');
      return;
    }
    if (!editingCustomerId) return;
    setSaving(true);
    try {
      await api.updateCustomer(editingCustomerId, {
        first_name: form.first_name.trim(),
        last_name: form.last_name.trim(),
        note: form.note.trim() || null,
      });
      const existing = Array.isArray(customer?.phones) ? customer.phones : [];
      const desired = [form.phone.trim(), form.phone_2.trim()];
      for (let i = 0; i < 2; i++) {
        const existingPhone = existing[i];
        const desiredPhone = desired[i];
        if (desiredPhone && !existingPhone) {
          await api.addCustomerPhone(editingCustomerId, desiredPhone);
        } else if (!desiredPhone && existingPhone) {
          await api.deleteCustomerPhone(editingCustomerId, existingPhone.id);
        } else if (desiredPhone && existingPhone && desiredPhone !== existingPhone.phone) {
          await api.deleteCustomerPhone(editingCustomerId, existingPhone.id);
          await api.addCustomerPhone(editingCustomerId, desiredPhone);
        }
      }
      show('Müşteri güncellendi', 'success');
      const fresh = await api.getCustomer(editingCustomerId);
      onSaved?.(fresh);
      // Eğer düzenlenen kişi şu an seçili kişi ise, parent state'i güncellendi.
      // Listeye dön ve arama tazele.
      setView('list');
    } catch (err) {
      show(err?.response?.data?.error || 'Güncelleme başarısız', 'error');
    } finally {
      setSaving(false);
    }
  }

  function openNewAddress() { setAddressEditor({ ...EMPTY_ADDRESS }); }
  function openEditAddress(addr) {
    setAddressEditor({
      id: addr.id,
      title: addr.title || '',
      address: addr.address || '',
      note: addr.note || '',
      province: addr.province || '',
      district: addr.district || '',
      neighborhood: addr.neighborhood || '',
      is_default: !!addr.is_default,
    });
  }
  async function handleAddressSave() {
    if (!addressEditor.address.trim()) {
      show('Adres alanı zorunludur', 'error');
      return;
    }
    try {
      const payload = {
        title: addressEditor.title.trim() || null,
        address: addressEditor.address.trim(),
        note: addressEditor.note.trim() || null,
        province: addressEditor.province.trim() || null,
        district: addressEditor.district.trim() || null,
        neighborhood: addressEditor.neighborhood.trim() || null,
        is_default: !!addressEditor.is_default,
      };
      if (addressEditor.id) {
        await api.updateCustomerAddress(editingCustomerId, addressEditor.id, payload);
      } else {
        await api.addCustomerAddress(editingCustomerId, payload);
      }
      setAddressEditor(null);
      await reloadEditCustomer();
      show('Adres kaydedildi', 'success');
    } catch (err) {
      show(err?.response?.data?.error || 'Adres kaydedilemedi', 'error');
    }
  }
  function handleAddressDelete(addr) {
    setConfirm({
      title: 'Adresi sil',
      message: `"${addr.title || addr.address}" silinsin mi?`,
      onConfirm: async () => {
        try {
          await api.deleteCustomerAddress(editingCustomerId, addr.id);
          await reloadEditCustomer();
          show('Adres silindi', 'success');
        } catch (err) {
          show(err?.response?.data?.error || 'Adres silinemedi', 'error');
        } finally {
          setConfirm(null);
        }
      },
    });
  }

  function pickAndClose(c) {
    // Seçim pending olarak parent'a iletiliyor — parent Kaydet'e basılana
    // kadar sipariş müşterisini değiştirmiyor.
    onSelectCustomer?.(c);
    onClose?.();
  }

  function goEdit(c) {
    setEditingCustomerId(c.id);
    setCustomer(c);
    const phones = Array.isArray(c.phones) ? c.phones : [];
    let firstName = c.first_name || '';
    let lastName = c.last_name || '';
    if (!firstName && !lastName) {
      const split = splitFullNameFallback(c.full_name);
      firstName = split.first;
      lastName = split.last;
    }
    setForm({
      first_name: firstName,
      last_name: lastName,
      phone: phones[0]?.phone || c.phone || '',
      phone_2: phones[1]?.phone || '',
      note: c.note || '',
    });
    setView('edit');
  }

  // Listede gösterilecek: arama varsa sonuçlar; yoksa mevcut seçili (initialCustomer) kartı
  const listRows = (() => {
    if (searchQuery.trim().length >= 2) return searchResults;
    if (customer && customer.id) return [customer];
    if (initialCustomer && initialCustomer.id) return [initialCustomer];
    return [];
  })();

  const addresses = Array.isArray(customer?.addresses) ? customer.addresses : [];

  return (
    <div className="modal-overlay" onClick={onClose}>
      <div
        className="modal modal-md"
        onClick={(e) => e.stopPropagation()}
        style={{ width: 720, maxWidth: '94vw' }}
      >
        <div className="modal-header">
          <h2 style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
            {view === 'edit' && (
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => setView('list')} title="Geri">
                <ChevronLeft size={16} />
              </button>
            )}
            Müşteri Bilgileri
          </h2>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} title="Kapat">
            <X size={16} />
          </button>
        </div>

        {view === 'list' && (
          <>
            <div className="modal-body">
              <div style={{ display: 'flex', gap: 8, marginBottom: 12 }}>
                <div style={{ position: 'relative', flex: 1 }}>
                  <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }} />
                  <input
                    className="input"
                    placeholder="Müşteri adı, telefon numarası"
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    style={{ paddingLeft: 30 }}
                    autoFocus
                  />
                </div>
                {onCreateNew && (
                  <button type="button" className="btn btn-danger" onClick={() => { onClose?.(); onCreateNew(); }}>Yeni</button>
                )}
              </div>

              {searchQuery.trim().length < 2 && (
                <div style={{ color: 'var(--text-muted)', fontSize: 13, marginBottom: 8 }}>
                  Seçmek istediğiniz müşteriyi arama yaparak bulabilirsiniz
                </div>
              )}

              {searchLoading && (
                <div style={{ color: 'var(--text-muted)', padding: 10 }}>Aranıyor…</div>
              )}

              {!searchLoading && listRows.length === 0 && searchQuery.trim().length >= 2 && (
                <div style={{ color: 'var(--text-muted)', padding: 10 }}>Sonuç bulunamadı</div>
              )}

              <div style={{ display: 'flex', flexDirection: 'column', gap: 8, maxHeight: 420, overflowY: 'auto' }}>
                {listRows.map((c) => {
                  const name = c.full_name || `${c.first_name || ''} ${c.last_name || ''}`.trim();
                  const primaryPhone = c.phone || c.phones?.[0]?.phone || '';
                  const addrs = Array.isArray(c.addresses) ? c.addresses : [];
                  return (
                    <div
                      key={c.id}
                      style={{
                        border: '1px solid var(--border)',
                        borderRadius: 8,
                        padding: 12,
                        display: 'flex',
                        flexDirection: 'column',
                        gap: 8,
                      }}
                    >
                      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', gap: 8 }}>
                        <div style={{ minWidth: 0 }}>
                          <div style={{ fontWeight: 700, fontSize: 15 }}>{name || '—'}</div>
                          {primaryPhone && (
                            <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Telefon: {primaryPhone}</div>
                          )}
                        </div>
                        <div style={{ display: 'flex', gap: 6 }}>
                          <button type="button" className="btn btn-ghost" onClick={() => goEdit(c)}>Düzenle</button>
                          <button type="button" className="btn btn-primary" onClick={() => pickAndClose(c)}>Seç</button>
                        </div>
                      </div>
                      {addrs.length > 0 && (
                        <div style={{ borderTop: '1px dashed var(--border)', paddingTop: 8 }}>
                          <div style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 4 }}>Tanımlı Adresler</div>
                          {addrs.map((a) => (
                            <div key={a.id} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
                              <MapPin size={12} />
                              <span style={{ fontWeight: 600 }}>{a.title || 'Adres'}</span>
                              <span style={{ color: 'var(--text-muted)' }}>{formatAddressOneLine({ ...a, title: '' })}</span>
                            </div>
                          ))}
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>

            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <button type="button" className="btn btn-ghost" onClick={onClose}>Kapat</button>
              {onClearSelection && initialCustomer?.id && (
                <button type="button" className="btn btn-warning" onClick={onClearSelection}>Seçimi Kaldır</button>
              )}
            </div>
          </>
        )}

        {view === 'edit' && (
          <>
            {editLoading ? (
              <div className="modal-body" style={{ textAlign: 'center', color: 'var(--text-muted)' }}>Yükleniyor…</div>
            ) : (
              <div className="modal-body">
                <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
                  <div>
                    <label className="label">Müşteri Adı *</label>
                    <input className="input" value={form.first_name} onChange={(e) => setForm((s) => ({ ...s, first_name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Müşteri Soyadı</label>
                    <input className="input" value={form.last_name} onChange={(e) => setForm((s) => ({ ...s, last_name: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Telefon</label>
                    <input className="input" value={form.phone} onChange={(e) => setForm((s) => ({ ...s, phone: e.target.value }))} />
                  </div>
                  <div>
                    <label className="label">Telefon 2</label>
                    <input className="input" value={form.phone_2} onChange={(e) => setForm((s) => ({ ...s, phone_2: e.target.value }))} />
                  </div>
                  <div style={{ gridColumn: '1 / -1' }}>
                    <label className="label">Not</label>
                    <textarea className="input" rows={2} value={form.note} onChange={(e) => setForm((s) => ({ ...s, note: e.target.value }))} />
                  </div>
                </div>

                <div style={{ marginTop: 16 }}>
                  <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', marginBottom: 6 }}>
                    <strong>Tanımlı Adresler</strong>
                    <button type="button" className="btn btn-sm btn-ghost" onClick={openNewAddress}>
                      <Plus size={14} /> Yeni Adres Ekle
                    </button>
                  </div>
                  {addresses.length === 0 ? (
                    <div style={{ color: 'var(--text-muted)', fontSize: 13, padding: 8 }}>Kayıtlı adres yok.</div>
                  ) : (
                    <div style={{ display: 'flex', flexDirection: 'column', gap: 6, maxHeight: 180, overflowY: 'auto' }}>
                      {addresses.map((a) => (
                        <div key={a.id} style={{ border: '1px solid var(--border)', borderRadius: 6, padding: 8, display: 'flex', justifyContent: 'space-between', gap: 8 }}>
                          <div style={{ minWidth: 0, flex: 1 }}>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                              <MapPin size={12} />
                              <strong style={{ fontSize: 13 }}>{a.title || 'Adres'}</strong>
                              {a.is_default ? <span className="badge badge-info" style={{ fontSize: 10 }}>Varsayılan</span> : null}
                            </div>
                            <div style={{ fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'pre-wrap' }}>{a.address}</div>
                            {(a.province || a.district || a.neighborhood) && (
                              <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                                {[a.province, a.district, a.neighborhood].filter(Boolean).join(' / ')}
                              </div>
                            )}
                          </div>
                          <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
                            <button type="button" className="btn btn-xs btn-ghost" onClick={() => openEditAddress(a)}>Düzenle</button>
                            <button type="button" className="btn btn-xs btn-danger" onClick={() => handleAddressDelete(a)}>
                              <Trash2 size={12} />
                            </button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )}
            <div className="modal-footer" style={{ justifyContent: 'space-between' }}>
              <button type="button" className="btn btn-ghost" onClick={() => setView('list')} disabled={saving}>Geri</button>
              <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
                {saving ? 'Kaydediliyor…' : 'Kaydet'}
              </button>
            </div>
          </>
        )}

        {addressEditor && (
          <div className="modal-overlay" onClick={() => setAddressEditor(null)} style={{ zIndex: 1100 }}>
            <div
              className="modal modal-md"
              onClick={(e) => e.stopPropagation()}
              style={{ width: 520, maxWidth: '92vw' }}
            >
              <div className="modal-header">
                <h2>{addressEditor.id ? 'Adresi Düzenle' : 'Yeni Adres'}</h2>
                <button type="button" className="btn btn-ghost btn-icon" onClick={() => setAddressEditor(null)} title="Kapat">
                  <X size={16} />
                </button>
              </div>
              <div className="modal-body" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label className="label">Adres Başlığı</label>
                  <input className="input" maxLength={15} value={addressEditor.title} onChange={(e) => setAddressEditor((s) => ({ ...s, title: e.target.value }))} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label className="label">Adres *</label>
                  <textarea className="input" rows={2} value={addressEditor.address} onChange={(e) => setAddressEditor((s) => ({ ...s, address: e.target.value }))} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label className="label">Adres Tarifi</label>
                  <input className="input" value={addressEditor.note} onChange={(e) => setAddressEditor((s) => ({ ...s, note: e.target.value }))} />
                </div>
                <div>
                  <label className="label">İl</label>
                  <input className="input" value={addressEditor.province} onChange={(e) => setAddressEditor((s) => ({ ...s, province: e.target.value }))} />
                </div>
                <div>
                  <label className="label">İlçe</label>
                  <input className="input" value={addressEditor.district} onChange={(e) => setAddressEditor((s) => ({ ...s, district: e.target.value }))} />
                </div>
                <div style={{ gridColumn: '1 / -1' }}>
                  <label className="label">Mahalle</label>
                  <input className="input" value={addressEditor.neighborhood} onChange={(e) => setAddressEditor((s) => ({ ...s, neighborhood: e.target.value }))} />
                </div>
                <label style={{ gridColumn: '1 / -1', display: 'flex', alignItems: 'center', gap: 6 }}>
                  <input type="checkbox" checked={addressEditor.is_default} onChange={(e) => setAddressEditor((s) => ({ ...s, is_default: e.target.checked }))} />
                  Varsayılan adres
                </label>
              </div>
              <div className="modal-footer">
                <button type="button" className="btn btn-ghost" onClick={() => setAddressEditor(null)}>İptal</button>
                <button type="button" className="btn btn-primary" onClick={handleAddressSave}>Kaydet</button>
              </div>
            </div>
          </div>
        )}

        {confirm && (
          <ConfirmDialog
            title={confirm.title}
            message={confirm.message}
            onConfirm={confirm.onConfirm}
            onCancel={() => setConfirm(null)}
          />
        )}
      </div>
    </div>
  );
}
