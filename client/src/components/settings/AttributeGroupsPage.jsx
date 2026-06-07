import { useState, useEffect, useRef } from 'react';
import { Plus, Trash2, ChevronDown, ChevronRight, X, Check } from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { formatCurrency } from '../../constants/index.js';
import SettingsDetailHeader from './SettingsDetailHeader.jsx';
import useConfirmDialog from '../common/useConfirmDialog.js';
import ConfirmDialog from '../common/ConfirmDialog.jsx';

// ─── Drawer: Grup oluştur/düzenle ────────────────────────────────────────────

function GroupDrawer({ group, onClose, onSaved }) {
  const { success, error } = useToast();
  const [name, setName] = useState(group?.name || '');
  const [selectionType, setSelectionType] = useState(group?.selection_type || 'single');
  const [isRequired, setIsRequired] = useState(group ? Number(group.is_required) === 1 : false);
  const [isActive, setIsActive] = useState(group ? Number(group.is_active) === 1 : true);
  const [options, setOptions] = useState(
    (group?.options || []).map((o, i) => ({
      key: o.id || `opt_${i}`,
      id: o.id || null,
      name: o.name || '',
      extra_price: String(o.extra_price ?? 0),
      is_default: Number(o.is_default) === 1,
      is_active: Number(o.is_active) === 1,
      sort_order: o.sort_order ?? i,
    })),
  );
  const [saving, setSaving] = useState(false);
  const nameRef = useRef(null);

  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  const addOption = () => {
    setOptions((prev) => [
      ...prev,
      {
        key: `opt_new_${Date.now()}`,
        id: null,
        name: '',
        extra_price: '0',
        is_default: false,
        is_active: true,
        sort_order: prev.length,
      },
    ]);
  };

  const updateOption = (key, field, value) => {
    setOptions((prev) => prev.map((o) => (o.key === key ? { ...o, [field]: value } : o)));
  };

  const removeOption = (key) => {
    setOptions((prev) => prev.filter((o) => o.key !== key));
  };

  const setDefault = (key) => {
    setOptions((prev) =>
      prev.map((o) => ({
        ...o,
        is_default: selectionType === 'single' ? o.key === key : o.key === key ? !o.is_default : o.is_default,
      })),
    );
  };

  const handleSave = async () => {
    const trimmed = name.trim();
    if (!trimmed) { error('Grup adı boş olamaz'); return; }

    for (const opt of options) {
      if (!opt.name.trim()) { error('Tüm seçenek adları dolu olmalı'); return; }
      const price = parseFloat(String(opt.extra_price).replace(',', '.'));
      if (isNaN(price) || price < 0) { error('Ekstra tutar sıfır veya pozitif bir sayı olmalı'); return; }
    }

    setSaving(true);
    try {
      let savedGroup;
      const groupBody = {
        name: trimmed,
        selection_type: selectionType,
        is_required: isRequired,
        is_active: isActive,
        sort_order: group?.sort_order ?? 0,
      };

      if (group?.id) {
        savedGroup = await api.updateAttributeGroup(group.id, groupBody);
      } else {
        savedGroup = await api.createAttributeGroup(groupBody);
      }

      // Seçenekleri kaydet
      const existingIds = new Set((group?.options || []).map((o) => o.id));
      for (const opt of options) {
        const optBody = {
          name: opt.name.trim(),
          extra_price: parseFloat(String(opt.extra_price).replace(',', '.')) || 0,
          is_default: opt.is_default,
          is_active: opt.is_active,
          sort_order: opt.sort_order,
        };
        if (opt.id) {
          await api.updateAttributeOption(opt.id, optBody);
          existingIds.delete(opt.id);
        } else {
          await api.createAttributeOption(savedGroup.id, optBody);
        }
      }
      // Silinen seçenekleri kaldır
      for (const deletedId of existingIds) {
        try { await api.deleteAttributeOption(deletedId); } catch {}
      }

      success(group?.id ? 'Grup güncellendi' : 'Grup oluşturuldu');
      onSaved();
    } catch (e) {
      error(e.message || 'Kayıt başarısız');
    } finally {
      setSaving(false);
    }
  };

  return (
    <>
      {/* Overlay */}
      <div
        style={{
          position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)', zIndex: 1000,
        }}
        onClick={() => !saving && onClose()}
      />
      {/* Drawer */}
      <div
        style={{
          position: 'fixed', top: 0, right: 0, bottom: 0,
          width: 'min(480px, 100vw)',
          background: 'var(--bg-card)',
          boxShadow: '-4px 0 24px rgba(0,0,0,0.18)',
          zIndex: 1001,
          display: 'flex', flexDirection: 'column',
          overflowY: 'auto',
        }}
      >
        {/* Header */}
        <div style={{
          padding: '18px 20px 14px',
          borderBottom: '1px solid var(--border)',
          display: 'flex', alignItems: 'center', justifyContent: 'space-between',
          position: 'sticky', top: 0, background: 'var(--bg-card)', zIndex: 1,
        }}>
          <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>
            {group?.id ? 'Grubu Düzenle' : 'Yeni Grup Tanımla'}
          </h2>
          <button type="button" className="btn btn-ghost btn-icon" onClick={onClose} disabled={saving}>
            <X size={18} />
          </button>
        </div>

        {/* Form */}
        <div style={{ padding: '18px 20px', flex: 1, display: 'flex', flexDirection: 'column', gap: 16 }}>
          {/* Grup adı */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
              Özellik grup ismi <span style={{ color: 'var(--danger)' }}>*</span>
            </label>
            <input
              ref={nameRef}
              className="input"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Özellik grup ismi"
            />
          </div>

          {/* Seçim tipi */}
          <div>
            <label style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
              Seçim tipi
            </label>
            <select className="input" value={selectionType} onChange={(e) => setSelectionType(e.target.value)}>
              <option value="single">Tekli Seçim</option>
              <option value="multiple">Çoklu Seçim</option>
            </select>
          </div>

          {/* Zorunlu toggle */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
            <div
              onClick={() => setIsRequired((v) => !v)}
              style={{
                width: 40, height: 22, borderRadius: 11, cursor: 'pointer',
                background: isRequired ? 'var(--accent)' : 'var(--border)',
                position: 'relative', transition: 'background 0.2s', flexShrink: 0,
              }}
            >
              <div style={{
                position: 'absolute', top: 3, left: isRequired ? 20 : 3,
                width: 16, height: 16, borderRadius: '50%', background: '#fff',
                transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
              }} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Özellik seçimi zorunlu olsun</span>
          </label>

          {/* Aktif toggle */}
          <label style={{ display: 'flex', alignItems: 'center', gap: 10, cursor: 'pointer', userSelect: 'none' }}>
            <div
              onClick={() => setIsActive((v) => !v)}
              style={{
                width: 40, height: 22, borderRadius: 11, cursor: 'pointer',
                background: isActive ? 'var(--accent)' : 'var(--border)',
                position: 'relative', transition: 'background 0.2s', flexShrink: 0,
              }}
            >
              <div style={{
                position: 'absolute', top: 3, left: isActive ? 20 : 3,
                width: 16, height: 16, borderRadius: '50%', background: '#fff',
                transition: 'left 0.2s', boxShadow: '0 1px 3px rgba(0,0,0,0.25)',
              }} />
            </div>
            <span style={{ fontSize: 13, fontWeight: 600 }}>Aktif</span>
          </label>

          {/* Seçenekler */}
          <div>
            <div style={{
              display: 'grid',
              gridTemplateColumns: '1fr 120px 48px',
              gap: 8,
              marginBottom: 6,
            }}>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Özellik Adı</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)' }}>Ekstra Tutar</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', textAlign: 'center' }}>
                Varsayılan
              </span>
            </div>

            <div style={{ display: 'flex', flexDirection: 'column', gap: 8 }}>
              {options.map((opt) => (
                <div key={opt.key} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 48px 36px', gap: 8, alignItems: 'center' }}>
                  <input
                    className="input"
                    style={{ fontSize: 13 }}
                    value={opt.name}
                    onChange={(e) => updateOption(opt.key, 'name', e.target.value)}
                    placeholder="Özellik Adı"
                  />
                  <div style={{ position: 'relative' }}>
                    <input
                      className="input"
                      style={{ fontSize: 13, paddingRight: 26 }}
                      value={opt.extra_price}
                      onChange={(e) => updateOption(opt.key, 'extra_price', e.target.value)}
                      placeholder="0"
                    />
                    <span style={{
                      position: 'absolute', right: 10, top: '50%', transform: 'translateY(-50%)',
                      fontSize: 12, color: 'var(--text-muted)',
                    }}>₺</span>
                  </div>
                  <button
                    type="button"
                    onClick={() => setDefault(opt.key)}
                    style={{
                      width: 36, height: 36, borderRadius: 8,
                      border: opt.is_default ? '2px solid var(--accent)' : '2px solid var(--border)',
                      background: opt.is_default ? 'var(--accent-muted)' : 'transparent',
                      cursor: 'pointer', display: 'flex', alignItems: 'center', justifyContent: 'center',
                    }}
                    title="Varsayılan olarak işaretle"
                  >
                    {opt.is_default && <Check size={14} color="var(--accent)" />}
                  </button>
                  <button
                    type="button"
                    className="btn btn-ghost btn-icon"
                    style={{ color: 'var(--danger)', width: 36, height: 36, padding: 0 }}
                    onClick={() => removeOption(opt.key)}
                  >
                    <X size={15} />
                  </button>
                </div>
              ))}
            </div>

            <button
              type="button"
              className="btn btn-ghost"
              style={{ marginTop: 10, fontSize: 13, color: 'var(--accent)' }}
              onClick={addOption}
            >
              <Plus size={14} /> Yeni özellik ekle
            </button>
          </div>
        </div>

        {/* Footer */}
        <div style={{
          padding: '14px 20px',
          borderTop: '1px solid var(--border)',
          display: 'flex', gap: 10, justifyContent: 'flex-end',
          position: 'sticky', bottom: 0, background: 'var(--bg-card)',
        }}>
          <button type="button" className="btn btn-ghost" onClick={onClose} disabled={saving}>
            İptal
          </button>
          <button type="button" className="btn btn-primary" onClick={handleSave} disabled={saving}>
            {saving ? 'Kaydediliyor…' : 'Kaydet'}
          </button>
        </div>
      </div>
    </>
  );
}

