# Master Productization Report — Restoran POS v3

**Tarih:** 2026-04-17
**Kapsam:** Tüm katmanlar (ürün, UX, frontend, backend, DB, entegrasyon, desktop, test, operasyon, güvenlik) + online/cloud ve mobil genişleme fizibilitesi.
**Rol:** CTO · Principal Architect · Product Strategist · Mobile Consultant · DB Architect · Release/Program Lead.
**Yöntem:** Kanıta dayalı. Repo/gercek dosya boyutları, test sayımları, mevcut audit raporları (00–11), git history, CLAUDE.md ve runbook'lar doğrudan alındı.
**Bu raporun sınırı:** Kod değiştirilmedi. Refactor yapılmadı. Yalnızca analiz, kanıt toplama ve yol haritası üretimi yapıldı.

---

## 1) Yönetici Özeti

### Bugünkü gerçek seviye

Restoran POS v3 bugün **“çalışan, küçük/orta restoranda işlem görebilecek olgunlukta bir Windows masaüstü POS çekirdeği”** seviyesindedir. Ürün seviyesi olarak **v1 sonu — v1.1 öncesi**, profesyonel ürün olarak **“ticari lansmana şartlı hazır”**dır. Sahada canlı kullanıma çekilebilir ancak 1 işletme > 3 kasa > 3 yazıcı + çok kullanıcılı senaryoda kırılma noktalarına sahiptir.

- **Çekirdek POS akışları (masa → sipariş → ödeme → mutfak → yazıcı) çalışıyor** ve 318 otomatik test ile doğrulanmış.
- Paketleme, backup/restore, JWT, log dosyası, güvenlik maskelemesi, error boundary ve auto-update gibi **release disiplini sprint 9–12 boyunca ciddi biçimde sertleştirilmiş**.
- **Ama profesyonel ticari ürün değil.** UI/UX dağınıklığı, monolitik ekranlar, tek dosyalık migration, REAL para alanları, kod imzası yokluğu, CI/CD yokluğu, frontend test eksikliği, onboarding/first-run wizard yokluğu, sadece Windows/tek cihaz modeli üzerine kurulu.
- **Online’a hazır değil.** Bugünkü mimari “tek kasa + lokal SQLite + local bridge” varsayımı üzerine kurulu. Multi-tenant identity, conflict resolution, outbox disiplini, event-sourcing/audit trail, realtime scale, cihaz eşleştirme, subscription/billing, operasyon izleme yok.
- **Mobil’e hazır değil.** Mevcut ekranlar desktop-first; mobilde karşılığı olmayan yoğunluk, modallar, klavye bağımlı akışlar taşıyor. Backend’de henüz "mobil istemciye göre şekillenmiş" bir API değil, POS ekranına göre şekillenmiş bir API var.

### Güçlü tarafları

- Sipariş–ödeme–mutfak–yazıcı zinciri end-to-end çalışıyor ve **bu sınıf projelerde nadir görülen 99 senaryoluk orderLifecycle entegrasyon testine sahip**.
- Yazdırma mimarisi doğru kurulmuş: **outbox + StoreBridge pull + lease-based claim + idempotency_key + structured error codes**. Bu, saha yazıcı sorunlarında altın değerinde.
- Backup/restore, Sprint 12 sonunda **meta.json + SHA-256 + integrity check + safety revert + uploads + pos-config snapshot + schtasks entegrasyonu** ile piyasada gördüğün tek kişilik projelerin üstünde.
- JWT secret persistency, BRIDGE_TOKEN maskeleme, err.message sızıntısının kapatılması, login_failed audit log, userData veri politikası — **güvenlik temeli kıvamında**.
- Paketleme: CallerID self-contained win-x64, extraResources disiplini, `desktop:preflight`, smoke health test, better-sqlite3 ABI rebuild — **desktop ürünleşme disiplini ciddi**.

### En büyük riskler

1. **Tek kişi projesi dağınıklığı:** kritik dosyalar (OrderScreen 1605, TablesScreen 1551, electron/main 1632, admin route 2275, orders route 1231 satır) monolitikleşmiş; yeni özellik her bakımda risk alanı.
2. **Veri modeli seviye atlamamış:** tek migration dosyası (35 `CREATE TABLE` + migration yamaları, 959 satır), REAL para alanları, snapshot stratejisi yarım, ON DELETE politikası net değil, integer minor unit (kuruş) yok.
3. **Frontend test boşluğu:** 318 test backend’de, frontend’de **0 unit/component testi**; en kırılgan alanlar (OrderScreen, PaymentScreen, PrinterDetailPage) test dışı.
4. **Online’a geçiş için temel yok:** business_id kolonu “multi-tenant hazır” değil — multi-tenant identity, RBAC, plan/subscription, audit trail, outbox sync, conflict resolution, secret rotation, idempotency-wall yok.
5. **Operasyon izlenebilirliği yetersiz:** Electron log dosyası var, ama merkezi uzak log, telemetry, crash reporting, sürüm/sürüm başına hata istatistiği yok.
6. **Mobil boyut yanlış:** mevcut ekranlar küçük ekrana portlanamaz; mobil için ayrı API sözleşmesi, ayrı ekran tasarımı, ayrı auth akışı gerekir.
7. **Kod imzası yok:** SmartScreen uyarısı her yeni müşteri kurulumunda "IT çağırma" momenti yaratır.
8. **CI/CD yok:** her release developer makinesine bağlı; Sprint 9'daki iconv-lite packaging bug’u tekrar yaşanabilir.

### Profesyonel ürüne yakınlık

- **“Çalışır POS”**: 9/10 ✅
- **“Tek restorana satılabilir ürün”**: 7.5/10 🟡 (3 şart: kod imzası, first-run wizard, kurulum destek modeli)
- **“Birden fazla restorana ölçeklenebilir ürün”**: 4/10 ❌
- **“Online/cloud SaaS dönüşümü mümkün ürün”**: 3/10 ❌
- **“iOS/Android native uzantısı olan ürün”**: 2/10 ❌

### Net karar

> **ŞARTLI HAZIR — yalnızca "kontrollü pilot müşteri" ve "tek restoran lokal kurulum" senaryosunda.**
> **HAZIR DEĞİL — multi-restoran, çok şubeli, çok kasalı, online, mobil veya SaaS senaryolarında.**

Karar özeti: **lokal ürünleşme için son 10 metre**, **online için baştan omurga kurulması gerek**, **mobil için henüz vakit değil**.

---

## 2) Current State / Mevcut Durum

### 2.1 Ürün Kapsamı

| Alan | Durum | Kanıt |
|---|---|---|
| Masa, sipariş, ödeme, mutfak, takeaway | ✅ Oturmuş | `server/routes/orders.js`, `payments.js`, `tables.js`, `client/src/components/**` |
| Müşteri, çağrı eşleştirme | ✅ Oturmuş | `server/routes/customers.js`, `callerid.js`, `server/services/callerIdService.js` |
| Raporlar, grafikler | ✅ Çalışıyor | `server/routes/reports.js`, `ReportsScreen.jsx` (859 satır) |
| Rezervasyon | 🟡 Temel var | `server/routes/reservations.js` basit CRUD, UI 269 satır |
| Stok / inventory | 🟡 Temel var | Stok hareketi ve low-stock; gelişmiş tedarik/maliyet yok |
| Yazıcı + Bridge + CallerID | ✅ Oturmuş | outbox + lease + error codes + self-contained helper |
| Rol/erişim | ✅ Temel var | Admin/Kasiyer/Garson/Mutfak, ancak granular permissions yok |
| Multi-tenant | ❌ **Sadece kolon seviyesinde** | `business_id` her tabloda var ama tek işletme varsayımıyla çalışıyor |
| Multi-branch | ❌ Şema hazır, işleyiş yok | `branches` tablosu var, UI/flow yok |
| Loyalty, promosyon | ❌ Yok | - |
| Online sipariş (Yemeksepeti/Getir) | ❌ Yok | CLAUDE.md v2 roadmap |
| Müşteri self-service | ❌ Yok | Sadece waiter call QR |

### 2.2 Kullanıcı Deneyimi

- **Türkçe UI, tutarlı dil.** ConfirmDialog standartlaştırılmış; window.confirm yasaklı.
- **Masa occupancy color scale, mutfak age warnings, receipt templates, inline customer search** gibi sahada işe yarayan detaylar oturmuş.
- **Ama**: ekran mimarisi **“her ekran kendi state’ini, kendi fetch’ini, kendi error handling’ini kendi içinde yönetiyor”** tarzında. Yükleme skeleton’ı, boş ekran hali (empty state), offline uyarısı, hata recovery gibi premium ürün detayları yok.
- **First-run wizard yok.** Yeni müşteri kurulumu manual.
- **Toast.warning** eklendi (Sprint 11), ama UX katmanında tutarlı hata taksonomisi yok.
- **Dokunmatik uyumluluk kısmi:** butonlar büyük, ama tablet/telefon boyutunda kullanılamaz.

### 2.3 Frontend

- React 18 + Vite, TypeScript yok (saf JS + JSX).
- Route lazy-loading yapılmış (Sprint 10, 948kB → 265kB).
- Global state: AuthContext, ToastContext, SocketContext, IncomingCallContext — query/cache layer yok (`react-query` veya benzeri yok).
- **Monolitik ekranlar** (güncel ölçüm, Sprint 12 sonrası):

