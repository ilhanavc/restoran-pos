import {
  createContext, useContext, useCallback, useEffect, useRef, useState,
} from 'react';
import { useNavigate } from 'react-router-dom';
import api from '../services/api.js';
import { useAuth } from './AuthContext.jsx';
import { Phone, X, ShoppingBag } from 'lucide-react';

const IncomingCallContext = createContext(null);

function suppressedStorageKey(userId) {
  return userId ? `pos_caller_banner_suppressed_${userId}` : null;
}

function loadSuppressedSet(userId) {
  const key = suppressedStorageKey(userId);
  if (!key) return new Set();
  try {
    const raw = sessionStorage.getItem(key);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return Array.isArray(arr) ? new Set(arr) : new Set();
  } catch {
    return new Set();
  }
}

function persistSuppressedSet(userId, set) {
  const key = suppressedStorageKey(userId);
  if (!key) return;
  try {
    sessionStorage.setItem(key, JSON.stringify([...set]));
  } catch {
    /* ignore */
  }
}

function formatTrMobileDisplay(digits) {
  const d = String(digits || '').replace(/\D/g, '');
  if (d.length === 12 && d.startsWith('90')) {
    const m = d.slice(2);
    return `0${m.slice(0, 3)} ${m.slice(3, 6)} ${m.slice(6, 8)} ${m.slice(8)}`;
  }
  return digits || '';
}

export function IncomingCallProvider({ children }) {
  const { user, hasRole } = useAuth();
  const navigate = useNavigate();
  const [bannerCall, setBannerCall] = useState(null);
  /** Siparişi Aç ile ekrana gidildi; sunucu hâlâ ringing olabilir — banner tekrarlamasın */
  const suppressedBannerIdsRef = useRef(new Set());
  const pollRef = useRef(null);

  useEffect(() => {
    if (!user?.id) {
      suppressedBannerIdsRef.current = new Set();
      setBannerCall(null);
      return;
    }
    suppressedBannerIdsRef.current = loadSuppressedSet(user.id);
  }, [user?.id]);

  const refresh = useCallback(async () => {
    if (!user || !hasRole('admin', 'cashier')) return;
    try {
      const rows = await api.getCallerIdRecent(40);
      const ringing = rows.filter(
        (r) => r?.id && r.status === 'ringing' && !suppressedBannerIdsRef.current.has(r.id),
      );
      const next = ringing[0] ?? null;
      setBannerCall((prev) => (prev?.id === next?.id ? prev : next));
    } catch {
      /* ağ hatası: mevcut banner’ı koru */
    }
  }, [user, hasRole]);

  useEffect(() => {
    if (!user || !hasRole('admin', 'cashier')) {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
      return;
    }
    refresh();
    pollRef.current = setInterval(refresh, 4000);
    return () => {
      if (pollRef.current) {
        clearInterval(pollRef.current);
        pollRef.current = null;
      }
    };
  }, [user, hasRole, refresh]);

  const dismiss = useCallback(async (id) => {
    if (!id) return;
    setBannerCall((prev) => (prev?.id === id ? null : prev));
    try {
      await api.patchCallLogStatus(id, 'dismissed');
    } catch {
      /* ignore */
    }
  }, []);

  const openOrder = useCallback(async (call) => {
    if (!call?.id) return;
    suppressedBannerIdsRef.current.add(call.id);
    if (user?.id) persistSuppressedSet(user.id, suppressedBannerIdsRef.current);
    setBannerCall(null);

    let customer = null;
    if (call.customer_id) {
      try {
        customer = await api.getCustomer(call.customer_id);
        const addr = call.address_snapshot
          || customer?.addresses?.find((a) => a.is_default)?.address
          || customer?.addresses?.[0]?.address
          || '';
        customer = { ...customer, selectedAddress: addr };
      } catch {
        customer = {
          id: call.customer_id,
          full_name: call.customer_name_snapshot || 'Müşteri',
          phones: [{ phone: call.normalized_phone || call.phone, is_primary: 1 }],
          addresses: call.address_snapshot
            ? [{ title: 'Varsayılan', address: call.address_snapshot, is_default: 1 }]
            : [],
          selectedAddress: call.address_snapshot || '',
        };
      }
    }

    const rawPhone = call.normalized_phone || call.phone;
    navigate('/order/takeaway', {
      state: {
        orderType: 'takeaway',
        customer,
        prefillPhone: rawPhone != null ? String(rawPhone) : undefined,
        callLogId: call.id,
      },
    });
  }, [navigate, user?.id]);

  const value = { refresh, dismiss, openOrder, bannerCall };

  return (
    <IncomingCallContext.Provider value={value}>
      {children}
      {bannerCall && (
        <div
          style={{
            position: 'fixed',
            top: 12,
            left: '50%',
            transform: 'translateX(-50%)',
            zIndex: 10050,
            width: 'min(440px, calc(100vw - 24px))',
            background: 'var(--bg-card)',
            border: '2px solid var(--accent)',
            borderRadius: 'var(--radius-md)',
            boxShadow: '0 12px 40px rgba(0,0,0,0.25)',
            padding: '14px 16px',
            fontFamily: 'inherit',
          }}
        >
          <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
            <div style={{
              width: 44, height: 44, borderRadius: '50%',
              background: 'var(--accent-muted)',
              display: 'flex', alignItems: 'center', justifyContent: 'center', flexShrink: 0,
            }}>
              <Phone size={22} color="var(--accent)" />
            </div>
            <div style={{ flex: 1, minWidth: 0 }}>
              <div style={{ fontSize: 10, fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                Gelen Arama
              </div>
              <div style={{ fontSize: 17, fontWeight: 800, marginTop: 2 }}>
                {formatTrMobileDisplay(bannerCall.normalized_phone || bannerCall.phone)}
              </div>
              {bannerCall.customer_name_snapshot && (
                <div style={{ fontSize: 14, fontWeight: 600, marginTop: 6 }}>
                  {bannerCall.customer_name_snapshot}
                </div>
              )}
              {bannerCall.address_snapshot && (
                <div style={{ fontSize: 12, color: 'var(--text-muted)', marginTop: 4, lineHeight: 1.35 }}>
                  {bannerCall.address_snapshot}
                </div>
              )}
              <div style={{ marginTop: 8 }}>
                <span className={`badge ${bannerCall.customer_id ? 'badge-success' : 'badge-warning'}`} style={{ fontSize: 10 }}>
                  {bannerCall.customer_id ? 'Kayıtlı müşteri' : 'Yeni numara'}
                </span>
              </div>
            </div>
            <button type="button" className="btn btn-ghost btn-icon" onClick={() => dismiss(bannerCall.id)} aria-label="Kapat">
              <X size={18} />
            </button>
          </div>
          <div style={{ display: 'flex', gap: 8, marginTop: 12, justifyContent: 'flex-end' }}>
            <button type="button" className="btn btn-ghost btn-sm" onClick={() => dismiss(bannerCall.id)}>
              Kapat
            </button>
            <button type="button" className="btn btn-primary btn-sm" onClick={() => openOrder(bannerCall)}>
              <ShoppingBag size={14} style={{ marginRight: 6 }} />
              Siparişi Aç
            </button>
          </div>
        </div>
      )}
    </IncomingCallContext.Provider>
  );
}

export function useIncomingCall() {
  const ctx = useContext(IncomingCallContext);
  return ctx;
}
