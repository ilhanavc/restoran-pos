import { useState, useEffect, useCallback } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';
import { TABLE_STATUS, formatCurrency, timeAgo } from '../../constants/index.js';
import { masaLabelInArea } from '../../utils/tableUtils.js';
import {
  RefreshCw, Users, Clock, ArrowRightLeft, Phone, X, MoreVertical, Printer, Undo2, CreditCard,
} from 'lucide-react';

export default function TablesScreen({
  onOpenOrder,
  onPayment,
  showTakeawaySidebar = false,
  onOpenTakeawayOrder,
}) {
  const [areas, setAreas] = useState([]);
  const [activeArea, setActiveArea] = useState(null);
  const [loading, setLoading] = useState(true);
  const [transferMode, setTransferMode] = useState(null);
  const [takeawayOrders, setTakeawayOrders] = useState([]);
  const [callModalOpen, setCallModalOpen] = useState(false);
  const [callHistory, setCallHistory] = useState([]);
  const [callHistoryLoading, setCallHistoryLoading] = useState(false);
  const [now, setNow] = useState(Date.now());
  const [openMenuTableId, setOpenMenuTableId] = useState(null);
  const toast = useToast();
  const location = useLocation();
  const { isConnected, subscribe } = useSocket();

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

  useEffect(() => {
    loadTables();
    if (showTakeawaySidebar) loadTakeaway();
  }, [location.key, location.state?.refreshTables, loadTables, loadTakeaway, showTakeawaySidebar]);

  useEffect(() => {
    if (!showTakeawaySidebar) {
      setTakeawayOrders([]);
      return;
    }
    loadTakeaway();
  }, [showTakeawaySidebar, loadTakeaway]);

  // Socket: masa ve sipariş değişikliklerini anlık dinle
  useEffect(() => {
    const events = [
      'table:updated', 'table:transferred',
      'order:created', 'order:updated', 'order:takeaway_delivery',
    ];
    const unsubs = events.map(ev => subscribe(ev, () => {
      loadTables();
      loadTakeaway();
    }));
    return () => unsubs.forEach(fn => fn());
  }, [subscribe, loadTables, loadTakeaway]);

  // Fallback polling: socket kopuksa 30s'de bir
  useEffect(() => {
    if (isConnected) return;
    const interval = setInterval(() => {
      loadTables();
      loadTakeaway();
    }, 30000);
    return () => clearInterval(interval);
  }, [isConnected, loadTables, loadTakeaway]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  const refreshAll = () => {
    loadTables();
    loadTakeaway();
  };

  const loadCallHistory = useCallback(async () => {
    setCallHistoryLoading(true);
    try {
      const data = await api.getCallHistory();
      setCallHistory(data || []);
    } catch (err) {
      toast.error('Arama geçmişi yüklenemedi');
    } finally {
      setCallHistoryLoading(false);
    }
  }, [toast]);

  const openCallHistoryModal = async () => {
    setCallModalOpen(true);
    await loadCallHistory();
  };

  const formatCallDateTime = (value) => {
    if (!value) return '-';
    const dt = new Date(value);
    if (Number.isNaN(dt.getTime())) return '-';
    return dt.toLocaleString('tr-TR', {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    });
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
      if (!sourceTable?.current_order_id) {
        toast.error('Taşıma için kaynak masada sipariş yok');
        setTransferMode(null);
        return;
      }
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

  const handleTableMenuAction = async (action, table, e) => {
    e.stopPropagation();
    if (action === 'transfer') {
      if (!table.current_order_id) {
        toast.error('Taşınacak sipariş yok');
        return;
      }
      setOpenMenuTableId(null);
      setTransferMode(table.id);
      return;
    }
    if (action === 'payment') {
      const orderId = table.current_order_id;
      if (!orderId) {
        toast.error('Sipariş bulunamadı');
        return;
      }
      if (!onPayment) return;
      setOpenMenuTableId(null);
      try {
        const order = await api.getOrder(orderId);
        onPayment(order);
      } catch (err) {
        toast.error(err.message || 'Sipariş yüklenemedi');
      }
      return;
    }
    if (action === 'cancel') {
      const orderId = table.current_order_id;
      if (!orderId) {
        toast.error('Sipariş bulunamadı');
        return;
      }
      const peerTables = (areas.find((a) => (a.tables || []).some((t) => t.id === table.id))?.tables || currentArea?.tables || []);
      const label = masaLabelInArea(table, peerTables);
      if (!window.confirm(`${label} siparişi iptal edilsin mi? Masa boşaltılacak.`)) return;
      try {
        await api.updateOrderStatus(orderId, 'cancelled');
        toast.success('Sipariş iptal edildi');
        setOpenMenuTableId(null);
        if (transferMode === table.id) setTransferMode(null);
        loadTables();
      } catch (err) {
        toast.error(err.message);
      }
      return;
    }
    if (action === 'print') {
      const orderId = table.current_order_id;
      if (!orderId) {
        toast.error('Sipariş bulunamadı');
        return;
      }
      try {
        await api.printReceipt(orderId);
        toast.success('Yazdırma isteği gönderildi');
        setOpenMenuTableId(null);
      } catch (err) {
        toast.error(err.message);
      }
    }
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
  const actionTable = openMenuTableId ? allTables.find((t) => t.id === openMenuTableId) : null;
  const actionTablePeers = actionTable
    ? (areas.find((a) => (a.tables || []).some((t) => t.id === actionTable.id))?.tables || [])
    : [];
  const actionDisplayName = actionTable ? masaLabelInArea(actionTable, actionTablePeers) : '';

  const stats = {
    total: allTables.length,
    empty: allTables.filter(t => t.status === 'empty').length,
    occupied: allTables.filter(t => t.status === 'occupied').length,
    hot: allTables.filter(t => {
      if (t.status !== 'occupied' || !t.order_started_at) return false;
      return (now - new Date(t.order_started_at).getTime()) / 60000 > 90;
    }).length,
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

  const actionTileBase = {
    minHeight: 84,
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    padding: 12,
    borderRadius: 'var(--radius-md)',
    border: '1px solid var(--border)',
    background: 'var(--bg-tertiary)',
    cursor: 'pointer',
    fontFamily: 'inherit',
    fontSize: 12,
    fontWeight: 700,
    color: 'var(--text-primary)',
    WebkitTapHighlightColor: 'transparent',
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
              {stats.hot > 0 && (
                <span style={{ fontSize: 12, color: 'var(--text-muted)' }}>
                  <span style={{ color: 'var(--danger)', fontWeight: 700 }}>{stats.hot}</span> Uzun Süre
                </span>
              )}
            </div>
          </div>
          <div className="tables-header-actions">
            <button className="btn btn-ghost btn-icon tables-action-btn calls-trigger-btn" onClick={openCallHistoryModal} title="Aramalar">
              <Phone size={16} />
            </button>
            {transferMode && (
              <button className="btn btn-ghost btn-sm" onClick={() => setTransferMode(null)}>
                İptal
              </button>
            )}
            <button className="btn btn-ghost btn-icon tables-action-btn" onClick={refreshAll} title="Yenile">
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

                // Masanın kaç dakikadır dolu olduğunu hesapla
                const occupiedMinutes = isOccupied && table.order_started_at
                  ? (now - new Date(table.order_started_at).getTime()) / 60000
                  : 0;

                // 5 renkli doluluk skalası
                let borderColor = 'var(--border)';
                let bg = 'var(--bg-card)';
                if (isTransferSource) {
                  borderColor = 'var(--info)';
                  bg = 'var(--info-muted)';
                } else if (isOccupied && !isReserved) {
                  if (hasReady) {
                    borderColor = 'var(--success)';
                    bg = 'var(--success-muted)';
                  } else if (occupiedMinutes > 90) {
                    // 90+ dk: kırmızı (yoğun kullanım)
                    borderColor = 'var(--danger)';
                    bg = 'rgba(239,68,68,0.07)';
                  } else if (occupiedMinutes > 30) {
                    // 30-90 dk: turuncu
                    borderColor = '#f97316';
                    bg = 'rgba(249,115,22,0.07)';
                  } else {
                    // 0-30 dk: sarı (az dolu)
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
                        e.currentTarget.style.borderColor = borderColor;
                        e.currentTarget.style.opacity = '0.85';
                      }
                    }}
                    onMouseLeave={e => {
                      e.currentTarget.style.borderColor = borderColor;
                      e.currentTarget.style.opacity = '1';
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        justifyContent: 'space-between',
                        alignItems: 'flex-start',
                        gap: 10,
                        marginBottom: 6,
                      }}
                    >
                      <div style={{
                        fontSize: 24,
                        fontWeight: 800,
                        letterSpacing: '-0.02em',
                        lineHeight: 1.15,
                        minWidth: 0,
                      }}
                      >
                        {displayName}
                      </div>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 6, flexShrink: 0 }}>
                        {hasReady && (
                          <span
                            style={{
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
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: st.color }} />
                        )}
                        {isOccupied && !isReserved && !transferMode && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon"
                            style={{ padding: 4, minHeight: 'auto', flexShrink: 0 }}
                            title="İşlemler"
                            onClick={(e) => {
                              e.stopPropagation();
                              setOpenMenuTableId((id) => (id === table.id ? null : table.id));
                            }}
                          >
                            <MoreVertical size={18} />
                          </button>
                        )}
                      </div>
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
                      <div style={{ marginTop: 'auto', display: 'flex', flexDirection: 'column', gap: 6 }}>
                        {table.order_total > 0 && (
                          <div style={{
                            fontSize: 22,
                            fontWeight: 800,
                            color: 'var(--text-primary)',
                            letterSpacing: '-0.02em',
                            lineHeight: 1.2,
                          }}
                          >
                            {formatCurrency(table.order_total)}
                            {Number(table.order_paid_total || 0) > 0 && (
                              <span style={{
                                color: 'var(--success)',
                                fontSize: 18,
                                fontWeight: 800,
                              }}>
                                /{formatCurrency(table.order_paid_total)}
                              </span>
                            )}
                          </div>
                        )}
                        <div style={{ display: 'flex', flexWrap: 'wrap', gap: 10, fontSize: 10, color: 'var(--text-muted)' }}>
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
        .table-action-sheet-grid {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 14px;
        }
        @media (min-width: 640px) {
          .table-action-sheet-grid { grid-template-columns: repeat(4, minmax(0, 1fr)); }
        }
      `}</style>

      {openMenuTableId && actionTable && (
        <div className="modal-overlay" onClick={() => setOpenMenuTableId(null)}>
          <div
            className="modal modal-md table-action-sheet-modal"
            style={{ maxWidth: 560, width: '100%' }}
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header" style={{ alignItems: 'flex-start' }}>
              <div style={{ minWidth: 0, paddingRight: 8 }}>
                <h2 style={{ fontSize: 18, margin: 0, lineHeight: 1.3 }}>Masa Adı: {actionDisplayName}</h2>
                <p style={{ fontSize: 13, color: 'var(--text-muted)', margin: '8px 0 0', lineHeight: 1.4 }}>
                  Sipariş veya masa ile ilgili hızlı işlemler
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setOpenMenuTableId(null)}
                title="Kapat"
                style={{ flexShrink: 0 }}
              >
                <X size={18} />
              </button>
            </div>
            <div className="modal-body" style={{ paddingTop: 8 }}>
              <div className="table-action-sheet-grid">
                {actionTable.current_order_id && (
                  <button
                    type="button"
                    style={actionTileBase}
                    onClick={(e) => handleTableMenuAction('transfer', actionTable, e)}
                  >
                    <ArrowRightLeft size={26} color="var(--accent)" strokeWidth={2} />
                    Masayı Taşı
                  </button>
                )}
                {onPayment && actionTable.current_order_id && (
                  <button
                    type="button"
                    style={actionTileBase}
                    onClick={(e) => handleTableMenuAction('payment', actionTable, e)}
                  >
                    <CreditCard size={26} color="var(--accent)" strokeWidth={2} />
                    Ödeme al
                  </button>
                )}
                <button
                  type="button"
                  style={{
                    ...actionTileBase,
                    borderColor: 'var(--danger)',
                    color: 'var(--danger)',
                    background: 'rgba(239, 68, 68, 0.08)',
                  }}
                  onClick={(e) => handleTableMenuAction('cancel', actionTable, e)}
                >
                  <Undo2 size={26} color="var(--danger)" strokeWidth={2} />
                  İptal
                </button>
                <button
                  type="button"
                  style={actionTileBase}
                  onClick={(e) => handleTableMenuAction('print', actionTable, e)}
                >
                  <Printer size={26} color="var(--accent)" strokeWidth={2} />
                  Yazdırma
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {callModalOpen && (
        <div className="modal-overlay" onClick={() => setCallModalOpen(false)}>
          <div className="modal modal-lg calls-history-modal" onClick={(e) => e.stopPropagation()}>
            <div className="modal-header">
              <h2>Caller ID Son 7 Günlük Arama Geçmişi</h2>
              <button className="btn btn-ghost btn-icon" onClick={() => setCallModalOpen(false)} title="Kapat">
                <X size={14} />
              </button>
            </div>
            <div className="modal-body">
              {callHistoryLoading ? (
                <div className="empty-state">Yükleniyor...</div>
              ) : callHistory.length === 0 ? (
                <div className="empty-state">
                  <div className="empty-state-text">Gösterilecek arama kaydı bulunamadı</div>
                </div>
              ) : (
                <table className="data-table calls-history-table">
                  <thead>
                    <tr>
                      <th>#</th>
                      <th>Numara</th>
                      <th>Müşteri</th>
                      <th>Arama Tarih/Saat</th>
                      <th>Durum</th>
                      <th>Sipariş</th>
                    </tr>
                  </thead>
                  <tbody>
                    {callHistory.map((call, index) => {
                      const orderOpened = Boolean(call.opened_order || call.order_id || call.order_no);
                      return (
                        <tr key={call.id}>
                          <td>{index + 1}</td>
                          <td>{call.phone || '-'}</td>
                          <td>{call.customer_name_snapshot || call.customer_name || 'Yeni Müşteri'}</td>
                          <td>{formatCallDateTime(call.created_at)}</td>
                          <td>{call.status || '-'}</td>
                          <td>
                            <span className={`badge ${orderOpened ? 'badge-success' : 'badge-warning'}`}>
                              {orderOpened ? 'Sipariş Alındı' : 'Sipariş Alınmadı'}
                            </span>
                          </td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
