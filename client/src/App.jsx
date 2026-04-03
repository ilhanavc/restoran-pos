import { useState, useCallback, useEffect, useRef } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Sidebar from './components/layout/Sidebar.jsx';
import HomeScreen from './components/home/HomeScreen.jsx';
import LoginScreen from './components/auth/LoginScreen.jsx';
import TablesScreen from './components/tables/TablesScreen.jsx';
import OrderScreen from './components/orders/OrderScreen.jsx';
import PaymentScreen from './components/payments/PaymentScreen.jsx';
import KitchenScreen from './components/kitchen/KitchenScreen.jsx';
import TakeawayScreen from './components/takeaway/TakeawayScreen.jsx';
import CustomersScreen from './components/customers/CustomersScreen.jsx';
import ReportsScreen from './components/reports/ReportsScreen.jsx';
import api from './services/api.js';
import { applyDisplaySettings } from './utils/displayTheme.js';
import SettingsLayout from './components/settings/SettingsLayout.jsx';
import SettingsHome from './components/settings/SettingsHome.jsx';
import BusinessSettingsPage from './components/settings/BusinessSettingsPage.jsx';
import UsersSettingsPage from './components/settings/UsersSettingsPage.jsx';
import PrinterSettingsRoutes from './components/settings/PrinterSettingsRoutes.jsx';
import PrinterListPage from './components/settings/PrinterListPage.jsx';
import PrinterDetailPage from './components/settings/PrinterDetailPage.jsx';
import PrinterRoutingPage from './components/settings/PrinterRoutingPage.jsx';
import DisplaySettingsPage from './components/settings/DisplaySettingsPage.jsx';
import MenuSettingsPage from './components/settings/MenuSettingsPage.jsx';
import MenuProductEditorPage from './components/settings/MenuProductEditorPage.jsx';
import DiningAreasSettingsPage from './components/settings/DiningAreasSettingsPage.jsx';
import CallerIdScreen from './components/callerid/CallerIdScreen.jsx';

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
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [paymentOrder, setPaymentOrder] = useState(null);
  const paymentAfterCompleteRef = useRef('back');
  const navigate = useNavigate();
  const location = useLocation();
  const isTablesPage = location.pathname.startsWith('/tables');
  const isOrderScreen = location.pathname.startsWith('/order/');
  const canSeeTakeawayQuickButton = hasRole('admin', 'cashier');
  const defaultPath = hasRole('admin', 'cashier')
    ? '/home'
    : user?.role === 'kitchen'
      ? '/kitchen'
      : '/tables';

  useEffect(() => {
    if (!user || user.role !== 'admin') return;
    api.getDisplaySettings().then((d) => applyDisplaySettings(d.display)).catch(() => {});
  }, [user]);

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
    setPaymentOrder(order);
  }, []);

  const handlePaymentFromTables = useCallback((order) => {
    paymentAfterCompleteRef.current = 'tables';
    setPaymentOrder(order);
  }, []);

  const handlePaymentComplete = useCallback(() => {
    setPaymentOrder(null);
    if (paymentAfterCompleteRef.current === 'tables') {
      paymentAfterCompleteRef.current = 'back';
      navigate('/tables', { replace: true, state: { refreshTables: Date.now() } });
    } else {
      navigate(-1);
    }
  }, [navigate]);

  const handlePaymentClose = useCallback(() => {
    setPaymentOrder(null);
    paymentAfterCompleteRef.current = 'back';
  }, []);

  if (loading) {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100vh', background: 'var(--bg-primary)' }}>
        <div style={{ textAlign: 'center' }}>
          <div style={{
            width: 48, height: 48, borderRadius: 'var(--radius-md)',
            background: 'linear-gradient(135deg, var(--accent), #8b5cf6)',
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

  return (
    <div className="app-layout">
      {!isOrderScreen && (
        <Sidebar
          isOpen={sidebarOpen}
          onToggle={() => setSidebarOpen((prev) => !prev)}
          onNavigate={() => setSidebarOpen(false)}
          showTakeawayQuickButton={isTablesPage && canSeeTakeawayQuickButton}
          onTakeawayQuickClick={() => navigate('/takeaway')}
        />
      )}
      <main className={`app-content ${isOrderScreen ? 'no-sidebar' : ''}`}>
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
                showTakeawaySidebar={hasRole('admin', 'cashier')}
                onOpenTakeawayOrder={handleOpenTakeawayFromTables}
              />
            </ProtectedRoute>
          } />
          <Route path="/takeaway" element={<ProtectedRoute requiredRoles={['admin', 'cashier']}><TakeawayScreen onNewOrder={handleNewTakeawayOrder} /></ProtectedRoute>} />
          <Route path="/kitchen" element={<ProtectedRoute requiredRoles={['admin', 'kitchen']}><KitchenScreen /></ProtectedRoute>} />
          <Route path="/customers" element={<ProtectedRoute requiredRoles={['admin', 'cashier']}><CustomersScreen /></ProtectedRoute>} />
          <Route path="/reports" element={<ProtectedRoute requiredRoles={['admin', 'cashier']}><ReportsScreen /></ProtectedRoute>} />
          <Route path="/settings" element={<ProtectedRoute requiredRoles={['admin']}><SettingsLayout /></ProtectedRoute>}>
            <Route index element={<SettingsHome />} />
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
            <Route path="caller-id" element={<CallerIdScreen />} />
          </Route>
          
          <Route path="/order/table/:id" element={
            <ProtectedRoute requiredRoles={['admin', 'cashier', 'waiter']}>
              <OrderScreenWrapper onPayment={handlePayment} />
            </ProtectedRoute>
          } />
          <Route path="/order/takeaway" element={
            <ProtectedRoute requiredRoles={['admin', 'cashier']}>
              <OrderScreenWrapper onPayment={handlePayment} />
            </ProtectedRoute>
          } />
          
          <Route path="*" element={<Navigate to="/" replace />} />
        </Routes>
      </main>

      {paymentOrder && (
        <PaymentScreen
          order={paymentOrder}
          onClose={handlePaymentClose}
          onComplete={handlePaymentComplete}
        />
      )}
    </div>
  );
}

function OrderScreenWrapper({ onPayment }) {
  const location = useLocation();
  const navigate = useNavigate();
  const state = location.state || {};
  const orderType = state.orderType || 'dine_in';

  const goToTables = useCallback(() => {
    navigate('/tables', { state: { refreshTables: Date.now() } });
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
      onNavigateToTables={goToTables}
    />
  );
}