| Dosya | Satır | Yorum |
|---|---:|---|
| `client/src/components/orders/OrderScreen.jsx` | **1605** | Sprint 10 raporunda 1428'di; artıyor. |
| `client/src/components/tables/TablesScreen.jsx` | **1551** | Takeaway sidebar + masa grid + transfer + socket + poll tek yerde. |
| `client/src/components/settings/MenuSettingsPage.jsx` | 958 | |
| `client/src/components/reports/ReportsScreen.jsx` | 859 | |
| `client/src/components/settings/PrinterDetailPage.jsx` | 854 | |
| `client/src/components/payments/SplitPaymentModal.jsx` | 723 | |
| `client/src/components/settings/MenuProductEditorPage.jsx` | 654 | |
| `client/src/components/payments/PaymentScreen.jsx` | 569 | |

- **Frontend test: 0 bileşen testi.** `server/tests/frontend/storeBridgeClientMappings.test.js` yalnızca mapping utility.
- **ESLint:** `lint:ci --max-warnings 0` CI gate’te; ancak audit 11'deki 29 uyarı (18 `react-hooks/exhaustive-deps` dahil) CLAUDE.md'e göre sıfırlanmış; bunu doğrulamak için `npm run lint:ci` çalıştırılmadı bu raporda (değişmediyse hâlâ kırılma riski).

### 2.4 Backend / API

- Express + Zod + better-sqlite3, route-based organizasyon.
- 138 route handler (grep `router.(get|post|put|patch|delete)`).
- **Monolitik route/admin dosyaları** (güncel ölçüm):

| Dosya | Satır |
|---|---:|
| `server/routes/admin.js` | **2275** |
| `server/routes/orders.js` | **1231** |
| `server/migrations/run.js` | 959 |
| `server/services/printJobs.js` | 678 |
| `server/routes/customers.js` | 569 |
| `server/routes/payments.js` | 552 |
| `server/routes/bridge.js` | 536 |

- **Domain service ayrımı yarım:** `orderActionPolicy`, `orderPaymentState`, `printJobs`, `printRouting`, `printerAutoPrintPolicy`, `callerIdService` var. Order/payment **ana iş kuralları hâlâ route dosyalarında**.
- **Transaction kullanımı var ama yan etkiler (mutfak finalize, print job, customer stats) transaction dışında.** Bu Audit 04'te P1 risk olarak işaretlenmiş.
- **Idempotency:** payments.idempotency_key, print_jobs.idempotency_key var. Tam ödeme endpoint'inde balance overflow koruması eksik (Audit 04 §2.5).

### 2.5 Veritabanı

- `better-sqlite3` WAL + FK ON + busy_timeout=5000.
- **Tek migration dosyası**, `server/migrations/run.js` 959 satır, 35 `CREATE TABLE` + kolon ekleme + backfill + recreate aynı dosyada.
- **Snapshot stratejisi yarım:** `order_items` product/price snapshot alıyor, kategori/yazıcı hedef snapshot sprint 10'da eklendi. `orders` masa/kullanıcı/müşteri adı snapshot alanları eklendi.
- **Para alanları REAL.** Integer minor-unit (kuruş) yok.
- **CHECK constraint'leri yeni kurulumda var, eski DB'lere uygulanmadı** (recreate riski).
- **ON DELETE politikası homojen değil.**
- **Audit trail yok.** `audit_logs` tablosu sadece `login_failed` için kullanılıyor; para/sipariş/ürün değişiklikleri audit trail'de değil.
- **Çok kiracılı (multi-tenant) yapı yok:** tüm tablolarda `business_id` var ama tek işletme kurulumu dışında test edilmemiş.

### 2.6 Entegrasyonlar

- **Yazıcı outbox pattern:** doğru, sprint 10'da lease + ownership guard + manual retry + error codes eklendi. Audit 06 P1 kapatılmış.
- **CallerID:** C# SDK helper .NET 8 self-contained win-x64. Fallback: clipboard listener. POST retry + duplicate ringing guard.
- **Socket.io:** kitchen, table, takeaway real-time. Polling mimarisinden çıkılmış (Sprint 6).
- **Harici entegrasyon yok:** Yemeksepeti, Getir, iyzico, ödeme POS terminali, muhasebe, e-belge, Logo/Mikro yok.
- **Webhook katmanı yok.**

### 2.7 Electron / Desktop Shell

- `electron/main.cjs` **1632 satır** — config, JWT üretimi, DB taşıma, backend process, bridge process, CallerID helper, pencere, backup scheduler hepsi bir arada.
- `extraResources`, `better-sqlite3` rebuild, smoke tests, preflight — **disiplinli**.
- Portable + NSIS build.
- `userData` yolu doğru kullanılıyor (pos.db, uploads, backups, pos-config, logs).
- **Auto-update:** electron-updater + GitHub Releases + `latest.yml` (Sprint 11). SmartScreen uyarısı hâlâ var (kod imzası yok).

### 2.8 Test Kalitesi

| Kapsam | Adet |
|---|---:|
| Toplam test dosyası (server) | 24 (integration: 11, unit: 12, frontend: 1) |
| Toplam test (it) | **318** |
| Playwright e2e | 2 dosya (table-order-payment-close, takeaway-order) |
| Frontend unit/component test | **0** |
| CallerID hardware-in-the-loop | 0 |

Backend güveni yüksek. Frontend güveni düşük. **"318 test" rakamı backend açısından güçlü; ama ürünün React tarafı test dışı."**

### 2.9 Deployment / Release

- **dist:release = dist:win + gen-update-meta** (latest.yml).
- **CI/CD YOK.** Her release developer makinesinden çıkıyor.
- **Kod imzası yok.**
- **`pos-config.json` gitignore'da** (JWT secret leak önlendi).
- Release artifact'ı: NSIS Setup + Portable `.exe`.

### 2.10 Operasyon Güveni

- Electron persistent log var (userData/logs/electron-main.log).
- StoreBridge için ayrı log dosyası **yok**.
- Crash reporter yok (Sentry, Rollbar vb. yok).
- Merkezi uzak log toplama yok.
- Sürüm analitiği yok.
- Müşteri bazlı telemetry yok.

### 2.11 Bakım Yapılabilirlik

- Dokümantasyon disiplini **güçlü**: 11 audit raporu, 4 runbook, regression checklist, CLAUDE.md.
- Kod dokümantasyonu (JSDoc, README per module) düşük yoğunluklu.
- Arkeolojik kod yok, legacy şim minimum.
- **Tek büyük zayıflık: monolitik dosyaların her yeni sprintte büyüyor olması.**

---

## 3) Completed Work / Tamamlanmış İşler

### 3.1 Tam oturmuş (production-grade)

**Çekirdek POS akışları**
- Masa grid + occupancy + transfer
- Sipariş oluşturma, kalem ekleme, modifier, portion, not
- Ödeme (cash/card/split/mixed), quick amount, discount, change
- Takeaway: müşteri ara/oluştur, adres yönet, ayrı akış, teslim sonrası otomatik kapanış
- Mutfak ekranı: item-level preparation, age warning (10/20 dk)
- Receipt & kitchen print: 4 template, 48 karakter, PC857

**Yazıcı & Bridge**
- Outbox pattern (print_jobs)
- Lease-based claim + claim ownership guard
- Idempotency key
- Structured error codes (16 kod)
- Manual retry
- PC857 + Win1254 encoding, skipInit per-printer
- StoreBridge API timeout + health retry + circuit breaker

**CallerID**
- .NET 8 self-contained win-x64 primary
- Clipboard fallback (PowerShell)
- Bounded POST retry
- Duplicate ringing guard
- Reconnect

**Güvenlik**
- JWT secret persist (userData/pos-config.json)
- BRIDGE_TOKEN masking
- err.message removed from 500 responses
- login_failed audit log
- Password min-length guard
- CORS hardening
- Rate limiting (auth/admin/bridge/printer)

**Backup/Restore (Sprint 12)**
- Uploads + pos.db + pos-config snapshot
- meta.json (appVersion, schemaVersion, rowCounts, integrityCheck, sha256)
- Open-order warning pre-restore
- Two-step restore modal
- SHA-256 hash verification + safety revert
- External export/import
- Disk-space pre-check
- Windows Task Scheduler integration (robocopy 03:00)

**Release infra**
- dist:prepare chain
- better-sqlite3 ABI rebuild
- Smoke tests (server-health, electron-sqlite)
- desktop:preflight (8/8 check)
- CallerID helper build
- extraResources packaging
- latest.yml auto-generation
- ErrorBoundary
- Bridge max-restart (circuit breaker)

### 3.2 Çalışıyor ama kırılgan

