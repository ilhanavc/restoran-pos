import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import {
  ChevronLeft, ChevronRight, RefreshCw, X, Copy, Download,
  Search, User, Database, Activity, Calendar, Filter, List, Layers,
} from 'lucide-react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import {
  labelForField, formatValue, entityLabel, activitySentence, actionIcon, isHiddenField,
} from '../../utils/auditFormat.js';

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

const PAGE_SIZE_OPTIONS = [50, 100, 200];
const AUTO_REFRESH_INTERVAL_MS = 10_000;

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

function diffFields(before, after) {
  if (!before && !after) return [];
  if (!before && after) {
    return Object.entries(after)
      .filter(([k]) => !isHiddenField(k))
      .map(([k, v]) => ({ key: k, before: null, after: v, type: 'added' }));
  }
  if (before && !after) {
    return Object.entries(before)
      .filter(([k]) => !isHiddenField(k))
      .map(([k, v]) => ({ key: k, before: v, after: null, type: 'removed' }));
  }
  const keys = new Set([...Object.keys(before), ...Object.keys(after)]);
  const rows = [];
  for (const k of keys) {
    if (isHiddenField(k)) continue;
    const bv = before[k];
    const av = after[k];
    if (JSON.stringify(bv) !== JSON.stringify(av)) {
      rows.push({ key: k, before: bv, after: av, type: bv === undefined ? 'added' : av === undefined ? 'removed' : 'changed' });
    }
  }
  return rows;
}

