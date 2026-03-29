import { useAuth } from '../../context/AuthContext.jsx';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  LayoutGrid, ClipboardList, Package, Users, ChefHat,
  BarChart3, Settings, LogOut, Phone
} from 'lucide-react';

const NAV_ITEMS = [
  { id: 'tables', path: '/tables', label: 'Masalar', icon: LayoutGrid, roles: ['admin', 'cashier', 'waiter'] },
  { id: 'takeaway', path: '/takeaway', label: 'Paket', icon: Package, roles: ['admin', 'cashier'] },
  { id: 'callerid', path: '/callerid', label: 'Aramalar', icon: Phone, roles: ['admin', 'cashier'] },
  { id: 'kitchen', path: '/kitchen', label: 'Mutfak', icon: ChefHat, roles: ['admin', 'kitchen'] },
  { id: 'customers', path: '/customers', label: 'Müşteriler', icon: Users, roles: ['admin', 'cashier'] },
  { id: 'reports', path: '/reports', label: 'Raporlar', icon: BarChart3, roles: ['admin', 'cashier'] },
  { id: 'settings', path: '/settings', label: 'Ayarlar', icon: Settings, roles: ['admin'] },
];

export default function Sidebar() {
  const { user, logout, hasRole } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();

  return (
    <nav className="sidebar">
      <div className="sidebar-logo">P</div>

      <div className="sidebar-nav">
        {NAV_ITEMS.filter(item => hasRole(...item.roles)).map(item => {
          const Icon = item.icon;
          const isActive = location.pathname.startsWith(item.path);
          return (
            <button
              key={item.id}
              className={`sidebar-item ${isActive ? 'active' : ''}`}
              onClick={() => navigate(item.path)}
              title={item.label}
            >
              <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
              <span className="sidebar-item-label">{item.label}</span>
            </button>
          );
        })}
      </div>

      <div className="sidebar-bottom">
        <div style={{
          textAlign: 'center', marginBottom: 8,
          padding: '8px 4px',
          borderRadius: 'var(--radius-sm)',
          background: 'var(--bg-tertiary)',
        }}>
          <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>
            {user?.fullName?.split(' ')[0]}
          </div>
          <div style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>
            {user?.roleName}
          </div>
        </div>
        <button className="sidebar-item" onClick={logout} title="Çıkış">
          <LogOut size={18} />
          <span className="sidebar-item-label">Çıkış</span>
        </button>
      </div>
    </nav>
  );
}