- **OrderScreen / TablesScreen / PaymentScreen** — iş yapıyor, test yok (frontend), her değişiklik regression riski.
- **electron/main.cjs (1632 satır)** — her süreç (backend/bridge/callerid/backup-scheduler) tek dosyada; yeni feature eklemek riskli.
- **server/routes/admin.js (2275 satır)** — admin endpoint'leri büyümüş monolitik bir “her işe yarayan” dosya.
- **migrations/run.js (959 satır)** — idempotent ama her yeni alan tek dosyaya yazılıyor; numbered migration runner yok.
- **Rate limiting** — devrede ama sahada gerçek yük test edilmedi.
- **Auto-update** — latest.yml var ama SmartScreen + kod imzası yokluğu update deneyimini bozar.
- **Rezervasyon** — CRUD var, operasyonel entegrasyon (masa ile bağ, no-show, overbooking guard) eksik.
- **Stok** — hareket + low-stock alert var; maliyet, tedarik, reçete bazlı düşüm yok.
- **Raporlar** — çalışıyor, ama sürüm disiplini (period lock, close-of-day, X/Z report) yok.

### 3.3 Yarım ama temel atılmış

- **Multi-tenant izolasyon** — `business_id` her tabloda var; gerçek multi-tenant identity/billing/plan yok.
- **Multi-branch** — `branches` şema hazır, UI/flow yok.
- **Combo menu** — `product_combos` tablosu var, UI basit; gelişmiş kombinasyon kuralı yok.
- **Advanced order analytics** — top 10 product, peak hours var; cohort, müşteri LTV, katkı marjı yok.
- **Customer 360** — temel var; CRM segmentasyonu, kampanya yok.

---

## 4) Missing Work / Eksik İşler

### 4.1 Kritik (ürünleşme öncesi)

| Sorun | Etki | Öncelik | Ön koşul |
|---|---|---|---|
| **Kod imzası (Windows)** | SmartScreen uyarısı, IT-olmayan müşteride kurulum takılır | P1 | Pilot lansmandan önce |
| **First-run setup wizard** | Manual kurulum, satış sırasında sürtünme | P1 | Pilot lansmandan önce |
| **CI/CD pipeline (GitHub Actions)** | Sprint 9 tarzı paketleme bug'ı tekrar eder; tek kişi hataya açık | P1 | Düzenli release'den önce |
| **Frontend test katmanı** | OrderScreen, PaymentScreen regression rulet oynuyor | P1 | Büyük refactor'dan önce |
| **StoreBridge dosya logu** | Field support'ta sadece Electron log, bridge ayrı işlem | P2 | Pilot lansmandan önce |
| **Sürüm notları + changelog disiplini** | Müşteri neye güncelleme aldığını bilmiyor | P2 | Auto-update açılmadan önce |

### 4.2 Ürün eksikleri

- X/Z raporu ve gün sonu kapanış (period close) — vergi/mali uyum için önemli
- e-belge (e-Arşiv / e-Fatura / e-SMM) — Türkiye'de yasal gereklilik olabilir (cironun üzerinde)
- Ödeme POS cihazı entegrasyonu (Paycell, PosNet, Asseco, Token, Ingenico SDK)
- Personel zaman takibi (giriş/çıkış, vardiya)
- Tip (bahşiş) yönetimi
- Paket servis kurye paneli (kurye atama, rota, taksit)
- Masa rezervasyonu ile oturma planı bağlantısı
- Menü fiyat versiyonlama / happy hour
- Çoklu vergi oranı / KDV ayrıştırma (yemek/içecek)
- Return / iade akışı (post-payment iade)
- İstek listesi (adisyon adı, garson ayırıcı, bölünmüş ekran)

### 4.3 Teknik eksikler

- **Numbered migration runner + schema_migrations tablosu**
- **Para alanlarında integer minor unit (kuruş)**
- **Domain service katmanı**: orders, payments, kitchen, print — route'tan ayrıştırma yarım
- **Event bus / domain event modeli** (özellikle online/cloud geçişte kritik)
- **Outbox pattern'in yalnız yazıcıda değil tüm dış tetiklemelerde uygulanması** (sms, webhook, mail, integration)
- **Structured logging (JSON line)**
- **Error taksonomisi (domain error code → UI Türkçe dictionary, printer için var ama iş kurallarında yok)**
- **API client domain split (api.js → orders/payments/tables/customers modülleri)** — `api/core.js` başlamış, devam etmemiş
- **OpenAPI / API sözleşmesi yok** (mobil ve 3rd party için şart)

### 4.4 Güvenlik eksikleri

- Password rotation, lockout (5 başarısız denemeden sonra geçici kilit — login_failed log var ama reaktif değil)
- 2FA / MFA (admin için)
- Session timeout / refresh token (şu an JWT 24h, refresh yok)
- Secret rotation (JWT secret bir kere üretiliyor, rotate yok)
- Audit trail (login dışı event: ürün fiyat değiştirme, rol değişikliği, fiş silme, ödeme iptali — hiç yok)
- GDPR/KVKK: müşteri silme, veri export, rızaya dayalı işleme akışı yok
- Hardening: Helmet var ama CSP tam değil

### 4.5 Operasyon eksikleri

- Uzak crash reporter (Sentry vb.)
- Merkezi log agreg (Loki / Elastic / CloudWatch)
- Uptime monitor
- Sürüm başına error rate
- Müşteri başına telemetry (opt-in)
- Incident runbook (genel çalışmıyor, yazıcı kördümen, POS crash, backup fail)
- Support bundle (Sprint 11'de GET /admin/support-bundle başlamış — müşterinin UI'dan indirmesi için son adım yok)

### 4.6 Online öncesi eksikler

- Çok kiracı (multi-tenant) identity + plan modeli
- Subscription/billing (Stripe vb.)
- Tenant-aware rate limiting
- Tenant-aware backup/restore
- Outbox sync + offline-first queue
- Conflict resolution (aynı masaya iki cihazdan sipariş)
- Realtime scale (Socket.io node cluster + redis adapter)
- Edge/local bridge → cloud backbone
- E-commerce grade audit trail (tüm mutasyonlar)
- Data residency / KVKK (TR'de veri bulunma zorunluluğu)

### 4.7 Mobil öncesi eksikler

- REST/GraphQL sözleşmesi stabil değil — mobil-first API tasarımı yok
- Cihaz kaydı / pairing (QR ile) yok
- Push notification backbone yok (APNs / FCM)
- Mobil auth akışı (OAuth device flow / magic link) yok
- Mobil ekran varyasyonları: küçük ekrana uygun order screen, kitchen screen, reservation — hiçbiri yok
- Offline queue (mobilde lokal sipariş → online olunca sync) yok
- Tap-to-pay / Bluetooth yazıcı / Bluetooth kasa entegrasyonu yok

### 4.8 Profesyonel ürünleşme öncesi eksikler

- Design system / component library (storybook vb.)
- Accessibility (WCAG AA) — kontrast, keyboard navigation, aria
- i18n / l10n (şu anda sabit Türkçe)
- Onboarding deneyimi (kurulum wizard, örnek veri, eğitim modu)
- In-app help / tooltip disiplini
- Release notes / changelog UX
- Customer-facing documentation
- Eğitim materyali (video, PDF, interaktif tur)
- Destek portalı / ticket sistemi
- SLA tanımı
- Sürüm destek politikası (3 ana sürüm geriye destek vb.)
- Marka tutarlılığı (logo, favicon, about dialog, splash)

---

## 5) Strengths / Güçlü Yönler

**Ürün çekirdeği**
- Çok senaryolu sipariş akışı + item lifecycle + modifier/portion zaten çalışıyor ve test edilmiş.
- Takeaway ve dine-in akışı net ayrılmış.
- Receipt template disiplini (4 tip, 48 char, PC857) yerli POS ürünlerinde nadirdir.

**Operasyonel avantajlar**
- Yazıcı outbox + StoreBridge pull modeli doğru mimari. Saha arızalarında POS akışı durmaz.
- Günlük automatic backup + Windows Task Scheduler + SHA-256 + integrity check + safety revert — **çok ciddi bir “local-first” güvence.**
- userData veri politikası doğru (Program Files EPERM gibi tuzakları geçmiş).
- JWT persistence sahada kurulumu kolaylaştırıyor.

**Teknik iyi kararlar**
- Electron'da backend'i ELECTRON_RUN_AS_NODE ile koşmak → sistem Node bağımlılığı yok.
- Socket.io'yu erken entegre etmek (mobil/online'da yeniden kullanım için).
- `orderActionPolicy` + `orderPaymentState` gibi pure function / policy katmanı — doğru mimari yön.
- `api/core.js` separation — doğru yönde kesim.
- 16-kod ESC/POS error dictionary — field support'u mümkün kılan tür.
- audit disiplini — 11 audit raporu + her sprint sonrası “uygulanan hardening” listesi — **bu tek kişi projesinde olağanüstü.**

**Gelecek için omurga**
- Outbox pattern — cloud sync'e doğrudan adapte edilebilir.
- Idempotency key disiplini — multi-device sync için hazır.
- Zod validation — API contract oluşturmak için sağlam taban.
- Socket.io + event subscribe — realtime bus'a evrimleştirilebilir.
- business_id her tabloda — multi-tenant'a geçişte yeniden adlandırma yükü düşük.

---

## 6) Weaknesses / Zayıf Yönler

