# Master Productization Report v2 — Restoran POS v3

**Tarih:** 2026-04-18  
**Versiyon:** v2 (v1 → 2026-04-17, v2 → 2026-04-18 sonrası tüm sprint'ler dahil)  
**Hedef:** Tek restoran → Cloud + iOS/Android mobil (4 ay pilot) → Çoklu şube  
**Test sayısı:** 352 (tümü geçiyor)  
**Durum:** O-1 tamamlandı · Cloud deployment sıradaki

---

## 1) Mevcut Durum Özeti

### Ne tamamlandı (2026-04-18 itibarıyla)

| Kategori | Durum |
|----------|-------|
| Çekirdek POS (masa → sipariş → ödeme → mutfak → yazıcı) | ✅ Production-grade |
| Backup/Restore (SHA-256, meta.json, safety revert, Task Scheduler) | ✅ Production-grade |
| Güvenlik (JWT persist, BRIDGE_TOKEN mask, rate limit, CORS) | ✅ Production-grade |
| Yazıcı outbox (lease, idempotency, error codes, manual retry) | ✅ Production-grade |
| CallerID (.NET 8 self-contained, reconnect, duplicate guard) | ✅ Production-grade |
| D-1 Test + CI (GitHub Actions, 352 test, Playwright e2e) | ✅ Tamamlandı |
| D-2 First-run wizard + Release notes + Auto-update | ✅ Tamamlandı |
| D-3 Structured logging + crash reporter + request-id | ✅ Tamamlandı |
| D-4 Monolitik ayrıştırma (electron/main, orderService, paymentService) | ✅ Tamamlandı |
| D-5 Ürün eksikleri (X/Z raporu, iade, bahşiş, rezervasyon→masa) | ✅ Tamamlandı |
| DB-1 Migration disiplini (schema_migrations, numbered runner) | ✅ Tamamlandı |
| DB-2 Audit trail (entity_mutations, tüm mutation endpoint'leri, viewer UI) | ✅ Tamamlandı |
| DB-3 Integer minor unit (toCents/fromCents, dual-write, reports COALESCE) | ✅ Tamamlandı |
| DB-4 Snapshot tamamlama (pricing_policy_version, vat_rate_snapshot, service_charge) | ✅ Tamamlandı |
| **O-1 Veri modeli sağlamlaştırma** | ✅ **Tamamlandı** (DB-1-4 + D-5.1) |

### Ne eksik (kritik yol üzerinde)

| Madde | Neden önemli |
|-------|-------------|
| Cloud deployment (Railway) | Mobil cihazlar backend'e erişemez |
| Refresh token | Mobil session'lar 24h'de sona erer, kullanılamaz |
| Mobile-first API endpoints | Mevcut API desktop-first, mobil için optimize değil |
| React Native waiter app | Garsonlar telefondan sipariş giremez |
| Push notification (FCM/APNs) | Gerçek zamanlı bildirim yoksa mutfak/masa güncellemesi kaçar |
| Kod imzası (EV/OV) | SmartScreen uyarısı — ertelendi, ilk etapta kabul edildi |

---

## 2) Hedef ve Yol Haritası

### Kullanıcı hedefi
1. **0–4 ay:** Tek restoran, online erişim + iOS/Android garson uygulaması
2. **4 ay sonrası:** Çoklu şube genişlemesi

### Bağımlılık Ağacı (güncel)

```
TAMAMLANDI:
  D-1 ✅ → D-2 ✅ → D-3 ✅ → D-4 ✅ → D-5 ✅
  DB-1 ✅ → DB-2 ✅ → DB-3 ✅ → DB-4 ✅ → O-1 ✅

DEVAM EDİYOR (0–4 ay hedefi):
  O-1 ✅
    └─► C-1 (Cloud deployment — Railway)
          └─► C-2 (Auth hardening — refresh token)
                └─► M-1.1 (Mobile endpoints — waiter API)
                      └─► M-1.2 (Device pairing — QR + device_id)
                            └─► M-1.3 (Push notification — FCM/APNs)
                                  └─► M-2 (Android waiter app — Expo)
                                        └─► [3 ay saha testi]
                                              └─► M-3 (iOS waiter app)

4 AY SONRASI (çoklu şube):
  O-1 ✅ → O-2 (Tenant identity)
              └─► O-3 (Sync backbone — outbox + conflict resolution)
                    └─► O-4 (Cloud deployment — Postgres + multi-tenant)
```

---

## 3) Aşama Aşama Plan

### C-1 — Cloud Deployment (Railway)
**Ön koşul:** O-1 ✅  
**Amaç:** Express + SQLite'ı internet erişilebilir hale getir. Ana bilgisayar kapalı olsa bile mobil erişim.  
**Bağımlılık:** Tüm mobil geliştirmenin temeli — bu olmadan hiçbir mobil şey çalışmaz.

**Yapılacaklar:**
- `railway.json` deploy config (NIXPACKS builder, `/api/health` healthcheck)
- `server/index.js`: `HOST=0.0.0.0`, `PORT=process.env.PORT||3001`
- `USER_DATA_PATH=/data` → Railway persistent volume
- `CORS_ORIGINS` env var (mobil + Electron origin'leri)
- `server/.env.example` (commit edilebilir şablon)
- Electron cloud modu: `pos-config.json`'a `cloudServerUrl` alanı; set edilirse local sunucu başlatılmaz, cloud URL kullanılır
- `client/src/services/api/core.js`: `window.electronConfig?.apiBaseUrl || VITE_API_URL || localhost`
- Root `package.json`'a `start:server` script

**Yapılmaması:**
- SQLite → Postgres geçişi (bu C-1 kapsamı dışı)
- Frontend build değişikliği
- Local geliştirme modunu bozmak

**Doğrulama:** Railway'e deploy sonrası `/api/health` erişilebilir, Electron cloud moda geçebilir.

---

### C-2 — Auth Hardening (Refresh Token + Mobile Session)
**Ön koşul:** C-1  
**Amaç:** Mobil cihazlar günde bir kez login atar; kabul edilemez.

**Yapılacaklar:**
- `refresh_tokens` tablosu migration (id, user_id, token_hash, expires_at, device_id, created_at)
- `POST /api/auth/refresh` endpoint (refresh token → yeni access token)
- `POST /api/auth/logout` endpoint (refresh token iptal)
- Access token TTL: 15 dakika (mobil), 8 saat (desktop — backward compatible)
- Refresh token TTL: 30 gün
- `X-Client-Type: mobile|desktop` header ile ayırt et
- Token storage: mobil için `SecureStore` (React Native), desktop için mevcut `localStorage`

**Yapılmaması:**
- Mevcut desktop auth akışını bozmak
- JWT secret değiştirmek (mevcut session'lar geçersiz olur)

---

### M-1.1 — Mobile-First Waiter Endpoints
**Ön koşul:** C-2  
**Amaç:** Mevcut API desktop-first. Garson telefonunun ihtiyacı olan minimal endpoint seti.

**Yapılacaklar:**
- `GET /api/mobile/tables` — masaları + durum + aktif sipariş özeti
- `GET /api/mobile/tables/:id/order` — masa siparişi detayı
- `POST /api/mobile/orders/:id/items` — kalem ekle
- `GET /api/mobile/categories` — kategori + ürün listesi (mobil optimize)
- `POST /api/mobile/waiter-call` — garson çağırma
- `GET /api/mobile/me` — giriş yapan kullanıcı bilgisi
- Middleware: `X-Client-Type: mobile` header zorunlu
- Response format: sadece mobilde gerekli alanlar (büyük payload'ları küçült)
- `OpenAPI` spec dosyası: `docs/api/mobile-api.yaml` (YAML, elle yazılmış — kütüphane gerekmez)

**Yapılmaması:**
- Mevcut desktop endpoint'lerini değiştirmek
- Tüm API'yi yeniden yazmak (sadece garson iş akışı)

---

### M-1.2 — Device Pairing (QR + device_id)
**Ön koşul:** M-1.1  
**Amaç:** Güvenli cihaz kaydı — her telefon sistemde kayıtlı, yetkisiz erişim engellenir.

**Yapılacaklar:**
- `devices` tablosu migration (id, user_id, business_id, device_name, device_token_hash, platform, last_seen_at, is_active)
- `POST /api/mobile/devices/register` — cihaz kaydı (device_id + user token)
- `DELETE /api/mobile/devices/:id` — cihaz çıkarma (admin)
- `GET /api/admin/devices` — kayıtlı cihaz listesi
- Admin UI'da cihaz listesi sayfası (basit tablo — aktif/pasif, son görülme)
- QR kod ile pairing: admin panelde QR üret → telefon okur → otomatik kayıt
- JWT'ye `device_id` claim ekle (hangi cihazdan geldiği izlenebilir)

---

### M-1.3 — Push Notification (FCM + APNs)
**Ön koşul:** M-1.2  
**Amaç:** Mutfak onayı, yeni sipariş, masa çağrısı gibi olaylar garson telefonuna düşsün.

**Ön koşul (dışarıda):** Firebase projesi kurulumu gerekli (Firebase Console → servis hesabı JSON).

**Yapılacaklar:**
- `firebase-admin` npm paketi (server)
- `devices` tablosuna `push_token` alanı
- `POST /api/mobile/devices/push-token` — token güncelleme endpoint'i
- Bildirim gönderim servisi: `server/services/pushNotificationService.js`
- Tetikleyiciler:
  - Yeni sipariş oluşturulduğunda → garsonlara bildirim
  - Mutfak kalemi hazır olduğunda → masanın garsonuna
  - Masa çağrısı (waiter call) → tüm aktif garsonlara
- Silent push + görünür push ayrımı
- Hata yönetimi: geçersiz token → devices'tan sil

**Yapılmaması:**
- Firebase kurulmadan bu adıma başlamak

---

### M-2 — Android Waiter App (Expo/React Native)
**Ön koşul:** M-1.1, M-1.2, M-1.3  
**Amaç:** Garsonların Android telefonda kullanacağı sipariş alma uygulaması.

**Yapılacaklar:**
- Yeni repo veya monorepo altında `apps/waiter-mobile/`
- **Expo** (managed workflow) — React Native, TypeScript
- Ekranlar:
  - Login (email + şifre, refresh token ile session yönetimi)
  - Masa listesi (renk skala — boş/dolu/bekliyor)
  - Masa detayı + aktif sipariş
  - Ürün/kategori seçimi → kalem ekle
  - Garson çağır butonu
- Socket.io client (gerçek zamanlı masa/sipariş güncellemeleri)
- Push notification entegrasyonu (FCM)
- Offline toast: bağlantı kesilince kullanıcıya uyar
- **Kapsam DIŞI:** ödeme, mutfak yönetimi, yazıcı, ayarlar (bunlar desktop'ta kalır)

**Süreç:** Android önce → 3 ay saha testi → M-3 iOS

---

### M-3 — iOS Waiter App
**Ön koşul:** M-2 stabil (3+ ay saha testi)  
**Amaç:** Aynı Expo uygulamasının iOS derlemesi.

**Yapılacaklar:**
- Expo `eas build --platform ios`
- Apple Developer hesabı + provisioning profile
- APNs push notification sertifikası (Firebase → APNs entegrasyonu)
- TestFlight beta → App Store review
- iOS-specific davranış testleri (background fetch, bildirim izinleri)

---

### O-2 — Tenant Identity (4 ay sonrası)
**Ön koşul:** O-1 ✅, 4 ay pilot tamamlanmış  
**Amaç:** Tek restorandan çok restoranlı yapıya geçiş.

**Yapılacaklar:**
- `tenants` tablosu (id, name, plan, billing_status)
- `businesses` → `tenant_id` ile tenant'a bağlama
- Auth middleware: token'dan tenant_id çözme
- Plan limitleri (max masa sayısı, max kullanıcı, vb.)
- Tenant-aware backup/restore
- Admin super-tenant panel (tüm işletmeler)
- Billing entegrasyonu (iyzico önerilir — TR market)

---

### O-3 — Sync Backbone (O-2 sonrası)
**Ön koşul:** O-2  
**Amaç:** Şubeler arası veri senkronizasyonu + çevrimdışı çalışma.

**Yapılacaklar:**
- Outbox tablosu genişletme (sipariş, ödeme, menü, müşteri)
- Conflict resolution protokolü (last-write-wins + rev_id)
- Edge bridge → cloud websocket/REST sync
- Idempotency-wall tüm mutation endpoint'lerinde

---

### O-4 — Cloud DB + Multi-Tenant Deploy (O-3 sonrası)
**Ön koşul:** O-3  
**Yapılacaklar:**
- SQLite → Postgres geçişi (DB-5: UUID, timestamptz, JSONB)
- Railway/Supabase Postgres
- Tenant RLS
- Socket.io + Redis adapter
- Observability stack (Grafana/Loki/Sentry)
- Staging/production env ayrımı

---

## 4) Gate'ler (Güncel)

### Gate 1 — Local Ürünleşme (Pilot Müşteri)
| Madde | Durum |
|-------|-------|
| 352+ test geçiyor | ✅ |
| Backup/restore production-grade | ✅ |
| First-run wizard | ✅ |
| StoreBridge file log | ✅ |
| Crash reporter (lokal) | ✅ |
| Support bundle UI butonu | ✅ |
| Müşteri kurulum runbook | ✅ |
| Kod imzası | ⏸ Ertelendi (maliyet) |
| Pilot eğitimi + on-site kurulum | ⬜ |

**Durum:** 🟡 Kod imzası ertelendi, kabul edildi. Pilot başlayabilir.

---

### Gate 2 — Online Faza Geçiş (Tek Restoran)
| Madde | Durum |
|-------|-------|
| Numbered migration runner (DB-1) | ✅ |
| Audit trail (DB-2) | ✅ |
| Integer minor unit (DB-3) | ✅ |
| Snapshot tamamlama (DB-4) | ✅ |
| Cloud deployment (C-1) | ⬜ **Sıradaki** |
| Refresh token / mobile auth (C-2) | ⬜ |
| Mobile-first endpoints (M-1.1) | ⬜ |

**Durum:** 🟡 Altyapı hazır, deployment adımı bekliyor.

---

### Gate 3 — Mobil Waiter App
| Madde | Durum |
|-------|-------|
| Gate 2 (cloud backend) | ⬜ |
| Refresh token (C-2) | ⬜ |
| Mobile endpoints (M-1.1) | ⬜ |
| Device pairing (M-1.2) | ⬜ |
| Push notification (M-1.3) | ⬜ |
| Android app build (M-2) | ⬜ |

**Durum:** ❌ C-1 ve C-2 tamamlanmadan başlanamaz.

---

### Gate 4 — Çoklu Şube
| Madde | Durum |
|-------|-------|
| Gate 2 + Gate 3 | ⬜ |
| 4 ay pilot tamamlandı | ⬜ |
| Tenant identity (O-2) | ⬜ |
| Sync backbone (O-3) | ⬜ |

**Durum:** ❌ 4 ay sonrası hedef.

---

## 5) Sıradaki Adımlar (Bağımlılık Sırasıyla)

```
1. C-1  → Railway cloud deployment          [Bu hafta — Codex]
2. C-2  → Refresh token + mobile auth       [C-1 sonrası — Codex]
3. M-1.1 → Mobile waiter endpoints + OpenAPI [C-2 sonrası — Codex]
4. M-1.2 → Device pairing (QR + device_id)  [M-1.1 sonrası — Codex]
5. M-1.3 → Push notification (FCM/APNs)     [Firebase kurulumu gerekli — Manuel + Codex]
6. M-2   → Android waiter app (Expo)        [M-1.1 sonrası başlanabilir — Codex]
7. M-3   → iOS waiter app                   [M-2 + 3 ay saha sonrası]
────────────────────────────────────────────────────────────────
8. O-2   → Tenant identity (4 ay sonrası)
9. O-3   → Sync backbone
10. O-4  → Cloud DB + full multi-tenant
```

---

## 6) Yapılmaması Gerekenler

| Yapılmaması gereken | Neden |
|---------------------|-------|
| SQLite → Postgres şimdi | Tek restoran için gerekmez; O-3/O-4'e kadar ertele |
| Multi-tenancy şimdi | 4 aylık pilot tek işletme; O-2 zamanı gelince yap |
| Tam UI redesign | Design system olmadan redesign = yeniden redesign |
| Yemeksepeti/Getir entegrasyonu | Outbox + OpenAPI olmadan başlama |
| Loyalty/kampanya modülü | Para modeli tam oturmadan puan/iade kaçağı riski |
| M-2/M-3 C-1 olmadan | Cloud backend olmadan mobil app anlamsız |
| Push notification Firebase olmadan | Dış bağımlılık; kurulum gerektirir |
| Kod imzası şimdi | Maliyet yüksek; ertelendi |
| 2FA/MFA şimdi | Karmaşıklık/değer oranı kötü şu aşamada |

---

## 7) Teknik Borç (Düşük Öncelikli, Bloklamıyor)

| Borç | Risk | Çözüm zamanı |
|------|------|-------------|
| `admin.js` ~2300 satır | Yeni özellik eklemek zorlaşıyor | O-2 öncesi domain split |
| `OrderScreen.jsx` ~1600 satır | React hook extraction adım adım devam | Her sprint 1 dosya |
| `TablesScreen.jsx` ~1550 satır | `useTablesData`, `TakeawaySidebar`, `TableCard` extraction | O-2 öncesi |
| Frontend component test = 0 | Mobil app için kritik | M-2 ile paralel başla |
| `_cents` primary source değil | REAL sütunlar hâlâ read path'te | O-3 öncesi cutover |
| Refresh token yok | Sadece desktop'ta sorun değil | C-2 ile çözülüyor |

---

## 8) Mimari Hedef (4 Ay Sonu)

```
┌─────────────────────────────────────────┐
│           Railway Cloud Server          │
│   Express + SQLite + Socket.io          │
│   (USER_DATA_PATH=/data, PORT=env)      │
└──────┬──────────────┬───────────────────┘
       │              │
       │              │
┌──────▼──────┐  ┌────▼────────────────────┐
│  Electron   │  │  Waiter Mobile App      │
│  (Windows)  │  │  (React Native / Expo)  │
│  Thin client│  │  iOS + Android          │
│  → cloud URL│  │  Push: FCM + APNs       │
└─────────────┘  └─────────────────────────┘
```

**Veri akışı:** Her iki client da aynı Railway backend'e bağlanır. Socket.io üzerinden gerçek zamanlı. Ana bilgisayar kapalı olsa mobil çalışmaya devam eder.

---

*Bu rapor v1 (2026-04-17) raporunun güncellenmiş halidir. v1 arşiv olarak `docs/audit/master-productization-report.md`'de korunmaktadır.*  
*Son güncelleme: 2026-04-18 · Test sayısı: 352 · Lint: 0 warning*
