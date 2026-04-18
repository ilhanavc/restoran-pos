import { Settings, Store, Users, Printer, Monitor, Phone, CheckCircle2, DatabaseBackup, Activity, ScrollText } from 'lucide-react';
import { useNavigate } from 'react-router-dom';

const sections = [
  { icon: CheckCircle2, label: 'Kurulum Kontrolü', desc: 'İlk açılış, cihaz ve operasyon hazırlığı', to: '/settings/readiness' },
  { icon: DatabaseBackup, label: 'Bakım ve Yedekleme', desc: 'Yedekler, manuel backup ve restore planı', to: '/settings/maintenance' },
  { icon: Store, label: 'İşletme Bilgileri', desc: 'Ad, adres, vergi bilgileri, fiş ayarları', to: '/settings/business' },
  { icon: Users, label: 'Kullanıcı Yönetimi', desc: 'Personel ekleme, rol atama, yetkilendirme', to: '/settings/users' },
  { icon: Printer, label: 'Yazıcı Ayarları', desc: 'Yazıcı listesi, roller ve kategori yönlendirme', to: '/settings/printers' },
  { icon: Activity, label: 'StoreBridge Durumu', desc: 'Bağlantı sağlığı, baskı kuyruğu ve son loglar', to: '/settings/bridge' },
  { icon: Monitor, label: 'Ekran Ayarları', desc: 'Tema, düzen, dil tercihleri', to: '/settings/display' },
  { icon: Phone, label: 'Gelen arama (Caller ID)', desc: 'Arama geçmişi ve gelen arama yönetimi', to: '/settings/caller-id' },
  { icon: ScrollText, label: 'Sürüm Notları', desc: 'Uygulama sürüm geçmişi, yenilikler ve güncelleme', to: '/settings/release-notes' },
];

export default function SettingsHome() {
  const navigate = useNavigate();

  return (
    <div className="page-container">
      <div className="page-header">
        <div className="page-header-main page-title-line">
          <h1 className="page-title">
            <Settings size={22} style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }} />
            Ayarlar
          </h1>
        </div>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(280px, 1fr))', gap: 14 }}>
        {sections.map((s) => (
          <button
            key={s.to}
            type="button"
            className="card card-padded"
            onClick={() => navigate(s.to)}
            style={{
              width: '100%',
              textAlign: 'left',
              cursor: 'pointer',
              font: 'inherit',
              color: 'inherit',
              transition: 'border-color var(--transition-fast), background var(--transition-fast)',
            }}
            onMouseEnter={(e) => {
              e.currentTarget.style.borderColor = 'var(--accent)';
              e.currentTarget.style.background = 'var(--bg-card-hover)';
            }}
            onMouseLeave={(e) => {
              e.currentTarget.style.borderColor = 'var(--border)';
              e.currentTarget.style.background = 'var(--bg-card)';
            }}
          >
            <div style={{ display: 'flex', alignItems: 'flex-start', gap: 14 }}>
              <div
                style={{
                  width: 42,
                  height: 42,
                  borderRadius: 'var(--radius-sm)',
                  background: 'var(--accent-muted)',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  flexShrink: 0,
                }}
              >
                <s.icon size={20} color="var(--accent)" />
              </div>
              <div>
                <div style={{ fontWeight: 700, fontSize: 14, marginBottom: 4 }}>{s.label}</div>
                <div style={{ fontSize: 12, color: 'var(--text-muted)' }}>{s.desc}</div>
              </div>
            </div>
          </button>
        ))}
      </div>

      <div
        style={{
          marginTop: 24,
          padding: 16,
          background: 'var(--bg-card)',
          borderRadius: 'var(--radius-md)',
          border: '1px solid var(--border)',
        }}
      >
        <div
          style={{
            fontSize: 11,
            fontWeight: 600,
            color: 'var(--text-muted)',
            textTransform: 'uppercase',
            letterSpacing: '0.05em',
            marginBottom: 8,
          }}
        >
          Sistem Bilgisi
        </div>
        <div style={{ fontSize: 13, color: 'var(--text-secondary)' }}>
          Restoran POS v1.0.0 — Geliştirme Sürümü
        </div>
      </div>
    </div>
  );
}