**Tek kişilik geliştirme izleri**
- Her sprint yeni feature ekliyor; **monolitik dosyalar küçülmüyor, büyüyor.** OrderScreen 1428 → 1605. electron/main 860 → 1632. admin 2275. Bu bir alarm.
- Test disiplini backend'e yapışmış; frontend regressionu kullanıcıya gidiyor.
- Refactor kararları ertelenmiş (audit 00a-03'te adı konmuş ama uygulanmamış).

**Modülerlik sorunları**
- `server/routes/orders.js` ve `payments.js` hâlâ domain service ayrımı yapılmamış (Audit 11 P2).
- `api.js` domain split başlamış, bitmemiş.
- `electron/main.cjs` sub-module'lere ayrılmamış.

**Ürünleşmeyi engelleyen alanlar**
- First-run wizard yok → satış sırasında kurulum sürtünmesi.
- Kod imzası yok → müşteri IT veya “yine de çalıştır” butonuna mahkum.
- CI/CD yok → release her seferinde riskli.
- Onboarding, eğitim, help, customer docs yok.

**Görsel/UX dağınıklığı**
- Empty state, skeleton loader, offline banner, error toast disiplini kısmi.
- Design token var ama component library yok.
- Yazıcı ayar ekranı 854 satır, bilgi yoğunluğu yüksek, adım adım olmayan bir form.

**Veri ve operasyon riskleri**
- REAL para alanları + merkezi `round2`. Test'te split payment tolerance'ı geçiyor; ama finansal sistem kalitesi değil.
- Audit trail yok → fiş silme, sipariş iptali, fiyat değişikliği kim ne zaman yaptı belli değil.
- Numbered migration yok → hangi kurulumda hangi şema var belirsizleşebilir.
- Tek kişiye bağımlılık: bug fix + feature + release + destek + dokümantasyon tek insan.

---

## 7) Readiness Scorecard

| Alan | Puan | Gerekçe (tek cümle) |
|---|---:|---|
| Ürün netliği | 7/10 | Çekirdek akışlar net; rezervasyon/stok/multi-branch yarım. |
| Kullanıcı deneyimi | 6/10 | Tutarlı ama amatör, empty state/onboarding/help eksik. |
| Frontend mimarisi | 5/10 | Lazy-loading iyi, ama monolitik ekranlar ve 0 frontend testi. |
| Backend/API olgunluğu | 7/10 | 318 test + Zod + transaction iyi; route'larda domain ayrımı yok. |
| Veritabanı tasarımı | 5/10 | WAL+FK iyi; tek migration dosyası, REAL para, audit trail yok, snapshot yarım. |
| Entegrasyonlar | 7/10 | Yazıcı outbox + CallerID sağlam; harici entegrasyon yok. |
| Masaüstü ürünleşme | 7/10 | Paketleme disiplinli; imza + wizard eksik. |
| Test kalitesi | 6/10 | Backend güçlü, frontend 0. |
| Operasyon güveni | 5/10 | Yerel log var; uzak log/crash reporter/uptime yok. |
| Güvenlik | 7/10 | Temel iyi; 2FA/audit/secret rotation yok. |
| Loglama/izlenebilirlik | 5/10 | Electron log var; bridge log yok; telemetry yok. |
| Online/cloud hazırlığı | 3/10 | Outbox hazır, ama tenant/billing/conflict/queue/scale yok. |
| iOS hazırlığı | 2/10 | API ve ekran mobil-first değil. |
| Android hazırlığı | 2/10 | Aynı. |
| Profesyonel ürünleşme seviyesi | 5.5/10 | Ticari ürün olmak için onboarding, destek, marka, ekosistem eksik. |

**Genel Productization Score: 5.6 / 10** (CLAUDE.md'deki 9.2'lik puan repo iç değerlendirmesi; ticari ürün standardı ile kıyaslandığında 5–6 bandındadır.)

---

## 8) Productization Gap

**“Çalışan POS”** ile **“profesyonel ticari POS ürünü”** arasındaki gerçek boşluk:

| Boyut | Bugün | Ticari standart | Gap |
|---|---|---|---|
| Onboarding | Manual kurulum + demo kredinti | First-run wizard + sample data + tutorial | Büyük |
| Kurulum | NSIS/Portable + PowerShell runbook | İmzalı MSI + tek tıkla kurulum + müşteri özelinde config | Orta |
| Destek | Yok | Ticket sistem + SLA + remote diag | Büyük |
| Hata mesajları | Printer için 16 kod, diğerinde serbest metin | Tüm domain'de error code → Türkçe dictionary | Orta |
| Bakım | Tek kişi + runbook | Dokümante edilmiş destek prosedürü + uzaktan tanı | Büyük |
| Dokümantasyon | Mühendis dokümanı (audit/runbook) iyi, müşteri dokümanı yok | Kullanıcı kılavuzu + video + knowledge base | Büyük |
| Release disiplini | dist:release tek komut; CI yok | CI/CD + signing + staging → prod | Orta-büyük |
| Tasarım sistemi | CSS tokens | Storybook + component library + a11y | Orta |
| Yönetim ekranları | Kategorili ama dağınık | Admin dashboard + sistem sağlığı + kullanım istatistiği | Orta |
| Operasyonel güven | Yerel log | Uzak log + telemetry + crash reporter + uptime | Büyük |

---

## 9) Online / Cloud Geçiş Analizi

### 9.1 Bu proje online'a geçirilebilir mi?

**Evet, ama doğrudan değil.** Bugünkü kod mimari olarak "tek işletme, tek kasa, yerel SQLite" varsayımı üstüne kurulu. Doğrudan cloud-first çekmek = yeniden yazma. Aşamalı hibrit evrim = doğru yol.

### 9.2 Cloud-first mi, hibrit mi?

**Cloud-first mantıklı değil.** Sebepler:
- Yazıcı bir **lokal zorunluluk**. ESC/POS cihazlar internetsiz de çalışmalı (servisin durmaması müşteri için hayati).
- CallerID donanımı USB HID — local bridge şart.
- Saha bağlantısı Türkiye'deki küçük restoranda güvenilir değil; offline-first tek gerçekçi yaklaşım.
- Müşteri verisi KVKK ile yerel rezidans zorunluluğu doğurabilir.

**Doğru mimari yön: Local-first + Cloud backbone (hibrit).**
- Çekirdek POS lokal çalışmaya devam eder.
- `outbox` mevcut yapıdan cloud-sync outbox'a evrilir.
- Cloud omurgası: tenant identity + subscription + merkezi raporlama + multi-device sync + mobil istemci.
- Edge bridge (bugünkü StoreBridge) cihaz köprüsü olarak kalır.

### 9.3 Alternatifler ve seçim

| Alternatif | Artı | Eksi | Karar |
|---|---|---|---|
| A) Cloud-first SaaS (yeniden yaz) | Temiz başlangıç, ölçek kolay | Lokal uptime riski, 6–12 ay yatırım, mevcut değer sıfırlanır | ❌ Erken ve hatalı |
| B) Pure local desktop (hibrit atlanır) | Hızlı, mevcut kod | Ölçek yok, multi-branch imkansız | 🟡 Sadece küçük pazar için |
| C) **Local-first + Cloud backbone (hibrit, aşamalı)** | Mevcut değer korunur, lokal uptime korunur, ölçeklenebilir | Karmaşık sync/conflict mühendisliği | ✅ **Doğru yön** |
| D) Firebase/Supabase offline-sync üzerine | Kodun çoğu korunabilir | Vendor lock-in, özel ihtiyaçlarda darbe | 🟡 Küçük/orta ölçekte mantıklı |

### 9.4 Kritik riskler

- Senkron kaybı (aynı siparişe iki cihazdan müdahale).
- Şemanın cloud ile uyumsuzluğu (REAL para, tek migration dosyası).
- Audit trail yokluğu — cloud'da mutasyon kaydı şart.
- Tenant isolation gerçek değil (sadece kolon).
- Multi-device realtime → Socket.io Redis adapter + node cluster gerekir.

### 9.5 Geçiş öncesi zorunlu işler

1. Numbered migration runner + schema migrations.
2. Integer minor unit (kuruş) para modeli.
3. Audit trail (mutation log) — tüm finansal ve menü değişiklikleri.
4. Outbox sync queue + conflict resolution protokolü.
5. Tenant identity + billing ayrımı.
6. API stable contract (OpenAPI).
7. Idempotency her mutasyon endpointine (halihazırda kısmi).
8. Secret rotation.
9. Merkezi log / crash reporter.
10. CI/CD + staging ortamı.

### 9.6 Henüz yapılmaması gerekenler

- Multi-tenant cloud deployment — business_id kolon seviyesi yeterli değil.
- Multi-branch birleşik raporlama.
- Customer-facing portal.
- Ödeme tenant'lar arası paylaşımlı rate-limit.

---

## 10) Database Professionalization / Veritabanı Profesyonelleştirme

### 10.1 Mevcut SQLite yapısı ne kadar yeterli?

Bugünkü tek kasa + tek işletme senaryosunda **SQLite yeterli**. WAL modu + busy_timeout + FK ON iyi set edilmiş. Günlük backup var.

### 10.2 Hangi noktaya kadar yeterli?

- 1 işletme × 1–3 kasa × 1–10 yazıcı → SQLite + WAL rahat gider.
- 1 işletme × 2+ şube → aynı DB dosyasını paylaşım zor; replika gerek.
- 2+ işletme (SaaS) → SQLite yetersiz (concurrent write, backup izolasyonu, tenant izolasyonu).
- Multi-device mobil + masaüstü eş zamanlı → SQLite yazım tek-process; bu sınıfta yetmez.
- Merkezi raporlama + BI → analitik DB'ye (Postgres/ClickHouse) çıkar.

