import { SlidersHorizontal } from 'lucide-react';
import SettingsDetailHeader from './SettingsDetailHeader.jsx';

const plannedFeatures = [
  'Ürün seçenekleri',
  'Ekstra malzemeler',
  'Porsiyon ve varyantlar',
  'Sipariş notu şablonları',
];

export default function FeatureDefinitionsPage() {
  return (
    <div className="page-container">
      <SettingsDetailHeader title="Özellikler" />

      <div className="card card-padded">
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
            <SlidersHorizontal size={20} color="var(--accent)" />
          </div>

          <div style={{ minWidth: 0 }}>
            <h2 style={{ margin: 0, fontSize: 16, fontWeight: 800 }}>Özellik tanımları</h2>
            <p style={{ margin: '6px 0 0', fontSize: 13, color: 'var(--text-secondary)', lineHeight: 1.45 }}>
              Ürünlere bağlanacak seçenek, ekstra ve varyant tanımları burada yönetilecek.
            </p>
          </div>
        </div>
      </div>

      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'repeat(auto-fill, minmax(220px, 1fr))',
          gap: 12,
          marginTop: 14,
        }}
      >
        {plannedFeatures.map((label) => (
          <div key={label} className="card card-padded">
            <div style={{ fontSize: 14, fontWeight: 700, marginBottom: 5 }}>{label}</div>
            <div style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.45 }}>
              Hazırlanıyor
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