function DiffTable({ diff }) {
  return (
    <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
      <thead>
        <tr style={{ borderBottom: '1px solid var(--border)' }}>
          <th style={{ textAlign: 'left', padding: '4px 8px', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Alan</th>
          <th style={{ textAlign: 'left', padding: '4px 8px', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Önceki</th>
          <th style={{ textAlign: 'left', padding: '4px 8px', fontSize: 11, color: 'var(--text-muted)', fontWeight: 600 }}>Yeni</th>
        </tr>
      </thead>
      <tbody>
        {diff.map((d) => (
          <tr key={d.key} style={{ borderBottom: '1px dashed var(--border)' }}>
            <td style={{ padding: '5px 8px', fontSize: 12, color: 'var(--text-secondary)', verticalAlign: 'top' }}>{labelForField(d.key)}</td>
            <td style={{ padding: '5px 8px', verticalAlign: 'top', background: d.type === 'added' ? 'transparent' : 'rgba(239,68,68,0.06)', color: 'var(--text-secondary)' }}>
              {formatValue(d.key, d.before)}
            </td>
            <td style={{ padding: '5px 8px', verticalAlign: 'top', background: d.type === 'removed' ? 'transparent' : 'rgba(34,197,94,0.08)', color: 'var(--text-primary)' }}>
              {formatValue(d.key, d.after)}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

function ChangeCell({ before, after }) {
  const [open, setOpen] = useState(false);
  const [showRaw, setShowRaw] = useState(false);
  const diff = useMemo(() => diffFields(before, after), [before, after]);

  if (diff.length === 0) {
    return <span style={{ color: 'var(--text-muted)', fontSize: 12 }}>—</span>;
  }

  return (
    <div>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        style={{ fontSize: 12, color: 'var(--accent)', background: 'none', border: 'none', cursor: 'pointer', padding: 0, fontWeight: 600 }}
      >
        {open ? 'Gizle' : `${diff.length} alan değişti`}
      </button>
      {open && (
        <div style={{ marginTop: 8, border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', background: 'var(--bg-surface)', padding: 10 }}>
          <DiffTable diff={diff} />
          <div style={{ marginTop: 8 }}>
            <button
              type="button"
              onClick={() => setShowRaw((v) => !v)}
              style={{ fontSize: 11, color: 'var(--text-muted)', background: 'none', border: 'none', cursor: 'pointer', padding: 0 }}
            >
              {showRaw ? 'Ham JSON gizle' : 'Ham JSON göster'}
            </button>
            {showRaw && (
              <div style={{ display: 'flex', gap: 8, marginTop: 6 }}>
                {before && (
                  <pre style={{ flex: 1, fontSize: 10, background: 'var(--bg-primary)', padding: 6, borderRadius: 4, overflow: 'auto', maxHeight: 180, border: '1px solid var(--border)', color: 'var(--text-secondary)', margin: 0 }}>
                    {JSON.stringify(before, null, 2)}
                  </pre>
                )}
                {after && (
                  <pre style={{ flex: 1, fontSize: 10, background: 'var(--bg-primary)', padding: 6, borderRadius: 4, overflow: 'auto', maxHeight: 180, border: '1px solid var(--border)', color: 'var(--text-secondary)', margin: 0 }}>
                    {JSON.stringify(after, null, 2)}
                  </pre>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

function ActivityCard({ row, onActorClick, onCopyId, toast }) {
  const [open, setOpen] = useState(false);
  const diff = useMemo(() => diffFields(row.before_json, row.after_json), [row.before_json, row.after_json]);
  const sentence = useMemo(() => activitySentence(row), [row]);
  const icon = actionIcon(row.action);
  const when = new Date(row.created_at).toLocaleString('tr-TR', {
    day: '2-digit', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit',
  });

  const copyId = async () => {
    if (!row.entity_id) return;
    try {
      await navigator.clipboard.writeText(row.entity_id);
      toast.success('ID kopyalandı');
      if (onCopyId) onCopyId(row.entity_id);
    } catch {
      toast.error('Kopyalanamadı');
    }
  };

  return (
    <div className="audit-card">
      <div className="audit-card-icon">{icon}</div>
      <div className="audit-card-body">
        <div className="audit-card-sentence">
          {row.actor_name ? (
            <button
              type="button"
              className="audit-actor-link"
              onClick={() => onActorClick && onActorClick(row.actor_name)}
              title="Bu aktöre göre filtrele"
            >
              {row.actor_name}
            </button>
          ) : <span style={{ color: 'var(--text-muted)' }}>Bilinmeyen kullanıcı</span>}
          <span>{sentence.replace(new RegExp('^' + (row.actor_name || 'Bilinmeyen kullanıcı') + ',?\\s*'), ', ')}</span>
        </div>
        <div className="audit-card-meta">
          <span title={row.created_at}>{when}</span>
          <span className="audit-card-dot">·</span>
          <ActionBadge action={row.action} />
          <span className="audit-card-dot">·</span>
          <span>{TABLE_LABELS[row.entity_table] || row.entity_table}</span>
          {row.entity_id && (
            <>
              <span className="audit-card-dot">·</span>
              <button type="button" onClick={copyId} className="audit-card-id" title={`${row.entity_id} — kopyalamak için tıkla`}>
                {row.entity_id.slice(0, 8)}… <Copy size={10} />
              </button>
            </>
          )}
          {diff.length > 0 && (
            <>
              <span className="audit-card-dot">·</span>
              <button type="button" className="audit-card-toggle" onClick={() => setOpen((v) => !v)}>
                {open ? 'Detayı gizle' : `Detay (${diff.length} alan)`}
              </button>
            </>
          )}
        </div>
        {open && diff.length > 0 && (
          <div className="audit-card-diff">
            <DiffTable diff={diff} />
          </div>
        )}
      </div>
    </div>
  );
}

function CopyableId({ id, toast }) {
  if (!id) return <span style={{ color: 'var(--text-muted)' }}>—</span>;
  const short = id.length > 12 ? id.slice(0, 8) + '…' : id;
  const copy = async (e) => {
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(id);
      toast.success('ID kopyalandı');
    } catch {
      toast.error('Kopyalanamadı');
    }
  };
  return (
    <button
      type="button"
      onClick={copy}
      title={`${id} — kopyalamak için tıkla`}
      className="audit-id-btn"
    >
      {short}
      <Copy size={11} />
    </button>
  );
}

function FilterField({ icon: Icon, label, children }) {
  return (
    <div className="audit-filter-field">
      <label className="audit-filter-label">
        {Icon && <Icon size={12} />}
        {label}
      </label>
      {children}
    </div>
  );
}

const EMPTY_FILTERS = {
  table: '',
  action: '',
  actor: '',
  entityId: '',
  from: '',
  to: '',
};

function escapeCsv(value) {
  if (value === null || value === undefined) return '';
  const s = typeof value === 'object' ? JSON.stringify(value) : String(value);
  if (/[",\n\r]/.test(s)) return `"${s.replace(/"/g, '""')}"`;
  return s;
}

function downloadCsv(rows) {
  const headers = ['zaman', 'tablo', 'kayit_id', 'islem', 'aktor', 'ozet'];
  const lines = [headers.join(',')];
  for (const r of rows) {
    lines.push([
      escapeCsv(r.created_at),
      escapeCsv(TABLE_LABELS[r.entity_table] || r.entity_table),
      escapeCsv(r.entity_id),
      escapeCsv(ACTION_LABELS[r.action]?.label || r.action),
      escapeCsv(r.actor_name || ''),
      escapeCsv(activitySentence(r)),
    ].join(','));
  }
  const blob = new Blob(['\uFEFF' + lines.join('\n')], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const ts = new Date().toISOString().slice(0, 19).replace(/[:T]/g, '-');
  a.download = `denetim-gunlugu-${ts}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export default function AuditLogPage() {
  const toast = useToast();
  const [rows, setRows] = useState([]);
  const [total, setTotal] = useState(0);
  const [offset, setOffset] = useState(0);
  const [pageSize, setPageSize] = useState(50);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);
  const [filters, setFilters] = useState(EMPTY_FILTERS);
  const [entityIdInput, setEntityIdInput] = useState('');
  const [users, setUsers] = useState([]);
  const [autoRefresh, setAutoRefresh] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [viewMode, setViewMode] = useState('activity'); // 'activity' | 'table'
  const autoRefreshRef = useRef(null);

  useEffect(() => {
    api.getAdminUsers()
      .then((data) => setUsers(Array.isArray(data) ? data : (data?.users || [])))
      .catch(() => {});
  }, []);

  const buildQuery = useCallback((off, limit = pageSize) => {
    const q = { limit, offset: off };
    if (filters.table) q.entity_table = filters.table;
    if (filters.action) q.action = filters.action;
    if (filters.actor) q.actor_user_id = filters.actor;
    if (filters.entityId) q.entity_id = filters.entityId;
    if (filters.from) q.from = `${filters.from} 00:00:00`;
    if (filters.to) q.to = `${filters.to} 23:59:59`;
    return q;
  }, [filters, pageSize]);

  const load = useCallback(async (off = 0) => {
    setLoading(true);
    setError(null);
    try {
      const data = await api.getEntityMutations(buildQuery(off));
      setRows(data.mutations);
      setTotal(data.total);
      setOffset(off);
    } catch {
      setError('Veriler yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [buildQuery]);

  useEffect(() => { load(0); }, [load]);

  useEffect(() => {
    if (!autoRefresh) return;
    autoRefreshRef.current = setInterval(() => load(offset), AUTO_REFRESH_INTERVAL_MS);
    return () => {
      if (autoRefreshRef.current) clearInterval(autoRefreshRef.current);
    };
  }, [autoRefresh, load, offset]);

  const hasActiveFilters = Object.values(filters).some(Boolean);
  const clearFilters = () => {
    setFilters(EMPTY_FILTERS);
    setEntityIdInput('');
  };

  const applyEntityId = () => {
    setFilters((f) => ({ ...f, entityId: entityIdInput.trim() }));
  };

  const applyActorFilter = (actorName) => {
    const u = users.find((x) => (x.full_name || x.email) === actorName);
    if (u) setFilters((f) => ({ ...f, actor: u.id }));
  };

  const exportCsv = async () => {
    if (total === 0) { toast.warning?.('Dışa aktarılacak kayıt yok') || toast.error('Dışa aktarılacak kayıt yok'); return; }
    setExporting(true);
    try {
      const capped = Math.min(total, 5000);
      const data = await api.getEntityMutations(buildQuery(0, capped));
      downloadCsv(data.mutations || []);
      toast.success(`${data.mutations?.length || 0} kayıt indirildi`);
    } catch {
      toast.error('CSV dışa aktarılamadı');
    } finally {
      setExporting(false);
    }
  };

  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  const currentPage = Math.floor(offset / pageSize) + 1;

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-main page-title-line">
          <h1 className="page-title">Denetim Günlüğü</h1>
        </div>
      </div>

      <div className="audit-filter-card">
        <div className="audit-filter-card-head">
          <Filter size={14} />
          <span>Filtreler</span>
          {hasActiveFilters && (
            <button type="button" className="audit-clear-btn" onClick={clearFilters} disabled={loading}>
              <X size={12} /> Temizle
            </button>
          )}
        </div>
        <div className="audit-filter-grid">
          <FilterField icon={Database} label="Tablo">
            <select
              className="form-select audit-filter-input"
              value={filters.table}
              onChange={(e) => setFilters((f) => ({ ...f, table: e.target.value }))}
            >
              <option value="">Tümü</option>
              {Object.entries(TABLE_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v}</option>
              ))}
            </select>
          </FilterField>
          <FilterField icon={Activity} label="İşlem">
            <select
              className="form-select audit-filter-input"
              value={filters.action}
              onChange={(e) => setFilters((f) => ({ ...f, action: e.target.value }))}
            >
              <option value="">Tümü</option>
              {Object.entries(ACTION_LABELS).map(([k, v]) => (
                <option key={k} value={k}>{v.label}</option>
              ))}
            </select>
          </FilterField>
          <FilterField icon={User} label="Aktör">
            <select
              className="form-select audit-filter-input"
              value={filters.actor}
              onChange={(e) => setFilters((f) => ({ ...f, actor: e.target.value }))}
            >
              <option value="">Tümü</option>
              {users.map((u) => (
                <option key={u.id} value={u.id}>{u.full_name || u.email}</option>
              ))}
            </select>
          </FilterField>
          <FilterField icon={Calendar} label="Tarih aralığı">
            <div className="audit-daterange">
              <input
                className="form-input audit-filter-input"
                type="date"
                value={filters.from}
                onChange={(e) => setFilters((f) => ({ ...f, from: e.target.value }))}
                aria-label="Başlangıç tarihi"
              />
              <span className="audit-daterange-sep">—</span>
              <input
                className="form-input audit-filter-input"
                type="date"
                value={filters.to}
                onChange={(e) => setFilters((f) => ({ ...f, to: e.target.value }))}
                aria-label="Bitiş tarihi"
              />
            </div>
          </FilterField>
          <FilterField icon={Search} label="Kayıt ID">
            <div className="audit-search">
              <input
                className="form-input audit-filter-input"
                type="text"
                placeholder="Kayıt ID yapıştır veya yaz"
                value={entityIdInput}
                onChange={(e) => setEntityIdInput(e.target.value)}
                onKeyDown={(e) => { if (e.key === 'Enter') applyEntityId(); }}
              />
              <button type="button" className="btn btn-secondary audit-search-btn" onClick={applyEntityId} disabled={loading}>
                Ara
              </button>
            </div>
          </FilterField>
        </div>
      </div>

      <div className="audit-toolbar">
        <div className="audit-viewtoggle" role="group" aria-label="Görünüm">
          <button
            type="button"
            className={`audit-viewtoggle-btn ${viewMode === 'activity' ? 'is-active' : ''}`}
            onClick={() => setViewMode('activity')}
          >
            <List size={14} /> Aktivite
          </button>
          <button
            type="button"
            className={`audit-viewtoggle-btn ${viewMode === 'table' ? 'is-active' : ''}`}
            onClick={() => setViewMode('table')}
          >
            <Layers size={14} /> Tablo
          </button>
        </div>
        <button type="button" className="btn btn-secondary btn-icon" onClick={() => load(offset)} disabled={loading} title="Yenile">
          <RefreshCw size={15} />
        </button>
        <label className="audit-toggle">
          <input
            type="checkbox"
            checked={autoRefresh}
            onChange={(e) => setAutoRefresh(e.target.checked)}
          />
          <span>Otomatik yenile (10sn)</span>
        </label>
        <button type="button" className="btn btn-secondary" onClick={exportCsv} disabled={loading || exporting || total === 0}>
          <Download size={14} /> CSV
        </button>
        <div className="audit-pagesize">
          <span>Sayfa boyutu:</span>
          <select
            className="form-select audit-pagesize-select"
            value={pageSize}
            onChange={(e) => { setPageSize(Number(e.target.value)); setOffset(0); }}
            disabled={loading}
          >
            {PAGE_SIZE_OPTIONS.map((n) => <option key={n} value={n}>{n}</option>)}
          </select>
        </div>
        <span className="audit-count">
          {total} kayıt{hasActiveFilters ? ' (filtreli)' : ''}
        </span>
      </div>

      {error && (
        <div className="alert alert-danger" style={{ marginBottom: 14 }}>{error}</div>
      )}

      {viewMode === 'activity' ? (
        <div className="audit-feed">
          {loading && rows.length === 0 && (
            <div className="audit-empty">Yükleniyor…</div>
          )}
          {!loading && rows.length === 0 && (
            <div className="audit-empty">
              {hasActiveFilters ? 'Filtreye uygun kayıt yok' : 'Henüz kayıt yok'}
              {hasActiveFilters && (
                <div style={{ marginTop: 8 }}>
                  <button type="button" className="btn btn-ghost btn-sm" onClick={clearFilters}>Filtreleri Temizle</button>
                </div>
              )}
            </div>
          )}
          {rows.map((r) => (
            <ActivityCard
              key={r.id}
              row={r}
              onActorClick={applyActorFilter}
              toast={toast}
            />
          ))}
        </div>
      ) : (
        <div className="card audit-table-card">
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead style={{ position: 'sticky', top: 0, zIndex: 1 }}>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--bg-surface)' }}>
                {['Zaman', 'Tablo', 'Kayıt', 'İşlem', 'Aktör', 'Değişiklik'].map((h) => (
                  <th key={h} style={{ padding: '10px 14px', textAlign: 'left', fontWeight: 600, fontSize: 12, color: 'var(--text-muted)', whiteSpace: 'nowrap', background: 'var(--bg-surface)' }}>{h}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {loading && rows.length === 0 && (
                <tr><td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>Yükleniyor…</td></tr>
              )}
              {!loading && rows.length === 0 && (
                <tr>
                  <td colSpan={6} style={{ padding: 24, textAlign: 'center', color: 'var(--text-muted)' }}>
                    {hasActiveFilters ? 'Filtreye uygun kayıt yok' : 'Kayıt bulunamadı'}
                  </td>
                </tr>
              )}
              {rows.map((r) => (
                <tr key={r.id} className="audit-row" style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', color: 'var(--text-secondary)', fontSize: 12 }}>
                    {new Date(r.created_at).toLocaleString('tr-TR')}
                  </td>
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap' }}>
                    {TABLE_LABELS[r.entity_table] || r.entity_table}
                  </td>
                  <td style={{ padding: '10px 14px', maxWidth: 280, fontSize: 12 }}>
                    <div style={{ color: 'var(--text-primary)' }}>{entityLabel(r)}</div>
                    <CopyableId id={r.entity_id} toast={toast} />
                  </td>
                  <td style={{ padding: '10px 14px' }}>
                    <ActionBadge action={r.action} />
                  </td>
                  <td style={{ padding: '10px 14px', whiteSpace: 'nowrap', fontSize: 12 }}>
                    {r.actor_name ? (
                      <button
                        type="button"
                        className="audit-actor-link"
                        onClick={() => applyActorFilter(r.actor_name)}
                        title="Bu aktöre göre filtrele"
                      >
                        {r.actor_name}
                      </button>
                    ) : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                  </td>
                  <td style={{ padding: '10px 14px', minWidth: 220 }}>
                    <ChangeCell before={r.before_json} after={r.after_json} />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginTop: 14, justifyContent: 'flex-end' }}>
          <button type="button" className="btn btn-secondary btn-icon" onClick={() => load(offset - pageSize)} disabled={offset === 0 || loading}>
            <ChevronLeft size={16} />
          </button>
          <span style={{ fontSize: 13 }}>{currentPage} / {totalPages}</span>
          <button type="button" className="btn btn-secondary btn-icon" onClick={() => load(offset + pageSize)} disabled={offset + pageSize >= total || loading}>
            <ChevronRight size={16} />
          </button>
        </div>
      )}
    </div>
  );
}