### 10.3 Profesyonel merkezi DB ne zaman gerekir?

**Şu tetikleyicilerden herhangi biri çıktığında:**
- 2. işletmeye kurulum yapıldığında (multi-tenant).
- Aynı işletmede 2. şube açıldığında (multi-branch).
- Mobil istemci sipariş yazacağında (multi-device mutasyon).
- Cloud/online'a geçileceğinde.
- Resmi audit/mali denetim gereği audit trail talep edildiğinde.

### 10.4 PostgreSQL'e geçiş gerekir mi?

**Evet, orta vadede.** Sırayla:
- **Kısa vade:** SQLite kalır; snapshot disiplini + numbered migration + kuruş model + audit trail + CHECK eklenir.
- **Orta vade:** schema Postgres-friendly hale getirilir (UUID, timestamptz, JSONB, generated columns), ancak dağıtım hâlâ SQLite olabilir.
- **Uzun vade:** cloud backbone'da Postgres; lokalde SQLite replikası (edge DB) kalır — hibrit sync.

### 10.5 Migration disiplini

- **Bugün:** tek `run.js`, idempotent `CREATE TABLE IF NOT EXISTS` + `ALTER TABLE ADD COLUMN` kalıbı.
- **Eksik:** `schema_migrations` tablosu, timestamp/seq numarası, rollback, hangi sürümde hangi alan eklendi metadata'sı.
- **Gerekli:** dbmate / knex / drizzle-kit / custom runner.

### 10.6 Audit trail

- Bugün sadece `audit_logs.login_failed`.
- Gerekli: `entity_mutations` (table, row_id, before, after, actor, at, reason).
- Finansal ve menü değişiklikleri (fiyat, ürün silme, ödeme iptali, rol değişikliği) zorunlu.

### 10.7 Backup/Restore

Sprint 12 sonrası **sınıf lideri** seviyede (meta.json, sha256, safety revert, scheduler, integrity check). Eksik: dış depo (S3/Backblaze) gönderim ve encryption (AES-256). V2'de.

### 10.8 Tenant/Business Isolation

- Kolon seviyesinde var ama testi yok.
- Router middleware `req.businessId` enforce ediyor.
- Postgres'e geçişte `row-level security` (RLS) uygulanabilir.
- DB seviyesinde "cross-tenant sızıntı testi" yok.

### 10.9 Raporlama ve veri güvenilirliği

- date(created_at) filtreleri range filter'a çevrilmiş (index friendly).
- Snapshot stratejisi yarım — kategori/yazıcı snapshot var, vergi/servis/fiyat politikası versiyonu yok.
- Period close (Z raporu) yok.

### 10.10 Conflict/Sync ihtiyacı

Mobil + cloud + offline → şart olacak. Bugün yok. CRDT, last-write-wins veya outbox + event sourcing arasında net bir seçim yapılmadı.

### 10.11 Tarihsel ve finansal veri bütünlüğü

- Integer minor unit → **kritik**. Şu an REAL + round2. Rounding hatası birikmeye açık.
- Immutable ledger yok — payment.deleted_at yerine `payment_reversals` + parent ref daha doğru olur.
- Period lock (gün kapandıktan sonra geriye dönük mutasyon yasağı) yok.

### 10.12 Kısa / Orta / Uzun vade plan

**Kısa (desktop v1.x):**
- Numbered migration runner.
- Audit log tablosu (entity_mutations).
- CHECK constraint'lerin eski DB'lere uygulanması (controlled recreate).
- Snapshot tamamlanması (tax, service, pricing_policy_version).

**Orta (online öncesi):**
- Integer minor unit migration (tüm para alanları).
- Postgres-friendly tip migrasyonu.
- Period close + lock.
- Payment reversal modeli.

**Uzun (cloud/multi-tenant):**
- Tenant RLS.
- Analitik DB (Postgres + dbt veya ClickHouse).
- Event sourcing backbone (sipariş + ödeme eventleri).
- Multi-device conflict resolution.

---

## 11) Mobile Expansion Analysis

### 11.1 Mevcut mobil readiness

- Web tarafı **responsive değil.** Masaüstü için tasarlanmış. Tablet'te belki, telefonda kesinlikle değil.
- Backend API **ekran merkezli** (admin.js, orders.js); mobil-first contract yok.
- Auth akışı **email/password + JWT 24h**, mobil için (refresh, device binding, push) hazır değil.
- Socket.io altyapısı mobil'e taşınabilir — iyi haber.

### 11.2 Hangi mobil ürün tipi?

| Tip | Değerlendirme |
|---|---|
| **Garson telefonu istemcisi (sipariş giren)** | En mantıklı ilk mobil ürün. Küçük kapsam, somut saha değeri. |
| Yönetici paneli (dashboard) | PWA olarak düşük maliyetli başlanabilir; native'e gerek yok. |
| Müşteri-facing uygulama (menü görüntüle, sipariş ver) | Orta vadeli; QR self-service iyi başlangıç. |
| Tam POS replikası telefonda | Hatalı — masaüstü POS'u telefona sıkıştırma anti-pattern. |

### 11.3 Hangi teknoloji?

- **React Native (Expo)** — takım JS'te (tek kişi), mevcut sözleşmeye yakın, push/OTA kolay. Tavsiye.
- Native (Swift/Kotlin) — hardware derinliği gerekiyorsa (BLE yazıcı, tap-to-pay). Şimdilik gerekmiyor.
- Flutter — öğrenme yükü var; proje tek kişi olduğu için tavsiyesizdir.
- **PWA** — yönetici paneli için evet, garson istemcisi için hayır (çevrimdışı güvenilirlik yetersiz).

### 11.4 Mevcut ekranlar mobil için ne kadar uygun?

- OrderScreen: **uygun değil**, yeniden tasarlanmalı. (1605 satır, masaüstü varsayımı)
- TablesScreen: **kısmen**, "garsonun hangi masası" dar view gerekir.
- KitchenScreen: **büyük ekran için**, mobilde işe yaramaz.
- Reports: **kısmen**, grafikler mobilde okunur, tablolar zor.
- Settings/Printer: mobil kapsam dışı.

### 11.5 Mobilde olmalı

- Masa atanmış garsonun siparişi
- Takeaway siparişi kabul
- Kuryeye atama / teslim durumu
- Mutfak bildirimi (push)
- Gün sonu özet (admin)

### 11.6 Mobilde olmamalı

- Tam ödeme alma (terminal entegrasyonu olmadan risk)
- Yazıcı yönetimi
- Menü CRUD
- Rapor export (masaüstüne bırak)
- Multi-role admin paneli

### 11.7 iOS hazırlığı

- 2/10. Mevcut proje hiç iOS varsayımı taşımıyor.
- Apple Developer hesabı, review süreci, in-app purchase gibi konular ek süreç.
- **Riski:** SaaS subscription varsa Apple komisyonu (%15/30) modeli bozabilir.

### 11.8 Android hazırlığı

- 2/10. Ekran büyüklüğü çeşitliliği (phone + tablet + PDA) test matris yükü yüksek.
- **Ama:** ilk mobil çıkış Android olmalı. Sebep: restoran sahası Android tablet (özellikle POS yerine garson tableti) yoğun, Apple'a göre manevra alanı geniş, store politikası esnek.

### 11.9 Hangisi önce?

> **Önce Android. Sonra iOS.**
> Sebep: restoranda yaygın cihaz, store politikası esnek, hızlı iterate edilir.

### 11.10 Ortak backend gereksinimleri

- OpenAPI / tRPC / GraphQL kontrat stabil olmalı.
- Device pairing (QR ile) endpointleri.
- Push notification backbone (FCM + APNs).
- Refresh token + device session.
- Rate limit mobil cihaz bazlı (bridge gibi).
- Realtime için Socket.io namespace ayırımı ("/mobile/waiter", "/mobile/kitchen").

---

## 12) Layer-by-Layer Technical Analysis

### 12.1 Frontend

- React 18 + Vite, lazy-loading iyi yönde.
- State: Context API + local; react-query/redux yok.
- Component sınırları ekran bazlı → domain bazlı değil. Yeniden kullanılabilir UI az.
- `printErrorMessages.js` gibi noktalı iyi örnekler var; yaygınlaştırılmalı.
- 0 frontend testi.

### 12.2 Backend / Services / Routes

- Express + Zod + better-sqlite3.
- Domain service: kısmi (`printJobs`, `printRouting`, `callerIdService`, `printerAutoPrintPolicy`, `orderPaymentState`, `orderActionPolicy`).
- Route dosyalarında domain kuralları (orders.js 1231, admin.js 2275) — anti-pattern.
- Middleware disiplinli (auth, bridgeAuth, validate).
- Transaction + idempotency iyi; sideeffect transaction dışında.

### 12.3 Database / Schema

- 35 tablo + migration yamaları.
- WAL + FK + busy_timeout.
- business_id her tabloda.
- Kolon snapshot disiplini yarım.
- REAL para.
- ON DELETE politikası homojen değil.

### 12.4 Integrations / Bridge / Print

