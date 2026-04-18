import { useState, useEffect, useCallback } from 'react';
import { ChevronLeft, ChevronRight, RefreshCw } from 'lucide-react';
import { useNavigate } from 'react-router-dom';
import api from '../../services/api.js';

const TABLE_LABELS = {
  products: 'Ürün',
  stock_items: 'Stok Kalemi',
  stock_movements: 'Stok Hareketi',
  customers: 'Müşteri',
  businesses: 'İşletme',
  printers: 'Yazıcı',
  printer_routing: 'Yazıcı Yönlendirme',
  users: 'Kullanıcı',
  orders: 'Sipariş',
  payments: 'Ödeme',
  refunds: 'İade',
};

const ACTION_LABELS = {
  create: { label: 'Oluştur', color: 'var(--success)' },
  update: { label: 'Güncelle', color: 'var(--accent)' },
  delete: { label: 'Sil', color: 'var(--danger)' },
  deactivate: { label: 'Pasifleştir', color: 'var(--warning)' },
  status_change: { label: 'Durum Değişikliği', color: 'var(--accent)' },
  cancel: { label: 'İptal', color: 'var(--danger)' },
};

const PAGE_SIZE = 50;

function ActionBadge({ action }) {
  const cfg = ACTION_LABELS[action] || { label: action, color: 'var(--text-muted)' };
  return (
    <span style={{
      fontSize: 11,
      fontWeight: 600,
      padding: '2px 8px',
      borderRadius: 99,
      background: cfg.color + '22',
      color: cfg.color,
      whiteSpace: 'nowrap',
    }}>
      {cfg.label}
    </span>
  );
}

function JsonDiff({ before, after }) {
  const [open, setOpen] = useState(false);
  if (!before && !after) return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>;
  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
      >
        {open ? 'Gizle' : 'Detay'}
      </button>
      {open && (
        <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
          {before && (
            <pre style={{
              flex: 1, fontSize: 11, background: 'var(--bg-surface)', padding: 8,
              borderRadius: 'var(--radius-sm)', overflow: 'auto', maxHeight: 200,
              border: '1px solid var(--border)', color: 'var(--text-secondary)', margin: 0,
            }}>
              {JSON.stringify(before, null, 2)}
            </pre>
          )}
          {after && (
            <pre style={{
              flex: 1, fontSize: 11, background: 'var(--bg-surface)', padding: 8,
              borderRadius: 'var(--radius-sm)', overflow: 'auto', maxHeight: 200,
              border: '1px solid var(--border)', color: 'var(--text-secondary)', margin: 0,
            }}>
              {JSON.stringify(after, null, 2)}
            </pre>
          )}
        </div>
      )}
    </div>
  );
}

export default function AuditLogPage() {
  const navigate = useNavigate();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filterTable, setFilterTable] = useState('');
  const [filterAction, setFilterAction] = useState('');

  const load = useCallback(async (off = 0) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getEntityMutations({
        limit: PAGE_SIZE,
        offset: off,
        entity_table: filterTable || undefined,
        action: filterAction || undefined,
      });
      setRows(data.mutations);
      setTotal(data.total);
      setOffset(off);
    } catch {
      setError('Veriler yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [filterTable, filterAction]);

  useEffect(() => { load(0); }, [load]);

  const totalPages = Math.ceil(total / PAGE_SIZE);
  const currentPage = Math.floor(offset / PAGE_SIZE) + 1;

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-main page-title-line">
          <button type="button" className="btn btn-ghost btn-icon" onClick={() => navigate('/settings')} style={{ marginRight: 8 }}>
            <ChevronLeft size={18} />
          </button>
          <h1 className="page-title">Denetim Günlüğü</h1>
        </div>
      </div>

      <div style={{ display: 'flex', gap: 10, marginBottom: 14, flexWrap: 'wrap', alignItems: 'center' }}>
        <select
          className="form-select"
          value={filterTable}
          onChange={(e) => setFilterTable(e.target.value)}
          style={{ minWidth: 160 }}
        >
          <option value="">Tüm tablolar</option>
          {Object.entries(TABLE_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v}</option>
          ))}
        </select>
        <select
          className="form-select"
          value={filterAction}
          onChange={(e) => setFilterAction(e.target.value)}
          style={{ minWidth: 150 }}
        >
          <option value="">Tüm işlemler</option>
          {Object.entries(ACTION_LABELS).map(([k, v]) => (
            <option key={k} value={k}>{v.label}</option>
          ))}
        </select>
        <button type="button" className="btn btn-secondary btn-icon" onClick={() => load(0)} disabled={loading}>
          <RefreshCw size={15} />
        </button>
        <span style={{ marginLeft: 'auto', fontSize: 12, color: 'var(--text-muted)' }}>
          {total} kayıt
        </span>
      </div>

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: 14 }}>{error}</div>
      )}

      <div className="card" style={{ overflow: 'hidden' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
              {['Zaman', 'Tablo', 'Kayıt ID', 'İşlem', 'Aktör', 'Detay'].map((h) => (
                <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap' }}>{h}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Yükleniyor…</td></tr>
            )}
            {!loading && rows.length === 0 && (
              <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Kayıt bulunamadı</td></tr>
            )}
            {!loading && rows.map((r) => (
              <tr key={r.id} style={{ borderBottom: '1px solid var(--border)' }}>
                <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: 12 }}>
                  {new Date(r.created_at).toLocaleString('tr-TR')}
                </td>
                <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                  {TABLE_LABELS[r.entity_table] || r.entity_table}
                </td>
                <td style={{ padding: '10px 14px', fontFamily: 'monospace', fontSize: 11, color: 'var(--text-muted)', maxWidth: 120, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                  {r.entity_id}
                </td>
                <td style={{ padding: '10px 14px' }}>
                  <ActionBadge action={r.action} />
                </td>
                <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontSize: 12 }}>
                  {r.actor_name || <span style={{ color: 'var(--text-muted)' }}>—</span>}
                </td>
                <td style={{ padding: '10px 14px' }}>
                  <JsonDiff before={r.before_json} after={r.after_json} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary btn-icon" onClick={() => load(offset - PAGE_SIZE)} disabled={offset === 0 || loading}>
            <ChevronLeft size={16} />
          </button>
          <span style={{ fontSize: 13 }}>{currentPage} / {totalPages}</span>
          <button type="button" className="btn btn-secondary btn-icon" onClick={() => load(offset + PAGE_SIZE)} disabled={offset + PAGE_SIZE >= total || loading}>
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
