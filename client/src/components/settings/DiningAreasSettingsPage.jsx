import { useCallback, useEffect, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { LayoutGrid, Plus, Pencil, Trash2 } from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import useConfirmDialog from '../common/useConfirmDialog.js';
import SettingsDetailHeader from './SettingsDetailHeader.jsx';

export default function DiningAreasSettingsPage() {
  const navigate = useNavigate();
  const { success, error } = useToast();
  const [areas, setAreas] = useState([]);
  const [loading, setLoading] = useState(true);
  const [targets, setTargets] = useState({});
  const [syncing, setSyncing] = useState(null);

  const [newModal, setNewModal] = useState(false);
  const [newName, setNewName] = useState('');
  const [newInitialTarget, setNewInitialTarget] = useState('0');
  const [creating, setCreating] = useState(false);

  const [editingId, setEditingId] = useState(null);
  const [editName, setEditName] = useState('');
  const [savingEdit, setSavingEdit] = useState(false);
  const { confirmDialog, requestConfirm, cancelConfirm, acceptConfirm } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const { areas: rows } = await api.getAdminDiningAreas();
      setAreas(rows || []);
      const t = {};
      (rows || []).forEach((a) => {
        const c = a.target_table_count;
        t[a.id] = c != null && c !== '' ? String(c) : String(a.active_table_count ?? 0);
      });
      setTargets(t);
    } catch (e) {
      error(e.message || 'Bölgeler yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [error]);

  useEffect(() => {
    load();
  }, [load]);

  const handleBack = () => navigate('/settings');

  const applySync = async (areaId) => {
    const raw = targets[areaId];
    const n = Math.max(0, Math.floor(Number(raw)));
    if (!Number.isFinite(n)) {
      error('Geçerli bir sayı girin');
      return;
    }
    setSyncing(areaId);
    try {
      await api.syncDiningAreaTables(areaId, n);
      success('Masa sayısı güncellendi');
      await load();
    } catch (e) {
      const msg = e.message || 'Senkronizasyon başarısız';
      if (Array.isArray(e.blockers) && e.blockers.length > 1) {
        error([msg, ...e.blockers].join('\n\n'));
      } else {
        error(msg);
      }
    } finally {
      setSyncing(null);
    }
  };

  const openNewModal = () => {
    setNewName('');
    setNewInitialTarget('0');
    setNewModal(true);
  };

  const submitNewArea = async () => {
    const trimmed = newName.trim();
    if (!trimmed) {
      error('Bölge adı girin');
      return;
    }
    const initial = Math.max(0, Math.floor(Number(newInitialTarget)));
    if (!Number.isFinite(initial)) {
      error('Geçerli bir ilk masa sayısı girin');
      return;
    }
    setCreating(true);
    try {
      const { area } = await api.postAdminDiningArea({ name: trimmed });
      success('Bölge oluşturuldu');
      setNewModal(false);
      await load();
      if (initial > 0 && area?.id) {
        setSyncing(area.id);
        try {
          await api.syncDiningAreaTables(area.id, initial);
          success('Masalar oluşturuldu');
          await load();
        } catch (e) {
          error(e.message || 'Masalar oluşturulamadı');
        } finally {
          setSyncing(null);
        }
      }
    } catch (e) {
      error(e.message || 'Bölge oluşturulamadı');
    } finally {
      setCreating(false);
    }
  };

  const startEdit = (a) => {
    setEditingId(a.id);
    setEditName(a.name || '');
  };

  const cancelEdit = () => {
    setEditingId(null);
    setEditName('');
  };

  const saveEdit = async (areaId) => {
    const trimmed = editName.trim();
    if (!trimmed) {
      error('Bölge adı boş olamaz');
      return;
    }
    setSavingEdit(true);
    try {
      await api.patchAdminDiningArea(areaId, { name: trimmed });
      success('Bölge adı güncellendi');
      setEditingId(null);
      await load();
    } catch (e) {
      error(e.message || 'Güncelleme başarısız');
    } finally {
      setSavingEdit(false);
    }
  };

  const removeArea = async (a) => {
    requestConfirm({
      title: 'Bölge silinsin mi?',
      body: `"${a.name}" bölgesi kaldırılacak. Bu işlem yalnızca bölgede aktif masa yoksa tamamlanır.`,
      confirmLabel: 'Sil',
      tone: 'danger',
      onConfirm: async () => {
        try {
          await api.deleteAdminDiningArea(a.id);
          success('Bölge kaldırıldı');
          await load();
        } catch (e) {
          error(e.message || 'Silinemedi');
        }
      },
    });
  };

  return (
    <div className="page-container">
      <SettingsDetailHeader title="Salon bölgeleri ve masa sayısı" onBack={handleBack} />

      <p style={{ fontSize: 13, color: 'var(--text-muted)', marginBottom: 12 }}>
        Her bölge için hedef masa sayısını girin. Boş masalar güvenle kapatılır; dolu masa veya açık adisyon varken
        sayı düşürülemez.
      </p>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', marginBottom: 16, lineHeight: 1.45 }}>
        Her masa sistemde benzersiz bir kimlikle (ID) saklanır; farklı bölgelerde aynı görünen sıra numarası (ör. Masa 1)
        kullanılabilir — masalar ekranında bölge adıyla birlikte gösterilir.
      </p>

      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={openNewModal}>
          <Plus size={16} /> Yeni bölge
        </button>
      </div>

      {loading ? (
        <div className="empty-state">Yükleniyor…</div>
      ) : areas.length === 0 ? (
        <div className="empty-state">Kayıtlı bölge yok — Yeni bölge ile ekleyebilirsiniz.</div>
      ) : (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
          {areas.map((a) => (
            <div key={a.id} className="card card-padded">
              <div
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 10,
                  marginBottom: 10,
                  flexWrap: 'wrap',
                  justifyContent: 'space-between',
                }}
              >
                <div style={{ display: 'flex', alignItems: 'center', gap: 10, minWidth: 0, flex: 1 }}>
                  <LayoutGrid size={18} color="var(--accent)" style={{ flexShrink: 0 }} />
                  {editingId === a.id ? (
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                      <input
                        className="input"
                        style={{ minWidth: 160, maxWidth: 280 }}
                        value={editName}
                        onChange={(e) => setEditName(e.target.value)}
                        autoFocus
                      />
                      <button
                        type="button"
                        className="btn btn-primary btn-sm"
                        disabled={savingEdit}
                        onClick={() => saveEdit(a.id)}
                      >
                        Kaydet
                      </button>
                      <button type="button" className="btn btn-ghost btn-sm" disabled={savingEdit} onClick={cancelEdit}>
                        Vazgeç
                      </button>
                    </div>
                  ) : (
                    <>
                      <div style={{ fontWeight: 700, minWidth: 0 }} className="truncate">
                        {a.name}
                      </div>
                      <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                        Aktif masa: {a.active_table_count ?? 0}
                      </span>
                    </>
                  )}
                </div>
                {editingId !== a.id && (
                  <div style={{ display: 'flex', gap: 4 }}>
                    <button type="button" className="btn btn-ghost btn-sm btn-icon" title="Adı düzenle" onClick={() => startEdit(a)}>
                      <Pencil size={16} />
                    </button>
                    <button
                      type="button"
                      className="btn btn-ghost btn-sm btn-icon"
                      title="Bölgeyi sil"
                      onClick={() => removeArea(a)}
                    >
                      <Trash2 size={16} color="var(--danger)" />
                    </button>
                  </div>
                )}
              </div>
              <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'center' }}>
                <label style={{ display: 'flex', alignItems: 'center', gap: 8, fontSize: 13 }}>
                  Hedef masa sayısı
                  <input
                    type="number"
                    min={0}
                    className="input"
                    style={{ width: 100 }}
                    value={targets[a.id] ?? ''}
                    onChange={(e) => setTargets((prev) => ({ ...prev, [a.id]: e.target.value }))}
                    disabled={editingId === a.id}
                  />
                </label>
                <button
                  type="button"
                  className="btn btn-primary btn-sm"
                  disabled={syncing === a.id || editingId === a.id}
                  onClick={() => applySync(a.id)}
                >
                  {syncing === a.id ? 'Uygulanıyor…' : 'Uygula'}
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      {newModal && (
        <div className="modal-overlay" onClick={() => !creating && setNewModal(false)}>
          <div role="dialog" className="modal" style={{ maxWidth: 420, width: '100%' }} onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Yeni bölge</h2>
              <button type="button" className="btn btn-ghost btn-icon" onClick={() => !creating && setNewModal(false)} disabled={creating}>
                ×
              </button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14, padding: '0 4px 16px' }}>
              <div>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                  Bölge adı
                </span>
                <input className="input" value={newName} onChange={(e) => setNewName(e.target.value)} placeholder="Örn. Teras" autoFocus />
              </div>
              <div>
                <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-muted)', display: 'block', marginBottom: 6 }}>
                  İlk masa sayısı (isteğe bağlı)
                </span>
                <input
                  type="number"
                  min={0}
                  className="input"
                  value={newInitialTarget}
                  onChange={(e) => setNewInitialTarget(e.target.value)}
                  style={{ maxWidth: 120 }}
                />
                <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 6 }}>0 bırakırsanız masaları sonra ekleyebilirsiniz.</div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'flex-end', gap: 8 }}>
                <button type="button" className="btn btn-ghost" onClick={() => setNewModal(false)} disabled={creating}>
                  İptal
                </button>
                <button type="button" className="btn btn-primary" onClick={submitNewArea} disabled={creating}>
                  {creating ? 'Oluşturuluyor…' : 'Oluştur'}
                </button>
              </div>
            </div>
          </div>
        </div>
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