- Outbox + pull + lease + idempotency — iyi.
- Error codes 16 adet — iyi.
- CallerID self-contained — iyi.
- StoreBridge file log yok — eksik.
- Webhook/SMS/mail backbone yok — eksik.

### 12.5 Electron / Desktop Shell

- 1632 satır tek dosya. Config, JWT, DB migration, 3 child process, backup scheduler, pencere — bir arada.
- extraResources, userData, smoke tests — iyi disiplin.
- Sub-module ayrımı (config/, serverProcess.cjs, bridgeProcess.cjs, callerIdProcess.cjs, sqliteMigration.cjs, backupScheduler.cjs) yapılmalı.

### 12.6 Config / Environment

- `.env`, `pos-config.json`, bridge env, DB settings — çoklu kaynak.
- Tek doğruluk kaynağı (resolver) yok.
- Precedence dokümanı yok.

### 12.7 Tests

- Server: 318 test, 24 dosya, 99 senaryolu orderLifecycle var.
- Playwright: 2 spec (smoke).
- Frontend unit/component: 0.
- Hardware-in-the-loop (printer/CallerID): yok.

### 12.8 Logging / Diagnostics

- Electron persistent log: userData/logs/electron-main.log.
- StoreBridge file log: yok.
- Crash reporter: yok.
- Structured logging (JSON line): yok.
- Request id / correlation id: yok.

### 12.9 Deployment / Update

- electron-updater + GitHub Releases + latest.yml.
- Kod imzası yok.
- CI/CD yok.
- Rollback prosedürü tanımlı değil (manuel önceki Setup.exe).

### 12.10 Docs / Runbooks

- 4 runbook (desktop-install, backup-restore, code-signing, printer-acceptance).
- 11 audit raporu.
- CLAUDE.md güncel.
- Müşteri dokümanı: yok.
- API dokümanı: yok.

---

## 13) Risk Register

| # | Risk | Açıklama | Etki | Olasılık | Öncelik | Çözüm Önerisi | Hangi Aşamadan Önce |
|---:|---|---|---|---|---|---|---|
| R1 | Veri kaybı (DB corruption) | SQLite WAL kesilirse + backup eskiyse | Yüksek | Düşük | P1 | Backup staleness banner + daily verify + ext export (çoğu yapıldı) | Pilot lansman |
| R2 | Yanlış yazdırma (dup veya eksik) | Bridge ACK gerçek kağıt garantisi değil | Yüksek | Orta | P1 | Vendor status protocol veya operatör onay akışı | Online/multi-device öncesi |
| R3 | Çoklu cihaz çakışması | Aynı siparişe iki cihazdan | Yüksek | Düşük (bugün) / Yüksek (mobil sonrası) | P0 (mobil sonrası) | Conflict resolution + optimistic lock + idempotency-wall | Mobil öncesi |
| R4 | Online geçişte entegrasyon kırılması | Outbox/yazıcı/CallerID cloud ile uyumsuzluk | Yüksek | Orta | P1 | Edge bridge pattern, aşamalı evrim | Online geçişi boyunca |
| R5 | Mobilde UX yetersizliği | Ekranlar mobil-first değil | Yüksek | Yüksek | P1 | Mobil için ayrı design + ayrı API endpoint | Mobil başlamadan |
| R6 | DB migration riski (kuruş geçişi) | REAL → integer geçiş canlı veride | Yüksek | Orta | P1 | Shadow column + dual write + cutover | Online öncesi |
| R7 | Bakım zorluğu (monolitik dosyalar) | OrderScreen/admin.js/electron main büyüyor | Orta | Yüksek | P1 | Controlled extraction + test güvencesi | Her yeni sprintte bir dilim |
| R8 | Tek kişiye bağımlılık | Bus factor = 1 | Yüksek | Yüksek | P0 | Dokümantasyon + CI/CD + commit disiplini | Sürekli |
| R9 | Ürünleşmeden önce fazla genişleme | Mobil/cloud erken = dağılır | Yüksek | Yüksek | P0 | Sıralama disiplini (bu rapor) | Herhangi yeni yöne çıkmadan |
| R10 | SmartScreen kurulum sürtünmesi | IT'si olmayan müşteride kurulum durur | Orta | Yüksek | P1 | Kod imzası | Pilot lansman öncesi |
| R11 | Para rounding hatası | REAL'da split payment + discount + VAT | Orta | Orta | P1 | Integer minor unit + merkezi round2 testleri | Online öncesi |
| R12 | Audit trail eksikliği | Fiş silme, fiyat değişimi belirsiz | Orta | Yüksek | P1 | entity_mutations tablosu + middleware | Online öncesi |
| R13 | Frontend regressionu | 0 bileşen testi | Orta | Yüksek | P1 | Kritik ekran Playwright + RTL testi | Büyük frontend refactor öncesi |
| R14 | Gizli bilgi sızıntısı | pos-config.json, log masking | Düşük | Düşük | P2 | Periodic secret rotation + log hygiene testi | Yıllık |
| R15 | Printer encoding sahada patlaması | PC857 vs Win1254 yeni cihazlar | Orta | Orta | P2 | Golden snapshot + cihaz profil kataloğu | Her yeni müşteri |
| R16 | Yedek scheduler kaybolması | Windows schtasks silinir / yanlış ayar | Orta | Düşük | P2 | Scheduler health check + UI banner | Pilot lansman |

---

## 14) Technical Debt Map

### 14.1 Hemen ödenmeli
- Frontend test altyapısı (Vitest + RTL) — en az PaymentScreen + OrderScreen için.
- CI/CD pipeline (lint:ci + test + build) — GitHub Actions.
- StoreBridge file logu.
- `lint:ci` gerçekten 0 warning mi, periyodik doğrulama.

### 14.2 Ürünleşme öncesi ödenmeli
- Kod imzası (SmartScreen).
- First-run setup wizard.
- electron/main.cjs sub-module ayrımı.
- Numbered migration runner.
- API client domain split (api.js → modüller).
- Orders/payments route'larını domain service'e çıkar.

### 14.3 Online öncesi ödenmeli
- Integer minor unit (kuruş) para modeli.
- Audit trail (entity_mutations).
- Period close / lock.
- Tenant identity + billing.
- Outbox sync + conflict resolution.
- OpenAPI sözleşmesi.
- Secret rotation.
- Merkezi log / crash reporter.

### 14.4 Mobil öncesi ödenmeli
- Device pairing + push notification.
- Mobil-first endpointler.
- Refresh token + device session.
- Mobil için ayrı design system.

### 14.5 Şimdilik tolere edilebilir
- Admin dashboard eksikliği (yerine ayar ekranları var).
- Gelişmiş reporting (BI-grade) — dış araçla yapılabilir.
- Loyalty/promosyon.
- Multi-currency.

---

## 15) Work-Sequence Roadmap

> **Bu yol haritası zamanla değil, bağımlılık sırasıyla yazıldı. Aşamaları atlayarak ilerlemek risk yaratır.**

---

### 15.1 Desktop / Local Çekirdeği Ürünleştirme Yol Haritası

#### Aşama D-1 — Test + CI Kapısı
**Amaç:** Her değişikliğin kırılmadığını otomatik doğrulamak.
**Neden bu sırada:** Bundan sonraki her işi bu kapıdan geçireceksin. Yoksa ilerlemek körlükte gitmek.
**Ön koşullar:** Yok (bugünden başla).
**Yapılacaklar:**
- `lint:ci` + test + build GitHub Actions.
- Playwright smoke test chain'e eklensin.
- PaymentScreen + OrderScreen için en az 5–10 RTL testi.
**Neden sonraki aşamaya geçmeden bitmeli:** Monolitik refactor'a test olmadan girmek intihardır.

#### Aşama D-2 — Signing + Wizard + Update Disiplini
**Amaç:** Müşteri kurulabilir olmak.
**Neden bu sırada:** D-1 olmadan signed release güvenilir değil.
**Ön koşullar:** D-1 tamam.
**Yapılacaklar:**
- Windows kod imzası (EV veya OV sertifika).
- First-run setup wizard (şirket adı, yazıcı, bridge token, admin parola).
- Auto-update kanalı + changelog.
- Release notes UI.
**Neden sonraki aşamaya geçmeden bitmeli:** Pilot müşteriye kurulum bu olmadan profesyonel değil.

#### Aşama D-3 — Operasyonel Görünürlük
**Amaç:** Sahada ne oluyor bilmek.
**Ön koşullar:** D-1.
**Yapılacaklar:**
- StoreBridge file log + rotation.
- Crash reporter (Sentry / rollbar) main + renderer + backend.
- Support bundle UI butonu (endpoint var, son adım UI).
- Structured logging (JSON line).
- Request-id correlation.
**Neden sonraki aşamaya geçmeden bitmeli:** Daha büyük değişiklik öncesi saha verisi görmek şart.

#### Aşama D-4 — Monolitik Ayrıştırma (Kontrollü)
**Amaç:** Bakım maliyetini düşürmek.
**Ön koşullar:** D-1, D-3.
**Yapılacaklar (sırayla):**
1. `electron/main.cjs` → config/, serverProcess.cjs, bridgeProcess.cjs, callerIdProcess.cjs, sqliteMigration.cjs, backupScheduler.cjs, window.cjs.
2. `server/routes/orders.js` → services/orderService.js + routes/orders.js sadece HTTP.
3. `server/routes/payments.js` → services/paymentService.js.
4. `client/src/services/api.js` → domain modülleri.
5. `OrderScreen.jsx` → hooks + sub-component extraction (önce yan etkisiz).
6. `PrinterDetailPage.jsx` → form model hook + device section + preview.
**Neden sonraki aşamaya geçmeden bitmeli:** Migration/online hazırlıkları bu kod tabanı üstünde yapılacak.

