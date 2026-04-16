import { useCallback, useEffect, useMemo, useState } from 'react';
import { Pencil, UserMinus } from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import useConfirmDialog from '../common/useConfirmDialog.js';
import SettingsDetailHeader from './SettingsDetailHeader.jsx';
import UserFormModal from './UserFormModal.jsx';

export default function UsersSettingsPage() {
  const { success, error } = useToast();
  const [users, setUsers] = useState([]);
  const [roles, setRoles] = useState([]);
  const [loading, setLoading] = useState(true);
  const [modalOpen, setModalOpen] = useState(false);
  const [modalMode, setModalMode] = useState('create');
  const [selected, setSelected] = useState(null);
  const { confirmDialog, requestConfirm, cancelConfirm, acceptConfirm } = useConfirmDialog();

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const [u, r] = await Promise.all([api.getAdminUsers(), api.getAdminRoles()]);
      setUsers(u.users || []);
      setRoles(r.roles || []);
    } catch (e) {
      error(e.message || 'Veriler yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [error]);

  useEffect(() => {
    load();
  }, [load]);

  const openCreate = () => {
    setModalMode('create');
    setSelected(null);
    setModalOpen(true);
  };

  const openEdit = (u) => {
    setModalMode('edit');
    setSelected(u);
    setModalOpen(true);
  };

  const handleSubmit = async (form) => {
    try {
      if (modalMode === 'create') {
        await api.postAdminUser({
          full_name: form.full_name,
          email: form.email,
          password: form.password,
          role_slug: form.role_slug,
          is_active: form.is_active,
        });
        success('Kullanıcı oluşturuldu');
      } else {
        const body = {
          full_name: form.full_name,
          email: form.email,
          role_slug: form.role_slug,
          is_active: form.is_active,
        };
        if (form.password && form.password.length > 0) body.password = form.password;
        await api.patchAdminUser(selected.id, body);
        success('Kullanıcı güncellendi');
      }
      await load();
    } catch (e) {
      error(e.message || 'İşlem başarısız');
      throw e;
    }
  };

  const deactivate = async (u) => {
    requestConfirm({
      title: 'Kullanıcı pasifleştirilsin mi?',
      body: `${u.full_name} artık sisteme giriş yapamayacak. Daha sonra tekrar aktifleştirilebilir.`,
      confirmLabel: 'Pasifleştir',
      tone: 'danger',
      onConfirm: async () => {
        try {
          await api.deleteAdminUser(u.id);
          success('Kullanıcı pasifleştirildi');
          await load();
        } catch (e) {
          error(e.message || 'İşlem başarısız');
        }
      },
    });
  };

  const reactivate = async (u) => {
    try {
      await api.patchAdminUser(u.id, { is_active: true });
      success('Kullanıcı tekrar aktif');
      await load();
    } catch (e) {
      error(e.message || 'İşlem başarısız');
    }
  };

  const roleLabel = useMemo(() => {
    const m = {};
    roles.forEach((r) => {
      m[r.slug] = r.name;
    });
    return m;
  }, [roles]);

  return (
    <div className="page-container">
      <SettingsDetailHeader title="Kullanıcı Yönetimi" />
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 14 }}>
        <button type="button" className="btn btn-primary btn-sm" onClick={openCreate}>
          Yeni Kullanıcı Ekle
        </button>
      </div>

      <div className="card" style={{ overflow: 'hidden' }}>
        <div
          style={{
            display: 'grid',
            gridTemplateColumns: '1fr 100px 1fr 140px 160px',
            gap: 12,
            padding: '12px 16px',
            borderBottom: '1px solid var(--border)',
            fontSize: 11,
            fontWeight: 700,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.04em',
          }}
        >
          <span>Ad</span>
          <span>Rol</span>
          <span>E-posta</span>
          <span>Durum</span>
          <span style={{ textAlign: 'right' }}>İşlem</span>
        </div>
        {loading ? (
          <div style={{ padding: 24, color: 'var(--text-muted)' }}>Yükleniyor…</div>
        ) : (
          users.map((u) => (
            <div
              key={u.id}
              style={{
                display: 'grid',
                gridTemplateColumns: '1fr 100px 1fr 140px 160px',
                gap: 12,
                padding: '14px 16px',
                borderBottom: '1px solid var(--border)',
                fontSize: 14,
                alignItems: 'center',
              }}
            >
              <span style={{ fontWeight: 600 }}>{u.full_name}</span>
              <span style={{ color: 'var(--text-secondary)' }}>{u.role_name || roleLabel[u.role_slug]}</span>
              <span style={{ color: 'var(--text-muted)', fontSize: 13 }}>{u.email}</span>
              <span>
                {u.is_active ? (
                  <span className="badge badge-success">Aktif</span>
                ) : (
                  <span className="badge badge-warning">Pasif</span>
                )}
              </span>
              <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                <button type="button" className="btn btn-ghost btn-sm" onClick={() => openEdit(u)} title="Düzenle">
                  <Pencil size={16} />
                </button>
                {u.is_active ? (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => deactivate(u)} title="Pasifleştir">
                    <UserMinus size={16} />
                  </button>
                ) : (
                  <button type="button" className="btn btn-ghost btn-sm" onClick={() => reactivate(u)}>
                    Aktifleştir
                  </button>
                )}
              </div>
            </div>
          ))
        )}
      </div>

      <UserFormModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        onSubmit={handleSubmit}
        roles={roles}
        initial={selected}
        mode={modalMode}
      />
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
