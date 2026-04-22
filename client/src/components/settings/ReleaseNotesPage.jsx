/**
 * Sürüm Notları — Settings ekranı.
 *
 * Gösterdikleri:
 *   • Mevcut uygulama versiyonu (Electron ortamında IPC'den, browser'da sabit)
 *   • Statik changelog (RELEASES dizisi — yeni sürüm çıkınca buraya eklenir)
 *   • "Güncelleme Ara" butonu (yalnızca Electron'da, checkForUpdates çalışır iken)
 *   • Kopyalama butonu (versiyon metnini panoya)
 *
 * Akış:
 *   Electron'da window.electronAPI.getAppVersion() → string.
 *   Browser dev modunda fallback olarak APP_VERSION_FALLBACK kullanılır.
 */
import { useState, useEffect, useCallback } from 'react';
import {
  ScrollText, RefreshCw, Copy, Check, Tag,
  Sparkles, Bug, Zap, Shield, Package,
} from 'lucide-react';
import { formatDateInIstanbul } from '../../utils/time.js';

/* ── Statik changelog — her release'e eklenir ──────────────────────────── */

const RELEASES = [
  {
    version: '1.1.0',
    date: '2026-04-20',
    tag: 'latest',
    sections: [
      {
        type: 'security',
        title: 'FAZ 0 — Online Öncesi Güvenlik Sertleştirmesi',
        items: [
          'JWT_SECRET prod fail-fast: eksik veya < 32 karakter secret reddediliyor.',
          'CORS whitelist sertleştirildi: prod\'da yalnızca CORS_ORIGINS env\'i geçerli.',
          'Trust proxy hop sayısı env-driven (TRUST_PROXY_HOPS) — rate-limit gerçek IP üzerinden.',
          'Global rate-limit env ile ayarlanabilir; /api/health muaf.',
          'Şifre politikası: min 8 karakter + büyük harf + rakam; zorunlu ilk giriş şifre değişimi.',
          'Pino yapılandırılmış log + Sentry entegrasyonu (backend + frontend, GDPR redact).',
          '.gitignore sertleştirmesi: .env, pos-config.json, *.db, uploads/, backups/ artık commit edilemez.',
          'CI timeout + concurrency guard + client build doğrulama job\'u eklendi.',
        ],
      },
      {
        type: 'fix',
        title: 'Düzeltmeler',
        items: [
          'Paket teslim ödemeleri artık kullanıcının seçtiği Nakit/Kart altında grafiklerde toplanıyor (system_takeaway_delivery ayrı grup olarak görünmüyor).',
          'CORS + rate-limit middleware sırası düzeltildi: 429 yanıtlarında CORS header\'ı artık mevcut.',
          'Global rate-limit pencere varsayılanı 15 dk → 1 dk (dev polling uyumu).',
          'Migration 0010 FK çakışması giderildi: sipariş geçmişi olan pasif kategoriler korunuyor, gerçekten orphan olanlar hard-delete ediliyor.',
        ],
      },
    ],
  },
  {
    version: '1.0.9',
    date: '2026-04-18',
    sections: [
      {
        type: 'improvement',
        title: 'Operasyonel İyileştirmeler',
        items: [
          'Electron modülarizasyonu: main.cjs 9 alt modüle ayrıldı.',
          'Auto-updater entegrasyonu: electron-updater, toast + sürüm notları modal.',
          'First-run kurulum sihirbazı (SetupWizardPage) eklendi.',
          'StoreBridge dosya loglama (5 MB döngüsü) ve Sentry crash reporter eklendi.',
          'Destek paketi (support bundle) indirme UI tamamlandı.',
          'Entity mutations audit trail: 7 kritik endpoint\'e entegre edildi.',
        ],
      },
      {
        type: 'new',
        title: 'Yeni Özellikler',
        items: [
          'Rezervasyon → masa eşleme akışı tamamlandı.',
          'İade / return akışı: orijinal ödeme bağlantısı ile birlikte.',
          'Periyot kapanışı (X önizleme + Z kapanış) eklendi.',
          'Bahşiş / tip modeli ödeme seviyesinde uygulandı.',
          'Menü yönetimi: sıralama, bulk işlem, ürün detay editörü.',
          'Lokasyon porsiyon seçimi (Tam / Yarım) eklendi.',
        ],
      },
    ],
  },
  {
    version: '1.0.8',
    date: '2026-04-12',
    sections: [
      {
        type: 'improvement',
        title: 'Refactoring',
        items: [
          'orders.js 1231 → 401 satıra düşürüldü; orderService.js extraction tamamlandı.',
          'payments.js 552 → 130 satır; paymentService.js devreye alındı.',
          'API domain modüler split: 14 ayrı domain servisi oluşturuldu.',
          'PrinterDetailPage.jsx 854 → 335 satıra indirildi.',
        ],
      },
      {
        type: 'fix',
        title: 'Düzeltmeler',
        items: [
          'CI pipeline jest/vitest çakışması giderildi.',
          'N+1 sorgu sorunları order detay endpoint\'inde düzeltildi.',
          'Ödeme ekranında çift tıklama race condition çözüldü.',
        ],
      },
    ],
  },
  {
    version: '1.0.7',
    date: '2026-04-05',
    sections: [
      {
        type: 'new',
        title: 'Yeni Özellikler',
        items: [
          'GitHub Actions CI: lint + test + Playwright E2E pipeline.',
          'Structured migration runner: schema_migrations tablosu + numbered versions.',
          'Müşteri yönetimi ekranı (CustomersScreen) tamamlandı.',
          'Stok takip ekranı (StockScreen) eklendi.',
        ],
      },
      {
        type: 'security',
        title: 'Güvenlik',
        items: [
          'JWT secret otomatik üretimi ve persistent storage.',
          'contextBridge ile renderer sandbox güçlendirildi.',
          'Role-based route protection (ProtectedRoute) eklendi.',
        ],
      },
    ],
  },
  {
    version: '1.0.0',
    date: '2026-03-28',
    sections: [
      {
        type: 'new',
        title: 'İlk Sürüm',
        items: [
          'Masa tabanlı sipariş yönetimi (TableScreen + OrderScreen).',
          'Mutfak ekranı (KitchenScreen) — canlı güncelleme ile.',
          'Ödeme akışı: nakit, kart, split payment.',
          'Yazıcı yönetimi: listesi, roller, kategori yönlendirme.',
          'Salon bölgeleri ve masa tanımları.',
          'Kullanıcı rolleri: admin, cashier, waiter, kitchen.',
          'SQLite local-first mimari.',
        ],
      },
    ],
  },
];