#### Aşama D-5 — Ürün Eksiklerini Kapatma
**Amaç:** Ticari satılabilirlik.
**Ön koşullar:** D-4.
**Yapılacaklar:**
- Period close / X-Z raporu.
- İade / return akışı.
- e-belge entegrasyonu (opsiyonel).
- Ödeme terminal SDK (opsiyonel).
- Tip/bahşiş modeli.
- Rezervasyon → masa eşleme.

---

### 15.2 Online / Cloud Geçiş Yol Haritası

#### Aşama O-1 — Veri Modeli Sağlamlaştırma
**Amaç:** Cloud'a taşınacak veri güvenilir olsun.
**Ön koşullar:** D-1 + D-3 + D-4 (kısmi) tamam.
**Yapılacaklar:**
- Numbered migration runner (schema_migrations).
- Audit trail (entity_mutations).
- Integer minor unit migration (dual write + cutover).
- Snapshot tamamlanması (tax, service, pricing_policy_version).
- Period close / lock.
**Neden sonraki aşamaya geçmeden bitmeli:** Cloud DB modeli bu olmadan profesyonel kurulamaz.

#### Aşama O-2 — Tenant Identity + Billing
**Amaç:** Bir işletmeden çok işletmeye.
**Ön koşullar:** O-1.
**Yapılacaklar:**
- Tenant model (plan, limit, billing).
- RBAC genişleme.
- Tenant-aware rate limiting.
- Tenant-aware backup/restore.
- Stripe / iyzico subscription.

#### Aşama O-3 — Sync Backbone
**Amaç:** Local-first + cloud outbox.
**Ön koşullar:** O-1, O-2.
**Yapılacaklar:**
- Outbox genişletme: sipariş, ödeme, menü, müşteri mutasyonları.
- Conflict resolution protokolü (last-write-wins / CRDT / rev-id).
- Edge bridge → cloud websocket/REST sync.
- Idempotency-wall tüm mutation endpoint'lerinde.

#### Aşama O-4 — Cloud Deployment
**Amaç:** Gerçek multi-tenant online.
**Ön koşullar:** O-1, O-2, O-3.
**Yapılacaklar:**
- Postgres (RDS / Supabase / self-host).
- Tenant RLS.
- Socket.io + Redis adapter.
- Observability stack (Grafana / Loki / Sentry).
- Staging/production env ayrımı.
- KVKK/data residency uyum.

#### Aşama O-5 — Merkezi Raporlama + Ekosistem
**Amaç:** SaaS değerinin çıkması.
**Ön koşullar:** O-4.
**Yapılacaklar:**
- Merkezi dashboard + BI.
- Chain/multi-branch reporting.
- API ekosistemi (Yemeksepeti, Getir, Logo/Mikro).

---

### 15.3 Mobil iOS/Android Yol Haritası