// ─── Satır: Grup listesi ──────────────────────────────────────────────────────

function GroupRow({ group, onEdit, onAddOption, onDelete }) {
  const [expanded, setExpanded] = useState(false);

  return (
    <>
      <div style={{
        display: 'grid',
        gridTemplateColumns: '1fr 140px 80px 1fr auto',
        alignItems: 'center',
        gap: 12,
        padding: '12px 16px',
        borderBottom: '1px solid var(--border)',
      }}>
        <span style={{ fontWeight: 700, fontSize: 14 }}>{group.name}</span>
        <span style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          {group.selection_type === 'single' ? 'Tekli Seçim' : 'Çoklu Seçim'}
        </span>
        <button
          type="button"
          style={{
            background: 'none', border: 'none', cursor: 'pointer',
            display: 'flex', alignItems: 'center', gap: 4,
            fontSize: 13, color: 'var(--accent)', fontWeight: 600,
          }}
          onClick={() => setExpanded((v) => !v)}
        >
          {group.option_count ?? (group.options?.length ?? 0)}
          {expanded ? <ChevronDown size={13} /> : <ChevronRight size={13} />}
        </button>
        <div style={{ display: 'flex', gap: 12, alignItems: 'center' }}>
          <button
            type="button"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 13, fontWeight: 600 }}
            onClick={() => onEdit(group)}
          >
            Düzenle
          </button>
          <button
            type="button"
            style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--accent)', fontSize: 13, fontWeight: 600 }}
            onClick={() => onAddOption(group)}
          >
            Yeni özellik ekle
          </button>
        </div>
        <button
          type="button"
          className="btn btn-ghost btn-icon"
          style={{ color: 'var(--danger)' }}
          onClick={() => onDelete(group)}
        >
          <Trash2 size={16} />
        </button>
      </div>

      {/* Expanded options */}
      {expanded && (group.options || []).length > 0 && (
        <div style={{
          background: 'var(--bg)',
          borderBottom: '1px solid var(--border)',
          padding: '8px 16px 8px 32px',
        }}>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 120px 80px', gap: 8, marginBottom: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Seçenek Adı</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Ekstra Tutar</span>
            <span style={{ fontSize: 11, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Varsayılan</span>
          </div>
          {group.options.map((opt) => (
            <div key={opt.id} style={{ display: 'grid', gridTemplateColumns: '1fr 120px 80px', gap: 8, padding: '4px 0' }}>
              <span style={{ fontSize: 13 }}>{opt.name}</span>
              <span style={{ fontSize: 13 }}>
                {Number(opt.extra_price) === 0 ? 'Ücretsiz' : formatCurrency(opt.extra_price)}
              </span>
              <span style={{ fontSize: 13 }}>
                {Number(opt.is_default) ? '✓' : '–'}
              </span>
            </div>
          ))}
        </div>
      )}
    </>
  );
}

