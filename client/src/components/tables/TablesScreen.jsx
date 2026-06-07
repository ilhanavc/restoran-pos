import { useState, useEffect, useCallback, useRef } from 'react';
import { useLocation } from 'react-router-dom';
import api from '../../services/api.js';
import { useToast } from '../../context/ToastContext.jsx';
import { useIncomingCall } from '../../context/IncomingCallContext.jsx';
import { useSocket } from '../../context/SocketContext.jsx';
import { TABLE_STATUS, formatCurrency, parseDbTimestampMs } from '../../constants/index.js';
import { masaLabelInArea } from '../../utils/tableUtils.js';
import { isOrderFullyPaid } from '../../utils/orderPaymentState.js';
import { getPrintErrorMessage } from '../../utils/printErrorMessages.js';
import { formatDateTimeInIstanbul } from '../../utils/time.js';
import ConfirmDialog from '../common/ConfirmDialog.jsx';
import ManualPrintSelectorModal from '../common/ManualPrintSelectorModal.jsx';
import {
  RefreshCw, Users, Clock, ArrowRightLeft, Phone, X, MoreVertical, Printer, Undo2, CreditCard, CheckCircle2, Package, AlertTriangle,
} from 'lucide-react';

function formatOrderElapsed(dateStr, now = Date.now()) {
  const startedAt = parseDbTimestampMs(dateStr);
  if (!Number.isFinite(startedAt)) return '';
  const totalSeconds = Math.max(0, Math.floor((now - startedAt) / 1000));
  const seconds = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minutes = totalMinutes % 60;
  const totalHours = Math.floor(totalMinutes / 60);
  if (totalHours >= 24) {
    const days = Math.floor(totalHours / 24);
    const hours = totalHours % 24;
    return `${days} gün ${hours} sa ${minutes} dk ${seconds} sn`;
  }
  if (totalHours >= 1) {
    return `${totalHours} sa ${minutes} dk ${seconds} sn`;
  }
  return `${totalMinutes} dk ${seconds} sn`;
}

