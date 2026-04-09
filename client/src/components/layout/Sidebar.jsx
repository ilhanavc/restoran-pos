import { useAuth } from '../../context/AuthContext.jsx';
import { useLocation, useNavigate } from 'react-router-dom';
import {
  Home, LayoutGrid, Users, ChefHat, Package,
  BarChart3, Settings, LogOut, PanelLeftClose, PanelLeftOpen,
  FolderTree, ChevronDown, ChevronRight, CalendarDays, Boxes
} from 'lucide-react';
import { useEffect, useMemo, useState, useCallback } from 'react';
import api from '../../services/api.js';

const BRIDGE_POLL_MS = 30000;

function useBridgeStatus() {
  const [status, setStatus] = useState(null); // null=bilinmiyor, 'ok', 'down', 'unconfigured'
  const { user } = useAuth();

  const check = useCallback(async () => {
    if (!user) return;
    const s = await api.getBridgeStatus();
    setStatus(s);
  }, [user]);

  useEffect(() => {
    check();
    const t = setInterval(check, BRIDGE_POLL_MS);
    return () => clearInterval(t);
  }, [check]);

  return status;
}

const BRIDGE_DOT = {
  ok:            { color: '#22c55e', title: 'Store Bridge bağlı' },
  down:          { color: '#ef4444', title: 'Store Bridge erişilemiyor' },
  unconfigured:  { color: '#f59e0b', title: 'Store Bridge yapılandırılmamış' },
};

const NAV_ITEMS = [
  { id: 'home', path: '/home', label: 'Anasayfa', icon: Home, roles: ['admin', 'cashier'] },
  { id: 'tables', path: '/tables', label: 'Masalar', icon: LayoutGrid, roles: ['admin', 'cashier', 'waiter'] },
  { id: 'kitchen', path: '/kitchen', label: 'Mutfak', icon: ChefHat, roles: ['admin', 'kitchen'] },
  { id: 'customers', path: '/customers', label: 'Müşteriler', icon: Users, roles: ['admin', 'cashier'] },
  { id: 'reservations', path: '/reservations', label: 'Rezervasyonlar', icon: CalendarDays, roles: ['admin', 'cashier'] },
  { id: 'stock', path: '/stock', label: 'Stok', icon: Boxes, roles: ['admin', 'cashier'] },
  { id: 'reports', path: '/reports', label: 'Raporlar', icon: BarChart3, roles: ['admin', 'cashier'] },
  { id: 'settings', path: '/settings', label: 'Ayarlar', icon: Settings, roles: ['admin'] },
];

const DEFINITIONS_ITEMS = [
  { id: 'menu-definitions', path: '/settings/menu', label: 'Menü Tanımları', roles: ['admin'] },
  { id: 'dining-area-definitions', path: '/settings/dining-areas', label: 'Salon Bölgeleri', roles: ['admin'] },
];

const SETTINGS_EXCLUDED_PATHS = DEFINITIONS_ITEMS.map((item) => item.path);