#### Aşama M-1 — Mobil-Ready Backend
**Amaç:** Mobil ekstra API katmanı değil, ortak contract.
**Ön koşullar:** D-4 + O-1 (kısmi).
**Yapılacaklar:**
- OpenAPI + mobile-first endpoints (waiter-mobile/*, kitchen-mobile/*).
- Device pairing (QR + device_id).
- Push notification (FCM/APNs).
- Refresh token + session model.

#### Aşama M-2 — Garson Mobil (Android ilk)
**Amaç:** Sahada somut değer; dar kapsam.
**Ön koşullar:** M-1.
**Yapılacaklar:**
- React Native (Expo).
- Masa listesi (garsona atanmış) → sipariş ekle → kaydet.
- Push: mutfak tamam, masa çağırıyor.
- Offline queue (tek cihazda).

#### Aşama M-3 — Garson Mobil iOS
**Ön koşullar:** M-2 stabil (3+ ay saha).
**Yapılacaklar:**
- iOS derleme + TestFlight + App Store review.
- Apple-specific (notifications, background fetch).

#### Aşama M-4 — Yönetici Paneli (PWA veya RN)
**Ön koşullar:** O-5.
**Yapılacaklar:**
- Dashboard, raporlar.
- Approval akışları.

#### Aşama M-5 — Müşteri Self-Service
**Ön koşullar:** M-4, O-4.
**Yapılacaklar:**
- QR menü.
- Self-order + self-pay.
- Loyalty.

---

### 15.4 Veritabanı Profesyonelleştirme Yol Haritası

#### Aşama DB-1 — Migration Disiplini
**Ön koşullar:** D-1.
- Numbered migration + schema_migrations tablo.
- Existing run.js → migration runner.
- Rollback discipline (forward-only kararı açıkça).

#### Aşama DB-2 — Audit Trail
**Ön koşullar:** DB-1.
- `entity_mutations` tablo.
- Middleware her mutation endpoint'te.
- UI'de audit log viewer (admin only).

#### Aşama DB-3 — Integer Minor Unit
**Ön koşullar:** DB-2, D-1 (kritik test güvencesi).
- Shadow kolon (subtotal_cents, grand_total_cents, amount_cents).
- Dual write.
- Raporlar cutover.
- REAL alanlar deprecated.

#### Aşama DB-4 — Snapshot Tamamlama
**Ön koşullar:** DB-3.
- Pricing policy version.
- Tax/service snapshot.
- Period lock.

#### Aşama DB-5 — Postgres-Friendly Evrilme
**Ön koşullar:** DB-4.
- UUID default (TEXT yerine).
- Timestamptz modeli.
- JSONB uyumluluk.
- Generated columns.

#### Aşama DB-6 — Cloud DB
**Ön koşullar:** DB-5 + O-2.
- Postgres (cloud).
- RLS.
- Read replica.
- Analitik DB.

---

### 15.5 Profesyonel Ürünleşme Yol Haritası

#### Aşama P-1 — Güven Temeli
**Ön koşullar:** D-1.
- CI/CD.
- Code signing.
- Crash reporter.
- StoreBridge log.

#### Aşama P-2 — Müşteriye Dönük Olgunluk
**Ön koşullar:** P-1.
- First-run wizard.
- In-app help, tooltip.
- Release notes UX.
- Support bundle UI.
- Error taksonomisi (Türkçe dictionary).

#### Aşama P-3 — Dokümantasyon ve Destek
**Ön koşullar:** P-2.
- Müşteri kılavuzu.
- Video eğitimleri.
- Knowledge base.
- Ticket sistemi (Freshdesk/Zammad).
- SLA tanımı.

#### Aşama P-4 — Marka ve Tutarlılık
**Ön koşullar:** P-2.
- Design system (component library + tokens + storybook).
- A11y pass.
- i18n altyapısı (gelecek için).

#### Aşama P-5 — Ekosistem
**Ön koşullar:** P-3 + O-4.
- Public API.
- Webhook.
- Yemeksepeti/Getir.
- Logo/Mikro entegrasyonu.
- Marketplace (3rd party).

---

## 16) Dependency-Based Decision Tree

```
BAŞLANGIÇ → D-1 (Test + CI) ────────────────────────────────────┐
                                                                │
    ├── Eğer hedef: LOCAL ÜRÜN (pilot müşteri) ──► D-2 → D-3 → P-1 → P-2 → SATIŞ
    │
    ├── Eğer hedef: ONLINE/SAAS ──► D-1 ✅ → D-3 ✅ → D-4 (kısmi) → DB-1 → DB-2 → DB-3 → O-1 → O-2 → O-3 → O-4
    │                                                                                                  │
    │                                                                                       (O-4 tamam değilse mobil asla)
    │
    ├── Eğer hedef: MOBİL ──► O-1 ve D-4 zorunlu ✅ → M-1 → M-2 (Android) → 3 ay saha → M-3 (iOS)
    │
    └── Eğer hedef: PROFESYONEL ÜRÜN ──► P-1 → P-2 → P-3 → P-4 → (sonrası paralel)
```

**Kural 1:** D-1 olmadan hiçbir dal açılamaz.
**Kural 2:** Online hedefi varsa D-4 yarım da olsa yeter, ama DB-1+DB-2+DB-3 atlanamaz.
**Kural 3:** Mobil'e O-1 (veri modeli sağlam) olmadan girmek, veri kazası davet eder.
**Kural 4:** Code signing olmadan müşteriye gitme — nokta.

---

## 17) What Not To Do Yet

**Bunlara şu an başlama (erken olursa hata):**

1. **Cloud-first yeniden yazma.** Bugünkü değeri sıfırlar, 6–12 ay kaybettirir.
2. **Mobil uygulama.** M-1 olmadan API karar verilmemiş; mobil başlarsa iki paralel API bakımı çıkar.
3. **Multi-tenant SaaS lansmanı.** Tenant identity + billing + audit trail yokken yapılan her SaaS, ilk ciddi müşteride sorun üretir.
4. **Büyük monolitik refactor aynı anda.** Önce D-1 test güvencesi. Sonra dosya dosya.
5. **Yemeksepeti/Getir entegrasyonu.** Önce outbox genişlemesi, OpenAPI, idempotency-wall.
6. **Loyalty / kampanya modülü.** Para modeli sağlam olmadan puan/iade kaçağı oluşur.
7. **Yeni platform (Linux / Mac) desteği.** Windows'ta ürünleşmeden yan yöne açılma kaynak dağıtır.
8. **Yeni dil / i18n.** Turkish-first ürün olarak lansmanda doğru.
9. **AI/agent entegrasyonu (voice order, müşteri bot).** Çekirdek ürünleşmeden önce gündeme gelmemeli.
10. **Büyük UI redesign.** Design system kurulmadan redesign = yeniden redesign.

---

## 18) Go / No-Go Gates

### Gate 1 — Local Ürünleşme (Pilot Müşteri)
- ✅ 318+ test geçiyor
- ✅ Backup/restore production-grade
- ⬜ Kod imzası
- ⬜ First-run wizard
- ⬜ StoreBridge file log
- ⬜ Crash reporter
- ⬜ Müşteri kurulum runbook (var ama eğitim + video eksik)
- ⬜ Support bundle UI butonu
- ⬜ Pilot eğitimi + on-site kurulum prosedürü

**Durum:** 🟡 **3 şart açık** (kod imzası + wizard + crash reporter). Aşılabilir.

### Gate 2 — Online Faza Geçiş
- ⬜ Numbered migration runner
- ⬜ Audit trail
- ⬜ Integer minor unit
- ⬜ Tenant identity + billing
- ⬜ Outbox sync + conflict resolution
- ⬜ OpenAPI sözleşmesi
- ⬜ Secret rotation
- ⬜ Merkezi log / crash reporter
- ⬜ Staging ortamı + CI/CD

**Durum:** ❌ **9 şart açık.**

### Gate 3 — Mobil Faza Geçiş
- ⬜ Online backbone (Gate 2 complete)
- ⬜ Mobile-first API endpoints
- ⬜ Device pairing + push
- ⬜ Refresh token + session
- ⬜ Mobil design system (ayrı)

**Durum:** ❌ **Mobilin ön koşulu Gate 2.**

### Gate 4 — Profesyonel Ürün Lansmanı
- ⬜ Gate 1 complete
- ⬜ Design system + a11y pass
- ⬜ Customer docs + video
- ⬜ Support ticket sistemi
- ⬜ SLA tanımı
- ⬜ Marka/about/splash tutarlılığı

**Durum:** ❌ **Gate 1'den sonra.**

---

## 19) Single-Developer Reality Check

Bu proje tek kişiyle yürütülüyor. Bu gerçek üzerinden özel tavsiyeler:

### Boğulma riski olmayan sıra
1. **D-1 (Test + CI)** — küçük ama sonrasını mümkün kılar.
2. **D-2 (Signing + Wizard)** — somut satış etkisi.
3. **D-3 (Log + Crash reporter)** — saha ile ilgili dert azalır.
4. **D-4 parça parça** — ayda bir dosya ayrımı yeter.
5. **DB-1 + DB-2** — online'a kapı açar, ama yavaş ilerler.

### Bölünmesi gereken büyük işler
- **OrderScreen refactor:** tek PR'da değil, 4–5 pass'ta. Önce hook extraction, sonra sub-component, sonra state reduction.
- **electron/main.cjs ayrımı:** her sub-module ayrı commit/PR.
- **API client split:** domain başına bir PR.

### Scope nerede daraltılmalı?
- **Mobil**: erteleme kararı yaz, roadmap'te “sonra”.
- **Multi-branch**: pilot müşteri tek şubeli olsun, erteleme.
- **e-belge**: kapsama al ama v1.x'in sonu.
- **Loyalty**: v2 roadmap.
- **Yemeksepeti/Getir**: v2 roadmap.

### AI desteği mantıklı olan alanlar
- Testing (birim test üretimi).
- Refactoring (küçük, kontrollü, PR bazlı).
- Dokümantasyon (müşteri kılavuzu, runbook, release notes).
- Log/telemetry event dictionary üretimi.
- Error taksonomisi.
- API sözleşmesi (OpenAPI) üretimi.

### İnsan eliyle dikkat isteyen alanlar
- Para/ödeme/rounding kodu.
- Migration yazımı (canlı veri).
- Yazıcı encoding.
- Güvenlik (secret rotation, CORS, auth).
- İş kuralı kararları (discount, tip, KDV).
- Müşteriye dönük UX akışları.

---

## 20) Final Recommendation

### Bugünkü haliyle proje ne seviyede?
**“Pilot müşteriye hazır, çok müşteriye / cloud'a / mobile’a hazır değil”** bir local POS çekirdeği. Backend test disiplini ve release infra’sı tek kişi projelerinin üstünde; mimari mühendislik (monolitik dosyalar, veri modeli seviye atlaması, frontend test boşluğu) altında.

### İlk ne yapılmalı?
1. **D-1: Test + CI kapısı** (lint:ci + backend test + Playwright smoke + RTL PaymentScreen/OrderScreen).
2. **D-2: Kod imzası + first-run wizard + auto-update changelog.**
3. **D-3: StoreBridge file log + crash reporter + support bundle UI.**

### Sonra ne yapılmalı?
4. **D-4: electron/main.cjs ayrımı → server/routes/orders + payments domain service → api.js domain split.**
5. **DB-1: Numbered migration runner. DB-2: audit trail.**
6. **P-2: First-run wizard + in-app help + error taksonomisi.**

### Online'a ne zaman (hangi koşullardan sonra)?
- **D-1, D-3, D-4 (kısmi) tamam.**
- **DB-1, DB-2, DB-3 (integer minor unit) tamam.**
- **Tenant identity + billing modeli tasarlanmış.**
- **Outbox sync ve conflict resolution protokolü yazılmış.**
- **Staging ortam kurulmuş.**
- Bundan **önce** online'a geçmek = data corruption riski + SLA ihlali.

### iOS/Android'e hangi koşullardan sonra?
- **Online backbone (Gate 2) ayakta.**
- **OpenAPI kontrat stabil.**
- **Device pairing + push notification çalışıyor.**
- **Önce Android (garson mobil, dar kapsam), 3 ay saha sonrası iOS.**

### Profesyonel ürüne ilk 15 gerçek iş

1. GitHub Actions CI: lint:ci + backend test + Playwright smoke.
2. PaymentScreen + OrderScreen için RTL testi (en az 10 kritik senaryo).
3. Windows kod imzası (EV sertifika + sign chain dist:release'e).
4. First-run setup wizard (şirket + admin + yazıcı + bridge token).
5. StoreBridge file log (userData/logs/store-bridge.log + rotation).
6. Sentry crash reporter (main + renderer + backend).
7. Support bundle UI butonu (endpoint hazır).
8. Release notes UX (settings içinde "Sürüm Notları" ekranı).
9. electron/main.cjs → sub-module ayrımı (6 parça).
10. server/routes/orders.js → services/orderService.js (domain extraction, test güvencesiyle).
11. client/src/services/api.js → orders/payments/tables/customers modülleri.
12. Numbered migration runner + schema_migrations tablo.
13. Audit trail (entity_mutations) + admin UI viewer.
14. Error taksonomisi (Türkçe dictionary + UI mapping) — printer benzeri.
15. Müşteri kılavuzu (5–10 dk'lık video + PDF) — satış için şart.

---

## Ek: Metodoloji ve Kaynaklar

**Kanıt kaynakları:**
- CLAUDE.md (Sprint 1–12 özeti).
- Git history (ba588f0, bc55cd7, f129a9b, 4131fbb).
- Mevcut audit raporları: `docs/audit/00 … 11` (git history'den okundu; çalışma ağacında değildi).
- Canlı `wc -l` ve `grep` sayımları (2026-04-17).
- server/tests: 318 `it()` toplam (12 unit + 11 integration + 1 frontend dosyası).
- package.json script inventory.

**Rapor içi sınırlılıklar:**
- `npm run lint:ci` ve `npm run test` bu raporda yeniden çalıştırılmadı. CLAUDE.md ve audit 11 rakamları doğrulanmış olarak kabul edildi (318 test, 0 warning hedefli CI gate).
- Frontend davranışı incelemesi statik analize dayanıyor; canlı runtime izi kayıt altına alınmadı.
- Saha cihaz (yazıcı modelleri, CID812 cihaz sayısı) testi yapılmadı.

**Yazarın notu:**
Bu rapor pazarlama dili kullanmaz. Hazır olmayan hazır gibi gösterilmedi. CLAUDE.md'in "9.2/10 overall score" değerlendirmesi **iç değerlendirme ölçeği**; ticari ürün kalitesine göre yeniden kalibre edilmiştir (5.6/10 Productization Score). İki ölçek çelişmiyor — farklı referans çerçeveleri.

---

**Sonuç:**
Projenin bugünkü haliyle **tek restoran pilot müşteride lansmana 3 şart uzaklıkta**, **online'a 9 şart uzaklıkta**, **mobil'e ise önce online'dan geçmesi gerekli** bir seviyede olduğu belirlenmiştir. Yol haritası sıra bağımlıdır; sırayı bozmak her aşamayı daha pahalı yapar.