export default function TablesScreen({
  onOpenOrder,
  onPayment,
  onQuickPayment,
  showTakeawaySidebar = false,
  onOpenTakeawayOrder,
  onNewTakeawayOrder,
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
  const [tableCancelTarget, setTableCancelTarget] = useState(null);
  const [tableCancelLoading, setTableCancelLoading] = useState(false);
  const [openTakeawayMenuId, setOpenTakeawayMenuId] = useState(null);
  const [takeawayConfirmTarget, setTakeawayConfirmTarget] = useState(null);
  const [takeawayActionLoading, setTakeawayActionLoading] = useState(null);
  const [recentlyMovedTableId, setRecentlyMovedTableId] = useState(null);
  const [tableConfirm, setTableConfirm] = useState(null);
  const [manualPrintDialog, setManualPrintDialog] = useState({ open: false, orderId: null, role: 'receipt', kind: 'receipt', title: '' });
  const [printHealth, setPrintHealth] = useState(null);
  const [retryingPrintJobId, setRetryingPrintJobId] = useState(null);
  const [printAlertOpen, setPrintAlertOpen] = useState(false);
  const takeawayMenuRef = useRef(null);
  const toast = useToast();
  const { openOrder: openIncomingCallOrder } = useIncomingCall() || {};
  const location = useLocation();
  const { isConnected, subscribe } = useSocket();
  const highlightedTableId = location.state?.highlightTableId || null;
  const activeHighlightTableId = recentlyMovedTableId || highlightedTableId;

  const loadTables = useCallback(async () => {
    try {
      const data = await api.getTables();
      setAreas(data);
      const highlightedArea = activeHighlightTableId
        ? data.find((area) => (area.tables || []).some((table) => table.id === activeHighlightTableId))
        : null;
      if (highlightedArea) {
        setActiveArea(highlightedArea.id);
      } else if (!activeArea && data.length > 0) {
        setActiveArea(data[0].id);
      }
    } catch {
      toast.error('Masalar yüklenemedi');
    } finally {
      setLoading(false);
    }
  }, [activeArea, activeHighlightTableId, toast]);

  const loadTakeaway = useCallback(async () => {
    if (!showTakeawaySidebar) return;
    try {
      const data = await api.getTakeawayOpenOrders();
      setTakeawayOrders(data);
    } catch {
      toast.error('Paket siparişler yüklenemedi');
    }
  }, [showTakeawaySidebar, toast]);

  const loadPrintHealth = useCallback(async () => {
    try {
      const data = await api.getPrintHealth();
      setPrintHealth(data);
    } catch {
      setPrintHealth(null);
    }
  }, []);

  useEffect(() => {
    loadTables();
    if (showTakeawaySidebar) loadTakeaway();
    loadPrintHealth();
  }, [location.key, location.state?.refreshTables, loadTables, loadTakeaway, loadPrintHealth, showTakeawaySidebar]);

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
      loadPrintHealth();
    }));
    return () => unsubs.forEach(fn => fn());
  }, [subscribe, loadTables, loadTakeaway, loadPrintHealth]);

  // Fallback polling: socket kopuksa 30s'de bir
  useEffect(() => {
    if (isConnected) return;
    const interval = setInterval(() => {
      loadTables();
      loadTakeaway();
      loadPrintHealth();
    }, 30000);
    return () => clearInterval(interval);
  }, [isConnected, loadTables, loadTakeaway, loadPrintHealth]);

  useEffect(() => {
    const t = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    if (!recentlyMovedTableId) return undefined;
    const timer = setTimeout(() => setRecentlyMovedTableId(null), 6000);
    return () => clearTimeout(timer);
  }, [recentlyMovedTableId]);

  useEffect(() => {
    if (!openTakeawayMenuId && !takeawayConfirmTarget && !tableCancelTarget && !tableConfirm) return undefined;
    const onKeyDown = (e) => {
      if (e.key !== 'Escape') return;
      if (!tableCancelLoading) setTableCancelTarget(null);
      setOpenTakeawayMenuId(null);
      setTakeawayConfirmTarget(null);
      setTableConfirm(null);
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [openTakeawayMenuId, takeawayConfirmTarget, tableCancelTarget, tableConfirm, tableCancelLoading]);

  useEffect(() => {
    if (!openTakeawayMenuId) return undefined;
    const onPointerDown = (e) => {
      if (takeawayMenuRef.current?.contains(e.target)) return;
      setOpenTakeawayMenuId(null);
    };
    document.addEventListener('pointerdown', onPointerDown);
    return () => document.removeEventListener('pointerdown', onPointerDown);
  }, [openTakeawayMenuId]);

  const refreshAll = () => {
    loadTables();
    loadTakeaway();
    loadPrintHealth();
  };

  const retryFirstFailedPrintJob = async ({ silent = false } = {}) => {
    const job = printHealth?.recentFailed?.[0];
    if (!job?.id || retryingPrintJobId) return;
    setRetryingPrintJobId(job.id);
    try {
      await api.retryPrintJob(job.id);
      if (!silent) toast.success('Yazdırma işi yeniden kuyruğa alındı');
      await loadPrintHealth();
    } catch (err) {
      toast.error(err.message || 'Yazdırma işi yeniden denenemedi');
    } finally {
      setRetryingPrintJobId(null);
    }
  };

  const loadCallHistory = useCallback(async () => {
    setCallHistoryLoading(true);
    try {
      const data = await api.getCallHistory();
      setCallHistory(data || []);
    } catch {
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
    return formatDateTimeInIstanbul(value, {
      day: '2-digit',
      month: '2-digit',
      year: 'numeric',
      hour: '2-digit',
      minute: '2-digit',
    }) || '-';
  };

  const getCallStatusLabel = (status) => {
    const labels = {
      ringing: 'Çalıyor',
      dismissed: 'Kapatıldı',
      opened_order: 'Siparişe Dönüştü',
      completed: 'Tamamlandı',
    };
    return labels[status] || status || '-';
  };

  const currentArea = areas.find(a => a.id === activeArea);

  const performTableTransfer = async (sourceTableId, targetTable) => {
    try {
      await api.transferTable(sourceTableId, targetTable.id);
      toast.success('Masa transfer edildi');
      setTransferMode(null);
      setRecentlyMovedTableId(targetTable.id);
      loadTables();
    } catch (err) {
      toast.error(err.message);
    }
  };

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
      if (table.status !== 'empty') {
        toast.error(table.status === 'reserved' ? 'Rezerve masaya taşıma yapılamaz' : 'Hedef masa boş olmalı');
        return;
      }
      const fromLabel = masaLabelInArea(sourceTable, areaTables);
      const toLabel = masaLabelInArea(table, areaTables);
      setTableConfirm({
        title: 'Masa taşınsın mı?',
        body: `${fromLabel} siparişi ${toLabel} masasına taşınacak.`,
        confirmLabel: 'Masayı Taşı',
        tone: 'primary',
        onConfirm: () => performTableTransfer(transferMode, table),
      });
      return;
    }
    if (table.status === 'reserved' && !table.current_order_id) {
      const label = masaLabelInArea(table, areaTables);
      setTableConfirm({
        title: 'Rezerve masa açılsın mı?',
        body: `${label} rezerve görünüyor. Rezervasyonu kullanarak sipariş açılacak.`,
        confirmLabel: 'Sipariş Aç',
        tone: 'primary',
        onConfirm: () => onOpenOrder({
          ...table,
          area_name: currentArea?.name,
          displayName: masaLabelInArea(table, areaTables),
        }),
      });
      return;
    }
    onOpenOrder({
      ...table,
      area_name: currentArea?.name,
      displayName: masaLabelInArea(table, areaTables),
    });
  };

  const attachTablePaymentContext = (order, table) => {
    const peerTables = areas.find((a) => (a.tables || []).some((t) => t.id === table.id))?.tables || currentArea?.tables || [];
    const displayName = masaLabelInArea(table, peerTables);
    return {
      ...order,
      table_id: order.table_id || table.id,
      table_name: order.table_name || table.name,
      table_display_name: displayName,
      area_name: areas.find((a) => (a.tables || []).some((t) => t.id === table.id))?.name || currentArea?.name || order.area_name,
    };
  };

  const isTableBillPaid = (table) => table?.status === 'occupied' && isOrderFullyPaid(table);

  const handleTableMenuAction = async (action, table, e) => {
    e?.stopPropagation();
    if (action === 'open') {
      handleTableClick(table);
      return;
    }
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
        onPayment(attachTablePaymentContext(order, table));
      } catch (err) {
        toast.error(err.message || 'Sipariş yüklenemedi');
      }
      return;
    }
    if (action === 'quick-payment') {
      const orderId = table.current_order_id;
      if (!orderId) {
        toast.error('Sipariş bulunamadı');
        return;
      }
      if (!onQuickPayment) return;
      setOpenMenuTableId(null);
      try {
        const order = await api.getOrder(orderId);
        onQuickPayment(attachTablePaymentContext(order, table));
      } catch (err) {
        toast.error(err.message || 'Sipariş yüklenemedi');
      }
      return;
    }
    if (action === 'close-paid-table') {
      const orderId = table.current_order_id;
      if (!orderId) {
        toast.error('Sipariş bulunamadı');
        return;
      }
      if (!isTableBillPaid(table)) {
        toast.error('Hesap tamamen ödenmeden masa kapatılamaz');
        return;
      }
      setOpenMenuTableId(null);
      try {
        await api.updateOrderStatus(orderId, 'closed');
        toast.success('Masa kapatıldı');
        loadTables();
        loadTakeaway();
      } catch (err) {
        toast.error(err.message || 'Masa kapatılamadı');
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
      setTableCancelTarget({ table, orderId, label });
      setOpenMenuTableId(null);
      return;
    }
    if (action === 'print') {
      const orderId = table.current_order_id;
      if (!orderId) {
        toast.error('Sipariş bulunamadı');
        return;
      }
      setManualPrintDialog({
        open: true,
        orderId,
        role: 'receipt',
        kind: 'receipt',
        title: 'Adisyon yazdır',
      });
    }
  };

  const handleTakeawayDelivery = async (orderId, action, e) => {
    e?.stopPropagation();
    if (takeawayActionLoading) return;
    setTakeawayActionLoading({ orderId, action });
    try {
      await api.patchTakeawayDelivery(orderId, action);
      loadTakeaway();
      loadTables();
    } catch (err) {
      toast.error(err.message);
    } finally {
      setTakeawayActionLoading(null);
    }
  };

  const confirmTableCancel = async () => {
    const target = tableCancelTarget;
    if (!target || tableCancelLoading) return;
    setTableCancelLoading(true);
    try {
      await api.updateOrderStatus(target.orderId, 'cancelled');
      toast.success('Sipariş iptal edildi');
      if (transferMode === target.table.id) setTransferMode(null);
      setTableCancelTarget(null);
      loadTables();
      loadTakeaway();
    } catch (err) {
      toast.error(err.message || 'Sipariş iptal edilemedi');
    } finally {
      setTableCancelLoading(false);
    }
  };

  const handleTakeawayPrint = async (orderId, e) => {
    e?.stopPropagation();
    if (takeawayActionLoading) return;
    setOpenTakeawayMenuId(null);
    setManualPrintDialog({
      open: true,
      orderId,
      role: 'kitchen',
      kind: 'takeaway',
      title: 'Paket etiketi yazdır',
    });
  };

  const requestTakeawayCancel = (order, e) => {
    e?.stopPropagation();
    setOpenTakeawayMenuId(null);
    setTakeawayConfirmTarget(order);
  };

  const confirmTakeawayCancel = async () => {
    const order = takeawayConfirmTarget;
    if (!order || takeawayActionLoading) return;
    setTakeawayActionLoading({ orderId: order.id, action: 'cancel' });
    try {
      await api.updateOrderStatus(order.id, 'cancelled');
      toast.success('Sipariş iptal edildi');
      setTakeawayConfirmTarget(null);
      loadTakeaway();
      loadTables();
    } catch (err) {
      toast.error(err.message || 'Sipariş iptal edilemedi');
    } finally {
      setTakeawayActionLoading(null);
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
    paid: allTables.filter(t => t.status === 'occupied' && Number(t.order_total || 0) > 0 && Number(t.order_paid_total || 0) + 0.02 >= Number(t.order_total || 0)).length,
    hot: allTables.filter(t => {
      if (t.status !== 'occupied' || !t.order_started_at) return false;
      return (now - parseDbTimestampMs(t.order_started_at)) / 60000 > 60;
    }).length,
  };
  const printSummary = printHealth?.summary || {};
  const failedPrintCount = Number(printSummary.failed) || 0;
  const stalePrintCount = Number(printSummary.stale_claimed) || 0;
  const pendingPrintCount = Number(printSummary.pending) || 0;
  const firstFailedPrintJob = printHealth?.recentFailed?.[0] || null;

  const btnBase = {
    padding: '8px 10px',
    borderRadius: 8,
    fontSize: 11,
    fontWeight: 700,
    cursor: 'pointer',
    border: '1px solid var(--border)',
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
    <div className="page-container page-container--flush tables-page" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div className="page-top-safe" style={{ flexShrink: 0 }}>
        <div className="page-header tables-page-header">
          <div className="tables-header-main">
            <h1 className="page-title">Masalar</h1>
          </div>
          <div className="tables-header-stats">
            <span className="tables-header-stat">
              <span style={{ color: 'var(--success)', fontWeight: 700 }}>{stats.empty}</span> Boş
            </span>
            <span className="tables-header-stat">
              <span style={{ color: 'var(--warning)', fontWeight: 700 }}>{stats.occupied}</span> Dolu
            </span>
            {stats.paid > 0 && (
              <span className="tables-header-stat">
                <span style={{ color: 'var(--success)', fontWeight: 700 }}>{stats.paid}</span> Hesap Ödendi
              </span>
            )}
            {stats.hot > 0 && (
              <span className="tables-header-stat">
                <span style={{ color: 'var(--danger)', fontWeight: 700 }}>{stats.hot}</span> Uzun Süre
              </span>
            )}
          </div>
          {onNewTakeawayOrder && (
            <div className="tables-header-primary">
              <button
                type="button"
                className="btn btn-ghost tables-paket-btn"
                data-testid="tables-new-takeaway-button"
                onClick={onNewTakeawayOrder}
                title="Yeni paket siparişi"
              >
                <Package size={18} />
                Paket
              </button>
            </div>
          )}
          <div className="tables-header-actions page-header-actions">
            <div className="tables-header-secondary">
              <button className="btn btn-ghost btn-icon tables-action-btn calls-trigger-btn" onClick={openCallHistoryModal} title="Aramalar">
                <Phone size={16} />
              </button>
              {(failedPrintCount > 0 || stalePrintCount > 0) && (
                <button
                  type="button"
                  className="btn btn-icon tables-action-btn tables-print-alert-btn"
                  onClick={() => setPrintAlertOpen(true)}
                  title="Yazdırma sorunu var"
                  aria-label="Yazdırma sorunu var, detay için tıklayın"
                  style={{
                    background: 'var(--danger)',
                    color: 'var(--text-on-accent, #fff)',
                    borderColor: 'var(--danger)',
                  }}
                >
                  <AlertTriangle size={16} />
                </button>
              )}
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
      </div>

      <div style={{ flex: 1, display: 'flex', minHeight: 0, overflow: 'hidden' }}>
        <div style={{
          flex: 1, overflow: 'auto', padding: '16px var(--page-padding-x) 24px var(--page-safe-left)',
          paddingRight: showTakeawaySidebar ? 12 : 24,
        }}>
          <div className="tabs" style={{ marginBottom: 12 }}>
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
          {loading ? (
            <div className="empty-state"><div style={{ animation: 'pulse 1.5s infinite' }}>Yükleniyor...</div></div>
          ) : (
            <div
              className="tables-grid"
              style={{
                display: 'grid',
                gridTemplateColumns: 'repeat(3, minmax(0, 1fr))',
                gridAutoRows: 180,
                gap: 18,
              }}
            >
              {(currentArea?.tables || []).map(table => {
                const st = TABLE_STATUS[table.status];
                const isOccupied = table.status === 'occupied';
                const isReserved = table.status === 'reserved';
                const isTransferSource = transferMode === table.id;
                const isHighlighted = activeHighlightTableId === table.id;
                const hasReady = isOccupied && (Number(table.has_ready_items) === 1 || table.has_ready_items === true);
                const isPaid = isOccupied
                  && Number(table.order_total || 0) > 0
                  && Number(table.order_paid_total || 0) + 0.02 >= Number(table.order_total || 0);

                // Masanın kaç dakikadır dolu olduğunu hesapla
                const occupiedMinutes = isOccupied && table.order_started_at
                  ? (now - parseDbTimestampMs(table.order_started_at)) / 60000
                  : 0;

                // 5 renkli doluluk skalası
                let borderColor = 'var(--border)';
                let bg = 'var(--bg-card)';
                if (isTransferSource) {
                  borderColor = 'var(--info)';
                  bg = 'var(--info-muted)';
                } else if (isOccupied && !isReserved) {
                  if (isPaid) {
                    borderColor = 'var(--success)';
                    bg = 'var(--success-muted)';
                  } else if (hasReady) {
                    borderColor = 'var(--success)';
                    bg = 'var(--success-muted)';
                  } else if (occupiedMinutes > 60) {
                    // 60+ dk: uzun süre
                    borderColor = 'var(--danger)';
                    bg = 'var(--danger-muted)';
                  } else {
                    // 0-60 dk: normal dolu
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
                    data-testid={`table-card-${table.id}`}
                    data-table-status={table.status}
                    style={{
                      background: bg,
                      border: `1.5px solid ${borderColor}`,
                      borderRadius: 'var(--radius-md)',
                      padding: '22px',
                      cursor: 'pointer',
                      transition: 'border-color var(--transition-fast), background var(--transition-fast), opacity var(--transition-fast), box-shadow var(--transition-fast)',
                      position: 'relative',
                      height: 180,
                      boxSizing: 'border-box',
                      overflow: 'hidden',
                      display: 'flex',
                      flexDirection: 'column',
                      boxShadow: isHighlighted ? '0 0 0 3px var(--accent-muted), var(--shadow-lg)' : 'var(--shadow-soft)',
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
                        {isPaid && (
                          <span
                            style={{
                              fontSize: 10,
                              background: 'var(--success)',
                              color: 'var(--text-on-accent)',
                              padding: '2px 7px',
                              borderRadius: 6,
                              fontWeight: 700,
                            }}
                          >
                            HESAP ÖDENDİ
                          </span>
                        )}
                        {!isPaid && hasReady && (
                          <span
                            style={{
                              fontSize: 10,
                              background: 'var(--success)',
                              color: 'var(--text-on-accent)',
                              padding: '2px 7px',
                              borderRadius: 6,
                              fontWeight: 700,
                              animation: 'pulse 2s infinite',
                            }}
                          >
                            HAZIR
                          </span>
                        )}
                        {!isPaid && !hasReady && (
                          <div style={{ width: 8, height: 8, borderRadius: '50%', background: st.color }} />
                        )}
                        {isOccupied && !isReserved && !transferMode && (
                          <button
                            type="button"
                            className="btn btn-ghost btn-icon"
                            style={{ flexShrink: 0 }}
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
                      <div aria-hidden="true" style={{ height: 20, marginBottom: 2 }} />
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
                              <Clock size={10} /> {formatOrderElapsed(table.order_started_at, now)}
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
              const canMarkDelivered = isOut;
              const isBusy = takeawayActionLoading?.orderId === o.id;
              const isPrinting = isBusy && takeawayActionLoading?.action === 'print';
              const isCancelling = isBusy && takeawayActionLoading?.action === 'cancel';
              const isMarkingOut = isBusy && takeawayActionLoading?.action === 'out_for_delivery';
              const isMarkingDelivered = isBusy && takeawayActionLoading?.action === 'delivered';
              return (
                <div
                  key={o.id}
                  className="takeaway-order-card"
                  data-testid={`takeaway-order-card-${o.id}`}
                  style={{
                    borderRadius: 8,
                    border: isOut ? '1px solid var(--info)' : '1px solid var(--border)',
                    background: isOut
                      ? 'linear-gradient(145deg, var(--info-soft), var(--surface-1) 46%, var(--surface-2))'
                      : 'linear-gradient(145deg, var(--accent-soft), var(--surface-1) 44%, var(--success-soft))',
                    overflow: 'hidden',
                    position: 'relative',
                    minHeight: 184,
                    flexShrink: 0,
                    boxShadow: openTakeawayMenuId === o.id ? 'var(--shadow-lg)' : 'var(--shadow-soft)',
                  }}
                >
                  <div
                    aria-hidden="true"
                    style={{
                      position: 'absolute',
                      left: 0,
                      top: 0,
                      bottom: 0,
                      width: 4,
                      background: isOut ? 'var(--info)' : 'var(--warning)',
                      opacity: 0.95,
                    }}
                  />
                  <div
                    ref={openTakeawayMenuId === o.id ? takeawayMenuRef : null}
                    style={{ position: 'absolute', top: 8, right: 8, zIndex: 3 }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      className="btn btn-ghost btn-icon"
                      aria-label="Paket sipariş işlemleri"
                      aria-haspopup="menu"
                      aria-expanded={openTakeawayMenuId === o.id}
                      disabled={isBusy}
                      onClick={(e) => {
                        e.stopPropagation();
                        setOpenTakeawayMenuId((id) => (id === o.id ? null : o.id));
                      }}
                      style={{
                        width: 32,
                        height: 32,
                        minHeight: 32,
                        padding: 0,
                        borderRadius: 8,
                        background: openTakeawayMenuId === o.id ? 'var(--bg-tertiary)' : 'var(--surface-overlay)',
                        border: '1px solid var(--border)',
                        color: 'var(--text-primary)',
                        opacity: isBusy ? 0.55 : 1,
                      }}
                    >
                      <MoreVertical size={17} />
                    </button>
                    {openTakeawayMenuId === o.id && (
                      <div
                        role="menu"
                        aria-label="Paket sipariş işlemleri"
                        style={{
                          position: 'absolute',
                          top: 38,
                          right: 0,
                          width: 148,
                          padding: 6,
                          borderRadius: 8,
                          border: '1px solid var(--border)',
                          background: 'var(--bg-tertiary)',
                          boxShadow: 'var(--shadow-lg)',
                        }}
                      >
                        <button
                          type="button"
                          role="menuitem"
                          disabled={isBusy}
                          onClick={(e) => handleTakeawayPrint(o.id, e)}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '9px 10px',
                            border: 'none',
                            borderRadius: 7,
                            background: 'transparent',
                            color: 'var(--text-primary)',
                            cursor: isBusy ? 'not-allowed' : 'pointer',
                            fontFamily: 'inherit',
                            fontSize: 13,
                            fontWeight: 700,
                            textAlign: 'left',
                          }}
                        >
                          <Printer size={15} color="var(--accent)" />
                          {isPrinting ? 'Yazdırılıyor...' : 'Yazdır'}
                        </button>
                        <button
                          type="button"
                          role="menuitem"
                          disabled={isBusy}
                          onClick={(e) => requestTakeawayCancel(o, e)}
                          style={{
                            width: '100%',
                            display: 'flex',
                            alignItems: 'center',
                            gap: 8,
                            padding: '9px 10px',
                            border: 'none',
                            borderRadius: 7,
                            background: 'transparent',
                            color: 'var(--danger)',
                            cursor: isBusy ? 'not-allowed' : 'pointer',
                            fontFamily: 'inherit',
                            fontSize: 13,
                            fontWeight: 700,
                            textAlign: 'left',
                          }}
                        >
                          <Undo2 size={15} />
                          {isCancelling ? 'İptal ediliyor...' : 'İptal'}
                        </button>
                      </div>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => onOpenTakeawayOrder?.(o.id)}
                    style={{
                      width: '100%',
                      textAlign: 'left',
                      padding: '14px 48px 10px 16px',
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--text-primary)',
                      cursor: 'pointer',
                      fontFamily: 'inherit',
                      paddingRight: 48,
                    }}
                  >
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, minWidth: 0, paddingRight: 4 }}>
                      {o.created_at && (
                        <div style={{ fontSize: 11, color: 'var(--warning)', fontWeight: 800, whiteSpace: 'nowrap' }}>
                          {formatOrderElapsed(o.created_at, now)}
                        </div>
                      )}
                    </div>

                    <div style={{ marginTop: 12, minHeight: 42, paddingRight: 2 }}>
                      <div
                        style={{
                          fontSize: 19,
                          lineHeight: 1.18,
                          fontWeight: 850,
                          color: 'var(--text-primary)',
                          overflow: 'hidden',
                          textOverflow: 'ellipsis',
                          whiteSpace: 'nowrap',
                        }}
                      >
                        {o.customer_name || 'Paket müşteri'}
                      </div>
                    </div>

                    <div
                      style={{
                        marginTop: 14,
                        fontSize: 28,
                        fontWeight: 900,
                        letterSpacing: 0,
                        lineHeight: 1,
                        color: 'var(--text-primary)',
                      }}
                    >
                      {formatCurrency(o.total)}
                    </div>

                    <div style={{ display: 'flex', gap: 8, alignItems: 'center', marginTop: 12, minHeight: 22 }}>
                      <span
                        style={{
                          display: 'inline-flex',
                          alignItems: 'center',
                          gap: 6,
                          borderRadius: 8,
                          padding: '4px 8px',
                          border: `1px solid ${isOut ? 'var(--info)' : 'var(--warning)'}`,
                          background: isOut ? 'var(--info-muted)' : 'var(--warning-muted)',
                          color: isOut ? 'var(--info)' : 'var(--warning)',
                          fontSize: 10,
                          fontWeight: 850,
                          textTransform: 'uppercase',
                        }}
                      >
                        <Clock size={11} />
                        {isOut ? 'Teslimatta' : 'Hazırlanıyor'}
                      </span>
                    </div>
                  </button>
                  <div
                    style={{
                      display: 'flex',
                      gap: 8,
                      padding: '0 12px 12px 16px',
                      flexWrap: 'wrap',
                      position: 'relative',
                      zIndex: 2,
                    }}
                    onClick={(e) => e.stopPropagation()}
                  >
                    <button
                      type="button"
                      disabled={isOut || isBusy}
                      onClick={(e) => handleTakeawayDelivery(o.id, 'out_for_delivery', e)}
                      style={{
                        ...btnBase,
                        background: isOut ? 'var(--bg-tertiary)' : 'var(--warning-muted)',
                        color: isOut ? 'var(--text-muted)' : 'var(--warning)',
                        borderColor: isOut ? 'var(--border)' : 'var(--warning)',
                        cursor: isOut || isBusy ? 'not-allowed' : 'pointer',
                        opacity: isOut || isBusy ? 0.65 : 1,
                      }}
                    >
                      {isMarkingOut ? 'İşleniyor...' : 'Teslimata Çıkarıldı'}
                    </button>
                    <button
                      type="button"
                      disabled={!canMarkDelivered || isBusy}
                      onClick={(e) => handleTakeawayDelivery(o.id, 'delivered', e)}
                      style={{
                        ...btnBase,
                        background: canMarkDelivered ? 'var(--success-muted)' : 'var(--bg-tertiary)',
                        color: canMarkDelivered ? 'var(--success)' : 'var(--text-muted)',
                        borderColor: canMarkDelivered ? 'var(--success)' : 'var(--border)',
                        cursor: canMarkDelivered && !isBusy ? 'pointer' : 'not-allowed',
                        opacity: canMarkDelivered && !isBusy ? 1 : 0.65,
                      }}
                    >
                      {isMarkingDelivered ? 'İşleniyor...' : 'Teslim Edildi'}
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
        .takeaway-order-card {
          transition: transform var(--transition-fast), border-color var(--transition-fast), box-shadow var(--transition-fast);
        }
        .takeaway-order-card:hover {
          transform: translateY(-1px);
          border-color: var(--border-light) !important;
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
                {isTableBillPaid(actionTable) ? (
                  <button
                    type="button"
                    style={{
                      ...actionTileBase,
                      gridColumn: '1 / -1',
                      minHeight: 72,
                      borderColor: 'var(--success)',
                      color: 'var(--success)',
                      background: 'var(--success-muted)',
                    }}
                    onClick={(e) => handleTableMenuAction('close-paid-table', actionTable, e)}
                  >
                    <CheckCircle2 size={26} color="var(--success)" strokeWidth={2} />
                    Masayı Kapat
                  </button>
                ) : onPayment && actionTable.current_order_id ? (
                  <button
                    type="button"
                    style={{
                      ...actionTileBase,
                      gridColumn: '1 / -1',
                      minHeight: 72,
                      borderColor: 'var(--accent)',
                      color: 'var(--accent)',
                      background: 'var(--accent-muted)',
                    }}
                    onClick={(e) => handleTableMenuAction('payment', actionTable, e)}
                  >
                    <CreditCard size={26} color="var(--accent)" strokeWidth={2} />
                    Öde
                  </button>
                ) : null}
                {onQuickPayment && actionTable.current_order_id && (
                  <button
                    type="button"
                    style={actionTileBase}
                    onClick={(e) => handleTableMenuAction('quick-payment', actionTable, e)}
                  >
                    <CreditCard size={26} color="var(--accent)" strokeWidth={2} />
                    Hızlı Öde
                  </button>
                )}
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
                <button
                  type="button"
                  style={actionTileBase}
                  onClick={(e) => handleTableMenuAction('print', actionTable, e)}
                >
                  <Printer size={26} color="var(--accent)" strokeWidth={2} />
                  Yazdır
                </button>
                <button
                  type="button"
                  style={{
                    ...actionTileBase,
                    gridColumn: '1 / -1',
                    minHeight: 68,
                    borderColor: 'var(--danger)',
                    color: 'var(--danger)',
                    background: 'var(--danger-muted)',
                  }}
                  onClick={(e) => handleTableMenuAction('cancel', actionTable, e)}
                >
                  <Undo2 size={26} color="var(--danger)" strokeWidth={2} />
                  İptal
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      <ConfirmDialog
        open={!!tableConfirm}
        title={tableConfirm?.title}
        body={tableConfirm?.body}
        confirmLabel={tableConfirm?.confirmLabel}
        tone={tableConfirm?.tone}
        onCancel={() => setTableConfirm(null)}
        onConfirm={() => {
          const onConfirm = tableConfirm?.onConfirm;
          setTableConfirm(null);
          onConfirm?.();
        }}
      />

      {tableCancelTarget && (
        <div
          className="modal-overlay"
          onClick={() => {
            if (!tableCancelLoading) setTableCancelTarget(null);
          }}
        >
          <div
            className="modal modal-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="table-cancel-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2 id="table-cancel-title" style={{ margin: 0, fontSize: 18 }}>Sipariş iptal edilsin mi?</h2>
                <p style={{ margin: '8px 0 0', color: 'var(--text-secondary)', fontSize: 14, lineHeight: 1.45, fontWeight: 650 }}>
                  Masa boşaltılacak ve bu işlem geri alınamaz.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setTableCancelTarget(null)}
                disabled={tableCancelLoading}
                title="Kapat"
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-body" style={{ paddingTop: 4 }}>
              <div style={{
                padding: '4px 2px 0',
                fontSize: 13,
                color: 'var(--text-secondary)',
              }}>
                <div style={{ color: 'var(--text-primary)', fontSize: 18, fontWeight: 850, lineHeight: 1.2 }}>
                  {tableCancelTarget.label}
                </div>
                <div style={{ marginTop: 8, color: 'var(--text-secondary)', lineHeight: 1.45, fontSize: 14, fontWeight: 650 }}>
                  Aktif sipariş iptal edilecek.
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setTableCancelTarget(null)}
                disabled={tableCancelLoading}
              >
                Vazgeç
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={confirmTableCancel}
                disabled={tableCancelLoading}
              >
                {tableCancelLoading ? 'İptal ediliyor...' : 'Siparişi iptal et'}
              </button>
            </div>
          </div>
        </div>
      )}

      {takeawayConfirmTarget && (
        <div
          className="modal-overlay"
          onClick={() => {
            if (!takeawayActionLoading) setTakeawayConfirmTarget(null);
          }}
        >
          <div
            className="modal modal-sm"
            role="dialog"
            aria-modal="true"
            aria-labelledby="takeaway-cancel-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header">
              <div>
                <h2 id="takeaway-cancel-title" style={{ margin: 0, fontSize: 18 }}>Sipariş iptal edilsin mi?</h2>
                <p style={{ margin: '8px 0 0', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.45 }}>
                  Bu işlem geri alınamaz.
                </p>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setTakeawayConfirmTarget(null)}
                disabled={!!takeawayActionLoading}
                title="Kapat"
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-body" style={{ paddingTop: 4 }}>
              <div style={{
                borderRadius: 8,
                border: '1px solid var(--border)',
                background: 'var(--bg-tertiary)',
                padding: 12,
                fontSize: 13,
                color: 'var(--text-secondary)',
              }}>
                <strong style={{ color: 'var(--text-primary)' }}>
                  #{takeawayConfirmTarget.order_no ?? takeawayConfirmTarget.id.slice(0, 8)}
                </strong>
                {takeawayConfirmTarget.customer_name ? ` · ${takeawayConfirmTarget.customer_name}` : ''}
                <div style={{ marginTop: 6, fontWeight: 700, color: 'var(--text-primary)' }}>
                  {formatCurrency(takeawayConfirmTarget.total)}
                </div>
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setTakeawayConfirmTarget(null)}
                disabled={!!takeawayActionLoading}
              >
                Vazgeç
              </button>
              <button
                type="button"
                className="btn btn-danger"
                onClick={confirmTakeawayCancel}
                disabled={!!takeawayActionLoading}
              >
                {takeawayActionLoading?.action === 'cancel' ? 'İptal ediliyor...' : 'Siparişi iptal et'}
              </button>
            </div>
          </div>
        </div>
      )}

      {printAlertOpen && (
        <div className="modal-overlay" onClick={() => setPrintAlertOpen(false)}>
          <div
            className="modal modal-md"
            role="dialog"
            aria-modal="true"
            aria-labelledby="print-alert-title"
            onClick={(e) => e.stopPropagation()}
          >
            <div className="modal-header" style={{ alignItems: 'flex-start' }}>
              <div style={{ display: 'flex', gap: 12, alignItems: 'flex-start' }}>
                <div style={{
                  width: 40, height: 40, borderRadius: 10,
                  background: 'var(--danger-muted)', color: 'var(--danger)',
                  display: 'flex', alignItems: 'center', justifyContent: 'center',
                  flexShrink: 0,
                }}>
                  <AlertTriangle size={22} />
                </div>
                <div>
                  <h2 id="print-alert-title" style={{ margin: 0, fontSize: 18 }}>Yazdırma sorunu var</h2>
                  <p style={{ margin: '6px 0 0', color: 'var(--text-muted)', fontSize: 13, lineHeight: 1.45 }}>
                    Kuyrukta bekleyen ya da başarısız olan yazdırma işleri tespit edildi.
                  </p>
                </div>
              </div>
              <button
                type="button"
                className="btn btn-ghost btn-icon"
                onClick={() => setPrintAlertOpen(false)}
                title="Kapat"
              >
                <X size={16} />
              </button>
            </div>
            <div className="modal-body">
              <div style={{
                display: 'flex', flexWrap: 'wrap', gap: 8,
                marginBottom: 14,
              }}>
                {failedPrintCount > 0 && (
                  <span className="badge badge-danger" style={{ fontSize: 12 }}>
                    {failedPrintCount} başarısız iş
                  </span>
                )}
                {stalePrintCount > 0 && (
                  <span className="badge badge-warning" style={{ fontSize: 12 }}>
                    {stalePrintCount} süresi geçmiş iş
                  </span>
                )}
                {pendingPrintCount > 0 && (
                  <span className="badge" style={{ fontSize: 12 }}>
                    {pendingPrintCount} bekleyen
                  </span>
                )}
              </div>

              {firstFailedPrintJob && (() => {
                const { label, action } = getPrintErrorMessage(firstFailedPrintJob.last_error_code);
                return (
                  <div style={{
                    border: '1px solid var(--border)',
                    borderRadius: 'var(--radius-md)',
                    padding: 14,
                    background: 'var(--bg-tertiary)',
                    marginBottom: 12,
                  }}>
                    <div style={{ fontSize: 11, color: 'var(--text-muted)', fontWeight: 700, textTransform: 'uppercase', letterSpacing: '0.04em', marginBottom: 6 }}>
                      Son başarısız iş
                    </div>
                    <div style={{ fontSize: 15, fontWeight: 800, color: 'var(--text-primary)', marginBottom: 4 }}>
                      {firstFailedPrintJob.printer_name || 'Yazıcı'}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--danger)', fontWeight: 700, marginBottom: 6 }}>
                      {label}
                    </div>
                    <div style={{ fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.5 }}>
                      {action}
                    </div>
                    {firstFailedPrintJob.last_error_code && (
                      <div style={{ marginTop: 8, fontSize: 11, color: 'var(--text-muted)' }}>
                        Hata kodu: <code>{firstFailedPrintJob.last_error_code}</code>
                      </div>
                    )}
                  </div>
                );
              })()}

              <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.5 }}>
                Daha fazla teşhis için Ayarlar → StoreBridge Durumu sayfasını açabilir veya Destek Paketini indirebilirsiniz.
              </div>
            </div>
            <div className="modal-footer">
              <button
                type="button"
                className="btn btn-ghost"
                onClick={() => setPrintAlertOpen(false)}
              >
                Kapat
              </button>
              {firstFailedPrintJob && (
                <button
                  type="button"
                  className="btn btn-warning"
                  disabled={!!retryingPrintJobId}
                  onClick={async () => {
                    await retryFirstFailedPrintJob({ silent: true });
                  }}
                >
                  {retryingPrintJobId ? 'Deneniyor...' : 'Tekrar Dene'}
                </button>
              )}
            </div>
          </div>
        </div>
      )}

      <ManualPrintSelectorModal
        open={!!manualPrintDialog.open}
        onClose={() => setManualPrintDialog({ open: false, orderId: null, role: 'receipt', kind: 'receipt', title: '' })}
        printRole={manualPrintDialog.role || 'receipt'}
        title={manualPrintDialog.title || 'Yazdır'}
        description="Hangi yazıcıdan yazdırmak istiyorsunuz?"
        onConfirm={async (printerId) => {
          const orderId = manualPrintDialog.orderId;
          if (!orderId) return;
          if (manualPrintDialog.kind === 'takeaway') {
            setTakeawayActionLoading({ orderId, action: 'print' });
            try {
              await api.printTakeawayLabel(orderId, { printer_id: printerId });
              toast.success('Yazdırma isteği gönderildi');
            } catch (err) {
              toast.error(err.message || 'Yazdırma isteği gönderilemedi');
            } finally {
              setTakeawayActionLoading(null);
            }
            return;
          }
          try {
            await api.printOrderReceipt(orderId, { printer_id: printerId });
            toast.success('Yazdırma isteği gönderildi');
            setOpenMenuTableId(null);
          } catch (err) {
            toast.error(err.message || 'Yazdırma isteği gönderilemedi');
          }
        }}
      />

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
                      const orderOpened = Boolean(call.order_id || call.order_no || call.status === 'opened_order');
                      return (
                        <tr key={call.id}>
                          <td>{index + 1}</td>
                          <td>{call.phone || '-'}</td>
                          <td>{call.customer_name_snapshot || call.customer_name || 'Yeni Müşteri'}</td>
                          <td>{formatCallDateTime(call.created_at)}</td>
                          <td>{getCallStatusLabel(call.status)}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: 8, flexWrap: 'wrap' }}>
                              <span className={`badge ${orderOpened ? 'badge-success' : 'badge-warning'}`}>
                                {orderOpened
                                  ? `Sipariş Alındı${call.order_no ? ` (#${call.order_no})` : ''}`
                                  : 'Sipariş Alınmadı'}
                              </span>
                              {!orderOpened && openIncomingCallOrder && (
                                <button
                                  type="button"
                                  className="btn btn-primary btn-sm"
                                  onClick={() => openIncomingCallOrder(call)}
                                >
                                  Sipariş Al
                                </button>
                              )}
                            </div>
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
