import { Suspense, lazy, useState, useCallback, useEffect, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import { useToast } from './context/ToastContext.jsx';
import { Menu, X, ArrowLeft } from 'lucide-react';
import Sidebar from './components/layout/Sidebar.jsx';
import LoginScreen from './components/auth/LoginScreen.jsx';
import api from './services/api.js';
import { applyDisplaySettings } from './utils/displayTheme.js';
import UpdateNotification from './components/layout/UpdateNotification.jsx';

const HomeScreen = lazy(() => import('./components/home/HomeScreen.jsx'));
const TablesScreen = lazy(() => import('./components/tables/TablesScreen.jsx'));
const OrderScreen = lazy(() => import('./components/orders/OrderScreen.jsx'));
const PaymentScreen = lazy(() => import('./components/payments/PaymentScreen.jsx'));
const QuickPaymentModal = lazy(() => import('./components/payments/QuickPaymentModal.jsx'));
const KitchenScreen = lazy(() => import('./components/kitchen/KitchenScreen.jsx'));
const CustomersScreen = lazy(() => import('./components/customers/CustomersScreen.jsx'));
const ReportsScreen = lazy(() => import('./components/reports/ReportsScreen.jsx'));
const SettingsLayout = lazy(() => import('./components/settings/SettingsLayout.jsx'));
const SettingsHome = lazy(() => import('./components/settings/SettingsHome.jsx'));
const SetupReadinessPage = lazy(() => import('./components/settings/SetupReadinessPage.jsx'));
const MaintenancePage = lazy(() => import('./components/settings/MaintenancePage.jsx'));
const StoreBridgePage = lazy(() => import('./components/settings/StoreBridgePage.jsx'));
const BusinessSettingsPage = lazy(() => import('./components/settings/BusinessSettingsPage.jsx'));
const UsersSettingsPage = lazy(() => import('./components/settings/UsersSettingsPage.jsx'));
const PrinterSettingsRoutes = lazy(() => import('./components/settings/PrinterSettingsRoutes.jsx'));
const PrinterListPage = lazy(() => import('./components/settings/PrinterListPage.jsx'));
const PrinterDetailPage = lazy(() => import('./components/settings/PrinterDetailPage.jsx'));
const PrinterRoutingPage = lazy(() => import('./components/settings/PrinterRoutingPage.jsx'));
const DisplaySettingsPage = lazy(() => import('./components/settings/DisplaySettingsPage.jsx'));
const MenuSettingsPage = lazy(() => import('./components/settings/MenuSettingsPage.jsx'));
const MenuProductEditorPage = lazy(() => import('./components/settings/MenuProductEditorPage.jsx'));
const DiningAreasSettingsPage = lazy(() => import('./components/settings/DiningAreasSettingsPage.jsx'));
const AttributeGroupsPage = lazy(() => import('./components/settings/AttributeGroupsPage.jsx'));
const CallerIdScreen = lazy(() => import('./components/callerid/CallerIdScreen.jsx'));
const ReservationsScreen = lazy(() => import('./components/reservations/ReservationsScreen.jsx'));
const StockScreen = lazy(() => import('./components/stock/StockScreen.jsx'));
const SetupWizardPage = lazy(() => import('./components/settings/SetupWizardPage.jsx'));
const ReleaseNotesPage = lazy(() => import('./components/settings/ReleaseNotesPage.jsx'));
const AuditLogPage = lazy(() => import('./components/settings/AuditLogPage.jsx'));
const DevicesPage = lazy(() => import('./components/settings/DevicesPage.jsx'));

function getShellTitle(pathname) {
  if (pathname === '/home') return 'Anasayfa';
  if (pathname === '/kitchen') return 'Mutfak Ekranı';
  if (pathname === '/customers') return 'Müşteriler';
  if (pathname === '/reservations') return 'Rezervasyonlar';
  if (pathname === '/stock') return 'Stok Takibi';
  if (pathname === '/reports') return 'Raporlar';
  if (pathname === '/settings') return 'Ayarlar';
  if (pathname === '/settings/readiness') return 'Kurulum Kontrolü';
  if (pathname === '/settings/maintenance') return 'Bakım ve Yedekleme';
  if (pathname === '/settings/bridge') return 'StoreBridge Durumu';
  if (pathname === '/settings/business') return 'İşletme Bilgileri';
  if (pathname === '/settings/users') return 'Kullanıcı Yönetimi';
  if (pathname === '/settings/printers') return 'Yazıcılar';
  if (pathname === '/settings/printers/routing') return 'Yazıcı Yönlendirme';
  if (pathname === '/settings/printers/new') return 'Yeni Yazıcı';
  if (pathname.startsWith('/settings/printers/')) return 'Yazıcı Detayı';
  if (pathname === '/settings/display') return 'Ekran Ayarları';
  if (pathname === '/settings/menu') return 'Menü tanımları';
  if (pathname === '/settings/menu/product/new') return 'Yeni ürün';
  if (pathname.startsWith('/settings/menu/product/')) return 'Ürün detayı';
  if (pathname === '/settings/dining-areas') return 'Salon Bölgeleri';
  if (pathname === '/settings/features') return 'Özellikler';
  if (pathname === '/settings/caller-id') return 'Gelen Aramalar';
  if (pathname === '/settings/release-notes') return 'Sürüm Notları';
  if (pathname === '/settings/audit-log') return 'Denetim Günlüğü';
  if (pathname === '/settings/devices') return 'Mobil Cihazlar';
  return null;
}

function ProtectedRoute({ children, requiredRoles }) {
  const { user, loading, hasRole } = useAuth();
  if (loading) return null;
  if (!user) return <Navigate to="/login" replace />;
  
  if (requiredRoles) {
    const hasAccess = requiredRoles.some(r => hasRole(r));
    if (!hasAccess) return <Navigate to="/" replace />;
  }
  
  return children;
}

export default function App() {
  const { user, loading, hasRole } = useAuth();
  const toast = useToast();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [setupCompleted, setSetupCompleted] = useState(null); // null=loading, true=done, false=wizard
  const [paymentOrder, setPaymentOrder] = useState(null);
  const [quickPaymentOrder, setQuickPaymentOrder] = useState(null);
  const paymentAfterCompleteRef = useRef('back');
  const navigate = useNavigate();
  const location = useLocation();
  const isOrderScreen = location.pathname.startsWith('/order/');
  const shellTitle = !isOrderScreen ? getShellTitle(location.pathname) : null;
  const isSettingsSubpage = location.pathname.startsWith('/settings/') && location.pathname !== '/settings';
  const canSeeTakeawayQuickButton = hasRole('admin', 'cashier');
  const defaultPath = hasRole('admin', 'cashier')
    ? '/home'
    : user?.role === 'kitchen'
      ? '/kitchen'
      : '/tables';

  useEffect(() => {
    if (!user) return;
    if (user.display) {
      applyDisplaySettings(user.display);
      return;
    }
    api.me().then((d) => d.display && applyDisplaySettings(d.display)).catch(() => {});
  }, [user]);

  // İlk kurulum wizard kontrolü — yalnızca Electron + admin rolü
  useEffect(() => {
    if (!user || user.role !== 'admin') { setSetupCompleted(true); return; }
    if (!window.electronAPI?.setupIsCompleted) { setSetupCompleted(true); return; }
    window.electronAPI.setupIsCompleted()
      .then((done) => setSetupCompleted(done))
      .catch(() => setSetupCompleted(true));
  }, [user]);

  useEffect(() => {
    if (!user || user.role !== 'admin') return;
    if (location.pathname.startsWith('/settings')) return;
    let cancelled = false;
    api.getDesktopReadiness()
      .then((readiness) => {
        if (cancelled) return;
        if (!readiness.completed || !readiness.ready) {
          navigate('/settings/readiness', { replace: true });
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [location.pathname, navigate, user]);

  // Electron IPC: show toast if automatic backup failed
  useEffect(() => {
    if (!window.electronAPI?.onBackupFailed) return;
    const remove = window.electronAPI.onBackupFailed(() => {
      toast.warning('Otomatik yedekleme başarısız oldu. Bakım ve Yedekleme sayfasında manuel yedek alın.');
    });
    return remove;
  }, [toast]);

  const handleOpenOrder = useCallback((table) => {
    navigate(`/order/table/${table.id}`, { state: { table, existingOrderId: table.current_order_id, orderType: 'dine_in' } });
  }, [navigate]);

  const handleNewTakeawayOrder = useCallback((ctx) => {
    navigate(`/order/takeaway`, {
      state: {
        orderType: 'takeaway',
        customer: ctx?.customer,
        existingOrderId: ctx?.existingOrderId,
        prefillPhone: ctx?.prefillPhone,
        callLogId: ctx?.callLogId,
      },
    });
  }, [navigate]);

  const handleOpenTakeawayFromTables = useCallback((orderId) => {
    navigate(`/order/takeaway`, { state: { orderType: 'takeaway', existingOrderId: orderId } });
  }, [navigate]);

  const handlePayment = useCallback((order) => {
    paymentAfterCompleteRef.current = 'back';
    setQuickPaymentOrder(null);
    setPaymentOrder(order);
  }, []);

  const handlePaymentFromTables = useCallback((order) => {
    paymentAfterCompleteRef.current = 'tables';
    setQuickPaymentOrder(null);
    setPaymentOrder(order);
  }, []);

  const handleQuickPayment = useCallback((order) => {
    paymentAfterCompleteRef.current = 'back';
    setPaymentOrder(null);
    setQuickPaymentOrder(order);
  }, []);

  const handleQuickPaymentFromTables = useCallback((order) => {
    paymentAfterCompleteRef.current = 'tables';
    setPaymentOrder(null);
    setQuickPaymentOrder(order);
  }, []);

  const handlePaymentComplete = useCallback(() => {
    setPaymentOrder(null);
    setQuickPaymentOrder(null);
    if (paymentAfterCompleteRef.current === 'tables') {
      paymentAfterCompleteRef.current = 'back';
      navigate('/tables', { replace: true, state: { refreshTables: Date.now() } });
    } else {
      navigate(-1);
    }
  }, [navigate]);

  const handlePaymentClose = useCallback(() => {
    setPaymentOrder(null);
    setQuickPaymentOrder(null);
    paymentAfterCompleteRef.current = 'back';
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-primary)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 48, height: 48, borderRadius: 'var(--radius-md)',
            background: 'linear-gradient(135deg, var(--accent), var(--accent-gradient-end))',
            display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 22, fontWeight: 800, color: 'white', marginBottom: 12,
          }}>P</div>
          <div style={{ color: 'var(--text-muted)', fontSize: 13 }}>Yükleniyor...</div>
        </div>
      </div>
    );
  }

  if (!user) {
    return (
      <Routes>
        <Route path="*" element={<LoginScreen />} />
      </Routes>
    );
  }

  if (setupCompleted === false) {
    return (
      <Suspense fallback={null}>
        <SetupWizardPage onComplete={() => setSetupCompleted(true)} />
      </Suspense>
    );
  }

  return (
    <div className="app-layout">
      {!isOrderScreen && (
        <>
          <button
            type="button"
            className="sidebar-menu-btn"
            onClick={() => setSidebarOpen((prev) => !prev)}
            aria-label={sidebarOpen ? "Menüyü kapat" : "Menüyü aç"}
            title={sidebarOpen ? "Menüyü kapat" : "Menüyü aç"}
          >
            {sidebarOpen ? <X size={18} /> : <Menu size={18} />}
          </button>
          {shellTitle ? (
            <div className="shell-inline-title" aria-hidden={sidebarOpen}>
              {shellTitle}
            </div>
          ) : null}
          {isSettingsSubpage ? (
            <button
              type="button"
              className="shell-back-btn"
              onClick={() => navigate('/settings')}
              aria-label="Ayarlara geri dön"
              title="Ayarlara geri dön"
            >
              <ArrowLeft size={16} />
              <span>Geri</span>
            </button>
          ) : null}
          {sidebarOpen && (
            <div className="sidebar-backdrop" onClick={() => setSidebarOpen(false)} />
          )}
          <Sidebar
            isOpen={sidebarOpen}
            onNavigate={() => setSidebarOpen(false)}
          />
        </>
      )}
      <main className={`app-content ${!isOrderScreen ? 'app-content--with-shell-toggle' : ''} ${shellTitle ? 'app-content--with-shell-title' : ''}`}>
        <Suspense fallback={<AppRouteFallback />}>
        <Routes>
          <Route path="/" element={<Navigate to={defaultPath} replace />} />
          <Route path="/home" element={
            <ProtectedRoute requiredRoles={['admin', 'cashier']}>
              <HomeScreen />
            </ProtectedRoute>
          } />
          <Route path="/tables" element={
            <ProtectedRoute requiredRoles={['admin', 'cashier', 'waiter']}>
              <TablesScreen
                onOpenOrder={handleOpenOrder}
                onPayment={handlePaymentFromTables}
                onQuickPayment={handleQuickPaymentFromTables}
                showTakeawaySidebar={hasRole('admin', 'cashier')}
                onOpenTakeawayOrder={handleOpenTakeawayFromTables}
                onNewTakeawayOrder={canSeeTakeawayQuickButton ? handleNewTakeawayOrder : undefined}
              />
            </ProtectedRoute>
          } />
          <Route path="/kitchen" element={<ProtectedRoute requiredRoles={['admin', 'kitchen']}><KitchenScreen /></ProtectedRoute>} />
          <Route path="/customers" element={<ProtectedRoute requiredRoles={['admin', 'cashier']}><CustomersScreen /></ProtectedRoute>} />
          <Route path="/reservations" element={<ProtectedRoute requiredRoles={['admin', 'cashier']}><ReservationsScreen /></ProtectedRoute>} />
          <Route path="/stock" element={<ProtectedRoute requiredRoles={['admin', 'cashier']}><StockScreen /></ProtectedRoute>} />
          <Route path="/reports" element={<ProtectedRoute requiredRoles={['admin', 'cashier']}><ReportsScreen /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute requiredRoles={['admin']}><SettingsLayout /></ProtectedRoute>}>
            <Route index element={<SettingsHome />} />
            <Route path="readiness" element={<SetupReadinessPage />} />
            <Route path="maintenance" element={<MaintenancePage />} />
            <Route path="bridge" element={<StoreBridgePage />} />
            <Route path="business" element={<BusinessSettingsPage />} />
            <Route path="users" element={<UsersSettingsPage />} />
            <Route path="printers" element={<PrinterSettingsRoutes />}>
              <Route index element={<PrinterListPage />} />
              <Route path="routing" element={<PrinterRoutingPage />} />
              <Route path="new" element={<PrinterDetailPage />} />
              <Route path=":id" element={<PrinterDetailPage />} />
            </Route>
            <Route path="display" element={<DisplaySettingsPage />} />
            <Route path="menu/product/:productId" element={<MenuProductEditorPage />} />
            <Route path="menu" element={<MenuSettingsPage />} />
            <Route path="dining-areas" element={<DiningAreasSettingsPage />} />
            <Route path="features" element={<AttributeGroupsPage />} />
            <Route path="caller-id" element={<CallerIdScreen />} />
            <Route path="release-notes" element={<ReleaseNotesPage />} />
            <Route path="audit-log" element={<AuditLogPage />} />
            <Route path="devices" element={<DevicesPage />} />
          </Route>
          
          <Route path="/order/table/:id" element={
            <ProtectedRoute requiredRoles={['admin', 'cashier', 'waiter']}>
              <OrderScreenWrapper onPayment={handlePayment} onQuickPayment={handleQuickPayment} />
            </ProtectedRoute>
          } />
          <Route path="/order/takeaway" element={
            <ProtectedRoute requiredRoles={['admin', 'cashier']}>
              <OrderScreenWrapper onPayment={handlePayment} onQuickPayment={handleQuickPayment} />
            </ProtectedRoute>
          } />
          
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
        </Suspense>
      </main>

      {paymentOrder && (
        <Suspense fallback={null}>
        <PaymentScreen
          order={paymentOrder}
          onClose={handlePaymentClose}
          onComplete={handlePaymentComplete}
        />
        </Suspense>
      )}

      {quickPaymentOrder && (
        <Suspense fallback={null}>
        <QuickPaymentModal
          order={quickPaymentOrder}
          onClose={handlePaymentClose}
          onComplete={handlePaymentComplete}
        />
        </Suspense>
      )}

      <UpdateNotification />
    </div>
  );
}

function AppRouteFallback() {
  return (
    <div style={{ padding: 24, color: 'var(--text-muted)', fontSize: 13 }}>
      Yükleniyor...
    </div>
  );
}

function OrderScreenWrapper({ onPayment, onQuickPayment }) {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state || {};
  const orderType = state.orderType || 'dine_in';

  const goToTables = useCallback((options = {}) => {
    navigate('/tables', {
      state: {
        refreshTables: Date.now(),
        highlightTableId: options.highlightTableId || null,
      },
    });
  }, [navigate]);

  return (
    <OrderScreen
      table={state.table}
      existingOrderId={state.existingOrderId}
      orderType={orderType}
      customer={state.customer}
      prefillPhone={state.prefillPhone}
      callLogId={state.callLogId}
      onBack={() => (orderType === 'dine_in' ? goToTables() : navigate(-1))}
      onPayment={onPayment}
      onQuickPayment={onQuickPayment}
      onNavigateToTables={goToTables}
    />
  );
}