// ─── Ana Sayfa ────────────────────────────────────────────────────────────────

export default function AttributeGroupsPage() {
  const { success, error } = useToast();
  const [groups, setGroups] = useState([]);
  const [loading, setLoading] = useState(true);
  const [searchQuery, setSearchQuery] = useState('');
  const [drawer, setDrawer] = useState(null); // null | { group: null|obj, addOption: bool }
  const { dialogState, confirm, closeDialog } = useConfirmDialog();

  const loadGroups = async () => {
    setLoading(true);
    try {
      const data = await api.getAttributeGroups();
      setGroups(data);
    } catch (e) {
      error(e.message || 'Özellik grupları yüklenemedi');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => { loadGroups(); }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const handleDelete = (group) => {
    confirm({
      title: 'Grup silinsin mi?',
      body: `"${group.name}" grubu ve tüm seçenekleri kalıcı olarak silinecek.`,
      confirmLabel: 'Sil',
      tone: 'danger',
      onConfirm: async () => {
        try {
          await api.deleteAttributeGroup(group.id);
          success('Grup silindi');
          await loadGroups();
        } catch (e) {
          error(e.message || 'Silme başarısız');
        }
      },
    });
  };

  const filteredGroups = searchQuery.trim()
    ? groups.filter((g) =>
        g.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
        (g.options || []).some((o) => o.name.toLowerCase().includes(searchQuery.toLowerCase())),
      )
    : groups;

  return (
    <div className="page-container">
      <SettingsDetailHeader title="Özellikler" />

      {/* Toolbar */}
      <div style={{ display: 'flex', gap: 10, marginBottom: 16, alignItems: 'center' }}>
        <div style={{ flex: 1, position: 'relative' }}>
          <input
            className="input"
            style={{ paddingLeft: 36 }}
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Arama..."
          />
          <svg
            style={{ position: 'absolute', left: 11, top: '50%', transform: 'translateY(-50%)', color: 'var(--text-muted)' }}
            width="15" height="15" viewBox="0 0 24 24" fill="none"
            stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"
          >
            <circle cx="11" cy="11" r="8" /><line x1="21" y1="21" x2="16.65" y2="16.65" />
          </svg>
        </div>
        <button
          type="button"
          className="btn btn-primary"
          onClick={() => setDrawer({ group: null })}
        >
          <Plus size={16} /> Yeni Grup Tanımla
        </button>
      </div>

      {/* Liste */}
      <div className="card" style={{ overflow: 'hidden' }}>
        {/* Tablo başlığı */}
        <div style={{
          display: 'grid',
          gridTemplateColumns: '1fr 140px 80px 1fr auto',
          gap: 12,
          padding: '10px 16px',
          background: 'var(--bg)',
          borderBottom: '1px solid var(--border)',
        }}>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Özellik grup ismi</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Seçim tipi</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>Özellikler</span>
          <span style={{ fontSize: 12, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: 0.5 }}>İşlemler</span>
          <span style={{ width: 36 }} />
        </div>

        {loading ? (
          <div style={{ padding: 32, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
            Yükleniyor…
          </div>
        ) : filteredGroups.length === 0 ? (
          <div style={{ padding: 40, textAlign: 'center', color: 'var(--text-muted)', fontSize: 14 }}>
            {searchQuery ? 'Arama sonucu bulunamadı.' : 'Henüz özellik grubu tanımlanmamış.'}
          </div>
        ) : (
          filteredGroups.map((g) => (
            <GroupRow
              key={g.id}
              group={g}
              onEdit={(grp) => setDrawer({ group: grp })}
              onAddOption={(grp) => setDrawer({ group: grp, addOption: true })}
              onDelete={handleDelete}
            />
          ))
        )}
      </div>

      {/* Drawer */}
      {drawer !== null && (
        <GroupDrawer
          group={drawer.group}
          onClose={() => setDrawer(null)}
          onSaved={() => {
            setDrawer(null);
            loadGroups();
          }}
        />
      )}

      {/* Confirm Dialog */}
      {dialogState && (
        <ConfirmDialog
          title={dialogState.title}
          body={dialogState.body}
          confirmLabel={dialogState.confirmLabel}
          tone={dialogState.tone}
          onConfirm={() => { closeDialog(); dialogState.onConfirm(); }}
          onCancel={closeDialog}
        />
      )}
    </div>
  );
}
