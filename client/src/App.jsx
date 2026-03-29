import { useState, useCallback, useEffect } from 'react';
import { Routes, Route, Navigate, useNavigate, useLocation } from 'react-router-dom';
import { useAuth } from './context/AuthContext.jsx';
import Sidebar from './components/layout/Sidebar.jsx';
import LoginScreen from './components/auth/LoginScreen.jsx';
import TablesScreen from './components/tables/TablesScreen.jsx';
import OrderScreen from './components/orders/OrderScreen.jsx';
import PaymentScreen from './components/payments/PaymentScreen.jsx';
import KitchenScreen from './components/kitchen/KitchenScreen.jsx';
import TakeawayScreen from './components/takeaway/TakeawayScreen.jsx';
import CallerIdScreen from './components/callerid/CallerIdScreen.jsx';
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
import DiningAreasSettingsPage from './components/settings/DiningAreasSettingsPage.jsx';

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
  const [paymentOrder, setPaymentOrder] = useState(null);
  const navigate = useNavigate();

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
    setPaymentOrder(order);
  }, []);

  const handlePaymentComplete = useCallback(() => {
    setPaymentOrder(null);
    navigate(-1);
  }, [navigate]);

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
      <Sidebar />
      <main className="app-content">
        <Routes>
          <Route path="/" element={<Navigate to={user.role === 'kitchen' ? '/kitchen' : '/tables'} replace />} />
          <Route path="/tables" element={
            <ProtectedRoute requiredRoles={['admin', 'cashier', 'waiter']}>
              <TablesScreen
                onOpenOrder={handleOpenOrder}
                showTakeawaySidebar={hasRole('admin', 'cashier')}
                onOpenTakeawayOrder={handleOpenTakeawayFromTables}
              />
            </ProtectedRoute>
          } />
          <Route path="/takeaway" element={<ProtectedRoute requiredRoles={['admin', 'cashier']}><TakeawayScreen onNewOrder={handleNewTakeawayOrder} /></ProtectedRoute>} />
          <Route path="/callerid" element={<ProtectedRoute requiredRoles={['admin', 'cashier']}><CallerIdScreen /></ProtectedRoute>} />
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
            <Route path="menu" element={<MenuSettingsPage />} />
            <Route path="dining-areas" element={<DiningAreasSettingsPage />} />
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
          onClose={() => setPaymentOrder(null)}
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

  return (
    <OrderScreen
      table={state.table}
      existingOrderId={state.existingOrderId}
      orderType={state.orderType || 'dine_in'}
      customer={state.customer}
      prefillPhone={state.prefillPhone}
      callLogId={state.callLogId}
      onBack={() => navigate(-1)}
      onPayment={onPayment}
      onNavigateToTables={() => navigate('/tables')}
    />
  );
}
