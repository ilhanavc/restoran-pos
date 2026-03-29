import { useState, useEffect, useCallback } from 'react';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { TABLE_STATUS, formatCurrency, timeAgo } from '../../constants/index.js';
import { masaLabelInArea } from '../../utils/tableUtils.js';
import { RefreshCw, Users, Clock, ArrowRightLeft } from 'lucide-react';

export default function TablesScreen({
  onOpenOrder,
  showTakeawaySidebar = false,
  onOpenTakeawayOrder,
}) {
  const [areas, setAreas] = useState([]);
  const [activeArea, setActiveArea] = useState(null);
  const [loading, setLoading] = useState(true);
  const [transferMode, setTransferMode] = useState(null);
  const [takeawayOrders, setTakeawayOrders] = useState([]);
  const [now, setNow] = useState(Date.now());
  const toast = useToast();

  const loadTables = useCallback(async () => {
    try {
      const data = await api.getTables();
      setAreas(data);
      if (!activeArea && data.length > 0) setActiveArea(data[0].id);
    } catch (err) {
      toast.error('Masalar yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [activeArea, toast]);

  const loadTakeaway = useCallback(async () => {
    if (!showTakeawaySidebar) return;
    try {
      const data = await api.getTakeawayOpenOrders();
      setTakeawayOrders(data);
    } catch {
      toast.error('Paket siparişler yüklenemedi');
    }
  }, [showTakeawaySidebar, toast]);

  useEffect(() => { loadTables(); }, []);

  useEffect(() => {
    if (!showTakeawaySidebar) {
      setTakeawayOrders([]);
      return;
    }
    loadTakeaway();
  }, [showTakeawaySidebar, loadTakeaway]);

  useEffect(() => {
    const interval = setInterval(() => {
      loadTables();
      loadTakeaway();
    }, 15000);
    return () => clearInterval(interval);
  }, [loadTables, loadTakeaway]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const refreshAll = () => {
    loadTables();
    loadTakeaway();
  };

  const currentArea = areas.find(a => a.id === activeArea);

  const handleTableClick = async (table) => {
    const areaTables = currentArea?.tables || [];
    if (transferMode) {
      if (table.id === transferMode) {
        setTransferMode(null);
        return;
      }
      const sourceTable = areaTables.find((t) => t.id === transferMode);
      const fromLabel = masaLabelInArea(sourceTable, areaTables);
      const toLabel = masaLabelInArea(table, areaTables);
      if (!window.confirm(`${fromLabel} → ${toLabel} masasına taşınsın mı?`)) return;
      try {
        await api.transferTable(transferMode, table.id);
        toast.success('Masa transfer edildi');
        setTransferMode(null);
        loadTables();
      } catch (err) {
        toast.error(err.message);
      }
      return;
    }
    onOpenOrder({
      ...table,
      area_name: currentArea?.name,
      displayName: masaLabelInArea(table, areaTables),
    });
  };

  const handleTakeawayDelivery = async (orderId, action, e) => {
    e?.stopPropagation();
    try {
      await api.patchTakeawayDelivery(orderId, action);
      loadTakeaway();
      loadTables();
    } catch (err) {
      toast.error(err.message);
    }
  };

  const allTables = areas.flatMap(a => a.tables || []);
  const stats = {
    total: allTables.length,
    empty: allTables.filter(t => t.status === 'empty').length,
    occupied: allTables.filter(t => t.status === 'occupied').length,
  };

  const btnBase = {
    padding: '8px 10px',
    borderRadius: 10,
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    border: '1px solid rgba(255,255,255,.12)',
    flex: 1,
  };

  return (
    <div className="page-container" style={{ display: 'flex', flexDirection: 'column', height: '100%', padding: 0 }}>
      <div style={{ padding: '16px 24px 0', flexShrink: 0 }}>
        <div className="page-header">
          <div>
            <h1 className="page-title">Masalar</h1>
            <div style={{ display: 'flex', gap: 16, marginTop: 6 }}>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                <span style={{ color: 'var(--success)', fontWeight: 700 }}>{stats.empty}</span> Boş
              </span>
              <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                <span style={{ color: 'var(--warning)', fontWeight: 700 }}>{stats.occupied}</span> Dolu
              </span>
            </div>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            {transferMode && (
              <button className="btn btn-ghost btn-sm" onClick={() => setTransferMode(null)}>
                İptal
              </button>
            )}
            <button className="btn btn-ghost btn-icon" onClick={refreshAll} title="Yenile">
              <RefreshCw size={16} />
            </button>
          </div>
        </div>

        {transferMode && (
          <div style={{
            padding: '10px 16px', borderRadius: 'var(--radius-sm)',
            background: 'var(--info-muted)', color: 'var(--info)',
            fontSize: 13, fontWeight: 600, marginBottom: 12,
            display: 'flex', alignItems: 'center', gap: 8,
          }}>
            <ArrowRightLeft size={16} />
            Hedef masayı seçin
          </div>
        )}

        <div className="tabs" style={{ marginBottom: 0 }}>
          {areas.map(area => (
            <button key={area.id} className={`tab ${activeArea === area.id ? 'active' : ''}`}
              onClick={() => setActiveArea(area.id)}>
              {area.name}
              <span style={{ fontSize: 10, marginLeft: 4, opacity: 0.6 }}>
                ({(area.tables || []).filter(t => t.status === 'occupied').length}/{(area.tables || []).length})
              </span>
            </button>
          ))}
        </div>
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        <div style={{
          flex: 1, overflow: 'auto', padding: '16px 24px 24px',
          paddingRight: showTakeawaySidebar ? 12 : 24,
        }}>
          {loading ? (
            <div className="empty-state"><div style={{ animation: 'pulse 1.5s infinite' }}>Yükleniyor...</div></div>
          ) : (
            <div
              className="tables-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gap: 18,
              }}
            >
              {(currentArea?.tables || []).map(table => {
                const st = TABLE_STATUS[table.status];
                const isOccupied = table.status === 'occupied';
                const isReserved = table.status === 'reserved';
                const isTransferSource = transferMode === table.id;
                const hasReady = isOccupied && (Number(table.has_ready_items) === 1 || table.has_ready_items === true);

                let borderColor = 'var(--border)';
                let bg = 'var(--bg-card)';
                if (isTransferSource) {
                  borderColor = 'var(--info)';
                  bg = 'var(--info-muted)';
                } else if (isOccupied && !isReserved) {
                  if (hasReady) {
                    borderColor = 'var(--success)';
                    bg = 'var(--success-muted)';
                  } else {
                    borderColor = 'var(--warning)';
                    bg = 'var(--warning-muted)';
                  }
                } else if (isReserved) {
                  borderColor = st.color + '40';
                }

                const displayName = masaLabelInArea(table, currentArea?.tables || []);

                return (
                  <div
                    key={table.id}
                    onClick={() => handleTableClick(table)}
                    style={{
                      background: bg,
                      border: `1.5px solid ${borderColor}`,
                      borderRadius: 'var(--radius-md)',
                      padding: '22px',
                      cursor: 'pointer',
                      transition: 'all var(--transition-fast)',
                      position: 'relative',
                      minHeight: 150,
                      display: 'flex',
                      flexDirection: 'column',
                    }}
                    onMouseEnter={e => {
                      if (!isTransferSource) {
                        e.currentTarget.style.borderColor = hasReady && isOccupied ? 'var(--success)' : isOccupied && !isReserved ? 'var(--warning)' : st.color;
                      }
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = borderColor;
                    }}
                  >
                    {hasReady && (
                      <span
                        style={{
                          position: 'absolute',
                          top: 8,
                          right: 8,
                          fontSize: 10,
                          background: 'var(--success)',
                          color: '#fff',
                          padding: '2px 7px',
                          borderRadius: 6,
                          fontWeight: 700,
                          animation: 'pulse 2s infinite',
                        }}
                      >
                        HAZIR
                      </span>
                    )}
                    {!hasReady && (
                      <div style={{ position: 'absolute', top: 12, right: 12, width: 8, height: 8, borderRadius: '50%', background: st.color }} />
                    )}

                    <div style={{ fontSize: 24, fontWeight: 800, letterSpacing: '-0.02em', marginBottom: 6 }}>
                      {displayName}
                    </div>

                    {!isReserved && (
                      <div style={{ fontSize: 12, fontWeight: 600, color: st.color, marginBottom: 2 }}>
                        {st.label}
                      </div>
                    )}

                    {isOccupied && table.waiter_name && (
                      <div style={{ fontSize: 11, color: 'var(--text-muted)', marginBottom: 4 }}>
                        {table.waiter_name}
                      </div>
                    )}

                    {isOccupied && (
                      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 4 }}>
                        {table.order_total > 0 && (
                          <div style={{ fontSize: 16, fontWeight: 700, color: 'var(--text-primary)', letterSpacing: '-0.01em' }}>
                            {formatCurrency(table.order_total)}
                          </div>
                        )}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 10, color: 'var(--text-muted)' }}>
                          {table.order_line_count > 0 && (
                            <span>{table.order_line_count} kalem</span>
                          )}
                          {table.guest_count > 0 && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                              <Users size={10} /> {table.guest_count}
                            </span>
                          )}
                          {table.order_started_at && (
                            <span style={{ display: 'flex', alignItems: 'center', gap: 3 }}>
                              <Clock size={10} /> {timeAgo(table.order_started_at, now)}
                            </span>
                          )}
                        </div>
                      </div>
                    )}

                    {isOccupied && !transferMode && (
                      <button
                        style={{
                          position: 'absolute', bottom: 8, right: 8,
                          background: 'var(--bg-tertiary)', border: 'none',
                          borderRadius: 4, padding: '3px 6px', cursor: 'pointer',
                          color: 'var(--text-muted)', fontSize: 10,
                        }}
                        onClick={(e) => { e.stopPropagation(); setTransferMode(table.id); }}
                        title="Masa Taşı"
                      >
                        <ArrowRightLeft size={12} />
                      </button>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        {showTakeawaySidebar && (
          <aside
            style={{
              width: 340,
              flexShrink: 0,
              background: 'var(--bg-secondary)',
              borderLeft: '1px solid var(--border)',
              padding: 16,
              overflowY: 'auto',
              display: 'flex',
              flexDirection: 'column',
              gap: 10,
            }}
          >
            <div style={{ fontSize: 13, fontWeight: 700, color: 'var(--text-primary)', marginBottom: 4 }}>
              Paket siparişler
            </div>
            {takeawayOrders.length === 0 && (
              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Açık paket siparişi yok.
              </div>
            )}
            {takeawayOrders.map((o) => {
              const isOut = Boolean(o.takeaway_out_at);
              return (
                <div
                  key={o.id}
                  style={{
                    borderRadius: 12,
                    border: '1px solid var(--border)',
                    background: 'var(--bg-card)',
                    overflow: 'hidden',
                  }}
                >
                  <button
                    type="button"
                    onClick={() => onOpenTakeawayOrder?.(o.id)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: 12,
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                    }}
                  >
                    <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--accent)', marginBottom: 4 }}>
                      #{o.order_no ?? o.id.slice(0, 8)}
                    </div>
                    {o.created_at && (
                      <div style={{ fontSize: 11, color: 'var(--warning)', marginBottom: 6, fontWeight: 600 }}>
                        {timeAgo(o.created_at, now)}
                      </div>
                    )}
                    {isOut && (
                      <div style={{
                        fontSize: 10, fontWeight: 700, color: 'var(--info)',
                        marginBottom: 6, textTransform: 'uppercase', letterSpacing: 0.5,
                      }}>
                        Teslimatta
                      </div>
                    )}
                    <div style={{ fontSize: 11, color: 'var(--text-muted)' }}>
                      {o.user_name || '—'} · {o.item_count ?? 0} kalem
                    </div>
                    {o.customer_name && (
                      <div style={{ fontSize: 11, color: 'var(--text-secondary)', marginTop: 4 }}>{o.customer_name}</div>
                    )}
                    <div style={{ fontSize: 14, fontWeight: 700, marginTop: 8 }}>{formatCurrency(o.total)}</div>
                  </button>
                  <div
                    style={{ display: 'flex', gap: 8, padding: '0 10px 10px', flexWrap: 'wrap' }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      disabled={isOut}
                      onClick={(e) => handleTakeawayDelivery(o.id, 'out_for_delivery', e)}
                      style={{
                        ...btnBase,
                        background: isOut ? 'var(--bg-tertiary)' : 'var(--warning-muted)',
                        color: isOut ? 'var(--text-muted)' : 'var(--warning)',
                        borderColor: isOut ? 'var(--border)' : 'var(--warning)',
                        cursor: isOut ? 'not-allowed' : 'pointer',
                        opacity: isOut ? 0.65 : 1,
                      }}
                    >
                      Teslimata Çıkarıldı
                    </button>
                    <button
                      type="button"
                      disabled={!isOut}
                      onClick={(e) => handleTakeawayDelivery(o.id, 'delivered', e)}
                      style={{
                        ...btnBase,
                        background: isOut ? 'var(--success-muted)' : 'var(--bg-tertiary)',
                        color: isOut ? 'var(--success)' : 'var(--text-muted)',
                        borderColor: isOut ? 'var(--success)' : 'var(--border)',
                        cursor: isOut ? 'pointer' : 'not-allowed',
                        opacity: isOut ? 1 : 0.65,
                      }}
                    >
                      Teslim Edildi
                    </button>
                  </div>
                </div>
              );
            })}
          </aside>
        )}
      </div>
      <style>{`
        @media (max-width: 900px) {
          .tables-grid { grid-template-columns: repeat(2, minmax(0, 1fr)) !important; }
        }
        @media (max-width: 520px) {
          .tables-grid { grid-template-columns: minmax(0, 1fr) !important; }
        }
      `}</style>
    </div>
  );
}