/* ── Yardımcı: section tiplerine göre ikon + renk ─────────────────────── */

function sectionMeta(type) {
  switch (type) {
    case 'new':         return { icon: Sparkles, color: 'var(--accent)',      bg: 'var(--accent-muted)',  label: 'Yeni' };
    case 'improvement': return { icon: Zap,      color: 'var(--warning)',     bg: 'var(--warning-muted)', label: 'İyileştirme' };
    case 'fix':         return { icon: Bug,      color: 'var(--danger)',      bg: 'var(--danger-soft)',   label: 'Düzeltme' };
    case 'security':    return { icon: Shield,   color: 'var(--success)',     bg: 'var(--success-soft)',  label: 'Güvenlik' };
    default:            return { icon: Package,  color: 'var(--text-muted)',  bg: 'var(--surface-2)',     label: type };
  }
}

/* ── Ana bileşen ────────────────────────────────────────────────────────── */

const APP_VERSION_FALLBACK = '1.1.0';

export default function ReleaseNotesPage() {
  const [appVersion, setAppVersion] = useState(null);
  const [checking, setChecking] = useState(false);
  const [checkResult, setCheckResult] = useState(null); // 'up-to-date' | null
  const [copied, setCopied] = useState(false);

  /* Electron'dan versiyon al */
  useEffect(() => {
    const api = window.electronAPI;
    if (api?.getAppVersion) {
      Promise.resolve(api.getAppVersion())
        .then((v) => setAppVersion(typeof v === 'string' ? v : APP_VERSION_FALLBACK))
        .catch(() => setAppVersion(APP_VERSION_FALLBACK));
    } else {
      setAppVersion(APP_VERSION_FALLBACK);
    }
  }, []);

  /* Manuel güncelleme kontrolü */
  const handleCheckUpdates = useCallback(() => {
    if (!window.electronAPI?.checkForUpdates) return;
    setChecking(true);
    setCheckResult(null);
    window.electronAPI.checkForUpdates();

    let removeListener;
    const timer = setTimeout(() => {
      setChecking(false);
      setCheckResult('up-to-date');
      removeListener?.();
    }, 10000);

    removeListener = window.electronAPI?.onUpdateAvailable?.(() => {
      clearTimeout(timer);
      setChecking(false);
      setCheckResult(null);
    });
  }, []);

  /* Versiyon kopyala */
  const handleCopy = useCallback(() => {
    const text = `Restoran POS v${appVersion || APP_VERSION_FALLBACK}`;
    navigator.clipboard?.writeText(text).catch(() => {});
    setCopied(true);
    setTimeout(() => setCopied(false), 2000);
  }, [appVersion]);

  const displayVersion = appVersion || APP_VERSION_FALLBACK;
  const isElectron = Boolean(window.electronAPI);
  const canCheckUpdates = isElectron && Boolean(window.electronAPI?.checkForUpdates);

  return (
    <div className="page-container" style={{ maxWidth: 720 }}>

      {/* ── Başlık ── */}
      <div className="page-header">
        <div className="page-header-main page-title-line">
          <h1 className="page-title">
            <ScrollText
              size={22}
              style={{ display: 'inline', verticalAlign: 'middle', marginRight: 8 }}
            />
            Sürüm Notları
          </h1>
        </div>
      </div>

      {/* ── Versiyon kartı ── */}
      <div style={{
        display: 'flex', alignItems: 'center', justifyContent: 'space-between',
        flexWrap: 'wrap', gap: 12,
        padding: '16px 20px',
        background: 'linear-gradient(135deg, color-mix(in srgb, var(--accent) 10%, var(--surface-1)), var(--surface-1))',
        border: '1px solid color-mix(in srgb, var(--accent) 22%, var(--border))',
        borderRadius: 'var(--radius-md)',
        marginBottom: 24,
      }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 14 }}>
          <div style={{
            width: 48, height: 48, borderRadius: 12, flexShrink: 0,
            background: 'linear-gradient(135deg, var(--accent), var(--accent-gradient-end))',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            boxShadow: '0 4px 16px color-mix(in srgb, var(--accent) 36%, transparent)',
          }}>
            <span style={{ fontSize: 20, fontWeight: 900, color: 'white', letterSpacing: -1 }}>P</span>
          </div>
          <div>
            <div style={{
              fontWeight: 800, fontSize: 17,
              color: 'var(--text-primary)', letterSpacing: -0.5,
            }}>
              Restoran POS
              <span style={{ fontWeight: 400, fontSize: 14, color: 'var(--text-muted)', marginLeft: 8 }}>
                v{displayVersion}
              </span>
            </div>
            <div style={{ fontSize: 11, color: 'var(--text-muted)', marginTop: 2 }}>
              {isElectron ? 'Electron masaüstü uygulaması' : 'Geliştirici modu (browser)'}
            </div>
          </div>
        </div>

        <div style={{ display: 'flex', gap: 8, flexShrink: 0 }}>
          <button
            type="button"
            className="btn btn-ghost btn-sm"
            id="release-notes-copy-version-btn"
            onClick={handleCopy}
            title="Versiyon bilgisini kopyala"
            style={{ gap: 6 }}
          >
            {copied
              ? <Check size={13} color="var(--success)" />
              : <Copy size={13} />}
            {copied ? 'Kopyalandı' : 'Kopyala'}
          </button>

          {canCheckUpdates && (
            <button
              type="button"
              id="release-notes-check-updates-btn"
              className="btn btn-primary btn-sm"
              onClick={handleCheckUpdates}
              disabled={checking}
              style={{ gap: 6 }}
            >
              <RefreshCw size={13} style={checking ? { animation: 'spin 1s linear infinite' } : {}} />
              {checking ? 'Kontrol ediliyor…' : 'Güncelleme Ara'}
            </button>
          )}
        </div>
      </div>

      {/* Güncelleme kontrol sonucu */}
      {checkResult === 'up-to-date' && (
        <div style={{
          display: 'flex', alignItems: 'center', gap: 8,
          padding: '10px 14px', marginBottom: 20,
          background: 'var(--success-soft)',
          border: '1px solid color-mix(in srgb, var(--success) 22%, transparent)',
          borderRadius: 'var(--radius-sm)',
          fontSize: 13, color: 'var(--success)', fontWeight: 500,
        }}>
          <Check size={14} />
          Uygulama güncel — yeni sürüm bulunamadı.
        </div>
      )}

      {/* ── Changelog ── */}
      <div style={{ display: 'flex', flexDirection: 'column', gap: 16 }}>
        {RELEASES.map((release, ri) => (
          <div
            key={release.version}
            id={`release-v${release.version.replace(/\./g, '-')}`}
            style={{
              background: 'var(--surface-1)',
              border: `1px solid ${ri === 0
                ? 'color-mix(in srgb, var(--accent) 30%, var(--border))'
                : 'var(--border)'}`,
              borderRadius: 'var(--radius-md)',
              overflow: 'hidden',
            }}
          >
            {/* Release header */}
            <div style={{
              display: 'flex', alignItems: 'center', gap: 10,
              padding: '13px 18px',
              borderBottom: '1px solid var(--border)',
              background: ri === 0
                ? 'color-mix(in srgb, var(--accent) 6%, var(--surface-2))'
                : 'var(--surface-2)',
            }}>
              <span style={{
                fontWeight: 800, fontSize: 14,
                color: ri === 0 ? 'var(--text-primary)' : 'var(--text-secondary)',
                letterSpacing: -0.3,
              }}>
                v{release.version}
              </span>
              {ri === 0 && (
                <span style={{
                  display: 'inline-flex', alignItems: 'center', gap: 4,
                  fontSize: 9, fontWeight: 700, letterSpacing: '0.06em',
                  textTransform: 'uppercase',
                  color: 'var(--accent)',
                  background: 'var(--accent-muted)',
                  border: '1px solid color-mix(in srgb, var(--accent) 28%, transparent)',
                  borderRadius: 999, padding: '2px 8px',
                }}>
                  <Tag size={8} /> Güncel
                </span>
              )}
              <span style={{ flex: 1 }} />
              <span style={{ fontSize: 11, color: 'var(--text-muted)', fontVariantNumeric: 'tabular-nums' }}>
                {formatDateInIstanbul(release.date, {
                  year: 'numeric', month: 'long', day: 'numeric',
                })}
              </span>
            </div>

            {/* Release sections */}
            <div style={{
              padding: '14px 18px',
              display: 'flex', flexDirection: 'column', gap: 16,
            }}>
              {release.sections.map((section) => {
                const { icon: Icon, color, bg, label } = sectionMeta(section.type);
                return (
                  <div key={`${release.version}-${section.type}`}>
                    {/* Section badge */}
                    <div style={{
                      display: 'inline-flex', alignItems: 'center', gap: 5,
                      fontSize: 9, fontWeight: 700,
                      letterSpacing: '0.07em', textTransform: 'uppercase',
                      color, background: bg,
                      border: `1px solid color-mix(in srgb, ${color} 20%, transparent)`,
                      borderRadius: 999, padding: '3px 9px',
                      marginBottom: 7,
                    }}>
                      <Icon size={9} />
                      {label}
                    </div>
                    {/* Section title */}
                    <div style={{
                      fontWeight: 700, fontSize: 13,
                      color: 'var(--text-primary)', marginBottom: 7,
                    }}>
                      {section.title}
                    </div>
                    {/* Items */}
                    <ul style={{
                      margin: 0, paddingLeft: 18,
                      display: 'flex', flexDirection: 'column', gap: 5,
                    }}>
                      {section.items.map((item) => (
                        <li key={item} style={{
                          fontSize: 13,
                          color: 'var(--text-secondary)',
                          lineHeight: 1.55,
                        }}>
                          {item}
                        </li>
                      ))}
                    </ul>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>

      {/* Alt bilgi */}
      <div style={{
        marginTop: 28, marginBottom: 8,
        fontSize: 11, color: 'var(--text-muted)', textAlign: 'center',
      }}>
        Restoran POS v{displayVersion} — Tüm hakları saklıdır.
      </div>
    </div>
  );
}