export default function Sidebar({
  isOpen = false,
  onToggle,
  onNavigate,
  showTakeawayQuickButton = false,
  onTakeawayQuickClick,
}) {
  const { user, logout, hasRole } = useAuth();
  const bridgeStatus = useBridgeStatus();
  const location = useLocation();
  const navigate = useNavigate();
  const definitionsVisible = hasRole('admin');
  const hasActiveDefinitionRoute = useMemo(
    () => DEFINITIONS_ITEMS.some((item) => location.pathname.startsWith(item.path)),
    [location.pathname],
  );
  const [definitionsOpen, setDefinitionsOpen] = useState(hasActiveDefinitionRoute);

  useEffect(() => {
    if (hasActiveDefinitionRoute) setDefinitionsOpen(true);
  }, [hasActiveDefinitionRoute]);

  const handleNavigate = (path) => {
    navigate(path);
    onNavigate?.();
  };

  const isItemActive = (item) => {
    if (item.id === 'settings') {
      const isSettingsPath = location.pathname === '/settings' || location.pathname.startsWith('/settings/');
      const isExcluded = SETTINGS_EXCLUDED_PATHS.some((path) => location.pathname.startsWith(path));
      return isSettingsPath && !isExcluded;
    }
    return location.pathname.startsWith(item.path);
  };

  return (
    <nav className={`sidebar ${isOpen ? 'open' : 'collapsed'}`}>
      <div className="sidebar-top">
        <button
          type="button"
          className="sidebar-toggle-btn"
          onClick={onToggle}
          aria-label={isOpen ? "Sidebar'ı kapat" : "Sidebar'ı aç"}
          title={isOpen ? "Sidebar'ı kapat" : "Sidebar'ı aç"}
        >
          {isOpen ? <PanelLeftClose size={18} /> : <PanelLeftOpen size={18} />}
        </button>
        {showTakeawayQuickButton && (
          <button
            type="button"
            className="sidebar-takeaway-btn"
            onClick={onTakeawayQuickClick}
            title="Paket"
          >
            <Package size={18} />
            <span className="sidebar-takeaway-btn-label">Paket</span>
          </button>
        )}
      </div>

      {isOpen && (
        <>
          <div className="sidebar-nav">
            {NAV_ITEMS.filter(item => hasRole(...item.roles)).map(item => {
              const Icon = item.icon;
              const isActive = isItemActive(item);
              return (
                <button
                  key={item.id}
                  className={`sidebar-item ${isActive ? 'active' : ''}`}
                  onClick={() => handleNavigate(item.path)}
                  title={item.label}
                >
                  <Icon size={20} strokeWidth={isActive ? 2.2 : 1.8} />
                  <span className="sidebar-item-label">{item.label}</span>
                </button>
              );
            })}

            {definitionsVisible && (
              <div className={`sidebar-group ${definitionsOpen ? 'open' : ''}`}>
                <button
                  type="button"
                  className={`sidebar-item sidebar-group-trigger ${hasActiveDefinitionRoute ? 'active' : ''}`}
                  onClick={() => setDefinitionsOpen((prev) => !prev)}
                  title="Tanımlamalar"
                >
                  <FolderTree size={20} strokeWidth={hasActiveDefinitionRoute ? 2.2 : 1.8} />
                  <span className="sidebar-item-label">Tanımlamalar</span>
                  <span className="sidebar-group-arrow">
                    {definitionsOpen ? <ChevronDown size={16} /> : <ChevronRight size={16} />}
                  </span>
                </button>

                {definitionsOpen && (
                  <div className="sidebar-submenu">
                    {DEFINITIONS_ITEMS.filter((item) => hasRole(...item.roles)).map((item) => {
                      const isSubActive = location.pathname.startsWith(item.path);
                      return (
                        <button
                          key={item.id}
                          type="button"
                          className={`sidebar-subitem ${isSubActive ? 'active' : ''}`}
                          onClick={() => handleNavigate(item.path)}
                        >
                          {item.label}
                        </button>
                      );
                    })}
                  </div>
                )}
              </div>
            )}
          </div>

          <div className="sidebar-bottom">
            <div style={{
              textAlign: 'center', marginBottom: 8,
              padding: '8px 4px',
              borderRadius: 'var(--radius-sm)',
              background: 'var(--bg-tertiary)',
              position: 'relative',
            }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-primary)', lineHeight: 1.3 }}>
                {user?.fullName?.split(' ')[0]}
              </div>
              <div style={{ fontSize: 8, color: 'var(--text-muted)', fontWeight: 600, textTransform: 'uppercase', letterSpacing: '0.05em', marginTop: 2 }}>
                {user?.roleName}
              </div>
              {bridgeStatus && BRIDGE_DOT[bridgeStatus] && (
                <div title={BRIDGE_DOT[bridgeStatus].title} style={{
                  position: 'absolute', top: 6, right: 6,
                  width: 7, height: 7, borderRadius: '50%',
                  background: BRIDGE_DOT[bridgeStatus].color,
                  boxShadow: bridgeStatus === 'ok' ? `0 0 4px ${BRIDGE_DOT.ok.color}` : 'none',
                }} />
              )}
            </div>
            <button className="sidebar-item" onClick={logout} title="Çıkış">
              <LogOut size={18} />
              <span className="sidebar-item-label">Çıkış</span>
            </button>
          </div>
        </>
      )}
    </nav>
  );
}
